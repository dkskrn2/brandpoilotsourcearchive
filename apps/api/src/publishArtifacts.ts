import path from "node:path";
import type { PublishArtifactAssetDto, PublishArtifactDescriptorDto } from "./types.js";

export interface NormalizePublishArtifactInput {
  manifest: unknown;
  outputJson: unknown;
  fallbackTitle: string;
  manifestUrl?: string | null;
  allowedRemoteOrigins?: readonly string[];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function extensionFor(url: string) {
  try {
    return path.extname(new URL(url).pathname).toLowerCase();
  } catch {
    return path.extname(url.split(/[?#]/, 1)[0]).toLowerCase();
  }
}

function mimeTypeFor(url: string, provided: unknown) {
  const explicit = nonEmptyString(provided);
  if (explicit) return explicit.toLowerCase().split(";", 1)[0];
  switch (extensionFor(url)) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".avif": return "image/avif";
    case ".mp4": return "video/mp4";
    case ".webm": return "video/webm";
    case ".mov": return "video/quicktime";
    case ".html":
    case ".htm": return "text/html";
    case ".txt": return "text/plain";
    default: return "application/octet-stream";
  }
}

function fileNameFor(url: string, record: Record<string, unknown>) {
  const provided = nonEmptyString(record.fileName ?? record.filename ?? record.name);
  if (provided) return path.basename(provided.replace(/\\/g, "/"));
  try {
    const name = path.posix.basename(new URL(url).pathname);
    return decodeURIComponent(name) || "artifact";
  } catch {
    return path.basename(url.split(/[?#]/, 1)[0]) || "artifact";
  }
}

function browserAssetUrl(rawUrl: string, manifestUrl?: string | null, allowedOrigins: readonly string[] = []) {
  try {
    const url = manifestUrl ? new URL(rawUrl, manifestUrl) : new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const configuredOrigins = new Set(allowedOrigins.flatMap((value) => {
      try { return [new URL(value).origin]; } catch { return []; }
    }));
    const isVercelBlob = url.protocol === "https:" && url.hostname.endsWith(".public.blob.vercel-storage.com");
    if (configuredOrigins.size > 0 && !configuredOrigins.has(url.origin) && !isVercelBlob) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function assetFrom(
  value: unknown,
  manifestUrl?: string | null,
  allowedOrigins: readonly string[] = []
): PublishArtifactAssetDto | null {
  const record = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const rawUrl = nonEmptyString(typeof value === "string" ? value : record.url ?? record.publicUrl ?? record.src ?? record.href);
  if (!rawUrl) return null;
  const url = browserAssetUrl(rawUrl, manifestUrl, allowedOrigins);
  if (!url) return null;
  return {
    url,
    fileName: fileNameFor(url, record),
    mimeType: mimeTypeFor(url, record.mimeType ?? record.contentType ?? record.type),
    width: positiveInteger(record.width),
    height: positiveInteger(record.height)
  };
}

function valuesFor(record: Record<string, unknown>, keys: string[]) {
  return keys.flatMap((key) => {
    const value = record[key];
    return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  });
}

function uniqueAssets(values: unknown[], manifestUrl?: string | null, allowedOrigins: readonly string[] = []) {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const asset = assetFrom(value, manifestUrl, allowedOrigins);
    if (!asset || seen.has(asset.url)) return [];
    seen.add(asset.url);
    return [asset];
  });
}

function isImage(asset: PublishArtifactAssetDto) {
  return asset.mimeType.startsWith("image/");
}

function isVideo(asset: PublishArtifactAssetDto) {
  return asset.mimeType.startsWith("video/");
}

function isHtml(asset: PublishArtifactAssetDto) {
  return asset.mimeType === "text/html" || asset.mimeType === "application/xhtml+xml";
}

function inlineHtml(value: unknown) {
  const direct = nonEmptyString(value);
  if (direct?.startsWith("<")) return direct;
  const record = asRecord(value);
  const content = nonEmptyString(record.content ?? record.source ?? record.markup);
  return content?.startsWith("<") ? content : null;
}

function textContent(record: Record<string, unknown>) {
  return nonEmptyString(record.text ?? record.body ?? record.caption ?? record.content);
}

export function normalizePublishArtifact({
  manifest,
  outputJson,
  fallbackTitle,
  manifestUrl,
  allowedRemoteOrigins = []
}: NormalizePublishArtifactInput): PublishArtifactDescriptorDto {
  const manifestRecord = asRecord(manifest);
  const outputRecord = asRecord(outputJson);
  const deliveryFormat = nonEmptyString(
    manifestRecord.deliveryFormat
      ?? manifestRecord.delivery_format
      ?? outputRecord.deliveryFormat
      ?? outputRecord.delivery_format
      ?? outputRecord.format
  );

  const explicitVideoAssets = uniqueAssets([
    ...valuesFor(manifestRecord, ["video"]),
    ...valuesFor(outputRecord, ["video"])
  ], manifestUrl, allowedRemoteOrigins).filter(isVideo);
  const explicitImageAssets = uniqueAssets([
    ...valuesFor(manifestRecord, ["cards", "images", "story", "scenes", "image"]),
    ...valuesFor(outputRecord, ["cards", "images", "story", "scenes", "image"])
  ], manifestUrl, allowedRemoteOrigins).filter(isImage);
  const genericAssets = uniqueAssets([
    ...valuesFor(manifestRecord, ["assets", "files", "html"]),
    ...valuesFor(outputRecord, ["assets", "files", "html"])
  ], manifestUrl, allowedRemoteOrigins);
  const allAssets = uniqueAssets([...explicitVideoAssets, ...explicitImageAssets, ...genericAssets], manifestUrl, allowedRemoteOrigins);
  const videoAssets = uniqueAssets([...explicitVideoAssets, ...allAssets.filter(isVideo)], manifestUrl, allowedRemoteOrigins);
  const imageAssets = uniqueAssets([...explicitImageAssets, ...allAssets.filter(isImage)], manifestUrl, allowedRemoteOrigins);
  const htmlAssets = allAssets.filter(isHtml);
  const poster = uniqueAssets([
    ...valuesFor(manifestRecord, ["cover", "poster", "posterUrl"]),
    ...valuesFor(outputRecord, ["cover", "poster", "posterUrl"])
  ], manifestUrl, allowedRemoteOrigins).find(isImage) ?? null;
  const html = inlineHtml(manifestRecord.html) ?? inlineHtml(outputRecord.html);
  const bodyText = textContent(outputRecord) ?? textContent(manifestRecord);

  if (videoAssets.length > 0) {
    return { kind: "video", deliveryFormat, assets: videoAssets, posterUrl: poster?.url ?? null, html: null, text: null };
  }
  if (html || htmlAssets.length > 0) {
    return { kind: "html", deliveryFormat, assets: htmlAssets, posterUrl: null, html, text: null };
  }
  const galleryHint = Array.isArray(manifestRecord.cards)
    || Array.isArray(outputRecord.cards)
    || deliveryFormat?.toLowerCase().includes("carousel") === true
    || deliveryFormat?.toLowerCase().includes("gallery") === true;
  if (imageAssets.length > 1 || (galleryHint && imageAssets.length > 0)) {
    return { kind: "image_gallery", deliveryFormat, assets: imageAssets, posterUrl: null, html: null, text: null };
  }
  if (imageAssets.length === 1) {
    return { kind: "image", deliveryFormat, assets: imageAssets, posterUrl: null, html: null, text: null };
  }
  if (bodyText) {
    return { kind: "text", deliveryFormat, assets: allAssets, posterUrl: null, html: null, text: bodyText };
  }
  return {
    kind: "unknown",
    deliveryFormat,
    assets: allAssets,
    posterUrl: poster?.url ?? null,
    html: null,
    text: nonEmptyString(outputRecord.title ?? manifestRecord.title) ?? nonEmptyString(fallbackTitle)
  };
}
