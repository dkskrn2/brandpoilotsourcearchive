import { describe, expect, it } from "vitest";
import { assertSafeCrawlUrl } from "./sourceCrawler";

// Regression: ISSUE-003 — WordPress 공인 192.0.78.x 주소를 사설 주소로 오인함
// Found by /qa on 2026-07-12
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-12.md
describe("source crawler public 192.0 address handling", () => {
  it("allows WordPress public addresses while keeping special and private ranges blocked", async () => {
    await expect(assertSafeCrawlUrl("https://public.example.com/article", {
      resolveHostname: async () => [{ address: "192.0.78.222" }]
    })).resolves.toBeInstanceOf(URL);

    await expect(assertSafeCrawlUrl("https://special.example.com/article", {
      resolveHostname: async () => [{ address: "192.0.0.10" }]
    })).rejects.toThrow("crawl_url_unsafe_address");

    await expect(assertSafeCrawlUrl("https://private.example.com/article", {
      resolveHostname: async () => [{ address: "192.168.1.10" }]
    })).rejects.toThrow("crawl_url_unsafe_address");
  });
});
