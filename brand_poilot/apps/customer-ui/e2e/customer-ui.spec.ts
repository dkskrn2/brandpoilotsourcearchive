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
    const common = {
      headers: {
        "access-control-allow-origin": route.request().headers().origin ?? "http://127.0.0.1:5273",
        "access-control-allow-credentials": "true"
      }
    };
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
        logoUrl: null,
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
        id: "profile-e2e",
        brandId: "brand-e2e",
        name: "E2E Brand",
        primaryCategory: { code: "it", name: "IT·디지털" },
        subcategories: [],
        primaryCustomer: "기업 실무 담당자",
        description: "E2E brand profile",
        tone: "명확하게",
        defaultCta: "",
        mainLink: "https://example.com",
        autoApprovalEnabled: false
      } });
    }
    if (pathname.endsWith("/brand-center")) {
      return route.fulfill({ ...common, json: {
        source: { state: "ready" },
        analysis: { state: "confirmed" },
        brandCore: { state: "approved" },
        rules: { state: "approved" },
        products: { state: "unavailable" },
        wiki: { state: "unavailable" },
        avatars: { state: "unavailable" }
      } });
    }
    if (pathname.endsWith("/brand-core") || pathname.endsWith("/brand-rules")) {
      return route.fulfill({ ...common, json: { active: null, draft: null, versions: [] } });
    }
    if (pathname.endsWith("/instagram-trends/archive")) {
      return route.fulfill({ ...common, json: { items: [], page: 1, limit: 30, total: 0 } });
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
    if (pathname.endsWith("/dashboard")) {
      return route.fulfill({ ...common, json: {
        generatedAt: "2026-07-22T00:00:00.000Z",
        lastCollectedAt: null,
        summary: { publishedCount: 0, exposureCount: null, pendingReviewCount: 0, failedPublishCount: 0 },
        workflow: { queuedTopics: 0, generating: 0, pendingReview: 0, scheduledOrPublished: 0 },
        dailyExposure: [],
        channelPerformance: [],
        topContents: [],
        attentionItems: []
      } });
    }
    if (pathname.endsWith("/brand-center")) {
      return route.fulfill({ ...common, json: {
        source: { state: "ready" },
        analysis: { state: "confirmed" },
        brandCore: { state: "approved" },
        rules: { state: "approved" },
        products: { state: "ready" },
        wiki: { state: "ready" },
        avatars: { state: "ready" }
      } });
    }
    if (pathname.endsWith("/brand-core") || pathname.endsWith("/brand-rules")) {
      return route.fulfill({ ...common, json: { active: null, draft: null, versions: [] } });
    }
    if (pathname.endsWith("/ai-content/usage")) {
      return route.fulfill({ ...common, json: {
        generationUsed: 2,
        generationLimit: 10,
        newDownloadUsed: 4,
        newDownloadLimit: 20,
        resetsAt: "2026-07-23T00:00:00+09:00"
      } });
    }
    return route.fulfill({ ...common, json: [] });
  });
});

test("customer IA routes are reachable", async ({ page }) => {
  await page.goto("/dashboard");
  const menu = page.getByRole("navigation", { name: "고객 메뉴" });
  const clickMenuLink = async (name: RegExp) => {
    const openMenu = page.getByRole("button", { name: "전체 메뉴 열기" });
    if (await openMenu.isVisible()) await openMenu.click();
    await menu.getByRole("link", { name }).click();
  };
  await expect(page.getByRole("heading", { level: 1, name: "오늘의 운영 현황" })).toBeVisible();

  await clickMenuLink(/게시 관리/);
  await expect(page.getByRole("heading", { level: 1, name: "게시 관리" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "게시 목록" })).toBeVisible();
  await expect(page.getByRole("button", { name: "준비 중 0", exact: true })).toBeVisible();

  await clickMenuLink(/레퍼런스/);
  await expect(page.getByRole("heading", { level: 1, name: "레퍼런스" })).toBeVisible();

  await clickMenuLink(/브랜드 센터/);
  await expect(page.getByRole("heading", { level: 1, name: "브랜드 센터" })).toBeVisible();

  await clickMenuLink(/^채널/);
  await expect(page.getByRole("heading", { level: 1, name: "채널 연결" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /자동 승인/ })).toHaveCount(0);
});

const legacyRouteMappings = [
  ["/brand-settings", "/brand-center?tab=understanding&section=core"],
  ["/sources", "/brand-center?tab=understanding&section=sources"],
  ["/archive", "/references?view=saved-trends"],
  ["/instagram-trends", "/references?view=trends"],
  ["/content", "/publish-queue?status=needs_review"],
  ["/onboarding", "/onboarding/brand-intelligence"],
] as const;

for (const [legacy, canonical] of legacyRouteMappings) {
  test(`legacy URL ${legacy} resolves to ${canonical}`, async ({ page }) => {
    await page.goto(legacy, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(new RegExp(`${canonical.replace(/[?]/g, "\\?")}$`));
  });
}

test.describe("mobile layout has no horizontal overflow", () => {
  for (const path of ["/onboarding", "/publish-queue", "/sources", "/channels", "/brand-settings"]) {
    test(path, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(path);
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(hasOverflow, `${path} should not overflow horizontally`).toBe(false);
    });
  }
});
