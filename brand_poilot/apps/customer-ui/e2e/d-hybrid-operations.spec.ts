import { expect, test, type Page, type Route } from "@playwright/test";

const brandId = "brand-e2e";
const issueId = "11111111-1111-4111-8111-111111111111";
const now = "2026-07-28T03:00:00.000Z";

const auth = {
  user: { id: "user-e2e", displayName: "E2E", email: "e2e@example.com" },
  workspace: { id: "workspace-e2e", name: "E2E" },
  brand: { id: brandId, name: "E2E Brand" },
};

const uiStatus = {
  brandId,
  brandName: "E2E Brand",
  logoUrl: null,
  navigation: { onboardingRemaining: 0, contentReview: 0, publishIssues: 2, channelIssues: 0 },
  onboarding: {
    completedCount: 1,
    totalCount: 1,
    remainingCount: 0,
    steps: [],
  },
};

const channels = [
  { channel: "instagram", enabled: true, oauthState: "connected", status: "connected", accountLabel: "@e2e", lastHealthyAt: now, lastPublishedAt: now, lastError: null },
  ...["threads", "x", "linkedin", "youtube", "tiktok"].map((channel) => ({
    channel, enabled: false, oauthState: "not_connected", status: "not_connected", accountLabel: null, lastHealthyAt: null, lastPublishedAt: null, lastError: null,
  })),
];

const capabilities = [
  {
    channel: "instagram", catalogStatus: "available", connectionStatus: "connected", canGenerate: true,
    generationFormats: ["card_news", "single_image"], exportModes: ["image", "html"],
    publishModes: ["instagram_feed_carousel", "instagram_story"], readiness: "ready", reasonCode: null,
  },
  {
    channel: "threads", catalogStatus: "available", connectionStatus: "not_connected", canGenerate: true,
    generationFormats: ["channel_text"], exportModes: ["text"], publishModes: [],
    readiness: "not_supported", reasonCode: "provider_not_implemented",
  },
  ...["x", "linkedin"].map((channel) => ({
    channel, catalogStatus: "planned", connectionStatus: "not_connected", canGenerate: false,
    generationFormats: [], exportModes: ["text"], publishModes: [],
    readiness: "not_supported", reasonCode: "provider_not_implemented",
  })),
  ...["youtube", "tiktok"].map((channel) => ({
    channel, catalogStatus: "planned", connectionStatus: "not_connected", canGenerate: false,
    generationFormats: [], exportModes: [], publishModes: [],
    readiness: "not_supported", reasonCode: "video_generation_out_of_scope",
  })),
];

function generation() {
  return {
    id: "generation-ops", brandId, type: "card_news", title: "운영 연결 카드뉴스",
    status: "completed", currentStage: "completed", draft: {}, analysis: {},
    retryableUntil: null, attachmentsLockedAt: null, terminalAt: now,
    outputs: [{
      id: "output-ops", generationId: "generation-ops", outputIndex: 1, title: "운영 연결 카드뉴스",
      status: "completed", content: { caption: "운영 연결", hashtags: ["#운영"], cta: "확인" },
      manifest: {
        version: "ai-content.v1", type: "card_news", title: "운영 연결 카드뉴스",
        assets: [{ index: 1, role: "slide", url: "https://assets.test/slide.png", fileName: "slide.png", mimeType: "image/png", width: 1080, height: 1080 }],
        content: { caption: "운영 연결", hashtags: ["#운영"], cta: "확인" },
      },
      manifestUrl: "https://assets.test/manifest.json", failureCode: null, failureMessage: null, downloadedAt: null,
    }],
    createdAt: now, updatedAt: now,
  };
}

function queueItem(id: string, status: string, lastError: string | null = null, title = id) {
  return {
    id, title, channel: "instagram", status, approvalType: "manual",
    scheduledFor: status === "scheduled" ? "2026-07-29T03:00:00.000Z" : null,
    lastError, sourceType: "mixed", sourceLabel: "운영 E2E", sourceDetail: "실제 schema fixture",
    sourceUrls: ["https://brand.example.com/source"], queuedAt: now, renderStatus: "ready",
    topicPublishGroupId: `group-${id}`, slotDate: "2026-07-29", slotNumber: 1,
  };
}

async function installShell(page: Page, handler?: (route: Route, url: URL) => Promise<boolean>) {
  await page.addInitScript((session) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof Request ? input.url : String(input), window.location.href);
      if (url.pathname.endsWith("/auth/me")) {
        return new Response(JSON.stringify(session), { status: 200, headers: { "content-type": "application/json" } });
      }
      return originalFetch(input, init);
    };
  }, auth);

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "assets.test") return route.fulfill({ status: 200, contentType: "image/png", body: "fixture" });
    const isApi = url.port === "4000" || url.pathname.startsWith("/api/");
    if (!isApi) return route.continue();
    if (handler && await handler(route, url)) return;
    if (url.pathname.endsWith("/auth/me")) return route.fulfill({ json: auth });
    if (url.pathname.endsWith("/ui-status")) return route.fulfill({ json: uiStatus });
    if (url.pathname.endsWith("/channels/capabilities")) return route.fulfill({ json: capabilities });
    if (url.pathname.endsWith("/channels")) return route.fulfill({ json: channels });
    if (url.pathname.endsWith("/ai-content/usage")) return route.fulfill({ json: { generationUsed: 1, generationLimit: 10, newDownloadUsed: 1, newDownloadLimit: 20, resetsAt: now } });
    return route.fulfill({ json: [] });
  });
}

test.describe("D hybrid operations cycle", () => {
  test("channels exposes Instagram feed/static Story and honest catalog states without Reel creation", async ({ page }) => {
    await installShell(page);
    await page.goto("/channels");

    const instagram = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Instagram" }) });
    await expect(instagram).toContainText("Instagram 피드");
    await expect(instagram).toContainText("정적 Story");
    await expect(page.getByRole("heading", { name: "Threads" })).toBeVisible();
    await expect(page.getByText("지원 준비 중")).toHaveCount(4);
    await expect(page.getByRole("button", { name: /(?:Reel|릴스|영상).*(?:생성|제작)/i })).toHaveCount(0);
  });

  test("content result publishes feed/static Story and opens the returned queueId deep link", async ({ page }) => {
    let publishTargets: unknown[] = [];
    await installShell(page, async (route, url) => {
      if (url.pathname.endsWith("/ai-content/generations/generation-ops")) {
        await route.fulfill({ json: generation() }); return true;
      }
      if (url.pathname.endsWith("/ai-content/outputs/output-ops/publish")) {
        publishTargets = (route.request().postDataJSON() as { targets: unknown[] }).targets;
        await route.fulfill({ json: {
          outputId: "output-ops", publishGroupId: "group-ops",
          targets: [
            { channel: "instagram", deliveryFormat: "instagram_feed_carousel", channelOutputId: "feed-output", queueId: "queue-feed", status: "scheduled", publishedUrl: null, errorCode: null },
            { channel: "instagram", deliveryFormat: "instagram_story", channelOutputId: "story-output", queueId: "queue-story", status: "scheduled", publishedUrl: null, errorCode: null },
          ],
        } }); return true;
      }
      if (url.pathname.endsWith("/publish-queue")) {
        await route.fulfill({ json: [queueItem("queue-feed", "scheduled", null, "운영 연결 카드뉴스")] }); return true;
      }
      if (url.pathname.endsWith("/content-outputs") || url.pathname.endsWith("/publish-results")) {
        await route.fulfill({ json: [] }); return true;
      }
      return false;
    });

    await page.goto("/ai-content/generation-ops");
    await page.getByRole("checkbox", { name: "게시물" }).check();
    await page.getByRole("checkbox", { name: "스토리" }).check();
    await page.getByRole("button", { name: "선택한 2개 유형 게시" }).click();
    const deepLink = page.getByRole("link", { name: "게시 큐에서 확인" }).first();
    await expect(deepLink).toHaveAttribute("href", "/publish-queue?queueId=queue-feed");
    await deepLink.click();
    await expect(page.getByRole("article", { name: "운영 연결 카드뉴스" })).toHaveAttribute(
      "data-publish-deep-link",
      "true",
      { timeout: 15_000 },
    );
    expect(publishTargets).toEqual([
      { channel: "instagram", deliveryFormat: "instagram_feed_carousel" },
      { channel: "instagram", deliveryFormat: "instagram_story" },
    ]);
  });

  test("schedule assigns a slot and cancellation uses that same queue row", async ({ page }) => {
    let rows = [queueItem("queue-schedule", "queued", null, "예약할 콘텐츠")];
    let cancelId = "";
    await installShell(page, async (route, url) => {
      if (url.pathname.endsWith("/publish-queue/schedule") && route.request().method() === "POST") {
        rows = [queueItem("queue-schedule", "scheduled", null, "예약할 콘텐츠")];
        await route.fulfill({ json: { processed: 1, created: 0, updated: 1, failed: 0 } }); return true;
      }
      if (url.pathname.endsWith("/publish-queue/queue-schedule/cancel")) {
        cancelId = "queue-schedule";
        rows = [queueItem("queue-schedule", "cancelled", null, "예약할 콘텐츠")];
        await route.fulfill({ json: { id: cancelId, status: "cancelled" } }); return true;
      }
      if (url.pathname.endsWith("/publish-queue")) { await route.fulfill({ json: rows }); return true; }
      if (url.pathname.endsWith("/content-outputs") || url.pathname.endsWith("/publish-results")) { await route.fulfill({ json: [] }); return true; }
      return false;
    });

    await page.goto("/publish-queue");
    await page.getByRole("button", { name: "정책 큐 배정" }).click();
    const card = page.getByRole("article", { name: "예약할 콘텐츠" });
    await expect(card).toContainText("예약");
    await card.getByRole("button", { name: "예약 취소" }).click();
    expect(cancelId).toBe("queue-schedule");
  });

  test("failed publish has one bounded retry while result_unknown reconciles without duplicate publish", async ({ page }) => {
    let rows = [
      queueItem("queue-failed", "failed", "oauth_required", "재시도 콘텐츠"),
      queueItem("queue-unknown", "failed", "publish_delivery_unknown", "결과 미확인 콘텐츠"),
    ];
    let retryCalls = 0;
    let publishCalls = 0;
    let listCalls = 0;
    await installShell(page, async (route, url) => {
      if (url.pathname.endsWith("/publish-queue/queue-failed/retry")) {
        retryCalls += 1;
        rows = rows.map((row) => row.id === "queue-failed" ? { ...row, status: "queued", lastError: null } : row);
        await route.fulfill({ json: { id: "queue-failed", status: "queued" } }); return true;
      }
      if (url.pathname.endsWith("/publish")) { publishCalls += 1; await route.fulfill({ json: {} }); return true; }
      if (url.pathname.endsWith("/publish-queue")) { listCalls += 1; await route.fulfill({ json: rows }); return true; }
      if (url.pathname.endsWith("/content-outputs") || url.pathname.endsWith("/publish-results")) { await route.fulfill({ json: [] }); return true; }
      return false;
    });

    await page.goto("/publish-queue");
    await page.getByRole("article", { name: "재시도 콘텐츠" }).getByRole("button", { name: "재시도" }).click();
    await expect.poll(() => retryCalls).toBe(1);
    await expect(page.getByRole("article", { name: "재시도 콘텐츠" }).getByRole("button", { name: "재시도" })).toHaveCount(0);
    await page.getByRole("article", { name: "결과 미확인 콘텐츠" }).getByRole("button", { name: "게시 결과 확인" }).click();
    expect(publishCalls).toBe(0);
    expect(listCalls).toBeGreaterThanOrEqual(3);
  });

  test("knowledge gap opens the same-brand Wiki issue and connects a corrective source", async ({ page }) => {
    let resolvedIssue = "";
    const conversation = {
      id: "conversation-1",
      participant: { instagramScopedId: "ig-1", displayName: "고객 A", username: "customer_a", profileImageUrl: null },
      lastMessage: { body: "환불 기준이 뭐예요?", direction: "inbound", createdAt: now },
      automationStatus: "paused", attentionStatus: "open", openAttentionTypes: ["knowledge_gap"], unreadCount: 1,
    };
    const issue = {
      id: issueId, workspaceId: "workspace-e2e", brandId, issueType: "knowledge_gap", severity: "warning",
      status: "open", question: "환불 기준이 뭐예요?", detail: { reason: "승인된 환불 정책 없음" },
      sourceKind: null, sourceId: null, activeVersionId: null, lastBuiltAt: null, buildStatus: "idle", resolvedAt: null,
    };
    const wikiItem = {
      id: "wiki-refund", workspaceId: "workspace-e2e", brandId, itemType: "policy", sourceKind: "policy",
      title: "환불 정책", content: "결제 후 7일", status: "active", origin: "manual", provenance: {},
      createdByUserId: "user-e2e", approvedByUserId: "user-e2e", approvedAt: now, sourceId: "wiki-refund",
      activeVersionId: "wiki-version-1", lastBuiltAt: now, buildStatus: "active",
    };
    await installShell(page, async (route, url) => {
      if (url.pathname.endsWith("/instagram-dm/settings")) { await route.fulfill({ json: { brandId, enabled: true, fallbackMessage: "", errorMessage: "", wikiReady: true, messagePermissionReady: true, webhookStatus: "connected", workerStatus: "online" } }); return true; }
      if (url.pathname.endsWith("/dm/conversations")) { await route.fulfill({ json: { items: [conversation], nextCursor: null } }); return true; }
      if (url.pathname.endsWith("/dm/conversations/conversation-1")) {
        await route.fulfill({ json: { ...conversation, messages: [], attentionItems: [{ id: issueId, conversationId: "conversation-1", type: "knowledge_gap", status: "open", originalMessage: "환불 기준이 뭐예요?", reason: "승인된 환불 정책 없음", autoReplyStatus: "not_sent", createdAt: now, resolvedAt: null }] } }); return true;
      }
      if (url.pathname.endsWith("/wiki/items")) { await route.fulfill({ json: [wikiItem] }); return true; }
      if (url.pathname.endsWith("/wiki/issues")) { await route.fulfill({ json: [issue] }); return true; }
      if (url.pathname.endsWith(`/wiki/issues/${issueId}/resolve`)) {
        resolvedIssue = issueId;
        await route.fulfill({ json: { ...issue, status: "pending_build", sourceKind: "policy", sourceId: "wiki-refund" } }); return true;
      }
      if (url.pathname.endsWith("/knowledge-imports")) { await route.fulfill({ json: [] }); return true; }
      if (url.pathname.endsWith("/wiki/status")) { await route.fulfill({ json: { activeVersion: null, latestFailedVersion: null, importStats: { total: 0, succeeded: 0, failed: 0, faqRows: 0, productRows: 0 } } }); return true; }
      if (url.pathname.endsWith("/brand-center")) {
        await route.fulfill({ json: {
          source: { state: "ready" }, analysis: { state: "confirmed" }, brandCore: { state: "approved" }, rules: { state: "approved" },
          products: { state: "ready" }, wiki: { state: "ready" }, avatars: { state: "ready" },
        } }); return true;
      }
      if (url.pathname.endsWith("/brand-core")) { await route.fulfill({ json: { active: null, draft: null, versions: [] } }); return true; }
      if (url.pathname.endsWith("/brand-rules")) { await route.fulfill({ json: { active: null, draft: null, versions: [] } }); return true; }
      if (url.pathname.endsWith("/product-services") || url.pathname.endsWith("/avatars")) { await route.fulfill({ json: [] }); return true; }
      return false;
    });

    await page.goto("/dm-automation");
    await page.getByRole("button", { name: "고객 A 대화 열기" }).click();
    await page.getByRole("region", { name: "고객 A 대화 내용" }).getByRole("link", { name: "Wiki에서 보완" }).click();
    await expect(page).toHaveURL(new RegExp(`/brand-center\\?tab=wiki&issue=${issueId}`));
    const issueDetail = page.getByRole("region", { name: "지식 개선 상세" });
    await expect(issueDetail).toBeFocused({ timeout: 15_000 });
    await expect(issueDetail.getByRole("heading", { name: "환불 기준이 뭐예요?" })).toBeVisible();
    await page.getByLabel("연결할 Wiki 항목").selectOption("wiki-refund");
    await page.getByRole("button", { name: "보완 항목 연결" }).click();
    expect(resolvedIssue).toBe(issueId);
  });

  test("manual reply pauses automation and resolving attention resumes the same conversation", async ({ page }) => {
    let paused = false;
    let sentBody = "";
    const summary = () => ({
      id: "conversation-2",
      participant: { instagramScopedId: "ig-2", displayName: "고객 B", username: "customer_b", profileImageUrl: null },
      lastMessage: { body: sentBody || "담당자 연결", direction: sentBody ? "outbound" : "inbound", createdAt: now },
      automationStatus: paused ? "paused" : "active", attentionStatus: paused ? "open" : "none", openAttentionTypes: paused ? ["restricted_action"] : [], unreadCount: 0,
    });
    const detail = () => ({
      ...summary(), messages: [], attentionItems: paused ? [{
        id: "attention-manual", conversationId: "conversation-2", type: "restricted_action", status: "open",
        originalMessage: "담당자 연결", reason: "수동 답변", autoReplyStatus: "not_sent", createdAt: now, resolvedAt: null,
      }] : [],
    });
    await installShell(page, async (route, url) => {
      if (url.pathname.endsWith("/instagram-dm/settings")) { await route.fulfill({ json: { brandId, enabled: true, fallbackMessage: "", errorMessage: "", wikiReady: true, messagePermissionReady: true, webhookStatus: "connected", workerStatus: "online" } }); return true; }
      if (url.pathname.endsWith("/dm/conversations")) { await route.fulfill({ json: { items: [summary()], nextCursor: null } }); return true; }
      if (url.pathname.endsWith("/dm/conversations/conversation-2/messages")) {
        sentBody = (route.request().postDataJSON() as { body: string }).body; paused = true;
        await route.fulfill({ json: { id: "message-manual", direction: "outbound", messageType: "text", body: sentBody, decision: null, reasonCode: "system_event", sourceLabel: null, confidence: null, deliveryStatus: "sent", createdAt: now } }); return true;
      }
      if (url.pathname.endsWith("/dm/conversations/conversation-2")) { await route.fulfill({ json: detail() }); return true; }
      if (url.pathname.endsWith("/dm/attention-items/attention-manual")) {
        paused = false;
        await route.fulfill({ json: { conversationId: "conversation-2", automationStatus: "active", attentionStatus: "resolved" } }); return true;
      }
      return false;
    });

    await page.goto("/dm-automation");
    await page.getByRole("button", { name: "고객 B 대화 열기" }).click();
    await page.getByRole("textbox", { name: "수동 답변", exact: true }).fill("담당자가 확인했습니다.");
    await page.getByRole("button", { name: "수동 답변 전송" }).click();
    await expect(page.getByText("자동응답 중지")).toBeVisible();
    await page.getByRole("button", { name: /확인 완료/ }).click();
    await expect(page.getByText("자동응답 중")).toBeVisible();
    expect(sentBody).toBe("담당자가 확인했습니다.");
  });

  test("performance observation creates the next experiment proposal and opens setup", async ({ page }) => {
    let requestBody: Record<string, unknown> | null = null;
    await installShell(page, async (route, url) => {
      if (url.pathname.endsWith("/performance/insights")) {
        await route.fulfill({ json: {
          period: "30d", summary: { dataStatus: "sufficient", measuredContentCount: 4, totalExposure: 4200 },
          windows: [{ window: "24h", sampleSize: 4, averageExposure: 1050 }],
          observations: [{ id: "obs-1", kind: "observation", label: "저장 반응", metric: { name: "노출", value: 4200, unit: "회", sampleSize: 4 }, evidenceSnapshotIds: ["snapshot-1"], interpretation: { kind: "interpretation", statement: "체크리스트 형식 반응이 높습니다.", confidence: "medium" } }],
          experiments: [{ id: "experiment-1", kind: "experiment", title: "체크리스트 후속 실험", hypothesis: "저장 반응을 재현합니다.", contentFamily: "informational", channelTargets: ["instagram"], outputFormats: ["card_news"], performanceSnapshotIds: ["snapshot-1"] }],
          sampleSize: 4, lastCollectedAt: now, topContents: [],
        } }); return true;
      }
      if (url.pathname.endsWith("/ai-content/proposal-batches") && route.request().method() === "POST") {
        requestBody = route.request().postDataJSON();
        await route.fulfill({ json: { batchId: "batch-performance", status: "ready" } }); return true;
      }
      if (url.pathname.endsWith("/ai-content/proposal-batches/batch-performance")) {
        await route.fulfill({ json: {
          id: "batch-performance", workspaceId: "workspace-e2e", brandId, origin: "performance",
          contentFamily: "informational",
          request: {
            contractVersion: "content-proposal-request.v1", contentFamily: "informational",
            subjectInput: { mode: "brand_topic", topic: "체크리스트 후속 실험", wikiItemIds: [] },
            outputFormats: ["card_news"], channelTargets: ["instagram"],
            sourceSnapshotIds: [], performanceSnapshotIds: ["snapshot-1"],
          },
          sourceSnapshots: [], status: "ready", errorCode: null, errorMessage: null, createdAt: now, updatedAt: now,
          proposals: [{
            id: "proposal-performance", batchId: "batch-performance", status: "suggested", generationId: null, createdAt: now,
            proposal: {
              contractVersion: "content-proposal.v1", title: "성과 기반 체크리스트", reasonToCreateNow: "검증된 성과 관측이 있습니다.",
              contentFamily: "informational", topic: "체크리스트 후속 실험", target: { name: "브랜드 운영자" },
              messageStrategy: "problem_solution", hook: "저장되는 체크리스트", keyMessage: "관측된 반응을 다음 실험으로 연결합니다.",
              evidence: [{ sourceSnapshotId: "snapshot-1", summary: "30일 성과 관측" }],
              outline: [{ heading: "관측", purpose: "확인된 성과를 설명" }], outputFormat: "card_news",
              channelTargets: ["instagram"], recommendedReferenceQuery: { strategies: ["problem_solution"], formats: ["card_news"], tags: ["성과"] },
            },
          }],
        } }); return true;
      }
      if (url.pathname.endsWith("/ai-content/brand-context")) { await route.fulfill({ json: { ready: true, brandName: "E2E Brand", sourceStatus: "ready" } }); return true; }
      if (url.pathname.endsWith("/product-services") || url.pathname.endsWith("/wiki/items") || url.pathname.endsWith("/avatars") || url.pathname.endsWith("/ai-content/references")) { await route.fulfill({ json: [] }); return true; }
      return false;
    });

    await page.goto("/performance");
    await expect(page.getByRole("heading", { name: "관측" })).toBeVisible();
    await page.getByRole("button", { name: "이 데이터로 AI 구성안 만들기" }).click();
    const link = page.getByRole("link", { name: "생성된 구성안 열기" });
    await expect(link).toHaveAttribute("href", "/ai-content/new?proposalBatch=batch-performance");
    expect(requestBody).toMatchObject({ request: { performanceSnapshotIds: ["snapshot-1"] } });
    await link.click();
    await expect(page).toHaveURL(/\/ai-content\/new\?proposalBatch=batch-performance$/);
    await expect(page.getByRole("button", { name: "구현안 선택: 성과 기반 체크리스트" })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("dashboard, support, and sidebar open the same feedback dialog", async ({ page }, testInfo) => {
    await installShell(page, async (route, url) => {
      if (url.pathname.endsWith("/dashboard")) {
        await route.fulfill({ json: { generatedAt: now, lastCollectedAt: null, summary: { publishedCount: 0, exposureCount: null, pendingReviewCount: 0, failedPublishCount: 0 }, workflow: { queuedTopics: 0, generating: 0, pendingReview: 0, scheduledOrPublished: 0 }, dailyExposure: [], channelPerformance: [], topContents: [], attentionItems: [] } }); return true;
      }
      if (url.pathname.endsWith("/support-requests")) { await route.fulfill({ json: [] }); return true; }
      if (url.pathname.endsWith("/profile")) { await route.fulfill({ json: { id: "profile", brandId, name: "E2E Brand", primaryCategory: null, subcategories: [], primaryCustomer: "", description: "", tone: "", defaultCta: "", mainLink: "", autoApprovalEnabled: false } }); return true; }
      return false;
    });

    await page.goto("/dashboard");
    await page.getByRole("button", { name: "기능 제안하기" }).click();
    await expect(page.getByRole("dialog", { name: "피드백" })).toBeVisible();
    await page.getByRole("button", { name: "피드백 닫기" }).click();
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "전체 메뉴 열기" }).click();
      await page.getByRole("dialog", { name: "전체 메뉴" }).getByRole("button", { name: "피드백" }).click();
    } else {
      await page.getByRole("button", { name: "피드백" }).click();
    }
    await expect(page.getByRole("dialog", { name: "피드백" })).toBeVisible();
    await page.getByRole("button", { name: "피드백 닫기" }).click();
    await page.goto("/support");
    await page.getByRole("button", { name: "기능 제안하기" }).click();
    await expect(page.getByRole("dialog", { name: "피드백" })).toBeVisible();
  });
});
