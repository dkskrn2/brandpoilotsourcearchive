import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { BlobNotFoundError, head, type HeadBlobResult } from "@vercel/blob";
import type { AttachmentUploadTokenInput, AiContentAttachmentRole } from "./aiContentContracts.js";

export const AI_CONTENT_IMAGE_MAX_BYTES = 5_000_000;
export const AI_CONTENT_DOCUMENT_MAX_BYTES = 10_000_000;
export const AI_CONTENT_TOTAL_ATTACHMENT_LIMIT = 5;
export const AI_CONTENT_UPLOAD_SESSION_TTL_MS = 10 * 60_000;
export const AI_CONTENT_UPLOAD_TOKEN_EXPIRY_BUFFER_MS = 60_000;
type AttachmentMimePolicy = Readonly<Record<string, number>>;

const IMAGE_ATTACHMENT_POLICY: AttachmentMimePolicy = Object.freeze({
  "image/png": AI_CONTENT_IMAGE_MAX_BYTES,
  "image/jpeg": AI_CONTENT_IMAGE_MAX_BYTES,
});
const DOCUMENT_ATTACHMENT_POLICY: AttachmentMimePolicy = Object.freeze({
  "application/pdf": AI_CONTENT_DOCUMENT_MAX_BYTES,
  "text/plain": AI_CONTENT_IMAGE_MAX_BYTES,
  "text/markdown": AI_CONTENT_IMAGE_MAX_BYTES,
  "text/csv": AI_CONTENT_IMAGE_MAX_BYTES,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": AI_CONTENT_DOCUMENT_MAX_BYTES,
});

export const AI_CONTENT_ATTACHMENT_POLICY: Readonly<Record<AiContentAttachmentRole, AttachmentMimePolicy>> = Object.freeze({
  product: IMAGE_ATTACHMENT_POLICY,
  person: IMAGE_ATTACHMENT_POLICY,
  scale: IMAGE_ATTACHMENT_POLICY,
  visual_reference: IMAGE_ATTACHMENT_POLICY,
  document: DOCUMENT_ATTACHMENT_POLICY,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;

export interface AiContentAttachmentPolicy {
  role: AiContentAttachmentRole;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
}

function fail(code: string): never { throw new Error(code); }

function isAttachmentRole(value: string): value is AiContentAttachmentRole {
  return Object.prototype.hasOwnProperty.call(AI_CONTENT_ATTACHMENT_POLICY, value);
}

function pathSegment(value: string, code: string) {
  if (!UUID.test(value)) fail(code);
  return value.toLowerCase();
}

function safeFileName(fileName: string) {
  const value = fileName.trim();
  if (!value || value.length > 160 || value === "." || value === ".." || /[\\/\0\r\n]/.test(value) || value.includes("..")) fail("ai_content_attachment_file_name_invalid");
  if (!/^[\p{L}\p{N}._ -]+$/u.test(value) || value.startsWith(".") || value.endsWith(".")) fail("ai_content_attachment_file_name_invalid");
  return value.replace(/[ ]+/g, "-");
}

export function validateAiContentAttachment(input: AiContentAttachmentPolicy): AiContentAttachmentPolicy {
  if (!isAttachmentRole(input.role)) fail("ai_content_attachment_role_invalid");
  const mimeType = input.mimeType.trim().toLowerCase();
  const maximumSizeInBytes = AI_CONTENT_ATTACHMENT_POLICY[input.role][mimeType];
  if (maximumSizeInBytes === undefined) fail("ai_content_attachment_role_mime_invalid");
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > maximumSizeInBytes) fail("ai_content_attachment_size_invalid");
  if (!SHA256.test(input.checksum.trim())) fail("ai_content_attachment_checksum_invalid");
  return { ...input, fileName: safeFileName(input.fileName), mimeType, checksum: input.checksum.trim().toLowerCase() };
}

export function buildAiContentUploadSessionPath(input: {
  workspaceId: string;
  brandId: string;
  generationId: string;
  sessionId: string;
  attemptId: string;
  fileName: string;
}): string {
  const workspaceId = pathSegment(input.workspaceId, "ai_content_workspace_id_invalid");
  const brandId = pathSegment(input.brandId, "ai_content_brand_id_invalid");
  const generationId = pathSegment(input.generationId, "ai_content_generation_id_invalid");
  const sessionId = pathSegment(input.sessionId, "ai_content_upload_session_id_invalid");
  const attemptId = pathSegment(input.attemptId, "ai_content_upload_attempt_id_invalid");
  return `workspaces/${workspaceId}/brands/${brandId}/ai-content/${generationId}/attachments/${sessionId}/${attemptId}/${safeFileName(input.fileName)}`;
}

export function buildAiContentAttachmentPath(input: {
  brandId: string;
  generationId: string;
  checksum: string;
  fileName: string;
}): string {
  const brandId = pathSegment(input.brandId, "ai_content_brand_id_invalid");
  const generationId = pathSegment(input.generationId, "ai_content_generation_id_invalid");
  if (!SHA256.test(input.checksum.trim())) fail("ai_content_attachment_checksum_invalid");
  return `brands/${brandId}/ai-content/${generationId}/attachments/${input.checksum.trim().toLowerCase()}-${safeFileName(input.fileName)}`;
}

export interface AiContentAttachmentTokenResult { pathname: string; clientToken: string; }
export interface AiContentTokenOptions { token: string; generateClientToken?: typeof generateClientTokenFromReadWriteToken; }
export interface AiContentBlobVerificationOptions { token: string; headBlob?: typeof head; }
export interface AiContentUploadSessionTokenInput {
  storagePath: string;
  mimeType: string;
  maximumSizeInBytes: number;
  tokenExpiresAt: string;
}
export interface AiContentUploadSessionTokenResult extends AiContentAttachmentTokenResult {
  uploadExpiresAt: string;
}
export interface AiContentUploadSessionBlob {
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
}
export interface VerifiedAiContentAttachmentBlob extends AiContentUploadSessionBlob {
  storageUrl: string;
}
export interface AiContentUploadSessionBlobVerificationOptions extends AiContentBlobVerificationOptions {
  abortSignal: AbortSignal;
}

export async function issueAiContentAttachmentToken(input: { brandId: string; generationId: string; attachment: AttachmentUploadTokenInput }, options: AiContentTokenOptions): Promise<AiContentAttachmentTokenResult> {
  return issueValidatedAiContentAttachmentToken({
    ...input,
    attachment: validateAiContentAttachment(input.attachment),
  }, options);
}

export async function issueValidatedAiContentAttachmentToken(input: { brandId: string; generationId: string; attachment: AiContentAttachmentPolicy }, options: AiContentTokenOptions): Promise<AiContentAttachmentTokenResult> {
  if (!options.token.trim()) fail("ai_content_attachment_storage_not_configured");
  const attachment = input.attachment;
  const pathname = buildAiContentAttachmentPath({ brandId: input.brandId, generationId: input.generationId, checksum: attachment.checksum, fileName: attachment.fileName });
  const generate = options.generateClientToken ?? generateClientTokenFromReadWriteToken;
  const maximumSizeInBytes = AI_CONTENT_ATTACHMENT_POLICY[attachment.role][attachment.mimeType]!;
  const clientToken = await generate({ token: options.token, pathname, allowedContentTypes: [attachment.mimeType], maximumSizeInBytes, addRandomSuffix: false, allowOverwrite: false, validUntil: Date.now() + 10 * 60 * 1000 });
  return { pathname, clientToken };
}

export async function issueAiContentUploadSessionToken(
  session: AiContentUploadSessionTokenInput,
  options: AiContentTokenOptions,
): Promise<AiContentUploadSessionTokenResult> {
  if (!options.token.trim()) fail("ai_content_attachment_storage_not_configured");
  if (!session.storagePath || session.storagePath.trim() !== session.storagePath) {
    fail("ai_content_attachment_path_invalid");
  }
  const mimeType = session.mimeType.trim().toLowerCase();
  if (!mimeType || mimeType !== session.mimeType) fail("ai_content_attachment_mime_invalid");
  if (!Number.isSafeInteger(session.maximumSizeInBytes) || session.maximumSizeInBytes <= 0) {
    fail("ai_content_attachment_size_invalid");
  }
  const sessionExpiresAt = Date.parse(session.tokenExpiresAt);
  const validUntil = sessionExpiresAt - AI_CONTENT_UPLOAD_TOKEN_EXPIRY_BUFFER_MS;
  if (
    !Number.isFinite(sessionExpiresAt)
    || new Date(sessionExpiresAt).toISOString() !== session.tokenExpiresAt
    || validUntil <= 0
    || validUntil >= sessionExpiresAt
    || validUntil <= Date.now()
  ) {
    fail("ai_content_upload_session_expiry_invalid");
  }
  const generate = options.generateClientToken ?? generateClientTokenFromReadWriteToken;
  let clientToken: string;
  try {
    clientToken = await generate({
      token: options.token,
      pathname: session.storagePath,
      allowedContentTypes: [mimeType],
      maximumSizeInBytes: session.maximumSizeInBytes,
      addRandomSuffix: false,
      allowOverwrite: false,
      validUntil,
    });
  } catch {
    fail("ai_content_attachment_storage_unavailable");
  }
  return {
    pathname: session.storagePath,
    clientToken,
    uploadExpiresAt: new Date(validUntil).toISOString(),
  };
}

export interface ConfirmedAiContentAttachment { storagePath: string; storageUrl: string; fileName: string; mimeType: string; sizeBytes: number; checksum: string; role: AiContentAttachmentRole; }
export function confirmAiContentAttachment(input: { brandId: string; generationId: string; attachment: AttachmentUploadTokenInput; storagePath: string; storageUrl: string }): ConfirmedAiContentAttachment {
  const attachment = validateAiContentAttachment(input.attachment);
  const expectedPath = buildAiContentAttachmentPath({ brandId: input.brandId, generationId: input.generationId, checksum: attachment.checksum, fileName: attachment.fileName });
  if (input.storagePath !== expectedPath) fail("ai_content_attachment_path_mismatch");
  let url: URL;
  try { url = new URL(input.storageUrl); } catch { fail("ai_content_attachment_url_invalid"); }
  let decodedPath: string;
  try { decodedPath = decodeURIComponent(url.pathname).replace(/^\//, ""); } catch { fail("ai_content_attachment_url_invalid"); }
  if (
    url.protocol !== "https:"
    || !(url.hostname === "blob.vercel-storage.com" || url.hostname.endsWith(".blob.vercel-storage.com"))
    || decodedPath !== expectedPath
  ) fail("ai_content_attachment_url_mismatch");
  return { ...attachment, storagePath: expectedPath, storageUrl: input.storageUrl };
}

export async function verifyAiContentAttachmentBlob(
  attachment: ConfirmedAiContentAttachment,
  options: AiContentBlobVerificationOptions,
): Promise<ConfirmedAiContentAttachment> {
  if (!options.token.trim()) fail("ai_content_attachment_storage_not_configured");
  let metadata: HeadBlobResult;
  try {
    metadata = await (options.headBlob ?? head)(attachment.storageUrl, { token: options.token });
  } catch {
    fail("ai_content_attachment_blob_unavailable");
  }
  if (metadata.pathname !== attachment.storagePath) fail("ai_content_attachment_path_mismatch");
  if (metadata.size !== attachment.sizeBytes) fail("ai_content_attachment_size_mismatch");
  if (metadata.contentType.toLowerCase() !== attachment.mimeType) fail("ai_content_attachment_mime_mismatch");
  return attachment;
}

function providerStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const source = error as Record<string, unknown>;
  const value = source.status ?? source.statusCode;
  return typeof value === "number" ? value : undefined;
}

function trustedProviderUrl(value: unknown, expectedPath: string): string {
  if (typeof value !== "string" || !value) fail("ai_content_attachment_url_invalid");
  let url: URL;
  try { url = new URL(value); } catch { fail("ai_content_attachment_url_invalid"); }
  let decodedPath: string;
  try { decodedPath = decodeURIComponent(url.pathname).replace(/^\//, ""); }
  catch { fail("ai_content_attachment_url_invalid"); }
  if (
    url.protocol !== "https:"
    || !(url.hostname === "blob.vercel-storage.com" || url.hostname.endsWith(".blob.vercel-storage.com"))
    || url.username
    || url.password
    || url.port
    || url.search
    || url.hash
    || decodedPath !== expectedPath
  ) fail("ai_content_attachment_url_mismatch");
  return value;
}

export async function verifyAiContentUploadSessionBlob(
  session: AiContentUploadSessionBlob,
  options: AiContentUploadSessionBlobVerificationOptions,
): Promise<VerifiedAiContentAttachmentBlob> {
  if (!options.token.trim()) fail("ai_content_attachment_storage_not_configured");
  let metadata: HeadBlobResult;
  try {
    metadata = await (options.headBlob ?? head)(session.storagePath, {
      token: options.token,
      abortSignal: options.abortSignal,
    });
  } catch (error) {
    if (error instanceof BlobNotFoundError
      || providerStatus(error) === 404
      || (error instanceof Error && error.name === "BlobNotFoundError")) {
      fail("ai_content_attachment_blob_unavailable");
    }
    fail("ai_content_attachment_storage_unavailable");
  }
  if (metadata.pathname !== session.storagePath) fail("ai_content_attachment_path_mismatch");
  if (metadata.size !== session.sizeBytes) fail("ai_content_attachment_size_mismatch");
  if (metadata.contentType?.toLowerCase() !== session.mimeType.toLowerCase()) {
    fail("ai_content_attachment_mime_mismatch");
  }
  return {
    storagePath: session.storagePath,
    storageUrl: trustedProviderUrl(metadata.url, session.storagePath),
    mimeType: session.mimeType,
    sizeBytes: session.sizeBytes,
  };
}
