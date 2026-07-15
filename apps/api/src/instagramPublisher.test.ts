import { describe, expect, it, vi } from "vitest";
import { publishInstagramCarouselWithMeta, publishInstagramOutput } from "./instagramPublisher";

describe("instagramPublisher", () => {
  it("publishes generated card images as an Instagram carousel", async () => {
    const requests: Array<{ url: string; body: Record<string, string> }> = [];
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init || init.method === "GET") {
        return new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const body = Object.fromEntries(new URLSearchParams(String(init?.body)));
      requests.push({ url, body });
      const responseId = `media-${requests.length}`;
      return new Response(JSON.stringify({ id: responseId }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const result = await publishInstagramCarouselWithMeta({
      accessToken: "meta-token",
      instagramBusinessAccountId: "17890000000000000",
      imageUrls: ["https://cdn.example.com/slide-1.png", "https://cdn.example.com/slide-2.png"],
      caption: "제주 가족여행 숙소 선택법",
      fetchImpl: fetchSpy as any
    });

    expect(fetchSpy).toHaveBeenCalledTimes(7);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://graph.facebook.com/v20.0/media-1?fields=status_code&access_token=meta-token",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://graph.facebook.com/v20.0/media-2?fields=status_code&access_token=meta-token",
      expect.objectContaining({ method: "GET" })
    );
    expect(requests[0]).toMatchObject({
      url: "https://graph.facebook.com/v20.0/17890000000000000/media",
      body: {
        image_url: "https://cdn.example.com/slide-1.png",
        is_carousel_item: "true",
        access_token: "meta-token"
      }
    });
    expect(requests[2].body).toMatchObject({
      media_type: "CAROUSEL",
      children: "media-1,media-2",
      caption: "제주 가족여행 숙소 선택법"
    });
    expect(requests[3]).toMatchObject({
      url: "https://graph.facebook.com/v20.0/17890000000000000/media_publish",
      body: {
        creation_id: "media-3",
        access_token: "meta-token"
      }
    });
    expect(result).toEqual({ externalPostId: "media-4", publishedUrl: null });
  });

  it("waits until Meta media containers finish processing before publishing", async () => {
    const statusByContainer = new Map<string, string[]>([
      ["media-1", ["IN_PROGRESS", "FINISHED"]],
      ["media-2", ["FINISHED"]],
      ["media-3", ["IN_PROGRESS", "IN_PROGRESS", "FINISHED"]]
    ]);
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init || init.method === "GET") {
        const containerId = String(url).match(/\/v20\.0\/([^?]+)/)?.[1] ?? "";
        const statuses = statusByContainer.get(containerId) ?? ["FINISHED"];
        const status = statuses.shift() ?? "FINISHED";
        return new Response(JSON.stringify({ status_code: status }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const body = Object.fromEntries(new URLSearchParams(String(init?.body)));
      const id = body.media_type === "CAROUSEL"
        ? "media-3"
        : String(url).endsWith("/media_publish")
          ? "published-1"
          : body.image_url?.includes("slide-1")
            ? "media-1"
            : "media-2";
      return new Response(JSON.stringify({ id }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const result = await publishInstagramCarouselWithMeta({
      accessToken: "meta-token",
      instagramBusinessAccountId: "17890000000000000",
      imageUrls: ["https://cdn.example.com/slide-1.png", "https://cdn.example.com/slide-2.png"],
      caption: "제주 가족여행 숙소 선택법",
      fetchImpl: fetchSpy as any,
      statusPollIntervalMs: 1
    });

    expect(result.externalPostId).toBe("published-1");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://graph.facebook.com/v20.0/media-3?fields=status_code&access_token=meta-token",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("uses a five-minute default polling window for Meta media processing", async () => {
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init || init.method === "GET") {
        return new Response(JSON.stringify({ status_code: "IN_PROGRESS" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ id: "media-1" }), { status: 200, headers: { "content-type": "application/json" } });
    });

    await expect(publishInstagramCarouselWithMeta({
      accessToken: "meta-token",
      instagramBusinessAccountId: "17890000000000000",
      imageUrls: ["https://cdn.example.com/slide-1.png"],
      caption: "제주 가족여행 숙소 선택법",
      fetchImpl: fetchSpy as any,
      statusPollIntervalMs: 1
    })).rejects.toThrow("instagram_media_container_timeout");

    const statusCalls = fetchSpy.mock.calls.filter((call) => String(call[0]).includes("fields=status_code"));
    expect(statusCalls).toHaveLength(60);
  });

  it("requires a stored Story capability verified for the active credential", async () => {
    const fetchImpl = vi.fn();

    await expect(publishInstagramOutput({
      deliveryFormat: "instagram_story",
      accessToken: "meta-token",
      instagramBusinessAccountId: "17890000000000000",
      imageUrl: "https://cdn.example.com/story.png",
      storyCapability: {
        capabilityStatus: "available",
        capabilityMetadata: {
          scopesVerified: true,
          storyPublishVerified: true,
          verifiedCredentialId: "credential-old"
        },
        credentialId: "credential-current"
      }
    }, { fetchImpl: fetchImpl as any })).rejects.toThrow("story_capability_required");

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("creates and publishes a Story container after stored capability verification", async () => {
    const requests: Array<{ url: string; body: Record<string, string> }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "GET") {
        return new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 });
      }
      const body = Object.fromEntries(new URLSearchParams(String(init?.body)));
      requests.push({ url, body });
      return new Response(JSON.stringify({ id: requests.length === 1 ? "story-container" : "story-post" }), { status: 200 });
    });

    await expect(publishInstagramOutput({
      deliveryFormat: "instagram_story",
      accessToken: "meta-token",
      instagramBusinessAccountId: "17890000000000000",
      imageUrl: "https://cdn.example.com/story.png",
      storyCapability: {
        capabilityStatus: "available",
        capabilityMetadata: {
          scopesVerified: true,
          storyPublishVerified: true,
          verifiedCredentialId: "credential-current"
        },
        credentialId: "credential-current"
      }
    }, { fetchImpl: fetchImpl as any })).resolves.toEqual({ externalPostId: "story-post", publishedUrl: null });

    expect(requests[0]?.body).toMatchObject({
      media_type: "STORIES",
      image_url: "https://cdn.example.com/story.png"
    });
    expect(requests[1]?.url).toContain("/media_publish");
  });

  it("publishes a FINISHED Reel without sharing it to the feed", async () => {
    const requests: Array<{ url: string; body: Record<string, string> }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "GET") {
        return new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 });
      }
      const body = Object.fromEntries(new URLSearchParams(String(init?.body)));
      requests.push({ url, body });
      return new Response(JSON.stringify({ id: requests.length === 1 ? "reel-container" : "reel-post" }), { status: 200 });
    });

    await expect(publishInstagramOutput({
      deliveryFormat: "instagram_reel",
      accessToken: "meta-token",
      instagramBusinessAccountId: "17890000000000000",
      videoUrl: "https://cdn.example.com/reel.mp4",
      caption: "Reel caption"
    }, { fetchImpl: fetchImpl as any })).resolves.toEqual({ externalPostId: "reel-post", publishedUrl: null });

    expect(requests[0]?.body).toMatchObject({
      media_type: "REELS",
      video_url: "https://cdn.example.com/reel.mp4",
      caption: "Reel caption",
      share_to_feed: "true"
    });
    expect(requests[1]?.url).toContain("/media_publish");
  });

  it.each(["ERROR", "EXPIRED"])("does not publish a Reel container in %s status", async (statusCode) => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "GET") {
        return new Response(JSON.stringify({ status_code: statusCode }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "reel-container" }), { status: 200 });
    });

    await expect(publishInstagramOutput({
      deliveryFormat: "instagram_reel",
      accessToken: "meta-token",
      instagramBusinessAccountId: "17890000000000000",
      videoUrl: "https://cdn.example.com/reel.mp4",
      caption: "Reel caption"
    }, { fetchImpl: fetchImpl as any, statusPollAttempts: 2, statusPollIntervalMs: 1 }))
      .rejects.toThrow(`instagram_media_container_${statusCode.toLowerCase()}`);

    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes("/media_publish"))).toBe(false);
  });

  it("does not publish a Reel container after the polling timeout", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "GET") {
        return new Response(JSON.stringify({ status_code: "IN_PROGRESS" }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "reel-container" }), { status: 200 });
    });

    await expect(publishInstagramOutput({
      deliveryFormat: "instagram_reel",
      accessToken: "meta-token",
      instagramBusinessAccountId: "17890000000000000",
      videoUrl: "https://cdn.example.com/reel.mp4",
      caption: "Reel caption"
    }, {
      fetchImpl: fetchImpl as any,
      statusPollAttempts: 2,
      statusPollIntervalMs: 1,
      sleep
    })).rejects.toThrow("instagram_media_container_timeout");

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes("/media_publish"))).toBe(false);
  });
});
