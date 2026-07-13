import type { InstagramDeliveryFormat, WorkerPromptVersion } from "./promptBuilder.js";

export interface WorkerManifestAsset {
  index: number;
  role: string;
  embeddedText: string;
  width: number;
  height: number;
  checksum?: string;
}

interface ValidatedWorkerManifestBase {
  deliveryFormat: InstagramDeliveryFormat;
  promptVersion: WorkerPromptVersion;
  selectedAssetCount: number;
  assets: WorkerManifestAsset[];
  validation: { passed: true };
  caption?: string;
  hashtags?: string[];
}

export interface ValidatedFeedManifest extends ValidatedWorkerManifestBase {
  deliveryFormat: "instagram_feed_carousel";
  promptVersion: "worker-card.v4";
  cards: WorkerManifestAsset[];
  caption: string;
  hashtags: string[];
}

export interface ValidatedStoryManifest extends ValidatedWorkerManifestBase {
  deliveryFormat: "instagram_story";
  promptVersion: "worker-story.v1";
  story: WorkerManifestAsset;
}

export interface ValidatedReelManifest extends ValidatedWorkerManifestBase {
  deliveryFormat: "instagram_reel";
  promptVersion: "worker-reel.v1";
  scenes: WorkerManifestAsset[];
  caption: string;
  hashtags: string[];
}

export type ValidatedWorkerManifest =
  | ValidatedFeedManifest
  | ValidatedStoryManifest
  | ValidatedReelManifest;

export class WorkerManifestValidationError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "WorkerManifestValidationError";
  }
}

function invalid(code: string): never {
  throw new WorkerManifestValidationError(code);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalize(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function promptVersionFor(deliveryFormat: InstagramDeliveryFormat): WorkerPromptVersion {
  switch (deliveryFormat) {
    case "instagram_feed_carousel": return "worker-card.v4";
    case "instagram_story": return "worker-story.v1";
    case "instagram_reel": return "worker-reel.v1";
  }
}

function rawAssetsFor(record: Record<string, unknown>, deliveryFormat: InstagramDeliveryFormat) {
  if (deliveryFormat === "instagram_feed_carousel") {
    return Array.isArray(record.cards) ? record.cards : record.assets;
  }
  if (deliveryFormat === "instagram_reel") {
    return Array.isArray(record.scenes) ? record.scenes : record.assets;
  }
  if (Array.isArray(record.story)) return record.story;
  if (record.story !== undefined && !Array.isArray(record.story)) return [record.story];
  return record.assets;
}

function embeddedTextFor(record: Record<string, unknown>) {
  const embeddedText = nonEmptyString(record.embeddedText);
  if (embeddedText) return embeddedText;
  return [record.headline, record.body, record.text, record.copy]
    .map(nonEmptyString)
    .filter((value): value is string => value !== null)
    .join("\n");
}

function parseAssets(
  values: unknown[],
  deliveryFormat: InstagramDeliveryFormat
): WorkerManifestAsset[] {
  return values.map((value, offset) => {
    const record = asRecord(value);
    if (!record) invalid("image_asset_invalid");
    const index = Number(record.index);
    if (!Number.isInteger(index) || index !== offset + 1) invalid("image_asset_index_invalid");
    const role = nonEmptyString(record.role);
    if (!role) invalid("asset_role_invalid");
    const width = deliveryFormat === "instagram_feed_carousel" ? Number(record.width) : 1080;
    const height = deliveryFormat === "instagram_feed_carousel" ? Number(record.height) : 1920;
    if (deliveryFormat === "instagram_feed_carousel" && (width !== 1080 || height !== 1080)) {
      invalid("image_asset_dimensions_invalid");
    }
    const checksum = nonEmptyString(record.checksum);
    return {
      index,
      role,
      embeddedText: embeddedTextFor(record),
      width,
      height,
      ...(checksum ? { checksum } : {})
    };
  });
}

function assertUniqueAssets(assets: WorkerManifestAsset[]) {
  const roles = assets.map((asset) => normalize(asset.role));
  if (new Set(roles).size !== roles.length) invalid("asset_role_duplicate");

  const embeddedTexts = assets
    .map((asset) => normalize(asset.embeddedText))
    .filter((text) => text.length > 0);
  if (new Set(embeddedTexts).size !== embeddedTexts.length) invalid("asset_text_duplicate");

  const checksums = assets
    .map((asset) => asset.checksum ? normalize(asset.checksum) : null)
    .filter((checksum): checksum is string => checksum !== null);
  if (new Set(checksums).size !== checksums.length) invalid("asset_checksum_duplicate");
}

function isCtaOnly(asset: WorkerManifestAsset) {
  const role = normalize(asset.role).replace(/[-_]+/g, " ");
  if (/^(cta|call to action|action prompt|conversion)$/.test(role)) return true;

  const text = normalize(asset.embeddedText).replace(/[^\p{L}\p{N}]+/gu, "");
  return /^(자세히확인하기|더알아보기|문의하기|상담신청|지금확인(?:하기)?|링크확인(?:하기)?|프로필링크(?:확인)?|방문하기|구매하기|신청하기|예약하기|팔로우하기)$/.test(text);
}

function parseCaption(record: Record<string, unknown>) {
  const caption = nonEmptyString(record.caption);
  if (!caption) invalid("image_manifest_caption_required");
  return caption;
}

function parseHashtags(record: Record<string, unknown>) {
  if (!Array.isArray(record.hashtags)) invalid("image_manifest_hashtags_invalid");
  const hashtags = record.hashtags.map(nonEmptyString);
  if (
    hashtags.length !== 5
    || hashtags.some((hashtag) => hashtag === null || !/^#[^\s#]+$/.test(hashtag))
  ) {
    invalid("image_manifest_hashtags_invalid");
  }
  const validHashtags = hashtags as string[];
  if (new Set(validHashtags.map(normalize)).size !== validHashtags.length) {
    invalid("image_manifest_hashtags_invalid");
  }
  return validHashtags;
}

export function parseWorkerManifest(
  value: unknown,
  options: { maxImages?: number } = {}
): ValidatedWorkerManifest {
  const record = asRecord(value);
  if (!record) invalid("image_manifest_invalid");
  const deliveryFormat = nonEmptyString(record.deliveryFormat);
  if (
    deliveryFormat !== "instagram_feed_carousel"
    && deliveryFormat !== "instagram_story"
    && deliveryFormat !== "instagram_reel"
  ) {
    invalid("delivery_format_invalid");
  }

  const expectedPromptVersion = promptVersionFor(deliveryFormat);
  if (record.promptVersion !== expectedPromptVersion) invalid("prompt_version_mismatch");

  const maxImages = options.maxImages ?? 5;
  if (!Number.isInteger(maxImages) || maxImages < 1 || maxImages > 5) {
    invalid("image_render_max_images_invalid");
  }
  const rawAssets = rawAssetsFor(record, deliveryFormat);
  if (!Array.isArray(rawAssets)) invalid("image_manifest_assets_invalid");
  if (deliveryFormat === "instagram_story" && rawAssets.length !== 1) {
    invalid("story_asset_count_invalid");
  }
  if (rawAssets.length < 1 || rawAssets.length > maxImages || rawAssets.length > 5) {
    invalid("asset_count_out_of_range");
  }

  const selectedAssetCount = Number(record.selectedAssetCount);
  if (!Number.isInteger(selectedAssetCount) || selectedAssetCount !== rawAssets.length) {
    invalid("selected_asset_count_mismatch");
  }

  const assets = parseAssets(rawAssets, deliveryFormat);
  assertUniqueAssets(assets);
  if (assets.some(isCtaOnly)) invalid("asset_final_cta_only");

  const common = {
    deliveryFormat,
    promptVersion: expectedPromptVersion,
    selectedAssetCount,
    assets,
    validation: { passed: true as const }
  };

  if (deliveryFormat === "instagram_feed_carousel") {
    return {
      ...common,
      deliveryFormat,
      promptVersion: "worker-card.v4",
      caption: parseCaption(record),
      hashtags: parseHashtags(record),
      cards: assets
    };
  }
  if (deliveryFormat === "instagram_story") {
    return {
      ...common,
      deliveryFormat,
      promptVersion: "worker-story.v1",
      story: assets[0]
    };
  }
  return {
    ...common,
    deliveryFormat,
    promptVersion: "worker-reel.v1",
    caption: parseCaption(record),
    hashtags: parseHashtags(record),
    scenes: assets
  };
}
