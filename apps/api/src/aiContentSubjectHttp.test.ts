import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  claimAndPrepareSubjectAnalysis,
  fetchSubjectEvidenceBlob,
} from "./aiContentSubjectHttp.js";
import type { ApiRepository } from "./types.js";
import type { SubjectAnalysisClaim, SubjectAnalysisRepository } from "./aiContentSubjectRepository.js";

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function claim(overrides: Partial<SubjectAnalysisClaim> = {}): SubjectAnalysisClaim {
  return {
    id: "analysis-1",
    workspaceId: "workspace-1",
    brandId: "brand-1",
    generationId: "generation-1",
    contractVersion: "subject-analysis.v2",
    subjectType: "product",
    sourceUrl: "https://example.com/product",
    normalizedUrl: "https://example.com/product",
    input: { name: "Widget", promotion: "Launch", promotionOrTerms: "Launch", description: "Fast setup" },
    brandContext: { brandName: "Acme", brandIntelligenceVersionId: "brand-analysis-7" },
    attachmentIds: ["attachment-document", "attachment-image"],
    status: "extracting",
    phase: "analysis",
    facts: [],
    structuredData: {},
    research: {},
    analysisResult: null,
    sourceGaps: [],
    targets: [],
    appealsByTarget: {},
    selectedImageId: null,
    images: [],
    analysisVersion: 1,
    idempotencyKey: "subject-pipeline-1",
    leasedBy: "subject-worker-1",
    leaseToken: "subject-lease-1",
    leaseExpiresAt: "2026-07-22T01:03:00.000Z",
    attemptCount: 1,
    availableAt: "2026-07-22T01:00:00.000Z",
    errorCode: null,
    errorMessage: null,
    supersededAt: null,
    createdAt: "2026-07-22T01:00:00.000Z",
    updatedAt: "2026-07-22T01:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function setup(claimed: SubjectAnalysisClaim) {
  const documentBytes = Buffer.from("Document evidence", "utf8");
  const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const repository = {
    claimSubjectAnalysis: vi.fn(async () => claimed),
    heartbeatSubjectAnalysis: vi.fn(async () => true),
    markSubjectExtractionComplete: vi.fn(async (input) => claim({
      ...claimed,
      status: "analyzing",
      phase: "analysis",
      facts: input.facts,
      structuredData: input.structuredData,
    })),
    failSubjectAnalysis: vi.fn(async () => claimed),
    listSubjectEvidenceAttachments: vi.fn(async () => [
      {
        id: "attachment-document", workspaceId: "workspace-1", brandId: "brand-1", generationId: "generation-1",
        role: "document" as const, fileName: "brief.txt", mimeType: "text/plain", sizeBytes: documentBytes.length,
        storageUrl: "https://blob.example/brief.txt", storagePath: "brief.txt", deletedAt: null,
        checksum: sha256(documentBytes),
      },
      {
        id: "attachment-image", workspaceId: "workspace-1", brandId: "brand-1", generationId: "generation-1",
        role: "product" as const, fileName: "product.png", mimeType: "image/png", sizeBytes: imageBytes.length,
        storageUrl: "https://blob.example/product.png", storagePath: "product.png", deletedAt: null,
        checksum: sha256(imageBytes),
      },
    ]),
  } as unknown as ApiRepository & SubjectAnalysisRepository;
  const fetchBlob = vi.fn(async (url: string, limits: { maxBytes: number; signal: AbortSignal }) => {
    expect(limits.signal).toBeInstanceOf(AbortSignal);
    const bytes = url.endsWith("brief.txt") ? documentBytes : imageBytes;
    expect(limits.maxBytes).toBe(bytes.length);
    return {
      bytes,
      contentType: url.endsWith("brief.txt") ? "text/plain" : "image/png",
      contentLength: bytes.length,
    };
  });
  const extractPage = vi.fn(async () => ({
    canonicalUrl: "https://example.com/product",
    title: "Widget",
    description: "Fast setup",
    facts: [
      { key: "title", value: "Widget", sourceUrl: "https://example.com/product" },
      { key: "visible_text", value: "Full product page evidence", sourceUrl: "https://example.com/product" },
    ],
    structuredData: { "@type": "Product" },
    images: [],
  }));
  const archiveImage = vi.fn(async () => ({ storageUrl: "https://blob.example/page.png", storagePath: "page.png" }));
  return { repository, fetchBlob, extractPage, archiveImage };
}

describe("subject worker job preparation", () => {
  it("combines persisted v2 analysis context, attachments, and extracted source page in priority order", async () => {
    const { repository, fetchBlob, extractPage, archiveImage } = setup(claim());

    const job = await claimAndPrepareSubjectAnalysis(
      repository,
      { workerId: "subject-worker-1", leaseSeconds: 180 },
      { fetchBlob, extractPage, archiveImage },
    );

    expect(job).toMatchObject({
      contractVersion: "subject-analysis.v2",
      phase: "analysis",
      brandContext: { brandName: "Acme", brandIntelligenceVersionId: "brand-analysis-7" },
      subject: {
        type: "product",
        sourceUrl: "https://example.com/product",
        attachmentIds: ["attachment-document", "attachment-image"],
        manualInput: { name: "Widget", promotionOrTerms: "Launch", description: "Fast setup" },
      },
      extracted: {
        documents: [{ attachmentId: "attachment-document", fileName: "brief.txt", mimeType: "text/plain", text: "Document evidence" }],
        images: [{
          attachmentId: "attachment-image",
          sourceUrl: "attachment://attachment-image",
          storageUrl: "https://blob.example/product.png",
          mimeType: "image/png",
          altText: "product.png",
        }],
        sourcePage: {
          sourceUrl: "https://example.com/product",
          title: "Widget",
          text: "Full product page evidence",
          structuredData: { "@type": "Product" },
        },
        sourceGaps: [],
      },
      sourcePriority: ["manual_input", "attachments", "source_url", "brand_context", "public_research"],
    });
    expect(repository.listSubjectEvidenceAttachments).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      brandId: "brand-1",
      generationId: "generation-1",
      attachmentIds: ["attachment-document", "attachment-image"],
    });
    expect(repository.markSubjectExtractionComplete).toHaveBeenCalledOnce();
    expect(fetchBlob).toHaveBeenCalledTimes(2);
  });

  it("advances URL-less v2 analysis without invoking the page extractor", async () => {
    const claimed = claim({ sourceUrl: "", normalizedUrl: "", attachmentIds: [], input: {
      name: "Consulting", promotion: "Monthly", promotionOrTerms: "Monthly", description: "Managed onboarding",
    } });
    const { repository, fetchBlob, extractPage, archiveImage } = setup(claimed);

    const job = await claimAndPrepareSubjectAnalysis(
      repository,
      { workerId: "subject-worker-1", leaseSeconds: 180 },
      { fetchBlob, extractPage, archiveImage },
    );

    expect(job).toMatchObject({
      contractVersion: "subject-analysis.v2",
      phase: "analysis",
      subject: { sourceUrl: null, attachmentIds: [] },
      extracted: { documents: [], images: [], sourcePage: null, sourceGaps: [] },
    });
    expect(extractPage).not.toHaveBeenCalled();
    expect(repository.listSubjectEvidenceAttachments).not.toHaveBeenCalled();
    expect(repository.markSubjectExtractionComplete).toHaveBeenCalledWith(expect.objectContaining({
      facts: [], structuredData: {}, images: [],
    }));
  });

  it("prepares a v2 appeal only from persisted context, subject, and analysis result", async () => {
    const analysisResult = {
      contractVersion: "subject-analysis-result.v2" as const,
      phase: "analysis" as const,
      subjectType: "product" as const,
      summary: "Stored analysis",
      verifiedFacts: [], voc: [], alternatives: [], barriers: [],
      productProfile: {
        name: "Tool", category: "Tools", specifications: [], materials: [], options: [], price: "Not verified",
        discountsAndPromotions: [], shipping: [], returns: [], functions: [], useContexts: [], purchaseBarriers: [],
        reviewPatterns: { recurringSatisfaction: [], recurringComplaints: [] },
        productImageCandidates: [], detailImageCandidates: [],
      }, serviceProfile: null, serviceSubtype: null, sourceGaps: ["missing price"],
    };
    const { repository, fetchBlob, extractPage, archiveImage } = setup(claim({
      status: "generating_appeals",
      phase: "appeal",
      analysisResult,
    }));

    const job = await claimAndPrepareSubjectAnalysis(
      repository,
      { workerId: "subject-worker-1", leaseSeconds: 180 },
      { fetchBlob, extractPage, archiveImage },
    );

    expect(job).toMatchObject({
      contractVersion: "subject-analysis.v2",
      phase: "appeal",
      brandContext: { brandName: "Acme" },
      subject: { type: "product", attachmentIds: ["attachment-document", "attachment-image"] },
      analysisResult,
      sourcePriority: ["manual_input", "attachments", "source_url", "brand_context", "public_research"],
    });
    expect(extractPage).not.toHaveBeenCalled();
    expect(fetchBlob).not.toHaveBeenCalled();
    expect(repository.listSubjectEvidenceAttachments).not.toHaveBeenCalled();
    expect(repository.markSubjectExtractionComplete).not.toHaveBeenCalled();
  });

  it("renews the lease while server-side v2 preparation is still running", async () => {
    const { repository, extractPage, archiveImage } = setup(claim());
    const fetchBlob = vi.fn(async (url: string) => {
      await new Promise((resolve) => setTimeout(resolve, 35));
      const isDocument = url.endsWith("brief.txt");
      const bytes = isDocument
        ? Buffer.from("Document evidence", "utf8")
        : Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      return { bytes, contentType: isDocument ? "text/plain" : "image/png", contentLength: bytes.length };
    });

    await expect(claimAndPrepareSubjectAnalysis(
      repository,
      { workerId: "subject-worker-1", leaseSeconds: 180 },
      { fetchBlob, extractPage, archiveImage, leaseHeartbeatIntervalMs: 5 },
    )).resolves.toMatchObject({ contractVersion: "subject-analysis.v2" });

    expect(repository.heartbeatSubjectAnalysis).toHaveBeenCalledWith({
      analysisId: "analysis-1", workerId: "subject-worker-1", leaseToken: "subject-lease-1", leaseSeconds: 180,
    });
    expect(vi.mocked(repository.heartbeatSubjectAnalysis).mock.calls.length).toBeGreaterThan(1);
  });

  it("aborts v2 preparation when the lease cannot be renewed", async () => {
    const { repository, fetchBlob, extractPage, archiveImage } = setup(claim());
    vi.mocked(repository.heartbeatSubjectAnalysis).mockResolvedValueOnce(false);

    await expect(claimAndPrepareSubjectAnalysis(
      repository,
      { workerId: "subject-worker-1", leaseSeconds: 180 },
      { fetchBlob, extractPage, archiveImage, leaseHeartbeatIntervalMs: 5 },
    )).resolves.toBeNull();

    expect(repository.listSubjectEvidenceAttachments).not.toHaveBeenCalled();
    expect(repository.failSubjectAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: "subject_analysis_lease_invalid",
    }));
  });
});

describe("subject evidence HTTP fetch", () => {
  it("forwards AbortSignal and returns a bounded response with declared content length", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBe(signal);
      return new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": "3" },
      });
    });
    const signal = new AbortController().signal;

    await expect(fetchSubjectEvidenceBlob(
      "https://blob.example/product.png",
      { timeoutMs: 100, maxBytes: 3, signal },
      fetchImpl as typeof fetch,
    )).resolves.toMatchObject({ contentType: "image/png", contentLength: 3 });
  });

  it("rejects an oversized declared or streamed body without an uncontrolled read", async () => {
    const declared = vi.fn(async () => new Response(Uint8Array.from([1, 2, 3, 4]), {
      status: 200,
      headers: { "content-type": "image/png", "content-length": "4" },
    }));
    await expect(fetchSubjectEvidenceBlob(
      "https://blob.example/declared.png",
      { timeoutMs: 100, maxBytes: 3, signal: new AbortController().signal },
      declared as typeof fetch,
    )).rejects.toThrow("subject_analysis_attachment_size_mismatch");

    const streamed = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2]));
        controller.enqueue(Uint8Array.from([3, 4]));
        controller.close();
      },
    }), {
      status: 200,
      headers: { "content-type": "image/png", "content-length": "3" },
    }));
    await expect(fetchSubjectEvidenceBlob(
      "https://blob.example/streamed.png",
      { timeoutMs: 100, maxBytes: 3, signal: new AbortController().signal },
      streamed as typeof fetch,
    )).rejects.toThrow("subject_analysis_attachment_size_mismatch");
  });
});
