import { describe, expect, it, vi } from "vitest";
import { fetchMetaAdLibrary, normalizeMetaAdSearchInput } from "./metaAdLibrary.js";

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Meta Ad Library", () => {
  it("normalizes explicit keyword and Page searches without Instagram hashtag rules", () => {
    expect(normalizeMetaAdSearchInput({ mode: "keyword", query: "  여름   스킨케어 ✨ " })).toEqual({
      mode: "keyword", query: "여름 스킨케어 ✨", country: "KR",
    });
    expect(normalizeMetaAdSearchInput({ mode: "page", pageIds: [" 123 ", "456", "123"] })).toEqual({
      mode: "page", pageIds: ["123", "456"], country: "KR",
    });
  });

  it.each([
    { mode: "keyword", query: "a" },
    { mode: "keyword", query: "x".repeat(101) },
    { mode: "page", pageIds: [] },
    { mode: "page", pageIds: ["not-a-page"] },
    { mode: "page", pageIds: Array.from({ length: 11 }, (_, index) => String(index + 1)) },
  ] as const)("rejects invalid search input %#", (input) => {
    expect(() => normalizeMetaAdSearchInput(input as never)).toThrow("meta_ad_library_search_invalid");
  });

  it("requests active Korean ads and normalizes text-first results", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (url) => {
      calls.push(String(url));
      return response({ data: [{
        id: "ad-1",
        page_id: "page-1",
        page_name: "라라스윗",
        ad_creative_bodies: ["첫 문구", "두 번째 문구"],
        ad_creative_link_titles: ["여름 신제품"],
        ad_creative_link_captions: ["공식몰"],
        ad_creative_link_descriptions: ["한정 판매"],
        ad_snapshot_url: "https://www.facebook.com/ads/archive/render_ad/?id=ad-1",
        publisher_platforms: ["instagram", "facebook", "unknown"],
        ad_delivery_start_time: "2026-08-01",
        ad_delivery_stop_time: "2026-08-10",
      }] });
    };

    const result = await fetchMetaAdLibrary({
      mode: "keyword", query: "스킨 케어", accessToken: "secret", fetcher, graphVersion: "v99.0",
    });

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!);
    expect(url.origin + url.pathname).toBe("https://graph.facebook.com/v99.0/ads_archive");
    expect(url.searchParams.get("search_terms")).toBe("스킨 케어");
    expect(url.searchParams.get("ad_reached_countries")).toBe('["KR"]');
    expect(url.searchParams.get("ad_active_status")).toBe("ACTIVE");
    expect(url.searchParams.get("ad_type")).toBe("ALL");
    expect(url.searchParams.get("access_token")).toBe("secret");
    expect(url.searchParams.get("fields")).not.toContain("spend");
    expect(result).toEqual({
      ads: [{
        providerAdId: "ad-1",
        sourcePlatform: "meta_ad_library",
        pageId: "page-1",
        pageName: "라라스윗",
        creativeBody: "첫 문구",
        creativeTitle: "여름 신제품",
        creativeCaption: "공식몰",
        creativeDescription: "한정 판매",
        snapshotUrl: "https://www.facebook.com/ads/archive/render_ad/?id=ad-1",
        publisherPlatforms: ["instagram", "facebook"],
        deliveryStartedAt: "2026-08-01T00:00:00.000Z",
        deliveryStoppedAt: "2026-08-10T00:00:00.000Z",
        activeStatus: "ACTIVE",
        reachedCountries: ["KR"],
      }],
      nextCursor: null,
    });
  });

  it("uses Page IDs explicitly and never sends search_terms", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response({ data: [] }));
    await fetchMetaAdLibrary({ mode: "page", pageIds: ["123", "456"], accessToken: "secret", fetcher });
    const url = new URL(String(fetcher.mock.calls[0]![0]));
    expect(url.searchParams.get("search_page_ids")).toBe('["123","456"]');
    expect(url.searchParams.has("search_terms")).toBe(false);
  });

  it("passes one bounded abort signal through the whole Meta ad collection", async () => {
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.signal instanceof AbortSignal) signals.push(init.signal);
      return response({ data: [], paging: { cursors: { after: "next" } } });
    });

    await fetchMetaAdLibrary({
      mode: "keyword",
      query: "검색어",
      accessToken: "secret",
      fetcher,
      timeoutMs: 25,
    });

    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(signals[0]?.aborted).toBe(true);
  });

  it("rejects non-Meta and non-HTTPS snapshot URLs while preserving the ad text", async () => {
    const fetcher: typeof fetch = async () => response({ data: [
      { id: "ad-1", page_id: "page-1", page_name: "A", ad_creative_bodies: ["본문"], ad_snapshot_url: "http://facebook.com/ad" },
      { id: "ad-2", page_id: "page-2", page_name: "B", ad_creative_bodies: ["본문"], ad_snapshot_url: "https://evil.example/ad" },
    ] });
    const result = await fetchMetaAdLibrary({ mode: "keyword", query: "검색어", accessToken: "secret", fetcher });
    expect(result.ads.map((ad) => ad.snapshotUrl)).toEqual([null, null]);
  });

  it("follows bounded cursors, avoids loops, and caps results at 100", async () => {
    let call = 0;
    const fetcher = vi.fn<typeof fetch>(async () => {
      call += 1;
      return response({
        data: Array.from({ length: 60 }, (_, index) => ({
          id: `ad-${call}-${index}`, page_id: `page-${index}`, page_name: "광고주",
        })),
        paging: { cursors: { after: "same-cursor" } },
      });
    });
    const result = await fetchMetaAdLibrary({ mode: "keyword", query: "검색어", accessToken: "secret", fetcher });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.ads).toHaveLength(100);
    expect(result.nextCursor).toBe("same-cursor");
  });

  it.each([
    [429, 4, "meta_ad_library_rate_limited"],
    [401, 190, "meta_ad_library_reconnect_required"],
    [403, 10, "meta_ad_library_permission_required"],
    [500, null, "meta_ad_library_fetch_failed"],
  ])("maps provider failure %s/%s to %s", async (status, code, expected) => {
    const fetcher: typeof fetch = async () => response({ error: { code, message: "secret provider message" } }, status);
    await expect(fetchMetaAdLibrary({ mode: "keyword", query: "검색어", accessToken: "token", fetcher }))
      .rejects.toThrow(expected);
  });
});
