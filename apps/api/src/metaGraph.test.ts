import { describe, expect, it, vi } from "vitest";
import {
  MetaGraphRequestError,
  classifyMetaGraphPublishError,
  postMetaGraphForm,
  resolveInstagramConnection
} from "./metaGraph";

describe("metaGraph", () => {
  it("resolves an Instagram business account from managed pages", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/me/accounts")) {
        return new Response(JSON.stringify({
          data: [{
            id: "page-1",
            name: "Brand Pilot",
            access_token: "PAGE_TOKEN_123456",
            instagram_business_account: {
              id: "17890000000000000",
              username: "growthline352"
            }
          }]
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        data: [
          { permission: "instagram_basic", status: "granted" },
          { permission: "pages_show_list", status: "declined" }
        ]
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    await expect(resolveInstagramConnection({
      accessToken: "USER_TOKEN",
      fetchImpl: fetchImpl as unknown as typeof fetch
    })).resolves.toEqual({
      accessToken: "PAGE_TOKEN_123456",
      instagramBusinessAccountId: "17890000000000000",
      instagramUsername: "growthline352",
      pageId: "page-1",
      pageName: "Brand Pilot",
      scopes: ["instagram_basic"]
    });
  });

  it("fails clearly when no page has a connected Instagram business account", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: "page-1", name: "Brand Pilot" }]
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(resolveInstagramConnection({
      accessToken: "USER_TOKEN",
      fetchImpl: fetchImpl as unknown as typeof fetch
    })).rejects.toThrow("meta_instagram_business_account_not_found");
  });

  it.each([
    [new MetaGraphRequestError({ status: 400, code: 190 }), "meta_token_invalid"],
    [new MetaGraphRequestError({ status: 403, code: 200 }), "meta_permission_denied"]
  ])("classifies token and permission errors as channel attention failures", (error, errorCode) => {
    expect(classifyMetaGraphPublishError(error)).toEqual({
      errorCode,
      retryable: false,
      channelNeedsAttention: true
    });
  });

  it.each([
    [new MetaGraphRequestError({ status: 429 }), "meta_rate_limited"],
    [new MetaGraphRequestError({ status: 503 }), "meta_server_error"]
  ])("retries only transient Meta responses", (error, errorCode) => {
    expect(classifyMetaGraphPublishError(error)).toEqual({
      errorCode,
      retryable: true,
      channelNeedsAttention: false
    });
  });

  it.each([
    ["story_capability_required", "story_capability_required"],
    ["reel_video_invalid", "reel_video_invalid"],
    ["instagram_public_url_required", "instagram_public_url_required"],
    ["instagram_media_container_timeout", "instagram_media_container_timeout"]
  ])("keeps nonretryable media errors stable", (message, errorCode) => {
    expect(classifyMetaGraphPublishError(new Error(message))).toEqual({
      errorCode,
      retryable: false,
      channelNeedsAttention: false
    });
  });

  it("redacts Graph response details from thrown request errors", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: { code: 190, message: "OAuth token SECRET_TOKEN is invalid" }
    }), { status: 400 }));

    const promise = postMetaGraphForm({
      path: "/account/media",
      body: { access_token: "SECRET_TOKEN", image_url: "https://cdn.example.com/image.png" },
      fetchImpl: fetchImpl as any,
      graphVersion: "v20.0"
    });

    await expect(promise).rejects.toThrow("meta_graph_request_failed:400");
    await expect(promise).rejects.not.toThrow("SECRET_TOKEN");
  });
});
