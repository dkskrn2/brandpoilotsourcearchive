import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  channelCatalog,
  type ChannelGenerationFormat,
  type OAuthProvider,
} from "./channelCatalog.js";
import { createServer } from "./httpServer.js";
import { createPublishAdapterRegistry } from "./publishAdapters.js";
import { createRepository } from "./repository.js";
import type { ApiRepository, Channel, ChannelDto } from "./types.js";

const brandId = "11111111-1111-1111-1111-111111111111";

function channelDto(channel: ChannelDto["channel"], enabled: boolean): ChannelDto {
  return {
    channel,
    enabled,
    oauthState: "not_connected",
    status: "not_connected",
    accountLabel: null,
    lastHealthyAt: null,
    lastPublishedAt: null,
    lastError: null
  };
}

describe("channel catalog", () => {
  it("defines all channels in stable display order with generation and OAuth metadata", () => {
    expect(channelCatalog.map((entry) => entry.channel)).toEqual([
      "instagram",
      "threads",
      "x",
      "linkedin",
      "youtube",
      "tiktok"
    ]);
    expect(channelCatalog.map((entry) => entry.displayOrder)).toEqual([1, 2, 3, 4, 5, 6]);
    expectTypeOf<Channel>().toEqualTypeOf<
      "instagram" | "threads" | "x" | "linkedin" | "youtube" | "tiktok"
    >();
    expectTypeOf<OAuthProvider>().toEqualTypeOf<"meta" | "x" | "linkedin" | "google" | "tiktok">();
    expect(channelCatalog).toEqual(expect.arrayContaining([
      expect.objectContaining({
        channel: "linkedin",
        label: { ko: "링크드인", en: "LinkedIn" },
        defaultDeliveryFormat: "linkedin_post",
        artifactKind: "text",
        oauth: expect.objectContaining({ provider: "linkedin", credentialType: "oauth" })
      }),
      expect.objectContaining({
        channel: "youtube",
        defaultDeliveryFormat: "youtube_short",
        artifactKind: "video",
        oauth: expect.objectContaining({ provider: "google", credentialType: "oauth" })
      })
    ]));
  });

  it("marks only channels with an implemented generation worker as ready", () => {
    expect(channelCatalog.filter((entry) => entry.generationReady).map((entry) => entry.channel)).toEqual([
      "instagram",
      "threads"
    ]);
  });

  it("publishes only active Instagram generation formats and excludes retired marketing_content", () => {
    const instagram = channelCatalog.find((entry) => entry.channel === "instagram");
    const v2Formats = new Set<ChannelGenerationFormat>([
      "card_news",
      "blog",
      "reel",
    ]);

    expect(instagram?.generationFormats).toEqual([
      "card_news",
      "single_image",
      "reel",
    ]);
    expect(instagram?.generationFormats.filter((format) => v2Formats.has(format))).toEqual([
      "card_news",
      "reel",
    ]);
    expect(instagram?.generationFormats).not.toContain("marketing_content");
    expect(channelCatalog.some((entry) =>
      (["blog", "blog_export"] as string[]).includes(entry.channel)
    )).toBe(false);
  });

  it("keeps Threads and planned remote channels at their existing availability", () => {
    expect(channelCatalog.find((entry) => entry.channel === "threads")).toMatchObject({
      catalogStatus: "available",
      generationReady: true,
      generationFormats: ["channel_text"],
    });
    expect(channelCatalog.filter((entry) => entry.catalogStatus === "planned").map((entry) => ({
      channel: entry.channel,
      generationReady: entry.generationReady,
      generationFormats: entry.generationFormats,
    }))).toEqual([
      { channel: "x", generationReady: false, generationFormats: [] },
      { channel: "linkedin", generationReady: false, generationFormats: [] },
      { channel: "youtube", generationReady: false, generationFormats: [] },
      { channel: "tiktok", generationReady: false, generationFormats: [] },
    ]);
  });

  it.each(["threads", "x", "linkedin", "youtube", "tiktok"] as const)(
    "does not treat %s catalog presence as implemented API publishing",
    async (channel) => {
      const registry = createPublishAdapterRegistry({ publishInstagram: vi.fn() });

      await expect(registry[channel].publish({
        channel,
        credentialState: "connected",
        queueId: "queue-1",
        outputJson: {}
      })).resolves.toEqual({
        status: "blocked",
        errorCode: "provider_not_implemented",
        retryable: false
      });
    }
  );
});

describe("channel repository", () => {
  it("returns all catalog channels in stable order and derives OAuth state from credentials", async () => {
    const query = vi.fn<(sql: string, params?: unknown[]) => Promise<{ rowCount: number; rows: any[] }>>(async () => ({
      rowCount: 2,
      rows: [
        {
          channel: "youtube",
          enabled: true,
          status: "connected",
          has_active_credentials: false,
          account_label: "Brand TV",
          last_healthy_at: null,
          last_published_at: null,
          last_error: null
        },
        {
          channel: "instagram",
          enabled: true,
          status: "connected",
          has_active_credentials: true,
          account_label: "@brand",
          last_healthy_at: null,
          last_published_at: null,
          last_error: null
        }
      ]
    }));
    const repository = createRepository({ query } as unknown as Pool);

    const channels = await repository.listChannels(brandId);

    expect(channels.map((item) => item.channel)).toEqual([
      "instagram",
      "threads",
      "x",
      "linkedin",
      "youtube",
      "tiktok"
    ]);
    expect(channels[0]).toMatchObject({ enabled: true, oauthState: "connected" });
    expect(channels[4]).toMatchObject({
      enabled: false,
      oauthState: "not_connected",
      status: "not_connected"
    });
    expect(channels[3]).toMatchObject({ enabled: false, oauthState: "not_connected" });
  });

  it("updates only channel activation", async () => {
    const query = vi.fn<(sql: string, params?: unknown[]) => Promise<{ rowCount: number; rows: any[] }>>(async () => ({
      rowCount: 1,
      rows: [{
        channel: "linkedin",
        enabled: true,
        status: "not_connected",
        has_active_credentials: false,
        account_label: null,
        last_healthy_at: null,
        last_published_at: null,
        last_error: null
      }]
    }));
    const repository = createRepository({ query } as unknown as Pool);

    await repository.updateChannelEnabled(brandId, "linkedin", true);

    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0]?.[0])).toContain("set enabled = $3");
    expect(String(query.mock.calls[0]?.[0])).not.toContain("set status =");
    expect(query.mock.calls[0]?.[1]).toEqual([brandId, "linkedin", true]);
  });

  it("does not mark an uncredentialed channel connected during a health check", async () => {
    const query = vi.fn<(sql: string, params?: unknown[]) => Promise<{ rowCount: number; rows: any[] }>>(async () => ({
      rowCount: 1,
      rows: [{
        channel: "linkedin",
        enabled: true,
        status: "not_connected",
        has_active_credentials: false,
        account_label: null,
        last_healthy_at: null,
        last_published_at: null,
        last_error: null
      }]
    }));
    const repository = createRepository({ query } as unknown as Pool);

    const result = await repository.checkChannel(brandId, "linkedin");

    expect(result).toMatchObject({ status: "not_connected", oauthState: "not_connected" });
    expect(String(query.mock.calls[0]?.[0])).toContain("channel_credentials");
  });
});

describe("PATCH channel activation", () => {
  it("updates activation for a catalog channel", async () => {
    const updateChannelEnabled = vi.fn(async (_brandId, channel, enabled) => channelDto(channel, enabled));
    const repository = { updateChannelEnabled } as unknown as ApiRepository;
    const app = createServer({ repository });

    const response = await app.inject({
      method: "PATCH",
      url: `/brands/${brandId}/channels/linkedin`,
      payload: { enabled: true }
    });

    expect(response.statusCode).toBe(200);
    expect(updateChannelEnabled).toHaveBeenCalledWith(brandId, "linkedin", true);
  });

  it.each([
    [{ enabled: "yes" }, "invalid_channel_enabled"],
    [{}, "invalid_channel_enabled"],
    [{ enabled: true, status: "connected" }, "invalid_channel_activation_body"]
  ])("rejects an invalid activation body", async (payload, error) => {
    const updateChannelEnabled = vi.fn();
    const repository = { updateChannelEnabled } as unknown as ApiRepository;
    const app = createServer({ repository });

    const response = await app.inject({
      method: "PATCH",
      url: `/brands/${brandId}/channels/linkedin`,
      payload
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error });
    expect(updateChannelEnabled).not.toHaveBeenCalled();
  });
});
