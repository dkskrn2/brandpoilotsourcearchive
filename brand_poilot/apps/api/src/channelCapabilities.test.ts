import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  buildChannelCapabilities,
  isChannelGenerationReady,
  type ChannelCapability,
  type InstagramChannelCapabilityContext,
} from "./channelCapabilities.js";
import { createServer } from "./httpServer.js";
import { evaluateInstagramStoryCapability } from "./instagramCapabilities.js";
import { instagramLoginScopes } from "./instagramLoginGraph.js";
import { createRepository } from "./repository.js";
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
  enabled = status === "connected",
): ChannelDto {
  return {
    channel: name,
    enabled,
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

function instagramContext(
  overrides: Partial<InstagramChannelCapabilityContext> = {},
): InstagramChannelCapabilityContext {
  return {
    externalAccountId: "17890000000000000",
    adapterEnabled: true,
    channelStatus: "connected",
    channelLastError: null,
    credentialId: "credential-1",
    credentialProvider: "meta",
    credentialStatus: "active",
    credentialExpiresAt: "2026-08-01T00:00:00.000Z",
    hasCredentialPayload: true,
    scopes: ["instagram_business_basic", "instagram_business_content_publish"],
    now: new Date("2026-07-27T00:00:00.000Z"),
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("channel capability aggregate", () => {
  it("defines the single server and customer capability contract", () => {
    expectTypeOf<ChannelCapability>().toEqualTypeOf<{
      channel: "instagram" | "threads" | "x" | "linkedin" | "youtube" | "tiktok";
      catalogStatus: "available" | "planned";
      enabled: boolean;
      connectionStatus: ChannelStatus;
      canGenerate: boolean;
      generationFormats: Array<"card_news" | "blog" | "reel" | "single_image" | "channel_text">;
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
      instagramContext: instagramContext({ credentialId: null, credentialStatus: null, scopes: [] }),
    });

    expect(result[0]).toEqual({
      channel: "instagram",
      catalogStatus: "available",
      enabled: false,
      connectionStatus: "not_connected",
      canGenerate: true,
      generationFormats: ["card_news", "single_image", "reel"],
      exportModes: ["image"],
      publishModes: [],
      readiness: "needs_connection",
      reasonCode: "channel_not_connected",
    });
  });

  it.each([
    ["expired", "credential_expired"],
    ["insufficient_permissions", "missing_required_scopes"],
    ["mapping_required", "professional_account_required"],
  ] as const)("requires Instagram permission repair for %s", (status, reasonCode) => {
    const result = buildChannelCapabilities({
      channels: [channel("instagram", status)],
      instagramFormats: defaultFormats,
      instagramContext: instagramContext(
        status === "expired"
          ? { credentialExpiresAt: "2026-07-26T23:59:59.000Z" }
          : status === "insufficient_permissions"
            ? { scopes: ["instagram_business_basic"] }
            : status === "mapping_required"
              ? { externalAccountId: null }
              : {},
      ),
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
        {
          ...instagramFormat("instagram_story", "available"),
          capabilityMetadata: {
            scopesVerified: true,
            storyPublishVerified: true,
            verifiedCredentialId: "credential-1",
          },
        },
        instagramFormat("instagram_reel", "available"),
      ],
      instagramContext: instagramContext(),
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

  it("exposes verified Story publishing with scopes persisted by Instagram Login", () => {
    const storyCapability = evaluateInstagramStoryCapability({
      channelStatus: "connected",
      externalAccountId: "17890000000000000",
      credentialId: "credential-1",
      credentialStatus: "active",
      credentialExpiresAt: "2026-08-01T00:00:00.000Z",
      scopes: instagramLoginScopes,
      apiVersion: "v23.0",
      capabilityMetadata: {
        scopesVerified: true,
        storyPublishVerified: true,
        verifiedCredentialId: "credential-1",
      },
      now: new Date("2026-07-27T00:00:00.000Z"),
    });

    const result = buildChannelCapabilities({
      channels: [channel("instagram", "connected")],
      instagramFormats: [
        instagramFormat("instagram_feed_carousel", "available"),
        {
          ...instagramFormat("instagram_story", storyCapability.status),
          capabilityMetadata: storyCapability.metadata,
        },
        instagramFormat("instagram_reel", "unchecked"),
      ],
      instagramContext: instagramContext({ scopes: [...instagramLoginScopes] }),
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
  });

  it("does not expose Story publishing before its permission check succeeds", () => {
    const result = buildChannelCapabilities({
      channels: [channel("instagram", "connected")],
      instagramFormats: defaultFormats,
      instagramContext: instagramContext(),
    });

    expect(result[0]).toMatchObject({
      publishModes: ["instagram_feed_single", "instagram_feed_carousel"],
      readiness: "ready",
      reasonCode: null,
    });
  });

  it("keeps generation and export but disables publishing when the runtime adapter is off", () => {
    const result = buildChannelCapabilities({
      channels: [channel("instagram", "connected")],
      instagramFormats: defaultFormats,
      instagramContext: instagramContext({ adapterEnabled: false }),
    });

    expect(result[0]).toEqual({
      channel: "instagram",
      catalogStatus: "available",
      enabled: true,
      connectionStatus: "connected",
      canGenerate: true,
      generationFormats: ["card_news", "single_image", "reel"],
      exportModes: ["image"],
      publishModes: [],
      readiness: "not_supported",
      reasonCode: "publishing_disabled",
    });
  });

  it("separates Threads text generation and export from unsupported API publishing", () => {
    const result = buildChannelCapabilities({
      channels: [channel("threads", "connected")],
      instagramFormats: defaultFormats,
      instagramContext: instagramContext(),
    });

    expect(result[1]).toEqual({
      channel: "threads",
      catalogStatus: "available",
      enabled: true,
      connectionStatus: "connected",
      canGenerate: true,
      generationFormats: ["channel_text"],
      exportModes: ["text"],
      publishModes: [],
      readiness: "not_supported",
      reasonCode: "provider_not_implemented",
    });
  });

  it("requires enabled, connected, ready, implemented, available, and format-compatible state for generation", () => {
    const enabled = buildChannelCapabilities({
      channels: [channel("instagram", "connected", true)],
      instagramFormats: defaultFormats,
      instagramContext: instagramContext(),
    })[0]!;
    const disabled = buildChannelCapabilities({
      channels: [channel("instagram", "connected", false)],
      instagramFormats: defaultFormats,
      instagramContext: instagramContext(),
    })[0]!;
    const disconnected = buildChannelCapabilities({
      channels: [channel("instagram", "not_connected", true)],
      instagramFormats: defaultFormats,
      instagramContext: instagramContext({
        channelStatus: "not_connected",
        credentialId: null,
        credentialStatus: null,
        scopes: [],
      }),
    })[0]!;
    const planned = buildChannelCapabilities({
      channels: [channel("x", "connected", true)],
      instagramFormats: defaultFormats,
      instagramContext: instagramContext(),
    })[2]!;

    expect(enabled.enabled).toBe(true);
    expect(isChannelGenerationReady(enabled, "card_news")).toBe(true);
    expect(isChannelGenerationReady(enabled, "blog")).toBe(false);
    expect(disabled).toMatchObject({ enabled: false, connectionStatus: "connected" });
    expect(isChannelGenerationReady(disabled, "card_news")).toBe(false);
    expect(isChannelGenerationReady(disconnected, "card_news")).toBe(false);
    expect(isChannelGenerationReady(planned, "channel_text")).toBe(false);
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
      instagramContext: instagramContext(),
    });

    expect(result.slice(2)).toEqual([
      expect.objectContaining({
        channel: "x",
        catalogStatus: "planned",
        connectionStatus: "not_connected",
        publishModes: [],
        readiness: "not_supported",
        reasonCode: "provider_not_implemented",
      }),
      expect.objectContaining({
        channel: "linkedin",
        catalogStatus: "planned",
        connectionStatus: "not_connected",
        publishModes: [],
        readiness: "not_supported",
        reasonCode: "provider_not_implemented",
      }),
      expect.objectContaining({
        channel: "youtube",
        connectionStatus: "not_connected",
        canGenerate: false,
        generationFormats: [],
        publishModes: [],
        readiness: "not_supported",
        reasonCode: "video_generation_out_of_scope",
      }),
      expect.objectContaining({
        channel: "tiktok",
        connectionStatus: "not_connected",
        canGenerate: false,
        generationFormats: [],
        publishModes: [],
        readiness: "not_supported",
        reasonCode: "video_generation_out_of_scope",
      }),
    ]);
  });

  it.each([
    {
      name: "the professional account mapping is missing",
      context: instagramContext({ externalAccountId: null }),
      reasonCode: "professional_account_required",
    },
    {
      name: "the required content publish scope is missing",
      context: instagramContext({ scopes: ["instagram_business_basic"] }),
      reasonCode: "missing_required_scopes",
    },
    {
      name: "the active token has naturally expired",
      context: instagramContext({ credentialExpiresAt: "2026-07-27T00:00:00.000Z" }),
      reasonCode: "credential_expired",
    },
    {
      name: "the credential provider is not the implemented Meta adapter",
      context: instagramContext({ credentialProvider: "other" }),
      reasonCode: "provider_not_supported",
    },
  ])("derives Instagram readiness from authoritative state when $name", ({ context, reasonCode }) => {
    const result = buildChannelCapabilities({
      channels: [channel("instagram", "connected")],
      instagramFormats: defaultFormats,
      instagramContext: context,
    });

    expect(result[0]).toMatchObject({
      publishModes: [],
      readiness: "needs_permission",
      reasonCode,
    });
  });

  it("requires provider-verified Story permission before exposing static Story publish", () => {
    const result = buildChannelCapabilities({
      channels: [channel("instagram", "connected")],
      instagramFormats: [
        instagramFormat("instagram_feed_carousel", "available"),
        {
          ...instagramFormat("instagram_story", "available"),
          capabilityMetadata: {
            scopesVerified: true,
            storyPublishVerified: true,
            verifiedCredentialId: "another-credential",
          },
        },
        instagramFormat("instagram_reel", "unchecked"),
      ],
      instagramContext: instagramContext(),
    });

    expect(result[0]?.publishModes).toEqual([
      "instagram_feed_single",
      "instagram_feed_carousel",
    ]);
  });

  it.each([
    ["meta_token_invalid", "meta_token_invalid"],
    ["meta_permission_denied", "meta_permission_denied"],
  ] as const)("blocks a current provider failure recorded as %s", (lastError, reasonCode) => {
    const result = buildChannelCapabilities({
      channels: [channel("instagram", "needs_attention")],
      instagramFormats: defaultFormats,
      instagramContext: instagramContext({
        channelStatus: "needs_attention",
        channelLastError: lastError,
      }),
    });

    expect(result[0]).toMatchObject({
      connectionStatus: "needs_attention",
      publishModes: [],
      readiness: "needs_permission",
      reasonCode,
    });
  });

  it("does not let a stale error block a newly connected current channel record", () => {
    const result = buildChannelCapabilities({
      channels: [channel("instagram", "connected")],
      instagramFormats: defaultFormats,
      instagramContext: instagramContext({
        channelStatus: "connected",
        channelLastError: "meta_token_invalid",
      }),
    });

    expect(result[0]).toMatchObject({
      connectionStatus: "connected",
      readiness: "ready",
      reasonCode: null,
    });
  });
});

describe("authoritative Instagram capability repository context", () => {
  it("loads account mapping, provider, scopes, token status, and natural expiry data", async () => {
    const query = vi.fn(async () => ({
      rowCount: 1,
      rows: [{
        channel_status: "connected",
        channel_last_error: null,
        external_account_id: "17890000000000000",
        credential_id: "credential-1",
        credential_provider: "meta",
        credential_status: "active",
        credential_expires_at: new Date("2026-08-01T00:00:00.000Z"),
        has_credential_payload: true,
        scopes: ["instagram_business_basic", "instagram_business_content_publish"],
      }],
    }));
    vi.stubEnv("INSTAGRAM_PUBLISH_ENABLED", "true");
    const repository = createRepository(
      { query } as unknown as Pool,
      { instagramPublish: { enabled: false } },
    );

    await expect(repository.getInstagramChannelCapabilityContext(brandId)).resolves.toEqual({
      externalAccountId: "17890000000000000",
      adapterEnabled: false,
      channelStatus: "connected",
      channelLastError: null,
      credentialId: "credential-1",
      credentialProvider: "meta",
      credentialStatus: "active",
      credentialExpiresAt: "2026-08-01T00:00:00.000Z",
      hasCredentialPayload: true,
      scopes: ["instagram_business_basic", "instagram_business_content_publish"],
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("external_account_id"),
      [brandId],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("channel_credentials"),
      [brandId],
    );
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
      getInstagramChannelCapabilityContext: vi.fn(async () => instagramContext()),
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
    expect(apiRepository.getInstagramChannelCapabilityContext).toHaveBeenCalledWith(brandId);
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
