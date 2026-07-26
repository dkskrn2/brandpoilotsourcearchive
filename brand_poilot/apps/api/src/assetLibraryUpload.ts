import { createHash, timingSafeEqual } from "node:crypto";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { del, get, list } from "@vercel/blob";
import { parseAssetUploadInput, type AssetUploadInput } from "./assetLibraryContracts.js";

export type AssetLibraryUploadKind = "avatar" | "reference";
export const ASSET_LIBRARY_AVATAR_POLICY = Object.freeze({
  "image/png": 5 * 1024 * 1024,
  "image/jpeg": 5 * 1024 * 1024,
  "image/webp": 5 * 1024 * 1024,
});
export const ASSET_LIBRARY_REFERENCE_POLICY = Object.freeze({
  ...ASSET_LIBRARY_AVATAR_POLICY,
  "application/pdf": 10 * 1024 * 1024,
  "text/plain": 5 * 1024 * 1024,
  "text/markdown": 5 * 1024 * 1024,
  "text/csv": 5 * 1024 * 1024,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": 10 * 1024 * 1024,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": 10 * 1024 * 1024,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const policy = {
  avatar: ASSET_LIBRARY_AVATAR_POLICY,
  reference: ASSET_LIBRARY_REFERENCE_POLICY,
} as const;

function fail(code: string): never { throw new Error(code); }
function uuid(value: string): string {
  if (!UUID.test(value)) fail("asset_library_upload_scope_invalid");
  return value.toLowerCase();
}
function equal(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function trustedBlobUrl(value: unknown, expectedPath: string, code: string): string {
  if (typeof value !== "string" || !value) fail(code);
  let url: URL;
  try { url = new URL(value); } catch { fail(code); }
  let path: string;
  try { path = decodeURIComponent(url.pathname).replace(/^\//, ""); } catch { fail(code); }
  if (
    url.protocol !== "https:"
    || !(url.hostname === "blob.vercel-storage.com" || url.hostname.endsWith(".blob.vercel-storage.com"))
    || url.username
    || url.password
    || url.port
    || url.search
    || url.hash
    || path !== expectedPath
  ) fail(code);
  return value;
}

export function validateAssetLibraryUpload(
  kind: AssetLibraryUploadKind,
  value: AssetUploadInput,
): AssetUploadInput {
  const upload = parseAssetUploadInput(value);
  const maximum = policy[kind][upload.mimeType as keyof typeof policy[typeof kind]];
  if (maximum === undefined) fail("asset_library_upload_mime_invalid");
  if (upload.sizeBytes > maximum) fail("asset_library_upload_size_invalid");
  return upload;
}

export function buildAssetLibraryPath(input: {
  brandId: string;
  avatarId?: string;
  sessionId: string;
  kind: AssetLibraryUploadKind;
  checksum: string;
  fileName: string;
}): string {
  const upload = parseAssetUploadInput({
    fileName: input.fileName,
    mimeType: "image/png",
    sizeBytes: 1,
    checksum: input.checksum,
  });
  const namespace = input.kind === "avatar" ? "avatars" : "references";
  const target = input.kind === "avatar"
    ? `${uuid(input.avatarId ?? "")}/${uuid(input.sessionId)}`
    : uuid(input.sessionId);
  return `brands/${uuid(input.brandId)}/asset-library/${namespace}/${target}/${upload.checksum}-${upload.fileName.replace(/ +/g, "-")}`;
}

export interface AssetLibraryUploadSession {
  id: string;
  workspaceId: string;
  brandId: string;
  kind: AssetLibraryUploadKind;
  avatarId?: string | null;
  nonce: string;
  fileName: string;
  storagePathPrefix: string;
  expectedMimeType: string;
  expectedSizeBytes: number;
  expectedChecksum: string;
  expiresAt: string;
  confirmedAt: string | null;
}
export interface AssetLibraryTokenOptions {
  token: string;
  generateClientToken?: typeof generateClientTokenFromReadWriteToken;
}
export interface AssetLibraryBlobOptions {
  token: string;
  getBlob?: typeof get;
  now?: Date;
}

export interface AssetLibraryDeleteOptions {
  token: string;
  deleteBlob?: typeof del;
  listBlobs?: typeof list;
}

export async function deleteAssetLibraryBlob(
  storagePath: string,
  options: AssetLibraryDeleteOptions,
): Promise<void> {
  if (!options.token.trim()) fail("asset_library_upload_storage_not_configured");
  try {
    await (options.deleteBlob ?? del)(storagePath, {
      token: options.token,
      abortSignal: AbortSignal.timeout(15_000),
    });
  } catch {
    fail("asset_library_blob_delete_failed");
  }
}

export async function cleanupAssetLibraryUploadPrefix(
  storagePathPrefix: string,
  storagePath: string | undefined,
  options: AssetLibraryDeleteOptions,
): Promise<void> {
  const uuidPart = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const scopedAvatarPrefix = new RegExp(
    `^brands/${uuidPart}/asset-library/avatars/${uuidPart}/${uuidPart}/$`,
    "i",
  );
  if (!scopedAvatarPrefix.test(storagePathPrefix)
    || (storagePath !== undefined && !storagePath.startsWith(storagePathPrefix))) {
    fail("asset_library_upload_path_mismatch");
  }
  if (!options.token.trim()) fail("asset_library_upload_storage_not_configured");
  const remove = options.deleteBlob ?? del;
  const find = options.listBlobs ?? list;
  try {
    if (storagePath) {
      await remove(storagePath, { token: options.token, abortSignal: AbortSignal.timeout(15_000) });
    }
    let cursor: string | undefined;
    do {
      const page = await find({
        token: options.token,
        prefix: storagePathPrefix,
        limit: 1_000,
        ...(cursor ? { cursor } : {}),
        abortSignal: AbortSignal.timeout(15_000),
      });
      const paths = page.blobs.map((blob) => blob.pathname);
      if (paths.some((pathname) => !pathname.startsWith(storagePathPrefix))) {
        fail("asset_library_upload_path_mismatch");
      }
      if (paths.length) {
        await remove(paths, { token: options.token, abortSignal: AbortSignal.timeout(15_000) });
      }
      if (page.hasMore && !page.cursor) fail("asset_library_blob_delete_failed");
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  } catch (error) {
    if (error instanceof Error && error.message === "asset_library_upload_path_mismatch") throw error;
    fail("asset_library_blob_delete_failed");
  }
}

export async function issueAssetLibraryUploadToken(input: {
  brandId: string;
  sessionId: string;
  avatarId?: string;
  kind: AssetLibraryUploadKind;
  upload: AssetUploadInput;
  expiresAt?: string;
}, options: {
  token: string;
  generateClientToken?: typeof generateClientTokenFromReadWriteToken;
}): Promise<{ pathname: string; clientToken: string }> {
  if (!options.token.trim()) fail("asset_library_upload_storage_not_configured");
  const upload = validateAssetLibraryUpload(input.kind, input.upload);
  const pathname = buildAssetLibraryPath({ ...input, ...upload });
  const generate = options.generateClientToken ?? generateClientTokenFromReadWriteToken;
  const clientToken = await generate({
    token: options.token,
    pathname,
    allowedContentTypes: [upload.mimeType],
    maximumSizeInBytes: policy[input.kind][upload.mimeType as keyof typeof policy[typeof input.kind]],
    addRandomSuffix: false,
    allowOverwrite: false,
    validUntil: input.expiresAt ? new Date(input.expiresAt).getTime() : Date.now() + 10 * 60 * 1000,
  });
  return { pathname, clientToken };
}

export interface ConfirmedAssetLibraryUpload extends AssetUploadInput {
  storagePath: string;
  storageUrl: string;
}

export async function confirmAssetLibraryUpload(input: {
  session: AssetLibraryUploadSession;
  nonce: string;
  storagePath: string;
  storageUrl: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
}, options: AssetLibraryBlobOptions): Promise<ConfirmedAssetLibraryUpload> {
  const now = options.now ?? new Date();
  if (input.session.confirmedAt) fail("asset_library_upload_replayed");
  if (!equal(input.session.nonce, input.nonce)) fail("asset_library_upload_nonce_mismatch");
  if (new Date(input.session.expiresAt).getTime() <= now.getTime()) fail("asset_library_upload_expired");
  const expected = validateAssetLibraryUpload(input.session.kind, {
    fileName: input.session.fileName,
    mimeType: input.session.expectedMimeType,
    sizeBytes: input.session.expectedSizeBytes,
    checksum: input.session.expectedChecksum,
  });
  const expectedPath = buildAssetLibraryPath({
    brandId: input.session.brandId,
    avatarId: input.session.avatarId ?? undefined,
    sessionId: input.session.id,
    kind: input.session.kind,
    checksum: expected.checksum,
    fileName: expected.fileName,
  });
  if (!expectedPath.startsWith(input.session.storagePathPrefix) || input.storagePath !== expectedPath) {
    fail("asset_library_upload_path_mismatch");
  }
  if (input.mimeType.trim().toLowerCase() !== expected.mimeType) fail("asset_library_upload_mime_mismatch");
  if (input.sizeBytes !== expected.sizeBytes) fail("asset_library_upload_size_mismatch");
  if (!equal(input.checksum.toLowerCase(), expected.checksum)) fail("asset_library_upload_checksum_mismatch");
  trustedBlobUrl(input.storageUrl, expectedPath, "asset_library_upload_url_mismatch");
  if (!options.token.trim()) fail("asset_library_upload_storage_not_configured");
  let downloaded: Awaited<ReturnType<typeof get>>;
  try {
    downloaded = await (options.getBlob ?? get)(expectedPath, {
      token: options.token,
      access: "public",
      useCache: false,
      abortSignal: AbortSignal.timeout(15_000),
    });
  }
  catch { fail("asset_library_upload_blob_unavailable"); }
  if (!downloaded || downloaded.statusCode !== 200) fail("asset_library_upload_blob_unavailable");
  if (downloaded.blob.pathname !== expectedPath) fail("asset_library_upload_path_mismatch");
  const canonicalStorageUrl = trustedBlobUrl(
    downloaded.blob.url,
    expectedPath,
    "asset_library_upload_url_mismatch",
  );
  if (input.storageUrl !== canonicalStorageUrl) fail("asset_library_upload_url_mismatch");
  if (downloaded.blob.contentType.toLowerCase() !== expected.mimeType) fail("asset_library_upload_mime_mismatch");
  if (downloaded.blob.size !== expected.sizeBytes) fail("asset_library_upload_size_mismatch");
  const hash = createHash("sha256");
  const reader = downloaded.stream.getReader();
  let actualSize = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      actualSize += chunk.value.byteLength;
      if (actualSize > expected.sizeBytes) fail("asset_library_upload_size_mismatch");
      hash.update(chunk.value);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("asset_library_upload_")) throw error;
    fail("asset_library_upload_blob_unavailable");
  } finally {
    reader.releaseLock();
  }
  if (actualSize !== expected.sizeBytes) fail("asset_library_upload_size_mismatch");
  if (!equal(hash.digest("hex"), expected.checksum)) fail("asset_library_upload_checksum_mismatch");
  return { ...expected, storagePath: expectedPath, storageUrl: canonicalStorageUrl };
}
