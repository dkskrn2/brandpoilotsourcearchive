import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  buildChannelCapabilities,
  type ChannelCapability,
} from "./channelCapabilities.js";
import { createServer } from "./httpServer.js";
import type {
  ApiRepository,
  BrandContentFormatDto,
  Channel,
  ChannelDto,
  ChannelStatus,
  DeliveryFormat,
} from "./types.js";

const brandId = "11111111-1111-1111-1111-111111111111";

function channel(
  name: Channel,
  status: ChannelStatus = "not_connected",
): ChannelDto {
  return {
    channel: name,
    enabled: status === "connected",
    oauthState: status === "connected"
      ? "connected"
      : status === "not_connected"
        ? "not_connected"
        : "needs_attention",
    status,
    accountLabel: status === "not_connected" ? null : `@${name}`,
    lastHealthyAt: null,
    lastPublishedAt: null,
    lastError: null,
  };
}

function instagramFormat(
  format: BrandContentFormatDto["format"],
  capabilityStatus: BrandContentFormatDto["capabilityStatus"],
): BrandContentFormatDto {
  return {
    format,
    enabled: capabilityStatus === "available",
    rotationOrder: format === "instagram_feed_carousel" ? 1 : format === "instagram_story" ? 2 : 3,
    capabilityStatus,
    capabilityCheckedAt: null,
    capabilityMetadata: {},
    lastError: null,
  };
}

const defaultFormats = [
  instagramFormat("instagram_feed_carousel", "available"),
  instagramFormat("instagram_story", "unchecked"),
  instagramFormat("instagram_reel", "unchecked"),
];

describe("channel capability aggregate", () => {
  it("defines the single server and customer capability contract", () => {
    expectTypeOf<ChannelCapability>().toEqualTypeOf<{
      channel: "instagram" | "threads" | "x" | "linkedin" | "youtube" | "tiktok";
      catalogStatus: "available" | "planned";
      connectionStatus: ChannelStatus;
      canGenerate: boolean;
      generationFormats: Array<"card_news" | "blog" | "single_image" | "channel_text">;
      exportModes: Array<"image" | "html" | "text">;
      publishModes: DeliveryFormat[];
      readiness: "ready" | "needs_connection" | "needs_permission" | "not_supported";
      reasonCode: string | null;
    }>();
  });

  it("keeps generation and export available when Instagram is not connected", () => {
    const result = buildChannelCapabilities({
      channels: [channel("instagram")],
      instagramFormats: defaultFormats,
    });

    expect(result[0]).toEqual({
      channel: "instagram",
      catalogStatus: "available",
      connectionStatus: "not_connected",
      canGenerate: true,
      generationFormats: ["card_news", "single_image"],
      exportModes: ["image"],
      publishModes: [],
      readiness: "needs_connection",
      reasonCode: "channel_not_connected",
    });
  });

  it.each([
    ["needs_attention", "channel_needs_attention"],
    ["expired", "credential_expired"],
    ["insufficient_permissions", "missing_required_scopes"],
    ["mapping_required", "professional_account_required"],
    ["publish_failed", "publish_failed"],
  ] as const)("requires Instagram permission repair for %s", (status, reasonCode) => {
    const result = buildChannelCapabilities({
      channels: [channel("instagram", status)],
      instagramFormats: defaultFormats,
    });

    expect(result[0]).toMatchObject({
      connectionStatus: status,
      publishModes: [],
      readiness: "needs_permission",
      reasonCode,
    });
  });

  it("exposes only implemented image publishing when Instagram is ready", () => {
    const result = buildChannelCapabilities({
      channels: [channel("instagram", "connected")],
      instagramFormats: [
        instagramFormat("instagram_feed_carousel", "available"),
        instagramFormat("instagram_story", "available"),
        instagramFormat("instagram_reel", "available"),
      ],
    });

    expect(result[0]).toMatchObject({
      readiness: "ready",
      reasonCode: null,
      publishModes: [
        "instagram_feed_single",
        "instagram_feed_carousel",
        "instagram_story",
      ],
    });
    expect(result[0]?.publishModes).not.toContain("instagram_reel");
  });

  it("does not expose Story publishing before its permission check succeeds", () => {
    const result = buildChannelCapabilities({
      channels: [channel("instagram", "connected")],
      instagramFormats: defaultFormats,
    });

    expect(result[0]).toMatchObject({
      publishModes: ["instagram_feed_single", "instagram_feed_carousel"],
      readiness: "ready",
      reasonCode: null,
    });
  });

  it("separates Threads text generation and export from unsupported API publishing", () => {
    const result = buildChannelCapabilities({
      channels: [channel("threads", "connected")],
      instagramFormats: defaultFormats,
    });

    expect(result[1]).toEqual({
      channel: "threads",
      catalogStatus: "available",
      connectionStatus: "connected",
      canGenerate: true,
      generationFormats: ["channel_text"],
      exportModes: ["text"],
      publishModes: [],
      readiness: "not_supported",
      reasonCode: "provider_not_implemented",
    });
  });

  it("never promotes catalog-only adapters to supported publishing", () => {
    const result = buildChannelCapabilities({
      channels: [
        channel("x", "connected"),
        channel("linkedin", "connected"),
        channel("youtube", "connected"),
        channel("tiktok", "connected"),
      ],
      instagramFormats: defaultFormats,
    });

    expect(result.slice(2)).toEqual([
      expect.objectContaining({
        channel: "x",
        catalogStatus: "planned",
        publishModes: [],
        readiness: "not_supported",
        reasonCode: "provider_not_implemented",
      }),
      expect.objectContaining({
        channel: "linkedin",
        catalogStatus: "planned",
        publishModes: [],
        readiness: "not_supported",
        reasonCode: "provider_not_implemented",
      }),
      expect.objectContaining({
        channel: "youtube",
        canGenerate: false,
        generationFormats: [],
        publishModes: [],
        readiness: "not_supported",
        reasonCode: "video_generation_out_of_scope",
      }),
      expect.objectContaining({
        channel: "tiktok",
        canGenerate: false,
        generationFormats: [],
        publishModes: [],
        readiness: "not_supported",
        reasonCode: "video_generation_out_of_scope",
      }),
    ]);
  });
});

describe("GET /brands/:brandId/channels/capabilities", () => {
  function repository(overrides: Partial<ApiRepository> = {}) {
    return {
      listChannels: vi.fn(async () => [channel("instagram", "connected")]),
      listInstagramFormats: vi.fn(async () => ({
        brandId,
        brandColor: null,
        formats: defaultFormats,
      })),
      ...overrides,
    } as unknown as ApiRepository;
  }

  function auth(canAccessBrand = true) {
    return {
      getSession: vi.fn(async () => ({
        userId: "user-1",
        displayName: "Tester",
        email: "tester@example.com",
        workspaceId: "workspace-1",
        workspaceName: "Workspace",
        brandId,
        brandName: "Brand",
      })),
      canAccessBrand: vi.fn(async () => canAccessBrand),
    };
  }

  it("returns the tenant-scoped aggregate", async () => {
    const apiRepository = repository();
    const kakaoAuth = auth();
    const app = createServer({ repository: apiRepository, kakaoAuth: kakaoAuth as never, logger: false });

    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/channels/capabilities`,
      headers: { cookie: "bp_session=session-1" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(6);
    expect(apiRepository.listChannels).toHaveBeenCalledWith(brandId);
    expect(apiRepository.listInstagramFormats).toHaveBeenCalledWith(brandId);
    expect(kakaoAuth.canAccessBrand).toHaveBeenCalledWith("user-1", brandId);
  });

  it("requires authentication", async () => {
    const apiRepository = repository();
    const kakaoAuth = {
      ...auth(),
      getSession: vi.fn(async () => null),
    };
    const app = createServer({ repository: apiRepository, kakaoAuth: kakaoAuth as never, logger: false });

    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/channels/capabilities`,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "authentication_required" });
    expect(apiRepository.listChannels).not.toHaveBeenCalled();
  });

  it("rejects cross-brand access", async () => {
    const apiRepository = repository();
    const app = createServer({ repository: apiRepository, kakaoAuth: auth(false) as never, logger: false });

    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/channels/capabilities`,
      headers: { cookie: "bp_session=session-1" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "workspace_access_denied" });
    expect(apiRepository.listChannels).not.toHaveBeenCalled();
  });

  it("does not synthesize capabilities when repository loading fails", async () => {
    const apiRepository = repository({
      listChannels: vi.fn(async () => {
        throw new Error("database_unavailable");
      }),
    });
    const app = createServer({ repository: apiRepository, logger: false });

    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/channels/capabilities`,
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "internal_error" });
    expect(apiRepository.listInstagramFormats).not.toHaveBeenCalled();
  });
});
