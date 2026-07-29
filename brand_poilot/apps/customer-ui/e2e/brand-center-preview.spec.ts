import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const brandId = "00000000-0000-4000-8000-000000000100";
const session = {
  user: {
    id: "preview-user",
    displayName: "Preview User",
    email: "preview@example.com",
  },
  workspace: { id: "preview-workspace", name: "Preview Workspace" },
  brand: { id: brandId, name: "Preview Brand" },
};

async function json(route: Route, value: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}

async function installAuthenticatedShell(page: Page) {
  await page.addInitScript((auth) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : String(input),
        window.location.href,
      );
      if (url.pathname.endsWith("/auth/me")) {
        return new Response(JSON.stringify(auth), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input, init);
    };
  }, session);

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (url.port !== "4000" && !path.startsWith("/api/")) {
      return route.continue();
    }
    if (path.endsWith("/auth/me")) return json(route, session);
    if (path.endsWith("/ui-status")) {
      return json(route, {
        brandId,
        brandName: "Preview Brand",
        logoUrl: null,
        lastGeneratedAt: null,
        navigation: {
          onboardingRemaining: 0,
          contentReview: 0,
          publishIssues: 0,
          channelIssues: 0,
        },
        onboarding: {
          completedCount: 1,
          totalCount: 1,
          remainingCount: 0,
          steps: [{
            id: "brand-profile",
            label: "브랜드 정보",
            status: "completed",
            path: "/brand-center",
          }],
        },
      });
    }
    return json(route, []);
  });
}

test.beforeEach(async ({ page }) => {
  await installAuthenticatedShell(page);
});

test("direct authenticated preview completes locally, resets, and has no axe violations", async ({
  page,
}) => {
  await page.goto("/brand-center-preview");

  await expect(
    page.getByRole("heading", { name: "Brand Center Preview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Brand Center Preview" }),
  ).toHaveCount(0);
  await expect(
    page.locator('.brand-center-preview__steps button[aria-label="4. 카드뉴스 생성"]'),
  ).toHaveAttribute("aria-disabled", "true");

  await page.getByRole("textbox", { name: "브랜드 웹사이트 URL" })
    .fill("https://brand.example");
  await page.getByRole("button", { name: "AI 분석 시작" }).click();
  await expect(page.getByText("AI 분석 결과")).toBeVisible();
  await page.getByRole("button", { name: "검토 시작" }).click();
  await page.getByRole("button", { name: "브랜드 지식 승인" }).click();
  await page.getByRole("button", { name: "브랜드 코어 승인" }).click();
  await page.getByRole("button", { name: "카드뉴스 만들기" }).click();
  await page.getByRole("button", { name: "카드뉴스 생성", exact: true }).click();

  await expect(page.getByText("생성 완료")).toBeVisible();
  await expect(page.getByRole("article", { name: /카드 [1-4]/ })).toHaveCount(4);

  const results = await new AxeBuilder({ page })
    .include(".brand-center-preview")
    .analyze();
  expect(results.violations).toEqual([]);

  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth
      <= document.documentElement.clientWidth)).toBe(true);

  await page.reload();
  await expect(
    page.locator('.brand-center-preview__steps button[aria-label="4. 카드뉴스 생성"]'),
  ).toHaveAttribute("aria-disabled", "true");
  await expect(
    page.getByRole("textbox", { name: "브랜드 웹사이트 URL" }),
  ).toHaveValue("");
  await expect(page.getByText("생성 완료")).toHaveCount(0);
});
