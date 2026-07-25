import type { AiContentType } from "./aiContentContracts.js";
import type { Channel } from "./types.js";

export type AiContentPublishDeliveryFormat =
  | "instagram_feed_single"
  | "instagram_feed_carousel"
  | "instagram_story"
  | "instagram_reel"
  | "threads_text"
  | "x_post"
  | "linkedin_post"
  | "youtube_short"
  | "tiktok_video";

export interface AiContentPublishTarget {
  channel: Channel;
  deliveryFormat: AiContentPublishDeliveryFormat;
}

export interface AiContentPublishRequest {
  idempotencyKey: string;
  targets: readonly AiContentPublishTarget[];
}

export type AiContentPublishTargetResolution =
  | { supported: true; target: AiContentPublishTarget }
  | {
      supported: false;
      reason: "ai_content_publish_target_unsupported" | "delivery_format_asset_mismatch";
    };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const channels = new Set<Channel>(["instagram", "threads", "x", "linkedin", "youtube", "tiktok"]);
const deliveryFormats = new Set<AiContentPublishDeliveryFormat>([
  "instagram_feed_single",
  "instagram_feed_carousel",
  "instagram_story",
  "instagram_reel",
  "threads_text",
  "x_post",
  "linkedin_post",
  "youtube_short",
  "tiktok_video",
]);

const channelFormats: Record<Channel, ReadonlySet<AiContentPublishDeliveryFormat>> = {
  instagram: new Set(["instagram_feed_single", "instagram_feed_carousel", "instagram_story", "instagram_reel"]),
  threads: new Set(["threads_text"]),
  x: new Set(["x_post"]),
  linkedin: new Set(["linkedin_post"]),
  youtube: new Set(["youtube_short"]),
  tiktok: new Set(["tiktok_video"]),
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseAiContentPublishRequest(value: unknown): AiContentPublishRequest {
  const record = recordValue(value);
  if (!record) throw new Error("ai_content_publish_request_invalid");
  const idempotencyKey = typeof record.idempotencyKey === "string" ? record.idempotencyKey.trim() : "";
  if (!UUID_PATTERN.test(idempotencyKey)) throw new Error("ai_content_publish_idempotency_key_invalid");
  if (!Array.isArray(record.targets) || record.targets.length === 0 || record.targets.length > 12) {
    throw new Error("ai_content_publish_targets_invalid");
  }

  const seen = new Set<string>();
  const targets = record.targets.map((value): AiContentPublishTarget => {
    const target = recordValue(value);
    const channel = target?.channel;
    const deliveryFormat = target?.deliveryFormat;
    if (
      typeof channel !== "string"
      || !channels.has(channel as Channel)
      || typeof deliveryFormat !== "string"
      || !deliveryFormats.has(deliveryFormat as AiContentPublishDeliveryFormat)
      || !channelFormats[channel as Channel].has(deliveryFormat as AiContentPublishDeliveryFormat)
    ) {
      throw new Error("ai_content_publish_target_invalid");
    }
    const key = `${channel}:${deliveryFormat}`;
    if (seen.has(key)) throw new Error("duplicate_publish_target");
    seen.add(key);
    return {
      channel: channel as Channel,
      deliveryFormat: deliveryFormat as AiContentPublishDeliveryFormat,
    };
  });

  return { idempotencyKey, targets };
}

export function resolveAiContentPublishTarget(
  output: { type: AiContentType; assetCount: number },
  target: AiContentPublishTarget,
): AiContentPublishTargetResolution {
  if (target.channel !== "instagram" || output.type === "blog") {
    return { supported: false, reason: "ai_content_publish_target_unsupported" };
  }
  if (output.assetCount < 1) {
    return { supported: false, reason: "delivery_format_asset_mismatch" };
  }
  if (target.deliveryFormat === "instagram_story") return { supported: true, target };
  if (target.deliveryFormat === "instagram_reel") return { supported: true, target };
  if (output.type === "marketing") {
    return target.deliveryFormat === "instagram_feed_single"
      ? { supported: true, target }
      : { supported: false, reason: "delivery_format_asset_mismatch" };
  }
  if (target.deliveryFormat === "instagram_feed_single") {
    if (output.type === "card_news" && output.assetCount >= 2) {
      return {
        supported: true,
        target: { ...target, deliveryFormat: "instagram_feed_carousel" },
      };
    }
    return output.assetCount === 1
      ? { supported: true, target }
      : { supported: false, reason: "delivery_format_asset_mismatch" };
  }
  if (target.deliveryFormat === "instagram_feed_carousel") {
    return output.assetCount >= 2
      ? { supported: true, target }
      : { supported: false, reason: "delivery_format_asset_mismatch" };
  }
  return { supported: false, reason: "ai_content_publish_target_unsupported" };
}
