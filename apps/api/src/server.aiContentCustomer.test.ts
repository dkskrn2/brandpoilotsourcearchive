import { describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer.js";
import type { ApiRepository } from "./types.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const brandId = "22222222-2222-4222-8222-222222222222";
const generationId = "33333333-3333-4333-8333-333333333333";
const outputId = "44444444-4444-4444-8444-444444444444";
const analysisId = "55555555-5555-4555-8555-555555555555";
const attachmentId = "66666666-6666-4666-8666-666666666666";

function subjectAnalysis(status: "queued" | "ready" | "partial" = "queued") {
  return {
    id: analysisId,
    workspaceId,
    brandId,
    generationId: null,
    contractVersion: "subject-analysis.v1" as const,
    subjectType: "product" as const,
    sourceUrl: "https://example.com/product",
    normalizedUrl: "https://example.com/product",
    input: { name: "제품", promotion: "", description: "설명" },
    attachmentIds: [],
    status,
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
    idempotencyKey: "subject-1",
    leasedBy: null,
    leaseToken: null,
    leaseExpiresAt: null,
    attemptCount: 0,
    availableAt: "2026-07-20T00:00:00.000Z",
    errorCode: null,
    errorMessage: null,
    supersededAt: null,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    completedAt: status === "queued" ? null : "2026-07-20T00:01:00.000Z",
  };
}

function subjectAnalysisV2(status: "queued" | "generating_appeals" | "ready" | "partial" = "queued") {
  return {
    ...subjectAnalysis(status === "generating_appeals" ? "queued" : status),
    generationId,
    contractVersion: "subject-analysis.v2" as const,
    attachmentIds: [attachmentId],
    status,
    input: { name: "제품", promotionOrTerms: "첫 달 할인", description: "설명" },
    analysisResult: {
      contractVersion: "subject-analysis-result.v2",
      phase: "analysis",
      summary: "internal summary",
    },
    sourceGaps: ["가격 근거 부족"],
    targets: [{ id: "target-1", name: "브랜드 담당자" }],
    appealsByTarget: { "target-1": [{ id: "appeal-1", title: "빠른 시작" }] },
  };
}

const confirmedSubjectBrandContext = {
  brandName: "Growthline",
  companyOverview: "그로스라인 개요",
  businessDescription: "콘텐츠 운영 서비스",
  primaryCategory: { code: "marketing", name: "마케팅" },
  subcategories: [{ code: "content", name: "콘텐츠 마케팅" }],
  primaryTarget: "중소 브랜드 담당자",
  differentiators: "확정 정보 재사용",
  coreAppeal: "반복 입력 감소",
  brandColor: "#1357d4",
  brandIntelligenceVersionId: "brand-analysis-1",
  confirmedAt: "2026-07-21T00:00:00.000Z",
};

function generation(status = "analyzing") {
  return {
    id: generationId,
    workspaceId,
    brandId,
    type: "card_news" as const,
    title: "여름 추천",
    status,
    currentStage: "analysis",
    draft: {},
    analysis: {},
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    completedAt: null,
  };
}

function setup(allowed = true) {
  const repository = {
    health: vi.fn(async () => ({ database: "ok" as const })),
    createAiContentAnalysis: vi.fn(async () => generation()),
    updateAiContentDraft: vi.fn(async () => generation("analysis_ready")),
    startAiContentGeneration: vi.fn(async () => generation("queued")),
    listAiContentGenerations: vi.fn(async () => [generation()]),
    getAiContentGeneration: vi.fn(async () => generation()),
    listAiContentUsage: vi.fn(async (input) => ({ usageDate: input.usageDate, generationCount: 1, downloadCount: 2 })),
    listAiContentReferences: vi.fn(async () => []),
    listBrandAudiences: vi.fn(async () => []),
    saveBrandAudience: vi.fn(async () => ({ id: "audience-1", name: "초보 대표", situation: "첫 홍보", problem: "막막함", motivation: "문의 증가", useCount: 0, lastUsedAt: null })),
    listBrandAppeals: vi.fn(async () => []),
    saveBrandAppeal: vi.fn(async () => ({ id: "appeal-1", title: "빠른 시작", description: "설정 지원", evidenceType: "benefit" as const, useCount: 0, lastUsedAt: null })),
    confirmAiContentAttachment: vi.fn(async (input) => ({ id: "attachment-1", generationId: input.generationId, role: input.role, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.sizeBytes, checksum: input.checksum, storageUrl: input.storageUrl, storagePath: input.storagePath, createdAt: "2026-07-18T00:00:00.000Z" })),
    retryAiContentOutput: vi.fn(async () => generation("queued")),
    downloadAiContentOutput: vi.fn(async () => ({ fileName: "result.zip", mimeType: "application/zip" as const, buffer: Buffer.from("PK"), itemCount: 1 })),
    downloadAiContentGeneration: vi.fn(async () => ({ fileName: "generation.zip", mimeType: "application/zip" as const, buffer: Buffer.from("PK"), itemCount: 1 })),
    prepareAiContentPublish: vi.fn(async () => ({
      publishGroupId: "publish-group-1",
      targets: [
        { channel: "instagram", deliveryFormat: "instagram_feed_carousel", queueId: "queue-feed", status: "scheduled", publishedUrl: null, errorCode: null },
        { channel: "instagram", deliveryFormat: "instagram_story", queueId: "queue-story", status: "scheduled", publishedUrl: null, errorCode: null },
      ],
    })),
    getAiContentPublishQueueResult: vi.fn(async (input) => ({
      channel: "instagram" as const,
      deliveryFormat: "instagram_story" as const,
      queueId: input.queueId,
      status: "scheduled" as const,
      publishedUrl: null,
      errorCode: "story_capability_required",
    })),
    publishQueueItem: vi.fn(async (queueId) => ({ id: queueId, status: "published", publishedUrl: `https://instagram.example/${queueId}` })),
    getCachedSubjectAnalysis: vi.fn(async () => subjectAnalysis("ready")),
    requestSubjectAnalysis: vi.fn(async (input) => (
      "generationId" in input ? subjectAnalysisV2("queued") : subjectAnalysis("queued")
    )),
    getSubjectAnalysis: vi.fn(async () => subjectAnalysis("ready")),
    regenerateSubjectAppeals: vi.fn(async () => subjectAnalysisV2("generating_appeals")),
    selectSubjectImage: vi.fn(async () => subjectAnalysis("ready")),
    getConfirmedSubjectAnalysisBrandContext: vi.fn(async () => confirmedSubjectBrandContext),
  } as unknown as ApiRepository;
  const kakaoAuth = {
    getSession: vi.fn(async () => ({ userId: "user-1", workspaceId, workspaceName: "Workspace", brandId, brandName: "Brand", displayName: "Tester", email: null })),
    canAccessBrand: vi.fn(async () => allowed),
  } as never;
  const generateClientToken = vi.fn(async () => "upload-token");
  const headBlob = vi.fn(async (url: string) => ({
    pathname: new URL(url).pathname.replace(/^\//, ""),
    size: 100,
    contentType: "image/png",
  } as never));
  const app = createServer({
    repository,
    kakaoAuth,
    aiContentUpload: { readWriteToken: "rw-token", generateClientToken, headBlob },
    aiContentLimits: { dailyGenerationLimit: 10, dailyDownloadLimit: 20 },
    logger: false,
  });
  return { app, repository, generateClientToken };
}

const auth = { cookie: "bp_session=session-1" };

describe("AI content customer routes", () => {
  it("creates an analysis in the authenticated workspace and brand scope", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/generations`,
      headers: auth,
      payload: { type: "card_news", title: "여름 추천", draft: { productUrl: "https://example.com" }, idempotencyKey: "analysis-1" },
    });
    expect(response.statusCode).toBe(200);
    expect(repository.createAiContentAnalysis).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, brandId, idempotencyKey: "analysis-1" }));
    await app.close();
  });

  it("rejects another brand before calling the repository", async () => {
    const { app, repository } = setup(false);
    const response = await app.inject({ method: "GET", url: `/brands/${brandId}/ai-content/generations`, headers: auth });
    expect(response.statusCode).toBe(403);
    expect(repository.listAiContentGenerations).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns an API error without substituting sample content", async () => {
    const { app, repository } = setup();
    vi.mocked(repository.listAiContentGenerations).mockRejectedValueOnce(new Error("database_unavailable"));
    const response = await app.inject({ method: "GET", url: `/brands/${brandId}/ai-content/generations`, headers: auth });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "internal_error" });
    await app.close();
  });

  it("validates generation input and exposes configured usage limits", async () => {
    const { app } = setup();
    const invalid = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/generations/${generationId}/generate`,
      headers: auth,
      payload: { idempotencyKey: "generate-1", outputCount: 4 },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: "ai_content_output_count_invalid" });

    const usage = await app.inject({ method: "GET", url: `/brands/${brandId}/ai-content/usage?date=2026-07-18`, headers: auth });
    expect(usage.statusCode).toBe(200);
    expect(usage.json()).toMatchObject({ generationCount: 1, downloadCount: 2, dailyGenerationLimit: 10, dailyDownloadLimit: 20 });
    await app.close();
  });

  it("issues a constrained attachment token and confirms the same Blob path", async () => {
    const { app, repository, generateClientToken } = setup();
    const attachment = { role: "product", fileName: "product.png", mimeType: "image/png", sizeBytes: 100, checksum: "a".repeat(64) };
    const tokenResponse = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/generations/${generationId}/attachments/token`,
      headers: auth,
      payload: attachment,
    });
    expect(tokenResponse.statusCode).toBe(200);
    const { pathname } = tokenResponse.json();
    expect(generateClientToken).toHaveBeenCalledOnce();

    const confirmed = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/generations/${generationId}/attachments/confirm`,
      headers: auth,
      payload: { ...attachment, storagePath: pathname, storageUrl: `https://test.public.blob.vercel-storage.com/${pathname}` },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(repository.confirmAiContentAttachment).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, brandId, generationId, storagePath: pathname }));
    await app.close();
  });

  it("retries a failed output in the authenticated brand scope", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/outputs/output-1/retry`,
      headers: auth,
    });
    expect(response.statusCode).toBe(200);
    expect(repository.retryAiContentOutput).toHaveBeenCalledWith({ workspaceId, brandId, outputId: "output-1" });
    await app.close();
  });

  it("downloads a completed output package and immediately publishes selected targets", async () => {
    const { app, repository } = setup();
    const download = await app.inject({ method: "GET", url: `/brands/${brandId}/ai-content/outputs/${outputId}/download`, headers: auth });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain("application/zip");
    expect(repository.downloadAiContentOutput).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, brandId, outputId, dailyDownloadLimit: 20 }));

    const idempotencyKey = "b4b74082-8a44-46d6-91b6-3e3bd7e26be0";
    const targets = [
      { channel: "instagram", deliveryFormat: "instagram_feed_carousel" },
      { channel: "instagram", deliveryFormat: "instagram_story" },
    ];
    vi.mocked(repository.publishQueueItem)
      .mockResolvedValueOnce({ id: "queue-feed", status: "published", publishedUrl: "https://instagram.example/queue-feed" })
      .mockRejectedValueOnce(new Error("story_capability_required"));
    const publish = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/outputs/${outputId}/publish`,
      headers: auth,
      payload: { idempotencyKey, targets },
    });
    expect(publish.statusCode).toBe(200);
    expect(repository.prepareAiContentPublish).toHaveBeenCalledWith({ workspaceId, brandId, outputId, idempotencyKey, targets });
    expect(repository.publishQueueItem).toHaveBeenNthCalledWith(1, "queue-feed");
    expect(repository.publishQueueItem).toHaveBeenNthCalledWith(2, "queue-story");
    expect(publish.json()).toMatchObject({
      outputId,
      targets: [
        { queueId: "queue-feed", status: "published", publishedUrl: "https://instagram.example/queue-feed" },
        { queueId: "queue-story", status: "scheduled", errorCode: "story_capability_required" },
      ],
    });
    await app.close();
  });

  it("returns a rendering reel target without publishing a queue before the video exists", async () => {
    const { app, repository } = setup();
    vi.mocked(repository.prepareAiContentPublish).mockResolvedValueOnce({
      publishGroupId: "publish-group-1",
      targets: [{
        channel: "instagram",
        deliveryFormat: "instagram_reel",
        channelOutputId: "channel-output-reel",
        queueId: null,
        status: "rendering",
        publishedUrl: null,
        errorCode: null,
      }],
    });

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/outputs/${outputId}/publish`,
      headers: auth,
      payload: {
        idempotencyKey: "b4b74082-8a44-46d6-91b6-3e3bd7e26be0",
        targets: [{ channel: "instagram", deliveryFormat: "instagram_reel" }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(repository.publishQueueItem).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      targets: [{ deliveryFormat: "instagram_reel", queueId: null, status: "rendering" }],
    });
    await app.close();
  });

  it("rejects an invalid direct-publish request body", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/outputs/${outputId}/publish`,
      headers: auth,
      payload: { idempotencyKey: "invalid", targets: [] },
    });
    expect(response.statusCode).toBe(400);
    expect(repository.prepareAiContentPublish).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns cached analyses with 200 and queues new analyses with 202 without extracting inline", async () => {
    const { app, repository } = setup();
    const extractPage = vi.fn();
    const cache = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/ai-content/subject-analyses/cache?subjectType=product&sourceUrl=${encodeURIComponent("https://example.com/product")}`,
      headers: auth,
    });
    expect(cache.statusCode).toBe(200);
    expect(cache.json()).toMatchObject({ id: analysisId, status: "ready" });

    const queued = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/subject-analyses`,
      headers: auth,
      payload: {
        subjectType: "product",
        sourceUrl: "https://example.com/product",
        manualInput: { name: "제품", promotion: "", description: "설명" },
        idempotencyKey: "subject-1",
      },
    });
    expect(queued.statusCode).toBe(202);
    expect(queued.json()).toMatchObject({ id: analysisId, status: "queued" });
    expect(repository.requestSubjectAnalysis).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, brandId }));
    expect(extractPage).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns ready cache hits from POST with 200", async () => {
    const { app, repository } = setup();
    vi.mocked(repository.requestSubjectAnalysis!).mockResolvedValueOnce(subjectAnalysis("partial"));
    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/subject-analyses`,
      headers: auth,
      payload: {
        subjectType: "product",
        sourceUrl: "https://example.com/product",
        manualInput: { name: "제품", promotion: "", description: "설명" },
        idempotencyKey: "subject-cached",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("partial");
    await app.close();
  });

  it("accepts a generation-scoped v2 subject analysis with confirmed brand context", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/subject-analyses`,
      headers: auth,
      payload: {
        contractVersion: "subject-analysis.v2",
        generationId,
        subjectType: "product",
        sourceUrl: "https://example.com/product",
        attachmentIds: [attachmentId],
        manualInput: { name: "제품", promotionOrTerms: "첫 달 할인", description: "설명" },
        idempotencyKey: "subject-v2-1",
      },
    });

    expect(response.statusCode).toBe(202);
    expect(repository.getConfirmedSubjectAnalysisBrandContext).toHaveBeenCalledWith({ workspaceId, brandId });
    expect(repository.requestSubjectAnalysis).toHaveBeenCalledWith({
      workspaceId,
      brandId,
      contractVersion: "subject-analysis.v2",
      generationId,
      subjectType: "product",
      sourceUrl: "https://example.com/product",
      attachmentIds: [attachmentId],
      manualInput: { name: "제품", promotionOrTerms: "첫 달 할인", description: "설명" },
      idempotencyKey: "subject-v2-1",
      brandContext: confirmedSubjectBrandContext,
    });
    await app.close();
  });

  it("returns the exact v2 brand-context error before requesting analysis", async () => {
    const { app, repository } = setup();
    vi.mocked(repository.getConfirmedSubjectAnalysisBrandContext!)
      .mockRejectedValueOnce(new Error("subject_analysis_brand_context_required"));

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/subject-analyses`,
      headers: auth,
      payload: {
        contractVersion: "subject-analysis.v2",
        generationId,
        subjectType: "service",
        sourceUrl: null,
        attachmentIds: [attachmentId],
        manualInput: { name: "운영 서비스", promotionOrTerms: "", description: "" },
        idempotencyKey: "subject-v2-context",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "subject_analysis_brand_context_required" });
    expect(repository.requestSubjectAnalysis).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns only UI-required fields for v2 analysis detail", async () => {
    const { app, repository } = setup();
    vi.mocked(repository.getSubjectAnalysis!).mockResolvedValueOnce(subjectAnalysisV2("ready") as never);

    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/ai-content/subject-analyses/${analysisId}`,
      headers: auth,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: analysisId,
      generationId,
      contractVersion: "subject-analysis.v2",
      status: "ready",
      analysisVersion: 1,
      targets: [{ id: "target-1", name: "브랜드 담당자" }],
      appealsByTarget: { "target-1": [{ id: "appeal-1", title: "빠른 시작" }] },
      sourceGaps: ["가격 근거 부족"],
    });
    expect(response.json()).not.toHaveProperty("analysisResult");
    expect(response.json()).not.toHaveProperty("input");
    await app.close();
  });

  it("regenerates appeals in the authenticated brand scope with idempotency", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/subject-analyses/${analysisId}/appeals/regenerate`,
      headers: auth,
      payload: { idempotencyKey: "appeals-v2-1" },
    });

    expect(response.statusCode).toBe(202);
    expect(repository.regenerateSubjectAppeals).toHaveBeenCalledWith({
      workspaceId,
      brandId,
      analysisId,
      idempotencyKey: "appeals-v2-1",
    });
    await app.close();
  });

  it("scopes detail, reanalysis, and image selection to the authenticated brand", async () => {
    const { app, repository } = setup();
    const detail = await app.inject({ method: "GET", url: `/brands/${brandId}/ai-content/subject-analyses/${analysisId}`, headers: auth });
    expect(detail.statusCode).toBe(200);

    const reanalyze = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/subject-analyses/${analysisId}/reanalyze`,
      headers: auth,
      payload: { idempotencyKey: "subject-2" },
    });
    expect(reanalyze.statusCode).toBe(202);
    expect(repository.requestSubjectAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      brandId,
      force: true,
      idempotencyKey: "subject-2",
    }));

    const selected = await app.inject({
      method: "PATCH",
      url: `/brands/${brandId}/ai-content/subject-analyses/${analysisId}/selection`,
      headers: auth,
      payload: { imageId: "image-1" },
    });
    expect(selected.statusCode).toBe(200);
    expect(repository.selectSubjectImage).toHaveBeenCalledWith({ workspaceId, brandId, analysisId, imageId: "image-1" });

    vi.mocked(repository.getSubjectAnalysis!).mockResolvedValueOnce(null);
    const hidden = await app.inject({ method: "GET", url: `/brands/${brandId}/ai-content/subject-analyses/${analysisId}`, headers: auth });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json()).toEqual({ error: "subject_analysis_not_found" });

    vi.mocked(repository.selectSubjectImage!).mockRejectedValueOnce(new Error("subject_analysis_not_found"));
    const hiddenSelection = await app.inject({
      method: "PATCH",
      url: `/brands/${brandId}/ai-content/subject-analyses/${analysisId}/selection`,
      headers: auth,
      payload: { imageId: "other-brand-image" },
    });
    expect(hiddenSelection.statusCode).toBe(404);
    await app.close();
  });
});
