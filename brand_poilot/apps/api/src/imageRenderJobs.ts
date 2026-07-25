import { deliveryFormatToPromptVersion } from "./instagramFormats.js";
import type {
  ImageRenderJobBrandContext,
  ImageRenderJobPayload,
  ImageRenderJobTopicContext,
  InstagramDeliveryFormat
} from "./types.js";

export type WorkerSourceMode = "direct_url" | "topic_only" | "url_unavailable";
export type InstagramWorkerJobPayload = ImageRenderJobPayload;

export interface WorkerPngAsset {
  index: number;
  role: string;
  url: string;
  mimeType: "image/png";
  width: number;
  height: number;
}

export interface WorkerPngFile {
  url: string;
  mimeType: "image/png";
  width: 1080;
  height: 1920;
}

export interface WorkerReelVideo {
  url: string;
  mimeType: "video/mp4";
  width: 1080;
  height: 1920;
  videoCodec: "h264";
  audioCodec: "aac";
  fps: 30;
}

interface InstagramWorkerResultBase {
  jobId: string | null;
  channelOutputId: string | null;
  model: string;
  sourceMode: WorkerSourceMode;
  fetchStatus: string;
  selectedAssetCount: number;
  validation: { passed: true };
  title: string | null;
}

export interface InstagramFeedWorkerResult extends InstagramWorkerResultBase {
  deliveryFormat: "instagram_feed_carousel";
  promptVersion: "worker-card.v4";
  caption: string;
  hashtags: string[];
  cards: WorkerPngAsset[];
}

export interface InstagramStoryWorkerResult extends InstagramWorkerResultBase {
  deliveryFormat: "instagram_story";
  promptVersion: "worker-story.v1";
  story: WorkerPngAsset;
}

export interface InstagramReelWorkerResult extends InstagramWorkerResultBase {
  deliveryFormat: "instagram_reel";
  promptVersion: "worker-reel.v3";
  scenes: WorkerPngAsset[];
  cover: WorkerPngFile;
  video: WorkerReelVideo;
  caption: string | null;
  hashtags: string[];
}

export type InstagramWorkerJobResult =
  | InstagramFeedWorkerResult
  | InstagramStoryWorkerResult
  | InstagramReelWorkerResult;

export class ImageRenderJobResultValidationError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "ImageRenderJobResultValidationError";
  }
}

export function isImageRenderJobResultValidationError(
  error: unknown
): error is ImageRenderJobResultValidationError {
  return error instanceof ImageRenderJobResultValidationError;
}

function invalid(code: string): never {
  throw new ImageRenderJobResultValidationError(code);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function validRepresentativeUrl(value: unknown) {
  const url = asNonEmptyString(value);
  return url && isHttpUrl(url) ? url : null;
}

export function buildImageRenderJobPayload(input: {
  deliveryFormat: InstagramDeliveryFormat;
  topic: ImageRenderJobTopicContext;
  brand: ImageRenderJobBrandContext;
  crawlContentUrl?: string | null;
  referenceUrl?: string | null;
}): InstagramWorkerJobPayload {
  const common = {
    topic: input.topic,
    brand: input.brand,
    representativeUrl: validRepresentativeUrl(input.crawlContentUrl)
      ?? validRepresentativeUrl(input.referenceUrl),
    maxImages: 5 as const
  };

  switch (input.deliveryFormat) {
    case "instagram_feed_carousel":
      return { ...common, deliveryFormat: input.deliveryFormat, promptVersion: "worker-card.v4" };
    case "instagram_story":
      return { ...common, deliveryFormat: input.deliveryFormat, promptVersion: "worker-story.v1" };
    case "instagram_reel":
      return { ...common, deliveryFormat: input.deliveryFormat, promptVersion: "worker-reel.v3" };
  }
}

function parseCommon(
  record: Record<string, unknown>,
  deliveryFormat: InstagramDeliveryFormat,
  expected?: {
    jobId?: string;
    channelOutputId?: string;
    deliveryFormat?: InstagramDeliveryFormat;
  }
): InstagramWorkerResultBase & { promptVersion: string } {
  const jobId = asNonEmptyString(record.jobId);
  const channelOutputId = asNonEmptyString(record.channelOutputId);
  if (
    (expected?.jobId && jobId !== expected.jobId)
    || (expected?.channelOutputId && channelOutputId !== expected.channelOutputId)
  ) {
    invalid("image_manifest_job_mismatch");
  }
  if (expected?.deliveryFormat && deliveryFormat !== expected.deliveryFormat) {
    invalid("delivery_format_mismatch");
  }

  const promptVersion = asNonEmptyString(record.promptVersion);
  if (promptVersion !== deliveryFormatToPromptVersion(deliveryFormat)) {
    invalid("prompt_version_mismatch");
  }

  const sourceMode = asNonEmptyString(record.sourceMode);
  if (sourceMode !== "direct_url" && sourceMode !== "topic_only" && sourceMode !== "url_unavailable") {
    invalid("source_mode_invalid");
  }
  const fetchStatus = asNonEmptyString(record.fetchStatus);
  if (!fetchStatus) invalid("fetch_status_required");

  const selectedAssetCount = Number(record.selectedAssetCount);
  if (!Number.isInteger(selectedAssetCount) || selectedAssetCount < 1 || selectedAssetCount > 5) {
    invalid("asset_count_out_of_range");
  }
  if (asRecord(record.validation)?.passed !== true) {
    invalid("worker_validation_required");
  }

  const content = asRecord(record.content);
  return {
    jobId,
    channelOutputId,
    model: asNonEmptyString(record.model) ?? "unknown",
    promptVersion,
    sourceMode,
    fetchStatus,
    selectedAssetCount,
    validation: { passed: true },
    title: asNonEmptyString(record.title) ?? asNonEmptyString(content?.title)
  };
}

function parsePngAsset(
  value: unknown,
  expectedIndex: number,
  expectedWidth: 1080 | null,
  expectedHeight: 1080 | null,
  fallbackRole?: unknown
): WorkerPngAsset {
  const item = asRecord(value);
  if (!item) invalid("image_asset_invalid");
  const index = item.index === undefined ? expectedIndex : Number(item.index);
  if (!Number.isInteger(index) || index !== expectedIndex) invalid("image_asset_index_invalid");

  const role = asNonEmptyString(item.role) ?? asNonEmptyString(fallbackRole);
  if (!role) invalid("asset_role_invalid");
  const url = asNonEmptyString(item.url) ?? asNonEmptyString(item.publicUrl);
  if (!url || !isHttpUrl(url) || !new URL(url).pathname.toLowerCase().endsWith(".png")) {
    invalid("image_asset_url_invalid");
  }
  if (item.mimeType !== "image/png") invalid("image_asset_type_invalid");
  const width = Number(item.width);
  const height = Number(item.height);
  if (
    !Number.isInteger(width)
    || width <= 0
    || !Number.isInteger(height)
    || height <= 0
    || (expectedWidth !== null && width !== expectedWidth)
    || (expectedHeight !== null && height !== expectedHeight)
  ) {
    invalid("image_asset_dimensions_invalid");
  }
  return {
    index,
    role,
    url,
    mimeType: "image/png",
    width,
    height
  };
}

function parseCover(value: unknown): WorkerPngFile {
  const item = asRecord(value);
  if (!item) invalid("reel_video_required");
  const url = asNonEmptyString(item.url) ?? asNonEmptyString(item.publicUrl);
  if (!url || !isHttpUrl(url) || !new URL(url).pathname.toLowerCase().endsWith(".png")) {
    invalid("reel_cover_invalid");
  }
  if (item.mimeType !== "image/png" || Number(item.width) !== 1080 || Number(item.height) !== 1920) {
    invalid("reel_cover_invalid");
  }
  return { url, mimeType: "image/png", width: 1080, height: 1920 };
}

function normalizeVideoCodec(value: unknown) {
  return asNonEmptyString(value)?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? null;
}

function parseVideo(value: unknown): WorkerReelVideo {
  const item = asRecord(value);
  if (!item) invalid("reel_video_required");
  const url = asNonEmptyString(item.url) ?? asNonEmptyString(item.publicUrl);
  const videoCodec = normalizeVideoCodec(item.videoCodec ?? item.codec);
  const audioCodec = normalizeVideoCodec(item.audioCodec);
  const fps = Number(item.fps ?? item.frameRate);
  if (
    !url || !isHttpUrl(url) || !new URL(url).pathname.toLowerCase().endsWith(".mp4")
    || item.mimeType !== "video/mp4"
    || Number(item.width) !== 1080
    || Number(item.height) !== 1920
    || (videoCodec !== "h264" && videoCodec !== "avc1")
    || audioCodec !== "aac"
    || fps !== 30
  ) {
    invalid("reel_video_invalid");
  }
  return {
    url,
    mimeType: "video/mp4",
    width: 1080,
    height: 1920,
    videoCodec: "h264",
    audioCodec: "aac",
    fps: 30
  };
}

function assertUniqueRoles(assets: WorkerPngAsset[]) {
  const roles = assets.map((asset) => asset.role.trim().toLowerCase());
  if (new Set(roles).size !== roles.length) invalid("asset_role_duplicate");
}

function parseHashtags(value: unknown, required: boolean) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value)) invalid("image_manifest_hashtags_invalid");
  const hashtags = value.map(asNonEmptyString);
  if (
    hashtags.length !== 5
    || hashtags.some((tag) => tag === null || !/^#[^\s#]+$/.test(tag))
    || new Set(hashtags).size !== hashtags.length
  ) {
    invalid("image_manifest_hashtags_invalid");
  }
  return hashtags as string[];
}

function resultText(record: Record<string, unknown>, key: string) {
  return asNonEmptyString(record[key]) ?? asNonEmptyString(asRecord(record.content)?.[key]);
}

export function parseImageRenderJobResult(
  value: unknown,
  expected?: {
    jobId?: string;
    channelOutputId?: string;
    deliveryFormat?: InstagramDeliveryFormat;
  }
): InstagramWorkerJobResult {
  const record = asRecord(value);
  if (!record) invalid("image_manifest_invalid");
  const deliveryFormat = asNonEmptyString(record.deliveryFormat);
  if (
    deliveryFormat !== "instagram_feed_carousel"
    && deliveryFormat !== "instagram_story"
    && deliveryFormat !== "instagram_reel"
  ) {
    invalid("delivery_format_invalid");
  }

  // These two format-level failures are checked first to keep their public error codes stable.
  if (deliveryFormat === "instagram_reel" && (!asRecord(record.cover) || !asRecord(record.video))) {
    invalid("reel_video_required");
  }
  if (deliveryFormat === "instagram_feed_carousel") {
    const rawCards = Array.isArray(record.cards) ? record.cards : Array.isArray(record.images) ? record.images : [];
    if (rawCards.length < 1 || rawCards.length > 5) invalid("asset_count_out_of_range");
  }

  const common = parseCommon(record, deliveryFormat, expected);
  const rawContent = asRecord(record.content);

  if (deliveryFormat === "instagram_feed_carousel") {
    const rawCards = Array.isArray(record.cards) ? record.cards : record.images as unknown[];
    const rawSlides = Array.isArray(rawContent?.slides) ? rawContent.slides : [];
    const cards = rawCards.map((card, index) => parsePngAsset(
      card,
      index + 1,
      null,
      null,
      asRecord(rawSlides[index])?.role
    ));
    if (cards.some((card) => card.width !== card.height)) invalid("image_asset_dimensions_invalid");
    assertUniqueRoles(cards);
    if (common.selectedAssetCount !== cards.length) invalid("selected_asset_count_mismatch");
    const caption = resultText(record, "caption");
    if (!caption) invalid("image_manifest_caption_required");
    return {
      ...common,
      deliveryFormat,
      promptVersion: "worker-card.v4",
      caption,
      hashtags: parseHashtags(record.hashtags ?? rawContent?.hashtags, true),
      cards
    };
  }

  if (deliveryFormat === "instagram_story") {
    const candidates = Array.isArray(record.story)
      ? record.story
      : Array.isArray(record.images)
        ? record.images
        : [record.story ?? record.image].filter((item) => item !== undefined);
    if (candidates.length !== 1) invalid("story_asset_count_invalid");
    const story = parsePngAsset(candidates[0], 1, null, null);
    if (common.selectedAssetCount !== 1) invalid("selected_asset_count_mismatch");
    return {
      ...common,
      deliveryFormat,
      promptVersion: "worker-story.v1",
      story
    };
  }

  const rawScenes = Array.isArray(record.scenes) ? record.scenes : [];
  if (rawScenes.length !== 1) invalid("reel_asset_count_invalid");
  const scenes = rawScenes.map((scene, index) => parsePngAsset(scene, index + 1, null, null));
  assertUniqueRoles(scenes);
  if (common.selectedAssetCount !== scenes.length) invalid("selected_asset_count_mismatch");
  return {
    ...common,
    deliveryFormat,
    promptVersion: "worker-reel.v3",
    scenes,
    cover: parseCover(record.cover),
    video: parseVideo(record.video),
    caption: resultText(record, "caption"),
    hashtags: parseHashtags(record.hashtags ?? rawContent?.hashtags, false)
  };
}

function urlPathEquals(url: string, expectedPath: string) {
  try {
    const path = new URL(url).pathname.replace(/^\/+/, "");
    return path === expectedPath.replace(/^\/+/, "");
  } catch {
    return false;
  }
}

function resultAssets(result: InstagramWorkerJobResult) {
  switch (result.deliveryFormat) {
    case "instagram_feed_carousel":
      return result.cards.map((asset) => ({
        url: asset.url,
        mimeType: asset.mimeType,
        fileName: `card-${String(asset.index).padStart(2, "0")}.png`
      }));
    case "instagram_story":
      return [{ url: result.story.url, mimeType: result.story.mimeType, fileName: "story.png" }];
    case "instagram_reel":
      return [
        ...result.scenes.map((asset) => ({
          url: asset.url,
          mimeType: asset.mimeType,
          fileName: `scene-${String(asset.index).padStart(2, "0")}.png`
        })),
        { url: result.cover.url, mimeType: result.cover.mimeType, fileName: "cover.png" },
        { url: result.video.url, mimeType: result.video.mimeType, fileName: "reel.mp4" }
      ];
  }
}

export async function validateImageRenderJobResultAssets({
  manifestUrl,
  storagePrefix,
  result,
  fetchImpl = fetch
}: {
  manifestUrl: string;
  storagePrefix: string;
  result: InstagramWorkerJobResult;
  fetchImpl?: typeof fetch;
}) {
  const normalizedPrefix = storagePrefix.replace(/^\/+|\/+$/g, "");
  if (!urlPathEquals(manifestUrl, `${normalizedPrefix}/manifest.json`)) {
    invalid("image_manifest_path_invalid");
  }
  for (const asset of resultAssets(result)) {
    if (!urlPathEquals(asset.url, `${normalizedPrefix}/${asset.fileName}`)) {
      invalid("image_manifest_asset_path_invalid");
    }
    const response = await fetchImpl(asset.url, { method: "HEAD" });
    const contentType = response.headers.get("content-type")?.toLowerCase().split(";")[0].trim();
    if (!response.ok || contentType !== asset.mimeType) invalid("image_manifest_asset_unavailable");
  }
}
