import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer";
import { StoryCapabilityRequiredError } from "./repository";
import type { ApiRepository, InstagramFormatSettingsInput, PublishResultDto, SourceSnapshotDto } from "./types";

const brandId = "11111111-1111-1111-1111-111111111111";

afterEach(() => {
  vi.unstubAllGlobals();
});

function createRepository(): ApiRepository {
  return {
    health: vi.fn(async () => ({ database: "ok" as const })),
    getBillingSummary: vi.fn(async () => ({
      configured: false,
      subscription: {
        status: "none" as const,
        planName: null,
        monthlyAmount: null,
        currency: "KRW" as const,
        currentPeriodEnd: null,
        nextBillingAt: null,
        cancelAtPeriodEnd: false,
        suspensionReason: null
      },
      entitlement: { active: false, source: null, expiresAt: null },
      paymentMethod: null,
      payments: []
    })),
    getBrandUiStatus: vi.fn(async () => ({
      brandId,
      brandName: "제주 여행 상담 브랜드",
      lastGeneratedAt: null,
      navigation: {
        onboardingRemaining: 3,
        contentReview: 0,
        publishIssues: 0,
        channelIssues: 2
      },
      onboarding: {
        completedCount: 6,
        totalCount: 9,
        remainingCount: 3,
        steps: []
      }
    })),
    getBrandProfile: vi.fn(async () => ({
      id: "profile-1",
      brandId,
      name: "제주 여행 상담 브랜드",
      industry: "여행 서비스",
      primaryCustomer: "일본 여행을 처음 준비하는 20-40대",
      description: "여행 상담 브랜드",
      tone: "친절한 전문가",
      defaultCta: "무료 상담 신청하기",
      mainLink: "https://example.com",
      autoApprovalEnabled: false
    })),
    updateBrandProfile: vi.fn(async (_brandId, body) => ({
      id: "profile-1",
      brandId,
      name: body.name ?? "제주 여행 상담 브랜드",
      industry: body.industry ?? "여행 서비스",
      primaryCustomer: body.primaryCustomer ?? "일본 여행을 처음 준비하는 20-40대",
      description: body.description ?? "여행 상담 브랜드",
      tone: body.tone ?? "친절한 전문가",
      defaultCta: body.defaultCta ?? "무료 상담 신청하기",
      mainLink: body.mainLink ?? "https://example.com",
      autoApprovalEnabled: body.autoApprovalEnabled ?? false
    })),
    listInstagramFormats: vi.fn(async () => ({
      brandId,
      brandColor: "#123456",
      formats: [
        { format: "instagram_feed_carousel" as const, enabled: true, rotationOrder: 1, capabilityStatus: "available" as const, capabilityCheckedAt: null, capabilityMetadata: {}, lastError: null },
        { format: "instagram_story" as const, enabled: false, rotationOrder: 2, capabilityStatus: "unchecked" as const, capabilityCheckedAt: null, capabilityMetadata: {}, lastError: null },
        { format: "instagram_reel" as const, enabled: false, rotationOrder: 3, capabilityStatus: "unchecked" as const, capabilityCheckedAt: null, capabilityMetadata: {}, lastError: null }
      ]
    })),
    updateInstagramFormats: vi.fn(async (_brandId, body: InstagramFormatSettingsInput) => ({
      brandId,
      brandColor: body.brandColor === undefined ? "#123456" : body.brandColor?.trim() || null,
      formats: [
        { format: "instagram_feed_carousel" as const, enabled: body.formats?.find((item) => item.format === "instagram_feed_carousel")?.enabled ?? true, rotationOrder: 1, capabilityStatus: "available" as const, capabilityCheckedAt: null, capabilityMetadata: {}, lastError: null },
        { format: "instagram_story" as const, enabled: body.formats?.find((item) => item.format === "instagram_story")?.enabled ?? false, rotationOrder: 2, capabilityStatus: "unchecked" as const, capabilityCheckedAt: null, capabilityMetadata: {}, lastError: null },
        { format: "instagram_reel" as const, enabled: body.formats?.find((item) => item.format === "instagram_reel")?.enabled ?? false, rotationOrder: 3, capabilityStatus: "unchecked" as const, capabilityCheckedAt: null, capabilityMetadata: {}, lastError: null }
      ]
    })),
    checkInstagramCapability: vi.fn(async (_brandId, format) => ({
      format,
      enabled: false,
      rotationOrder: 2,
      capabilityStatus: "available" as const,
      capabilityCheckedAt: "2026-07-13T01:00:00.000Z",
      capabilityMetadata: { storyPublishVerified: true },
      lastError: null
    })),
    listSources: vi.fn(async () => []),
    listSourceSnapshots: vi.fn(async (): Promise<SourceSnapshotDto[]> => [{
      id: "snapshot-1",
      sourceUrlId: "source-1",
      sourceType: "owned",
      url: "https://example.com",
      title: "Example",
      status: "succeeded",
      fetchedAt: "2026-07-06T00:00:00.000Z",
      summary: "Example summary",
      errorMessage: null
    }]),
    createSource: vi.fn(async (_brandId, body) => ({
      id: "source-1",
      brandId,
      sourceType: body.sourceType,
      url: body.url,
      title: null,
      status: "active",
      enabled: true,
      lastCrawledAt: null,
      lastError: null
    })),
    createSourceWithInitialCrawl: vi.fn(async (_brandId, body) => ({
      source: {
        id: "source-1",
        brandId,
        sourceType: body.sourceType,
        url: body.url,
        title: null,
        status: "crawled",
        enabled: true,
        lastCrawledAt: "2026-07-12T00:00:00.000Z",
        lastError: null
      },
      initialCrawl: {
        id: "run-1",
        brandId,
        sourceUrlId: "source-1",
        trigger: "new_source" as const,
        status: "succeeded" as const,
        attempt: 0,
        processed: 1,
        created: 1,
        updated: 1,
        failed: 0,
        startedAt: "2026-07-12T00:00:00.000Z",
        finishedAt: "2026-07-12T00:00:01.000Z",
        nextRetryAt: null,
        lastError: null
      }
    })),
    crawlSingleSource: vi.fn(async () => ({
      id: "run-1", brandId, sourceUrlId: "source-1", trigger: "manual" as const, status: "succeeded" as const,
      attempt: 0, processed: 1, created: 1, updated: 1, failed: 0,
      startedAt: "2026-07-12T00:00:00.000Z", finishedAt: "2026-07-12T00:00:01.000Z",
      nextRetryAt: null, lastError: null
    })),
    crawlDueSources: vi.fn(async () => ({
      brandsSelected: 0, runsStarted: 0, processed: 0, created: 0, updated: 0, failed: 0, status: "succeeded" as const
    })),
    listSourceCrawlRuns: vi.fn(async () => []),
    updateSource: vi.fn(async (_sourceId, body) => ({
      id: "source-1",
      brandId,
      sourceType: body.sourceType ?? "owned",
      url: body.url ?? "https://example.com",
      title: null,
      status: "active",
      enabled: true,
      lastCrawledAt: null,
      lastError: null
    })),
    deleteSource: vi.fn(async (sourceId) => ({ id: sourceId })),
    listChannels: vi.fn(async () => []),
    getChannelConnectionRequest: vi.fn(async () => ({
      id: "request-1",
      brandId,
      status: "draft",
      instagramHandle: "@brand",
      instagramProfileUrl: "https://instagram.com/brand",
      facebookPageUrl: "https://facebook.com/brand",
      metaBusinessName: "Brand Inc",
      threadsProfileUrl: null,
      contactName: "Kim",
      contactEmail: "kim@example.com",
      hasAdminAccess: true,
      requestNote: null,
      submittedAt: null,
      updatedAt: "2026-07-07T00:00:00.000Z"
    })),
    updateChannelConnectionRequest: vi.fn(async (_brandId, body) => ({
      id: "request-1",
      brandId,
      status: body.submit ? "submitted" : "draft",
      instagramHandle: body.instagramHandle ?? null,
      instagramProfileUrl: body.instagramProfileUrl ?? null,
      facebookPageUrl: body.facebookPageUrl ?? null,
      metaBusinessName: body.metaBusinessName ?? null,
      threadsProfileUrl: body.threadsProfileUrl ?? null,
      contactName: body.contactName ?? null,
      contactEmail: body.contactEmail ?? null,
      hasAdminAccess: body.hasAdminAccess ?? false,
      requestNote: body.requestNote ?? null,
      submittedAt: body.submit ? "2026-07-07T00:00:00.000Z" : null,
      updatedAt: "2026-07-07T00:00:00.000Z"
    })),
    saveChannelCredentials: vi.fn(async (_brandId, channel, body) => ({
      channel,
      status: "needs_attention",
      accountLabel: body.accountLabel ?? "연결 전",
      lastHealthyAt: null,
      lastPublishedAt: null,
      lastError: null
    })),
    checkChannel: vi.fn(async (_brandId, channel) => ({
      channel,
      status: "connected",
      accountLabel: "연결 계정",
      lastHealthyAt: "2026-07-06T00:00:00.000Z",
      lastPublishedAt: null,
      lastError: null
    })),
    createSupportRequest: vi.fn(async (_brandId, body) => ({
      id: "support-1",
      brandId,
      workspaceId: "workspace-1",
      category: body.category,
      title: body.title,
      message: body.message,
      contactEmail: body.contactEmail ?? null,
      status: "new" as const,
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z"
    })),
    listSupportRequests: vi.fn(async () => []),
    updateSupportRequestStatus: vi.fn(async (requestId, status) => ({
      id: requestId,
      brandId,
      workspaceId: "workspace-1",
      category: "bug" as const,
      title: "채널 연결 오류",
      message: "인스타 연결이 실패합니다.",
      contactEmail: "user@example.com",
      status,
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:05:00.000Z"
    })),
    listContentOutputs: vi.fn(async () => []),
    reviewContentOutput: vi.fn(async (_outputId, action) => ({ id: _outputId, status: action === "approve" ? "approved" : "rejected" })),
    listPublishQueue: vi.fn(async () => []),
    listPublishResults: vi.fn(async (): Promise<PublishResultDto[]> => [{
      contentId: "master-1",
      title: "제주 가족 숙소 카드뉴스",
      generatedAt: "2026-07-08T01:00:00.000Z",
      sourceType: "mixed",
      sourceLabel: "가족 숙소 체크리스트",
      sourceDetail: "위치 중심 | 자사 FAQ 요약",
      sourceUrls: ["https://brand.example.com/faq"],
      channels: [{
        queueId: "queue-1",
        channelOutputId: "output-1",
        channel: "instagram",
        status: "published",
        publishedAt: "2026-07-08T02:30:00.000Z",
        failedAt: null,
        title: "인스타 카드뉴스",
        previewTitle: "제주 숙소 선택 기준",
        previewBody: "캡션 내용",
        outputJson: { caption: "캡션 내용" },
        artifactPublicUrl: "https://cdn.example.com/manifest.json",
        externalPostId: "ig-post-1",
        externalUrl: "https://instagram.com/p/ig-post-1",
        lastError: null,
        sourceSummary: "자사 FAQ 요약"
      }]
    }]),
    listTopicRows: vi.fn(async (_brandId, status) => [{
      id: "topic-row-1",
      uploadId: "upload-1",
      rowNumber: 2,
      status: status ?? "uploaded",
      topicTitle: "Jeju food",
      topicAngle: "local guide",
      targetCustomer: null,
      region: "Jeju",
      season: null,
      referenceUrl: null,
      priority: 10,
      notes: null,
      validationErrors: status === "skipped" ? ["duplicate_existing_topic"] : [],
      createdAt: "2026-07-06T00:00:00.000Z",
      usedAt: null
    }]),
    createTopicUpload: vi.fn(async (_brandId, body) => ({
      id: "upload-1",
      fileName: body.fileName,
      status: "validated",
      totalRows: 2,
      validRows: 1,
      duplicateRows: 0,
      invalidRows: 1
    })),
    createKnowledgeImport: vi.fn(async (_brandId, body) => ({
      id: "knowledge-import-1",
      fileName: body.fileName,
      status: "succeeded" as const,
      totalRows: 2,
      validRows: 2,
      duplicateRows: 0,
      invalidRows: 0,
      updatedRows: 2,
      createdAt: "2026-07-14T00:00:00.000Z"
    })),
    listKnowledgeImports: vi.fn(async () => []),
    enqueueWikiRefresh: vi.fn(async () => ({ id: "wiki-job-1", status: "queued" })),
    receiveInstagramWebhookMessage: vi.fn(async () => ({ status: "queued" as const, brandId, conversationId: "conversation-1", jobId: "dm-job-1" })),
    crawlSources: vi.fn(async () => ({ processed: 2, created: 2, updated: 2, failed: 0 })),
    generateContent: vi.fn(async () => ({ processed: 1, created: 3, updated: 1, failed: 0 })),
    runDailyGeneration: vi.fn(async () => ({ brandsSelected: 1, runsStarted: 1, processed: 1, created: 3, updated: 1, failed: 0, status: "succeeded" as const })),
    schedulePublishQueue: vi.fn(async () => ({ processed: 3, created: 0, updated: 3, failed: 0 })),
    runDuePublishing: vi.fn(async () => ({ processed: 1, created: 0, updated: 1, failed: 0 })),
    downloadPublishedResults: vi.fn(async () => ({
      fileName: "published-results.zip",
      mimeType: "application/zip" as const,
      buffer: Buffer.from("PK"),
      itemCount: 1
    })),
    publishQueueItem: vi.fn(async (queueId) => ({ id: queueId, status: "published", publishedUrl: "mock://instagram/queue-1" })),
    claimImageRenderJob: vi.fn(async () => null),
    heartbeatImageRenderJob: vi.fn(async (id) => ({ id, status: "running" })),
    completeImageRenderJob: vi.fn(async (id) => ({ id, status: "succeeded", artifactId: "artifact-1" })),
    failImageRenderJob: vi.fn(async (id) => ({ id, status: "queued" })),
    claimTextRenderJob: vi.fn(async () => null),
    heartbeatTextRenderJob: vi.fn(async (id) => ({ id, status: "running" })),
    completeTextRenderJob: vi.fn(async (id) => ({ id, status: "succeeded" })),
    failTextRenderJob: vi.fn(async (id) => ({ id, status: "queued" })),
    claimDmReplyJob: vi.fn(async () => null),
    heartbeatDmReplyJob: vi.fn(async (id) => ({ id, status: "running" })),
    completeDmReplyJob: vi.fn(async (id, input) => ({ id, status: "succeeded", decision: input.result.decision })),
    failDmReplyJob: vi.fn(async (id) => ({ id, status: "queued" })),
    heartbeatDmWorker: vi.fn(async (workerId) => ({ workerId }))
  };
}

describe("API server", () => {
  it("accepts a valid Kakao state from an earlier concurrent login attempt", async () => {
    const app = createServer({
      repository: createRepository(),
      kakaoAuth: {} as any,
      kakao: {
        restApiKey: "kakao-rest-api-key",
        redirectUri: "http://localhost:4000/auth/kakao/callback",
        frontendUrl: "http://127.0.0.1:5173"
      },
      logger: false
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    })));

    const firstLogin = await app.inject({ method: "GET", url: "/auth/kakao/login" });
    const secondLogin = await app.inject({ method: "GET", url: "/auth/kakao/login" });
    const firstState = new URL(String(firstLogin.headers.location)).searchParams.get("state");
    const firstCookie = String(firstLogin.headers["set-cookie"]).split(";", 1)[0];
    const secondCookie = String(secondLogin.headers["set-cookie"]).split(";", 1)[0];

    expect(firstState).not.toBeNull();
    expect(firstCookie).toMatch(/^bp_kakao_state_[0-9a-f-]+=1$/i);
    expect(secondCookie).toMatch(/^bp_kakao_state_[0-9a-f-]+=1$/i);

    const callback = await app.inject({
      method: "GET",
      url: `/auth/kakao/callback?code=invalid-test-code&state=${encodeURIComponent(firstState!)}`,
      headers: { cookie: `${firstCookie}; ${secondCookie}` }
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("http://127.0.0.1:5173/login?error=kakao_token_exchange_failed");
  });

  it("returns an unconfigured billing summary for a brand before payments are activated", async () => {
    const repository = createRepository() as any;
    repository.getBillingSummary = vi.fn(async () => ({
      configured: false,
      subscription: {
        status: "none",
        planName: null,
        monthlyAmount: null,
        currency: "KRW",
        currentPeriodEnd: null,
        nextBillingAt: null,
        cancelAtPeriodEnd: false,
        suspensionReason: null
      },
      entitlement: { active: false, source: null, expiresAt: null },
      paymentMethod: null,
      payments: []
    }));
    const app = createServer({ repository, logger: false });

    const response = await app.inject({ method: "GET", url: `/brands/${brandId}/billing/summary` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      configured: false,
      subscription: { status: "none" },
      entitlement: { active: false }
    });
  });

  it("rejects cron requests when CRON_SECRET is missing or invalid", async () => {
    const repository = createRepository();
    const app = createServer({ repository, cronSecret: "cron-secret", logger: false });

    expect((await app.inject({ method: "GET", url: "/internal/cron/source-crawl" })).statusCode).toBe(401);
    expect((await app.inject({
      method: "GET",
      url: "/internal/cron/source-crawl",
      headers: { authorization: "Bearer wrong" }
    })).statusCode).toBe(401);
  });

  it("runs automatic source crawling with the correct cron secret", async () => {
    const repository = createRepository();
    const app = createServer({ repository, cronSecret: "cron-secret", logger: false });

    const response = await app.inject({
      method: "GET",
      url: "/internal/cron/source-crawl",
      headers: { authorization: "Bearer cron-secret" }
    });

    expect(response.statusCode).toBe(200);
    expect(repository.crawlDueSources).toHaveBeenCalledTimes(1);
  });

  it("runs daily generation and due publishing only with the cron secret", async () => {
    const repository = createRepository();
    const app = createServer({ repository, cronSecret: "cron-secret", logger: false });

    expect((await app.inject({ method: "GET", url: "/internal/cron/daily-generation" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/internal/cron/publish-due" })).statusCode).toBe(401);

    const daily = await app.inject({ method: "GET", url: "/internal/cron/daily-generation", headers: { authorization: "Bearer cron-secret" } });
    const publish = await app.inject({ method: "GET", url: "/internal/cron/publish-due", headers: { authorization: "Bearer cron-secret" } });

    expect(daily.statusCode).toBe(200);
    expect(publish.statusCode).toBe(200);
    expect(repository.runDailyGeneration).toHaveBeenCalledTimes(1);
    expect(repository.runDuePublishing).toHaveBeenCalledTimes(1);
  });

  it("creates a source and performs its first crawl", async () => {
    const repository = createRepository();
    const app = createServer({ repository, logger: false });

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/sources`,
      payload: { sourceType: "owned", url: "https://example.com" }
    });

    expect(response.statusCode).toBe(201);
    expect(repository.createSourceWithInitialCrawl).toHaveBeenCalledWith(brandId, {
      sourceType: "owned",
      url: "https://example.com"
    });
  });

  it("logs structured internal errors without query strings or secret-bearing messages", async () => {
    const repository = createRepository();
    repository.health = vi.fn(async () => {
      throw new Error("database_failed:secret-token");
    });
    const logLines: string[] = [];
    const app = createServer({
      repository,
      logger: { level: "info", stream: { write: (line: string) => logLines.push(line) } }
    });

    const response = await app.inject({ method: "GET", url: "/health?access_token=secret-query" });

    expect(response.statusCode).toBe(500);
    expect(logLines.join("\n")).toContain("database_failed");
    expect(logLines.join("\n")).toContain("/health");
    expect(logLines.join("\n")).not.toContain("secret-token");
    expect(logLines.join("\n")).not.toContain("secret-query");
  });

  it("returns health state", async () => {
    const app = createServer({ repository: createRepository() });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, database: "ok" });
  });

  it("returns brand UI status for navigation and onboarding", async () => {
    const repository = createRepository() as ApiRepository & {
      getBrandUiStatus: ReturnType<typeof vi.fn>;
    };
    repository.getBrandUiStatus = vi.fn(async () => ({
      brandId,
      brandName: "동적 브랜드",
      lastGeneratedAt: "2026-07-06T01:00:00.000Z",
      navigation: {
        onboardingRemaining: 2,
        contentReview: 4,
        publishIssues: 1,
        channelIssues: 2
      },
      onboarding: {
        completedCount: 7,
        totalCount: 9,
        remainingCount: 2,
        steps: []
      }
    }));
    const app = createServer({ repository });

    const response = await app.inject({ method: "GET", url: `/brands/${brandId}/ui-status` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ brandName: "동적 브랜드" });
    expect(repository.getBrandUiStatus).toHaveBeenCalledWith(brandId);
  });

  it("allows browser preflight requests for source updates and deletes", async () => {
    const app = createServer({ repository: createRepository() });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/sources/source-1",
      headers: {
        origin: "http://127.0.0.1:5173",
        "access-control-request-method": "PUT"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain("PUT");
    expect(response.headers["access-control-allow-methods"]).toContain("DELETE");
  });

  it("reads and updates a brand profile", async () => {
    const repository = createRepository();
    const app = createServer({ repository });

    const getResponse = await app.inject({ method: "GET", url: `/brands/${brandId}/profile` });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json().name).toBe("제주 여행 상담 브랜드");

    const putResponse = await app.inject({
      method: "PUT",
      url: `/brands/${brandId}/profile`,
      payload: { name: "새 브랜드", autoApprovalEnabled: true }
    });

    expect(putResponse.statusCode).toBe(200);
    expect(putResponse.json()).toMatchObject({ name: "새 브랜드", autoApprovalEnabled: true });
    expect(repository.updateBrandProfile).toHaveBeenCalledWith(brandId, { name: "새 브랜드", autoApprovalEnabled: true });
  });

  it("rejects an industry or primary customer longer than 30 characters", async () => {
    const repository = createRepository();
    const app = createServer({ repository });

    const response = await app.inject({
      method: "PUT",
      url: `/brands/${brandId}/profile`,
      payload: { industry: "가".repeat(31), primaryCustomer: "나".repeat(31) }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "brand_profile_field_too_long" });
    expect(repository.updateBrandProfile).not.toHaveBeenCalled();
  });

  it("lists Instagram format settings in repository order", async () => {
    const repository = createRepository();
    const app = createServer({ repository });

    const response = await app.inject({ method: "GET", url: `/brands/${brandId}/instagram-formats` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      brandId,
      brandColor: "#123456",
      formats: [
        { format: "instagram_feed_carousel", rotationOrder: 1 },
        { format: "instagram_story", rotationOrder: 2 },
        { format: "instagram_reel", rotationOrder: 3 }
      ]
    });
    expect(repository.listInstagramFormats).toHaveBeenCalledWith(brandId);
  });

  it("redacts secret-looking capability metadata from the Instagram formats response", async () => {
    const repository = createRepository();
    vi.mocked(repository.listInstagramFormats).mockResolvedValueOnce({
      brandId,
      brandColor: null,
      formats: [{
        format: "instagram_story",
        enabled: false,
        rotationOrder: 2,
        capabilityStatus: "needs_attention",
        capabilityCheckedAt: null,
        capabilityMetadata: {
          apiVersion: "v20.0",
          scopesVerified: false,
          accessToken: "secret-token",
          encryptedPayload: "ciphertext-secret",
          token: "plain-secret",
          secret: "top-secret",
          nested: { token: "nested-secret" }
        },
        lastError: "scope_verification_required"
      }]
    });
    const app = createServer({ repository });

    const response = await app.inject({ method: "GET", url: `/brands/${brandId}/instagram-formats` });

    expect(response.statusCode).toBe(200);
    expect(response.json().formats[0].capabilityMetadata).toEqual({
      apiVersion: "v20.0",
      scopesVerified: false
    });
    expect(response.body).not.toContain("secret");
  });

  it.each([
    { input: "  #abcdef  ", expected: "#abcdef" },
    { input: "   ", expected: null },
    { input: null, expected: null }
  ])("normalizes brand color $input", async ({ input, expected }) => {
    const repository = createRepository();
    const app = createServer({ repository });

    const response = await app.inject({
      method: "PUT",
      url: `/brands/${brandId}/instagram-formats`,
      payload: { brandColor: input }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().brandColor).toBe(expected);
    expect(repository.updateInstagramFormats).toHaveBeenCalledWith(brandId, { brandColor: expected });
  });

  it("validates brand color length after trimming", async () => {
    const repository = createRepository();
    const app = createServer({ repository });

    const accepted = await app.inject({
      method: "PUT",
      url: `/brands/${brandId}/instagram-formats`,
      payload: { brandColor: `  ${"x".repeat(30)}  ` }
    });
    const rejected = await app.inject({
      method: "PUT",
      url: `/brands/${brandId}/instagram-formats`,
      payload: { brandColor: "x".repeat(31) }
    });

    expect(accepted.statusCode).toBe(200);
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toEqual({ error: "brand_color_too_long" });
  });

  it.each([
    { payload: {}, error: "instagram_formats_update_required" },
    { payload: { unrelated: true }, error: "instagram_formats_update_required" },
    { payload: { brandColor: 123 }, error: "invalid_brand_color" },
    { payload: { formats: "story" }, error: "invalid_instagram_formats" },
    { payload: { formats: [{ format: "instagram_story", enabled: "yes" }] }, error: "invalid_instagram_formats" },
    { payload: { formats: [{ format: "instagram_post", enabled: true }] }, error: "invalid_instagram_format" },
    { payload: { formats: [{ format: "instagram_story", enabled: true }, { format: "instagram_story", enabled: false }] }, error: "duplicate_instagram_format" },
    { payload: { formats: [{ format: "instagram_story", enabled: false, rotationOrder: 1 }] }, error: "instagram_rotation_order_read_only" },
    { payload: { rotationOrder: 1 }, error: "instagram_rotation_order_read_only" }
  ])("rejects invalid Instagram settings payloads with $error", async ({ payload, error }) => {
    const repository = createRepository();
    const app = createServer({ repository });

    const response = await app.inject({
      method: "PUT",
      url: `/brands/${brandId}/instagram-formats`,
      payload
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error });
    expect(repository.updateInstagramFormats).not.toHaveBeenCalled();
  });

  it("allows all Instagram formats to be disabled", async () => {
    const repository = createRepository();
    const app = createServer({ repository });
    const formats = [
      { format: "instagram_feed_carousel" as const, enabled: false },
      { format: "instagram_story" as const, enabled: false },
      { format: "instagram_reel" as const, enabled: false }
    ];

    const response = await app.inject({
      method: "PUT",
      url: `/brands/${brandId}/instagram-formats`,
      payload: { formats }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().formats.every((format: { enabled: boolean }) => !format.enabled)).toBe(true);
    expect(repository.updateInstagramFormats).toHaveBeenCalledWith(brandId, { formats });
  });

  it("maps the Story capability gate to a conflict without a partial HTTP success", async () => {
    const repository = createRepository();
    vi.mocked(repository.updateInstagramFormats).mockRejectedValueOnce(new StoryCapabilityRequiredError());
    const app = createServer({ repository });

    const response = await app.inject({
      method: "PUT",
      url: `/brands/${brandId}/instagram-formats`,
      payload: {
        brandColor: "#abcdef",
        formats: [{ format: "instagram_story", enabled: true }]
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "story_capability_required" });
  });

  it("checks Story capability through the local repository evaluator", async () => {
    const repository = createRepository();
    const app = createServer({ repository });

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/instagram-formats/instagram_story/check`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ format: "instagram_story", capabilityStatus: "available" });
    expect(repository.checkInstagramCapability).toHaveBeenCalledWith(brandId, "instagram_story");
  });

  it.each([
    { format: "instagram_feed_carousel", error: "instagram_capability_check_not_supported" },
    { format: "instagram_reel", error: "instagram_capability_check_not_supported" },
    { format: "instagram_post", error: "invalid_instagram_format" }
  ])("rejects unsupported capability check path $format", async ({ format, error }) => {
    const repository = createRepository();
    const app = createServer({ repository });

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/instagram-formats/${format}/check`
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error });
    expect(repository.checkInstagramCapability).not.toHaveBeenCalled();
  });

  it("creates sources and validates required fields", async () => {
    const app = createServer({ repository: createRepository() });

    const invalid = await app.inject({ method: "POST", url: `/brands/${brandId}/sources`, payload: { sourceType: "owned" } });
    expect(invalid.statusCode).toBe(400);

    const valid = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/sources`,
      payload: { sourceType: "owned", url: "https://example.com" }
    });

    expect(valid.statusCode).toBe(201);
    expect(valid.json()).toMatchObject({
      source: { sourceType: "owned", url: "https://example.com" },
      initialCrawl: { trigger: "new_source", status: "succeeded" }
    });
  });

  it("updates and deletes source URLs", async () => {
    const repository = createRepository();
    const app = createServer({ repository });

    const update = await app.inject({
      method: "PUT",
      url: "/sources/source-1",
      payload: { sourceType: "reference", url: "https://example.com/report" }
    });
    const remove = await app.inject({ method: "DELETE", url: "/sources/source-1" });

    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({ sourceType: "reference", url: "https://example.com/report" });
    expect(repository.updateSource).toHaveBeenCalledWith("source-1", { sourceType: "reference", url: "https://example.com/report" });
    expect(remove.statusCode).toBe(200);
    expect(repository.deleteSource).toHaveBeenCalledWith("source-1");
  });

  it("retries a source and persists enabled state changes", async () => {
    const repository = createRepository();
    const app = createServer({ repository });

    const retry = await app.inject({ method: "POST", url: `/brands/${brandId}/sources/source-1/crawl` });
    const disable = await app.inject({ method: "PUT", url: "/sources/source-1", payload: { enabled: false } });

    expect(retry.statusCode).toBe(200);
    expect(repository.crawlSingleSource).toHaveBeenCalledWith(brandId, "source-1", "manual");
    expect(disable.statusCode).toBe(200);
    expect(repository.updateSource).toHaveBeenCalledWith("source-1", { sourceType: undefined, url: undefined, enabled: false });
  });

  it("lists source crawl snapshots for the source queue", async () => {
    const repository = createRepository();
    const app = createServer({ repository });

    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/source-snapshots`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([expect.objectContaining({
      sourceType: "owned",
      url: "https://example.com",
      status: "succeeded",
      fetchedAt: "2026-07-06T00:00:00.000Z"
    })]);
    expect(repository.listSourceSnapshots).toHaveBeenCalledWith(brandId);
  });

  it("returns a conflict when a source URL duplicates an active source", async () => {
    const repository = createRepository();
    vi.mocked(repository.updateSource).mockRejectedValueOnce(Object.assign(new Error("duplicate"), {
      code: "23505",
      constraint: "source_urls_brand_type_hash_active_unique"
    }));
    const app = createServer({ repository });

    const response = await app.inject({
      method: "PUT",
      url: "/sources/source-1",
      payload: { sourceType: "owned", url: "https://example.com" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "source_url_duplicate" });
  });

  it("returns a bad request when the reference source URL limit is exceeded", async () => {
    const repository = createRepository();
    vi.mocked(repository.createSourceWithInitialCrawl).mockRejectedValueOnce(new Error("source_reference_limit_exceeded"));
    const app = createServer({ repository });

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/sources`,
      payload: { sourceType: "reference", url: "https://example.com/reference-11" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "source_reference_limit_exceeded" });
  });

  it("saves channel credentials and checks channel status", async () => {
    const repository = createRepository();
    const app = createServer({ repository });

    const saveResponse = await app.inject({
      method: "PUT",
      url: `/brands/${brandId}/channels/instagram/credentials`,
      payload: {
        accountLabel: "@brand",
        secretValue: "raw-token",
        scopes: ["instagram_basic", "instagram_content_publish"],
        scopesVerified: true,
        storyPublishVerified: true,
        verifiedCredentialId: "caller-controlled-id"
      }
    });
    expect(saveResponse.statusCode).toBe(200);
    expect(saveResponse.json()).toMatchObject({ channel: "instagram", accountLabel: "@brand" });
    expect(repository.saveChannelCredentials).toHaveBeenCalledWith(brandId, "instagram", expect.not.objectContaining({
      scopesVerified: expect.anything(),
      storyPublishVerified: expect.anything(),
      verifiedCredentialId: expect.anything()
    }));

    const checkResponse = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/channels/instagram/check`
    });
    expect(checkResponse.statusCode).toBe(200);
    expect(checkResponse.json()).toMatchObject({ channel: "instagram", status: "connected" });
  });

  it("accepts the Vercel Meta OAuth dev completion redirect and stores the token", async () => {
    const repository = createRepository();
    const kakaoAuth = {
      getSession: vi.fn(async () => ({
        userId: "user-1",
        displayName: "Growthline",
        email: null,
        workspaceId: "workspace-1",
        workspaceName: "Growthline의 Brand Pilot",
        brandId,
        brandName: "Growthline"
      }))
    } as any;
    const app = createServer({ repository, kakaoAuth });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/me/accounts")) {
        return new Response(JSON.stringify({
          data: [{
            id: "page-1",
            name: "Brand Pilot",
            access_token: "PAGE_TOKEN_123456",
            instagram_business_account: {
              id: "17890000000000000",
              username: "growthline352"
            }
          }]
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/me/permissions")) {
        return new Response(JSON.stringify({
          data: [
            { permission: "instagram_basic", status: "granted" },
            { permission: "instagram_content_publish", status: "granted" }
          ]
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: { message: "unexpected_url" } }), { status: 400, headers: { "content-type": "application/json" } });
    }));

    const response = await app.inject({
      method: "GET",
      url: "/auth/meta/dev-complete?access_token=EAAB1234567890&expires_in=3600&token_type=bearer",
      headers: { cookie: "bp_session=session-token" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Meta OAuth token received");
    expect(repository.saveChannelCredentials).toHaveBeenCalledWith(
      brandId,
      "instagram",
      expect.objectContaining({
        accountLabel: "@growthline352",
        connectionStatus: "connected",
        credentialType: "oauth",
        externalAccountId: "17890000000000000",
        maskedDisplay: "PAGE_T...3456",
        provider: "meta",
        scopes: ["instagram_basic", "instagram_content_publish"],
        secretValue: "PAGE_TOKEN_123456"
      })
    );
  });

  it("connects an Instagram Login account with a state-validated OAuth callback", async () => {
    const repository = createRepository();
    const app = createServer({
      repository,
      instagramLogin: {
        appId: "instagram-app-id",
        appSecret: "instagram-app-secret",
        redirectUri: "http://localhost:4000/auth/meta/callback",
        frontendUrl: "http://localhost:5173",
      },
      logger: false,
    });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "https://api.instagram.com/oauth/access_token") {
        return new Response(JSON.stringify({ access_token: "short-lived-token", expires_in: 3600 }), { status: 200 });
      }
      if (url.startsWith("https://graph.instagram.com/access_token")) {
        return new Response(JSON.stringify({ access_token: "long-lived-token", expires_in: 5_184_000 }), { status: 200 });
      }
      if (url.startsWith("https://graph.instagram.com/v23.0/me")) {
        return new Response(JSON.stringify({ id: "17890000000000000", username: "growthline352" }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { message: "unexpected_url" } }), { status: 400 });
    }));

    const start = await app.inject({ method: "GET", url: "/auth/meta/start" });
    expect(start.statusCode).toBe(302);
    const authorizeUrl = new URL(start.headers.location ?? "");
    expect(authorizeUrl.hostname).toBe("www.instagram.com");
    expect(authorizeUrl.searchParams.get("scope")).toContain("instagram_business_manage_messages");
    const state = authorizeUrl.searchParams.get("state");
    const stateCookie = String(start.headers["set-cookie"]);

    const callback = await app.inject({
      method: "GET",
      url: `/auth/meta/callback?code=oauth-code&state=${state}`,
      headers: { cookie: stateCookie },
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("http://localhost:5173/channels?instagram=connected");
    expect(repository.saveChannelCredentials).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000100",
      "instagram",
      expect.objectContaining({
        accountLabel: "@growthline352",
        authMode: "instagram_login",
        externalAccountId: "17890000000000000",
        secretValue: "long-lived-token",
      }),
    );
  });

  it("rejects Meta OAuth dev completion without an access token", async () => {
    const app = createServer({ repository: createRepository() });

    const response = await app.inject({
      method: "GET",
      url: "/auth/meta/dev-complete?status=connected"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "missing_access_token" });
  });

  it("reads and updates the customer channel connection request", async () => {
    const repository = createRepository();
    const app = createServer({ repository });

    const getResponse = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/channel-connection-request`
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toMatchObject({ instagramHandle: "@brand" });

    const putResponse = await app.inject({
      method: "PUT",
      url: `/brands/${brandId}/channel-connection-request`,
      payload: {
        instagramHandle: "@newbrand",
        instagramProfileUrl: "https://instagram.com/newbrand",
        facebookPageUrl: "https://facebook.com/newbrand",
        metaBusinessName: "New Brand",
        contactName: "Lee",
        contactEmail: "lee@example.com",
        hasAdminAccess: true,
        requestNote: "Please check the Instagram connection.",
        submit: true
      }
    });

    expect(putResponse.statusCode).toBe(200);
    expect(putResponse.json()).toMatchObject({ status: "submitted", instagramHandle: "@newbrand" });
    expect(repository.updateChannelConnectionRequest).toHaveBeenCalledWith(brandId, expect.objectContaining({
      instagramHandle: "@newbrand",
      contactEmail: "lee@example.com",
      submit: true
    }));
  });

  it("creates, lists, and updates support requests", async () => {
    const repository = createRepository() as ApiRepository & {
      createSupportRequest: ReturnType<typeof vi.fn>;
      listSupportRequests: ReturnType<typeof vi.fn>;
      updateSupportRequestStatus: ReturnType<typeof vi.fn>;
    };
    repository.createSupportRequest = vi.fn(async (_brandId, body) => ({
      id: "support-1",
      brandId,
      workspaceId: "workspace-1",
      category: body.category,
      title: body.title,
      message: body.message,
      contactEmail: body.contactEmail ?? null,
      status: "new" as const,
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z"
    }));
    repository.listSupportRequests = vi.fn(async () => [{
      id: "support-1",
      brandId,
      workspaceId: "workspace-1",
      category: "bug" as const,
      title: "채널 연결 오류",
      message: "인스타 연결이 실패합니다.",
      contactEmail: "user@example.com",
      status: "new" as const,
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z"
    }]);
    repository.updateSupportRequestStatus = vi.fn(async (requestId, status) => ({
      id: requestId,
      brandId,
      workspaceId: "workspace-1",
      category: "bug" as const,
      title: "채널 연결 오류",
      message: "인스타 연결이 실패합니다.",
      contactEmail: "user@example.com",
      status,
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:05:00.000Z"
    }));
    const app = createServer({ repository });

    const invalid = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/support-requests`,
      payload: { category: "bug", title: "제목만 있음" }
    });
    expect(invalid.statusCode).toBe(400);

    const created = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/support-requests`,
      payload: {
        category: "bug",
        title: "채널 연결 오류",
        message: "인스타 연결이 실패합니다.",
        contactEmail: "user@example.com"
      }
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ id: "support-1", status: "new", category: "bug" });
    expect(repository.createSupportRequest).toHaveBeenCalledWith(brandId, expect.objectContaining({
      category: "bug",
      title: "채널 연결 오류",
      message: "인스타 연결이 실패합니다."
    }));

    const list = await app.inject({ method: "GET", url: `/brands/${brandId}/support-requests` });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([expect.objectContaining({ id: "support-1", title: "채널 연결 오류" })]);

    const updated = await app.inject({
      method: "PATCH",
      url: "/support-requests/support-1",
      payload: { status: "resolved" }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ id: "support-1", status: "resolved" });
    expect(repository.updateSupportRequestStatus).toHaveBeenCalledWith("support-1", "resolved");
  });

  it("returns a preparation status for channels that are listed but not connectable yet", async () => {
    const app = createServer({ repository: createRepository() });

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/channels/youtube/check`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      channel: "youtube",
      status: "not_connected",
      accountLabel: "연결 전",
      lastError: "채널 연결 기능은 아직 준비 중입니다."
    });
  });

  it("rejects channel values that are not part of the channel catalog", async () => {
    const app = createServer({ repository: createRepository() });

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/channels/webflow/check`
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_channel" });
  });

  it("creates a topic upload from csv text", async () => {
    const app = createServer({ repository: createRepository() });

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/topic-uploads`,
      payload: {
        fileName: "topics.csv",
        csvText: "topic_title,topic_angle\nJeju food,local guide"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ fileName: "topics.csv", totalRows: 2, validRows: 1 });
  });

  it("rejects topic uploads without required csv headers", async () => {
    const app = createServer({ repository: createRepository() });

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/topic-uploads`,
      payload: {
        fileName: "topics.csv",
        csvText: "title,angle\nA,B"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "topic_upload_invalid_csv" });
  });

  it("imports FAQ data from a base64 file body", async () => {
    const repository = createRepository();
    const app = createServer({ repository });

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/knowledge-imports`,
      payload: {
        fileName: "faq.csv",
        fileBase64: Buffer.from("question,answer\n운영 시간,09-18\n").toString("base64")
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ fileName: "faq.csv", status: "succeeded" });
    expect(repository.createKnowledgeImport).toHaveBeenCalledWith(brandId, expect.objectContaining({ fileName: "faq.csv" }));
  });

  it("lists topic rows with an optional status filter", async () => {
    const repository = createRepository();
    const app = createServer({ repository });

    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/topic-rows?status=skipped`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([expect.objectContaining({
      id: "topic-row-1",
      status: "skipped",
      topicTitle: "Jeju food",
      validationErrors: ["duplicate_existing_topic"]
    })]);
    expect(repository.listTopicRows).toHaveBeenCalledWith(brandId, "skipped");
  });

  it("runs crawl, generation, scheduling, and mock publishing actions", async () => {
    const repository = createRepository();
    const app = createServer({ repository });

    const crawl = await app.inject({ method: "POST", url: `/brands/${brandId}/sources/crawl` });
    expect(crawl.statusCode).toBe(200);
    expect(crawl.json()).toMatchObject({ processed: 2, failed: 0 });
    expect(repository.crawlSources).toHaveBeenCalledWith(brandId);

    const generation = await app.inject({ method: "POST", url: `/brands/${brandId}/content-generation/run` });
    expect(generation.statusCode).toBe(200);
    expect(generation.json()).toMatchObject({ created: 3 });
    expect(repository.generateContent).toHaveBeenCalledWith(brandId);

    const schedule = await app.inject({ method: "POST", url: `/brands/${brandId}/publish-queue/schedule` });
    expect(schedule.statusCode).toBe(200);
    expect(schedule.json()).toMatchObject({ updated: 3 });
    expect(repository.schedulePublishQueue).toHaveBeenCalledWith(brandId);

    const publish = await app.inject({ method: "POST", url: "/publish-queue/queue-1/publish" });
    expect(publish.statusCode).toBe(200);
    expect(publish.json()).toMatchObject({ id: "queue-1", status: "published" });
    expect(repository.publishQueueItem).toHaveBeenCalledWith("queue-1");
  });

  it("lists publish results grouped by content for the completed tab", async () => {
    const repository = createRepository();
    const app = createServer({ repository });

    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/publish-results`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([expect.objectContaining({
      contentId: "master-1",
      channels: [expect.objectContaining({
        channel: "instagram",
        status: "published",
        previewBody: "캡션 내용"
      })]
    })]);
    expect(repository.listPublishResults).toHaveBeenCalledWith(brandId);
  });

  it("downloads published results as a zip package", async () => {
    const repository = createRepository();
    const app = createServer({ repository });

    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/publish-queue/download`
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/zip");
    expect(response.headers["content-disposition"]).toContain("published-results.zip");
    expect(response.headers["x-published-result-count"]).toBe("1");
    expect(response.rawPayload).toEqual(Buffer.from("PK"));
    expect(repository.downloadPublishedResults).toHaveBeenCalledWith(brandId);
  });
});
