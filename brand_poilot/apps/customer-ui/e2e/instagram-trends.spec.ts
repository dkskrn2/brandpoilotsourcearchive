import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const previewUrl = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
const browserErrors = new WeakMap<Page, string[]>();

function trendPage(isSaved = false) {
  return {
    hashtag: { id: "hashtag-growth", displayTag: "#성장마케팅", normalizedTag: "성장마케팅" },
    source: "meta",
    refreshed: true,
    refreshedAt: "2026-07-15T01:00:00.000Z",
    lastErrorCode: null,
    page: 1,
    pageSize: 20,
    total: 1,
    items: [{
      id: "media-growth-1",
      instagramMediaId: "ig-media-growth-1",
      username: "growthline352",
      caption: Array.from({ length: 24 }, () => "성장하는 브랜드를 위한 오늘의 콘텐츠 인사이트입니다.").join("\n"),
      kind: "image",
      mediaUrl: previewUrl,
      previewUrl,
      permalink: "https://www.instagram.com/p/growthline352/",
      postedAt: "2026-07-14T03:00:00.000Z",
      likeCount: 352,
      commentsCount: 35,
      metaRank: 1,
      refreshedAt: "2026-07-15T01:00:00.000Z",
      isSaved
    }]
  };
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  browserErrors.set(page, errors);
  await page.addInitScript(() => {
    window.localStorage.setItem("brand-pilot-active-brand", "brand-e2e");
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const requestUrl = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (new URL(requestUrl, window.location.href).pathname.endsWith("/auth/me")) {
        return new Response(JSON.stringify({
          user: { id: "user-e2e", displayName: "E2E User", email: "e2e@example.com" },
          workspace: { id: "workspace-e2e", name: "E2E Workspace" },
          brand: { id: "brand-e2e", name: "E2E Brand" }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return originalFetch(input, init);
    };
  });
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    const pathname = requestUrl.pathname;
    if (route.request().resourceType() === "document" || requestUrl.origin === "http://127.0.0.1:5273") {
      return route.continue();
    }

    const common = {
      headers: {
        "access-control-allow-origin": route.request().headers()["origin"] ?? "http://127.0.0.1:5273",
        "access-control-allow-credentials": "true"
      }
    };
    if (pathname.endsWith("/auth/me")) {
      return route.fulfill({ ...common, json: {
        user: { id: "user-e2e", displayName: "E2E User", email: "e2e@example.com" },
        workspace: { id: "workspace-e2e", name: "E2E Workspace" },
        brand: { id: "brand-e2e", name: "E2E Brand" }
      } });
    }
    if (pathname.endsWith("/ui-status")) {
      return route.fulfill({ ...common, json: {
        brandId: "brand-e2e",
        brandName: "E2E Brand",
        lastGeneratedAt: null,
        navigation: { onboardingRemaining: 0, contentReview: 0, publishIssues: 0, channelIssues: 0 },
        onboarding: { completedCount: 1, totalCount: 1, remainingCount: 0, steps: [] }
      } });
    }
    if (pathname.endsWith("/channels")) {
      return route.fulfill({ ...common, json: [{
        channel: "instagram",
        enabled: true,
        status: "connected",
        oauthState: "connected",
        accountLabel: "@brandpilot",
        lastHealthyAt: "2026-07-15T01:00:00.000Z",
        lastPublishedAt: null,
        lastError: null
      }] });
    }
    if (pathname.endsWith("/content-categories")) {
      return route.fulfill({ ...common, json: [{ code: "marketing", name: "마케팅", recommendedHashtags: ["성장마케팅"], subcategories: [] }] });
    }
    if (pathname.endsWith("/instagram-trends/connection")) {
      return route.fulfill({ ...common, json: {
        status: "connected",
        accountLabel: "@brandpilot",
        instagramBusinessAccountId: "ig-e2e",
        scopes: ["instagram_basic"],
        expiresAt: null,
        lastErrorCode: null
      } });
    }
    if (pathname.endsWith("/instagram-trend-searches")) {
      return route.fulfill({ ...common, json: [] });
    }
    if (pathname.endsWith("/save-source")) {
      return route.fulfill({ ...common, json: { source: { id: "source-growth-1", brandId: "brand-e2e", sourceType: "reference", url: "https://www.instagram.com/p/growthline352/" }, alreadySaved: false } });
    }
    if (pathname.endsWith("/instagram-trends/search")) {
      return route.fulfill({ ...common, json: trendPage() });
    }
    if (pathname.endsWith("/instagram-trends")) {
      return route.fulfill({ ...common, json: trendPage() });
    }
    const isApiRequest = requestUrl.port === "4000"
      || requestUrl.hostname.endsWith(".vercel.app")
      || pathname.startsWith("/api/");
    return isApiRequest ? route.fulfill({ ...common, json: [] }) : route.continue();
  });

  await page.goto("/instagram-trends");
  await expect(page.getByRole("heading", { level: 1, name: "Instagram 트렌드 탐색" })).toBeVisible();
});

test("searches a hashtag, opens growthline352, and saves the source", async ({ page }) => {
  await page.getByLabel("해시태그").fill("#성장마케팅");
  await page.getByRole("button", { name: "검색", exact: true }).click();

  await expect(page.getByRole("button", { name: "상세 보기 @growthline352" })).toBeVisible();
  await page.getByRole("button", { name: "상세 보기 @growthline352" }).click();
  const dialog = page.getByRole("dialog", { name: "Instagram 트렌드 상세" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("@growthline352 · 이미지")).toBeVisible();

  const saveButton = dialog.getByRole("button", { name: "참고 소스로 저장" });
  await saveButton.click();
  await expect(dialog.getByRole("button", { name: "저장됨" })).toBeDisabled();
  expect(browserErrors.get(page)).toEqual([]);
});

test("keeps the trend grid single-column and detail actions clear on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("해시태그").fill("성장마케팅");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  const grid = page.locator(".trend-media-grid");
  await expect(grid).toBeVisible();
  await expect.poll(() => grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length)).toBe(1);

  await page.getByRole("button", { name: "상세 보기 @growthline352" }).click();
  const dialog = page.getByRole("dialog", { name: "Instagram 트렌드 상세" });
  const body = dialog.locator(".trend-detail-dialog__body");
  await expect.poll(() => body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  const footer = dialog.locator(".trend-detail-dialog__footer");
  const instagramLink = footer.getByRole("link", { name: "Instagram에서 보기" });
  const saveButton = footer.getByRole("button", { name: "참고 소스로 저장" });
  const boxes = await Promise.all([instagramLink.boundingBox(), saveButton.boundingBox()]);
  expect(boxes[0]).not.toBeNull();
  expect(boxes[1]).not.toBeNull();
  expect(boxes[0]!.y + boxes[0]!.height).toBeLessThanOrEqual(boxes[1]!.y + 1);
  expect(browserErrors.get(page)).toEqual([]);
});
