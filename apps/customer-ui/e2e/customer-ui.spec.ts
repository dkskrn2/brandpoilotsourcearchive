import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const requestUrl = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (new URL(requestUrl, window.location.href).pathname.endsWith("/auth/me")) {
        return new Response(JSON.stringify({
          user: { id: "user-e2e", displayName: "E2E", email: "e2e@example.com" },
          workspace: { id: "workspace-e2e", name: "E2E" },
          brand: { id: "brand-e2e", name: "E2E Brand" }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return originalFetch(input, init);
    };
  });
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    const pathname = requestUrl.pathname;
    const isApiRequest = requestUrl.port === "4000" || pathname.startsWith("/api/");
    if (!isApiRequest) return route.continue();
    const common = { headers: { "access-control-allow-origin": "http://localhost:5173", "access-control-allow-credentials": "true" } };
    if (pathname.endsWith("/auth/me")) {
      return route.fulfill({ ...common, json: {
        user: { id: "user-e2e", displayName: "E2E", email: "e2e@example.com" },
        workspace: { id: "workspace-e2e", name: "E2E" },
        brand: { id: "brand-e2e", name: "E2E Brand" }
      } });
    }
    if (pathname.endsWith("/ui-status")) {
      return route.fulfill({ ...common, json: {
        brandId: "brand-e2e",
        brandName: "E2E Brand",
        lastGeneratedAt: null,
        navigation: { onboardingRemaining: 0, contentReview: 0, publishIssues: 0, channelIssues: 0 },
        onboarding: {
          completedCount: 1,
          totalCount: 1,
          remainingCount: 0,
          steps: [{ id: "brand-profile", title: "브랜드 정보", description: "", actionLabel: "확인", path: "/brand-settings", status: "completed" }]
        }
      } });
    }
    if (pathname.endsWith("/profile")) {
      return route.fulfill({ ...common, json: {
        name: "E2E Brand",
        industry: "정보통신업",
        primaryCustomer: "기업 실무 담당자",
        description: "E2E brand profile",
        tone: "명확하게",
        defaultCta: "",
        mainLink: "https://example.com",
        autoApprovalEnabled: false
      } });
    }
    if (pathname.endsWith("/instagram-formats")) {
      const format = (name: string, enabled: boolean, rotationOrder: number) => ({
        format: name, enabled, rotationOrder, capabilityStatus: name === "instagram_feed_carousel" ? "available" : "unchecked",
        capabilityCheckedAt: null, capabilityMetadata: {}, lastError: null
      });
      return route.fulfill({ ...common, json: {
        brandId: "brand-e2e",
        brandColor: "파란색",
        formats: [format("instagram_feed_carousel", true, 1), format("instagram_story", false, 2), format("instagram_reel", false, 3)]
      } });
    }
    return route.fulfill({ ...common, json: [] });
  });
});

test("customer IA routes are reachable", async ({ page }) => {
  await page.goto("/onboarding");
  const menu = page.getByRole("navigation", { name: "고객 메뉴" });
  await expect(page.getByRole("heading", { level: 1, name: /게시 자동화/ })).toBeVisible();

  await menu.getByRole("link", { name: /게시 관리/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "게시 관리" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "게시 목록" })).toBeVisible();
  await expect(page.getByRole("button", { name: "대기", exact: true })).toBeVisible();

  await menu.getByRole("link", { name: /소스/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "소스" })).toBeVisible();

  await menu.getByRole("link", { name: /^채널/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "채널 연결" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /자동 승인/ })).toHaveCount(0);

  await menu.getByRole("link", { name: /브랜드 설정/ }).click();
  await expect(page.getByRole("switch", { name: "브랜드 전체 자동 승인" })).toBeVisible();

  await menu.getByRole("link", { name: /관리자 채널/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "관리자 채널" })).toBeVisible();
});

test("mobile layout has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  for (const path of ["/onboarding", "/publish-queue", "/sources", "/channels", "/brand-settings", "/admin/channels"]) {
    await page.goto(path);
    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(hasOverflow, `${path} should not overflow horizontally`).toBe(false);
  }
});
