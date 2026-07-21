import { expect, test, type Page, type Route } from "@playwright/test";

const generation = (status: "generating" | "completed") => ({
  id: "generation-e2e",
  brandId: "brand-e2e",
  type: "card_news",
  title: "실제 카드뉴스 결과",
  status,
  currentStage: status === "completed" ? "completed" : "generate",
  draft: {},
  analysis: {},
  outputs: [{
    id: "output-e2e",
    generationId: "generation-e2e",
    outputIndex: 1,
    title: "카드뉴스",
    status,
    content: status === "completed" ? { caption: "저장할 만한 실무 정보", hashtags: ["#브랜드운영"], cta: "다시 확인하세요." } : {},
    manifest: status === "completed" ? {
      version: "ai-content.v1",
      type: "card_news",
      title: "실제 카드뉴스 결과",
      assets: [1, 2, 3].map((index) => ({ index, role: "slide", url: `https://assets.test/slide-${index}.png`, fileName: `slide-${index}.png`, mimeType: "image/png", width: 1080, height: 1080 })),
      content: { caption: "저장할 만한 실무 정보", hashtags: ["#브랜드운영"], cta: "다시 확인하세요." },
    } : {},
    manifestUrl: status === "completed" ? "https://assets.test/manifest.json" : null,
    failureCode: null,
    failureMessage: null,
    downloadedAt: null,
  }],
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:01:00.000Z",
});

test("restores a running generation after reload and renders every real artifact", async ({ page }) => {
  let allowComplete = false;
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof Request ? input.url : String(input), window.location.href);
      if (url.pathname.endsWith("/auth/me")) return new Response(JSON.stringify({ user: { id: "user-e2e", displayName: "E2E" }, workspace: { id: "workspace-e2e", name: "E2E" }, brand: { id: "brand-e2e", name: "E2E Brand" } }), { status: 200, headers: { "content-type": "application/json" } });
      return originalFetch(input, init);
    };
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "assets.test") {
      return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=", "base64") });
    }
    const isApi = url.port === "4000" || url.pathname.startsWith("/api/");
    if (!isApi) return route.continue();
    if (url.pathname.endsWith("/auth/me")) return route.fulfill({ json: { user: { id: "user-e2e", displayName: "E2E" }, workspace: { id: "workspace-e2e", name: "E2E" }, brand: { id: "brand-e2e", name: "E2E Brand" } } });
    if (url.pathname.endsWith("/ui-status")) return route.fulfill({ json: { brandId: "brand-e2e", brandName: "E2E Brand", logoUrl: null, navigation: {}, onboarding: { completedCount: 1, totalCount: 1, remainingCount: 0, steps: [] } } });
    if (url.pathname.endsWith("/ai-content/generations/generation-e2e")) {
      return route.fulfill({ json: generation(allowComplete ? "completed" : "generating") });
    }
    if (url.pathname.endsWith("/channels")) return route.fulfill({ json: [] });
    return route.fulfill({ json: [] });
  });

  await page.goto("/ai-content/generation-e2e");
  await expect(page.getByText("생성 작업 상태: 생성 중")).toBeVisible();
  allowComplete = true;
  await page.reload();
  await expect(page.getByRole("img", { name: "카드뉴스 슬라이드 3" })).toBeVisible();
  await expect(page.locator('img[src*="picsum"]')).toHaveCount(0);
});

test("publishes selected Instagram feed and story targets without a confirmation dialog", async ({ page }) => {
  let publishBody: Record<string, unknown> | null = null;
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof Request ? input.url : String(input), window.location.href);
      if (url.pathname.endsWith("/auth/me")) return new Response(JSON.stringify({ user: { id: "user-e2e", displayName: "E2E" }, workspace: { id: "workspace-e2e", name: "E2E" }, brand: { id: "brand-e2e", name: "E2E Brand" } }), { status: 200, headers: { "content-type": "application/json" } });
      return originalFetch(input, init);
    };
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "assets.test") {
      return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=", "base64") });
    }
    const isApi = url.port === "4000" || url.pathname.startsWith("/api/");
    if (!isApi) return route.continue();
    if (url.pathname.endsWith("/auth/me")) return route.fulfill({ json: { user: { id: "user-e2e", displayName: "E2E" }, workspace: { id: "workspace-e2e", name: "E2E" }, brand: { id: "brand-e2e", name: "E2E Brand" } } });
    if (url.pathname.endsWith("/ui-status")) return route.fulfill({ json: { brandId: "brand-e2e", brandName: "E2E Brand", logoUrl: null, navigation: {}, onboarding: { completedCount: 1, totalCount: 1, remainingCount: 0, steps: [] } } });
    if (url.pathname.endsWith("/ai-content/generations/generation-e2e")) return route.fulfill({ json: generation("completed") });
    if (url.pathname.endsWith("/channels")) return route.fulfill({ json: [{ type: "instagram", label: "Instagram", enabled: true, oauthState: "connected", status: "connected", accountLabel: "@growthline352", lastHealthyAt: "2026-07-20T00:00:00.000Z", lastPublishedAt: "2026-07-20T00:00:00.000Z" }] });
    if (url.pathname.endsWith("/ai-content/outputs/output-e2e/publish")) {
      publishBody = route.request().postDataJSON();
      return route.fulfill({ json: {
        outputId: "output-e2e",
        publishGroupId: "group-e2e",
        targets: [
          { channel: "instagram", deliveryFormat: "instagram_feed_carousel", channelOutputId: "feed-output", queueId: "feed-queue", status: "published", publishedUrl: "https://instagram.example/feed", errorCode: null },
          { channel: "instagram", deliveryFormat: "instagram_story", channelOutputId: "story-output", queueId: "story-queue", status: "scheduled", publishedUrl: null, errorCode: null },
        ],
      } });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto("/ai-content/generation-e2e");
  await expect(page.getByText("Threads OAuth 게시 계정 미연결")).toBeVisible();
  await page.getByRole("checkbox", { name: "게시물" }).check();
  await page.getByRole("checkbox", { name: "스토리" }).check();
  await page.getByRole("button", { name: "선택한 2곳에 지금 게시" }).click();

  await expect(page.getByText("게시 완료")).toBeVisible();
  await expect(page.getByText("게시 대기")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(publishBody).toMatchObject({ targets: [
    { channel: "instagram", deliveryFormat: "instagram_feed_carousel" },
    { channel: "instagram", deliveryFormat: "instagram_story" },
  ] });
});

type ContentType = "card_news" | "blog" | "marketing";
type SubjectType = "product" | "service";

interface PipelineCase {
  name: string;
  contentType: ContentType;
  contentLabel: string;
  subjectType: SubjectType;
  subjectLabel: string;
  sourceUrl?: string;
  subjectName?: string;
  description?: string;
  files?: Array<{ label: "제품 이미지" | "문서"; name: string; mimeType: string; body: string }>;
  status?: "ready" | "partial";
  sourceGaps?: string[];
  regenerate?: boolean;
  analysisDelayMs?: number;
}

interface PipelineFixtureState {
  analysisRequests: Array<Record<string, unknown>>;
  generationPatches: Array<Record<string, unknown>>;
  regenerationCalls: number;
}

const pipelineCases: PipelineCase[] = [
  {
    name: "product URL card news",
    contentType: "card_news",
    contentLabel: "카드뉴스",
    subjectType: "product",
    subjectLabel: "제품",
    sourceUrl: "https://shop.example.com/summer-kit",
    subjectName: "여름 실무 키트",
  },
  {
    name: "product PDF and image marketing asset",
    contentType: "marketing",
    contentLabel: "마케팅 소재",
    subjectType: "product",
    subjectLabel: "제품",
    subjectName: "휴대용 미니 선풍기",
    files: [
      { label: "문서", name: "portable-fan-spec.pdf", mimeType: "application/pdf", body: "%PDF-1.4 product specification" },
      { label: "제품 이미지", name: "portable-fan.jpg", mimeType: "image/jpeg", body: "fixture-image" },
    ],
  },
  {
    name: "SaaS URL and document blog",
    contentType: "blog",
    contentLabel: "블로그",
    subjectType: "service",
    subjectLabel: "서비스",
    sourceUrl: "https://saas.example.com/automation",
    subjectName: "업무 자동화 SaaS",
    files: [{ label: "문서", name: "saas-introduction.md", mimeType: "text/markdown", body: "# SaaS introduction\nMonthly subscription." }],
  },
  {
    name: "consulting description and PDF card news",
    contentType: "card_news",
    contentLabel: "카드뉴스",
    subjectType: "service",
    subjectLabel: "서비스",
    subjectName: "전환 개선 컨설팅",
    description: "온라인 문의부터 결제까지의 병목을 진단하고 실행 순서를 설계합니다.",
    files: [{ label: "문서", name: "consulting-process.pdf", mimeType: "application/pdf", body: "%PDF-1.4 consulting process" }],
  },
  {
    name: "failed URL with valid attachment partial result",
    contentType: "marketing",
    contentLabel: "마케팅 소재",
    subjectType: "product",
    subjectLabel: "제품",
    sourceUrl: "https://offline.example.com/product",
    subjectName: "오프라인 자료 제품",
    files: [{ label: "문서", name: "fallback-product.csv", mimeType: "text/csv", body: "name,benefit\nfixture,reliable" }],
    status: "partial",
    sourceGaps: ["URL 자료를 읽지 못해 첨부 문서를 기준으로 분석했습니다."],
  },
  {
    name: "appeal regeneration failure then retry",
    contentType: "card_news",
    contentLabel: "카드뉴스",
    subjectType: "service",
    subjectLabel: "서비스",
    sourceUrl: "https://service.example.com/education",
    subjectName: "실무 교육 서비스",
    regenerate: true,
  },
];

const authSession = {
  user: { id: "user-e2e", displayName: "E2E" },
  workspace: { id: "workspace-e2e", name: "E2E" },
  brand: { id: "brand-e2e", name: "E2E Brand" },
};

const readyUiStatus = {
  brandId: "brand-e2e",
  brandName: "E2E Brand",
  logoUrl: null,
  navigation: {},
  onboarding: {
    completedCount: 1,
    totalCount: 1,
    remainingCount: 0,
    steps: [{ id: "brand-profile", title: "브랜드 정보", description: "입력됨", actionLabel: "설정", path: "/brand-settings", status: "completed" }],
  },
};

function analysisFixture(config: PipelineCase, regenerated = false) {
  const targets = [1, 2, 3].map((index) => ({
    id: `target-${index}`,
    name: `추천 타깃 ${index}`,
    traits: [`상황 ${index}`],
    painPoints: [`해결할 문제 ${index}`],
    purchaseMotivations: [`선택 동기 ${index}`],
    uspEvidence: [],
  }));
  const appealsByTarget = Object.fromEntries(targets.map((target, targetIndex) => [
    target.id,
    [1, 2].map((appealIndex) => ({
      id: `${target.id}-${regenerated ? "retry" : "appeal"}-${appealIndex}`,
      targetId: target.id,
      title: regenerated ? `재생성 소구점 ${targetIndex + 1}-${appealIndex}` : `추천 소구점 ${targetIndex + 1}-${appealIndex}`,
      description: `고객 문제와 확인된 근거를 연결한 설명 ${appealIndex}`,
      evidenceType: "product_fact",
      connectionReason: "확인된 사실을 타깃 문제와 연결",
      sources: [],
    })),
  ]));
  return {
    id: "analysis-e2e",
    generationId: "generation-pipeline-e2e",
    contractVersion: "subject-analysis.v2",
    workspaceId: "workspace-e2e",
    brandId: "brand-e2e",
    subjectType: config.subjectType,
    sourceUrl: config.sourceUrl ?? "",
    normalizedUrl: config.sourceUrl ?? "",
    input: { name: config.subjectName ?? "", promotionOrTerms: "", description: config.description ?? "" },
    status: config.status ?? "ready",
    facts: [],
    structuredData: {},
    research: {},
    targets,
    appealsByTarget,
    selectedImageId: null,
    images: [],
    analysisVersion: regenerated ? 2 : 1,
    errorCode: null,
    errorMessage: null,
    sourceGaps: config.sourceGaps ?? [],
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:01:00.000Z",
    completedAt: "2026-07-22T00:01:00.000Z",
  };
}

function draftGeneration(type: ContentType, draft: Record<string, unknown> = {}) {
  return {
    id: "generation-pipeline-e2e",
    brandId: "brand-e2e",
    type,
    title: "파이프라인 E2E",
    status: "draft",
    currentStage: null,
    draft,
    analysis: {},
    outputs: [],
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:01:00.000Z",
  };
}

async function fulfillPipelineApi(route: Route, config: PipelineCase, state: PipelineFixtureState) {
  const request = route.request();
  const url = new URL(request.url());

  if (url.hostname === "vercel.com" && url.pathname === "/api/blob/") {
    const pathname = url.searchParams.get("pathname") ?? "fixture-upload";
    return route.fulfill({
      json: {
        url: `https://assets.test/${pathname}`,
        downloadUrl: `https://assets.test/${pathname}?download=1`,
        pathname,
        contentType: request.headers()["content-type"] ?? "application/octet-stream",
        contentDisposition: `attachment; filename="${pathname.split("/").pop()}"`,
        etag: "fixture-etag",
      },
    });
  }
  if (url.hostname === "assets.test") return route.fulfill({ status: 200, body: "fixture" });

  const isApi = url.port === "4000" || url.pathname.startsWith("/api/");
  if (!isApi) return route.continue();
  if (url.pathname.endsWith("/auth/me")) return route.fulfill({ json: authSession });
  if (url.pathname.endsWith("/ui-status")) return route.fulfill({ json: readyUiStatus });
  if (url.pathname.endsWith("/ai-content/brand-context")) return route.fulfill({ json: { ready: true, brandName: "E2E Brand", ownedUrl: "https://brand.example.com", sourceStatus: "ready", lastCrawledAt: null, wikiVersionId: "wiki-e2e", wikiUpdatedAt: null, summary: "브랜드 컨텍스트", pageCount: 3, brandColor: "#0B57D0" } });
  if (url.pathname.endsWith("/channels")) return route.fulfill({ json: [] });
  if (url.pathname.endsWith("/ai-content/references")) return route.fulfill({ json: [
    { id: "reference-a", source: "brand_output", title: "자사 성과 레퍼런스", url: "https://reference.example/a", previewUrl: null, metrics: { views: 1200 } },
    { id: "reference-b", source: "saved_trend", title: "저장한 트렌드 레퍼런스", url: "https://reference.example/b", previewUrl: null, metrics: { views: 2400 } },
  ] });

  if (url.pathname.endsWith("/attachments/token") && request.method() === "POST") {
    const body = request.postDataJSON() as { fileName: string };
    return route.fulfill({ json: { pathname: `fixtures/${body.fileName}`, clientToken: "vercel_blob_client_fixture" } });
  }
  if (url.pathname.endsWith("/attachments/confirm") && request.method() === "POST") {
    const body = request.postDataJSON() as { fileName: string; storageUrl: string; storagePath: string };
    return route.fulfill({ json: { id: `attachment-${body.fileName}`, storageUrl: body.storageUrl, storagePath: body.storagePath } });
  }

  if (url.pathname.endsWith("/ai-content/generations") && request.method() === "POST") {
    const body = request.postDataJSON() as { draft: Record<string, unknown> };
    return route.fulfill({ json: draftGeneration(config.contentType, body.draft) });
  }
  if (url.pathname.endsWith("/ai-content/generations/generation-pipeline-e2e") && request.method() === "PATCH") {
    const body = request.postDataJSON() as Record<string, unknown>;
    state.generationPatches.push(body);
    return route.fulfill({ json: draftGeneration(config.contentType, body.draft as Record<string, unknown>) });
  }
  if (url.pathname.endsWith("/ai-content/generations/generation-pipeline-e2e/generate") && request.method() === "POST") {
    return route.fulfill({ json: { ...draftGeneration(config.contentType, state.generationPatches.at(-1)?.draft as Record<string, unknown> ?? {}), status: "queued", currentStage: "queued" } });
  }
  if (url.pathname.endsWith("/ai-content/generations/generation-pipeline-e2e") && request.method() === "GET") {
    return route.fulfill({ json: draftGeneration(config.contentType, state.generationPatches.at(-1)?.draft as Record<string, unknown> ?? {}) });
  }

  if (url.pathname.endsWith("/ai-content/subject-analyses") && request.method() === "POST") {
    state.analysisRequests.push(request.postDataJSON() as Record<string, unknown>);
    if (config.analysisDelayMs) await new Promise((resolve) => setTimeout(resolve, config.analysisDelayMs));
    return route.fulfill({ json: analysisFixture(config) });
  }
  if (url.pathname.endsWith("/ai-content/subject-analyses/analysis-e2e/appeals/regenerate") && request.method() === "POST") {
    state.regenerationCalls += 1;
    if (state.regenerationCalls === 1) return route.fulfill({ json: { ...analysisFixture(config), status: "failed", errorCode: "appeal_generation_failed", errorMessage: "fixture regeneration failure" } });
    return route.fulfill({ json: analysisFixture(config, true) });
  }
  if (url.pathname.endsWith("/ai-content/subject-analyses/analysis-e2e") && request.method() === "GET") return route.fulfill({ json: analysisFixture(config, state.regenerationCalls > 1) });
  return route.fulfill({ json: [] });
}

async function installPipelineFixtures(page: Page, config: PipelineCase) {
  const state: PipelineFixtureState = { analysisRequests: [], generationPatches: [], regenerationCalls: 0 };
  await page.addInitScript((session) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof Request ? input.url : String(input), window.location.href);
      if (url.pathname.endsWith("/auth/me")) return new Response(JSON.stringify(session), { status: 200, headers: { "content-type": "application/json" } });
      return originalFetch(input, init);
    };
  }, authSession);
  await page.route("**/*", (route) => fulfillPipelineApi(route, config, state));
  return state;
}

async function uploadSubjectFiles(page: Page, files: NonNullable<PipelineCase["files"]>) {
  for (const file of files) {
    await page.getByLabel(file.label).setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: Buffer.from(file.body) });
    await expect(page.getByText(file.name)).toBeVisible();
  }
}

async function runPipelineCase(page: Page, config: PipelineCase) {
  const state = await installPipelineFixtures(page, config);
  await page.goto(`/ai-content/new?type=${config.contentType}`);

  await expect(page.getByRole("heading", { name: "어떤 콘텐츠를 만들까요?" })).toBeVisible();
  await expect(page.getByRole("button", { name: config.contentLabel })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "다음" }).click();
  await expect(page.getByRole("heading", { name: "제품·서비스 자료를 입력하세요" })).toBeVisible();
  await page.getByRole("radio", { name: config.subjectLabel }).click();
  if (config.sourceUrl) await page.getByLabel("제품·서비스 URL (선택)").fill(config.sourceUrl);
  if (config.subjectName) await page.getByLabel("제품 또는 서비스 이름").fill(config.subjectName);
  if (config.description) await page.getByLabel("추가 설명").fill(config.description);
  if (config.files) await uploadSubjectFiles(page, config.files);

  await page.getByRole("button", { name: "분석하고 소구점 만들기" }).click();
  await expect(page).not.toHaveURL(/analysis-results/);
  await expect(page.getByRole("heading", { name: "타깃과 소구점을 선택하세요" })).toBeVisible();
  if (config.status === "partial") await expect.poll(() => state.analysisRequests.length).toBe(1);

  await page.getByRole("radio", { name: "추천 타깃 1" }).click();
  const initialAppealTitle = config.regenerate ? "추천 소구점 1-1" : "추천 소구점 1-1";
  if (config.regenerate) {
    await page.getByRole("button", { name: "소구점 다시 만들기" }).click();
    await expect(page.getByRole("alert")).toContainText("소구점을 다시 만들지 못했습니다");
    await page.getByRole("button", { name: "소구점 다시 만들기" }).click();
    await expect(page.getByRole("radio", { name: "재생성 소구점 1-1" })).toBeVisible();
  }
  const appealTitle = config.regenerate ? "재생성 소구점 1-1" : initialAppealTitle;
  await page.getByRole("radio", { name: appealTitle }).click();
  await page.getByRole("button", { name: `소구점 편집: ${appealTitle}` }).click();
  const editedTitle = `${config.name} 편집 소구점`;
  const editedDescription = `${config.name}에서 사용자가 확인한 최종 소구점 설명`;
  await page.getByLabel("소구점 제목 편집").fill(editedTitle);
  await page.getByLabel("소구점 설명 편집").fill(editedDescription);
  await page.getByRole("button", { name: `소구점 편집 완료: ${editedTitle}` }).click();
  await expect(page.getByRole("radio", { name: editedTitle })).toBeVisible();

  await page.getByRole("button", { name: "다음" }).click();
  await expect(page.getByRole("heading", { name: "참고할 콘텐츠를 선택하세요" })).toBeVisible();
  await page.getByRole("button", { name: "레퍼런스 선택: 자사 성과 레퍼런스" }).click();
  await page.getByRole("button", { name: "레퍼런스 선택: 저장한 트렌드 레퍼런스" }).click();
  const selectedTray = page.getByRole("complementary", { name: "선택한 레퍼런스" });
  await selectedTray.getByRole("listitem").nth(1).getByRole("button", { name: "앞으로 이동" }).click();
  await expect(selectedTray.getByRole("listitem").first()).toContainText("저장한 트렌드 레퍼런스");

  await page.getByRole("button", { name: "다음" }).click();
  await page.getByLabel("콘텐츠 목적").selectOption("information");
  await page.getByRole("button", { name: "생성 시작" }).click();
  await expect.poll(() => state.generationPatches.length).toBeGreaterThanOrEqual(2);

  const analysisRequest = state.analysisRequests[0];
  expect(analysisRequest).toMatchObject({
    contractVersion: "subject-analysis.v2",
    subjectType: config.subjectType,
    sourceUrl: config.sourceUrl ?? null,
    manualInput: { name: config.subjectName ?? "", description: config.description ?? "" },
  });
  expect((analysisRequest.attachmentIds as string[]).length).toBe(config.files?.length ?? 0);

  const finalPatch = state.generationPatches.at(-1) as { draft: Record<string, unknown>; referenceIds: string[] };
  expect(finalPatch.referenceIds).toEqual(["reference-b", "reference-a"]);
  expect(finalPatch.draft).toMatchObject({
    selectedTarget: { id: "target-1" },
    selectedAppeal: { title: editedTitle, description: editedDescription },
    referenceIds: ["reference-b", "reference-a"],
    appealOverridesByTarget: {
      "target-1": expect.arrayContaining([expect.objectContaining({ title: editedTitle, description: editedDescription })]),
    },
  });
  return state;
}

test.describe("product and service subject pipeline", () => {
  for (const config of pipelineCases) {
    test(`${config.name} skips analysis results and persists the edited appeal`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name === "mobile", "Six data-contract fixtures run once on desktop; mobile has a focused accessibility case.");
      const state = await runPipelineCase(page, config);
      if (config.regenerate) expect(state.regenerationCalls).toBe(2);
    });
  }

  test("mobile keeps long evidence and keyboard selection usable", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile-only layout and accessibility coverage.");
    await page.setViewportSize({ width: 390, height: 844 });
    const config: PipelineCase = {
      name: "mobile service document",
      contentType: "card_news",
      contentLabel: "카드뉴스",
      subjectType: "service",
      subjectLabel: "서비스",
      description: "구독 서비스의 도입 장벽과 기대 변화를 분석합니다.",
      files: [{ label: "문서", name: `${"very-long-service-document-name-".repeat(4)}.md`, mimeType: "text/markdown", body: "# service" }],
      analysisDelayMs: 250,
    };
    await installPipelineFixtures(page, config);
    await page.goto("/ai-content/new?type=card_news");
    await page.getByRole("button", { name: "다음" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("radio", { name: "서비스" }).focus();
    await page.keyboard.press("Space");
    await page.getByLabel("추가 설명").fill(config.description!);
    await uploadSubjectFiles(page, config.files!);
    const attachment = page.locator(".attachment-list li").first();
    await expect(attachment).toBeVisible();
    expect(await attachment.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

    await page.getByRole("button", { name: "분석하고 소구점 만들기" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText("제품·서비스 자료 확인 중");
    await expect(page.getByRole("heading", { name: "타깃과 소구점을 선택하세요" })).toBeVisible();
    await page.getByRole("radio", { name: "추천 타깃 1" }).focus();
    await page.keyboard.press("Space");
    await page.getByRole("radio", { name: "추천 소구점 1-1" }).focus();
    await page.keyboard.press("Space");
    await page.getByRole("button", { name: "다음" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "참고할 콘텐츠를 선택하세요" })).toBeVisible();
    await page.getByRole("button", { name: "레퍼런스 선택: 자사 성과 레퍼런스" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("complementary", { name: "선택한 레퍼런스" })).toContainText("자사 성과 레퍼런스");
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  });
});
