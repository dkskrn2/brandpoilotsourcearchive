import { describe, expect, it } from "vitest";
import { MetaGraphRequestError } from "./metaGraph.js";
import { fetchInstagramHashtagTopMedia } from "./instagramTrendMeta.js";

const accessToken = "super-secret-token";
const input = {
  accessToken,
  instagramBusinessAccountId: "ig-business-1",
  hashtag: "brand_tag",
  graphVersion: "v99.0"
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function fetchQueue(...responses: Array<Response | Error>) {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (url) => {
    calls.push(String(url));
    const response = responses[calls.length - 1];
    if (response instanceof Error) throw response;
    if (!response) throw new Error("unexpected_call");
    return response;
  };
  return { calls, fetchImpl };
}

describe("fetchInstagramHashtagTopMedia", () => {
  it("performs the exact lookup and top-media requests without following paging", async () => {
    const { calls, fetchImpl } = fetchQueue(
      jsonResponse({ data: [{ id: "hashtag-1" }] }),
      jsonResponse({ data: [], paging: { next: "https://should-not-be-called" } })
    );

    const result = await fetchInstagramHashtagTopMedia({ ...input, fetchImpl });

    expect(result).toEqual({ metaHashtagId: "hashtag-1", media: [] });
    expect(calls).toHaveLength(2);

    const lookup = new URL(calls[0]!);
    expect(lookup.origin + lookup.pathname).toBe("https://graph.facebook.com/v99.0/ig_hashtag_search");
    expect(Object.fromEntries(lookup.searchParams)).toEqual({
      user_id: "ig-business-1",
      q: "brand_tag",
      access_token: accessToken
    });

    const topMedia = new URL(calls[1]!);
    expect(topMedia.origin + topMedia.pathname).toBe("https://graph.facebook.com/v99.0/hashtag-1/top_media");
    expect(Object.fromEntries(topMedia.searchParams)).toEqual({
      user_id: "ig-business-1",
      fields: "id,caption,comments_count,like_count,media_type,media_url,permalink,timestamp,username,children{id,media_type,media_url,thumbnail_url,permalink}",
      limit: "50",
      access_token: accessToken
    });
  });

  it("maps top-media data through the Instagram trend mapper", async () => {
    const { fetchImpl } = fetchQueue(
      jsonResponse({ data: [{ id: "hashtag-1" }] }),
      jsonResponse({ data: [{ id: "media-1", media_type: "IMAGE", permalink: "https://instagram.com/p/1", username: "brand" }] })
    );

    const result = await fetchInstagramHashtagTopMedia({ ...input, fetchImpl });

    expect(result.media).toEqual([expect.objectContaining({
      instagramMediaId: "media-1",
      username: "brand",
      mediaType: "IMAGE",
      metaRank: 1
    })]);
  });

  it.each([
    ["missing data", {}],
    ["empty data", { data: [] }],
    ["missing id", { data: [{}] }],
    ["non-string id", { data: [{ id: 42 }] }]
  ])("rejects malformed hashtag lookup (%s) without a second call", async (_name, payload) => {
    const { calls, fetchImpl } = fetchQueue(jsonResponse(payload));

    await expect(fetchInstagramHashtagTopMedia({ ...input, fetchImpl })).rejects.toThrow("instagram_hashtag_not_found");
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["status 401", new MetaGraphRequestError({ status: 401 })],
    ["code 102", new MetaGraphRequestError({ status: 400, code: 102 })],
    ["code 190", new MetaGraphRequestError({ status: 400, code: 190 })]
  ])("maps lookup authentication failures (%s)", async (_name, error) => {
    const { fetchImpl } = fetchQueue(error);
    await expect(fetchInstagramHashtagTopMedia({ ...input, fetchImpl })).rejects.toThrow("instagram_reconnect_required");
  });

  it.each([
    ["status 403", new MetaGraphRequestError({ status: 403 })],
    ["code 10", new MetaGraphRequestError({ status: 400, code: 10 })],
    ["code 200", new MetaGraphRequestError({ status: 400, code: 200 })]
  ])("maps lookup permission failures (%s)", async (_name, error) => {
    const { fetchImpl } = fetchQueue(error);
    await expect(fetchInstagramHashtagTopMedia({ ...input, fetchImpl })).rejects.toThrow("instagram_permission_required");
  });

  it.each([
    ["429", new MetaGraphRequestError({ status: 429 })],
    ["500", new MetaGraphRequestError({ status: 500 })],
    ["network", new Error("network failed")]
  ])("maps request failures (%s) to a stable fetch error", async (_name, error) => {
    const { fetchImpl } = fetchQueue(error);
    await expect(fetchInstagramHashtagTopMedia({ ...input, fetchImpl })).rejects.toThrow("instagram_trend_fetch_failed");
  });

  it("maps second-response authentication and permission errors", async () => {
    for (const [error, expected] of [
      [new MetaGraphRequestError({ status: 401 }), "instagram_reconnect_required"],
      [new MetaGraphRequestError({ status: 403 }), "instagram_permission_required"]
    ] as const) {
      const { fetchImpl } = fetchQueue(jsonResponse({ data: [{ id: "hashtag-1" }] }), error);
      await expect(fetchInstagramHashtagTopMedia({ ...input, fetchImpl })).rejects.toThrow(expected);
    }
  });

  it("treats missing or empty top-media data as an empty valid result", async () => {
    const { fetchImpl } = fetchQueue(
      jsonResponse({ data: [{ id: "hashtag-1" }] }),
      jsonResponse({ paging: { next: "https://should-not-be-called" } })
    );

    await expect(fetchInstagramHashtagTopMedia({ ...input, fetchImpl })).resolves.toEqual({
      metaHashtagId: "hashtag-1",
      media: []
    });
  });

  it("never exposes the access token in stable errors", async () => {
    const { fetchImpl } = fetchQueue(new Error(`request failed with ${accessToken}`));
    const error = await fetchInstagramHashtagTopMedia({ ...input, fetchImpl }).catch((caught) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("instagram_trend_fetch_failed");
    expect((error as Error).message).not.toContain(accessToken);
  });
});
