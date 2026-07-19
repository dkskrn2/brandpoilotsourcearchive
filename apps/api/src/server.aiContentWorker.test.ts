import { describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer.js";
import type { ApiRepository } from "./types.js";

function setup() {
  const claimAiContentJob = vi.fn(async (input: { contentType: "card_news" | "blog" | "marketing"; workerId: string; leaseSeconds: number }) => ({
    id: `job-${input.contentType}`,
    generationId: "generation-1",
    outputId: null,
    workspaceId: "workspace-1",
    brandId: "brand-1",
    jobType: "analyze" as const,
    contentType: input.contentType,
    status: "processing" as const,
    payload: {},
    attemptCount: 1,
    maxAttempts: 3,
    workerId: input.workerId,
    leaseToken: "lease-1",
    leaseExpiresAt: "2026-07-18T00:03:00.000Z",
    availableAt: "2026-07-18T00:00:00.000Z",
  }));
  const repository = {
    claimAiContentJob,
    heartbeatAiContentJob: vi.fn(async () => true),
    completeAiContentJob: vi.fn(async () => ({ id: "generation-1", status: "analysis_ready" })),
    failAiContentJob: vi.fn(async () => ({ id: "generation-1", status: "analyzing" })),
    claimSubjectAnalysis: vi.fn(async () => ({
      id: "analysis-1",
      workspaceId: "workspace-1",
      brandId: "brand-1",
      subjectType: "product" as const,
      sourceUrl: "https://example.com/product",
      normalizedUrl: "https://example.com/product",
      input: { name: "제품", promotion: "", description: "설명" },
      status: "extracting" as const,
      facts: [], structuredData: {}, research: {}, targets: [], appealsByTarget: {}, selectedImageId: null, images: [],
      analysisVersion: 1, idempotencyKey: "subject-1", leasedBy: "subject-worker-1", leaseToken: "subject-lease-1",
      leaseExpiresAt: "2026-07-20T00:03:00.000Z", attemptCount: 1, availableAt: "2026-07-20T00:00:00.000Z",
      errorCode: null, errorMessage: null, supersededAt: null, createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z", completedAt: null,
    })),
    markSubjectExtractionComplete: vi.fn(async (input) => ({
      id: input.analysisId,
      workspaceId: "workspace-1",
      brandId: "brand-1",
      subjectType: "product" as const,
      sourceUrl: "https://example.com/product",
      input: { name: "제품", promotion: "", description: "설명" },
      status: "researching" as const,
      facts: input.facts,
      structuredData: input.structuredData,
      images: input.images.map((image: Record<string, unknown>, index: number) => ({ ...image, id: `image-${index + 1}`, analysisId: input.analysisId, selectionScore: 0, createdAt: "2026-07-20T00:00:00.000Z" })),
      leasedBy: input.workerId,
      leaseToken: input.leaseToken,
    })),
    heartbeatSubjectAnalysis: vi.fn(async () => true),
    completeSubjectAnalysis: vi.fn(async () => ({ id: "analysis-1", status: "ready" })),
    failSubjectAnalysis: vi.fn(async () => ({ id: "analysis-1", status: "queued" })),
    getBrandProfile: vi.fn(async () => ({
      id: "profile-1", brandId: "brand-1", name: "브랜드", primaryCategory: { code: "commerce", name: "커머스" },
      subcategories: [{ type: "custom" as const, code: null, name: "생활용품" }], primaryCustomer: "", description: "", tone: "",
      defaultCta: "", mainLink: "", autoApprovalEnabled: false, logoUrl: null,
    })),
    listInstagramFormats: vi.fn(async () => ({ brandId: "brand-1", brandColor: "파란색", formats: [] })),
  } as unknown as ApiRepository;
  const archiveImage = vi.fn(async (image) => ({
    storageUrl: `https://blob.example/${image.index}.png`,
    storagePath: `subjects/${image.index}.png`,
  }));
  const extractPage = vi.fn(async ({ archiveImage: archive }) => {
    const archived = await archive({
      sourceUrl: "https://example.com/product.png", index: 0, data: new Uint8Array([1]), mimeType: "image/png",
      width: 1200, height: 1200, altText: "제품", role: "product", signal: new AbortController().signal,
    });
    return {
      canonicalUrl: "https://example.com/product", title: "제품", description: "설명",
      facts: [{ key: "name", value: "제품", sourceUrl: "https://example.com/product" }], structuredData: { "@type": "Product" },
      images: [{ sourceUrl: "https://example.com/product.png", ...archived, width: 1200, height: 1200, mimeType: "image/png", altText: "제품", role: "product" as const }],
    };
  });
  const app = createServer({ repository, workerApiToken: "worker-token", subjectAnalysis: { extractPage, archiveImage }, logger: false });
  return { app, repository, extractPage, archiveImage };
}

describe("AI content worker routes", () => {
  it.each([
    ["card-news", "card_news"],
    ["blog", "blog"],
    ["marketing", "marketing"],
  ] as const)("maps %s claims to only %s jobs", async (slug, contentType) => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST",
      url: `/worker/ai-content-jobs/${slug}/claim`,
      headers: { authorization: "Bearer worker-token" },
      payload: { workerId: `${slug}-worker-1`, leaseSeconds: 180 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().job.contentType).toBe(contentType);
    expect(repository.claimAiContentJob).toHaveBeenCalledWith(expect.objectContaining({ contentType }));
    await app.close();
  });

  it("rejects missing worker authentication", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST",
      url: "/worker/ai-content-jobs/blog/claim",
      payload: { workerId: "blog-worker-1", leaseSeconds: 180 },
    });
    expect(response.statusCode).toBe(401);
    expect(repository.claimAiContentJob).not.toHaveBeenCalled();
    await app.close();
  });

  it("forwards heartbeat, analysis completion, and retryable failure", async () => {
    const { app, repository } = setup();
    const headers = { authorization: "Bearer worker-token" };
    const heartbeat = await app.inject({ method: "POST", url: "/worker/ai-content-jobs/job-1/heartbeat", headers, payload: { workerId: "worker-1", leaseToken: "lease-1", leaseSeconds: 180 } });
    expect(heartbeat.statusCode).toBe(200);

    const completed = await app.inject({
      method: "POST", url: "/worker/ai-content-jobs/job-1/complete", headers,
      payload: { workerId: "worker-1", leaseToken: "lease-1", skillVersion: "blog-skill.v1", jobType: "analyze", analysisJson: { outline: ["핵심"] } },
    });
    expect(completed.statusCode).toBe(200);
    expect(repository.completeAiContentJob).toHaveBeenCalledWith(expect.objectContaining({ jobType: "analyze" }));

    const failed = await app.inject({
      method: "POST", url: "/worker/ai-content-jobs/job-1/fail", headers,
      payload: { workerId: "worker-1", leaseToken: "lease-1", errorCode: "codex_timeout", errorMessage: "timeout", retryable: true },
    });
    expect(failed.statusCode).toBe(200);
    expect(repository.failAiContentJob).toHaveBeenCalledWith(expect.objectContaining({ retryable: true }));
    await app.close();
  });

  it("leases, extracts, archives, persists, and returns a subject-analysis.v1 payload", async () => {
    const { app, repository, extractPage, archiveImage } = setup();
    const response = await app.inject({
      method: "POST",
      url: "/worker/ai-content-subject-analyses/claim",
      headers: { authorization: "Bearer worker-token" },
      payload: { workerId: "subject-worker-1", leaseSeconds: 180 },
    });
    expect(response.statusCode).toBe(200);
    expect(repository.claimSubjectAnalysis).toHaveBeenCalledWith({ workerId: "subject-worker-1", leaseSeconds: 180 });
    expect(extractPage).toHaveBeenCalledOnce();
    expect(archiveImage).toHaveBeenCalledOnce();
    expect(repository.markSubjectExtractionComplete).toHaveBeenCalledWith(expect.objectContaining({
      analysisId: "analysis-1", workerId: "subject-worker-1", leaseToken: "subject-lease-1",
    }));
    expect(response.json().job).toMatchObject({
      contractVersion: "subject-analysis.v1",
      brand: { name: "브랜드", primaryCategory: "커머스", subcategories: ["생활용품"], brandColor: "파란색" },
      subject: { type: "product", sourceUrl: "https://example.com/product" },
      researchPolicy: { publicWebSearch: true, requireSourceUrl: true },
    });
    await app.close();
  });

  it("fails the lease and returns no job when extraction fails", async () => {
    const { app, repository, extractPage } = setup();
    extractPage.mockRejectedValueOnce(new Error("subject_page_fetch_failed"));
    const response = await app.inject({
      method: "POST",
      url: "/worker/ai-content-subject-analyses/claim",
      headers: { authorization: "Bearer worker-token" },
      payload: { workerId: "subject-worker-1", leaseSeconds: 180 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ job: null });
    expect(repository.failSubjectAnalysis).toHaveBeenCalledWith({
      analysisId: "analysis-1", workerId: "subject-worker-1", leaseToken: "subject-lease-1",
      errorCode: "subject_page_fetch_failed", errorMessage: "subject_page_fetch_failed", retryable: true,
    });
    await app.close();
  });

  it("protects subject worker routes and enforces lease identity fields", async () => {
    const { app, repository } = setup();
    const unauthorized = await app.inject({ method: "POST", url: "/worker/ai-content-subject-analyses/claim", payload: { workerId: "worker-1" } });
    expect(unauthorized.statusCode).toBe(401);
    expect(repository.claimSubjectAnalysis).not.toHaveBeenCalled();

    const headers = { authorization: "Bearer worker-token" };
    const heartbeat = await app.inject({
      method: "POST", url: "/worker/ai-content-subject-analyses/analysis-1/heartbeat", headers,
      payload: { workerId: "subject-worker-1", leaseToken: "subject-lease-1", leaseSeconds: 180 },
    });
    expect(heartbeat.statusCode).toBe(200);
    expect(repository.heartbeatSubjectAnalysis).toHaveBeenCalledWith({ analysisId: "analysis-1", workerId: "subject-worker-1", leaseToken: "subject-lease-1", leaseSeconds: 180 });

    const invalid = await app.inject({
      method: "POST", url: "/worker/ai-content-subject-analyses/analysis-1/fail", headers,
      payload: { workerId: "subject-worker-1", errorCode: "timeout", errorMessage: "timeout", retryable: true },
    });
    expect(invalid.statusCode).toBe(400);
    expect(repository.failSubjectAnalysis).not.toHaveBeenCalled();
    await app.close();
  });

  it("forwards extraction completion, validated research completion, and failure with the exact lease", async () => {
    const { app, repository } = setup();
    const headers = { authorization: "Bearer worker-token" };
    const identity = { workerId: "subject-worker-1", leaseToken: "subject-lease-1" };
    const extraction = await app.inject({
      method: "POST", url: "/worker/ai-content-subject-analyses/analysis-1/extraction-complete", headers,
      payload: {
        ...identity,
        facts: [{ key: "name", value: "제품", sourceUrl: "https://example.com/product" }],
        structuredData: { "@type": "Product" },
        images: [{ sourceUrl: "https://example.com/a.png", storageUrl: "https://blob.example/a.png", storagePath: "a.png", width: 100, height: 100, mimeType: "image/png", altText: "제품", role: "product" }],
      },
    });
    expect(extraction.statusCode).toBe(200);
    expect(repository.markSubjectExtractionComplete).toHaveBeenCalledWith(expect.objectContaining({ analysisId: "analysis-1", ...identity }));

    const targets = [1, 2, 3].map((index) => ({
      id: `target-${index}`, name: `타겟 ${index}`, traits: ["실용적"], painPoints: ["시간 부족"], purchaseMotivations: ["시간 절약"],
      uspEvidence: [{ claim: "빠름", support: "제품 설명", sourceUrl: "https://example.com/evidence" }],
    }));
    const completion = await app.inject({
      method: "POST", url: "/worker/ai-content-subject-analyses/analysis-1/complete", headers,
      payload: {
        ...identity,
        result: {
          contractVersion: "subject-analysis-result.v1", summary: "분석 완료",
          needs: [{ text: "빠른 설정", sourceUrl: "https://example.com/research" }],
          alternatives: [{ name: "대안", strengths: ["인지도"], limitations: ["느림"], sourceUrls: ["https://example.com/alternative"] }],
          voc: [{ quoteSummary: "설정이 어렵다", context: "후기", sourceUrl: "https://example.com/review" }],
          usps: [{ claim: "빠름", support: "제품 설명", sourceUrl: "https://example.com/evidence" }],
          targets,
          appealsByTarget: Object.fromEntries(targets.map((target) => [target.id, [{ id: `appeal-${target.id}`, targetId: target.id, title: "시간 절약", description: "설정 시간을 줄입니다", evidenceType: "public_research", connectionReason: "고객 요구와 일치", sources: [{ title: "조사", url: "https://example.com/research" }] }]])),
          recommendedImageId: null, sourceGaps: [],
        },
      },
    });
    expect(completion.statusCode).toBe(200);
    expect(repository.completeSubjectAnalysis).toHaveBeenCalledWith(expect.objectContaining({ analysisId: "analysis-1", ...identity, contractVersion: "subject-analysis-result.v1" }));

    const failure = await app.inject({
      method: "POST", url: "/worker/ai-content-subject-analyses/analysis-1/fail", headers,
      payload: { ...identity, errorCode: "codex_timeout", errorMessage: "timeout", retryable: true },
    });
    expect(failure.statusCode).toBe(200);
    expect(repository.failSubjectAnalysis).toHaveBeenCalledWith({ analysisId: "analysis-1", ...identity, errorCode: "codex_timeout", errorMessage: "timeout", retryable: true });
    await app.close();
  });
});
