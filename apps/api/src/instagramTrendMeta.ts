import { getMetaGraphJson, MetaGraphRequestError } from "./metaGraph.js";
import { mapMetaTopMedia, type NormalizedInstagramTrendMedia } from "./instagramTrend.js";

const TOP_MEDIA_FIELDS = "id,caption,comments_count,like_count,media_type,media_url,permalink,timestamp,username,children{id,media_type,media_url,thumbnail_url,permalink}";

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

function stableError(error: unknown): Error {
  if (error instanceof MetaGraphRequestError) {
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

  const topMediaPayload = await fetchGraphJson(
    `/${metaHashtagId}/top_media`,
    {
      user_id: instagramBusinessAccountId,
      fields: TOP_MEDIA_FIELDS,
      limit: "50",
      access_token: accessToken
    },
    fetchImpl,
    graphVersion
  );

  return { metaHashtagId, media: mapMetaTopMedia(topMediaPayload) };
}
