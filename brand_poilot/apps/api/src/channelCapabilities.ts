import {
  channelCatalog,
  type ChannelExportMode,
  type ChannelGenerationFormat,
} from "./channelCatalog.js";
import { evaluateInstagramChannelReadiness } from "./instagramCapabilities.js";
import type {
  BrandContentFormatDto,
  ChannelDto,
  ChannelStatus,
  DeliveryFormat,
} from "./types.js";

export interface ChannelCapability {
  channel: "instagram" | "threads" | "x" | "linkedin" | "youtube" | "tiktok";
  catalogStatus: "available" | "planned";
  connectionStatus: ChannelStatus;
  canGenerate: boolean;
  generationFormats: ChannelGenerationFormat[];
  exportModes: ChannelExportMode[];
  publishModes: DeliveryFormat[];
  readiness: "ready" | "needs_connection" | "needs_permission" | "not_supported";
  reasonCode: string | null;
}

export interface InstagramChannelCapabilityContext {
  adapterEnabled: boolean;
  externalAccountId: string | null;
  credentialId: string | null;
  credentialProvider: string | null;
  credentialStatus: string | null;
  credentialExpiresAt: Date | string | null;
  scopes: string[];
  now?: Date;
}

interface BuildChannelCapabilitiesInput {
  channels: readonly ChannelDto[];
  instagramFormats: readonly BrandContentFormatDto[];
  instagramContext: InstagramChannelCapabilityContext;
}

function missingChannel(channel: ChannelCapability["channel"]): ChannelDto {
  return {
    channel,
    enabled: false,
    oauthState: "not_connected",
    status: "not_connected",
    accountLabel: null,
    lastHealthyAt: null,
    lastPublishedAt: null,
    lastError: null,
  };
}

export function buildChannelCapabilities(
  input: BuildChannelCapabilitiesInput,
): ChannelCapability[] {
  const channelsByName = new Map(input.channels.map((item) => [item.channel, item]));
  const storyAvailable = input.instagramFormats.some(
    (item) => item.format === "instagram_story"
      && item.capabilityStatus === "available"
      && item.capabilityMetadata.scopesVerified === true
      && item.capabilityMetadata.storyPublishVerified === true
      && item.capabilityMetadata.verifiedCredentialId === input.instagramContext.credentialId,
  );

  return channelCatalog.map((catalog) => {
    const connection = channelsByName.get(catalog.channel) ?? missingChannel(catalog.channel);
    const adapterUnsupported = catalog.channel === "x"
      || catalog.channel === "linkedin"
      || catalog.channel === "youtube"
      || catalog.channel === "tiktok";
    const base = {
      channel: catalog.channel,
      catalogStatus: catalog.catalogStatus,
      connectionStatus: adapterUnsupported ? "not_connected" as const : connection.status,
      canGenerate: catalog.generationReady,
      generationFormats: [...catalog.generationFormats],
      exportModes: [...catalog.exportModes],
    };

    if (catalog.channel === "instagram") {
      const state = evaluateInstagramChannelReadiness(input.instagramContext);
      const publishModes: DeliveryFormat[] = state.readiness === "ready"
        ? [
          "instagram_feed_single",
          "instagram_feed_carousel",
          ...(storyAvailable ? ["instagram_story" as const] : []),
        ]
        : [];
      return { ...base, publishModes, ...state };
    }

    const videoGenerationOutOfScope = catalog.channel === "youtube" || catalog.channel === "tiktok";
    return {
      ...base,
      publishModes: [],
      readiness: "not_supported" as const,
      reasonCode: videoGenerationOutOfScope
        ? "video_generation_out_of_scope"
        : "provider_not_implemented",
    };
  });
}
