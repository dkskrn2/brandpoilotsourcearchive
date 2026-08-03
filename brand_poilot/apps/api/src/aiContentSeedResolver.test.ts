import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ContentSeedV2 } from "./aiContentContracts";
import { resolveAiContentSeed } from "./aiContentSeedResolver";
import type { CrawledSnapshot } from "./sourceCrawler";
import { crawlSourceUrl } from "./sourceCrawler";

const firstReferenceId = "11111111-1111-4111-8111-111111111111";
const secondReferenceId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const capturedAt = "2026-08-01T03:04:05.000Z";

function crawledSnapshot(overrides: Partial<CrawledSnapshot> = {}): CrawledSnapshot {
  return {
    title: "Source title",
    canonicalUrl: null,
    finalUrl: "https://example.com/article",
    metaDescription: null,
    text: "Source body",
    contentHash: "crawler hash is not trusted",
    httpStatus: 200,
    rawText: "<html>Source body</html>",
    ...overrides,
  };
}

function unexpectedCrawler() {
  return vi.fn(async () => {
    throw new Error("crawler_must_not_be_called");
  }) as unknown as typeof crawlSourceUrl;
}

const clock = { now: () => new Date(capturedAt) };

describe("resolveAiContentSeed", () => {
  it("normalizes a topic text seed without crawling", async () => {
    const crawlUrl = unexpectedCrawler();

    await expect(resolveAiContentSeed(
      { kind: "topic_text", title: "  A useful\n topic  " },
      { crawlUrl, ...clock },
    )).resolves.toEqual({ kind: "topic_text", title: "A useful\n topic" });
    expect(crawlUrl).not.toHaveBeenCalled();
  });

  it("returns canonical reference IDs in input order without crawling", async () => {
    const crawlUrl = unexpectedCrawler();

    await expect(resolveAiContentSeed({
      kind: "reference",
      items: [
        { referenceId: firstReferenceId, roles: ["planning"] },
        { referenceId: secondReferenceId, roles: ["copy_pattern", "visual_composition"] },
      ],
    }, { crawlUrl, ...clock })).resolves.toEqual({
      kind: "reference",
      referenceIds: [firstReferenceId, secondReferenceId.toLowerCase()],
    });
    expect(crawlUrl).not.toHaveBeenCalled();
  });

  it("crawls a URL exactly once and returns only the frozen subject fields", async () => {
    const crawlUrl = vi.fn(async () => crawledSnapshot({
      finalUrl: "https://WWW.Example.com:443/final?keep=1#ignored",
      canonicalUrl: "https://publisher.example/canonical-metadata",
      title: "  Final\n title  ",
      text: "  Useful\n body\t text  ",
      contentHash: "not the returned text hash",
      rawText: "<html>crawler internals</html>",
      httpStatus: 201,
    })) as unknown as typeof crawlSourceUrl;

    const result = await resolveAiContentSeed({
      kind: "topic_url",
      url: " HTTPS://Example.COM:443/start?keep=2#fragment ",
    }, { crawlUrl, ...clock });

    expect(crawlUrl).toHaveBeenCalledTimes(1);
    expect(crawlUrl).toHaveBeenCalledWith("https://example.com/start?keep=2");
    expect(result).toEqual({
      kind: "topic_url",
      requestedUrl: "https://example.com/start?keep=2",
      canonicalUrl: "https://www.example.com/final?keep=1",
      title: "Final title",
      text: "Useful body text",
      contentHash: "4cafbc6a1901049c6b850bed8e2e88f9060a09d4fe3956508f6e98d86fab80dc",
      capturedAt,
    });
    expect(Object.keys(result)).toEqual([
      "kind",
      "requestedUrl",
      "canonicalUrl",
      "title",
      "text",
      "contentHash",
      "capturedAt",
    ]);
  });

  it("normalizes an empty crawler title to null", async () => {
    const crawlUrl = vi.fn(async () => crawledSnapshot({ title: " \n\t " })) as unknown as typeof crawlSourceUrl;

    await expect(resolveAiContentSeed(
      { kind: "topic_url", url: "http://example.com/article" },
      { crawlUrl, ...clock },
    )).resolves.toMatchObject({ title: null });
  });

  it("accepts HTTP and HTTPS URLs but rejects unsafe schemes without crawling", async () => {
    const crawlUrl = vi.fn(async (url: string) => crawledSnapshot({ finalUrl: url })) as unknown as typeof crawlSourceUrl;

    await expect(resolveAiContentSeed(
      { kind: "topic_url", url: "http://example.com/article" },
      { crawlUrl, ...clock },
    )).resolves.toMatchObject({ requestedUrl: "http://example.com/article" });
    await expect(resolveAiContentSeed(
      { kind: "topic_url", url: "https://example.com/article" },
      { crawlUrl, ...clock },
    )).resolves.toMatchObject({ requestedUrl: "https://example.com/article" });
    await expect(resolveAiContentSeed(
      { kind: "topic_url", url: "file:///private/source" } as ContentSeedV2,
      { crawlUrl, ...clock },
    )).rejects.toThrow("ai_content_seed_invalid");
    expect(crawlUrl).toHaveBeenCalledTimes(2);
  });

  it("keeps a public URL usable through required research when the publisher blocks the crawler", async () => {
    const crawlUrl = vi.fn(async () => { throw new Error("HTTP 403"); }) as unknown as typeof crawlSourceUrl;
    const url = "https://www.allrecipes.com/oscar-mayer-hot-dog-birthday-cake-12024567";
    const fallbackText = "원문 URL을 수집하지 못했습니다. 온라인 검색으로 확인할 주제: oscar mayer hot dog birthday cake";

    await expect(resolveAiContentSeed(
      { kind: "topic_url", url },
      { crawlUrl, ...clock },
    )).resolves.toEqual({
      kind: "topic_url",
      requestedUrl: url,
      canonicalUrl: url,
      title: "oscar mayer hot dog birthday cake",
      text: fallbackText,
      contentHash: createHash("sha256").update(fallbackText, "utf8").digest("hex"),
      capturedAt,
    });
    expect(crawlUrl).toHaveBeenCalledOnce();
  });

  it("does not turn a missing publisher page into a synthetic topic", async () => {
    const crawlUrl = vi.fn(async () => { throw new Error("HTTP 404"); }) as unknown as typeof crawlSourceUrl;

    await expect(resolveAiContentSeed(
      { kind: "topic_url", url: "https://example.com/missing" },
      { crawlUrl, ...clock },
    )).rejects.toThrow("ai_content_seed_resolution_failed");
  });

  it.each([
    "crawl_request_timeout",
    "crawl_response_too_large",
    "crawl_url_unsafe_address",
    "unexpected transport details",
  ])("maps crawler failure %s to one stable resolver error without fallback", async (message) => {
    const crawlUrl = vi.fn(async () => { throw new Error(message); }) as unknown as typeof crawlSourceUrl;

    await expect(resolveAiContentSeed(
      { kind: "topic_url", url: "https://example.com/article" },
      { crawlUrl, ...clock },
    )).rejects.toThrow("ai_content_seed_resolution_failed");
    expect(crawlUrl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["empty", { text: " \n\t " }],
    ["oversized", { text: "x".repeat(50_001) }],
    ["missing final URL", { finalUrl: undefined }],
    ["invalid final URL", { finalUrl: "file:///private/result" }],
  ] satisfies Array<[string, Partial<CrawledSnapshot>]>) (
    "rejects a crawler snapshot with %s content without fallback",
    async (_name, overrides) => {
      const crawlUrl = vi.fn(async () => crawledSnapshot(overrides)) as unknown as typeof crawlSourceUrl;

      await expect(resolveAiContentSeed(
        { kind: "topic_url", url: "https://example.com/article" },
        { crawlUrl, ...clock },
      )).rejects.toThrow("ai_content_seed_resolution_failed");
      expect(crawlUrl).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { kind: "topic_text", title: "   " },
    {
      kind: "reference",
      items: [
        { referenceId: secondReferenceId, roles: ["planning"] },
        { referenceId: secondReferenceId.toLowerCase(), roles: ["copy_pattern"] },
      ],
    },
    { kind: "reference", items: [{ referenceId: firstReferenceId, roles: [] }] },
  ])("fails closed on malformed direct seed calls", async (seed) => {
    const crawlUrl = unexpectedCrawler();

    await expect(resolveAiContentSeed(
      seed as ContentSeedV2,
      { crawlUrl, ...clock },
    )).rejects.toThrow("ai_content_seed_invalid");
    expect(crawlUrl).not.toHaveBeenCalled();
  });
});
