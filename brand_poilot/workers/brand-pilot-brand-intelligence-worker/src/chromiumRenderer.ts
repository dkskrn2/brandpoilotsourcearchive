import { chromium, type Browser, type BrowserContext } from "playwright";
import { getDomain } from "tldts";
import {
  assertSafeCrawlUrl,
  extractPageSnapshot,
  fetchSafeCrawlResource,
  type CrawledSnapshot,
} from "./sourceCrawler.js";

export interface OwnedPageRenderer {
  render(url: string, signal?: AbortSignal): Promise<CrawledSnapshot>;
  close(): Promise<void>;
}

export function createOwnedPageRenderer(): OwnedPageRenderer {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  async function ensureContext() {
    if (!browser) {
      browser = await chromium.launch({
        headless: true,
        args: [
          "--disable-background-networking",
          "--disable-component-update",
          "--disable-domain-reliability",
          "--disable-sync",
          "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        ],
      });
    }
    if (!context) {
      context = await browser.newContext({
        acceptDownloads: false,
        serviceWorkers: "block",
      });
    }
    return context;
  }

  return {
    async render(url, signal) {
      const safe = await assertSafeCrawlUrl(url);
      const ownedDomain = getDomain(safe.hostname) ?? safe.hostname;
      const page = await (await ensureContext()).newPage();
      const abort = () => void page.close().catch(() => undefined);
      signal?.addEventListener("abort", abort, { once: true });
      try {
        await page.routeWebSocket("**/*", (socket) => socket.close());
        await page.route("**/*", async (route) => {
          const request = route.request();
          if (["image", "media", "font", "websocket"].includes(request.resourceType())) {
            return route.abort();
          }
          try {
            const resource = await fetchSafeCrawlResource(request.url(), {
              signal,
              timeoutMs: 10_000,
              maxResponseBytes: 2 * 1024 * 1024,
            });
            if (request.isNavigationRequest()) {
              const finalHost = new URL(resource.finalUrl).hostname;
              if ((getDomain(finalHost) ?? finalHost) !== ownedDomain) {
                return route.abort();
              }
            }
            await route.fulfill({
              status: resource.httpStatus,
              contentType: resource.contentType || undefined,
              body: Buffer.from(resource.body),
            });
          } catch {
            await route.abort();
          }
        });
        const response = await page.goto(safe.toString(), {
          waitUntil: "domcontentloaded",
          timeout: 10_000,
        });
        const html = await page.content();
        if (Buffer.byteLength(html) > 2 * 1024 * 1024) {
          throw new Error("crawl_response_too_large");
        }
        const finalUrl = page.url();
        await assertSafeCrawlUrl(finalUrl);
        const finalHost = new URL(finalUrl).hostname;
        if ((getDomain(finalHost) ?? finalHost) !== ownedDomain) {
          throw new Error("crawl_redirect_domain_mismatch");
        }
        const snapshot = extractPageSnapshot(html, finalUrl);
        return {
          ...snapshot,
          canonicalUrl: snapshot.canonicalUrl ?? finalUrl,
          httpStatus: response?.status() ?? 200,
          rawText: html,
        };
      } finally {
        signal?.removeEventListener("abort", abort);
        await page.close().catch(() => undefined);
      }
    },
    async close() {
      await context?.close().catch(() => undefined);
      context = null;
      await browser?.close().catch(() => undefined);
      browser = null;
    },
  };
}

export async function renderOwnedPage(
  url: string,
  signal?: AbortSignal,
): Promise<CrawledSnapshot> {
  const renderer = createOwnedPageRenderer();
  try {
    return await renderer.render(url, signal);
  } finally {
    await renderer.close();
  }
}
