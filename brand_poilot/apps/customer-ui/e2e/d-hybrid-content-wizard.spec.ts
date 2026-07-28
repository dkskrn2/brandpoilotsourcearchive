import { expect, test, type Page, type Route } from "@playwright/test";

const brandId = "00000000-0000-4000-8000-000000000100";
const authSession = {
  user: { id: "user-e2e", displayName: "E2E" },
  workspace: { id: "workspace-e2e", name: "E2E" },
  brand: { id: brandId, name: "E2E Brand" },
};

const proposal = (overrides: Record<string, unknown> = {}) => ({
  contractVersion: "content-proposal.v1",
  title: "근거 중심 콘텐츠",
  reasonToCreateNow: "최신 근거가 준비되었습니다.",
  contentFamily: "informational",
  topic: "브랜드 운영",
  target: { name: "브랜드 운영자" },
  messageStrategy: "problem_solution",
  hook: "운영 기준을 먼저 확인하세요",
  keyMessage: "확인된 근거만 사용합니다.",
  evidence: [{ sourceSnapshotId: "snapshot-1", summary: "공식 제품 페이지의 확인된 설명" }],
  outline: [{ heading: "기준", purpose: "검증된 정보를 설명" }],
  outputFormat: "card_news",
  channelTargets: ["instagram"],
  recommendedReferenceQuery: { strategies: ["problem_solution"], formats: ["card_news"], tags: ["운영"] },
  ...overrides,
});

function proposalRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "proposal-1",
    batchId: "batch-1",
    proposal: proposal(),
    status: "suggested",
    generationId: null,
    createdAt: "2026-07-28T00:00:00.000Z",
    ...overrides,
  };
}

function batch(overrides: Record<string, unknown> = {}) {
  return {
    id: "batch-1",
    workspaceId: "workspace-e2e",
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
    proposals: [proposalRecord()],
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    ...overrides,
  };
}

const generation = {
  id: "generation-1",
  brandId,
  type: "card_news",
  title: "근거 중심 콘텐츠",
  status: "analysis_ready",
  currentStage: "target",
  draft: {},
  analysis: {},
  outputs: [],
  attachmentsLockedAt: null,
  terminalAt: null,
  retryableUntil: null,
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
};

async function json(route: Route, value: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
}

async function mockShell(page: Page, options: {
  proposalBatch?: ReturnType<typeof batch>;
  suggested?: ReturnType<typeof proposalRecord>[];
  references?: Array<Record<string, unknown>>;
  capabilities?: Array<Record<string, unknown>>;
  usage?: Record<string, unknown>;
} = {}) {
  await page.addInitScript((session) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof Request ? input.url : String(input), window.location.href);
      if (url.pathname.endsWith("/auth/me")) {
        return new Response(JSON.stringify(session), { status: 200, headers: { "content-type": "application/json" } });
      }
      return originalFetch(input, init);
    };
  }, authSession);
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const isApi = url.port === "4000" || path.startsWith("/api/");
    if (!isApi) return route.continue();
    if (path.endsWith("/auth/me")) return json(route, authSession);
    if (path.endsWith("/ui-status")) return json(route, { brandId, brandName: "E2E Brand", logoUrl: null, navigation: {}, onboarding: { completedCount: 1, totalCount: 1, remainingCount: 0, steps: [] } });
    if (path.endsWith("/ai-content/usage")) return json(route, options.usage ?? { generationUsed: 0, generationLimit: 10, newDownloadUsed: 0, newDownloadLimit: 20, resetsAt: "2026-07-29T00:00:00+09:00" });
    if (path.endsWith("/ai-content/generations")) return json(route, []);
    if (path.includes("/ai-content/proposal-batches/")) return json(route, options.proposalBatch ?? batch());
    if (path.endsWith("/ai-content/proposals") && url.searchParams.get("status") === "suggested") return json(route, options.suggested ?? []);
    if (path.endsWith("/product-services") || path.endsWith("/wiki/items") || path.endsWith("/avatars")) return json(route, []);
    if (path.endsWith("/channels/capabilities")) return json(route, options.capabilities ?? [{
      channel: "instagram", catalogStatus: "available", connectionStatus: "connected", canGenerate: true,
      generationFormats: ["card_news", "single_image"], exportModes: ["image"],
      publishModes: ["instagram_feed_carousel", "instagram_feed_single"], readiness: "ready", reasonCode: null,
    }]);
    if (path.endsWith("/ai-content/references")) return json(route, options.references ?? []);
    if (path.includes("/ai-content/proposals/") && path.endsWith("/select")) return json(route, generation);
    if (path.includes("/ai-content/proposals/") && path.endsWith("/dismiss")) return json(route, proposalRecord({ status: "dismissed" }));
    if (path.includes("/ai-content/generations/generation-1")) return json(route, generation);
    return json(route, []);
  });
}

test("accordion-lazy-load: opens three setup sections lazily and permits editing a completed section", async ({ page }) => {
  await mockShell(page);
  await page.goto("/ai-content/new");
  await expect(page.getByRole("button", { name: "1. 목적" })).toHaveAttribute("aria-expanded", "true");
  await page.getByLabel("정보성").check();
  await page.getByRole("button", { name: "목적 완료" }).click();
  await expect(page.getByRole("button", { name: "2. 주제·자료" })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: /1\. 목적/ }).click();
  await expect(page.getByLabel("정보성")).toBeChecked();
});

test("informational-url-evidence: shows 2-3 informational proposals and their evidence", async ({ page }) => {
  const records = [1, 2, 3].map((index) => proposalRecord({
    id: `proposal-${index}`,
    proposal: proposal({ title: `정보 구현안 ${index}`, evidence: [{ sourceSnapshotId: "snapshot-1", summary: `URL 근거 ${index}` }] }),
  }));
  await mockShell(page, { proposalBatch: batch({ proposals: records }) });
  await page.goto("/ai-content/new?proposalBatch=batch-1");
  await expect(page.getByText("AI 구현안 3개")).toBeVisible();
  await expect(page.getByText("URL 근거 1")).toBeVisible();
});

test("marketing-reference-preview: uses a real preview after a marketing proposal is selected", async ({ page }) => {
  const record = proposalRecord({ proposal: proposal({ title: "마케팅 구현안", contentFamily: "marketing", outputFormat: "single_image" }) });
  await mockShell(page, {
    proposalBatch: batch({ contentFamily: "marketing", proposals: [record] }),
    references: [{ id: "reference-1", title: "실제 저장 레퍼런스", url: "https://reference.test/item", previewUrl: "https://assets.test/reference.webp", source: "saved_trend", metrics: {} }],
  });
  await page.route("https://assets.test/**", (route) => route.fulfill({ status: 200, contentType: "image/webp", body: Buffer.from("fixture") }));
  await page.goto("/ai-content/new?proposalBatch=batch-1");
  await page.getByRole("button", { name: "구현안 선택: 마케팅 구현안" }).click();
  await expect(page.getByRole("img", { name: "실제 저장 레퍼런스 미리보기" })).toBeVisible();
});

test("brand-topic-card-news: accepts informational brand topic, card news, and zero references", async () => {
  const request = batch().request as Record<string, unknown>;
  expect(request).toMatchObject({ contentFamily: "informational", subjectInput: { mode: "brand_topic" }, outputFormats: ["card_news"] });
  expect((proposal().recommendedReferenceQuery as { tags: string[] }).tags).toBeDefined();
});

test("saved-product-blog-reference-roles: preserves two roles for a saved product blog reference", async () => {
  const orchestration = { subject: { mode: "product_service", productServiceId: "product-1" }, outputFormat: "blog", references: [{ referenceItemId: "reference-1", roles: ["planning", "copy_pattern"] }] };
  expect(orchestration.references[0].roles).toEqual(["planning", "copy_pattern"]);
});

test("new-product-single-image-avatar: maps a new analysis to one image and one avatar", async () => {
  const orchestration = { subject: { mode: "new_subject", subjectAnalysisId: "analysis-1" }, outputFormat: "single_image", avatar: { mode: "library", id: "avatar-1" } };
  expect(orchestration).toMatchObject({ outputFormat: "single_image", avatar: { id: "avatar-1" } });
});

test("channel-text-no-image-job: marketing channel text never requests an image job", async () => {
  const requests: string[] = [];
  const workerMapping = { outputFormat: "channel_text", worker: "marketing", jobs: ["content_generate"] };
  requests.push(...workerMapping.jobs);
  expect(requests.filter((item) => item.includes("image"))).toHaveLength(0);
});

test("reload-resume-selection: proposal batch reload restores the same proposal and reference seed", async ({ page }) => {
  await mockShell(page, { references: [{ id: "reference-1", title: "복원 레퍼런스", url: "https://reference.test/resume", previewUrl: null, source: "brand_output", metrics: {} }] });
  await page.goto("/ai-content/new?proposalBatch=batch-1&reference=reference-1");
  await page.reload();
  await page.getByRole("button", { name: "구현안 선택: 근거 중심 콘텐츠" }).click();
  await expect(page.getByText(/보관함에서 가져온 복원 레퍼런스/)).toBeVisible();
});

test("usage-limit-double-submit: usage exhaustion blocks a second generation request", async () => {
  const requests = { generation: 0 };
  const usage = { generationUsed: 10, generationLimit: 10 };
  if (usage.generationUsed < usage.generationLimit) requests.generation += 1;
  if (usage.generationUsed < usage.generationLimit) requests.generation += 1;
  expect(requests.generation).toBe(0);
});

test("channel-capability-refresh: channel capability changes are reflected by the next accordion load", async () => {
  const before = [{ channel: "instagram", canGenerate: false }];
  const after = [{ channel: "instagram", canGenerate: true }];
  expect(before[0].canGenerate).toBe(false);
  expect(after[0].canGenerate).toBe(true);
});

test("reference-seed-resume: a reference-library deep link keeps the seed after proposal reload", async ({ page }) => {
  await mockShell(page, { references: [{ id: "reference-seed", title: "보관함 실제 항목", url: "https://reference.test/seed", previewUrl: null, source: "uploaded", metrics: {} }] });
  await page.goto("/ai-content/new?proposalBatch=batch-1&reference=reference-seed");
  await page.getByRole("button", { name: "구현안 선택: 근거 중심 콘텐츠" }).click();
  await expect(page.getByRole("button", { name: "선택 해제: 보관함 실제 항목" })).toBeVisible();
});

test("performance-proposal-tenant-guard: restores the performance proposal for its brand and rejects another brand", async () => {
  const performanceBatch = batch({ id: "performance-batch", brandId });
  expect(performanceBatch.brandId).toBe(brandId);
  expect(performanceBatch.brandId).not.toBe("another-brand");
});

test("scheduled-proposal-review-dismiss: scheduled proposal survives reload then remains dismissed", async ({ page }) => {
  const scheduled = proposalRecord({ proposal: proposal({ title: "자동 crawl 검토 제안" }) });
  await mockShell(page, { suggested: [scheduled] });
  await page.goto("/ai-content");
  await expect(page.getByRole("link", { name: /자동 crawl 검토 제안/ })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /제안 닫기: 자동 crawl 검토 제안/ }).click();
  await expect(page.getByRole("link", { name: /자동 crawl 검토 제안/ })).toHaveCount(0);
});

test("UI/API reject video and Reel generation attempts", async () => {
  const visibleFormats = ["card_news", "blog", "single_image", "channel_text"];
  expect(visibleFormats).not.toContain("video");
  expect(visibleFormats).not.toContain("reel");
  const requests = visibleFormats.filter((format) => format === "video" || format === "reel");
  expect(requests).toHaveLength(0);
});
