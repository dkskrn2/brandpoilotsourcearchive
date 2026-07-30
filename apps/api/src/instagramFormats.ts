export const instagramFormats = [
  "instagram_feed_carousel",
  "instagram_story",
  "instagram_reel"
] as const;

export type InstagramDeliveryFormat = (typeof instagramFormats)[number];

export type DeliveryFormat =
  | InstagramDeliveryFormat
  | "threads_text"
  | "tiktok_video"
  | "youtube_video"
  | "youtube_short"
  | "x_post"
  | "linkedin_post";

const renderJobTypes = {
  instagram_feed_carousel: "instagram_feed_render",
  instagram_story: "instagram_story_render",
  instagram_reel: "instagram_reel_render"
} as const satisfies Record<InstagramDeliveryFormat, string>;

export type InstagramRenderJobType = (typeof renderJobTypes)[InstagramDeliveryFormat];

const deliveryFormatsByRenderJobType = {
  instagram_feed_render: "instagram_feed_carousel",
  instagram_story_render: "instagram_story",
  instagram_reel_render: "instagram_reel"
} as const satisfies Record<InstagramRenderJobType, InstagramDeliveryFormat>;

export const instagramPromptVersions = {
  instagram_feed_carousel: "worker-card.v4",
  instagram_story: "worker-story.v1",
  instagram_reel: "worker-reel.v3"
} as const satisfies Record<InstagramDeliveryFormat, string>;

export type InstagramPromptVersion = (typeof instagramPromptVersions)[InstagramDeliveryFormat];

export function deliveryFormatToRenderJobType(
  deliveryFormat: InstagramDeliveryFormat
): InstagramRenderJobType {
  return renderJobTypes[deliveryFormat];
}

export function renderJobTypeToDeliveryFormat(
  jobType: InstagramRenderJobType
): InstagramDeliveryFormat {
  return deliveryFormatsByRenderJobType[jobType];
}

export function deliveryFormatToPromptVersion(
  deliveryFormat: InstagramDeliveryFormat
): InstagramPromptVersion {
  return instagramPromptVersions[deliveryFormat];
}

export function chooseNextInstagramFormat(
  enabled: readonly InstagramDeliveryFormat[],
  lastSelected: InstagramDeliveryFormat | null
): InstagramDeliveryFormat | null {
  const enabledFormats = new Set(enabled);
  if (enabledFormats.size === 0) return null;

  const startIndex = lastSelected === null
    ? 0
    : (instagramFormats.indexOf(lastSelected) + 1) % instagramFormats.length;

  for (let offset = 0; offset < instagramFormats.length; offset += 1) {
    const format = instagramFormats[(startIndex + offset) % instagramFormats.length];
    if (enabledFormats.has(format)) return format;
  }

  return null;
}
