import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrandEvidenceDocument, BrandEvidenceSourceType } from "./brandIntelligenceContracts.js";
import { AI_CONTENT_ATTACHMENT_POLICY } from "./aiContentUpload.js";
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

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PDF_BYTES = Buffer.from("%PDF-1.7\n");
const XLSX_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

function checksum(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function attachment(
  overrides: Partial<SubjectEvidenceAttachment> = {},
  bytes: Buffer | Uint8Array = Buffer.from("facts"),
): SubjectEvidenceAttachment {
  return {
    id: attachmentIds.first,
    workspaceId: scope.workspaceId,
    brandId: scope.brandId,
    generationId: scope.generationId,
    role: "document",
    fileName: "facts.txt",
    mimeType: "text/plain",
    sizeBytes: 5,
    storageUrl: "https://blob.example.com/facts.txt",
    storagePath: "attachments/facts.txt",
    deletedAt: null,
    checksum: checksum(bytes),
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
  afterEach(() => {
    vi.useRealTimers();
  });

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
    [[attachmentIds.first, attachmentIds.first], "duplicate"],
    [[...Array.from({ length: 10 }, (_, index) => `${index}`), attachmentIds.first], "more than ten"],
  ] as const)("rejects %s attachment IDs before listing (%s)", async (ids, _case) => {
    const listAttachments = vi.fn();
    const fetchBlob = vi.fn();

    await expect(loadSubjectEvidence(
      { ...scope, attachmentIds: [...ids] },
      { listAttachments, fetchBlob },
    )).rejects.toThrow("subject_analysis_attachment_ids_invalid");

    expect(listAttachments).not.toHaveBeenCalled();
    expect(fetchBlob).not.toHaveBeenCalled();
  });

  it.each([
    ["cross-workspace", { workspaceId: "99999999-9999-4999-8999-999999999999" }],
    ["cross-brand", { brandId: "99999999-9999-4999-8999-999999999999" }],
    ["cross-generation", { generationId: "99999999-9999-4999-8999-999999999999" }],
    ["deleted", { deletedAt: "2026-07-21T00:00:00.000Z" }],
  ] as const)("rejects a returned %s attachment row generically", async (_case, overrides) => {
    const fetchBlob = vi.fn();

    await expect(loadSubjectEvidence(
      { ...scope, attachmentIds: [attachmentIds.first] },
      { listAttachments: async () => [attachment(overrides)], fetchBlob },
    )).rejects.toThrow("subject_analysis_attachment_not_found");

    expect(fetchBlob).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", []],
    ["duplicate", [attachment(), attachment()]],
    ["unrequested", [attachment(), attachment({ id: attachmentIds.second })]],
  ] as const)("rejects %s returned rows generically", async (_case, rows) => {
    const fetchBlob = vi.fn();

    await expect(loadSubjectEvidence(
      { ...scope, attachmentIds: [attachmentIds.first] },
      { listAttachments: async () => [...rows], fetchBlob },
    )).rejects.toThrow("subject_analysis_attachment_not_found");

    expect(fetchBlob).not.toHaveBeenCalled();
  });

  it("rejects an aggregate stored size over 50 MB before fetching", async () => {
    const rows = Array.from({ length: 6 }, (_, index) => attachment({
      id: `${index}`,
      fileName: `${index}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 9_000_000,
      storageUrl: `https://blob.example.com/${index}.pdf`,
      storagePath: `attachments/${index}.pdf`,
    }, PDF_BYTES));
    const fetchBlob = vi.fn();

    await expect(loadSubjectEvidence(
      { ...scope, attachmentIds: rows.map(({ id }) => id) },
      { listAttachments: async () => rows, fetchBlob },
    )).rejects.toThrow("subject_analysis_attachment_total_size_exceeded");

    expect(fetchBlob).not.toHaveBeenCalled();
  });

  it("reuses the upload policy to reject an oversized stored attachment before fetching", async () => {
    const row = attachment({
      sizeBytes: AI_CONTENT_ATTACHMENT_POLICY.document["text/plain"] + 1,
    });
    const fetchBlob = vi.fn();

    const result = await loadSubjectEvidence(
      { ...scope, attachmentIds: [row.id] },
      { listAttachments: async () => [row], fetchBlob },
    );

    expect(fetchBlob).not.toHaveBeenCalled();
    expect(result.sourceGaps).toEqual([
      "facts.txt: subject_analysis_attachment_size_mismatch",
    ]);
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
    const row = attachment({ fileName, mimeType, sizeBytes: bytes.length }, bytes);

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
    const bytes = mimeType === "application/pdf" ? PDF_BYTES : XLSX_BYTES;
    const row = attachment({ fileName, mimeType, sizeBytes: bytes.length }, bytes);
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
    const bytes = PNG_BYTES;
    const row = attachment({
      role: "product",
      fileName: "product.png",
      mimeType: "image/png",
      sizeBytes: bytes.length,
      storageUrl: "https://blob.example.com/product.png",
      storagePath: "attachments/product.png",
      width: 1200,
      height: 800,
    }, bytes);
    const fetchBlob = vi.fn(async (_url: string, _limits: SubjectEvidenceFetchLimits) => ({
      bytes,
      contentType: "image/png",
      contentLength: bytes.length,
    }));

    const result = await loadSubjectEvidence(
      { ...scope, attachmentIds: [row.id] },
      { listAttachments: async () => [row], fetchBlob },
    );

    expect(fetchBlob).toHaveBeenCalledWith(row.storageUrl, expect.objectContaining({
      maxBytes: row.sizeBytes,
      signal: expect.any(AbortSignal),
    }));
    const fetchLimits = fetchBlob.mock.calls[0]![1];
    expect(fetchLimits.timeoutMs).toBeGreaterThan(0);
    expect(fetchLimits.timeoutMs).toBeLessThanOrEqual(SUBJECT_EVIDENCE_FETCH_TIMEOUT_MS);
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
    const bytes = JPEG_BYTES;
    const row = attachment({
      role: "visual_reference",
      fileName: "reference.jpg",
      mimeType: "image/jpeg",
      sizeBytes: bytes.length,
      storageUrl: "https://blob.example.com/reference.jpg",
      storagePath: "attachments/reference.jpg",
    }, bytes);

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
    const validBytes = Buffer.from("12345");
    const first = attachment({ sizeBytes: validBytes.length }, validBytes);
    const second = attachment({
      id: attachmentIds.second,
      fileName: "broken.pdf",
      mimeType: "application/pdf",
      sizeBytes: PDF_BYTES.length,
      storageUrl: "https://blob.example.com/broken.pdf",
      storagePath: "attachments/broken.pdf",
    }, PDF_BYTES);
    const third = attachment({
      id: attachmentIds.third,
      role: "person",
      fileName: "person.jpg",
      mimeType: "image/jpeg",
      sizeBytes: JPEG_BYTES.length,
      storageUrl: "https://blob.example.com/person.jpg",
      storagePath: "attachments/person.jpg",
    }, JPEG_BYTES);
    const extractDocument = vi.fn(async (input) => extractedDocument(input.sourceId, input.fileName));
    const fetchBlob = vi.fn(async (url: string, _limits: SubjectEvidenceFetchLimits) => {
      if (url === second.storageUrl) throw new Error("socket details must not escape");
      const bytes = url === third.storageUrl ? JPEG_BYTES : validBytes;
      return { bytes, contentType: url === third.storageUrl ? "image/jpeg" : "text/plain", contentLength: bytes.length };
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

  it("aborts a stalled fetch at the local per-file deadline and clears timers", async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    const fetchBlob = vi.fn((_url: string, limits: SubjectEvidenceFetchLimits) => {
      observedSignal = limits.signal;
      return new Promise<never>((_resolve, reject) => {
        limits.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    });
    const pending = loadSubjectEvidence(
      { ...scope, attachmentIds: [attachmentIds.first] },
      { listAttachments: async () => [attachment()], fetchBlob },
    );

    await vi.advanceTimersByTimeAsync(SUBJECT_EVIDENCE_FETCH_TIMEOUT_MS);

    await expect(pending).resolves.toMatchObject({
      sourceGaps: ["facts.txt: subject_analysis_attachment_fetch_failed"],
    });
    expect(observedSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects downloaded bytes whose SHA-256 does not match the stored checksum", async () => {
    const row = attachment({ checksum: "f".repeat(64) });

    const result = await loadSubjectEvidence(
      { ...scope, attachmentIds: [row.id] },
      {
        listAttachments: async () => [row],
        fetchBlob: async () => ({ bytes: Buffer.from("facts"), contentType: row.mimeType, contentLength: row.sizeBytes }),
      },
    );

    expect(result.sourceGaps).toEqual([
      "facts.txt: subject_analysis_attachment_checksum_mismatch",
    ]);
  });

  it.each([
    ["spoofed.png", "image/png", "product", Buffer.from("not png")],
    ["spoofed.pdf", "application/pdf", "document", Buffer.from("not pdf")],
    ["spoofed.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "document", Buffer.from("not zip")],
  ] as const)("rejects spoofed %s bytes before parsing", async (fileName, mimeType, role, bytes) => {
    const row = attachment({ role, fileName, mimeType, sizeBytes: bytes.length }, bytes);
    const extractDocument = vi.fn();

    const result = await loadSubjectEvidence(
      { ...scope, attachmentIds: [row.id] },
      {
        listAttachments: async () => [row],
        fetchBlob: async () => ({ bytes, contentType: mimeType, contentLength: bytes.length }),
        extractDocument,
      },
    );

    expect(extractDocument).not.toHaveBeenCalled();
    expect(result.sourceGaps).toEqual([
      `${fileName}: subject_analysis_attachment_content_invalid`,
    ]);
  });

  it.each([
    ["invalid UTF-8", Buffer.from([0xc3, 0x28])],
    ["NUL", Buffer.from([0x66, 0x00, 0x6f])],
  ])("rejects text containing %s", async (_case, bytes) => {
    const row = attachment({ sizeBytes: bytes.length }, bytes);

    const result = await loadSubjectEvidence(
      { ...scope, attachmentIds: [row.id] },
      {
        listAttachments: async () => [row],
        fetchBlob: async () => ({ bytes, contentType: row.mimeType, contentLength: bytes.length }),
      },
    );

    expect(result.sourceGaps).toEqual([
      "facts.txt: subject_analysis_attachment_content_invalid",
    ]);
  });

  it("normalizes unapproved extractor errors to the safe fallback code", async () => {
    const row = attachment();

    const result = await loadSubjectEvidence(
      { ...scope, attachmentIds: [row.id] },
      {
        listAttachments: async () => [row],
        fetchBlob: async () => ({ bytes: Buffer.from("facts"), contentType: row.mimeType, contentLength: row.sizeBytes }),
        extractDocument: async () => { throw new Error("internal_secret_code: details"); },
      },
    );

    expect(result.sourceGaps).toEqual([
      "facts.txt: subject_attachment_read_failed",
    ]);
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

    for (const [, limits] of fetchBlob.mock.calls) {
      expect(limits).toEqual(expect.objectContaining({ maxBytes: 5, signal: expect.any(AbortSignal) }));
      expect(limits.timeoutMs).toBeGreaterThan(0);
      expect(limits.timeoutMs).toBeLessThanOrEqual(SUBJECT_EVIDENCE_FETCH_TIMEOUT_MS);
    }
    expect(result.sourceGaps).toEqual([
      "wrong-mime.txt: subject_analysis_attachment_mime_mismatch",
      "wrong-header.txt: subject_analysis_attachment_size_mismatch",
      "wrong-body.txt: subject_analysis_attachment_size_mismatch",
    ]);
  });
});
