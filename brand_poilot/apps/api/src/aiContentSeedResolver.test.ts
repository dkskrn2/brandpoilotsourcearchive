import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ContentSeedV2 } from "./aiContentContracts";
import { resolveAiContentSeed } from "./aiContentSeedResolver";
import type { CrawledSnapshot } from "./sourceCrawler";
import { crawlSourceUrl } from "./sourceCrawler";

const firstReferenceId = "11111111-1111-4111-8111-111111111111";
const secondReferenceId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const capturedAt = "2026-08-01T03:04:05.000Z";
const validArticleBody = "Source body with enough article detail. ".repeat(8).trim();

function crawledSnapshot(overrides: Partial<CrawledSnapshot> = {}): CrawledSnapshot {
  return {
    title: "Source title",
    canonicalUrl: null,
    finalUrl: "https://example.com/article",
    metaDescription: null,
    text: validArticleBody,
    contentHash: "crawler hash is not trusted",
    httpStatus: 200,
    rawText: `<main>${validArticleBody}</main>`,
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
    const normalizedBody = "Useful body text with enough source detail. ".repeat(8).trim();
    const crawlUrl = vi.fn(async () => crawledSnapshot({
      finalUrl: "https://WWW.Example.com:443/final?keep=1#ignored",
      canonicalUrl: "https://publisher.example/canonical-metadata",
      title: "  Final\n title  ",
      text: `  ${normalizedBody.replaceAll(" ", "\n ")}  `,
      contentHash: "not the returned text hash",
      rawText: `<main>${normalizedBody}</main>`,
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
      text: normalizedBody,
      contentHash: createHash("sha256").update(normalizedBody, "utf8").digest("hex"),
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

  it("replaces an article-like but implausible body with bounded metadata that requires search verification", async () => {
    const url = "https://publisher.example/influencers-fear-having-their-content-branded-as-ai-2026-8";
    const unrelatedRecommendation = "Microsoft is retiring its peer-feedback tool after employees complained about repeated review prompts.";
    const crawlUrl = vi.fn(async () => crawledSnapshot({
      finalUrl: url,
      title: "Why creators fear having their content branded as AI",
      metaDescription: `A report about creator trust and AI labels. ${"metadata ".repeat(2_000)}`,
      text: unrelatedRecommendation,
      rawText: `<html><head><meta property="og:type" content="article"></head><body><article>${unrelatedRecommendation}</article><article>Recommended story</article></body></html>`,
    })) as unknown as typeof crawlSourceUrl;

    const result = await resolveAiContentSeed(
      { kind: "topic_url", url },
      { crawlUrl, ...clock },
    );

    expect(result.kind).toBe("topic_url");
    if (result.kind !== "topic_url") throw new Error("expected_topic_url");
    expect(result.title).toBe("Why creators fear having their content branded as AI");
    expect(result.text).toContain(`원문 URL: ${url}`);
    expect(result.text).toContain("수집 제목: Why creators fear having their content branded as AI");
    expect(result.text).toContain("URL 주제: influencers fear having their content branded as ai");
    expect(result.text).toContain("메타 설명: A report about creator trust and AI labels.");
    expect(result.text).toContain("온라인 검색으로 원문 내용을 검증해야 합니다");
    expect(result.text).not.toContain(unrelatedRecommendation);
    expect(result.text.length).toBeLessThanOrEqual(4_000);
    expect(result.contentHash).toBe(createHash("sha256").update(result.text, "utf8").digest("hex"));
  });

  it("rejects multiple long recommendation articles when no primary content container identifies the source body", async () => {
    const url = "https://publisher.example/creator-trust-and-ai-labels";
    const firstRecommendation = "추천 기사 요약일 뿐인 문장입니다. 원문 주제와 무관한 사내 평가 도구 소식을 반복해서 소개합니다. ".repeat(4).trim();
    const secondRecommendation = "또 다른 추천 카드이며 원문 대신 소셜 플랫폼의 새 기능을 길게 소개하는 주변 콘텐츠입니다. ".repeat(4).trim();
    expect(firstRecommendation.length).toBeGreaterThan(120);
    const crawlUrl = vi.fn(async () => crawledSnapshot({
      finalUrl: url,
      title: "Creators and AI labels",
      metaDescription: "A report about creator trust and AI labels.",
      text: firstRecommendation,
      rawText: `<html><body><article>${firstRecommendation}</article><article>${secondRecommendation}</article></body></html>`,
    })) as unknown as typeof crawlSourceUrl;

    const result = await resolveAiContentSeed(
      { kind: "topic_url", url },
      { crawlUrl, ...clock },
    );

    expect(result.kind).toBe("topic_url");
    if (result.kind !== "topic_url") throw new Error("expected_topic_url");
    expect(result.text).toContain("온라인 검색으로 원문 내용을 검증해야 합니다");
    expect(result.text).not.toContain(firstRecommendation);
    expect(result.text).not.toContain(secondRecommendation);
  });

  it("does not trust a long recommendation merely because a nested role-main container exists", async () => {
    const url = "https://publisher.example/creator-trust-and-ai-labels";
    const wrongRecommendation = "원문 주제와 무관한 사내 평가 도구 추천 기사이며 주변 카드의 설명을 길게 반복합니다. ".repeat(5).trim();
    const crawlUrl = vi.fn(async () => crawledSnapshot({
      finalUrl: url,
      title: "Creators and AI labels",
      metaDescription: "A report about creator trust and AI labels.",
      text: wrongRecommendation,
      rawText: `<html><body><section role="main"><div><header>기사 제목</header><div id="app"></div></div></section>${
        Array.from({ length: 13 }, (_, index) => `<article>${index === 0 ? wrongRecommendation : `추천 카드 ${index}`}</article>`).join("")
      }</body></html>`,
    })) as unknown as typeof crawlSourceUrl;

    const result = await resolveAiContentSeed(
      { kind: "topic_url", url },
      { crawlUrl, ...clock },
    );

    expect(result.kind).toBe("topic_url");
    if (result.kind !== "topic_url") throw new Error("expected_topic_url");
    expect(result.text).toContain("온라인 검색으로 원문 내용을 검증해야 합니다");
    expect(result.text).not.toContain(wrongRecommendation);
  });

  it("keeps a long primary article unchanged when main provenance distinguishes it from recommendations", async () => {
    const primaryBody = "검증된 원문 본문으로서 창작자 신뢰와 AI 표시 정책의 배경, 영향, 대응 방법을 구체적으로 설명합니다. ".repeat(8).trim();
    const recommendation = "주변 추천 기사 카드입니다. ".repeat(8).trim();
    const crawlUrl = vi.fn(async () => crawledSnapshot({
      finalUrl: "https://publisher.example/articles/creator-trust-ai-labels",
      text: primaryBody,
      rawText: `<html><body><main><article>${primaryBody}</article></main><aside><article>${recommendation}</article></aside></body></html>`,
    })) as unknown as typeof crawlSourceUrl;

    const result = await resolveAiContentSeed(
      { kind: "topic_url", url: "https://publisher.example/article" },
      { crawlUrl, ...clock },
    );

    expect(result).toMatchObject({ kind: "topic_url", title: "Source title", text: primaryBody });
  });

  it("does not trust a main wrapper containing multiple recommendation articles", async () => {
    const url = "https://publisher.example/creator-trust-and-ai-labels";
    const firstRecommendation = "원문이 아닌 첫 번째 추천 기사이며 다른 회사의 내부 도구 변경 소식을 길게 설명합니다. ".repeat(5).trim();
    const secondRecommendation = "원문이 아닌 두 번째 추천 기사이며 소셜 플랫폼의 새 기능을 길게 설명하는 카드입니다. ".repeat(5).trim();
    const combinedRecommendations = `${firstRecommendation} ${secondRecommendation}`;
    const crawlUrl = vi.fn(async () => crawledSnapshot({
      finalUrl: url,
      title: "Creators and AI labels",
      metaDescription: "A report about creator trust and AI labels.",
      text: combinedRecommendations,
      rawText: `<html><body><main><article>${firstRecommendation}</article><article>${secondRecommendation}</article></main></body></html>`,
    })) as unknown as typeof crawlSourceUrl;

    const result = await resolveAiContentSeed(
      { kind: "topic_url", url },
      { crawlUrl, ...clock },
    );

    expect(result.kind).toBe("topic_url");
    if (result.kind !== "topic_url") throw new Error("expected_topic_url");
    expect(result.text).toContain("온라인 검색으로 원문 내용을 검증해야 합니다");
    expect(result.text).not.toContain(firstRecommendation);
    expect(result.text).not.toContain(secondRecommendation);
  });

  it("uses a bounded URL topic hint as the title when fallback metadata has no title", async () => {
    const url = "https://publisher.example/research/creator-trust-and-ai-labels-2026-08";
    const recommendation = "원문이 아니라 다른 소식을 소개하는 추천 카드 문장입니다. 검색 주제로 사용하면 안 되는 주변 내용입니다. ".repeat(4).trim();
    const crawlUrl = vi.fn(async () => crawledSnapshot({
      finalUrl: url,
      title: null,
      metaDescription: null,
      text: recommendation,
      rawText: `<html><body><article>${recommendation}</article><article>두 번째 추천 기사 카드</article></body></html>`,
    })) as unknown as typeof crawlSourceUrl;

    const result = await resolveAiContentSeed(
      { kind: "topic_url", url },
      { crawlUrl, ...clock },
    );

    expect(result).toMatchObject({
      kind: "topic_url",
      title: "creator trust and ai labels 2026 08",
    });
    expect(result.kind === "topic_url" ? result.title?.length : 0).toBeLessThanOrEqual(500);
    expect(result.kind === "topic_url" ? result.text : "").toContain("수집 제목: creator trust and ai labels 2026 08");
  });

  it("uses metadata fallback for a JavaScript shell with no extracted body", async () => {
    const url = "https://publisher.example/research/creator-trust-ai-labels";
    const crawlUrl = vi.fn(async () => crawledSnapshot({
      finalUrl: url,
      title: "Creator trust and AI labels",
      metaDescription: "How creators respond to AI disclosure labels.",
      text: " \n\t ",
      rawText: "<html><head><title>Creator trust and AI labels</title><meta name=\"description\" content=\"How creators respond to AI disclosure labels.\"></head><body><div id=\"app\"></div><script>window.__DATA__={}</script></body></html>",
    })) as unknown as typeof crawlSourceUrl;

    const result = await resolveAiContentSeed(
      { kind: "topic_url", url },
      { crawlUrl, ...clock },
    );

    expect(result).toMatchObject({
      kind: "topic_url",
      title: "Creator trust and AI labels",
    });
    expect(result.kind === "topic_url" ? result.text : "").toContain("온라인 검색으로 원문 내용을 검증해야 합니다");
    expect(result.kind === "topic_url" ? result.text : "").toContain("메타 설명: How creators respond to AI disclosure labels.");
  });

  it("uses metadata fallback when an empty JavaScript mount is a main element", async () => {
    const url = "https://publisher.example/research/creator-authenticity";
    const crawlUrl = vi.fn(async () => crawledSnapshot({
      finalUrl: url,
      title: "Creator authenticity",
      metaDescription: "A source that renders its article body in the browser.",
      text: " \n\t ",
      rawText: "<html><head><title>Creator authenticity</title></head><body><main id=\"app\"></main><script>window.__DATA__={}</script></body></html>",
    })) as unknown as typeof crawlSourceUrl;

    const result = await resolveAiContentSeed(
      { kind: "topic_url", url },
      { crawlUrl, ...clock },
    );

    expect(result).toMatchObject({ kind: "topic_url", title: "Creator authenticity" });
    expect(result.kind === "topic_url" ? result.text : "").toContain("온라인 검색으로 원문 내용을 검증해야 합니다");
  });

  it("rejects an empty page that has neither title nor metadata", async () => {
    const crawlUrl = vi.fn(async () => crawledSnapshot({
      title: null,
      metaDescription: null,
      text: " \n\t ",
      rawText: "<html><body><main id=\"app\"></main></body></html>",
    })) as unknown as typeof crawlSourceUrl;

    await expect(resolveAiContentSeed(
      { kind: "topic_url", url: "https://publisher.example/unknown" },
      { crawlUrl, ...clock },
    )).rejects.toThrow("ai_content_seed_resolution_failed");
  });

  it("normalizes an empty crawler title to null", async () => {
    const crawlUrl = vi.fn(async () => crawledSnapshot({
      finalUrl: "http://example.com/articles/specific-story",
      title: " \n\t ",
    })) as unknown as typeof crawlSourceUrl;

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
