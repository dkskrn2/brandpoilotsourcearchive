const INSTAGRAM_TREND_TTL_MS = 24 * 60 * 60 * 1000;
const MEDIA_TYPES = ["IMAGE", "CAROUSEL_ALBUM", "VIDEO"] as const;

type InstagramMediaType = typeof MEDIA_TYPES[number];
export type InstagramTrendKind = "image" | "carousel" | "reel" | "video";

export interface NormalizedInstagramTrendMedia {
  instagramMediaId: string;
  username: string | null;
  caption: string | null;
  mediaType: InstagramMediaType;
  mediaUrl: string | null;
  previewUrl: string | null;
  permalink: string;
  postedAt: string | null;
  likeCount: number | null;
  commentsCount: number | null;
  kind: InstagramTrendKind;
  metaRank: number;
  rawMetadata: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeInstagramHashtag(input: unknown): { displayTag: string; normalizedTag: string } {
  if (typeof input !== "string") throw new Error("invalid_hashtag");
  let displayTag = input.trim().normalize("NFKC");
  if (displayTag.startsWith("#")) displayTag = displayTag.slice(1);
  if (
    displayTag.length === 0 ||
    Array.from(displayTag).length > 100 ||
    !/^[_\p{L}\p{Nd}]+$/u.test(displayTag)
  ) throw new Error("invalid_hashtag");
  return { displayTag, normalizedTag: displayTag.toLocaleLowerCase("und") };
}

export function isFreshInstagramTrendCache(
  refreshedAt: Date | string | null | undefined,
  now: Date = new Date(),
  ttlMs: number = INSTAGRAM_TREND_TTL_MS
): boolean {
  const refreshedTime = refreshedAt instanceof Date || typeof refreshedAt === "string"
    ? new Date(refreshedAt).getTime()
    : Number.NaN;
  const nowTime = now instanceof Date ? now.getTime() : Number.NaN;
  return Number.isFinite(refreshedTime) && Number.isFinite(nowTime) && Number.isFinite(ttlMs) && ttlMs > 0
    && nowTime >= refreshedTime && nowTime - refreshedTime < ttlMs;
}

export function classifyInstagramTrendKind(mediaType: string, permalink: string): InstagramTrendKind {
  if (mediaType === "IMAGE") return "image";
  if (mediaType === "CAROUSEL_ALBUM") return "carousel";
  if (mediaType === "VIDEO") {
    try {
      const pathname = new URL(permalink).pathname;
      if (pathname.startsWith("/reel/") && pathname.slice("/reel/".length).split("/")[0]) return "reel";
    } catch {
      // Invalid permalinks are ordinary video media.
    }
  }
  return "video";
}

function safeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => safeValue(item, seen));
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) result[key] = safeValue(item, seen);
  return result;
}

function safeMetadata(value: Record<string, unknown>): Record<string, unknown> {
  return safeValue(value, new WeakSet<object>()) as Record<string, unknown>;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

function childPreview(item: Record<string, unknown>): string | null {
  const children = isRecord(item.children) && Array.isArray(item.children.data) ? item.children.data : [];
  for (const child of children) {
    if (isRecord(child) && nonEmptyString(child.media_url)) return child.media_url;
  }
  return nonEmptyString(item.thumbnail_url) ? item.thumbnail_url : null;
}

export function mapMetaTopMedia(payload: unknown): NormalizedInstagramTrendMedia[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
  const result: NormalizedInstagramTrendMedia[] = [];
  const ids = new Set<string>();
  for (const value of payload.data) {
    if (result.length >= 50 || !isRecord(value)) break;
    const mediaType = value.media_type;
    if (!nonEmptyString(value.id) || !MEDIA_TYPES.includes(mediaType as InstagramMediaType) || !nonEmptyString(value.permalink)) continue;
    if (ids.has(value.id)) continue;
    ids.add(value.id);
    const typedMediaType = mediaType as InstagramMediaType;
    const mediaUrl = typeof value.media_url === "string" ? value.media_url : null;
    const previewUrl = typedMediaType === "CAROUSEL_ALBUM"
      ? childPreview(value) ?? mediaUrl
      : mediaUrl;
    result.push({
      instagramMediaId: value.id,
      username: typeof value.username === "string" ? value.username : null,
      caption: typeof value.caption === "string" ? value.caption : null,
      mediaType: typedMediaType,
      mediaUrl,
      previewUrl,
      permalink: value.permalink,
      postedAt: typeof value.timestamp === "string" ? value.timestamp : null,
      likeCount: count(value.like_count),
      commentsCount: count(value.comments_count),
      kind: classifyInstagramTrendKind(typedMediaType, value.permalink),
      metaRank: result.length + 1,
      rawMetadata: safeMetadata(value)
    });
  }
  return result;
}
