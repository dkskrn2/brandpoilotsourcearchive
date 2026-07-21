import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { head, type HeadBlobResult } from "@vercel/blob";
import type { AttachmentUploadTokenInput, AiContentAttachmentRole } from "./aiContentContracts.js";

export const AI_CONTENT_IMAGE_MAX_BYTES = 5_000_000;
export const AI_CONTENT_DOCUMENT_MAX_BYTES = 10_000_000;
const IMAGE_MIME_LIMITS = new Map([
  ["image/png", AI_CONTENT_IMAGE_MAX_BYTES],
  ["image/jpeg", AI_CONTENT_IMAGE_MAX_BYTES],
]);
const DOCUMENT_MIME_LIMITS = new Map([
  ["application/pdf", AI_CONTENT_DOCUMENT_MAX_BYTES],
  ["text/plain", AI_CONTENT_IMAGE_MAX_BYTES],
  ["text/markdown", AI_CONTENT_IMAGE_MAX_BYTES],
  ["text/csv", AI_CONTENT_IMAGE_MAX_BYTES],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", AI_CONTENT_DOCUMENT_MAX_BYTES],
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const VALID_ROLES = new Set<AiContentAttachmentRole>(["product", "person", "scale", "visual_reference", "document"]);

export interface AiContentAttachmentPolicy {
  role: AiContentAttachmentRole;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
}

function fail(code: string): never { throw new Error(code); }

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
  if (!VALID_ROLES.has(input.role)) fail("ai_content_attachment_role_invalid");
  const mimeType = input.mimeType.trim().toLowerCase();
  const mimeLimits = input.role === "document" ? DOCUMENT_MIME_LIMITS : IMAGE_MIME_LIMITS;
  const maximumSizeInBytes = mimeLimits.get(mimeType);
  if (maximumSizeInBytes === undefined) fail("ai_content_attachment_role_mime_invalid");
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > maximumSizeInBytes) fail("ai_content_attachment_size_invalid");
  if (!SHA256.test(input.checksum.trim())) fail("ai_content_attachment_checksum_invalid");
  return { ...input, fileName: safeFileName(input.fileName), mimeType, checksum: input.checksum.trim().toLowerCase() };
}

export function buildAiContentAttachmentPath(input: { brandId: string; generationId: string; checksum: string; fileName: string }) {
  const brandId = pathSegment(input.brandId, "ai_content_brand_id_invalid");
  const generationId = pathSegment(input.generationId, "ai_content_generation_id_invalid");
  if (!SHA256.test(input.checksum.trim())) fail("ai_content_attachment_checksum_invalid");
  return `brands/${brandId}/ai-content/${generationId}/attachments/${input.checksum.trim().toLowerCase()}-${safeFileName(input.fileName)}`;
}

export interface AiContentAttachmentTokenResult { pathname: string; clientToken: string; }
export interface AiContentTokenOptions { token: string; generateClientToken?: typeof generateClientTokenFromReadWriteToken; }
export interface AiContentBlobVerificationOptions { token: string; headBlob?: typeof head; }

export async function issueAiContentAttachmentToken(input: { brandId: string; generationId: string; attachment: AttachmentUploadTokenInput }, options: AiContentTokenOptions): Promise<AiContentAttachmentTokenResult> {
  if (!options.token.trim()) fail("ai_content_attachment_storage_not_configured");
  const attachment = validateAiContentAttachment(input.attachment);
  const pathname = buildAiContentAttachmentPath({ brandId: input.brandId, generationId: input.generationId, checksum: attachment.checksum, fileName: attachment.fileName });
  const generate = options.generateClientToken ?? generateClientTokenFromReadWriteToken;
  const maximumSizeInBytes = (attachment.role === "document" ? DOCUMENT_MIME_LIMITS : IMAGE_MIME_LIMITS).get(attachment.mimeType)!;
  const clientToken = await generate({ token: options.token, pathname, allowedContentTypes: [attachment.mimeType], maximumSizeInBytes, addRandomSuffix: false, allowOverwrite: false, validUntil: Date.now() + 10 * 60 * 1000 });
  return { pathname, clientToken };
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
