import type { Channel, DeliveryFormat } from "./types.js";

export type ChannelArtifactKind = "text" | "image" | "video";
export type OAuthProvider = "meta" | "x" | "linkedin" | "google" | "tiktok";
export type ChannelGenerationFormat =
  | "card_news"
  | "blog"
  | "reel"
  | "marketing_content"
  | "single_image"
  | "channel_text";
export type ChannelExportMode = "image" | "html" | "text";

export interface ChannelCatalogEntry {
  channel: Channel;
  label: { ko: string; en: string };
  catalogStatus: "available" | "planned";
  defaultDeliveryFormat: DeliveryFormat;
  artifactKind: ChannelArtifactKind;
  oauth: {
    provider: OAuthProvider;
    credentialType: "oauth";
  };
  generationConstraints: Readonly<Record<string, string | number>>;
  generationReady: boolean;
  generationFormats: readonly ChannelGenerationFormat[];
  exportModes: readonly ChannelExportMode[];
  displayOrder: number;
}

export const channelCatalog = [
  {
    channel: "instagram",
    label: { ko: "인스타그램", en: "Instagram" },
    catalogStatus: "available",
    defaultDeliveryFormat: "instagram_feed_carousel",
    artifactKind: "image",
    oauth: { provider: "meta", credentialType: "oauth" },
    generationConstraints: { maxAssetCount: 5, aspectRatio: "1:1" },
    generationReady: true,
    generationFormats: ["card_news", "single_image", "reel", "marketing_content"],
    exportModes: ["image"],
    displayOrder: 1
  },
  {
    channel: "threads",
    label: { ko: "스레드", en: "Threads" },
    catalogStatus: "available",
    defaultDeliveryFormat: "threads_text",
    artifactKind: "text",
    oauth: { provider: "meta", credentialType: "oauth" },
    generationConstraints: { maxCharacters: 500 },
    generationReady: true,
    generationFormats: ["channel_text"],
    exportModes: ["text"],
    displayOrder: 2
  },
  {
    channel: "x",
    label: { ko: "X", en: "X" },
    catalogStatus: "planned",
    defaultDeliveryFormat: "x_post",
    artifactKind: "text",
    oauth: { provider: "x", credentialType: "oauth" },
    generationConstraints: { maxCharacters: 280 },
    generationReady: false,
    generationFormats: [],
    exportModes: ["text"],
    displayOrder: 3
  },
  {
    channel: "linkedin",
    label: { ko: "링크드인", en: "LinkedIn" },
    catalogStatus: "planned",
    defaultDeliveryFormat: "linkedin_post",
    artifactKind: "text",
    oauth: { provider: "linkedin", credentialType: "oauth" },
    generationConstraints: { maxCharacters: 3000 },
    generationReady: false,
    generationFormats: [],
    exportModes: ["text"],
    displayOrder: 4
  },
  {
    channel: "youtube",
    label: { ko: "유튜브", en: "YouTube" },
    catalogStatus: "planned",
    defaultDeliveryFormat: "youtube_short",
    artifactKind: "video",
    oauth: { provider: "google", credentialType: "oauth" },
    generationConstraints: { aspectRatio: "9:16", maxDurationSeconds: 180 },
    generationReady: false,
    generationFormats: [],
    exportModes: [],
    displayOrder: 5
  },
  {
    channel: "tiktok",
    label: { ko: "틱톡", en: "TikTok" },
    catalogStatus: "planned",
    defaultDeliveryFormat: "tiktok_video",
    artifactKind: "video",
    oauth: { provider: "tiktok", credentialType: "oauth" },
    generationConstraints: { aspectRatio: "9:16", maxDurationSeconds: 180 },
    generationReady: false,
    generationFormats: [],
    exportModes: [],
    displayOrder: 6
  }
] as const satisfies readonly ChannelCatalogEntry[];

export const channelNames = channelCatalog.map((entry) => entry.channel) as readonly Channel[];
