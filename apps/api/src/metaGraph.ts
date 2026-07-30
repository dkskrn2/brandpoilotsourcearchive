export interface MetaInstagramConnection {
  accessToken: string;
  instagramBusinessAccountId: string;
  instagramUsername: string | null;
  pageId: string | null;
  pageName: string | null;
  scopes: string[];
}

interface ResolveInstagramConnectionInput {
  accessToken: string;
  expectedInstagramBusinessAccountId?: string | null;
  fetchImpl?: typeof fetch;
  graphVersion?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function extractMetaError(payload: unknown) {
  const record = asRecord(payload);
  const error = asRecord(record?.error);
  return typeof error?.message === "string" ? error.message : "unknown_error";
}

function metaErrorNumber(payload: unknown, key: "code" | "error_subcode") {
  const error = asRecord(asRecord(payload)?.error);
  return typeof error?.[key] === "number" ? error[key] as number : null;
}

export class MetaGraphRequestError extends Error {
  readonly status: number;
  readonly code: number | null;
  readonly subcode: number | null;

  constructor({ status, code = null, subcode = null }: { status: number; code?: number | null; subcode?: number | null }) {
    super(`meta_graph_request_failed:${status}`);
    this.name = "MetaGraphRequestError";
    this.status = status;
    this.code = code;
    this.subcode = subcode;
  }
}

export interface MetaGraphPublishErrorClassification {
  errorCode: string;
  retryable: boolean;
  channelNeedsAttention: boolean;
}

const stableNonRetryablePublishErrors = new Set([
  "story_capability_required",
  "reel_video_required",
  "reel_video_invalid",
  "instagram_public_url_required",
  "instagram_rendered_images_required",
  "instagram_rendered_story_required",
  "instagram_manifest_delivery_format_mismatch",
  "instagram_media_container_error",
  "instagram_media_container_expired",
  "instagram_media_container_timeout"
]);

export function classifyMetaGraphPublishError(error: unknown): MetaGraphPublishErrorClassification {
  if (error instanceof MetaGraphRequestError) {
    if (error.status === 429) {
      return { errorCode: "meta_rate_limited", retryable: true, channelNeedsAttention: false };
    }
    if (error.status >= 500 && error.status <= 599) {
      return { errorCode: "meta_delivery_unknown", retryable: false, channelNeedsAttention: false };
    }
    if (error.status === 401 || error.code === 102 || error.code === 190) {
      return { errorCode: "meta_token_invalid", retryable: false, channelNeedsAttention: true };
    }
    if (error.status === 403 || error.code === 3 || error.code === 10 || error.code === 200) {
      return { errorCode: "meta_permission_denied", retryable: false, channelNeedsAttention: true };
    }
    if (error.status === 400) {
      return { errorCode: "instagram_media_invalid", retryable: false, channelNeedsAttention: false };
    }
    return { errorCode: "meta_graph_publish_failed", retryable: false, channelNeedsAttention: false };
  }

  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("instagram_manifest_fetch_failed:")) {
    return { errorCode: "instagram_manifest_fetch_failed", retryable: true, channelNeedsAttention: false };
  }
  if (stableNonRetryablePublishErrors.has(message)) {
    return { errorCode: message, retryable: false, channelNeedsAttention: false };
  }
  return { errorCode: "instagram_publish_failed", retryable: false, channelNeedsAttention: false };
}

async function readGraphResponse(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new MetaGraphRequestError({
      status: response.status,
      code: metaErrorNumber(payload, "code"),
      subcode: metaErrorNumber(payload, "error_subcode")
    });
  }
  return payload;
}

export async function getMetaGraphJson({
  path,
  params,
  fetchImpl,
  graphVersion,
  host = "graph.facebook.com"
}: {
  path: string;
  params: Record<string, string>;
  fetchImpl: typeof fetch;
  graphVersion: string;
  host?: "graph.facebook.com" | "graph.instagram.com";
}) {
  const url = new URL(`https://${host}/${graphVersion}/${path.replace(/^\//, "")}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return readGraphResponse(await fetchImpl(url.toString(), { method: "GET" }));
}

export async function postMetaGraphForm({
  path,
  body,
  fetchImpl,
  graphVersion,
  host = "graph.facebook.com"
}: {
  path: string;
  body: Record<string, string>;
  fetchImpl: typeof fetch;
  graphVersion: string;
  host?: "graph.facebook.com" | "graph.instagram.com";
}) {
  const url = `https://${host}/${graphVersion}/${path.replace(/^\//, "")}`;
  return readGraphResponse(await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString()
  }));
}

async function getGraphJson(path: string, params: Record<string, string>, fetchImpl: typeof fetch, graphVersion: string) {
  return getMetaGraphJson({ path, params, fetchImpl, graphVersion });
}

async function fetchGrantedScopes(accessToken: string, fetchImpl: typeof fetch, graphVersion: string) {
  try {
    const payload = await getGraphJson("/me/permissions", { access_token: accessToken }, fetchImpl, graphVersion);
    const permissions = Array.isArray(asRecord(payload)?.data) ? asRecord(payload)?.data as unknown[] : [];
    return permissions
      .map((permission) => asRecord(permission))
      .filter((permission): permission is Record<string, unknown> => Boolean(permission))
      .filter((permission) => permission.status === "granted")
      .map((permission) => permission.permission)
      .filter((permission): permission is string => typeof permission === "string");
  } catch {
    return [];
  }
}

function instagramAccountFrom(page: Record<string, unknown> | null) {
  return asRecord(page?.instagram_business_account)
    ?? asRecord(page?.connected_instagram_account);
}

export async function resolveInstagramConnection({
  accessToken,
  expectedInstagramBusinessAccountId,
  fetchImpl = fetch,
  graphVersion = process.env.META_GRAPH_VERSION || "v20.0"
}: ResolveInstagramConnectionInput): Promise<MetaInstagramConnection> {
  const payload = await getGraphJson(
    "/me/accounts",
    {
      access_token: accessToken,
      fields: "id,name,access_token,instagram_business_account{id,username,name},connected_instagram_account{id,username,name}",
      limit: "100"
    },
    fetchImpl,
    graphVersion
  );
  const pages = Array.isArray(asRecord(payload)?.data) ? asRecord(payload)?.data as unknown[] : [];

  for (const pageValue of pages) {
    const page = asRecord(pageValue);
    const instagramAccount = instagramAccountFrom(page);
    const instagramBusinessAccountId = instagramAccount?.id;
    if (typeof instagramBusinessAccountId !== "string" || instagramBusinessAccountId.length === 0) {
      continue;
    }

    const pageToken = typeof page?.access_token === "string" && page.access_token.length > 0
      ? page.access_token
      : accessToken;
    return {
      accessToken: pageToken,
      instagramBusinessAccountId,
      instagramUsername: typeof instagramAccount?.username === "string" ? instagramAccount.username : null,
      pageId: typeof page?.id === "string" ? page.id : "",
      pageName: typeof page?.name === "string" ? page.name : null,
      scopes: await fetchGrantedScopes(accessToken, fetchImpl, graphVersion)
    };
  }

  // Facebook Login's asset picker can grant an Instagram account while the
  // /me/accounts edge omits its nested object. Re-read each selected page with
  // its page token before treating the connection as missing.
  for (const pageValue of pages) {
    const page = asRecord(pageValue);
    const pageId = typeof page?.id === "string" ? page.id : "";
    if (!pageId) continue;
    const pageToken = typeof page?.access_token === "string" && page.access_token.length > 0
      ? page.access_token
      : accessToken;
    let detail: Record<string, unknown> | null = null;
    try {
      detail = asRecord(await getGraphJson(
        `/${pageId}`,
        {
          access_token: pageToken,
          fields: "id,name,instagram_business_account{id,username,name},connected_instagram_account{id,username,name}"
        },
        fetchImpl,
        graphVersion
      ));
    } catch {
      continue;
    }
    const instagramAccount = instagramAccountFrom(detail);
    const instagramBusinessAccountId = instagramAccount?.id;
    if (typeof instagramBusinessAccountId !== "string" || !instagramBusinessAccountId) continue;
    return {
      accessToken: pageToken,
      instagramBusinessAccountId,
      instagramUsername: typeof instagramAccount?.username === "string" ? instagramAccount.username : null,
      pageId,
      pageName: typeof page?.name === "string" ? page.name : null,
      scopes: await fetchGrantedScopes(accessToken, fetchImpl, graphVersion)
    };
  }

  // Instagram Login already verified the brand account. When Facebook Login
  // grants that same asset but omits the Page relationship, validate the known
  // account ID with each selected page token before accepting it.
  if (expectedInstagramBusinessAccountId) {
    for (const pageValue of pages) {
      const page = asRecord(pageValue);
      const pageId = typeof page?.id === "string" ? page.id : "";
      if (!pageId) continue;
      const pageToken = typeof page?.access_token === "string" && page.access_token.length > 0
        ? page.access_token
        : accessToken;
      const candidateTokens = [...new Set([pageToken, accessToken])];
      for (const candidateToken of candidateTokens) {
        let account: Record<string, unknown> | null = null;
        try {
          account = asRecord(await getGraphJson(
            `/${expectedInstagramBusinessAccountId}`,
            { access_token: candidateToken, fields: "id,username,name" },
            fetchImpl,
            graphVersion
          ));
        } catch {
          continue;
        }
        if (account?.id !== expectedInstagramBusinessAccountId) continue;
        return {
          accessToken: candidateToken,
          instagramBusinessAccountId: expectedInstagramBusinessAccountId,
          instagramUsername: typeof account.username === "string" ? account.username : null,
          pageId,
          pageName: typeof page?.name === "string" ? page.name : null,
          scopes: await fetchGrantedScopes(accessToken, fetchImpl, graphVersion)
        };
      }
    }

    try {
      const account = asRecord(await getGraphJson(
        `/${expectedInstagramBusinessAccountId}`,
        { access_token: accessToken, fields: "id,username,name" },
        fetchImpl,
        graphVersion
      ));
      if (account?.id === expectedInstagramBusinessAccountId) {
        return {
          accessToken,
          instagramBusinessAccountId: expectedInstagramBusinessAccountId,
          instagramUsername: typeof account.username === "string" ? account.username : null,
          pageId: null,
          pageName: null,
          scopes: await fetchGrantedScopes(accessToken, fetchImpl, graphVersion)
        };
      }
    } catch {
      // The token cannot access the brand's known Instagram account.
    }
  }

  throw new Error("meta_instagram_business_account_not_found");
}
