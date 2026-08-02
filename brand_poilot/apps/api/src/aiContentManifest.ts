import type {
  AiContentAsset,
  AiContentManifest,
  AiContentManifestV2,
  AiContentType,
  BlogContent,
  CardNewsContent,
  MarketingContent,
  MessageStrategy,
  OutputFormat,
  ContentFamily,
} from "./aiContentContracts.js";

type UnknownObject = Record<string, unknown>;

function fail(code: string): never {
  throw new Error(code);
}

function object(value: unknown, code: string): UnknownObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as UnknownObject;
}

function text(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(code);
  return value.trim();
}

function optionalText(value: unknown, code: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return text(value, code);
}

function positiveInteger(value: unknown, code: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) fail(code);
  return Number(value);
}

function decodePercentEncoding(value: string): string {
  let decoded = value;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function decodeHtmlCharacterReferences(value: string): string {
  const decodeCodePoint = (match: string, rawCodePoint: string, radix: number): string => {
    const codePoint = Number.parseInt(rawCodePoint, radix);
    if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return match;
    }
  };

  return value
    .replace(/&#x([0-9a-f]+);?/gi, (match, codePoint: string) => decodeCodePoint(match, codePoint, 16))
    .replace(/&#([0-9]+);?/g, (match, codePoint: string) => decodeCodePoint(match, codePoint, 10))
    .replace(/&colon;?/gi, ":")
    .replace(/&tab;?/gi, "\t")
    .replace(/&newline;?/gi, "\n")
    .replace(/&amp;?/gi, "&");
}

function parseAsset(value: unknown): AiContentAsset {
  const source = object(value, "ai_content_asset_invalid");
  const url = text(source.url, "ai_content_asset_url_invalid");
  try {
    if (new URL(url).protocol !== "https:") fail("ai_content_asset_url_invalid");
  } catch {
    fail("ai_content_asset_url_invalid");
  }

  const fileName = text(source.fileName, "ai_content_asset_file_name_invalid");
  const decodedFileName = decodePercentEncoding(fileName);
  if (
    decodedFileName.includes("/")
    || decodedFileName.includes("\\")
    || decodedFileName.includes("..")
    || /[\u0000-\u001f\u007f]/.test(decodedFileName)
  ) {
    fail("ai_content_asset_file_name_invalid");
  }

  const role = source.role;
  if (!(["slide", "cover", "inline", "html", "creative", "text"] as unknown[]).includes(role)) {
    fail("ai_content_asset_role_invalid");
  }
  const mimeType = source.mimeType;
  if (mimeType !== "image/png" && mimeType !== "text/html" && mimeType !== "text/plain") {
    fail("ai_content_asset_mime_type_invalid");
  }

  const width = source.width === undefined ? undefined : positiveInteger(source.width, "ai_content_asset_dimensions_invalid");
  const height = source.height === undefined ? undefined : positiveInteger(source.height, "ai_content_asset_dimensions_invalid");
  if ((width === undefined) !== (height === undefined)) fail("ai_content_asset_dimensions_invalid");

  return {
    role: role as AiContentAsset["role"],
    url,
    fileName,
    mimeType,
    width,
    height,
    index: positiveInteger(source.index, "ai_content_asset_index_invalid"),
  };
}

function parseAssets(value: unknown): AiContentAsset[] {
  if (!Array.isArray(value) || value.length === 0) fail("ai_content_assets_invalid");
  const assets = value.map(parseAsset);
  if (assets.some((asset, index) => asset.index !== index + 1)) {
    fail("ai_content_asset_index_invalid");
  }
  return assets;
}

function parseOptionalMetadata(source: UnknownObject): {
  family?: ContentFamily;
  strategy?: MessageStrategy;
  outputFormat?: OutputFormat;
} {
  const metadata: {
    family?: ContentFamily;
    strategy?: MessageStrategy;
    outputFormat?: OutputFormat;
  } = {};
  if (source.family !== undefined) {
    if (!["informational", "marketing"].includes(String(source.family))) {
      fail("ai_content_manifest_family_invalid");
    }
    metadata.family = source.family as ContentFamily;
  }
  if (source.strategy !== undefined) {
    if (!["problem_solution", "how_to", "comparison", "faq", "insight", "benefit", "social_proof", "brand_story", "cta"].includes(String(source.strategy))) {
      fail("ai_content_manifest_strategy_invalid");
    }
    metadata.strategy = source.strategy as MessageStrategy;
  }
  if (source.outputFormat !== undefined) {
    if (!["card_news", "blog", "single_image", "channel_text"].includes(String(source.outputFormat))) {
      fail("ai_content_manifest_output_format_invalid");
    }
    metadata.outputFormat = source.outputFormat as OutputFormat;
  }
  return metadata;
}

function parseCardNewsContent(value: unknown): CardNewsContent {
  const source = object(value, "ai_content_card_news_content_invalid");
  if (!Array.isArray(source.hashtags) || source.hashtags.length > 5) {
    fail("ai_content_card_news_hashtags_invalid");
  }
  const hashtags = source.hashtags.map((hashtag) => text(hashtag, "ai_content_card_news_hashtags_invalid"));
  if (new Set(hashtags.map((hashtag) => hashtag.toLocaleLowerCase())).size !== hashtags.length) {
    fail("ai_content_card_news_hashtags_invalid");
  }
  return {
    caption: text(source.caption, "ai_content_card_news_caption_invalid"),
    hashtags,
    cta: text(source.cta, "ai_content_card_news_cta_invalid"),
  };
}

function validateBlogHtml(html: string): void {
  const normalizedHtml = decodePercentEncoding(decodeHtmlCharacterReferences(html));
  if (/<script\b/i.test(normalizedHtml)) fail("ai_content_blog_html_script_forbidden");
  if (/<form\b/i.test(normalizedHtml)) fail("ai_content_blog_html_form_forbidden");
  if (/<iframe\b/i.test(normalizedHtml)) fail("ai_content_blog_html_iframe_forbidden");
  if (/<[^>]+\son[a-z]+\s*=/i.test(normalizedHtml)) fail("ai_content_blog_html_event_handler_forbidden");
  if (/javascript[\s\u0000-\u001f\u007f]*:/i.test(normalizedHtml)) {
    fail("ai_content_blog_html_javascript_url_forbidden");
  }
  if ((html.match(/<h1\b/gi) ?? []).length !== 1) fail("ai_content_blog_html_h1_count_invalid");
}

function blogImageAttributes(html: string): Array<{ src: string; alt: string }> {
  return (html.match(/<img\b[^>]*>/gi) ?? []).map((tag) => {
    const src = tag.match(/\bsrc\s*=\s*(["'])(.*?)\1/i)?.[2] ?? "";
    const alt = tag.match(/\balt\s*=\s*(["'])(.*?)\1/i)?.[2] ?? "";
    return { src: decodeHtmlCharacterReferences(src).trim(), alt: decodeHtmlCharacterReferences(alt).trim() };
  });
}

function parseBlogContent(value: unknown): BlogContent {
  const source = object(value, "ai_content_blog_content_invalid");
  const html = text(source.html, "ai_content_blog_html_invalid");
  validateBlogHtml(html);
  return {
    title: text(source.title, "ai_content_blog_title_invalid"),
    summary: text(source.summary, "ai_content_blog_summary_invalid"),
    html,
    metaTitle: text(source.metaTitle, "ai_content_blog_meta_title_invalid"),
    metaDescription: text(source.metaDescription, "ai_content_blog_meta_description_invalid"),
    coverAlt: optionalText(source.coverAlt, "ai_content_blog_cover_alt_invalid"),
  };
}

function parseMarketingContent(value: unknown): MarketingContent {
  const source = object(value, "ai_content_marketing_content_invalid");
  return {
    headline: text(source.headline, "ai_content_marketing_headline_invalid"),
    body: text(source.body, "ai_content_marketing_body_invalid"),
    cta: text(source.cta, "ai_content_marketing_cta_invalid"),
    concept: text(source.concept, "ai_content_marketing_concept_invalid"),
  };
}

function parseV1(
  type: AiContentType,
  value: unknown,
  requestedDimensions?: { width: number; height: number },
): AiContentManifest {
  const source = object(value, "ai_content_manifest_invalid");
  if (source.version !== "ai-content.v1") fail("ai_content_manifest_version_invalid");
  if (source.type !== type) fail("ai_content_manifest_type_mismatch");

  const title = text(source.title, "ai_content_manifest_title_invalid");
  const assets = parseAssets(source.assets);
  const metadata = parseOptionalMetadata(source);

  if (type === "card_news") {
    if (assets.length < 1 || assets.length > 5) fail("ai_content_card_news_slide_count_invalid");
    for (const asset of assets) {
      if (asset.role !== "slide") fail("ai_content_card_news_slide_role_invalid");
      if (asset.mimeType !== "image/png") fail("ai_content_card_news_mime_type_invalid");
      if (
        asset.width === undefined
        || asset.height === undefined
        || (requestedDimensions !== undefined
          && asset.width * requestedDimensions.height !== asset.height * requestedDimensions.width)
      ) {
        fail("ai_content_card_news_dimensions_invalid");
      }
    }
    return { version: "ai-content.v1", type, title, assets, content: parseCardNewsContent(source.content), ...metadata };
  }

  if (type === "blog") {
    const coverAssets = assets.filter((asset) => asset.role === "cover" && asset.mimeType === "image/png");
    const inlineAssets = assets.filter((asset) => asset.role === "inline" && asset.mimeType === "image/png");
    const htmlAssets = assets.filter((asset) => asset.role === "html" && asset.mimeType === "text/html");
    if (coverAssets.length !== 1) fail("ai_content_blog_cover_asset_required");
    if (htmlAssets.length !== 1) fail("ai_content_blog_html_asset_required");
    if (inlineAssets.length > 5) fail("ai_content_blog_inline_asset_count_invalid");
    if (assets.length !== inlineAssets.length + 2) fail("ai_content_blog_asset_count_invalid");
    if (coverAssets[0].width !== 1200 || coverAssets[0].height !== 630) {
      fail("ai_content_blog_cover_dimensions_invalid");
    }
    for (const [index, asset] of inlineAssets.entries()) {
      if (asset.width !== 1200 || asset.height !== 800) fail("ai_content_blog_inline_dimensions_invalid");
      if (asset.fileName !== `inline-${String(index + 1).padStart(2, "0")}.png`) {
        fail("ai_content_blog_inline_asset_sequence_invalid");
      }
    }
    const content = parseBlogContent(source.content);
    const images = blogImageAttributes(content.html);
    for (const asset of inlineAssets) {
      const image = images.find((candidate) => candidate.src === asset.url);
      if (!image) fail("ai_content_blog_inline_asset_not_referenced");
      if (image.alt.length < 4 || !/[가-힣]/.test(image.alt)) fail("ai_content_blog_inline_asset_alt_invalid");
    }
    return { version: "ai-content.v1", type, title, assets, content, ...metadata };
  }

  if (metadata.outputFormat === "channel_text") {
    if (
      assets.length !== 1
      || assets[0].role !== "text"
      || assets[0].mimeType !== "text/plain"
      || assets[0].fileName !== "channel-text.txt"
      || assets[0].width !== undefined
      || assets[0].height !== undefined
    ) {
      fail("ai_content_marketing_asset_invalid");
    }
    return { version: "ai-content.v1", type, title, assets, content: parseMarketingContent(source.content), ...metadata };
  }
  if (assets.length !== 1 || assets[0].role !== "creative" || assets[0].mimeType !== "image/png") {
    fail("ai_content_marketing_asset_invalid");
  }
  if (assets[0].width === undefined || assets[0].height === undefined) {
    fail("ai_content_marketing_dimensions_required");
  }
  if (requestedDimensions && (assets[0].width !== requestedDimensions.width || assets[0].height !== requestedDimensions.height)) {
    fail("ai_content_marketing_dimensions_mismatch");
  }
  return { version: "ai-content.v1", type, title, assets, content: parseMarketingContent(source.content), ...metadata };
}

type V2Asset = AiContentManifestV2["assets"][number];

function exactObject(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  code: string,
): UnknownObject {
  const source = object(value, code);
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  const keys = Object.keys(source);
  if (keys.some((key) => !allowedKeys.has(key)) || requiredKeys.some((key) => !(key in source))) fail(code);
  return source;
}

function hasKey(source: UnknownObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function parseV2Url(value: unknown): string {
  const url = text(value, "ai_content_asset_url_invalid");
  try {
    if (new URL(url).protocol !== "https:") fail("ai_content_asset_url_invalid");
  } catch {
    fail("ai_content_asset_url_invalid");
  }
  return url;
}

function parseV2FileName(value: unknown): string {
  const fileName = text(value, "ai_content_asset_file_name_invalid");
  const decodedFileName = decodePercentEncoding(fileName);
  if (
    decodedFileName.includes("/")
    || decodedFileName.includes("\\")
    || decodedFileName.includes("..")
    || /[\u0000-\u001f\u007f]/.test(decodedFileName)
  ) {
    fail("ai_content_asset_file_name_invalid");
  }
  return fileName;
}

function parseV2Asset(value: unknown): V2Asset {
  const source = exactObject(
    value,
    ["role", "index", "url", "fileName", "mimeType"],
    ["width", "height", "durationSeconds", "videoCodec", "fps", "audioCodec"],
    "ai_content_asset_invalid",
  );
  if (!( ["slide", "inline", "html", "creative", "scene", "video"] as unknown[]).includes(source.role)) {
    fail("ai_content_asset_role_invalid");
  }
  if (!( ["image/png", "text/html", "video/mp4"] as unknown[]).includes(source.mimeType)) {
    fail("ai_content_asset_mime_type_invalid");
  }
  const hasWidth = hasKey(source, "width");
  const hasHeight = hasKey(source, "height");
  const hasVideoMetadata = ["durationSeconds", "videoCodec", "fps", "audioCodec"].some((key) => hasKey(source, key));
  const width = hasWidth ? positiveInteger(source.width, "ai_content_asset_dimensions_invalid") : undefined;
  const height = hasHeight ? positiveInteger(source.height, "ai_content_asset_dimensions_invalid") : undefined;

  if (source.mimeType === "image/png") {
    if (!hasWidth || !hasHeight || hasVideoMetadata) fail("ai_content_asset_dimensions_invalid");
    return {
      role: source.role as V2Asset["role"],
      index: positiveInteger(source.index, "ai_content_asset_index_invalid"),
      url: parseV2Url(source.url),
      fileName: parseV2FileName(source.fileName),
      mimeType: "image/png",
      width,
      height,
    };
  }

  if (source.mimeType === "text/html") {
    if (hasWidth || hasHeight || hasVideoMetadata) fail("ai_content_asset_dimensions_invalid");
    return {
      role: source.role as V2Asset["role"],
      index: positiveInteger(source.index, "ai_content_asset_index_invalid"),
      url: parseV2Url(source.url),
      fileName: parseV2FileName(source.fileName),
      mimeType: "text/html",
    };
  }

  if (!hasWidth || !hasHeight || !hasKey(source, "durationSeconds") || !hasKey(source, "videoCodec") || !hasKey(source, "fps") || !hasKey(source, "audioCodec")) {
    fail("ai_content_asset_video_metadata_invalid");
  }
  if (
    typeof source.durationSeconds !== "number"
    || !Number.isFinite(source.durationSeconds)
    || source.durationSeconds <= 0
    || source.videoCodec !== "h264"
    || source.fps !== 30
    || source.audioCodec !== null
  ) {
    fail("ai_content_asset_video_metadata_invalid");
  }
  return {
    role: source.role as V2Asset["role"],
    index: positiveInteger(source.index, "ai_content_asset_index_invalid"),
    url: parseV2Url(source.url),
    fileName: parseV2FileName(source.fileName),
    mimeType: "video/mp4",
    width,
    height,
    durationSeconds: source.durationSeconds,
    videoCodec: "h264",
    fps: 30,
    audioCodec: null,
  };
}

function continuousIndexes(assets: V2Asset[]): boolean {
  return assets.every((asset, position) => asset.index === position + 1);
}

function parseV2(
  type: AiContentType,
  value: UnknownObject,
  requestedDimensions?: { width: number; height: number },
): AiContentManifestV2 {
  const source = exactObject(
    value,
    ["version", "type", "purpose", "outputFormat", "title", "assets", "content"],
    [],
    "ai_content_manifest_invalid",
  );
  if (source.type !== type) fail("ai_content_manifest_type_mismatch");
  if (source.purpose !== "informational" && source.purpose !== "marketing") fail("ai_content_manifest_purpose_invalid");
  if (!( ["card_news", "blog", "reel", "marketing_content"] as unknown[]).includes(source.outputFormat)) {
    fail("ai_content_manifest_output_format_invalid");
  }
  if (
    (source.outputFormat === "card_news" && source.type !== "card_news")
    || (source.outputFormat === "blog" && source.type !== "blog")
    || ((source.outputFormat === "reel" || source.outputFormat === "marketing_content") && source.type !== "marketing")
  ) {
    fail("ai_content_manifest_output_format_invalid");
  }
  if (!Array.isArray(source.assets)) fail("ai_content_assets_invalid");
  const assets = source.assets.map(parseV2Asset);
  const content = object(source.content, "ai_content_manifest_content_invalid");

  if (source.outputFormat === "card_news") {
    if (assets.length < 1 || assets.length > 5) fail("ai_content_card_news_slide_count_invalid");
    if (assets.some((asset) => asset.role !== "slide")) fail("ai_content_card_news_slide_role_invalid");
    if (assets.some((asset) => asset.mimeType !== "image/png")) fail("ai_content_card_news_mime_type_invalid");
    if (
      requestedDimensions !== undefined
      && assets.some((asset) => (
        asset.width === undefined
        || asset.height === undefined
        || asset.width * requestedDimensions.height !== asset.height * requestedDimensions.width
      ))
    ) {
      fail("ai_content_card_news_dimensions_invalid");
    }
    if (!continuousIndexes(assets)) fail("ai_content_asset_index_invalid");
  } else if (source.outputFormat === "blog") {
    const htmlAssets = assets.filter((asset) => asset.role === "html" && asset.mimeType === "text/html");
    const inlineAssets = assets.filter((asset) => asset.role === "inline" && asset.mimeType === "image/png");
    if (htmlAssets.length !== 1) fail("ai_content_blog_html_asset_required");
    if (inlineAssets.length > 5) fail("ai_content_blog_inline_asset_count_invalid");
    if (assets.length !== htmlAssets.length + inlineAssets.length) fail("ai_content_blog_asset_count_invalid");
    if (htmlAssets[0].index !== 1) fail("ai_content_asset_index_invalid");
    if (!continuousIndexes(inlineAssets)) fail("ai_content_asset_index_invalid");
  } else if (source.outputFormat === "marketing_content") {
    if (assets.length < 1 || assets.length > 5) fail("ai_content_marketing_asset_invalid");
    if (assets.some((asset) => asset.role !== "creative" || asset.mimeType !== "image/png")) {
      fail("ai_content_marketing_asset_invalid");
    }
    if (
      requestedDimensions !== undefined
      && assets.some((asset) => (
        asset.width !== requestedDimensions.width || asset.height !== requestedDimensions.height
      ))
    ) {
      fail("ai_content_marketing_dimensions_mismatch");
    }
    if (!continuousIndexes(assets)) fail("ai_content_asset_index_invalid");
  } else {
    const scenes = assets.filter((asset) => asset.role === "scene" && asset.mimeType === "image/png");
    const videos = assets.filter((asset) => asset.role === "video" && asset.mimeType === "video/mp4");
    if (videos.length !== 1) fail("ai_content_reel_video_asset_required");
    if (scenes.length < 1 || scenes.length > 5 || assets.length !== scenes.length + videos.length) {
      fail("ai_content_reel_asset_invalid");
    }
    if (!continuousIndexes(scenes)) fail("ai_content_asset_index_invalid");
    if (scenes.some((asset) => asset.width !== 1080 || asset.height !== 1920)) fail("ai_content_reel_scene_dimensions_invalid");
    const video = videos[0];
    if (
      video.index !== 1
      || video.width !== 1080
      || video.height !== 1920
      || video.videoCodec !== "h264"
      || video.fps !== 30
      || video.audioCodec !== null
    ) {
      fail("ai_content_reel_video_metadata_invalid");
    }
    if (Math.abs((video.durationSeconds ?? 0) - scenes.length * 4) > 1 / 30) fail("ai_content_reel_duration_invalid");
  }

  return {
    version: "ai-content.v2",
    type: source.type as AiContentType,
    purpose: source.purpose,
    outputFormat: source.outputFormat as AiContentManifestV2["outputFormat"],
    title: text(source.title, "ai_content_manifest_title_invalid"),
    assets,
    content,
  };
}

export function parseAiContentManifest(
  type: AiContentType,
  value: unknown,
  requestedDimensions?: { width: number; height: number },
): AiContentManifest {
  const source = object(value, "ai_content_manifest_invalid");
  if (source.version === "ai-content.v1") return parseV1(type, source, requestedDimensions);
  if (source.version === "ai-content.v2") return parseV2(type, source, requestedDimensions);
  fail("ai_content_manifest_version_invalid");
}
