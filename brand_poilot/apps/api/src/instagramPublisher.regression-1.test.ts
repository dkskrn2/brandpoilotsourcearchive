import { describe, expect, it, vi } from "vitest";
import { publishInstagramCarouselWithMeta } from "./instagramPublisher";

// Regression: ISSUE-002 — 계정 연결과 실제 발행이 서로 다른 Graph API 버전을 사용함
// Found by /qa on 2026-07-12
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-12.md
describe("Instagram publisher Graph API version", () => {
  it("uses the configured Graph API version for every publish request", async () => {
    const urls: string[] = [];
    let nextId = 0;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(url);
      if (init?.method === "GET") {
        return new Response(JSON.stringify({ status_code: "FINISHED" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      nextId += 1;
      return new Response(JSON.stringify({ id: `media-${nextId}` }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });

    await publishInstagramCarouselWithMeta({
      accessToken: "meta-token",
      instagramBusinessAccountId: "instagram-account-1",
      imageUrls: ["https://cdn.example.com/slide-1.png"],
      caption: "테스트 게시물",
      graphVersion: "v23.0",
      fetchImpl: fetchImpl as typeof fetch,
      statusPollIntervalMs: 1
    });

    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => url.startsWith("https://graph.facebook.com/v23.0/"))).toBe(true);
  });
});
