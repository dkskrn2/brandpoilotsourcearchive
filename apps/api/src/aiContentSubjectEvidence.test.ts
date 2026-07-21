import { describe, expect, it, vi } from "vitest";
import type { BrandEvidenceDocument, BrandEvidenceSourceType } from "./brandIntelligenceContracts.js";
import {
  SUBJECT_EVIDENCE_FETCH_TIMEOUT_MS,
  loadSubjectEvidence,
  type SubjectEvidenceAttachment,
  type SubjectEvidenceFetchLimits,
} from "./aiContentSubjectEvidence.js";

const scope = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  brandId: "22222222-2222-4222-8222-222222222222",
  generationId: "33333333-3333-4333-8333-333333333333",
};

const attachmentIds = {
  first: "44444444-4444-4444-8444-444444444444",
  second: "55555555-5555-4555-8555-555555555555",
  third: "66666666-6666-4666-8666-666666666666",
};

function attachment(
  overrides: Partial<SubjectEvidenceAttachment> = {},
): SubjectEvidenceAttachment {
  return {
    id: attachmentIds.first,
    role: "document",
    fileName: "facts.txt",
    mimeType: "text/plain",
    sizeBytes: 5,
    storageUrl: "https://blob.example.com/facts.txt",
    storagePath: "attachments/facts.txt",
    deletedAt: null,
    ...overrides,
  };
}

function extractedDocument(
  sourceId: string,
  fileName: string,
  sourceType: BrandEvidenceSourceType = "text",
): BrandEvidenceDocument {
  return {
    sourceId,
    sourceType,
    title: fileName,
    sourceUrl: `attachment://${sourceId}`,
    textBlocks: [{ heading: null, text: `Extracted ${fileName}` }],
    tables: [],
    contentHash: sourceId.replaceAll("-", ""),
  };
}

describe("generation-scoped subject evidence", () => {
  it("returns empty evidence without listing attachments or fetching blobs", async () => {
    const listAttachments = vi.fn();
    const fetchBlob = vi.fn();

    await expect(loadSubjectEvidence(
      { ...scope, attachmentIds: [] },
      { listAttachments, fetchBlob },
    )).resolves.toEqual({ documents: [], images: [], sourceGaps: [] });

    expect(listAttachments).not.toHaveBeenCalled();
    expect(fetchBlob).not.toHaveBeenCalled();
  });

  it("requires every requested ID to resolve as non-deleted in the exact scope", async () => {
    const listAttachments = vi.fn(async () => [
      attachment(),
      attachment({
        id: attachmentIds.second,
        fileName: "deleted.txt",
        storageUrl: "https://blob.example.com/deleted.txt",
        deletedAt: "2026-07-21T00:00:00.000Z",
      }),
    ]);
    const fetchBlob = vi.fn();

    await expect(loadSubjectEvidence(
      { ...scope, attachmentIds: [attachmentIds.first, attachmentIds.second, attachmentIds.third] },
      { listAttachments, fetchBlob },
    )).rejects.toThrow("subject_analysis_attachment_not_found");

    expect(listAttachments).toHaveBeenCalledWith({
      ...scope,
      attachmentIds: [attachmentIds.first, attachmentIds.second, attachmentIds.third],
    });
    expect(fetchBlob).not.toHaveBeenCalled();
  });

  it.each([
    ["facts.txt", "text/plain", "text", Buffer.from("facts")],
    ["brief.md", "text/markdown", "markdown", Buffer.from("# Brief")],
    ["products.csv", "text/csv", "csv", Buffer.from("name\nProduct")],
  ] as const)("normalizes supported %s documents through Task 2A", async (
    fileName,
    mimeType,
    sourceType,
    bytes,
  ) => {
    const row = attachment({ fileName, mimeType, sizeBytes: bytes.length });

    const result = await loadSubjectEvidence(
      { ...scope, attachmentIds: [row.id] },
      {
        listAttachments: async () => [row],
        fetchBlob: async () => ({ bytes, contentType: mimeType, contentLength: bytes.length }),
      },
    );

    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({
      sourceId: row.id,
      sourceType,
      title: fileName,
      sourceUrl: `attachment://${row.id}`,
    });
    expect(result.sourceGaps).toEqual([]);
  });

  it.each([
    ["catalog.pdf", "application/pdf", "pdf"],
    ["catalog.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ] as const)("passes supported binary document %s to the injected extractor", async (
    fileName,
    mimeType,
    sourceType,
  ) => {
    const bytes = Buffer.from("binary");
    const row = attachment({ fileName, mimeType, sizeBytes: bytes.length });
    const extractDocument = vi.fn(async (input) => extractedDocument(
      input.sourceId,
      input.fileName,
      sourceType,
    ));

    const result = await loadSubjectEvidence(
      { ...scope, attachmentIds: [row.id] },
      {
        listAttachments: async () => [row],
        fetchBlob: async () => ({ bytes, contentType: mimeType, contentLength: bytes.length }),
        extractDocument,
      },
    );

    expect(extractDocument).toHaveBeenCalledWith({
      sourceId: row.id,
      fileName,
      mimeType,
      bytes,
      sourceUrl: `attachment://${row.id}`,
    });
    expect(result.documents).toEqual([extractedDocument(row.id, fileName, sourceType)]);
  });

  it("returns an image candidate with attachment-stable identity and stored metadata", async () => {
    const bytes = Buffer.from("image");
    const row = attachment({
      role: "product",
      fileName: "product.png",
      mimeType: "image/png",
      sizeBytes: bytes.length,
      storageUrl: "https://blob.example.com/product.png",
      storagePath: "attachments/product.png",
      width: 1200,
      height: 800,
    });
    const fetchBlob = vi.fn(async () => ({
      bytes,
      contentType: "image/png",
      contentLength: bytes.length,
    }));

    const result = await loadSubjectEvidence(
      { ...scope, attachmentIds: [row.id] },
      { listAttachments: async () => [row], fetchBlob },
    );

    expect(fetchBlob).toHaveBeenCalledWith(row.storageUrl, {
      timeoutMs: SUBJECT_EVIDENCE_FETCH_TIMEOUT_MS,
      maxBytes: row.sizeBytes,
    });
    expect(result).toEqual({
      documents: [],
      images: [{
        id: row.id,
        sourceUrl: `attachment://${row.id}`,
        storageUrl: row.storageUrl,
        storagePath: row.storagePath,
        width: 1200,
        height: 800,
        mimeType: "image/png",
        altText: "product.png",
        role: "product",
      }],
      sourceGaps: [],
    });
  });

  it("uses unknown role and null dimensions for non-product image evidence", async () => {
    const bytes = Buffer.from("image");
    const row = attachment({
      role: "visual_reference",
      fileName: "reference.jpg",
      mimeType: "image/jpeg",
      sizeBytes: bytes.length,
      storageUrl: "https://blob.example.com/reference.jpg",
      storagePath: "attachments/reference.jpg",
    });

    const result = await loadSubjectEvidence(
      { ...scope, attachmentIds: [row.id] },
      {
        listAttachments: async () => [row],
        fetchBlob: async () => ({ bytes, contentType: row.mimeType, contentLength: bytes.length }),
      },
    );

    expect(result.images[0]).toMatchObject({ role: "unknown", width: null, height: null });
  });

  it("keeps successful evidence and records a normalized per-file gap", async () => {
    const first = attachment({ sizeBytes: 5 });
    const second = attachment({
      id: attachmentIds.second,
      fileName: "broken.pdf",
      mimeType: "application/pdf",
      sizeBytes: 6,
      storageUrl: "https://blob.example.com/broken.pdf",
      storagePath: "attachments/broken.pdf",
    });
    const third = attachment({
      id: attachmentIds.third,
      role: "person",
      fileName: "person.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 5,
      storageUrl: "https://blob.example.com/person.jpg",
      storagePath: "attachments/person.jpg",
    });
    const extractDocument = vi.fn(async (input) => extractedDocument(input.sourceId, input.fileName));
    const fetchBlob = vi.fn(async (url: string, _limits: SubjectEvidenceFetchLimits) => {
      if (url === second.storageUrl) throw new Error("socket details must not escape");
      const bytes = Buffer.from("12345");
      return { bytes, contentType: url === third.storageUrl ? "image/jpeg" : "text/plain", contentLength: 5 };
    });

    const result = await loadSubjectEvidence(
      { ...scope, attachmentIds: [first.id, second.id, third.id] },
      { listAttachments: async () => [third, first, second], fetchBlob, extractDocument },
    );

    expect(result.documents.map(({ sourceId }) => sourceId)).toEqual([first.id]);
    expect(result.images.map(({ id }) => id)).toEqual([third.id]);
    expect(result.sourceGaps).toEqual([
      "broken.pdf: subject_analysis_attachment_fetch_failed",
    ]);
  });

  it("returns ordered source gaps when every owned file fails", async () => {
    const first = attachment({ fileName: "first.txt" });
    const second = attachment({
      id: attachmentIds.second,
      fileName: "second.pdf",
      mimeType: "application/pdf",
      storageUrl: "https://blob.example.com/second.pdf",
      storagePath: "attachments/second.pdf",
    });

    const result = await loadSubjectEvidence(
      { ...scope, attachmentIds: [first.id, second.id] },
      {
        listAttachments: async () => [second, first],
        fetchBlob: async () => { throw new Error("offline"); },
      },
    );

    expect(result).toEqual({
      documents: [],
      images: [],
      sourceGaps: [
        "first.txt: subject_analysis_attachment_fetch_failed",
        "second.pdf: subject_analysis_attachment_fetch_failed",
      ],
    });
  });

  it("records response MIME and length mismatches as ordered per-file failures", async () => {
    const mimeMismatch = attachment({ fileName: "wrong-mime.txt", sizeBytes: 5 });
    const headerMismatch = attachment({
      id: attachmentIds.second,
      fileName: "wrong-header.txt",
      sizeBytes: 5,
      storageUrl: "https://blob.example.com/wrong-header.txt",
      storagePath: "attachments/wrong-header.txt",
    });
    const bodyMismatch = attachment({
      id: attachmentIds.third,
      fileName: "wrong-body.txt",
      sizeBytes: 5,
      storageUrl: "https://blob.example.com/wrong-body.txt",
      storagePath: "attachments/wrong-body.txt",
    });
    const fetchBlob = vi.fn(async (url: string, _limits: SubjectEvidenceFetchLimits) => {
      if (url === mimeMismatch.storageUrl) {
        return { bytes: Buffer.from("12345"), contentType: "application/pdf", contentLength: 5 };
      }
      if (url === headerMismatch.storageUrl) {
        return { bytes: Buffer.from("12345"), contentType: "text/plain", contentLength: 4 };
      }
      return { bytes: Buffer.from("1234"), contentType: "text/plain", contentLength: 5 };
    });

    const result = await loadSubjectEvidence(
      { ...scope, attachmentIds: [mimeMismatch.id, headerMismatch.id, bodyMismatch.id] },
      { listAttachments: async () => [bodyMismatch, mimeMismatch, headerMismatch], fetchBlob },
    );

    expect(fetchBlob.mock.calls.map(([, limits]) => limits)).toEqual([
      { timeoutMs: SUBJECT_EVIDENCE_FETCH_TIMEOUT_MS, maxBytes: 5 },
      { timeoutMs: SUBJECT_EVIDENCE_FETCH_TIMEOUT_MS, maxBytes: 5 },
      { timeoutMs: SUBJECT_EVIDENCE_FETCH_TIMEOUT_MS, maxBytes: 5 },
    ]);
    expect(result.sourceGaps).toEqual([
      "wrong-mime.txt: subject_analysis_attachment_mime_mismatch",
      "wrong-header.txt: subject_analysis_attachment_size_mismatch",
      "wrong-body.txt: subject_analysis_attachment_size_mismatch",
    ]);
  });
});
