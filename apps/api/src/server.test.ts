import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer";
import { registerAdminRoutes } from "./adminServer";
import { StoryCapabilityRequiredError } from "./repository";
import type { ApiRepository, InstagramFormatSettingsInput, InstagramTrendPageDto, PublishResultDto, SourceSnapshotDto } from "./types";

const brandId = "11111111-1111-1111-1111-111111111111";

const instagramTrendPage: InstagramTrendPageDto = {
  hashtag: { id: "hashtag-1", displayTag: "콘텐츠마케팅", normalizedTag: "콘텐츠마케팅" },
  source: "meta",
  refreshed: true,
  refreshedAt: "2026-07-15T01:00:00.000Z",
  lastErrorCode: null,
  page: 1,
  pageSize: 20,
  total: 1,
  items: [{
    id: "media-1",
    instagramMediaId: "instagram-media-1",
    username: "creator",
    caption: "caption",
    kind: "reel",
    mediaUrl: "https://cdn.example.com/reel.mp4",
    previewUrl: "https://cdn.example.com/preview.jpg",
    permalink: "https://www.instagram.com/reel/example/",
    postedAt: "2026-07-14T01:00:00.000Z",
    likeCount: 100,
    commentsCount: 10,
    metaRank: 1,
    refreshedAt: "2026-07-15T01:00:00.000Z",
    isSaved: false
  }]
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function createRepository(): ApiRepository {
  return {
    health: vi.fn(async () => ({ database: "ok" as const })),
    getAiContentBrandContext: vi.fn(async () => ({ ready: true, brandName: "Growthline", ownedUrl: "https://example.com", sourceStatus: "crawled", lastCrawledAt: null, wikiVersionId: "wiki-1", wikiUpdatedAt: null, summary: "자사 분석", pageCount: 1, context: {} })),
    createAiContentAnalysis: vi.fn(async () => { throw new Error("not_implemented"); }),
    updateAiContentDraft: vi.fn(async () => { throw new Error("not_implemented"); }),
    startAiContentGeneration: vi.fn(async () => { throw new Error("not_implemented"); }),
    listAiContentGenerations: vi.fn(async () => []),
    getAiContentGeneration: vi.fn(async () => null),
    listAiContentUsage: vi.fn(async (_input) => ({ usageDate: _input.usageDate, generationCount: 0, downloadCount: 0 })),
    listAiContentReferences: vi.fn(async () => []),
    listBrandAudiences: vi.fn(async () => []),
    saveBrandAudience: vi.fn(async () => { throw new Error("not_implemented"); }),
    listBrandAppeals: vi.fn(async () => []),
    saveBrandAppeal: vi.fn(async () => { throw new Error("not_implemented"); }),
    confirmAiContentAttachment: vi.fn(async () => { throw new Error("not_implemented"); }),
    claimAiContentJob: vi.fn(async () => null),
    heartbeatAiContentJob: vi.fn(async () => false),
    completeAiContentJob: vi.fn(async () => { throw new Error("not_implemented"); }),
    failAiContentJob: vi.fn(async () => { throw new Error("not_implemented"); }),
    retryAiContentOutput: vi.fn(async () => { throw new Error("not_implemented"); }),
    downloadAiContentOutput: vi.fn(async () => ({ fileName: "result.zip", mimeType: "application/zip" as const, buffer: Buffer.from("PK"), itemCount: 1 })),
    downloadAiContentGeneration: vi.fn(async () => ({ fileName: "results.zip", mimeType: "application/zip" as const, buffer: Buffer.from("PK"), itemCount: 1 })),
    sendAiContentToPublish: vi.fn(async () => ({ publishGroupId: "publish-group-1", channelOutputId: "channel-output-1" })),
    prepareAiContentPublish: vi.fn(async () => ({ publishGroupId: "publish-group-1", targets: [] })),
    getAiContentPublishQueueResult: vi.fn(async (input) => ({
      channel: "instagram" as const,
      deliveryFormat: "instagram_story" as const,
      channelOutputId: "channel-output-1",
      queueId: input.queueId,
      status: "scheduled" as const,
      publishedUrl: null,
      errorCode: null,
    })),
    getDashboard: vi.fn(async () => ({
      period: "30d" as const,
      generatedAt: "2026-07-16T03:00:00.000Z",
      lastCollectedAt: null,
      summary: { publishedCount: 0, exposureCount: null, pendingReviewCount: 0, failedPublishCount: 0 },
      workflow: { queuedTopics: 0, generating: 0, pendingReview: 0, scheduledOrPublished: 0 },
      dailyExposure: [],
      channelPerformance: [],
      topContents: [],
      attentionItems: []
    })),
    listContentCategories: vi.fn(async () => []),
    getInstagramChannelIdentity: vi.fn(async () => ({ externalAccountId: "17890000000000000", accountLabel: "@growthline352" })),
    getInstagramTrendConnection: vi.fn(async () => ({
      status: "not_connected" as const,
      accountLabel: null,
      instagramBusinessAccountId: null,
      scopes: [],
      expiresAt: null,
      lastErrorCode: null,
    })),
    saveInstagramTrendCredentials: vi.fn(async (_brandId, input) => ({
      status: "connected" as const,
      accountLabel: input.accountLabel,
      instagramBusinessAccountId: input.instagramBusinessAccountId,
      scopes: input.scopes,
      expiresAt: input.expiresAt,
      lastErrorCode: null,
    })),
    listInstagramTrends: vi.fn(async () => { throw new Error("not_implemented"); }),
    searchInstagramTrends: vi.fn(async () => { throw new Error("not_implemented"); }),
    listInstagramTrendSearches: vi.fn(async () => []),
    deleteInstagramTrendSearch: vi.fn(async (_brandId, hashtagId) => ({ hashtagId })),
    listInstagramTrendArchive: vi.fn(async () => ({ items: [], page: 1, limit: 30, total: 0 })),
    setInstagramTrendFavorite: vi.fn(async (_brandId, hashtagId, input) => ({
      hashtagId,
      displayTag: "마케팅",
      isFavorite: input.isFavorite,
      lastSearchedAt: "2026-07-15T00:00:00.000Z",
      searchCount: 1
    })),
    saveInstagramTrendSource: vi.fn(async () => { throw new Error("not_implemented"); }),
    removeInstagramTrendSource: vi.fn(async (_brandId, mediaId) => ({ mediaId, removed: true })),
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
      logoUrl: null,
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
      primaryCategory: { code: "travel_tourism", name: "여행·관광" },
      subcategories: [],
      primaryCustomer: "일본 여행을 처음 준비하는 20-40대",
      description: "여행 상담 브랜드",
      tone: "친절한 전문가",
      defaultCta: "무료 상담 신청하기",
      mainLink: "https://example.com",
      autoApprovalEnabled: false,
      logoUrl: null
    })),
    updateBrandProfile: vi.fn(async (_brandId, body) => ({
      id: "profile-1",
      brandId,
      name: body.name ?? "제주 여행 상담 브랜드",
      primaryCategory: body.primaryCategoryCode === null
        ? null
        : body.primaryCategoryCode
          ? { code: body.primaryCategoryCode, name: "비즈니스·전문 서비스" }
          : { code: "travel_tourism", name: "여행·관광" },
      subcategories: body.subcategories?.map((item: { type: "system"; code: string } | { type: "custom"; name: string }) => item.type === "system"
        ? { type: "system" as const, code: item.code, name: "마케팅 컨설팅" }
        : { type: "custom" as const, code: null, name: item.name }) ?? [],
      primaryCustomer: body.primaryCustomer ?? "일본 여행을 처음 준비하는 20-40대",
      description: body.description ?? "여행 상담 브랜드",
      tone: body.tone ?? "친절한 전문가",
      defaultCta: body.defaultCta ?? "무료 상담 신청하기",
      mainLink: body.mainLink ?? "https://example.com",
      autoApprovalEnabled: body.autoApprovalEnabled ?? false,
      logoUrl: null
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
    updateChannelEnabled: vi.fn(async (_brandId, channel, enabled) => ({
      channel,
      enabled,
      oauthState: "not_connected" as const,
      status: "not_connected" as const,
      accountLabel: "연결 전",
      lastHealthyAt: null,
      lastPublishedAt: null,
      lastError: null
    })),
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
      enabled: true,
      oauthState: "needs_attention" as const,
      status: "needs_attention" as const,
      accountLabel: body.accountLabel ?? "연결 전",
      lastHealthyAt: null,
      lastPublishedAt: null,
      lastError: null
    })),
    checkChannel: vi.fn(async (_brandId, channel) => channel === "instagram" ? ({
      channel,
      enabled: true,
      oauthState: "connected" as const,
      status: "connected" as const,
      accountLabel: "연결 계정",
      lastHealthyAt: "2026-07-06T00:00:00.000Z",
      lastPublishedAt: null,
      lastError: null
    }) : ({
      channel,
      enabled: false,
      oauthState: "not_connected" as const,
      status: "not_connected" as const,
      accountLabel: "연결 전",
      lastHealthyAt: null,
      lastPublishedAt: null,
      lastError: "채널 연결 기능은 아직 준비 중입니다."
    })),
    createSupportRequest: vi.fn(async (_brandId, body) => ({
      id: "support-1",
      brandId,
      workspaceId: "workspace-1",
      category: body.category,
      title: body.title,
      message: body.message,
      contactPhone: body.contactPhone,
      contactEmail: body.contactEmail ?? null,
      status: "new" as const,
      responseMessage: null,
      respondedAt: null,
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
      contactPhone: "010-1234-5678",
      contactEmail: "user@example.com",
      status,
      responseMessage: null,
      respondedAt: null,
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:05:00.000Z"
    })),
    respondToSupportRequest: vi.fn(async (requestId, responseMessage) => ({
      id: requestId,
      brandId,
      workspaceId: "workspace-1",
      category: "bug" as const,
      title: "채널 연결 오류",
      message: "인스타 연결이 실패합니다.",
      contactPhone: "010-1234-5678",
      contactEmail: "user@example.com",
      status: "resolved" as const,
      responseMessage,
      respondedAt: "2026-07-11T00:10:00.000Z",
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:10:00.000Z"
    })),
    createFeedbackSubmission: vi.fn(async (_brandId, body) => ({
      id: "feedback-1",
      brandId,
      workspaceId: "workspace-1",
      message: body.message,
      status: "new" as const,
      createdAt: "2026-07-22T08:00:00.000Z",
      updatedAt: "2026-07-22T08:00:00.000Z"
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
      entryType: body.entryType ?? "faq",
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
    getInstagramDmSettings: vi.fn(async () => ({ brandId, enabled: false, fallbackMessage: "담당자가 확인 후 안내드리겠습니다.", errorMessage: "잠시 후 다시 문의해 주세요.", wikiReady: false, messagePermissionReady: false, webhookStatus: "unchecked" as const, workerStatus: "unknown" as const })),
    updateInstagramDmSettings: vi.fn(async (_brandId, input) => ({ brandId, enabled: input.enabled ?? false, fallbackMessage: input.fallbackMessage ?? "담당자가 확인 후 안내드리겠습니다.", errorMessage: input.errorMessage ?? "잠시 후 다시 문의해 주세요.", wikiReady: true, messagePermissionReady: true, webhookStatus: "connected" as const, workerStatus: "online" as const })),
    listInstagramDmHistory: vi.fn(async () => []),
    listDmConversations: vi.fn(async () => ({ items: [], nextCursor: null })),
    getDmConversation: vi.fn(async (_brandId, conversationId) => ({
      id: conversationId,
      participant: { instagramScopedId: "participant-1", displayName: "사용자-pant-1", username: null, profileImageUrl: null },
      lastMessage: null,
      automationStatus: "active" as const,
      attentionStatus: "none" as const,
      openAttentionTypes: [],
      unreadCount: 0,
      messages: [],
      attentionItems: [],
    })),
    sendManualDmReply: vi.fn(async (_brandId, _conversationId, body) => ({
      id: "message-manual",
      direction: "outbound" as const,
      messageType: "text",
      body,
      decision: null,
      reasonCode: "system_event" as const,
      sourceLabel: null,
      confidence: null,
      deliveryStatus: "sent" as const,
      createdAt: "2026-07-16T01:00:00.000Z",
    })),
    listDmAttentionItems: vi.fn(async () => []),
    resolveDmAttentionItem: vi.fn(async () => ({ conversationId: "conversation-1", automationStatus: "active" as const, attentionStatus: "resolved" as const })),
    getWikiStatus: vi.fn(async () => ({ activeVersion: null, latestFailedVersion: null, importStats: { total: 0, succeeded: 0, failed: 0, faqRows: 0, productRows: 0 } })),
    crawlSources: vi.fn(async () => ({ processed: 2, created: 2, updated: 2, failed: 0 })),
    generateContent: vi.fn(async () => ({ processed: 1, created: 3, updated: 1, failed: 0 })),
    runDailyGeneration: vi.fn(async () => ({ brandsSelected: 1, runsStarted: 1, processed: 1, created: 3, updated: 1, failed: 0, status: "succeeded" as const })),
    runDailyPerformanceSync: vi.fn(async () => ({ status: "not_due" as const, runDate: "2026-07-13", channelsSelected: 0, runsStarted: 0, targetCount: 0, successCount: 0, failureCount: 0 })),
    schedulePublishQueue: vi.fn(async () => ({ processed: 3, created: 0, updated: 3, failed: 0 })),
    runDuePublishing: vi.fn(async () => ({ processed: 1, created: 0, updated: 1, failed: 0 })),
    getPublishArtifact: vi.fn(async (queueId) => ({
      queueId,
      kind: "image_gallery" as const,
      deliveryFormat: "instagram_feed_carousel",
      assets: [{
        url: "https://cdn.example.com/card-01.png",
        fileName: "card-01.png",
        mimeType: "image/png",
        width: 1080,
        height: 1080
      }],
      posterUrl: null,
      html: null,
      text: null
    })),
    getContentOutputArtifact: vi.fn(async (outputId) => ({
      queueId: outputId,
      kind: "image_gallery" as const,
      deliveryFormat: "instagram_feed_carousel",
      assets: [{
        url: "https://cdn.example.com/card-01.png",
        fileName: "card-01.png",
        mimeType: "image/png",
        width: 1080,
        height: 1080
      }],
      posterUrl: null,
      html: null,
      text: null
    })),
    downloadPublishResult: vi.fn(async () => ({
      fileName: "queue-1.zip",
      mimeType: "application/zip" as const,
      buffer: Buffer.from("PK-queue-1"),
      itemCount: 1
    })),
    publishQueueItem: vi.fn(async (queueId) => ({ id: queueId, status: "published", publishedUrl: "mock://instagram/queue-1" })),
    retryPublishQueueItem: vi.fn(async (queueId) => ({ id: queueId, status: "queued" as const })),
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
    claimDmProfileRefreshJob: vi.fn(async () => null),
    runDmProfileRefreshJob: vi.fn(async (id) => ({ id, status: "succeeded" })),
    failDmProfileRefreshJob: vi.fn(async (id) => ({ id, status: "failed" })),
    heartbeatDmWorker: vi.fn(async (workerId) => ({ workerId })),
    acquireWorkerResourceLease: vi.fn(async () => null),
    heartbeatWorkerResourceLease: vi.fn(async (id, _workerId, leaseToken) => ({
      id,
      leaseToken,
      expiresAt: "2026-07-16T00:01:00.000Z"
    })),
    releaseWorkerResourceLease: vi.fn(async (id) => ({ id }))
  };
}

describe("API server", () => {
  it("lets the admin service-token guard handle admin routes without a Kakao session", async () => {
    const app = createServer({
      repository: createRepository(),
      kakaoAuth: { getSession: vi.fn(async () => null) } as any,
      logger: false
    });
    registerAdminRoutes(app, {
      serviceToken: "admin-secret",
      repository: {
        getOverview: vi.fn(async () => ({
          generatedAt: "2026-07-19T00:00:00.000Z",
          brands: { active: 1, paused: 0, disabled: 0 },
          channels: { connected: 1, needsAttention: 0 },
          generation24h: { succeeded: 0, failed: 0 },
          publishing: { pendingReview: 0, scheduled: 0, publishing: 0, failed: 0 },
          dm24h: { received: 0, replied: 0, fallback: 0, failed: 0 },
          wiki24h: { succeeded: 0, failed: 0 },
          workers: { online: 0, stale: 0 },
          recentErrors: []
        }))
      } as any
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/v1/overview",
      headers: {
        authorization: "Bearer admin-secret",
        "x-admin-actor-id": "growthline-admin",
        "x-request-id": "11111111-1111-4111-8111-111111111111"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.brands.active).toBe(1);
  });

  it("sets a cross-site compatible session cookie after Kakao login on Vercel", async () => {
    const previousVercel = process.env.VERCEL;
    process.env.VERCEL = "1";
    const kakaoAuth = {
      createOrLoadUser: vi.fn(async () => ({ userId: "user-1" })),
      createSession: vi.fn(async () => "session-token")
    };
    const app = createServer({
      repository: createRepository(),
      kakaoAuth: kakaoAuth as any,
      kakao: {
        restApiKey: "kakao-rest-api-key",
        redirectUri: "https://api.example.com/auth/kakao/callback",
        frontendUrl: "http://localhost:5173"
      },
      logger: false
    });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "access-token" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 1234, properties: { nickname: "Tester" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })));

    try {
      const login = await app.inject({ method: "GET", url: "/auth/kakao/login" });
      const state = new URL(String(login.headers.location)).searchParams.get("state");
      const stateCookie = String(login.headers["set-cookie"]).split(";", 1)[0];
      const callback = await app.inject({
        method: "GET",
        url: `/auth/kakao/callback?code=test-code&state=${encodeURIComponent(state!)}`,
        headers: { cookie: stateCookie }
      });
      const cookies = callback.headers["set-cookie"] as string[];
      const sessionCookie = cookies.find((value) => value.startsWith("bp_session="));

      expect(callback.statusCode).toBe(302);
      expect(sessionCookie).toContain("SameSite=None");
      expect(sessionCookie).toContain("Secure");
    } finally {
      if (previousVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = previousVercel;
    }
  });

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
      logoUrl: "https://cdn.example.com/logo.png",
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

  it("returns the 30-day dashboard from the repository", async () => {
    const repository = createRepository();
    const app = createServer({ repository, logger: false });

    const response = await app.inject({ method: "GET", url: `/brands/${brandId}/dashboard?period=30d` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ period: "30d", summary: { publishedCount: 0, exposureCount: null } });
    expect(repository.getDashboard).toHaveBeenCalledWith(brandId);
  });

  it("rejects unsupported dashboard periods", async () => {
    const repository = createRepository();
    const app = createServer({ repository, logger: false });

    const response = await app.inject({ method: "GET", url: `/brands/${brandId}/dashboard?period=7d` });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "dashboard_period_invalid" });
    expect(repository.getDashboard).not.toHaveBeenCalled();
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

  it("rejects legacy industry and an overlong primary customer", async () => {
    const repository = createRepository();
    const app = createServer({ repository });

    const response = await app.inject({
      method: "PUT",
      url: `/brands/${brandId}/profile`,
      payload: { primaryCustomer: "나".repeat(31) }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "brand_profile_field_too_long" });
    expect(repository.updateBrandProfile).not.toHaveBeenCalled();
  });

  it("rejects the legacy industry field", async () => {
    const repository = createRepository();
    const app = createServer({ repository });
    const response = await app.inject({
      method: "PUT",
      url: `/brands/${brandId}/profile`,
      payload: { industry: "여행" }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "industry_not_supported" });
    expect(repository.updateBrandProfile).not.toHaveBeenCalled();
  });

  it("accepts representative and detailed category selections", async () => {
    const repository = createRepository();
    const app = createServer({ repository });
    const payload = {
      primaryCategoryCode: "business_professional",
      subcategories: [
        { type: "system", code: "marketing_consulting" },
        { type: "custom", name: "세일즈 메시지 설계" }
      ]
    };
    const response = await app.inject({ method: "PUT", url: `/brands/${brandId}/profile`, payload });
    expect(response.statusCode).toBe(200);
    expect(repository.updateBrandProfile).toHaveBeenCalledWith(brandId, payload);
  });

  it("accepts null to clear the representative category", async () => {
    const repository = createRepository();
    const app = createServer({ repository });
    const response = await app.inject({
      method: "PUT",
      url: `/brands/${brandId}/profile`,
      payload: { primaryCategoryCode: null }
    });
    expect(response.statusCode).toBe(200);
    expect(repository.updateBrandProfile).toHaveBeenCalledWith(brandId, { primaryCategoryCode: null });
  });

  it("maps stable category validation failures to 400", async () => {
    const repository = createRepository();
    vi.mocked(repository.updateBrandProfile).mockRejectedValueOnce(new Error("invalid_primary_category"));
    const app = createServer({ repository });
    const response = await app.inject({
      method: "PUT",
      url: `/brands/${brandId}/profile`,
      payload: { primaryCategoryCode: "missing" }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_primary_category" });
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

  it("returns a conflict when the owned source URL limit is exceeded", async () => {
    const repository = createRepository();
    vi.mocked(repository.createSourceWithInitialCrawl).mockRejectedValueOnce(new Error("source_owned_limit_exceeded"));
    const app = createServer({ repository });

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/sources`,
      payload: { sourceType: "owned", url: "https://second.example.com" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "source_owned_limit_exceeded" });
  });

  it("returns a conflict when enabling an unauthenticated channel", async () => {
    const repository = createRepository();
    vi.mocked(repository.updateChannelEnabled).mockRejectedValueOnce(new Error("channel_authentication_required"));
    const app = createServer({ repository });

    const response = await app.inject({
      method: "PATCH",
      url: `/brands/${brandId}/channels/instagram`,
      payload: { enabled: true }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "channel_authentication_required" });
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
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === "https://api.instagram.com/oauth/access_token") {
        return new Response(JSON.stringify({ access_token: "short-lived-token", expires_in: 3600 }), { status: 200 });
      }
      if (url.startsWith("https://graph.instagram.com/access_token")) {
        return new Response(JSON.stringify({ access_token: "long-lived-token", expires_in: 5_184_000 }), { status: 200 });
      }
      if (url.startsWith("https://graph.instagram.com/v23.0/me")) {
        return new Response(JSON.stringify({ id: "17890000000000000", username: "growthline352" }), { status: 200 });
      }
      if (url.startsWith("https://graph.instagram.com/v23.0/17890000000000000/subscribed_apps")) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { message: "unexpected_url" } }), { status: 400 });
    });
    vi.stubGlobal("fetch", fetchMock);

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
    const subscriptionCall = fetchMock.mock.calls.find(([url]) => url.includes("/subscribed_apps"));
    expect(subscriptionCall?.[0]).toContain("subscribed_fields=messages%2Cmessaging_postbacks");
    expect(subscriptionCall?.[1]).toMatchObject({
      method: "POST",
      headers: { authorization: "Bearer long-lived-token" },
    });
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

  it("connects Facebook Login for trends without replacing Instagram Login credentials", async () => {
    const repository = createRepository();
    const app = createServer({
      repository,
      facebookLogin: {
        appId: "facebook-app-id",
        appSecret: "facebook-app-secret",
        redirectUri: "http://localhost:4000/auth/meta/trends/callback",
        frontendUrl: "http://localhost:5173",
      },
      logger: false,
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/oauth/access_token") && url.includes("code=oauth-code")) {
        return new Response(JSON.stringify({ access_token: "short-user-token", expires_in: 3600 }), { status: 200 });
      }
      if (url.includes("/oauth/access_token") && url.includes("fb_exchange_token")) {
        return new Response(JSON.stringify({ access_token: "long-user-token", expires_in: 5_184_000 }), { status: 200 });
      }
      if (url.includes("/me/accounts")) {
        return new Response(JSON.stringify({ data: [{
          id: "page-1",
          name: "Brand Page",
          access_token: "page-token",
          instagram_business_account: { id: "ig-1", username: "brand" },
        }] }), { status: 200 });
      }
      if (url.includes("/me/permissions")) {
        return new Response(JSON.stringify({ data: [
          { permission: "pages_show_list", status: "granted" },
          { permission: "pages_read_engagement", status: "granted" },
          { permission: "instagram_basic", status: "granted" },
        ] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { message: "unexpected_url" } }), { status: 400 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const start = await app.inject({ method: "GET", url: "/auth/meta/trends/start" });
    expect(start.statusCode).toBe(302);
    const authorizeUrl = new URL(start.headers.location ?? "");
    expect(authorizeUrl.hostname).toBe("www.facebook.com");
    expect(authorizeUrl.searchParams.get("scope")).toContain("instagram_basic");
    const state = authorizeUrl.searchParams.get("state");

    const callback = await app.inject({
      method: "GET",
      url: `/auth/meta/trends/callback?code=oauth-code&state=${state}`,
      headers: { cookie: String(start.headers["set-cookie"]) },
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("http://localhost:5173/instagram-trends?meta_trends=connected");
    expect(repository.saveInstagramTrendCredentials).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000100",
      expect.objectContaining({ accessToken: "page-token", facebookPageId: "page-1", instagramBusinessAccountId: "ig-1" }),
    );
    expect(repository.saveChannelCredentials).not.toHaveBeenCalled();
  });

  it("redirects to an actionable state when the selected Page does not expose its Instagram account", async () => {
    const repository = createRepository();
    const app = createServer({
      repository,
      facebookLogin: {
        appId: "facebook-app-id",
        appSecret: "facebook-app-secret",
        redirectUri: "http://localhost:4000/auth/meta/trends/callback",
        frontendUrl: "http://localhost:5173",
      },
      logger: false,
    });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/oauth/access_token") && url.includes("code=oauth-code")) {
        return new Response(JSON.stringify({ access_token: "short-user-token" }), { status: 200 });
      }
      if (url.includes("/oauth/access_token") && url.includes("fb_exchange_token")) {
        return new Response(JSON.stringify({ access_token: "long-user-token" }), { status: 200 });
      }
      if (url.includes("/me/accounts")) {
        return new Response(JSON.stringify({ data: [{ id: "page-1", name: "Brand Page", access_token: "page-token" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { code: 100, message: "Unsupported get request" } }), { status: 400 });
    }));

    const start = await app.inject({ method: "GET", url: "/auth/meta/trends/start" });
    const state = new URL(start.headers.location ?? "").searchParams.get("state");
    const callback = await app.inject({
      method: "GET",
      url: `/auth/meta/trends/callback?code=oauth-code&state=${state}`,
      headers: { cookie: String(start.headers["set-cookie"]) },
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("http://localhost:5173/instagram-trends?meta_trends=account_link_required");
    expect(repository.saveInstagramTrendCredentials).not.toHaveBeenCalled();
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
      respondToSupportRequest: ReturnType<typeof vi.fn>;
    };
    repository.createSupportRequest = vi.fn(async (_brandId, body) => ({
      id: "support-1",
      brandId,
      workspaceId: "workspace-1",
      category: body.category,
      title: body.title,
      message: body.message,
      contactPhone: body.contactPhone,
      contactEmail: body.contactEmail ?? null,
      status: "new" as const,
      responseMessage: null,
      respondedAt: null,
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
      contactPhone: "010-1234-5678",
      contactEmail: "user@example.com",
      status: "new" as const,
      responseMessage: null,
      respondedAt: null,
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
      contactPhone: "010-1234-5678",
      contactEmail: "user@example.com",
      status,
      responseMessage: null,
      respondedAt: null,
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:05:00.000Z"
    }));
    repository.respondToSupportRequest = vi.fn(async (requestId, responseMessage) => ({
      id: requestId,
      brandId,
      workspaceId: "workspace-1",
      category: "bug" as const,
      title: "채널 연결 오류",
      message: "인스타 연결이 실패합니다.",
      contactPhone: "010-1234-5678",
      contactEmail: "user@example.com",
      status: "resolved" as const,
      responseMessage,
      respondedAt: "2026-07-11T00:10:00.000Z",
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:10:00.000Z"
    }));
    const app = createServer({ repository });

    const invalid = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/support-requests`,
      payload: { category: "bug", title: "제목만 있음" }
    });
    expect(invalid.statusCode).toBe(400);

    const missingPhone = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/support-requests`,
      payload: {
        category: "bug",
        title: "채널 연결 오류",
        message: "인스타 연결이 실패합니다."
      }
    });
    expect(missingPhone.statusCode).toBe(400);
    expect(missingPhone.json()).toEqual({ error: "support_contact_phone_required" });

    const invalidPhone = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/support-requests`,
      payload: {
        category: "bug",
        title: "채널 연결 오류",
        message: "인스타 연결이 실패합니다.",
        contactPhone: "02-1234-5678"
      }
    });
    expect(invalidPhone.statusCode).toBe(400);
    expect(invalidPhone.json()).toEqual({ error: "invalid_support_contact_phone" });

    const created = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/support-requests`,
      payload: {
        category: "bug",
        title: "채널 연결 오류",
        message: "인스타 연결이 실패합니다.",
        contactPhone: "01012345678",
        contactEmail: "user@example.com"
      }
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ id: "support-1", status: "new", category: "bug" });
    expect(repository.createSupportRequest).toHaveBeenCalledWith(brandId, expect.objectContaining({
      category: "bug",
      title: "채널 연결 오류",
      message: "인스타 연결이 실패합니다.",
      contactPhone: "010-1234-5678"
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

    const responded = await app.inject({
      method: "POST",
      url: "/support-requests/support-1/response",
      payload: { responseMessage: "Meta 연결을 초기화했습니다." }
    });
    expect(responded.statusCode).toBe(200);
    expect(responded.json()).toMatchObject({
      id: "support-1",
      status: "resolved",
      responseMessage: "Meta 연결을 초기화했습니다."
    });
    expect(repository.respondToSupportRequest).toHaveBeenCalledWith("support-1", "Meta 연결을 초기화했습니다.");
  });

  it("creates validated feedback separately from support requests", async () => {
    const repository = createRepository() as ApiRepository & {
      createFeedbackSubmission: ReturnType<typeof vi.fn>;
    };
    repository.createFeedbackSubmission = vi.fn(async (_brandId, body) => ({
      id: "feedback-1",
      brandId,
      workspaceId: "workspace-1",
      message: body.message,
      status: "new" as const,
      createdAt: "2026-07-22T08:00:00.000Z",
      updatedAt: "2026-07-22T08:00:00.000Z"
    }));
    const app = createServer({ repository });

    const blank = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/feedback`,
      payload: { message: "   " }
    });
    const tooLong = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/feedback`,
      payload: { message: "가".repeat(2001) }
    });
    const created = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/feedback`,
      payload: { message: "  결과 미리보기를 더 빠르게 해주세요.  " }
    });

    expect(blank.statusCode).toBe(400);
    expect(blank.json()).toEqual({ error: "feedback_message_required" });
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json()).toEqual({ error: "feedback_message_too_long" });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ id: "feedback-1", status: "new" });
    expect(repository.createFeedbackSubmission).toHaveBeenCalledWith(brandId, {
      message: "결과 미리보기를 더 빠르게 해주세요."
    });
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
      url: `/brands/${brandId}/channels/mastodon/check`
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
    expect(response.json()).toMatchObject({ entryType: "faq", fileName: "faq.csv", status: "succeeded" });
    expect(repository.createKnowledgeImport).toHaveBeenCalledWith(brandId, expect.objectContaining({ entryType: "faq", fileName: "faq.csv" }));
  });

  it("imports product data when entryType is product", async () => {
    const repository = createRepository();
    const app = createServer({ repository });

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/knowledge-imports`,
      payload: {
        entryType: "product",
        fileName: "products.csv",
        fileBase64: Buffer.from("name,description\nMug,Stoneware").toString("base64")
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ entryType: "product", fileName: "products.csv" });
    expect(repository.createKnowledgeImport).toHaveBeenCalledWith(brandId, expect.objectContaining({ entryType: "product" }));
  });

  it("rejects unsupported knowledge import entry types", async () => {
    const repository = createRepository();
    const app = createServer({ repository });

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/knowledge-imports`,
      payload: { entryType: "policy", fileName: "policy.csv", fileBase64: "YQ==" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "knowledge_import_entry_type_invalid" });
    expect(repository.createKnowledgeImport).not.toHaveBeenCalled();
  });

  it("returns 400 when the knowledge import parser rejects a malformed file", async () => {
    const repository = createRepository();
    vi.mocked(repository.createKnowledgeImport).mockRejectedValueOnce(new Error("knowledge_upload_invalid_file"));
    const app = createServer({ repository });

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/knowledge-imports`,
      payload: { fileName: "faq.csv", fileBase64: "YQ==" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "knowledge_upload_invalid_file" });
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

    const retry = await app.inject({ method: "POST", url: "/publish-queue/queue-1/retry" });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual({ id: "queue-1", status: "queued" });
    expect(repository.retryPublishQueueItem).toHaveBeenCalledWith("queue-1");
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

  it("returns normalized artifacts for one publish queue result", async () => {
    const repository = createRepository();
    const app = createServer({ repository });

    const response = await app.inject({ method: "GET", url: "/publish-queue/queue-1/artifacts" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      queueId: "queue-1",
      kind: "image_gallery",
      assets: [{ url: "https://cdn.example.com/card-01.png" }]
    });
    expect(repository.getPublishArtifact).toHaveBeenCalledWith("queue-1");
  });

  it("returns normalized artifacts for a generated content output", async () => {
    const repository = createRepository();
    const app = createServer({ repository });

    const response = await app.inject({ method: "GET", url: "/content-outputs/output-1/artifact" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ queueId: "output-1", kind: "image_gallery" });
    expect(repository.getContentOutputArtifact).toHaveBeenCalledWith("output-1");
  });

  it("returns 409 while a content output artifact is not ready", async () => {
    const repository = createRepository();
    vi.mocked(repository.getContentOutputArtifact).mockRejectedValue(new Error("content_output_artifact_not_ready"));
    const app = createServer({ repository });

    const response = await app.inject({ method: "GET", url: "/content-outputs/output-pending/artifact" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "content_output_artifact_not_ready" });
  });

  it("downloads one publish queue result as a zip package", async () => {
    const repository = createRepository();
    const app = createServer({ repository });

    const response = await app.inject({ method: "GET", url: "/publish-queue/queue-1/download" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/zip");
    expect(response.headers["content-disposition"]).toContain("queue-1.zip");
    expect(response.headers["x-published-result-count"]).toBe("1");
    expect(response.rawPayload).toEqual(Buffer.from("PK-queue-1"));
    expect(repository.downloadPublishResult).toHaveBeenCalledWith("queue-1");
  });

  it("returns 404 when a publish queue result does not exist", async () => {
    const repository = createRepository();
    vi.mocked(repository.getPublishArtifact).mockRejectedValue(new Error("publish_queue_not_found"));
    vi.mocked(repository.downloadPublishResult).mockRejectedValue(new Error("publish_queue_not_found"));
    const app = createServer({ repository });

    const artifactResponse = await app.inject({ method: "GET", url: "/publish-queue/missing/artifacts" });
    const downloadResponse = await app.inject({ method: "GET", url: "/publish-queue/missing/download" });

    expect(artifactResponse.statusCode).toBe(404);
    expect(artifactResponse.json()).toEqual({ error: "publish_queue_not_found" });
    expect(downloadResponse.statusCode).toBe(404);
    expect(downloadResponse.json()).toEqual({ error: "publish_queue_not_found" });
  });

  it("returns a retryable manifest error from the artifact route", async () => {
    const repository = createRepository();
    vi.mocked(repository.getPublishArtifact).mockRejectedValue(new Error("publish_artifact_manifest_unavailable"));
    const app = createServer({ repository });

    const response = await app.inject({ method: "GET", url: "/publish-queue/queue-1/artifacts" });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: "publish_artifact_manifest_unavailable" });
  });

  it("denies cross-workspace access to both queue result routes", async () => {
    const repository = createRepository();
    const kakaoAuth = {
      getSession: vi.fn(async () => ({ userId: "user-1" })),
      canAccessBrand: vi.fn(async () => true),
      canAccessResource: vi.fn(async () => false)
    } as any;
    const app = createServer({ repository, kakaoAuth, logger: false });
    const request = { method: "GET" as const, headers: { cookie: "bp_session=session-token" } };

    const artifactResponse = await app.inject({ ...request, url: "/publish-queue/queue-foreign/artifacts" });
    const downloadResponse = await app.inject({ ...request, url: "/publish-queue/queue-foreign/download" });

    expect(artifactResponse.statusCode).toBe(403);
    expect(artifactResponse.json()).toEqual({ error: "workspace_access_denied" });
    expect(downloadResponse.statusCode).toBe(403);
    expect(downloadResponse.json()).toEqual({ error: "workspace_access_denied" });
    expect(kakaoAuth.canAccessResource).toHaveBeenCalledTimes(2);
    expect(kakaoAuth.canAccessResource).toHaveBeenNthCalledWith(1, "user-1", "publish_queue", "queue-foreign");
    expect(kakaoAuth.canAccessResource).toHaveBeenNthCalledWith(2, "user-1", "publish_queue", "queue-foreign");
    expect(repository.getPublishArtifact).not.toHaveBeenCalled();
    expect(repository.downloadPublishResult).not.toHaveBeenCalled();
  });

  it("lists content categories for an authenticated user without requiring brand access", async () => {
    const repository = createRepository();
    vi.mocked(repository.listContentCategories).mockResolvedValue([{
      code: "business_professional",
      name: "비즈니스·전문 서비스",
      recommendedHashtags: ["마케팅"],
      subcategories: [{ code: "marketing_consulting", name: "마케팅 컨설팅" }]
    }]);
    const kakaoAuth = {
      getSession: vi.fn(async () => ({ userId: "user-1" })),
      canAccessBrand: vi.fn(async () => false),
      canAccessResource: vi.fn(async () => false)
    } as any;
    const app = createServer({ repository, kakaoAuth, logger: false });

    const response = await app.inject({
      method: "GET",
      url: "/content-categories",
      headers: { cookie: "bp_session=session-token" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([expect.objectContaining({ code: "business_professional" })]);
    expect(repository.listContentCategories).toHaveBeenCalledTimes(1);
    expect(kakaoAuth.canAccessBrand).not.toHaveBeenCalled();
  });

  it("exposes all Instagram trend routes with their exact repository contracts", async () => {
    const repository = createRepository();
    vi.mocked(repository.listInstagramTrends).mockResolvedValue(instagramTrendPage);
    vi.mocked(repository.searchInstagramTrends).mockResolvedValue(instagramTrendPage);
    vi.mocked(repository.listInstagramTrendSearches).mockResolvedValue([{
      hashtagId: "hashtag-1",
      displayTag: "콘텐츠마케팅",
      isFavorite: false,
      lastSearchedAt: "2026-07-15T01:00:00.000Z",
      searchCount: 2
    }]);
    vi.mocked(repository.saveInstagramTrendSource).mockResolvedValue({
      source: {
        id: "source-1",
        brandId,
        sourceType: "reference",
        url: "https://www.instagram.com/reel/example/",
        title: "Instagram @creator",
        status: "active",
        enabled: true,
        lastCrawledAt: null,
        lastError: null
      },
      alreadySaved: false
    });
    const app = createServer({ repository, logger: false });

    const listed = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/instagram-trends?hashtag=%23콘텐츠마케팅&type=reel&sort=likes&page=2`
    });
    const searched = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/instagram-trends/search`,
      payload: { hashtag: "콘텐츠마케팅" }
    });
    const history = await app.inject({ method: "GET", url: `/brands/${brandId}/instagram-trend-searches` });
    const deleted = await app.inject({ method: "DELETE", url: `/brands/${brandId}/instagram-trend-searches/hashtag-1` });
    const favorite = await app.inject({
      method: "PUT",
      url: `/brands/${brandId}/instagram-trend-searches/hashtag-1/favorite`,
      payload: { isFavorite: true }
    });
    const saved = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/instagram-trends/media-1/save-source`
    });
    const unsaved = await app.inject({
      method: "DELETE",
      url: `/brands/${brandId}/instagram-trends/media-1/save-source`
    });

    expect(listed.statusCode).toBe(200);
    expect(searched.statusCode).toBe(200);
    expect(history.statusCode).toBe(200);
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ hashtagId: "hashtag-1" });
    expect(favorite.statusCode).toBe(200);
    expect(saved.statusCode).toBe(200);
    expect(unsaved.statusCode).toBe(200);
    expect(unsaved.json()).toEqual({ mediaId: "media-1", removed: true });
    expect(repository.listInstagramTrends).toHaveBeenCalledWith(brandId, {
      hashtag: "#콘텐츠마케팅",
      type: "reel",
      sort: "likes",
      page: 2
    });
    expect(repository.searchInstagramTrends).toHaveBeenCalledWith(brandId, { hashtag: "콘텐츠마케팅" });
    expect(repository.listInstagramTrendSearches).toHaveBeenCalledWith(brandId);
    expect(repository.deleteInstagramTrendSearch).toHaveBeenCalledWith(brandId, "hashtag-1");
    expect(repository.setInstagramTrendFavorite).toHaveBeenCalledWith(brandId, "hashtag-1", { isFavorite: true });
    expect(repository.saveInstagramTrendSource).toHaveBeenCalledWith(brandId, "media-1");
    expect(repository.removeInstagramTrendSource).toHaveBeenCalledWith(brandId, "media-1");
  });

  it("returns the paged brand trend archive", async () => {
    const repository = createRepository();
    vi.mocked(repository.listInstagramTrendArchive).mockResolvedValue({
      items: [{ ...instagramTrendPage.items[0], savedAt: "2026-07-15T02:00:00.000Z" }],
      page: 2,
      limit: 30,
      total: 31,
    });
    const app = createServer({ repository, logger: false });

    const response = await app.inject({ method: "GET", url: `/brands/${brandId}/instagram-trends/archive?page=2&limit=30` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ page: 2, limit: 30, total: 31 });
    expect(repository.listInstagramTrendArchive).toHaveBeenCalledWith(brandId, { page: 2, limit: 30 });
  });

  it.each([
    [`/brands/${brandId}/instagram-trends`, "GET", undefined, "invalid_hashtag"],
    [`/brands/${brandId}/instagram-trends?hashtag=test&type=story`, "GET", undefined, "invalid_instagram_trend_type"],
    [`/brands/${brandId}/instagram-trends?hashtag=test&sort=views`, "GET", undefined, "invalid_instagram_trend_sort"],
    [`/brands/${brandId}/instagram-trends?hashtag=test&page=0`, "GET", undefined, "invalid_instagram_trend_page"],
    [`/brands/${brandId}/instagram-trends?hashtag=test&page=1.5`, "GET", undefined, "invalid_instagram_trend_page"],
    [`/brands/${brandId}/instagram-trends/search`, "POST", {}, "invalid_hashtag"],
    [`/brands/${brandId}/instagram-trends/search`, "POST", { hashtag: 123 }, "invalid_hashtag"],
    [`/brands/${brandId}/instagram-trend-searches/hashtag-1/favorite`, "PUT", {}, "invalid_is_favorite"],
    [`/brands/${brandId}/instagram-trend-searches/hashtag-1/favorite`, "PUT", { isFavorite: "yes" }, "invalid_is_favorite"]
  ])("validates Instagram trend request boundaries for %s", async (url, method, payload, error) => {
    const repository = createRepository();
    const app = createServer({ repository, logger: false });

    const response = await app.inject({ method: method as "GET" | "POST" | "PUT", url, payload });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error });
    expect(repository.listInstagramTrends).not.toHaveBeenCalled();
    expect(repository.searchInstagramTrends).not.toHaveBeenCalled();
    expect(repository.setInstagramTrendFavorite).not.toHaveBeenCalled();
  });

  it("applies default type, sort, and page values when listing Instagram trends", async () => {
    const repository = createRepository();
    vi.mocked(repository.listInstagramTrends).mockResolvedValue(instagramTrendPage);
    const app = createServer({ repository, logger: false });

    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/instagram-trends?hashtag=콘텐츠마케팅`
    });

    expect(response.statusCode).toBe(200);
    expect(repository.listInstagramTrends).toHaveBeenCalledWith(brandId, {
      hashtag: "콘텐츠마케팅",
      type: "all",
      sort: "meta",
      page: 1
    });
  });

  it.each([
    ["GET", "/content-categories"],
    ["GET", `/brands/${brandId}/instagram-trends?hashtag=test`],
    ["POST", `/brands/${brandId}/instagram-trends/search`],
    ["GET", `/brands/${brandId}/instagram-trend-searches`],
    ["PUT", `/brands/${brandId}/instagram-trend-searches/hashtag-1/favorite`],
    ["POST", `/brands/${brandId}/instagram-trends/media-1/save-source`]
  ])("requires authentication for %s %s", async (method, url) => {
    const repository = createRepository();
    const kakaoAuth = { getSession: vi.fn(async () => null) } as any;
    const app = createServer({ repository, kakaoAuth, logger: false });

    const response = await app.inject({
      method: method as "GET" | "POST" | "PUT",
      url,
      payload: method === "POST" ? { hashtag: "test" } : method === "PUT" ? { isFavorite: true } : undefined
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "authentication_required" });
  });

  it.each([
    ["GET", `/brands/${brandId}/instagram-trends?hashtag=test`],
    ["POST", `/brands/${brandId}/instagram-trends/search`],
    ["GET", `/brands/${brandId}/instagram-trend-searches`],
    ["PUT", `/brands/${brandId}/instagram-trend-searches/hashtag-1/favorite`],
    ["POST", `/brands/${brandId}/instagram-trends/media-1/save-source`]
  ])("denies cross-workspace Instagram trend access for %s %s", async (method, url) => {
    const repository = createRepository();
    const kakaoAuth = {
      getSession: vi.fn(async () => ({ userId: "user-1" })),
      canAccessBrand: vi.fn(async () => false),
      canAccessResource: vi.fn(async () => false)
    } as any;
    const app = createServer({ repository, kakaoAuth, logger: false });

    const response = await app.inject({
      method: method as "GET" | "POST" | "PUT",
      url,
      headers: { cookie: "bp_session=session-token" },
      payload: method === "POST" ? { hashtag: "test" } : method === "PUT" ? { isFavorite: true } : undefined
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "workspace_access_denied" });
  });

  it.each([
    ["invalid_hashtag", 400],
    ["instagram_connection_required", 409],
    ["instagram_reconnect_required", 409],
    ["instagram_permission_required", 409],
    ["hashtag_search_limit_reached", 429],
    ["instagram_trend_fetch_failed", 502]
  ])("maps Instagram trend domain error %s to HTTP %i", async (domainError, statusCode) => {
    const repository = createRepository();
    vi.mocked(repository.searchInstagramTrends).mockRejectedValue(new Error(domainError));
    const app = createServer({ repository, logger: false });

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/instagram-trends/search`,
      payload: { hashtag: "콘텐츠마케팅" }
    });

    expect(response.statusCode).toBe(statusCode);
    expect(response.json()).toEqual({ error: domainError });
  });

  it("returns a normal empty trend page when Meta cannot find the hashtag", async () => {
    const repository = createRepository();
    vi.mocked(repository.searchInstagramTrends).mockRejectedValue(new Error("instagram_hashtag_not_found"));
    const app = createServer({ repository, logger: false });

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/instagram-trends/search`,
      payload: { hashtag: "#없는태그" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      hashtag: { id: "", displayTag: "없는태그", normalizedTag: "없는태그" },
      source: "meta",
      refreshed: false,
      refreshedAt: null,
      lastErrorCode: "instagram_hashtag_not_found",
      page: 1,
      pageSize: 20,
      total: 0,
      items: []
    });
  });

  it("preserves the requested page in an empty hashtag-not-found trend response", async () => {
    const repository = createRepository();
    vi.mocked(repository.listInstagramTrends).mockRejectedValue(new Error("instagram_hashtag_not_found"));
    const app = createServer({ repository, logger: false });

    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/instagram-trends?hashtag=%23없는태그&page=2`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      hashtag: { id: "", displayTag: "없는태그", normalizedTag: "없는태그" },
      page: 2,
      pageSize: 20,
      total: 0,
      items: []
    });
  });
});
