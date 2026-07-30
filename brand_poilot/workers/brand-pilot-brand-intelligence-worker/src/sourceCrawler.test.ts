import { describe, expect, it, vi } from "vitest";
import {
  assertSafeCrawlUrl,
  crawlSourceUrl,
  discoverContentUrls,
  extractPageSnapshot,
} from "./sourceCrawler.js";

const publicResolver = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);

describe("source crawler security and extraction", () => {
  it("rejects loopback, private, link-local, and mixed public/private DNS targets", async () => {
    await expect(assertSafeCrawlUrl("http://127.0.0.1/admin")).rejects.toThrow(
      "crawl_url_unsafe_address",
    );
    await expect(assertSafeCrawlUrl("https://internal.example", {
      resolveHostname: async () => [{ address: "10.0.0.8", family: 4 }],
    })).rejects.toThrow("crawl_url_unsafe_address");
    await expect(assertSafeCrawlUrl("https://mixed.example", {
      resolveHostname: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ],
    })).rejects.toThrow("crawl_url_unsafe_address");
    await expect(assertSafeCrawlUrl("https://documentation.example", {
      resolveHostname: async () => [{ address: "2001:db8::1", family: 6 }],
    })).rejects.toThrow("crawl_url_unsafe_address");
    await expect(assertSafeCrawlUrl("https://multicast.example", {
      resolveHostname: async () => [{ address: "ff02::1", family: 6 }],
    })).rejects.toThrow("crawl_url_unsafe_address");
  });

  it("stops waiting for DNS as soon as the crawl is cancelled", async () => {
    const controller = new AbortController();
    const crawling = crawlSourceUrl("https://slow-dns.example", {
      resolveHostname: () => new Promise(() => undefined),
      fetcher: vi.fn() as typeof fetch,
      signal: controller.signal,
      timeoutMs: 10_000,
    });
    controller.abort(new Error("brand_analysis_cancelled"));
    await expect(crawling).rejects.toThrow("brand_analysis_cancelled");
  });

  it("revalidates every redirect and blocks a redirect to a private address", async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/latest/meta-data" },
    }));
    await expect(crawlSourceUrl("https://brand.example", {
      fetcher: fetcher as typeof fetch,
      resolveHostname: publicResolver,
    })).rejects.toThrow("crawl_url_unsafe_address");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("allows at most three redirects and enforces the raw response byte limit", async () => {
    const redirecting = vi.fn(async (value: string | URL | Request) => {
      const url = new URL(String(value));
      const next = Number(url.searchParams.get("hop") ?? 0) + 1;
      return new Response(null, {
        status: 302,
        headers: { location: `https://brand.example/?hop=${next}` },
      });
    });
    await expect(crawlSourceUrl("https://brand.example/?hop=0", {
      fetcher: redirecting as typeof fetch,
      resolveHostname: publicResolver,
    })).rejects.toThrow("crawl_redirect_limit_exceeded");
    expect(redirecting).toHaveBeenCalledTimes(4);

    await expect(crawlSourceUrl("https://brand.example/", {
      fetcher: vi.fn(async () => new Response("x".repeat(101), {
        status: 200,
        headers: { "content-type": "text/html", "content-length": "101" },
      })) as typeof fetch,
      resolveHostname: publicResolver,
      maxResponseBytes: 100,
    })).rejects.toThrow("crawl_response_too_large");
  });

  it("extracts canonical metadata and only same-host HTML navigation", () => {
    const html = `
      <html><head>
        <title> 브랜드 소개 </title>
        <link rel="canonical" href="/about?utm_source=test">
        <meta name="description" content="공식 설명">
      </head><body><main>
        <a href="/products/1">제품 하나</a>
        <a href="https://external.example/products/2">외부 제품</a>
        <a href="/download.pdf">PDF</a>
        ${"브랜드 본문 ".repeat(30)}
      </main></body></html>`;
    expect(extractPageSnapshot(html, "https://brand.example/start")).toMatchObject({
      title: "브랜드 소개",
      canonicalUrl: "https://brand.example/about",
      metaDescription: "공식 설명",
    });
    expect(discoverContentUrls("https://brand.example/start", html).map((item) => item.url))
      .toEqual([
        "https://brand.example/start",
        "https://brand.example/about",
        "https://brand.example/products/1",
      ]);
  });
});
