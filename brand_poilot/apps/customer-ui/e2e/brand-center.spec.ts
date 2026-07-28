import { expect, test, type Page, type Route } from "@playwright/test";

const baseCore = {
  contractVersion: "brand-core.v1",
  summary: { oneLine: "승인된 브랜드 문장", description: "승인된 브랜드 설명" },
  audiences: [{ name: "브랜드 담당자", problem: "운영 시간 부족", desiredOutcome: "일관된 콘텐츠" }],
  valueProposition: { primary: "브랜드 운영 자동화", differentiators: ["승인 기반"], proofPoints: ["버전 이력"] },
  messaging: {
    appeals: ["시간 절약"],
    tone: ["명확함"],
    preferredPhrases: ["근거를 바탕으로"],
    brandDirection: "과장 없는 실무형",
    priorityMessages: ["승인 정보 우선"],
  },
};

async function installBrandCenterFixture(page: Page) {
  let version = 1;
  let active = {
    id: "core-1", sourceAnalysisId: "analysis-1", version, status: "approved",
    core: structuredClone(baseCore), evidence: [], reviewState: {},
    approvedAt: "2026-07-26T00:00:00.000Z", updatedAt: "2026-07-26T00:00:00.000Z",
  };
  let draft: typeof active | null = null;
  let ruleDraft: Record<string, unknown> | null = null;
  let rulesActive: Record<string, unknown> | null = null;
  const versions = [active];
  const sources: Array<Record<string, unknown>> = [];

  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const requestUrl = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (new URL(requestUrl, window.location.href).pathname.endsWith("/auth/me")) {
        return new Response(JSON.stringify({
          user: { id: "owner-1", displayName: "브랜드 소유자", email: "owner@example.com" },
          workspace: { id: "workspace-1", name: "테스트" },
          brand: { id: "brand-d", name: "모종 테스트" },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return originalFetch(input, init);
    };
  });

  const json = (route: Route, body: unknown, status = 200) => route.fulfill({
    status,
    headers: {
      "access-control-allow-origin": route.request().headers().origin ?? "http://127.0.0.1:5273",
      "access-control-allow-credentials": "true",
    },
    json: body,
  });

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (url.port !== "4000" && !path.startsWith("/api/")) return route.continue();
    if (path.endsWith("/auth/me")) return json(route, {
      user: { id: "owner-1", displayName: "브랜드 소유자", email: "owner@example.com" },
      workspace: { id: "workspace-1", name: "테스트" },
      brand: { id: "brand-d", name: "모종 테스트" },
    });
    if (path.endsWith("/ui-status")) return json(route, {
      brandId: "brand-d", brandName: "모종 테스트", logoUrl: null, lastGeneratedAt: null,
      navigation: { onboardingRemaining: 0, contentReview: 0, publishIssues: 0, channelIssues: 0 },
      onboarding: { completedCount: 5, totalCount: 5, remainingCount: 0, steps: [] },
    });
    if (path.endsWith("/ai-content/usage")) return json(route, { generationUsed: 0, generationLimit: 10, newDownloadUsed: 0, newDownloadLimit: 20, resetsAt: "2026-07-27T00:00:00+09:00" });
    if (path.endsWith("/brand-center")) return json(route, {
      source: { state: sources.length ? "ready" : "empty" }, analysis: { state: "confirmed" },
      brandCore: { state: active ? "approved" : "empty" }, rules: { state: rulesActive ? "approved" : "empty" },
      products: { state: "unavailable" }, wiki: { state: "unavailable" }, avatars: { state: "unavailable" },
    });
    if (path.endsWith("/brand-core") && request.method() === "GET") return json(route, { active, draft, versions });
    if (path.endsWith("/brand-core/drafts") && request.method() === "POST") {
      version += 1;
      draft = { ...active, id: `core-${version}`, version, status: "draft", approvedAt: null, updatedAt: new Date().toISOString(), core: structuredClone(active.core) };
      versions.unshift(draft);
      return json(route, draft, 201);
    }
    if (/\/brand-core\/drafts\/[^/]+$/.test(path) && request.method() === "PATCH") {
      const body = request.postDataJSON();
      draft = { ...draft!, core: body.core, reviewState: { "summary.oneLine": { decision: "user_edited", reviewerUserId: "owner-1", reviewedAt: new Date().toISOString() } }, updatedAt: new Date().toISOString() };
      versions.splice(versions.findIndex((item) => item.id === draft!.id), 1, draft);
      return json(route, draft);
    }
    if (path.endsWith("/approve") && path.includes("/brand-core/")) {
      active = { ...draft!, status: "approved", approvedAt: new Date().toISOString() };
      versions.splice(versions.findIndex((item) => item.id === active.id), 1, active);
      draft = null;
      return json(route, active);
    }
    if (path.endsWith("/brand-rules") && request.method() === "GET") return json(route, { active: rulesActive, draft: ruleDraft, versions: [ruleDraft, rulesActive].filter(Boolean) });
    if (path.endsWith("/brand-rules/draft") && request.method() === "PUT") {
      ruleDraft = { id: "rules-1", version: 1, status: "draft", rules: request.postDataJSON(), approvedAt: null, updatedAt: new Date().toISOString() };
      return json(route, ruleDraft);
    }
    if (path.includes("/brand-rules/") && path.endsWith("/approve")) {
      rulesActive = { ...ruleDraft!, status: "approved", approvedAt: new Date().toISOString() };
      ruleDraft = null;
      return json(route, rulesActive);
    }
    if (path.endsWith("/sources") && request.method() === "GET") return json(route, sources);
    if (path.endsWith("/source-snapshots")) return json(route, []);
    if (path.endsWith("/source-crawl-runs")) return json(route, []);
    if (path.endsWith("/sources") && request.method() === "POST") {
      const body = request.postDataJSON();
      const source = { id: "source-1", brandId: "brand-d", sourceType: body.sourceType, url: body.url, title: null, status: "ready", enabled: true, lastCrawledAt: new Date().toISOString(), lastError: null };
      sources.unshift(source);
      return json(route, { source, initialCrawl: { id: "run-1", brandId: "brand-d", sourceUrlId: "source-1", trigger: "new_source", status: "succeeded", attempt: 1, startedAt: null, finishedAt: null, nextRetryAt: null, lastError: null, processed: 1, created: 1, updated: 0, failed: 0 } }, 201);
    }
    return json(route, []);
  });
}

test("brand center preserves approved data through source, core, rules, and reanalysis lifecycle", async ({ page }) => {
  await installBrandCenterFixture(page);
  await page.goto("/brand-center?tab=understanding&section=sources");

  await page.getByLabel("자사 URL").fill("https://brand.example");
  await page.getByRole("button", { name: "URL 추가" }).click();
  await expect(page.locator(".source-library-list li").filter({ hasText: "https://brand.example" })).toBeVisible();

  await page.getByRole("button", { name: "Brand Core" }).click();
  await expect(page.getByLabel("한 줄 소개")).toHaveValue("승인된 브랜드 문장");
  await expect(page.getByLabel("한 줄 소개")).toBeDisabled();
  await page.getByRole("button", { name: "변경 검토" }).click();
  const oneLine = page.getByLabel("한 줄 소개");
  await oneLine.fill("사용자가 검토한 브랜드 문장");
  await page.getByRole("button", { name: "Brand Core 승인" }).click();
  await expect(page.getByText("Brand Core를 승인했습니다.")).toBeVisible();
  await expect(page.getByLabel("한 줄 소개")).toHaveValue("사용자가 검토한 브랜드 문장");
  await expect(page.getByLabel("한 줄 소개")).toBeDisabled();

  await page.getByRole("button", { name: "실행 규칙" }).click();
  await page.getByLabel("반드시 포함할 문구").fill("사실에 근거해 안내");
  await page.getByRole("button", { name: "규칙 승인" }).click();
  await expect(page.getByText("실행 규칙을 승인했습니다.")).toBeVisible();

  await page.getByRole("button", { name: "변경 검토" }).click();
  await expect(page.getByLabel("한 줄 소개")).toHaveValue("사용자가 검토한 브랜드 문장");
  await expect(page.getByLabel("한 줄 소개")).toBeEnabled();
  await page.getByRole("button", { name: "버전 이력" }).click();
  await expect(page.getByText("v3")).toBeVisible();
  await expect(page.getByText("v2")).toBeVisible();
});
