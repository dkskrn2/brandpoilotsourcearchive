import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const brandId = "00000000-0000-4000-8000-000000000100";
const publishFixtureNow = new Date("2026-08-25T06:00:00.000Z");
const session = {
  user: { id: "user-a11y", displayName: "접근성 사용자", email: "a11y@example.com" },
  workspace: { id: "workspace-a11y", name: "접근성 워크스페이스" },
  brand: { id: brandId, name: "접근성 브랜드" },
};

const schedulablePublishItem = {
  itemKey: "output:e2e-schedulable",
  workspaceId: "workspace-a11y",
  brandId,
  title: "예약 가능한 콘텐츠",
  createdAt: "2026-08-20T00:00:00.000Z",
  contentFormat: "card_news",
  channels: [],
  source: { type: "topic_table", label: "주제표", detail: null, urls: [] },
  targets: [],
  reviewTargets: [],
  contentStatus: "completed",
  publishStatus: "unreserved",
  status: "completed_unpublished",
  operationalStatus: "action_required",
  operationalReason: "review_required",
  groupStatus: null,
  publicationProgress: "none",
  scheduledFor: null,
  effectiveScheduledFor: null,
  publishedAt: null,
  calendarDate: null,
  calendarPlacement: "unreserved",
  assignmentMode: null,
  sourceRefs: { contentTopicId: null, proposalId: null, generationId: null, generationOutputId: "output-e2e", calendarSlotId: null, topicPublishGroupId: null, queueIds: [] },
  schedulable: true,
  scheduleBlockedReason: null,
  lastError: null,
};

function datedPublishTarget(queueId: string, status: "scheduled" | "deferred" | "published", scheduledFor: string) {
  return {
    queueId,
    channelOutputId: `channel-${queueId}`,
    channel: "instagram",
    status,
    scheduledFor,
    publishedAt: status === "published" ? scheduledFor : null,
    failedAt: null,
    lastError: null,
    externalPostId: status === "published" ? `post-${queueId}` : null,
    externalUrl: status === "published" ? `https://instagram.example/${queueId}` : null,
    previewTitle: queueId,
    previewBody: `${queueId} 본문`,
    outputJson: {},
    artifactPublicUrl: null,
    sourceSummary: "게시 일정 e2e",
  };
}

function datedPublishItem(input: {
  id: string;
  title: string;
  calendarDate: string;
  status: "reserved" | "deferred" | "published";
  operationalStatus: "upcoming" | "delayed_today" | "published";
  operationalReason: "future_reservation" | "reserved_time_passed" | "published";
  targetStatus: "scheduled" | "deferred" | "published";
}) {
  const target = datedPublishTarget(`queue-${input.id}`, input.targetStatus, input.calendarDate);
  return {
    itemKey: `output:${input.id}`,
    workspaceId: "workspace-a11y",
    brandId,
    title: input.title,
    createdAt: "2026-08-20T00:00:00.000Z",
    contentFormat: "card_news",
    channels: ["instagram"],
    source: { type: "topic_table", label: "주제표", detail: null, urls: [] },
    targets: [target],
    reviewTargets: [],
    contentStatus: "completed",
    publishStatus: input.status,
    status: input.status,
    operationalStatus: input.operationalStatus,
    operationalReason: input.operationalReason,
    groupStatus: input.status === "reserved" ? "scheduled" : null,
    publicationProgress: input.status === "published" ? "complete" : "none",
    scheduledFor: input.calendarDate,
    effectiveScheduledFor: input.calendarDate,
    publishedAt: input.status === "published" ? input.calendarDate : null,
    calendarDate: input.calendarDate,
    calendarPlacement: "dated",
    assignmentMode: "manual",
    sourceRefs: { contentTopicId: null, proposalId: null, generationId: null, generationOutputId: input.id, calendarSlotId: `slot-${input.id}`, topicPublishGroupId: input.status === "reserved" ? `group-${input.id}` : null, queueIds: [target.queueId] },
    schedulable: false,
    scheduleBlockedReason: "already_reserved",
    lastError: null,
  };
}

const datedPublishItems = [
  datedPublishItem({ id: "published", title: "완료된 게시", calendarDate: "2026-08-26T02:30:00.000Z", status: "published", operationalStatus: "published", operationalReason: "published", targetStatus: "published" }),
  datedPublishItem({ id: "delayed", title: "지연된 게시", calendarDate: "2026-08-27T02:30:00.000Z", status: "deferred", operationalStatus: "delayed_today", operationalReason: "reserved_time_passed", targetStatus: "deferred" }),
  datedPublishItem({ id: "scheduled", title: "예정된 게시", calendarDate: "2026-08-28T02:30:00.000Z", status: "reserved", operationalStatus: "upcoming", operationalReason: "future_reservation", targetStatus: "scheduled" }),
];

const proposal = {
  contractVersion: "content-proposal.v1",
  title: "접근 가능한 구현안",
  reasonToCreateNow: "승인된 근거가 준비되었습니다.",
  contentFamily: "informational",
  topic: "브랜드 운영",
  target: { name: "브랜드 운영자" },
  messageStrategy: "problem_solution",
  hook: "운영 기준부터 확인하세요",
  keyMessage: "검증된 근거만 사용합니다.",
  evidence: [{ sourceSnapshotId: "snapshot-1", summary: "공식 페이지 근거" }],
  outline: [{ heading: "기준", purpose: "운영 기준 설명" }],
  outputFormat: "card_news",
  channelTargets: ["instagram"],
  recommendedReferenceQuery: { strategies: ["problem_solution"], formats: ["card_news"], tags: ["운영"] },
};

const proposalRecord = {
  id: "proposal-1",
  batchId: "batch-1",
  proposal,
  status: "suggested",
  generationId: null,
  createdAt: "2026-07-28T00:00:00.000Z",
};

const proposalBatch = {
  id: "batch-1",
  workspaceId: "workspace-a11y",
  brandId,
  origin: "manual",
  contentFamily: "informational",
  request: {
    contractVersion: "content-proposal-request.v1",
    contentFamily: "informational",
    subjectInput: { mode: "brand_topic", topic: "브랜드 운영", wikiItemIds: [] },
    outputFormats: ["card_news"],
    channelTargets: ["instagram"],
    sourceSnapshotIds: ["snapshot-1"],
    performanceSnapshotIds: [],
  },
  sourceSnapshots: [{ id: "snapshot-1", url: "https://brand.example/guide" }],
  status: "ready",
  proposals: [proposalRecord],
  errorCode: null,
  errorMessage: null,
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
};

function generation(id: string, status: "generating" | "completed") {
  return {
    id,
    brandId,
    type: "card_news",
    title: status === "completed" ? "검토할 콘텐츠" : "생성 중 콘텐츠",
    status,
    currentStage: status,
    draft: {},
    analysis: {},
    outputs: status === "completed" ? [{
      id: "output-1",
      generationId: id,
      outputIndex: 1,
      title: "카드뉴스 결과",
      status: "completed",
      content: { hook: "근거 중심 운영", body: "확인된 정보입니다.", cta: "자세히 보기", hashtags: ["브랜드"] },
      manifest: {
        outputFormat: "card_news",
        deliveryFormat: "instagram_feed_carousel",
        assets: [{ index: 0, url: "https://assets.test/card.png", fileName: "card.png", mimeType: "image/png", width: 1080, height: 1080 }],
      },
      manifestUrl: null,
      failureCode: null,
      failureMessage: null,
      downloadedAt: null,
      revisionCapabilities: ["save_copy", "regenerate_hook"],
    }] : [{
      id: "output-1",
      generationId: id,
      outputIndex: 1,
      title: "카드뉴스 결과",
      status: "generating",
      content: {},
      manifest: {},
      manifestUrl: null,
      failureCode: null,
      failureMessage: null,
      downloadedAt: null,
    }],
    attachmentsLockedAt: "2026-07-28T00:00:00.000Z",
    terminalAt: status === "completed" ? "2026-07-28T00:05:00.000Z" : null,
    retryableUntil: "2026-08-12T00:00:00.000Z",
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:05:00.000Z",
  };
}

async function json(route: Route, value: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
}

async function installFixture(page: Page) {
  await page.addInitScript((auth) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof Request ? input.url : String(input), window.location.href);
      if (url.pathname.endsWith("/auth/me")) {
        return new Response(JSON.stringify(auth), { status: 200, headers: { "content-type": "application/json" } });
      }
      return originalFetch(input, init);
    };
  }, session);

  await page.route("https://assets.test/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("fixture") }));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (url.port !== "4000" && !path.startsWith("/api/")) return route.continue();

    if (path.endsWith("/auth/me")) return json(route, session);
    if (path.endsWith("/ui-status")) return json(route, {
      brandId,
      brandName: "접근성 브랜드",
      logoUrl: null,
      lastGeneratedAt: "2026-07-28T00:00:00.000Z",
      navigation: { onboardingRemaining: 0, contentReview: 1, publishIssues: 0, channelIssues: 0 },
      onboarding: { completedCount: 1, totalCount: 1, remainingCount: 0, steps: [] },
    });
    if (path.endsWith("/dashboard")) return json(route, {
      period: "30d",
      generatedAt: "2026-07-28T00:00:00.000Z",
      lastCollectedAt: "2026-07-28T00:00:00.000Z",
      summary: { publishedCount: 1, exposureCount: 120, pendingReviewCount: 1, failedPublishCount: 0 },
      workflow: { queuedTopics: 0, generating: 1, pendingReview: 1, scheduledOrPublished: 1 },
      dailyExposure: [], channelPerformance: [], topContents: [], attentionItems: [],
    });
    if (path.endsWith("/brand-center")) return json(route, {
      source: { state: "ready" },
      analysis: { state: "confirmed" },
      brandCore: { state: "approved" },
      rules: { state: "approved" },
      products: { state: "ready" },
      wiki: { state: "ready" },
      avatars: { state: "ready" },
    });
    if (path.endsWith("/profile")) return json(route, {
      id: "profile-1", brandId, name: "접근성 브랜드",
      primaryCategory: { code: "it", name: "IT·디지털" }, subcategories: [],
      primaryCustomer: "브랜드 운영자", description: "브랜드 설명", tone: "명확하게",
      defaultCta: "자세히 보기", mainLink: "https://brand.example", autoApprovalEnabled: false,
    });
    if (path.endsWith("/brand-core") || path.endsWith("/brand-rules")) {
      return json(route, { active: null, draft: null, versions: [] });
    }
    if (path.endsWith("/instagram-formats")) return json(route, {
      brandId, brandColor: "초록색",
      formats: [
        { format: "instagram_feed_carousel", enabled: true, rotationOrder: 1, capabilityStatus: "available", capabilityCheckedAt: null, capabilityMetadata: {}, lastError: null },
        { format: "instagram_story", enabled: false, rotationOrder: 2, capabilityStatus: "unchecked", capabilityCheckedAt: null, capabilityMetadata: {}, lastError: null },
        { format: "instagram_reel", enabled: false, rotationOrder: 3, capabilityStatus: "unsupported", capabilityCheckedAt: null, capabilityMetadata: {}, lastError: null },
      ],
    });
    if (path.endsWith("/ai-content/usage")) return json(route, {
      generationUsed: 1, generationLimit: 10, newDownloadUsed: 1, newDownloadLimit: 20,
      resetsAt: "2026-07-29T00:00:00+09:00",
    });
    if (path.endsWith("/ai-content/proposal-batches/batch-1")) return json(route, proposalBatch);
    if (path.endsWith("/ai-content/proposals") && url.searchParams.get("status") === "suggested") return json(route, []);
    if (path.endsWith("/ai-content/references")) return json(route, [{
      id: "reference-1", title: "접근 가능한 레퍼런스", url: "https://reference.example",
      previewUrl: null, source: "uploaded", metrics: {},
    }]);
    if (path.endsWith("/avatars")) return json(route, [{
      id: "avatar-1", workspaceId: "workspace-a11y", brandId, name: "브랜드 모델",
      description: "대표 모델", isDefault: true, status: "active", createdByUserId: "user-a11y",
      createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z",
      images: [{
        id: "avatar-image-1", position: 0, representative: true, storagePath: "avatar.png",
        storageUrl: "https://assets.test/avatar.png", mimeType: "image/png", sizeBytes: 1, checksum: "fixture",
      }],
    }]);
    if (path.endsWith("/channels/capabilities")) return json(route, [{
      channel: "instagram", catalogStatus: "available", connectionStatus: "connected", canGenerate: true,
      generationFormats: ["card_news", "single_image"], exportModes: ["image"],
      publishModes: ["instagram_feed_carousel", "instagram_feed_single"], readiness: "ready", reasonCode: null,
    }]);
    if (path.endsWith("/channels")) return json(route, [{
      channel: "instagram", enabled: true, oauthState: "connected", status: "connected",
      accountLabel: "@accessible", lastHealthyAt: "2026-07-28T00:00:00.000Z", lastPublishedAt: null, lastError: null,
    }]);
    if (path.endsWith("/channel-connection-request")) return json(route, {
      id: "request-1", brandId, status: "draft", requestedChannels: [], note: "", createdAt: null, updatedAt: null,
    });
    if (path.endsWith("/publish-calendar/settings/weekly")) return json(route, {
      brandId, enabled: false, channels: ["instagram"], informationalFormat: "card_news", trendFormat: "reel",
      weeklySchedule: [{ id: "40000000-0000-4000-8000-000000000001", dayOfWeek: 1, time: "11:17", sortOrder: 0 }],
      updatedAt: "2026-08-25T00:00:00.000Z",
    });
    if (path.endsWith("/publish-calendar/settings")) return json(route, {
      brandId, enabled: true, channels: ["instagram"], informationalFormat: "card_news", trendFormat: "reel", slotTimes: ["11:30"], updatedAt: null,
    });
    if (path.endsWith("/publish-calendar/usage")) return json(route, {
      startsAt: "2026-08-24T00:00:00.000Z", endsAt: "2026-08-31T00:00:00.000Z",
      generation: { limit: 10, succeeded: 1, reserved: 0, remaining: 9, additionalAvailable: 9 },
      publishing: { limit: 30, succeeded: 1, reserved: 2, remaining: 29, additionalAvailable: 27 },
    });
    if (path.endsWith("/publish-calendar/manual-options")) return json(route, {
      purposes: [{ value: "informational", label: "정보성" }],
      subjectModes: [{ value: "topic_text", label: "직접 입력", requiredField: "topicText" }],
      channels: [{ value: "instagram", label: "Instagram", formats: [{ value: "card_news", label: "카드뉴스" }, { value: "reel", label: "릴스" }] }],
      products: [], suggestions: [], references: [],
      usage: {
        startsAt: "2026-08-24T00:00:00.000Z", endsAt: "2026-08-31T00:00:00.000Z",
        generation: { limit: 10, succeeded: 1, reserved: 0, remaining: 9, additionalAvailable: 9 },
        publishing: { limit: 7, succeeded: 1, reserved: 2, remaining: 6, additionalAvailable: 4 },
      },
    });
    if (path.endsWith("/publish-items")) return json(route, [schedulablePublishItem, ...datedPublishItems]);
    if (path.endsWith("/publish-queue") || path.endsWith("/publish-results") || path.endsWith("/content-outputs")) return json(route, []);
    if (path.endsWith("/instagram-dm/settings")) return json(route, {
      brandId, enabled: false, wikiReady: true, messagePermissionReady: true,
      workerStatus: "online", webhookStatus: "connected", fallbackMessage: "", errorMessage: "",
    });
    if (path.includes("/dm/conversations")) return json(route, { items: [], nextCursor: null });
    if (path.endsWith("/performance/insights")) return json(route, {
      period: "30d",
      summary: { dataStatus: "sufficient", measuredContentCount: 3, totalExposure: 950 },
      windows: [{ window: "24h", sampleSize: 3, averageExposure: 317 }],
      observations: [{
        id: "observation-1", kind: "observation", label: "평균 노출",
        metric: { name: "평균 노출", value: 317, unit: "회", sampleSize: 3 },
        evidenceSnapshotIds: ["snapshot-1"],
        interpretation: { kind: "interpretation", statement: "24시간 성과가 안정적입니다.", confidence: "medium" },
      }],
      experiments: [], sampleSize: 3, lastCollectedAt: "2026-07-28T00:00:00.000Z", topContents: [],
    });
    if (path.endsWith("/support-requests")) return json(route, []);
    if (path.endsWith("/references") || path.endsWith("/reference-brands")
      || path.endsWith("/product-services") || path.endsWith("/wiki/items")
      || path.endsWith("/sources") || path.endsWith("/source-snapshots")
      || path.endsWith("/source-crawl-runs") || path.endsWith("/knowledge-imports")) return json(route, []);
    if (path.includes("/ai-content/generations/generation-generating")) return json(route, generation("generation-generating", "generating"));
    if (path.includes("/ai-content/generations/generation-review")) return json(route, generation("generation-review", "completed"));
    if (path.endsWith("/ai-content/generations")) return json(route, []);
    return json(route, []);
  });
}

async function expectNoSeriousOrCriticalViolations(page: Page, label: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = result.violations.filter(({ impact }) => impact === "serious" || impact === "critical");
  expect(blocking, `${label}: ${blocking.map((item) => `${item.id} (${item.nodes.length})`).join(", ")}`).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await installFixture(page);
});

const operationPages = [
  ["/dashboard", "오늘의 운영 현황"],
  ["/references", "레퍼런스"],
  ["/channels", "채널 연결"],
  ["/publish-queue", "게시 관리"],
  ["/dm-automation", "Instagram 고객응대"],
  ["/performance", "성과·개선"],
  ["/support", "고객센터"],
] as const;

for (const [path, heading] of operationPages) {
  test(`${path} has no serious or critical axe violations`, async ({ page }) => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expectNoSeriousOrCriticalViolations(page, path);
  });
}

test("brand center and every tab pass the axe gate and support arrow navigation", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/brand-center");
  const tabs = page.getByRole("tab");
  await expect(tabs.first()).toBeVisible();

  for (let index = 0; index < await tabs.count(); index += 1) {
    const tab = tabs.nth(index);
    await tab.focus();
    await page.keyboard.press("Enter");
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expectNoSeriousOrCriticalViolations(page, `brand-center tab ${index + 1}`);
  }

  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(tabs.first()).toBeFocused();
});

test("content setup is keyboard operable and passes the axe gate", async ({ page }) => {
  await page.goto("/ai-content/new");
  await expect(page.getByRole("button", { name: "1. 목적" })).toHaveAttribute("aria-expanded", "true");
  await expectNoSeriousOrCriticalViolations(page, "content setup");

  await page.getByLabel("정보성").check();
  await page.getByRole("button", { name: "목적 완료" }).click();
  await page.getByRole("button", { name: /1\. 목적/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("정보성")).toBeChecked();
});

test("proposal, reference roles and avatar selection are keyboard operable", async ({ page }) => {
  await page.goto("/ai-content/new?proposalBatch=batch-1");
  const proposalButton = page.getByRole("button", { name: "구현안 선택: 접근 가능한 구현안" });
  await proposalButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "접근 가능한 레퍼런스" })).toBeVisible();
  await expectNoSeriousOrCriticalViolations(page, "content proposal");

  const roleToggle = page.getByRole("button", { name: /기획 참고/ }).first();
  if (await roleToggle.isVisible()) {
    await roleToggle.focus();
    await page.keyboard.press("Enter");
  }
  const avatar = page.getByRole("radio", { name: /브랜드 모델/ });
  await avatar.focus();
  await page.keyboard.press("Space");
  await expect(avatar).toBeChecked();
});

test("content generating phase passes the axe gate", async ({ page }) => {
  await page.goto("/ai-content/generation-generating");
  await expect(page.getByRole("heading", { name: "생성 결과 상세" })).toBeVisible();
  await expectNoSeriousOrCriticalViolations(page, "content generating");
});

test("content review phase passes the axe gate", async ({ page }) => {
  await page.goto("/ai-content/generation-review");
  await expect(page.getByRole("heading", { name: "생성 결과 상세" })).toBeVisible();
  await expectNoSeriousOrCriticalViolations(page, "content review");
});

test("sidebar, mobile drawer and feedback dialog are keyboard-only and restore focus", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard");
  const collapse = page.getByRole("button", { name: "사이드바 접기" });
  await collapse.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "사이드바 펼치기" })).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  const trigger = page.getByRole("button", { name: "전체 메뉴 열기" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: "전체 메뉴" });
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  await expect(drawer.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.setViewportSize({ width: 1440, height: 900 });
  const feedback = page.getByRole("button", { name: "피드백" });
  await feedback.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "피드백" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(feedback).toBeFocused();
});

test("supported content controls exclude video and Reel from the accessibility tree", async ({ page }) => {
  await page.goto("/ai-content/new");
  await expect(page.getByRole("radio", { name: /video/i })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /reel/i })).toHaveCount(0);
  await expect(page.getByText(/영상 생성|릴스 생성/i)).toHaveCount(0);
});

const responsivePaths = ["/dashboard", "/brand-center", "/references", "/ai-content/new", "/channels", "/publish-queue", "/dm-automation", "/performance", "/support"];
for (const path of responsivePaths) {
test(`${path} does not overflow at approved widths`, async ({ page }) => {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  for (const width of [1440, 1080, 760, 470, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), {
      message: `${path} must not overflow at ${width}px`,
    }).toBe(true);
  }
});
}

test("publish filters, responsive calendar, and content submit controls remain reachable", async ({ page }) => {
  await page.clock.install({ time: publishFixtureNow });

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/publish-queue", { waitUntil: "domcontentloaded" });

    const filters = page.locator(".queue-filters");
    await expect(filters).toBeVisible();
    const lastFilter = filters.getByRole("button").last();
    await lastFilter.scrollIntoViewIfNeeded();
    await expect(lastFilter).toBeVisible();

    await page.getByRole("tab", { name: "캘린더" }).click();
    if (viewport.width < 640) {
      await expect(page.getByRole("region", { name: "주간 게시 일정" })).toBeVisible();
      await expect(page.getByRole("grid", { name: "게시 캘린더" })).toHaveCount(0);

      const agenda = page.getByRole("region", { name: "주간 게시 일정" });
      for (const status of [
        { date: "8월 26일 일정 보기", slot: "완료된 게시 게시 완료 슬롯 상세 보기", className: "is-completed", label: "게시 완료" },
        { date: "8월 27일 일정 보기", slot: "지연된 게시 게시 지연 슬롯 상세 보기", className: "is-delayed", label: "게시 지연" },
        { date: "8월 28일 일정 보기", slot: "예정된 게시 게시 예정 슬롯 상세 보기", className: "is-upcoming", label: "게시 예정" },
      ]) {
        const dateControl = agenda.getByRole("button", { name: status.date });
        await dateControl.focus();
        await page.keyboard.press("Enter");
        await expect(dateControl).toHaveAttribute("aria-current", "date");
        const slot = agenda.getByRole("button", { name: status.slot });
        await expect(slot).toHaveClass(/publish-mobile-agenda__slot/);
        await expect(slot).toHaveClass(new RegExp(status.className));
        await expect(slot.getByText(status.label)).toBeVisible();
      }

      const scheduledSlot = agenda.getByRole("button", { name: "예정된 게시 게시 예정 슬롯 상세 보기" });
      await scheduledSlot.focus();
      await page.keyboard.press("Space");
      await expect(scheduledSlot).toHaveAttribute("aria-pressed", "true");
      const selectedDetail = page.getByLabel("예정된 게시 슬롯 상세");
      await expect(selectedDetail.getByText("게시 예정", { exact: true })).toBeVisible();
      await expect(selectedDetail.getByRole("button", { name: "예약 변경" })).toBeVisible();
      await expect(selectedDetail.getByRole("button", { name: "슬롯 취소" })).toBeVisible();

      await agenda.getByRole("button", { name: "다음 주" }).click();
      await expect(agenda.getByRole("button", { name: "9월 4일 일정 보기" })).toHaveAttribute("aria-current", "date");
      await expect(agenda.getByRole("button", { name: "9월 6일 일정 보기" })).toBeVisible();
      await agenda.getByRole("button", { name: "이전 주" }).click();
      await expect(agenda.getByRole("button", { name: "8월 28일 일정 보기" })).toHaveAttribute("aria-current", "date");
      await expect(agenda.getByRole("button", { name: "8월 24일 일정 보기" })).toBeVisible();
    } else {
      await expect(page.getByRole("grid", { name: "게시 캘린더" })).toBeVisible();
      await expect(page.getByRole("region", { name: "주간 게시 일정" })).toHaveCount(0);
      const monthGrid = page.getByRole("grid", { name: "게시 캘린더" });
      await expect(monthGrid.getByRole("button", { name: "완료된 게시 게시 완료 슬롯 상세 보기" })).toHaveClass(/is-completed/);
      await expect(monthGrid.getByRole("button", { name: "지연된 게시 게시 지연 슬롯 상세 보기" })).toHaveClass(/is-delayed/);
      await expect(monthGrid.getByRole("button", { name: "예정된 게시 게시 예정 슬롯 상세 보기" })).toHaveClass(/is-upcoming/);
    }

    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), {
      message: `publish calendar must not overflow at ${viewport.width}x${viewport.height}`,
    }).toBe(true);

    await page.getByRole("button", { name: "콘텐츠 추가" }).click();
    const picker = page.getByRole("dialog", { name: "콘텐츠 추가" });
    await picker.getByRole("article", { name: "예약 가능한 콘텐츠" }).getByRole("button", { name: "게시 설정" }).click();
    const schedule = page.getByRole("dialog", { name: "예약 가능한 콘텐츠 게시 설정" });
    for (const control of [
      schedule.getByRole("textbox", { name: "게시 날짜" }),
      schedule.getByRole("textbox", { name: "게시 시간" }),
      schedule.getByRole("button", { name: "게시 예약" }),
    ]) {
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeVisible();
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), {
      message: `publish schedule must not overflow at ${viewport.width}x${viewport.height}`,
    }).toBe(true);
    await schedule.getByRole("button", { name: "닫기" }).click();

    await page.getByRole("button", { name: "콘텐츠 추가" }).click();
    const newContentPicker = page.getByRole("dialog", { name: "콘텐츠 추가" });
    await newContentPicker.getByRole("tab", { name: "새 콘텐츠" }).click();
    const submit = newContentPicker.getByRole("button", { name: "생성 1단계에서 계속" });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeVisible();
    await expectNoSeriousOrCriticalViolations(page, `publish picker ${viewport.width}x${viewport.height}`);
    await newContentPicker.getByRole("button", { name: "닫기" }).click();
  }
});

test("weekly automatic settings stacks without overflow and keeps keyboard focus contained", async ({ page }) => {
  await page.clock.install({ time: publishFixtureNow });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/publish-queue", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "캘린더" }).click();
  const edit = page.getByRole("button", { name: "자동 게시 수정" });
  await expect(edit).toBeVisible();
  await edit.click();

  const dialog = page.getByRole("dialog", { name: "주간 자동 게시 설정" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "주간 자동 게시 설정" })).toBeFocused();
  await expect.poll(() => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), {
    message: "weekly automatic settings dialog must not overflow horizontally",
  }).toBe(true);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), {
    message: "weekly automatic settings page must not overflow horizontally",
  }).toBe(true);

  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "설정 저장" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(edit).toBeFocused();
});

test("reduced motion removes transitions, animations, and smooth scrolling", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/dashboard");
  const styles = await page.locator(".sidebar").evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      transitionDuration: computed.transitionDuration,
      animationDuration: computed.animationDuration,
      scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    };
  });
  expect(styles).toEqual({ transitionDuration: "0s", animationDuration: "0s", scrollBehavior: "auto" });
});
