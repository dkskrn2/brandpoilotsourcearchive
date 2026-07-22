import type {
  AiContentAsset,
  AiContentManifest,
  AiContentType,
  BlogContent,
  CardNewsContent,
  MarketingContent,
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
  if (!(["slide", "cover", "inline", "html", "creative"] as unknown[]).includes(role)) {
    fail("ai_content_asset_role_invalid");
  }
  const mimeType = source.mimeType;
  if (mimeType !== "image/png" && mimeType !== "text/html") fail("ai_content_asset_mime_type_invalid");

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

export function parseAiContentManifest(
  type: AiContentType,
  value: unknown,
  requestedDimensions?: { width: number; height: number },
): AiContentManifest {
  const source = object(value, "ai_content_manifest_invalid");
  if (source.version !== "ai-content.v1") fail("ai_content_manifest_version_invalid");
  if (source.type !== type) fail("ai_content_manifest_type_mismatch");

  const title = text(source.title, "ai_content_manifest_title_invalid");
  const assets = parseAssets(source.assets);

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
    return { version: "ai-content.v1", type, title, assets, content: parseCardNewsContent(source.content) };
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
    return { version: "ai-content.v1", type, title, assets, content };
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
  return { version: "ai-content.v1", type, title, assets, content: parseMarketingContent(source.content) };
}
