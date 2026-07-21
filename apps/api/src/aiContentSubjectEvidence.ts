import { createHash } from "node:crypto";
import {
  extractBrandDocument,
  type BrandDocumentInput,
} from "./brandDocumentExtractor.js";
import type { AiContentAttachmentRole } from "./aiContentContracts.js";
import { AI_CONTENT_ATTACHMENT_POLICY } from "./aiContentUpload.js";
import type { BrandEvidenceDocument } from "./brandIntelligenceContracts.js";

export const SUBJECT_EVIDENCE_FETCH_TIMEOUT_MS = 15_000;
export const SUBJECT_EVIDENCE_OPERATION_TIMEOUT_MS = 30_000;
export const SUBJECT_EVIDENCE_MAX_ATTACHMENTS = 10;
export const SUBJECT_EVIDENCE_MAX_TOTAL_BYTES = 50_000_000;

const SHA256 = /^[0-9a-f]{64}$/i;
const TEXT_MIME_TYPES = new Set(["text/plain", "text/markdown", "text/csv"]);
const SOURCE_GAP_CODES = new Set([
  "subject_analysis_attachment_fetch_failed",
  "subject_analysis_attachment_mime_mismatch",
  "subject_analysis_attachment_size_mismatch",
  "subject_analysis_attachment_checksum_mismatch",
  "subject_analysis_attachment_content_invalid",
  "subject_analysis_attachment_mime_unsupported",
  "brand_document_content_limit_exceeded",
  "brand_document_csv_invalid",
  "brand_document_empty",
  "brand_document_table_limit_exceeded",
  "brand_analysis_file_type_unsupported",
  "scanned_pdf_not_supported",
]);

export interface LoadSubjectEvidenceInput {
  workspaceId: string;
  brandId: string;
  generationId: string;
  attachmentIds: string[];
}

export interface SubjectEvidenceAttachment {
  id: string;
  workspaceId: string;
  brandId: string;
  generationId: string;
  role: AiContentAttachmentRole;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageUrl: string;
  storagePath: string;
  deletedAt: string | null;
  checksum: string;
  width?: number | null;
  height?: number | null;
}

export interface SubjectEvidenceFetchLimits {
  timeoutMs: number;
  maxBytes: number;
  signal: AbortSignal;
}

export interface SubjectEvidenceBlob {
  bytes: Buffer | Uint8Array;
  contentType: string;
  contentLength: number;
}

export interface SubjectEvidenceImage {
  id: string;
  sourceUrl: string;
  storageUrl: string;
  storagePath: string;
  width: number | null;
  height: number | null;
  mimeType: string;
  altText: string;
  role: "product" | "unknown";
}

export interface SubjectEvidence {
  documents: BrandEvidenceDocument[];
  images: SubjectEvidenceImage[];
  sourceGaps: string[];
}

export interface SubjectEvidenceDependencies {
  listAttachments(input: LoadSubjectEvidenceInput): Promise<SubjectEvidenceAttachment[]>;
  fetchBlob(url: string, limits: SubjectEvidenceFetchLimits): Promise<SubjectEvidenceBlob>;
  extractDocument?: (input: BrandDocumentInput) => Promise<BrandEvidenceDocument>;
}

function fail(code: string): never {
  throw new Error(code);
}

function mimeType(value: string): string {
  return value.split(";", 1)[0]!.trim().toLowerCase();
}

function dimension(value: number | null | undefined): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function failureCode(error: unknown): string {
  if (error instanceof Error) {
    const code = error.message.split(":", 1)[0]!.trim();
    if (SOURCE_GAP_CODES.has(code)) return code;
  }
  return "subject_attachment_read_failed";
}

function orderedAttachments(
  input: LoadSubjectEvidenceInput,
  attachments: SubjectEvidenceAttachment[],
): SubjectEvidenceAttachment[] {
  const requestedIds = new Set(input.attachmentIds);
  const byId = new Map<string, SubjectEvidenceAttachment>();
  for (const attachment of attachments) {
    if (
      !requestedIds.has(attachment.id)
      || byId.has(attachment.id)
      || attachment.workspaceId !== input.workspaceId
      || attachment.brandId !== input.brandId
      || attachment.generationId !== input.generationId
      || attachment.deletedAt !== null
      || !SHA256.test(attachment.checksum)
    ) {
      fail("subject_analysis_attachment_not_found");
    }
    byId.set(attachment.id, attachment);
  }
  if (byId.size !== requestedIds.size) fail("subject_analysis_attachment_not_found");
  return input.attachmentIds.map((id) => byId.get(id)!);
}

function validateStoredByteBudget(attachments: SubjectEvidenceAttachment[]): void {
  let totalBytes = 0;
  for (const attachment of attachments) {
    if (!Number.isSafeInteger(attachment.sizeBytes) || attachment.sizeBytes <= 0) {
      fail("subject_analysis_attachment_size_mismatch");
    }
    totalBytes += attachment.sizeBytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > SUBJECT_EVIDENCE_MAX_TOTAL_BYTES) {
      fail("subject_analysis_attachment_total_size_exceeded");
    }
  }
}

function validateContentBytes(storedMimeType: string, bytes: Buffer): void {
  const matches = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  let valid = true;
  if (storedMimeType === "image/png") valid = matches(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  else if (storedMimeType === "image/jpeg") valid = matches(0xff, 0xd8, 0xff);
  else if (storedMimeType === "application/pdf") valid = matches(0x25, 0x50, 0x44, 0x46, 0x2d);
  else if (storedMimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    valid = matches(0x50, 0x4b, 0x03, 0x04);
  } else if (TEXT_MIME_TYPES.has(storedMimeType)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      valid = !bytes.includes(0);
    } catch {
      valid = false;
    }
  }
  if (!valid) fail("subject_analysis_attachment_content_invalid");
}

async function fetchAttachment(
  attachment: SubjectEvidenceAttachment,
  fetchBlob: SubjectEvidenceDependencies["fetchBlob"],
  operationSignal: AbortSignal,
  operationDeadline: number,
): Promise<Buffer> {
  const storedMimeType = mimeType(attachment.mimeType);
  const maximumSize = AI_CONTENT_ATTACHMENT_POLICY[attachment.role]?.[storedMimeType];
  if (maximumSize === undefined) fail("subject_analysis_attachment_mime_unsupported");
  if (attachment.sizeBytes > maximumSize) {
    fail("subject_analysis_attachment_size_mismatch");
  }

  let blob: SubjectEvidenceBlob;
  const controller = new AbortController();
  const timeoutMs = Math.min(
    SUBJECT_EVIDENCE_FETCH_TIMEOUT_MS,
    Math.max(0, operationDeadline - Date.now()),
  );
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectDeadline: ((error: Error) => void) | undefined;
  const abortFetch = () => {
    controller.abort();
    rejectDeadline?.(new Error("subject_analysis_attachment_fetch_failed"));
  };
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
    operationSignal.addEventListener("abort", abortFetch, { once: true });
    timeout = setTimeout(abortFetch, timeoutMs);
  });
  try {
    blob = await Promise.race([
      fetchBlob(attachment.storageUrl, {
        timeoutMs,
        maxBytes: attachment.sizeBytes,
        signal: controller.signal,
      }),
      deadline,
    ]);
  } catch {
    fail("subject_analysis_attachment_fetch_failed");
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    operationSignal.removeEventListener("abort", abortFetch);
  }

  if (mimeType(blob.contentType) !== storedMimeType) {
    fail("subject_analysis_attachment_mime_mismatch");
  }
  const bytes = Buffer.from(blob.bytes);
  if (blob.contentLength !== attachment.sizeBytes || bytes.length !== attachment.sizeBytes) {
    fail("subject_analysis_attachment_size_mismatch");
  }
  if (createHash("sha256").update(bytes).digest("hex") !== attachment.checksum.toLowerCase()) {
    fail("subject_analysis_attachment_checksum_mismatch");
  }
  validateContentBytes(storedMimeType, bytes);
  return bytes;
}

async function loadSubjectEvidenceWithinDeadline(
  input: LoadSubjectEvidenceInput,
  dependencies: SubjectEvidenceDependencies,
  operationSignal: AbortSignal,
  operationDeadline: number,
): Promise<SubjectEvidence> {
  const attachments = orderedAttachments(
    input,
    await dependencies.listAttachments({ ...input, attachmentIds: [...input.attachmentIds] }),
  );
  validateStoredByteBudget(attachments);
  const documents: BrandEvidenceDocument[] = [];
  const images: SubjectEvidenceImage[] = [];
  const sourceGaps: string[] = [];
  const extractDocument = dependencies.extractDocument ?? extractBrandDocument;

  for (const attachment of attachments) {
    try {
      const storedMimeType = mimeType(attachment.mimeType);
      const maximumSize = AI_CONTENT_ATTACHMENT_POLICY[attachment.role]?.[storedMimeType];
      const isDocument = attachment.role === "document" && maximumSize !== undefined;
      const isImage = attachment.role !== "document" && maximumSize !== undefined;
      if (!isDocument && !isImage) fail("subject_analysis_attachment_mime_unsupported");

      const bytes = await fetchAttachment(
        attachment,
        dependencies.fetchBlob,
        operationSignal,
        operationDeadline,
      );
      const sourceUrl = `attachment://${attachment.id}`;
      if (isDocument) {
        documents.push(await extractDocument({
          sourceId: attachment.id,
          fileName: attachment.fileName,
          mimeType: storedMimeType,
          bytes,
          sourceUrl,
        }));
      } else {
        images.push({
          id: attachment.id,
          sourceUrl,
          storageUrl: attachment.storageUrl,
          storagePath: attachment.storagePath,
          width: dimension(attachment.width),
          height: dimension(attachment.height),
          mimeType: storedMimeType,
          altText: attachment.fileName,
          role: attachment.role === "product" ? "product" : "unknown",
        });
      }
    } catch (error) {
      sourceGaps.push(`${attachment.fileName}: ${failureCode(error)}`);
    }
  }

  return { documents, images, sourceGaps };
}

export async function loadSubjectEvidence(
  input: LoadSubjectEvidenceInput,
  dependencies: SubjectEvidenceDependencies,
): Promise<SubjectEvidence> {
  if (
    input.attachmentIds.length > SUBJECT_EVIDENCE_MAX_ATTACHMENTS
    || new Set(input.attachmentIds).size !== input.attachmentIds.length
  ) {
    fail("subject_analysis_attachment_ids_invalid");
  }
  if (input.attachmentIds.length === 0) {
    return { documents: [], images: [], sourceGaps: [] };
  }

  const controller = new AbortController();
  const operationDeadline = Date.now() + SUBJECT_EVIDENCE_OPERATION_TIMEOUT_MS;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("subject_attachment_read_failed"));
    }, SUBJECT_EVIDENCE_OPERATION_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      loadSubjectEvidenceWithinDeadline(input, dependencies, controller.signal, operationDeadline),
      deadline,
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
