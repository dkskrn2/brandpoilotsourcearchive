import { describe, expect, it, vi } from "vitest";
import { assertSafeCrawlUrl, crawlSourceUrl, discoverContentUrls, extractPageSnapshot, isLikelyContentPage } from "./sourceCrawler";

describe("sourceCrawler", () => {
  it("rejects loopback URLs before the crawler fetches them", async () => {
    await expect(assertSafeCrawlUrl("http://127.0.0.1:4000/private")).rejects.toThrow("crawl_url_unsafe_address");
    await expect(assertSafeCrawlUrl("http://localhost/private")).rejects.toThrow("crawl_url_unsafe_host");
  });

  it("rejects public hostnames that resolve to a private address", async () => {
    await expect(assertSafeCrawlUrl("https://example.com/article", {
      resolveHostname: async () => [{ address: "10.0.0.8" }]
    })).rejects.toThrow("crawl_url_unsafe_address");
  });

  it("extracts title, meta description, and readable text from html", () => {
    const snapshot = extractPageSnapshot(`
      <html>
        <head>
          <title>Jeju Travel Guide</title>
          <meta name="description" content="A practical guide for first-time visitors">
          <script>window.noise = true</script>
        </head>
        <body>
          <nav>Skip this navigation</nav>
          <main>
            <h1>Three day Jeju route</h1>
            <p>Start near the airport and move east on day one.</p>
          </main>
        </body>
      </html>
    `);

    expect(snapshot.title).toBe("Jeju Travel Guide");
    expect(snapshot.metaDescription).toBe("A practical guide for first-time visitors");
    expect(snapshot.text).toContain("Three day Jeju route");
    expect(snapshot.text).not.toContain("window.noise");
  });

  it("prefers article body text over repeated page chrome", () => {
    const snapshot = extractPageSnapshot(`
      <html>
        <head><title>Useful Article</title></head>
        <body>
          <header>Brand header menu login signup</header>
          <nav>Home Products Pricing Contact</nav>
          <main>
            <article>
              <h1>Useful Article</h1>
              <p>This is the useful content that should guide the generated draft.</p>
            </article>
          </main>
          <aside>Related links and ads</aside>
          <footer>Footer terms privacy contact</footer>
        </body>
      </html>
    `);

    expect(snapshot.text).toContain("Useful Article");
    expect(snapshot.text).toContain("useful content");
    expect(snapshot.text).not.toContain("Brand header menu");
    expect(snapshot.text).not.toContain("Home Products Pricing");
    expect(snapshot.text).not.toContain("Footer terms");
  });

  it("discovers normalized content URLs from a registered seed page", () => {
    const links = discoverContentUrls("https://example.com/blog/?utm_source=newsletter", `
      <html>
        <head>
          <link rel="canonical" href="https://example.com/blog/">
        </head>
        <body>
          <nav>
            <a href="/pricing">Pricing</a>
          </nav>
          <main>
            <a href="/blog/jeju-route?utm_medium=social#comments">Jeju route guide</a>
            <a href="https://outside.example.net/story">External story</a>
            <a href="mailto:hello@example.com">Mail</a>
          </main>
          <footer>
            <a href="/privacy">Privacy</a>
          </footer>
        </body>
      </html>
    `);

    expect(links).toEqual([
      { url: "https://example.com/blog/", discoveryMethod: "seed_self", linkText: null },
      { url: "https://example.com/blog/jeju-route", discoveryMethod: "anchor", linkText: "Jeju route guide" }
    ]);
  });

  it("classifies article pages as content and listing pages as non-content", () => {
    const articleHtml = `
      <html>
        <head>
          <meta property="og:type" content="article">
          <title>Useful Article</title>
        </head>
        <body>
          <article>
            <h1>Useful Article</h1>
            <p>${"Useful article body. ".repeat(30)}</p>
          </article>
        </body>
      </html>
    `;
    const categoryHtml = `
      <html>
        <head><title>Category list</title></head>
        <body>
          <main>
            <a href="/article/one">Article one</a>
            <a href="/article/two">Article two</a>
            <a href="/article/three">Article three</a>
          </main>
        </body>
      </html>
    `;

    expect(isLikelyContentPage("https://example.com/article/useful", articleHtml, extractPageSnapshot(articleHtml))).toBe(true);
    expect(isLikelyContentPage("https://example.com/category/featured", categoryHtml, extractPageSnapshot(categoryHtml))).toBe(false);
  });

  it("keeps listing URLs out even when they contain article metadata for listed posts", () => {
    const categoryHtml = `
      <html>
        <head>
          <title>Article category</title>
          <script type="application/ld+json">
            [{"@type":"Article","headline":"Listed post one"},{"@type":"Article","headline":"Listed post two"}]
          </script>
        </head>
        <body>
          <main>
            <article><a href="/article/one">Listed post one</a><p>${"Summary text. ".repeat(10)}</p></article>
            <article><a href="/article/two">Listed post two</a><p>${"Summary text. ".repeat(10)}</p></article>
            <article><a href="/article/three">Listed post three</a><p>${"Summary text. ".repeat(10)}</p></article>
          </main>
        </body>
      </html>
    `;

    expect(isLikelyContentPage("https://example.com/category/article/", categoryHtml, extractPageSnapshot(categoryHtml))).toBe(false);
  });

  it("rejects common utility and index URLs while keeping article-like URLs", () => {
    const longUtilityHtml = `
      <html>
        <head><title>Privacy Policy</title></head>
        <body><main><p>${"Policy and company information. ".repeat(40)}</p></main></body>
      </html>
    `;
    const longIndexHtml = `
      <html>
        <head><title>Insights</title></head>
        <body><main><p>${"Latest insights and summaries. ".repeat(40)}</p></main></body>
      </html>
    `;
    const articleHtml = `
      <html>
        <head><title>Market trend article</title></head>
        <body><main><p>${"Useful market trend analysis. ".repeat(40)}</p></main></body>
      </html>
    `;

    expect(isLikelyContentPage("https://example.com/", longIndexHtml, extractPageSnapshot(longIndexHtml))).toBe(false);
    expect(isLikelyContentPage("https://example.com/insight", longIndexHtml, extractPageSnapshot(longIndexHtml))).toBe(false);
    expect(isLikelyContentPage("https://example.com/privacy-policy", longUtilityHtml, extractPageSnapshot(longUtilityHtml))).toBe(false);
    expect(isLikelyContentPage("https://example.com/team", longUtilityHtml, extractPageSnapshot(longUtilityHtml))).toBe(false);
    expect(isLikelyContentPage("https://example.com/careers", longUtilityHtml, extractPageSnapshot(longUtilityHtml))).toBe(false);
    expect(isLikelyContentPage("https://example.com/slack", longUtilityHtml, extractPageSnapshot(longUtilityHtml))).toBe(false);
    expect(isLikelyContentPage("https://example.com/telegram", longUtilityHtml, extractPageSnapshot(longUtilityHtml))).toBe(false);
    expect(isLikelyContentPage("https://example.com/article/market-trend-2026", articleHtml, extractPageSnapshot(articleHtml))).toBe(true);
    expect(isLikelyContentPage("https://example.com/innovations/market-trend-2026", articleHtml, extractPageSnapshot(articleHtml))).toBe(true);
  });

  it("fetches html with a timeout-aware crawler user agent", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        "User-Agent": expect.stringContaining("BrandPilot"),
        Accept: "text/html,application/xhtml+xml"
      });
      return new Response("<title>Fetched</title><p>Body</p>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    });

    const snapshot = await crawlSourceUrl("https://example.com", {
      fetcher: fetcher as typeof fetch,
      resolveHostname: async () => [{ address: "93.184.216.34" }]
    });

    expect(snapshot.httpStatus).toBe(200);
    expect(snapshot.title).toBe("Fetched");
    expect(snapshot.text).toContain("Body");
  });
});
