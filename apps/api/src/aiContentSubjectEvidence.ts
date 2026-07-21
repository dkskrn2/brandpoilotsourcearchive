import {
  extractBrandDocument,
  type BrandDocumentInput,
} from "./brandDocumentExtractor.js";
import type { AiContentAttachmentRole } from "./aiContentContracts.js";
import type { BrandEvidenceDocument } from "./brandIntelligenceContracts.js";

export const SUBJECT_EVIDENCE_FETCH_TIMEOUT_MS = 15_000;

const DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg"]);

export interface LoadSubjectEvidenceInput {
  workspaceId: string;
  brandId: string;
  generationId: string;
  attachmentIds: string[];
}

export interface SubjectEvidenceAttachment {
  id: string;
  role: AiContentAttachmentRole;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageUrl: string;
  storagePath: string;
  deletedAt: string | null;
  width?: number | null;
  height?: number | null;
}

export interface SubjectEvidenceFetchLimits {
  timeoutMs: number;
  maxBytes: number;
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
    if (/^[a-z][a-z0-9_]*$/.test(code)) return code;
  }
  return "subject_analysis_attachment_processing_failed";
}

function orderedAttachments(
  attachmentIds: string[],
  attachments: SubjectEvidenceAttachment[],
): SubjectEvidenceAttachment[] {
  return attachmentIds.map((id) => {
    const matches = attachments.filter((attachment) => attachment.id === id);
    if (matches.length !== 1 || matches[0]!.deletedAt !== null) {
      fail("subject_analysis_attachment_not_found");
    }
    return matches[0]!;
  });
}

async function fetchAttachment(
  attachment: SubjectEvidenceAttachment,
  fetchBlob: SubjectEvidenceDependencies["fetchBlob"],
): Promise<Buffer> {
  if (!Number.isSafeInteger(attachment.sizeBytes) || attachment.sizeBytes <= 0) {
    fail("subject_analysis_attachment_size_mismatch");
  }

  let blob: SubjectEvidenceBlob;
  try {
    blob = await fetchBlob(attachment.storageUrl, {
      timeoutMs: SUBJECT_EVIDENCE_FETCH_TIMEOUT_MS,
      maxBytes: attachment.sizeBytes,
    });
  } catch {
    fail("subject_analysis_attachment_fetch_failed");
  }

  if (mimeType(blob.contentType) !== mimeType(attachment.mimeType)) {
    fail("subject_analysis_attachment_mime_mismatch");
  }
  const bytes = Buffer.from(blob.bytes);
  if (blob.contentLength !== attachment.sizeBytes || bytes.length !== attachment.sizeBytes) {
    fail("subject_analysis_attachment_size_mismatch");
  }
  return bytes;
}

export async function loadSubjectEvidence(
  input: LoadSubjectEvidenceInput,
  dependencies: SubjectEvidenceDependencies,
): Promise<SubjectEvidence> {
  if (input.attachmentIds.length === 0) {
    return { documents: [], images: [], sourceGaps: [] };
  }

  const attachments = orderedAttachments(
    input.attachmentIds,
    await dependencies.listAttachments({ ...input, attachmentIds: [...input.attachmentIds] }),
  );
  const documents: BrandEvidenceDocument[] = [];
  const images: SubjectEvidenceImage[] = [];
  const sourceGaps: string[] = [];
  const extractDocument = dependencies.extractDocument ?? extractBrandDocument;

  for (const attachment of attachments) {
    try {
      const storedMimeType = mimeType(attachment.mimeType);
      const isDocument = attachment.role === "document" && DOCUMENT_MIME_TYPES.has(storedMimeType);
      const isImage = attachment.role !== "document" && IMAGE_MIME_TYPES.has(storedMimeType);
      if (!isDocument && !isImage) fail("subject_analysis_attachment_mime_unsupported");

      const bytes = await fetchAttachment(attachment, dependencies.fetchBlob);
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
