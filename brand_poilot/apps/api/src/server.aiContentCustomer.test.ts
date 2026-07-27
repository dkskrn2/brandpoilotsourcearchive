import { describe, expect, it, vi } from "vitest";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import { createServer } from "./httpServer.js";
import type { ApiRepository } from "./types.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const brandId = "22222222-2222-4222-8222-222222222222";
const generationId = "33333333-3333-4333-8333-333333333333";
const outputId = "44444444-4444-4444-8444-444444444444";
const analysisId = "55555555-5555-4555-8555-555555555555";
const attachmentId = "66666666-6666-4666-8666-666666666666";
const sessionId = "77777777-7777-4777-8777-777777777777";
const actorUserId = "88888888-8888-4888-8888-888888888888";

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

function generation(
  status = "analyzing",
  type: "card_news" | "blog" | "marketing" = "card_news",
  title = "여름 추천",
  draft: Record<string, unknown> = {},
) {
  return {
    id: generationId,
    workspaceId,
    brandId,
    type,
    title,
    status,
    currentStage: "analysis",
    draft,
    analysis: {},
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    completedAt: null,
  };
}

function setup(
  allowed = true,
  options: {
    uploadSessionsEnabled?: boolean;
    actorUserId?: string | null;
    app?: FastifyInstance;
  } = {},
) {
  const events: string[] = [];
  const sessionExpiresAt = "2099-07-18T00:10:00.000Z";
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
    assertAiContentAttachmentUploadMutable: vi.fn(async () => undefined),
    createAiContentUploadSession: vi.fn(async (input) => {
      events.push("database");
      return {
        id: sessionId,
        generationId: input.generationId,
        workspaceId: input.workspaceId,
        brandId: input.brandId,
        createdByUserId: input.createdByUserId,
        nonce: "opaque-upload-nonce",
        ...input.attachment,
        storagePath: `workspaces/${workspaceId}/brands/${brandId}/ai-content/${generationId}/attachments/${sessionId}/attempt/product.png`,
        status: "pending" as const,
        tokenExpiresAt: sessionExpiresAt,
        createdAt: "2026-07-18T00:00:00.000Z",
      };
    }),
    failAiContentUploadSession: vi.fn(async () => undefined),
    confirmAiContentUploadSession: vi.fn(async (input, verify) => {
      const verified = await verify({
        id: input.sessionId,
        generationId,
        workspaceId,
        brandId,
        role: "product",
        fileName: "product.png",
        mimeType: "image/png",
        sizeBytes: 100,
        checksum: "a".repeat(64),
        storagePath: `workspaces/${workspaceId}/brands/${brandId}/ai-content/${generationId}/attachments/${sessionId}/attempt/product.png`,
        tokenExpiresAt: sessionExpiresAt,
      }, new AbortController().signal);
      return { id: attachmentId, generationId, role: "product", fileName: "product.png", checksum: "a".repeat(64), createdAt: "2026-07-18T00:00:00.000Z", ...verified };
    }),
    cancelAiContentUploadSession: vi.fn(async (input) => ({ id: input.sessionId })),
    confirmLegacyAiContentAttachment: vi.fn(async (input) => ({ id: attachmentId, generationId: input.generationId, role: input.role, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.sizeBytes, checksum: input.checksum, storageUrl: input.storageUrl, storagePath: input.storagePath, createdAt: "2026-07-18T00:00:00.000Z" })),
    removeAiContentAttachment: vi.fn(async (input) => ({ id: input.attachmentId })),
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
    getSession: vi.fn(async () => ({ userId: options.actorUserId ?? (options.actorUserId === null ? null : actorUserId), workspaceId, workspaceName: "Workspace", brandId, brandName: "Brand", displayName: "Tester", email: null })),
    canAccessBrand: vi.fn(async () => allowed),
  };
  const generateClientToken = vi.fn(async () => {
    events.push("provider");
    return "upload-token";
  });
  const headBlob = vi.fn(async (urlOrPath: string) => ({
    pathname: urlOrPath.startsWith("https:")
      ? new URL(urlOrPath).pathname.replace(/^\//, "")
      : urlOrPath,
    url: urlOrPath.startsWith("https:")
      ? urlOrPath
      : `https://test.public.blob.vercel-storage.com/${urlOrPath}`,
    size: 100,
    contentType: "image/png",
  } as never));
  const app = createServer({
    repository,
    kakaoAuth: kakaoAuth as never,
    aiContentUpload: {
      readWriteToken: "rw-token",
      generateClientToken,
      headBlob,
      uploadSessionsEnabled: options.uploadSessionsEnabled ?? false,
    },
    aiContentLimits: { dailyGenerationLimit: 10, dailyDownloadLimit: 20 },
    logger: false,
  }, options.app);
  return { app, repository, kakaoAuth, generateClientToken, events, sessionExpiresAt };
}

const auth = { cookie: "bp_session=session-1" };
const generationContractFixtures = [
  {
    type: "card_news",
    title: "여름 추천 카드뉴스",
    draft: { subjectType: "product", brief: { aspectRatio: "1:1" } },
    updatedDraft: { subjectType: "product", brief: { aspectRatio: "4:5" } },
    referenceIds: ["card-reference"],
    outputCount: 2,
  },
  {
    type: "blog",
    title: "여름 운영 블로그",
    draft: { subjectType: "service", brief: { aspectRatio: "16:9" } },
    updatedDraft: { subjectType: "service", brief: { aspectRatio: "1:1" } },
    referenceIds: ["blog-reference"],
    outputCount: 1,
  },
  {
    type: "marketing",
    title: "여름 프로모션 소재",
    draft: { subjectType: "product", brief: { aspectRatio: "9:16" } },
    updatedDraft: { subjectType: "product", brief: { aspectRatio: "1:1" } },
    referenceIds: ["marketing-reference"],
    outputCount: 3,
  },
] as const;

describe("AI content customer routes", () => {
  it("fails fast when configured upload routes lack a lifecycle dependency", async () => {
    const { app, repository } = setup();
    await app.close();
    const incompleteRepository: ApiRepository = {
      ...repository,
      failAiContentUploadSession: undefined,
    };

    expect(() => createServer({
      repository: incompleteRepository,
      aiContentUpload: { readWriteToken: "rw-token" },
      logger: false,
    })).toThrow("ai_content_upload_repository_not_configured");
  });

  it.each(generationContractFixtures)("locks the $type create, update, start, list, and get contracts", async (fixture) => {
    const { app, repository } = setup();
    const createdRecord = generation("analyzing", fixture.type, fixture.title, fixture.draft);
    vi.mocked(repository.createAiContentAnalysis).mockResolvedValueOnce(createdRecord);
    const create = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/generations`,
      headers: auth,
      payload: { type: fixture.type, title: fixture.title, draft: fixture.draft, idempotencyKey: `${fixture.type}-analysis` },
    });
    expect(create.statusCode).toBe(200);
    expect(create.json()).toEqual(createdRecord);
    expect(repository.createAiContentAnalysis).toHaveBeenCalledWith({
      workspaceId,
      brandId,
      type: fixture.type,
      title: fixture.title,
      draft: fixture.draft,
      idempotencyKey: `${fixture.type}-analysis`,
    });

    const updatedRecord = generation("analysis_ready", fixture.type, fixture.title, fixture.updatedDraft);
    vi.mocked(repository.updateAiContentDraft).mockResolvedValueOnce(updatedRecord);
    const update = await app.inject({
      method: "PATCH",
      url: `/brands/${brandId}/ai-content/generations/${generationId}`,
      headers: auth,
      payload: { draft: fixture.updatedDraft, referenceIds: fixture.referenceIds },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toEqual(updatedRecord);
    expect(repository.updateAiContentDraft).toHaveBeenCalledWith({
      workspaceId,
      brandId,
      generationId,
      draft: fixture.updatedDraft,
      referenceIds: fixture.referenceIds,
    });

    const startedRecord = generation("queued", fixture.type, fixture.title, fixture.updatedDraft);
    vi.mocked(repository.startAiContentGeneration).mockResolvedValueOnce(startedRecord);
    const start = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/generations/${generationId}/generate`,
      headers: auth,
      payload: { idempotencyKey: `${fixture.type}-generate`, outputCount: fixture.outputCount },
    });
    expect(start.statusCode).toBe(200);
    expect(start.json()).toEqual(startedRecord);
    expect(repository.startAiContentGeneration).toHaveBeenCalledWith({
      workspaceId,
      brandId,
      generationId,
      idempotencyKey: `${fixture.type}-generate`,
      outputCount: fixture.outputCount,
      usageDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      dailyGenerationLimit: 10,
    });

    vi.mocked(repository.listAiContentGenerations).mockResolvedValueOnce([startedRecord]);
    const list = await app.inject({ method: "GET", url: `/brands/${brandId}/ai-content/generations`, headers: auth });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([startedRecord]);
    expect(repository.listAiContentGenerations).toHaveBeenCalledWith({ workspaceId, brandId });

    vi.mocked(repository.getAiContentGeneration).mockResolvedValueOnce(startedRecord);
    const detail = await app.inject({ method: "GET", url: `/brands/${brandId}/ai-content/generations/${generationId}`, headers: auth });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toEqual(startedRecord);
    expect(repository.getAiContentGeneration).toHaveBeenCalledWith({ workspaceId, brandId, generationId });
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
    expect(tokenResponse.json()).toEqual({ pathname, clientToken: "upload-token" });
    expect(repository.assertAiContentAttachmentUploadMutable).toHaveBeenCalledWith({
      workspaceId,
      brandId,
      generationId,
    });
    expect(repository.createAiContentUploadSession).not.toHaveBeenCalled();
    expect(generateClientToken).toHaveBeenCalledOnce();

    const confirmed = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/generations/${generationId}/attachments/confirm`,
      headers: auth,
      payload: { ...attachment, storagePath: pathname, storageUrl: `https://test.public.blob.vercel-storage.com/${pathname}` },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(repository.confirmLegacyAiContentAttachment).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, brandId, generationId, storagePath: pathname }));
    await app.close();
  });

  it("creates the upload session before issuing its exact-path provider token", async () => {
    const { app, repository, generateClientToken, events, sessionExpiresAt } = setup(true, {
      uploadSessionsEnabled: true,
    });
    const attachment = { role: "product", fileName: "product.png", mimeType: "image/png", sizeBytes: 100, checksum: "a".repeat(64) };

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/generations/${generationId}/attachments/token`,
      headers: auth,
      payload: attachment,
    });

    expect(response.statusCode).toBe(200);
    const session = vi.mocked(repository.createAiContentUploadSession!).mock.results[0]!.value;
    const stored = await session;
    expect(events).toEqual(["database", "provider"]);
    expect(repository.createAiContentUploadSession).toHaveBeenCalledWith({
      workspaceId,
      brandId,
      generationId,
      createdByUserId: actorUserId,
      attachment,
    });
    expect(generateClientToken).toHaveBeenCalledWith(expect.objectContaining({
      pathname: stored.storagePath,
      allowedContentTypes: [stored.mimeType],
      maximumSizeInBytes: 5_000_000,
      validUntil: Date.parse(sessionExpiresAt) - 60_000,
    }));
    expect(response.json()).toEqual({
      contractVersion: "ai-content-attachment-upload.v2",
      sessionId,
      nonce: "opaque-upload-nonce",
      pathname: stored.storagePath,
      clientToken: "upload-token",
      uploadExpiresAt: new Date(Date.parse(sessionExpiresAt) - 60_000).toISOString(),
      sessionExpiresAt,
    });
    await app.close();
  });

  it.each([
    [
      "invalid checksum",
      { role: "product", fileName: "product.png", mimeType: "image/png", sizeBytes: 100, checksum: "not-a-sha256" },
      "ai_content_attachment_checksum_invalid",
    ],
    [
      "oversize image",
      { role: "product", fileName: "product.png", mimeType: "image/png", sizeBytes: 5_000_001, checksum: "a".repeat(64) },
      "ai_content_attachment_size_invalid",
    ],
    [
      "oversize document",
      { role: "document", fileName: "brief.pdf", mimeType: "application/pdf", sizeBytes: 10_000_001, checksum: "a".repeat(64) },
      "ai_content_attachment_size_invalid",
    ],
    [
      "unsupported role",
      { role: "avatar", fileName: "product.png", mimeType: "image/png", sizeBytes: 100, checksum: "a".repeat(64) },
      "ai_content_attachment_role_invalid",
    ],
    [
      "role and MIME mismatch",
      { role: "product", fileName: "brief.pdf", mimeType: "application/pdf", sizeBytes: 100, checksum: "a".repeat(64) },
      "ai_content_attachment_role_mime_invalid",
    ],
    [
      "unsafe filename",
      { role: "product", fileName: "../product.png", mimeType: "image/png", sizeBytes: 100, checksum: "a".repeat(64) },
      "ai_content_attachment_file_name_invalid",
    ],
  ])("rejects enabled session metadata before reservation: %s", async (_caseName, attachment, errorCode) => {
    const { app, repository, generateClientToken } = setup(true, { uploadSessionsEnabled: true });
    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/generations/${generationId}/attachments/token`,
      headers: auth,
      payload: attachment,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: errorCode });
    expect(repository.createAiContentUploadSession).not.toHaveBeenCalled();
    expect(generateClientToken).not.toHaveBeenCalled();
    await app.close();
  });

  it("normalizes enabled session metadata before reservation", async () => {
    const { app, repository } = setup(true, { uploadSessionsEnabled: true });
    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/generations/${generationId}/attachments/token`,
      headers: auth,
      payload: {
        role: "product",
        fileName: " product image.png ",
        mimeType: " IMAGE/PNG ",
        sizeBytes: 100,
        checksum: ` ${"A".repeat(64)} `,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(repository.createAiContentUploadSession).toHaveBeenCalledWith(expect.objectContaining({
      attachment: {
        role: "product",
        fileName: "product-image.png",
        mimeType: "image/png",
        sizeBytes: 100,
        checksum: "a".repeat(64),
      },
    }));
    await app.close();
  });

  it("marks an enabled session failed while preserving provider outage mapping", async () => {
    const logger = {
      level: "warn",
      fatal: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      silent: vi.fn(),
      child: vi.fn(),
    };
    logger.child.mockReturnValue(logger);
    const { app, repository, generateClientToken } = setup(true, {
      uploadSessionsEnabled: true,
      app: Fastify({
        logController: new LogController({ disableRequestLogging: true }),
        loggerInstance: logger as never,
      }) as unknown as FastifyInstance,
    });
    generateClientToken.mockRejectedValueOnce(new Error("provider-secret-sentinel"));
    vi.mocked(repository.failAiContentUploadSession!).mockRejectedValueOnce(
      new Error("compensation-secret-sentinel opaque-upload-nonce workspaces/private/path"),
    );

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/generations/${generationId}/attachments/token`,
      headers: auth,
      payload: { role: "product", fileName: "product.png", mimeType: "image/png", sizeBytes: 100, checksum: "a".repeat(64) },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "ai_content_attachment_storage_unavailable" });
    expect(repository.failAiContentUploadSession).toHaveBeenCalledWith({
      workspaceId,
      brandId,
      generationId,
      sessionId,
      createdByUserId: actorUserId,
      errorCode: "ai_content_attachment_storage_unavailable",
    });
    const compensationLogs = logger.warn.mock.calls
      .filter(([fields]) => (fields as Record<string, unknown>).event === "ai_content_upload_session_compensation_failed");
    const serializedLogs = JSON.stringify(compensationLogs);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(compensationLogs).toHaveLength(1);
    expect(compensationLogs[0]?.[0]).toMatchObject({
      event: "ai_content_upload_session_compensation_failed",
      requestId: expect.any(String),
      errorCode: "database_compensation_failed",
    });
    expect(Object.keys(compensationLogs[0]?.[0] as Record<string, unknown>).sort()).toEqual([
      "errorCode",
      "event",
      "requestId",
    ]);
    expect(compensationLogs[0]?.[1]).toBe("ai_content_upload_session_compensation_failed");
    expect(serializedLogs).not.toContain("provider-secret-sentinel");
    expect(serializedLogs).not.toContain("compensation-secret-sentinel");
    expect(serializedLogs).not.toContain("opaque-upload-nonce");
    expect(serializedLogs).not.toContain("workspaces/private/path");
    expect(serializedLogs).not.toContain("product.png");
    await app.close();
  });

  it.each([false, true])("routes a legacy confirmation to the legacy repository when issuance=%s", async (uploadSessionsEnabled) => {
    const { app, repository } = setup(true, { uploadSessionsEnabled });
    const attachment = { role: "product", fileName: "product.png", mimeType: "image/png", sizeBytes: 100, checksum: "a".repeat(64) };
    const pathname = `brands/${brandId}/ai-content/${generationId}/attachments/${attachment.checksum}-${attachment.fileName}`;
    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/generations/${generationId}/attachments/confirm`,
      headers: auth,
      payload: { ...attachment, storagePath: pathname, storageUrl: `https://test.public.blob.vercel-storage.com/${pathname}` },
    });

    expect(response.statusCode).toBe(200);
    expect(repository.confirmLegacyAiContentAttachment).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      brandId,
      generationId,
      storagePath: pathname,
    }));
    expect(repository.confirmAiContentUploadSession).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns not found for a missing tenant-scoped generation before legacy Blob verification", async () => {
    const { app, repository } = setup();
    vi.mocked(repository.getAiContentGeneration).mockResolvedValueOnce(null);
    const attachment = { role: "product", fileName: "product.png", mimeType: "image/png", sizeBytes: 100, checksum: "a".repeat(64) };
    const pathname = `brands/${brandId}/ai-content/${generationId}/attachments/${attachment.checksum}-${attachment.fileName}`;
    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/generations/${generationId}/attachments/confirm`,
      headers: auth,
      payload: { ...attachment, storagePath: pathname, storageUrl: `https://test.public.blob.vercel-storage.com/${pathname}` },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "ai_content_generation_not_found" });
    expect(repository.confirmLegacyAiContentAttachment).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([false, true])("returns a lock conflict before issuing a token when issuance=%s", async (uploadSessionsEnabled) => {
    const { app, repository, generateClientToken } = setup(true, { uploadSessionsEnabled });
    const method = uploadSessionsEnabled
      ? repository.createAiContentUploadSession!
      : repository.assertAiContentAttachmentUploadMutable!;
    vi.mocked(method).mockRejectedValueOnce(new Error("ai_content_attachments_locked"));

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/generations/${generationId}/attachments/token`,
      headers: auth,
      payload: { role: "product", fileName: "product.png", mimeType: "image/png", sizeBytes: 100, checksum: "a".repeat(64) },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "ai_content_attachments_locked" });
    expect(generateClientToken).not.toHaveBeenCalled();
    await app.close();
  });

  it("requires an actor for enabled issuance, confirmation, and cancellation", async () => {
    const { app, repository } = setup(true, { uploadSessionsEnabled: true, actorUserId: null });
    const requests = [
      app.inject({
        method: "POST",
        url: `/brands/${brandId}/ai-content/generations/${generationId}/attachments/token`,
        headers: auth,
        payload: { role: "product", fileName: "product.png", mimeType: "image/png", sizeBytes: 100, checksum: "a".repeat(64) },
      }),
      app.inject({
        method: "POST",
        url: `/brands/${brandId}/ai-content/generations/${generationId}/attachments/confirm`,
        headers: auth,
        payload: { sessionId, nonce: "opaque-upload-nonce" },
      }),
      app.inject({
        method: "POST",
        url: `/brands/${brandId}/ai-content/generations/${generationId}/attachments/cancel`,
        headers: auth,
        payload: { sessionId, nonce: "opaque-upload-nonce" },
      }),
    ];

    for (const response of await Promise.all(requests)) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "authentication_required" });
    }
    expect(repository.createAiContentUploadSession).not.toHaveBeenCalled();
    expect(repository.confirmAiContentUploadSession).not.toHaveBeenCalled();
    expect(repository.cancelAiContentUploadSession).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([false, true])("cancels an actor-bound upload session with an exact body when issuance=%s", async (uploadSessionsEnabled) => {
    const { app, repository } = setup(true, { uploadSessionsEnabled });
    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/generations/${generationId}/attachments/cancel`,
      headers: auth,
      payload: { sessionId, nonce: "opaque-upload-nonce" },
    });
    expect(response.statusCode).toBe(200);
    expect(repository.cancelAiContentUploadSession).toHaveBeenCalledWith({
      workspaceId,
      brandId,
      generationId,
      sessionId,
      nonce: "opaque-upload-nonce",
      createdByUserId: actorUserId,
    });
    await app.close();
  });

  it.each([
    ["ai_content_upload_session_not_found", 404],
    ["ai_content_upload_confirmation_conflict", 409],
    ["ai_content_attachment_limit_exceeded", 409],
    ["ai_content_attachments_locked", 409],
    ["ai_content_attachment_upload_in_progress", 409],
    ["ai_content_upload_session_expired", 410],
    ["ai_content_attachment_retention_expired", 410],
    ["ai_content_attachment_blob_unavailable", 422],
    ["ai_content_attachment_path_mismatch", 422],
    ["ai_content_attachment_size_mismatch", 422],
    ["ai_content_attachment_mime_mismatch", 422],
    ["ai_content_attachment_url_mismatch", 422],
    ["ai_content_attachment_storage_unavailable", 503],
    ["ai_content_attachment_verification_timeout", 503],
  ] as const)("maps lifecycle error %s to HTTP %s", async (errorCode, statusCode) => {
    const { app, repository } = setup(true, { uploadSessionsEnabled: true });
    vi.mocked(repository.cancelAiContentUploadSession!).mockRejectedValueOnce(new Error(errorCode));
    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/generations/${generationId}/attachments/cancel`,
      headers: auth,
      payload: { sessionId, nonce: "opaque-upload-nonce" },
    });
    expect(response.statusCode).toBe(statusCode);
    expect(response.json()).toEqual({ error: errorCode });
    await app.close();
  });

  it.each([
    [`/brands/not-a-uuid/ai-content/generations/${generationId}/attachments/token`, { role: "product", fileName: "product.png", mimeType: "image/png", sizeBytes: 100, checksum: "a".repeat(64) }, "ai_content_brand_id_invalid"],
    [`/brands/${brandId}/ai-content/generations/not-a-uuid/attachments/token`, { role: "product", fileName: "product.png", mimeType: "image/png", sizeBytes: 100, checksum: "a".repeat(64) }, "ai_content_generation_id_invalid"],
    [`/brands/${brandId}/ai-content/generations/${generationId}/attachments/cancel`, { sessionId: "not-a-uuid", nonce: "opaque-upload-nonce" }, "ai_content_upload_session_id_invalid"],
  ])("rejects malformed lifecycle IDs before repository access: %s", async (url, payload, errorCode) => {
    const { app, repository } = setup(true, { uploadSessionsEnabled: true });
    const response = await app.inject({ method: "POST", url, headers: auth, payload });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: errorCode });
    expect(repository.createAiContentUploadSession).not.toHaveBeenCalled();
    expect(repository.cancelAiContentUploadSession).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects a malformed lifecycle brand before the auth database check", async () => {
    const { app, kakaoAuth } = setup();
    kakaoAuth.canAccessBrand.mockRejectedValueOnce(
      new Error("auth-database-sentinel-must-not-run"),
    );
    const response = await app.inject({
      method: "POST",
      url: `/brands/not-a-uuid/ai-content/generations/${generationId}/attachments/token`,
      headers: auth,
      payload: { role: "product", fileName: "product.png", mimeType: "image/png", sizeBytes: 100, checksum: "a".repeat(64) },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "ai_content_brand_id_invalid" });
    expect(kakaoAuth.canAccessBrand).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects a malformed attachment ID before repository access", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "DELETE",
      url: `/brands/${brandId}/ai-content/generations/${generationId}/attachments/not-a-uuid`,
      headers: auth,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "ai_content_attachment_id_invalid" });
    expect(repository.removeAiContentAttachment).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([false, true])("accepts session confirmation during deployment skew when issuance=%s", async (uploadSessionsEnabled) => {
    const { app, repository } = setup(true, { uploadSessionsEnabled });
    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/generations/${generationId}/attachments/confirm`,
      headers: auth,
      payload: {
        sessionId,
        nonce: "opaque-upload-nonce",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(repository.confirmAiContentUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId, brandId, generationId, sessionId, createdByUserId: actorUserId }),
      expect.any(Function),
    );
    await app.close();
  });

  it("returns the aggregate attachment limit error from direct API confirmation", async () => {
    const { app, repository } = setup();
    vi.mocked(repository.confirmLegacyAiContentAttachment!).mockRejectedValueOnce(new Error("ai_content_attachment_limit_exceeded"));
    const attachment = { role: "product", fileName: "sixth.png", mimeType: "image/png", sizeBytes: 100, checksum: "b".repeat(64) };
    const tokenResponse = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/generations/${generationId}/attachments/token`,
      headers: auth,
      payload: attachment,
    });
    const { pathname } = tokenResponse.json();

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/generations/${generationId}/attachments/confirm`,
      headers: auth,
      payload: { ...attachment, storagePath: pathname, storageUrl: `https://test.public.blob.vercel-storage.com/${pathname}` },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "ai_content_attachment_limit_exceeded" });
    await app.close();
  });

  it("soft-deletes a confirmed attachment through the tenant-scoped generation route", async () => {
    const { app, repository } = setup();

    const response = await app.inject({
      method: "DELETE",
      url: `/brands/${brandId}/ai-content/generations/${generationId}/attachments/${attachmentId}`,
      headers: auth,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: attachmentId });
    expect(repository.removeAiContentAttachment).toHaveBeenCalledWith({
      workspaceId,
      brandId,
      generationId,
      attachmentId,
    });
    await app.close();
  });

  it.each(generationContractFixtures)("locks the $type retry contract", async (fixture) => {
    const { app, repository } = setup();
    const retriedRecord = generation("queued", fixture.type, fixture.title, fixture.updatedDraft);
    vi.mocked(repository.retryAiContentOutput).mockResolvedValueOnce(retriedRecord);
    const fixtureOutputId = `${fixture.type}-output`;
    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/outputs/${fixtureOutputId}/retry`,
      headers: auth,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(retriedRecord);
    expect(repository.retryAiContentOutput).toHaveBeenCalledWith({ workspaceId, brandId, outputId: fixtureOutputId });
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

  it("preserves the provider error code when the failed queue checkpoint has no error yet", async () => {
    const { app, repository } = setup();
    vi.mocked(repository.prepareAiContentPublish).mockResolvedValueOnce({
      publishGroupId: "publish-group-1",
      targets: [{
        channel: "instagram",
        deliveryFormat: "instagram_story",
        channelOutputId: "channel-output-story",
        queueId: "queue-story",
        status: "scheduled",
        publishedUrl: null,
        errorCode: null,
      }],
    });
    vi.mocked(repository.publishQueueItem).mockRejectedValueOnce(new Error("instagram_story_publish_failed:media_url_unreachable"));
    vi.mocked(repository.getAiContentPublishQueueResult).mockResolvedValueOnce({
      channel: "instagram",
      deliveryFormat: "instagram_story",
      channelOutputId: "channel-output-story",
      queueId: "queue-story",
      status: "failed",
      publishedUrl: null,
      errorCode: null,
    });

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/outputs/${outputId}/publish`,
      headers: auth,
      payload: {
        idempotencyKey: "b4b74082-8a44-46d6-91b6-3e3bd7e26be0",
        targets: [{ channel: "instagram", deliveryFormat: "instagram_story" }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      targets: [{
        queueId: "queue-story",
        status: "failed",
        errorCode: "instagram_story_publish_failed",
      }],
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

  it("rejects legacy reanalysis for a generation-scoped v2 analysis", async () => {
    const { app, repository } = setup();
    vi.mocked(repository.getSubjectAnalysis!).mockResolvedValueOnce(subjectAnalysisV2("ready") as never);

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/subject-analyses/${analysisId}/reanalyze`,
      headers: auth,
      payload: { idempotencyKey: "subject-v2-reanalyze" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "subject_analysis_v2_reanalyze_unsupported",
      supportedActions: ["generation_scoped_post", "appeals_regenerate"],
    });
    expect(repository.requestSubjectAnalysis).not.toHaveBeenCalled();
    await app.close();
  });

  it("filters internal v2 fields from image selection responses", async () => {
    const { app, repository } = setup();
    vi.mocked(repository.selectSubjectImage!).mockResolvedValueOnce(subjectAnalysisV2("ready") as never);

    const response = await app.inject({
      method: "PATCH",
      url: `/brands/${brandId}/ai-content/subject-analyses/${analysisId}/selection`,
      headers: auth,
      payload: { imageId: "image-1" },
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
    expect(response.json()).not.toHaveProperty("leasedBy");
    expect(response.json()).not.toHaveProperty("idempotencyKey");
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
