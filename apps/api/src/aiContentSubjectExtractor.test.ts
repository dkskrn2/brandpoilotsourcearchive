import { describe, expect, it, vi } from "vitest";
import { extractSubjectPage, pinnedLookup } from "./aiContentSubjectExtractor";

const publicDns = async () => ["93.184.216.34"];

function htmlResponse(html: string, headers: Record<string, string> = {}) {
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
}

function imageResponse(type = "image/png", body = "image") {
  return new Response(body, { status: 200, headers: { "content-type": type } });
}

function responseWithTrackedCancel({
  status = 200,
  contentType = "image/png",
  contentLength,
}: { status?: number; contentType?: string; contentLength?: number } = {}) {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel });
  const headers: Record<string, string> = { "content-type": contentType };
  if (contentLength !== undefined) headers["content-length"] = String(contentLength);
  return { response: new Response(body, { status, headers }), cancel };
}

describe("extractSubjectPage", () => {
  it("pins validated DNS addresses for single and all-address lookup modes", async () => {
    const lookup = pinnedLookup([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);

    await expect(new Promise((resolve, reject) => lookup("example.com", { all: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses);
    }))).resolves.toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);
    await expect(new Promise((resolve, reject) => lookup("example.com", { family: 6 }, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    }))).resolves.toEqual({ address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 });
  });

  it("passes a pinned dispatcher to an injected fetch implementation", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect((init as RequestInit & { dispatcher?: unknown }).dispatcher).toBeDefined();
      return htmlResponse("<main>Safe page</main>");
    });

    await extractSubjectPage({ url: "https://example.com/page", fetchImpl: fetchImpl as typeof fetch, resolveHost: publicDns, archiveImage: vi.fn() });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("extracts page facts, Product JSON-LD, relative image URLs, and archives deduplicated candidates", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://shop.example/items/1") return htmlResponse(`
        <html><head>
          <title>Summer Shirt</title>
          <meta property="og:description" content="Lightweight linen shirt">
          <meta property="og:image" content="/media/hero.png">
          <link rel="canonical" href="/products/summer-shirt">
          <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Summer Shirt","sku":"SHIRT-1","image":"/media/hero.png"}</script>
        </head><body><main>
          <h1>Summer Shirt</h1><p>Made from 100% linen.</p>
          <img src="/media/hero.png" alt="Summer Shirt" width="800" height="600">
          <img srcset="/media/detail-small.webp 480w, /media/detail.webp 1200w" alt="Collar detail">
        </main></body></html>`);
      if (url.endsWith("hero.png")) return imageResponse("image/png");
      if (url.endsWith("detail-small.webp") || url.endsWith("detail.webp")) return imageResponse("image/webp");
      throw new Error(`unexpected_fetch:${url}`);
    });
    const archiveImage = vi.fn(async (image: { sourceUrl: string; index: number; mimeType: string }) => ({
      storageUrl: `https://blob.example/${image.index}`,
      storagePath: `subjects/a/${image.index}`,
    }));

    const result = await extractSubjectPage({
      url: "https://shop.example/items/1",
      fetchImpl: fetchImpl as typeof fetch,
      resolveHost: publicDns,
      archiveImage,
    });

    expect(result).toMatchObject({
      canonicalUrl: "https://shop.example/products/summer-shirt",
      title: "Summer Shirt",
      description: "Lightweight linen shirt",
      structuredData: { "@type": "Product", name: "Summer Shirt", sku: "SHIRT-1" },
    });
    expect(result.facts).toEqual(expect.arrayContaining([
      { key: "title", value: "Summer Shirt", sourceUrl: "https://shop.example/items/1" },
      { key: "visible_text", value: expect.stringContaining("100% linen"), sourceUrl: "https://shop.example/items/1" },
    ]));
    expect(result.images.map((image) => image.sourceUrl)).toEqual([
      "https://shop.example/media/hero.png",
      "https://shop.example/media/detail-small.webp",
      "https://shop.example/media/detail.webp",
    ]);
    expect(result.images[0]).toMatchObject({ mimeType: "image/png", altText: "Summer Shirt", role: "product", width: 800, height: 600 });
    expect(archiveImage).toHaveBeenCalledTimes(3);
  });

  it("extracts visible copy without leaking JSON-like HTML attributes", async () => {
    const fetchImpl = vi.fn(async () => htmlResponse(`
      <main data-product='{"comparison":"a > b","nested":{"label":"internal"}}'>
        <h1>휴대용 업무 마우스</h1>
        <p>조용한 공간에서도 편하게 사용합니다.</p>
      </main>`));

    const result = await extractSubjectPage({
      url: "https://example.com/product",
      fetchImpl: fetchImpl as typeof fetch,
      resolveHost: publicDns,
      archiveImage: vi.fn(),
    });

    expect(result.facts).toContainEqual({
      key: "visible_text",
      value: "휴대용 업무 마우스 조용한 공간에서도 편하게 사용합니다.",
      sourceUrl: "https://example.com/product",
    });
  });

  it("archives at most six page-discovered image sources after deduplication", async () => {
    const images = Array.from({ length: 24 }, (_, index) => `<img src="/image-${index}.jpg"><img src="/image-${index}.jpg">`).join("");
    const fetchImpl = vi.fn(async (input: string | URL | Request) => String(input).endsWith("/page")
      ? htmlResponse(`<main>${images}</main>`)
      : imageResponse("image/jpeg"));
    const archiveImage = vi.fn(async ({ index }: { index: number }) => ({ storageUrl: `blob:${index}`, storagePath: `p/${index}` }));

    const result = await extractSubjectPage({ url: "https://example.com/page", fetcher: fetchImpl as typeof fetch, resolveHostname: publicDns, archiveImage });

    expect(result.images).toHaveLength(6);
    expect(archiveImage).toHaveBeenCalledTimes(6);
  });

  it("revalidates redirects and rejects a redirect target resolving to a private address", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://internal.example/metadata" } }));
    const resolveHost = vi.fn(async (hostname: string) => hostname === "internal.example" ? ["169.254.169.254"] : ["93.184.216.34"]);

    await expect(extractSubjectPage({ url: "https://example.com/page", fetchImpl: fetchImpl as typeof fetch, resolveHost, archiveImage: vi.fn() }))
      .rejects.toThrow("crawl_url_unsafe_address");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(resolveHost).toHaveBeenCalledWith("internal.example");
  });

  it("rejects private page addresses before fetching", async () => {
    const fetchImpl = vi.fn();
    await expect(extractSubjectPage({ url: "https://example.com/page", fetchImpl: fetchImpl as typeof fetch, resolveHost: async () => ["10.0.0.2"], archiveImage: vi.fn() }))
      .rejects.toThrow("crawl_url_unsafe_address");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects well-known metadata hostnames before DNS or fetch", async () => {
    const fetchImpl = vi.fn();
    const resolveHost = vi.fn(async () => ["93.184.216.34"]);

    await expect(extractSubjectPage({ url: "http://metadata.google.internal/computeMetadata/v1", fetchImpl: fetchImpl as typeof fetch, resolveHost, archiveImage: vi.fn() }))
      .rejects.toThrow("crawl_url_unsafe_host");

    expect(resolveHost).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not perform a second unvalidated DNS lookup before a request", async () => {
    const resolveHost = vi.fn()
      .mockResolvedValueOnce(["93.184.216.34"])
      .mockResolvedValueOnce(["10.0.0.2"]);
    const fetchImpl = vi.fn(async () => htmlResponse("<main>Safe page</main>"));

    await extractSubjectPage({ url: "https://example.com/page", fetchImpl: fetchImpl as typeof fetch, resolveHost, archiveImage: vi.fn() });

    expect(resolveHost).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized HTML and non-HTML page MIME", async () => {
    const oversized = vi.fn(async () => htmlResponse("small", { "content-length": String(5 * 1024 * 1024 + 1) }));
    await expect(extractSubjectPage({ url: "https://example.com/page", fetchImpl: oversized as typeof fetch, resolveHost: publicDns, archiveImage: vi.fn() }))
      .rejects.toThrow("subject_page_too_large");

    const badMime = vi.fn(async () => new Response("{}", { headers: { "content-type": "application/json" } }));
    await expect(extractSubjectPage({ url: "https://example.com/page", fetchImpl: badMime as typeof fetch, resolveHost: publicDns, archiveImage: vi.fn() }))
      .rejects.toThrow("subject_page_mime_unsupported");
  });

  it("skips oversized, bad-MIME, and failed images without failing the page", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/page")) return htmlResponse(`<main><img src="/large.png"><img src="/svg.svg"><img src="/failed.jpg"><img src="/ok.gif"></main>`);
      if (url.endsWith("large.png")) return new Response("small", {
        headers: { "content-type": "image/png", "content-length": String(10 * 1024 * 1024 + 1) },
      });
      if (url.endsWith("svg.svg")) return imageResponse("image/svg+xml");
      if (url.endsWith("failed.jpg")) throw new Error("network_failure");
      return imageResponse("image/gif");
    });
    const archiveImage = vi.fn(async ({ index }: { index: number }) => ({ storageUrl: `blob:${index}`, storagePath: `p/${index}` }));

    const result = await extractSubjectPage({ url: "https://example.com/page", fetchImpl: fetchImpl as typeof fetch, resolveHost: publicDns, archiveImage });

    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toMatchObject({ sourceUrl: "https://example.com/ok.gif", mimeType: "image/gif" });
    expect(archiveImage).toHaveBeenCalledTimes(1);
  });

  it("cancels response bodies rejected before reading", async () => {
    const nonOk = responseWithTrackedCancel({ status: 502 });
    const badMime = responseWithTrackedCancel({ contentType: "image/svg+xml" });
    const oversized = responseWithTrackedCancel({ contentLength: 10 * 1024 * 1024 + 1 });
    const responses = [nonOk.response, badMime.response, oversized.response];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => String(input).endsWith("/page")
      ? htmlResponse('<main><img src="/non-ok.png"><img src="/bad.svg"><img src="/large.png"></main>')
      : responses.shift()!);

    const result = await extractSubjectPage({ url: "https://example.com/page", fetchImpl: fetchImpl as typeof fetch, resolveHost: publicDns, archiveImage: vi.fn() });

    expect(result.images).toEqual([]);
    expect(nonOk.cancel).toHaveBeenCalledTimes(1);
    expect(badMime.cancel).toHaveBeenCalledTimes(1);
    expect(oversized.cancel).toHaveBeenCalledTimes(1);
  });

  it("aborts a timed-out archive and continues with remaining candidates", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => String(input).endsWith("/page")
      ? htmlResponse('<main><img src="/slow.png"><img src="/next.png"></main>')
      : imageResponse());
    const archiveImage = vi.fn(async (image: { sourceUrl: string; index: number; signal: AbortSignal }) => {
      if (image.sourceUrl.endsWith("slow.png")) {
        await new Promise<void>((_resolve, reject) => image.signal.addEventListener("abort", () => reject(new Error("archive_aborted")), { once: true }));
      }
      return { storageUrl: `blob:${image.index}`, storagePath: `p/${image.index}` };
    });

    const result = await extractSubjectPage({
      url: "https://example.com/page",
      fetchImpl: fetchImpl as typeof fetch,
      resolveHost: publicDns,
      archiveImage,
      timeoutMs: 20,
    });

    expect(archiveImage).toHaveBeenCalledTimes(2);
    expect(archiveImage.mock.calls[0][0].signal.aborted).toBe(true);
    expect(result.images.map((image) => image.sourceUrl)).toEqual(["https://example.com/next.png"]);
  });

  it("never fetches or archives images that were not discovered on the submitted page", async () => {
    const fetchImpl = vi.fn(async () => htmlResponse("<main><h1>Service</h1><p>Consulting package.</p></main>"));
    const archiveImage = vi.fn();
    const result = await extractSubjectPage({ url: "https://example.com/service", fetchImpl: fetchImpl as typeof fetch, resolveHost: publicDns, archiveImage });
    expect(result.images).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(archiveImage).not.toHaveBeenCalled();
  });
});
