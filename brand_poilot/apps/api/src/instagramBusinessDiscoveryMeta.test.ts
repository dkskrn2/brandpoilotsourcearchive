import { describe, expect, it } from "vitest";
import {
  fetchInstagramBusinessDiscovery,
  normalizeInstagramHandle,
} from "./instagramBusinessDiscoveryMeta.js";

const accessToken = "meta-secret-token";
const input = {
  igUserId: "ig-owner-1",
  accessToken,
  username: "target.brand",
  graphVersion: "v99.0",
};

function response(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("Instagram Business Discovery", () => {
  it.each([
    [" @Target.Brand ", "target.brand"],
    ["https://www.instagram.com/target_brand/", "target_brand"],
  ])("normalizes an exact public handle from %s", (raw, expected) => {
    expect(normalizeInstagramHandle(raw)).toBe(expected);
  });

  it.each(["", "target brand", "instagram.com/p/post", "https://example.com/target"])(
    "rejects an invalid handle %s",
    (raw) => expect(() => normalizeInstagramHandle(raw)).toThrow("reference_channel_handle_invalid"),
  );

  it("requests bounded public profile and recent-media fields", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (url) => {
      calls.push(String(url));
      return response({
        business_discovery: {
          id: "ig-target-1",
          username: "target.brand",
          biography: "공개 소개",
          followers_count: 1234,
          media_count: 88,
          website: "https://target.example",
          media: { data: [{
            id: "media-1", username: "target.brand", caption: "공개 게시물",
            comments_count: 4, like_count: 50, view_count: 900,
            media_type: "VIDEO", media_url: "https://cdn.example/video.mp4",
            permalink: "https://www.instagram.com/reel/one/", timestamp: "2026-08-11T01:00:00Z",
          }] },
        },
      }, 200, {
        "x-app-usage": JSON.stringify({ call_count: 12, total_time: 4, total_cputime: 3 }),
      });
    };

    const result = await fetchInstagramBusinessDiscovery({ ...input, fetcher });

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!);
    expect(url.origin + url.pathname).toBe("https://graph.facebook.com/v99.0/ig-owner-1");
    expect(url.searchParams.get("access_token")).toBe(accessToken);
    const fields = url.searchParams.get("fields") ?? "";
    expect(fields).toContain("business_discovery.username(target.brand)");
    expect(fields).toContain("media.limit(25)");
    expect(fields).not.toContain("insights");
    expect(fields).not.toContain("profile_picture_url");
    expect(fields).not.toMatch(/(?:^|,)name(?:,|})/);
    expect(result).toEqual({
      usage: { callCount: 12, totalTime: 4, totalCpuTime: 3 },
      profile: {
        providerAccountId: "ig-target-1", username: "target.brand", biography: "공개 소개",
        followersCount: 1234, mediaCount: 88, website: "https://target.example",
        name: null, profilePictureUrl: null,
      },
      media: [{
        providerMediaId: "media-1", username: "target.brand", caption: "공개 게시물",
        commentsCount: 4, likeCount: 50, viewCount: 900, mediaType: "VIDEO",
        mediaUrl: "https://cdn.example/video.mp4", permalink: "https://www.instagram.com/reel/one/",
        timestamp: "2026-08-11T01:00:00.000Z",
      }],
    });
  });

  it("preserves nullable public fields and truncates media to 25", async () => {
    const data = Array.from({ length: 30 }, (_, index) => ({
      id: `media-${index}`, media_type: "IMAGE", permalink: `https://instagram.com/p/${index}`,
    }));
    const fetcher: typeof fetch = async () => response({
      business_discovery: { id: "target-id", username: "target.brand", media: { data } },
    });
    const result = await fetchInstagramBusinessDiscovery({ ...input, fetcher });
    expect(result.media).toHaveLength(25);
    expect(result.profile).toMatchObject({
      biography: null, followersCount: null, mediaCount: null, website: null,
      name: null, profilePictureUrl: null,
    });
    expect(result.media[0]).toMatchObject({ viewCount: null, likeCount: null, commentsCount: null });
  });

  it.each([
    [429, { error: { code: 4, message: `rate ${accessToken}` } }, "instagram_rate_limited"],
    [401, { error: { code: 190, message: `expired ${accessToken}` } }, "instagram_reconnect_required"],
    [403, { error: { code: 10, message: `denied ${accessToken}` } }, "instagram_permission_required"],
    [400, { error: { code: 100, error_subcode: 33, message: `not eligible ${accessToken}` } }, "reference_channel_ineligible"],
    [400, { error: { code: 100, message: `invalid field ${accessToken}` } }, "instagram_business_discovery_failed"],
    [500, { error: { message: `provider ${accessToken}` } }, "instagram_business_discovery_failed"],
  ])("returns a stable redacted error for HTTP %s", async (status, payload, expected) => {
    const fetcher: typeof fetch = async () => response(payload, status);
    const error = await fetchInstagramBusinessDiscovery({ ...input, fetcher }).catch((caught) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(expected);
    expect((error as Error).message).not.toContain(accessToken);
  });

  it.each([
    [{}, "instagram_business_discovery_invalid"],
    [{ business_discovery: { id: "x" } }, "instagram_business_discovery_invalid"],
    [{ business_discovery: { id: "x", username: "other" } }, "instagram_business_discovery_invalid"],
  ])("rejects malformed success payloads", async (payload, expected) => {
    const fetcher: typeof fetch = async () => response(payload);
    await expect(fetchInstagramBusinessDiscovery({ ...input, fetcher })).rejects.toThrow(expected);
  });
});
