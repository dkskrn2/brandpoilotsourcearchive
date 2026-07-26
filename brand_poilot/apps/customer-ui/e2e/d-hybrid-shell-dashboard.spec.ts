import { expect, test, type Page } from "@playwright/test";

async function installFixture(page: Page, options: { failDashboard?: boolean } = {}) {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const requestUrl = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (new URL(requestUrl, window.location.href).pathname.endsWith("/auth/me")) {
        return new Response(JSON.stringify({
          user: { id: "user-d", displayName: "D 사용자", email: "d@example.com" },
          workspace: { id: "workspace-d", name: "D 워크스페이스" },
          brand: { id: "brand-d", name: "모종 테스트" },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return originalFetch(input, init);
    };
  });

  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    const pathname = requestUrl.pathname;
    if (requestUrl.port !== "4000" && !pathname.startsWith("/api/")) return route.continue();
    const common = {
      headers: {
        "access-control-allow-origin": route.request().headers().origin ?? "http://127.0.0.1:5273",
        "access-control-allow-credentials": "true",
      },
    };
    if (pathname.endsWith("/auth/me")) {
      return route.fulfill({ ...common, json: {
        user: { id: "user-d", displayName: "D 사용자", email: "d@example.com" },
        workspace: { id: "workspace-d", name: "D 워크스페이스" },
        brand: { id: "brand-d", name: "모종 테스트" },
      } });
    }
    if (pathname.endsWith("/ui-status")) {
      return route.fulfill({ ...common, json: {
        brandId: "brand-d",
        brandName: "모종 테스트",
        logoUrl: null,
        lastGeneratedAt: "2026-07-22T10:00:00.000Z",
        navigation: { onboardingRemaining: 1, contentReview: 3, publishIssues: 1, channelIssues: 2 },
        onboarding: { completedCount: 4, totalCount: 5, remainingCount: 1, steps: [] },
      } });
    }
    if (pathname.endsWith("/ai-content/usage")) {
      return route.fulfill({ ...common, json: {
        generationUsed: 4,
        generationLimit: 10,
        newDownloadUsed: 7,
        newDownloadLimit: 20,
        resetsAt: "2026-07-23T00:00:00+09:00",
      } });
    }
    if (pathname.endsWith("/dashboard")) {
      if (options.failDashboard) return route.fulfill({ ...common, status: 500, json: { error: "fixture_failure" } });
      return route.fulfill({ ...common, json: {
        period: "30d",
        generatedAt: "2026-07-22T00:00:00.000Z",
        lastCollectedAt: "2026-07-22T00:00:00.000Z",
        summary: { publishedCount: 12, exposureCount: 8430, pendingReviewCount: 3, failedPublishCount: 1 },
        workflow: { queuedTopics: 2, generating: 1, pendingReview: 3, scheduledOrPublished: 12 },
        dailyExposure: [],
        channelPerformance: [],
        topContents: [],
        attentionItems: [],
      } });
    }
    return route.fulfill({ ...common, json: [] });
  });
}

test("desktop D shell keeps approved dimensions and dashboard actions", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await installFixture(page);
  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { level: 1, name: "오늘의 운영 현황" })).toBeVisible();
  const sidebar = page.getByRole("complementary");
  await expect(sidebar).toHaveCSS("width", "238px");
  await expect(page.locator(".topbar")).toHaveCSS("min-height", "64px");
  await expect(page.getByRole("link", { name: "콘텐츠 만들기" })).toHaveAttribute("href", "/ai-content/new");
  await expect(page.getByRole("link", { name: "브랜드 검토하기" })).toHaveAttribute("href", "/brand-settings");

  await page.getByRole("button", { name: "사이드바 접기" }).click();
  await expect(sidebar).toHaveCSS("width", "78px");
  await page.screenshot({ path: testInfo.outputPath("d-dashboard-desktop.png"), fullPage: true });
});

test("mobile drawer locks scroll, closes with Escape, and restores focus", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixture(page);
  await page.goto("/dashboard");

  const trigger = page.getByRole("button", { name: "전체 메뉴 열기" });
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "전체 메뉴" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await page.screenshot({ path: testInfo.outputPath("d-dashboard-mobile-menu.png"), fullPage: true });

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "전체 메뉴" })).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");
});

test("dashboard API failure stays honest and retryable", async ({ page }) => {
  await installFixture(page, { failDashboard: true });
  await page.goto("/dashboard");

  await expect(page.getByRole("alert")).toContainText("대시보드를 불러오지 못했습니다.");
  await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();
  await expect(page.getByLabel("최근 30일 요약")).toHaveCount(0);
  await expect(page.getByText("8,430회")).toHaveCount(0);
});
