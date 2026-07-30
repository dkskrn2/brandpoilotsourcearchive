import { describe, expect, it, vi } from "vitest";
import {
  crawlImportantOwnedPages,
  requiredOwnedPageSuccesses,
} from "./brandOwnedSiteCrawler.js";

function page(url: string, links: string[] = [], text = `유효한 브랜드 소개 ${"본문 ".repeat(60)}`) {
  return {
    title: new URL(url).pathname,
    canonicalUrl: url,
    metaDescription: null,
    text,
    contentHash: url.padEnd(64, "a").slice(0, 64),
    httpStatus: 200,
    rawText: `<main>${text}</main>${links.map((link) => `<a href="${link}">${link}</a>`).join("")}`,
  };
}

describe("onboarding owned-site crawler", () => {
  it("attempts at most 20 important pages and excludes policy pages", async () => {
    const seed = "https://brand.example.com/";
    const links = [
      "/about", "/products/a", "/products/b", "/products/c", "/products/d",
      "/products/e", "/products/f", "/service", "/pricing", "/portfolio",
      "/customers", "/story", "/contact", "/faq", "/news/1", "/news/2",
      "/news/3", "/news/4", "/news/5", "/news/6", "/news/7", "/privacy",
      "/terms",
    ].map((path) => new URL(path, seed).toString());
    const crawlPage = vi.fn(async (url: string) => page(url, url === seed ? links : []));
    const result = await crawlImportantOwnedPages(seed, { crawlPage });

    expect(result.attemptedCount).toBeLessThanOrEqual(20);
    expect(result.pages.some(({ sourceUrl }) => /privacy|terms/.test(sourceUrl))).toBe(false);
    expect(result.pages.filter(({ classification }) => classification === "offering"))
      .toHaveLength(5);
  });

  it("uses failed attempts in the denominator and requires half, capped at ten", () => {
    expect(requiredOwnedPageSuccesses(1)).toBe(1);
    expect(requiredOwnedPageSuccesses(19)).toBe(10);
    expect(requiredOwnedPageSuccesses(20)).toBe(10);
  });

  it("fails when fewer than the required owned pages contain crawl-valid content", async () => {
    const seed = "https://brand.example.com/";
    const links = Array.from({ length: 12 }, (_, index) => (
      new URL(`/about/${index}`, seed).toString()
    ));
    const crawlPage = vi.fn(async (url: string) => (
      url === seed ? page(url, links) : page(url, [], "짧음")
    ));
    await expect(crawlImportantOwnedPages(seed, { crawlPage }))
      .rejects.toThrow("brand_analysis_owned_page_success_threshold_not_met");
  });
});
