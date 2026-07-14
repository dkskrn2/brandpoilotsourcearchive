import { MetaGraphRequestError } from "./metaGraph.js";

export const instagramLoginScopes = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_messages",
] as const;

export interface InstagramLoginConnection {
  instagramBusinessAccountId: string;
  instagramUsername: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function errorCode(payload: unknown) {
  const error = asRecord(asRecord(payload)?.error);
  return typeof error?.code === "number" ? error.code : null;
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new MetaGraphRequestError({ status: response.status, code: errorCode(payload) });
  return payload;
}

export function buildInstagramLoginAuthorizeUrl({ appId, redirectUri, state }: {
  appId: string;
  redirectUri: string;
  state: string;
}) {
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", instagramLoginScopes.join(","));
  url.searchParams.set("state", state);
  return url.toString();
}

export async function resolveInstagramLoginConnection({
  accessToken,
  fetchImpl = fetch,
  graphVersion = process.env.META_GRAPH_VERSION || "v23.0",
}: {
  accessToken: string;
  fetchImpl?: typeof fetch;
  graphVersion?: string;
}): Promise<InstagramLoginConnection> {
  const url = new URL(`https://graph.instagram.com/${graphVersion}/me`);
  url.searchParams.set("fields", "id,username");
  url.searchParams.set("access_token", accessToken);
  const payload = asRecord(await readJson(await fetchImpl(url.toString(), { method: "GET" })));
  const accountId = typeof payload?.id === "string"
    ? payload.id
    : typeof payload?.user_id === "string"
      ? payload.user_id
      : null;
  if (!accountId) throw new Error("meta_instagram_business_account_not_found");
  return {
    instagramBusinessAccountId: accountId,
    instagramUsername: typeof payload?.username === "string" ? payload.username : null,
  };
}

export async function exchangeInstagramLoginCode({
  code,
  appId,
  appSecret,
  redirectUri,
  fetchImpl = fetch,
}: {
  code: string;
  appId: string;
  appSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}) {
  const body = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });
  const shortLived = asRecord(await readJson(await fetchImpl("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })));
  if (typeof shortLived?.access_token !== "string" || !shortLived.access_token) {
    throw new Error("meta_oauth_token_missing");
  }

  const exchangeUrl = new URL("https://graph.instagram.com/access_token");
  exchangeUrl.searchParams.set("grant_type", "ig_exchange_token");
  exchangeUrl.searchParams.set("client_secret", appSecret);
  exchangeUrl.searchParams.set("access_token", shortLived.access_token);
  const longLived = asRecord(await readJson(await fetchImpl(exchangeUrl.toString(), { method: "GET" })));
  const accessToken = typeof longLived?.access_token === "string" ? longLived.access_token : shortLived.access_token;
  const expiresIn = typeof longLived?.expires_in === "number"
    ? longLived.expires_in
    : typeof shortLived?.expires_in === "number"
      ? shortLived.expires_in
      : null;
  return { accessToken, expiresIn };
}
