import { describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer.js";
import type { ApiRepository } from "./types.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const brandId = "22222222-2222-4222-8222-222222222222";
const generationId = "33333333-3333-4333-8333-333333333333";
const outputId = "44444444-4444-4444-8444-444444444444";
const analysisId = "55555555-5555-4555-8555-555555555555";

function subjectAnalysis(status: "queued" | "ready" | "partial" = "queued") {
  return {
    id: analysisId,
    workspaceId,
    brandId,
    subjectType: "product" as const,
    sourceUrl: "https://example.com/product",
    normalizedUrl: "https://example.com/product",
    input: { name: "제품", promotion: "", description: "설명" },
    status,
    facts: [],
    structuredData: {},
    research: {},
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
    sendAiContentToPublish: vi.fn(async () => ({ publishGroupId: "publish-group-1", channelOutputId: "channel-output-1" })),
    getCachedSubjectAnalysis: vi.fn(async () => subjectAnalysis("ready")),
    requestSubjectAnalysis: vi.fn(async () => subjectAnalysis("queued")),
    getSubjectAnalysis: vi.fn(async () => subjectAnalysis("ready")),
    selectSubjectImage: vi.fn(async () => subjectAnalysis("ready")),
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

  it("downloads a completed output package and hands card news to publish management", async () => {
    const { app, repository } = setup();
    const download = await app.inject({ method: "GET", url: `/brands/${brandId}/ai-content/outputs/${outputId}/download`, headers: auth });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain("application/zip");
    expect(repository.downloadAiContentOutput).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, brandId, outputId, dailyDownloadLimit: 20 }));

    const publish = await app.inject({ method: "POST", url: `/brands/${brandId}/ai-content/outputs/${outputId}/publish`, headers: auth });
    expect(publish.statusCode).toBe(200);
    expect(publish.json()).toEqual({ publishGroupId: "publish-group-1", channelOutputId: "channel-output-1" });
    expect(repository.sendAiContentToPublish).toHaveBeenCalledWith({ workspaceId, brandId, outputId });
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
