const HANDLE = /^[a-z0-9._]{1,30}$/;
const MEDIA_LIMIT = 25;
const PROFILE_FIELDS = [
  "id", "username", "biography", "followers_count", "media_count", "website",
].join(",");
const MEDIA_FIELDS = [
  "id", "username", "caption", "comments_count", "like_count", "view_count",
  "media_type", "media_url", "permalink", "timestamp",
].join(",");

type RecordValue = Record<string, unknown>;

export interface MetaAppUsage {
  callCount: number | null;
  totalTime: number | null;
  totalCpuTime: number | null;
}

export interface InstagramBusinessDiscoveryProfile {
  providerAccountId: string;
  username: string;
  biography: string | null;
  followersCount: number | null;
  mediaCount: number | null;
  website: string | null;
  name: string | null;
  profilePictureUrl: string | null;
}

export interface InstagramBusinessDiscoveryMedia {
  providerMediaId: string;
  username: string | null;
  caption: string | null;
  commentsCount: number | null;
  likeCount: number | null;
  viewCount: number | null;
  mediaType: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  mediaUrl: string | null;
  permalink: string;
  timestamp: string | null;
}

export interface InstagramBusinessDiscoveryResult {
  usage: MetaAppUsage;
  profile: InstagramBusinessDiscoveryProfile;
  media: InstagramBusinessDiscoveryMedia[];
}

export interface FetchInstagramBusinessDiscoveryInput {
  igUserId: string;
  accessToken: string;
  username: string;
  fetcher?: typeof fetch;
  graphVersion?: string;
}

function record(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isoTimestamp(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function normalizeInstagramHandle(value: string): string {
  const input = value.trim();
  let candidate = input.startsWith("@") ? input.slice(1) : input;
  if (/^https?:\/\//i.test(candidate)) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      throw new Error("reference_channel_handle_invalid");
    }
    if (!/^(?:www\.)?instagram\.com$/i.test(url.hostname)) {
      throw new Error("reference_channel_handle_invalid");
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 1) throw new Error("reference_channel_handle_invalid");
    candidate = segments[0]!;
  }
  candidate = candidate.toLowerCase();
  if (!HANDLE.test(candidate)) throw new Error("reference_channel_handle_invalid");
  return candidate;
}

function parseUsage(headers: Headers): MetaAppUsage {
  try {
    const value = record(JSON.parse(headers.get("x-app-usage") ?? "{}"));
    return {
      callCount: count(value?.call_count),
      totalTime: count(value?.total_time),
      totalCpuTime: count(value?.total_cputime),
    };
  } catch {
    return { callCount: null, totalTime: null, totalCpuTime: null };
  }
}

function stableProviderError(status: number, payload: unknown): Error {
  const error = record(record(payload)?.error);
  const code = count(error?.code);
  const subcode = count(error?.error_subcode);
  if (status === 429 || code === 4 || code === 17 || code === 32 || code === 613) {
    return new Error("instagram_rate_limited");
  }
  if (status === 401 || code === 102 || code === 190) {
    return new Error("instagram_reconnect_required");
  }
  if (status === 403 || code === 10 || code === 200) {
    return new Error("instagram_permission_required");
  }
  if (status === 400 && (code === 803 || (code === 100 && subcode === 33))) {
    return new Error("reference_channel_ineligible");
  }
  return new Error("instagram_business_discovery_failed");
}

function mediaRow(value: unknown): InstagramBusinessDiscoveryMedia | null {
  const row = record(value);
  const providerMediaId = text(row?.id);
  const permalink = text(row?.permalink);
  const mediaType = text(row?.media_type);
  if (!providerMediaId || !permalink || !["IMAGE", "VIDEO", "CAROUSEL_ALBUM"].includes(mediaType ?? "")) return null;
  return {
    providerMediaId,
    username: text(row?.username),
    caption: text(row?.caption),
    commentsCount: count(row?.comments_count),
    likeCount: count(row?.like_count),
    viewCount: count(row?.view_count),
    mediaType: mediaType as InstagramBusinessDiscoveryMedia["mediaType"],
    mediaUrl: text(row?.media_url),
    permalink,
    timestamp: isoTimestamp(row?.timestamp),
  };
}

export async function fetchInstagramBusinessDiscovery({
  igUserId,
  accessToken,
  username: rawUsername,
  fetcher = fetch,
  graphVersion = process.env.META_GRAPH_VERSION || "v20.0",
}: FetchInstagramBusinessDiscoveryInput): Promise<InstagramBusinessDiscoveryResult> {
  const username = normalizeInstagramHandle(rawUsername);
  const fields = `business_discovery.username(${username}){${PROFILE_FIELDS},media.limit(${MEDIA_LIMIT}){${MEDIA_FIELDS}}}`;
  const url = new URL(`https://graph.facebook.com/${encodeURIComponent(graphVersion)}/${encodeURIComponent(igUserId)}`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", accessToken);

  let response: Response;
  try {
    response = await fetcher(url);
  } catch {
    throw new Error("instagram_business_discovery_failed");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("instagram_business_discovery_failed");
  }
  if (!response.ok) throw stableProviderError(response.status, payload);

  const discovery = record(record(payload)?.business_discovery);
  const providerAccountId = text(discovery?.id);
  const resolvedUsername = text(discovery?.username)?.toLowerCase() ?? null;
  if (!providerAccountId || resolvedUsername !== username) {
    throw new Error("instagram_business_discovery_invalid");
  }
  const media = record(discovery?.media);
  const data = Array.isArray(media?.data) ? media.data : [];

  return {
    usage: parseUsage(response.headers),
    profile: {
      providerAccountId,
      username: resolvedUsername,
      biography: text(discovery?.biography),
      followersCount: count(discovery?.followers_count),
      mediaCount: count(discovery?.media_count),
      website: text(discovery?.website),
      name: text(discovery?.name),
      profilePictureUrl: text(discovery?.profile_picture_url),
    },
    media: data.slice(0, MEDIA_LIMIT).map(mediaRow).filter((item): item is InstagramBusinessDiscoveryMedia => item !== null),
  };
}
