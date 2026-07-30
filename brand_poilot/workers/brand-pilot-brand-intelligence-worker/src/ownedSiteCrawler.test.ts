import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  crawlImportantOwnedPages,
  OWNED_PAGE_ATTEMPT_LIMIT,
  requiredOwnedPageSuccesses,
} from "./ownedSiteCrawler.js";
import type { CrawledSnapshot } from "./sourceCrawler.js";

function snapshot(url: string, {
  html = "",
  valid = true,
}: {
  html?: string;
  valid?: boolean;
} = {}): CrawledSnapshot {
  const text = valid
    ? `${new URL(url).pathname} ${"브랜드의 핵심 내용을 설명하는 본문입니다. ".repeat(12)}`
    : "짧음";
  return {
    title: new URL(url).pathname,
    canonicalUrl: url,
    metaDescription: null,
    text,
    contentHash: createHash("sha256").update(text).digest("hex"),
    httpStatus: 200,
    rawText: html || `<main>${text}</main>`,
  };
}

function anchors(paths: string[]) {
  return paths.map((path) => `<a href="${path}">${path}</a>`).join("");
}

describe("crawlImportantOwnedPages", () => {
  it("reads at most 20 important same-site pages and retains at most five offerings", async () => {
    const paths = [
      "/about/one", "/about/two", "/about/three",
      ...Array.from({ length: 8 }, (_, index) => `/products/${index + 1}`),
      "/pricing", "/plans",
      "/customers/one", "/customers/two", "/customers/three",
      "/faq", "/help",
      "/contact", "/locations",
      "/news/one", "/news/two", "/news/three",
      "/privacy", "/terms", "/login", "/search",
      "https://external.example/products/1",
    ];
    const attempted: string[] = [];
    const crawlPage = vi.fn(async (url: string) => {
      attempted.push(url);
      return snapshot(url, {
        html: new URL(url).pathname === "/" ? anchors(paths) : undefined,
      });
    });

    const result = await crawlImportantOwnedPages("https://brand.example/", {
      crawlPage,
      renderPage: vi.fn(),
    });

    expect(result.attemptedCount).toBe(OWNED_PAGE_ATTEMPT_LIMIT);
    expect(result.pages).toHaveLength(OWNED_PAGE_ATTEMPT_LIMIT);
    expect(result.pages.filter((page) => page.classification === "offering")).toHaveLength(5);
    expect(attempted).not.toEqual(expect.arrayContaining([
      "https://brand.example/privacy",
      "https://brand.example/terms",
      "https://brand.example/login",
      "https://brand.example/search",
      "https://external.example/products/1",
    ]));
    expect(result.requiredCount).toBe(10);
  });

  it("fails before analysis when fewer than half of up to ten required pages succeed", async () => {
    const paths = [
      "/about/one", "/about/two", "/about/three",
      "/products/one", "/products/two", "/pricing",
      "/customers/one", "/faq", "/contact",
    ];
    const validPaths = new Set(["/about/one", "/about/two", "/about/three"]);
    const renderPage = vi.fn(async (url: string) => snapshot(url, { valid: false }));
    const crawlPage = vi.fn(async (url: string) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/") return snapshot(url, { html: anchors(paths) });
      return snapshot(url, { valid: validPaths.has(pathname) });
    });

    await expect(crawlImportantOwnedPages("https://brand.example/", {
      crawlPage,
      renderPage,
    })).rejects.toThrow("brand_analysis_owned_page_success_threshold_not_met");

    expect(crawlPage).toHaveBeenCalledTimes(10);
    expect(renderPage).toHaveBeenCalledTimes(3);
    expect(requiredOwnedPageSuccesses(10)).toBe(5);
  });

  it("deduplicates canonical URLs and normalized body hashes", async () => {
    const paths = ["/about/a", "/about/b", "/news/a", "/news/b"];
    const common = snapshot("https://brand.example/news/a");
    const crawlPage = vi.fn(async (url: string) => {
      if (new URL(url).pathname === "/") return snapshot(url, { html: anchors(paths) });
      if (url.endsWith("/about/b")) {
        return { ...snapshot(url), canonicalUrl: "https://brand.example/about/a" };
      }
      if (url.endsWith("/news/b")) {
        return { ...snapshot(url), text: common.text, contentHash: common.contentHash };
      }
      return url.endsWith("/news/a") ? common : snapshot(url);
    });

    const result = await crawlImportantOwnedPages("https://brand.example/", {
      crawlPage,
      renderPage: vi.fn(),
    });

    expect(result.attemptedCount).toBe(5);
    expect(result.successfulCount).toBe(3);
    expect(result.pages.map((page) => page.sourceUrl)).toEqual([
      "https://brand.example/",
      "https://brand.example/about/a",
      "https://brand.example/news/a",
    ]);
  });

  it("never treats an off-domain redirect or canonical target as owned evidence", async () => {
    await expect(crawlImportantOwnedPages("https://brand.example/", {
      crawlPage: vi.fn(async (url: string) => ({
        ...snapshot(url),
        canonicalUrl: "https://external.example/landing",
      })),
      renderPage: vi.fn(),
    })).rejects.toThrow("brand_analysis_owned_page_success_threshold_not_met");
  });
});
