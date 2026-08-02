import { createHash } from "node:crypto";
import type { GeneratedImageMimeTypeV2, OwnedImageSnapshotV2 } from "./aiContentContracts.js";

export const AI_CONTENT_SNAPSHOT_MAX_BYTES = 5 * 1024 * 1024;

const MIME_EXTENSIONS: Record<GeneratedImageMimeTypeV2, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

export interface AiContentSnapshotStoredObject {
  storageUrl: string;
  storagePath: string;
  sizeBytes?: number;
}

export interface AiContentSnapshotStorage {
  stat(storagePath: string): Promise<AiContentSnapshotStoredObject | null>;
  read(
    storagePath: string,
    options: { maxBytes: number },
  ): Promise<Uint8Array | AsyncIterable<Uint8Array>>;
  put(
    storagePath: string,
    bytes: Uint8Array,
    options: { contentType: GeneratedImageMimeTypeV2; ifNoneMatch: true },
  ): Promise<AiContentSnapshotStoredObject>;
}

export interface FreezeOwnedImageInput {
  brandId: string;
  sourceStoragePath: string;
  mimeType: string;
  expectedChecksum?: string | null;
}

export interface AiContentSnapshotBlob {
  freezeOwnedImage(
    input: FreezeOwnedImageInput,
  ): Promise<OwnedImageSnapshotV2 & { mimeType: GeneratedImageMimeTypeV2 }>;
}

function unavailable(): never {
  throw new Error("RESOURCE_NOT_AVAILABLE");
}

function ownedPath(value: string): string {
  const path = value.trim();
  if (
    !path
    || /^https?:\/\//i.test(path)
    || /^[a-z][a-z0-9+.-]*:\/\//i.test(path)
    || path.startsWith("/")
    || path.includes("\\")
    || path.split("/").some((part) => part === ".." || part === "." || !part)
  ) unavailable();
  return path;
}

function mime(value: string): GeneratedImageMimeTypeV2 {
  const normalized = value.trim().toLowerCase() as GeneratedImageMimeTypeV2;
  if (!(normalized in MIME_EXTENSIONS)) unavailable();
  return normalized;
}

function expectedChecksum(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (!SHA256.test(normalized)) unavailable();
  return normalized;
}

async function boundedBytes(
  source: Uint8Array | AsyncIterable<Uint8Array>,
): Promise<Buffer> {
  if (source instanceof Uint8Array) {
    if (source.byteLength > AI_CONTENT_SNAPSHOT_MAX_BYTES) unavailable();
    return Buffer.from(source);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of source) {
    if (!(chunk instanceof Uint8Array)) unavailable();
    size += chunk.byteLength;
    if (size > AI_CONTENT_SNAPSHOT_MAX_BYTES) unavailable();
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, size);
}

function validateStoredObject(
  value: AiContentSnapshotStoredObject,
  destination: string,
): AiContentSnapshotStoredObject {
  if (value.storagePath !== destination) unavailable();
  try {
    const url = new URL(value.storageUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") unavailable();
    const urlPath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (urlPath !== destination) unavailable();
  } catch {
    unavailable();
  }
  return value;
}

export function createAiContentSnapshotBlob(
  storage: AiContentSnapshotStorage,
): AiContentSnapshotBlob {
  return {
    async freezeOwnedImage(input) {
      try {
        const brandId = input.brandId.trim().toLowerCase();
        if (!UUID.test(brandId)) unavailable();
        const sourceStoragePath = ownedPath(input.sourceStoragePath);
        const mimeType = mime(input.mimeType);
        const declaredChecksum = expectedChecksum(input.expectedChecksum);

        const sourceMetadata = await storage.stat(sourceStoragePath);
        if (
          sourceMetadata?.sizeBytes !== undefined
          && (!Number.isSafeInteger(sourceMetadata.sizeBytes)
            || sourceMetadata.sizeBytes < 0
            || sourceMetadata.sizeBytes > AI_CONTENT_SNAPSHOT_MAX_BYTES)
        ) unavailable();

        const bytes = await boundedBytes(await storage.read(sourceStoragePath, {
          maxBytes: AI_CONTENT_SNAPSHOT_MAX_BYTES,
        }));
        const checksum = createHash("sha256").update(bytes).digest("hex");
        if (declaredChecksum !== null && declaredChecksum !== checksum) unavailable();

        const destination = `ai-content/snapshots/${brandId}/${checksum}.${MIME_EXTENSIONS[mimeType]}`;
        const existing = await storage.stat(destination);
        let stored: AiContentSnapshotStoredObject;
        if (existing) {
          stored = validateStoredObject(existing, destination);
        } else {
          try {
            stored = validateStoredObject(await storage.put(destination, bytes, {
              contentType: mimeType,
              ifNoneMatch: true,
            }), destination);
          } catch (error) {
            if (error instanceof Error && error.message === "RESOURCE_NOT_AVAILABLE") throw error;
            const raced = await storage.stat(destination);
            if (!raced) unavailable();
            stored = validateStoredObject(raced, destination);
          }
        }
        return {
          storageUrl: stored.storageUrl,
          storagePath: destination,
          mimeType,
          checksum,
        };
      } catch (error) {
        if (error instanceof Error && error.message === "RESOURCE_NOT_AVAILABLE") throw error;
        unavailable();
      }
    },
  };
}
