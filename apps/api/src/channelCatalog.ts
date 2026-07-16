import type { Channel, DeliveryFormat } from "./types.js";

export type ChannelArtifactKind = "text" | "image" | "video";
export type OAuthProvider = "meta" | "x" | "linkedin" | "google" | "tiktok";

export interface ChannelCatalogEntry {
  channel: Channel;
  label: { ko: string; en: string };
  defaultDeliveryFormat: DeliveryFormat;
  artifactKind: ChannelArtifactKind;
  oauth: {
    provider: OAuthProvider;
    credentialType: "oauth";
  };
  generationConstraints: Readonly<Record<string, string | number>>;
  generationReady: boolean;
  displayOrder: number;
}

export const channelCatalog = [
  {
    channel: "instagram",
    label: { ko: "인스타그램", en: "Instagram" },
    defaultDeliveryFormat: "instagram_feed_carousel",
    artifactKind: "image",
    oauth: { provider: "meta", credentialType: "oauth" },
    generationConstraints: { maxAssetCount: 5, squareWidth: 1080, squareHeight: 1080 },
    generationReady: true,
    displayOrder: 1
  },
  {
    channel: "threads",
    label: { ko: "스레드", en: "Threads" },
    defaultDeliveryFormat: "threads_text",
    artifactKind: "text",
    oauth: { provider: "meta", credentialType: "oauth" },
    generationConstraints: { maxCharacters: 500 },
    generationReady: true,
    displayOrder: 2
  },
  {
    channel: "x",
    label: { ko: "X", en: "X" },
    defaultDeliveryFormat: "x_post",
    artifactKind: "text",
    oauth: { provider: "x", credentialType: "oauth" },
    generationConstraints: { maxCharacters: 280 },
    generationReady: false,
    displayOrder: 3
  },
  {
    channel: "linkedin",
    label: { ko: "링크드인", en: "LinkedIn" },
    defaultDeliveryFormat: "linkedin_post",
    artifactKind: "text",
    oauth: { provider: "linkedin", credentialType: "oauth" },
    generationConstraints: { maxCharacters: 3000 },
    generationReady: false,
    displayOrder: 4
  },
  {
    channel: "youtube",
    label: { ko: "유튜브", en: "YouTube" },
    defaultDeliveryFormat: "youtube_short",
    artifactKind: "video",
    oauth: { provider: "google", credentialType: "oauth" },
    generationConstraints: { aspectRatio: "9:16", maxDurationSeconds: 180 },
    generationReady: false,
    displayOrder: 5
  },
  {
    channel: "tiktok",
    label: { ko: "틱톡", en: "TikTok" },
    defaultDeliveryFormat: "tiktok_video",
    artifactKind: "video",
    oauth: { provider: "tiktok", credentialType: "oauth" },
    generationConstraints: { aspectRatio: "9:16", maxDurationSeconds: 180 },
    generationReady: false,
    displayOrder: 6
  }
] as const satisfies readonly ChannelCatalogEntry[];

export const channelNames = channelCatalog.map((entry) => entry.channel) as readonly Channel[];
