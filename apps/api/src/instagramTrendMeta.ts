import { getMetaGraphJson, MetaGraphRequestError } from "./metaGraph.js";
import { mapMetaTopMedia, type NormalizedInstagramTrendMedia } from "./instagramTrend.js";

const TOP_MEDIA_FIELDS = "id,caption,comments_count,like_count,media_type,media_url,permalink,timestamp";
const TOP_MEDIA_PAGE_LIMIT = 25;
const TOP_MEDIA_COLLECTION_LIMIT = 150;

export interface FetchInstagramHashtagTopMediaInput {
  accessToken: string;
  instagramBusinessAccountId: string;
  hashtag: string;
  fetchImpl?: typeof fetch;
  graphVersion?: string;
}

export interface FetchInstagramHashtagTopMediaResult {
  metaHashtagId: string;
  media: NormalizedInstagramTrendMedia[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pageData(payload: unknown): unknown[] {
  return isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
}

function afterCursor(payload: unknown): string | null {
  const paging = isRecord(payload) ? payload.paging : null;
  const cursors = isRecord(paging) ? paging.cursors : null;
  const after = isRecord(cursors) ? cursors.after : null;
  return typeof after === "string" && after.length > 0 ? after : null;
}

function stableError(error: unknown): Error {
  if (error instanceof MetaGraphRequestError) {
    if (error.status === 429 || error.status >= 500) {
      return new Error("instagram_trend_fetch_failed");
    }
    if (error.status === 401 || error.code === 102 || error.code === 190) {
      return new Error("instagram_reconnect_required");
    }
    if (error.status === 403 || error.code === 10 || error.code === 200) {
      return new Error("instagram_permission_required");
    }
  }
  return new Error("instagram_trend_fetch_failed");
}

async function fetchGraphJson(
  path: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
  graphVersion: string
): Promise<unknown> {
  try {
    return await getMetaGraphJson({ path, params, fetchImpl, graphVersion, host: "graph.facebook.com" });
  } catch (error) {
    throw stableError(error);
  }
}

export async function fetchInstagramHashtagTopMedia({
  accessToken,
  instagramBusinessAccountId,
  hashtag,
  fetchImpl = fetch,
  graphVersion = process.env.META_GRAPH_VERSION || "v20.0"
}: FetchInstagramHashtagTopMediaInput): Promise<FetchInstagramHashtagTopMediaResult> {
  const lookupPayload = await fetchGraphJson(
    "/ig_hashtag_search",
    { user_id: instagramBusinessAccountId, q: hashtag, access_token: accessToken },
    fetchImpl,
    graphVersion
  );
  const lookupData = isRecord(lookupPayload) && Array.isArray(lookupPayload.data) ? lookupPayload.data : [];
  const firstResult = isRecord(lookupData[0]) ? lookupData[0] : null;
  const metaHashtagId = firstResult?.id;
  if (typeof metaHashtagId !== "string" || metaHashtagId.length === 0) {
    throw new Error("instagram_hashtag_not_found");
  }

  const topMediaPath = `/${encodeURIComponent(metaHashtagId)}/top_media`;
  const collectedMedia: unknown[] = [];
  const visitedCursors = new Set<string>();
  let after: string | null = null;

  while (collectedMedia.length < TOP_MEDIA_COLLECTION_LIMIT) {
    const params: Record<string, string> = {
      user_id: instagramBusinessAccountId,
      fields: TOP_MEDIA_FIELDS,
      limit: String(TOP_MEDIA_PAGE_LIMIT),
      access_token: accessToken
    };
    if (after) params.after = after;

    const payload = await fetchGraphJson(topMediaPath, params, fetchImpl, graphVersion);
    const data = pageData(payload);
    collectedMedia.push(...data.slice(0, TOP_MEDIA_COLLECTION_LIMIT - collectedMedia.length));
    if (data.length === 0 || collectedMedia.length >= TOP_MEDIA_COLLECTION_LIMIT) break;

    const nextCursor = afterCursor(payload);
    if (!nextCursor || visitedCursors.has(nextCursor)) break;
    visitedCursors.add(nextCursor);
    after = nextCursor;
  }

  return { metaHashtagId, media: mapMetaTopMedia({ data: collectedMedia }) };
}
