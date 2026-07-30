import { MetaGraphRequestError } from "./metaGraph.js";

export const instagramTrendFacebookScopes = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
] as const;

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
  return asRecord(payload) ?? {};
}

export function buildFacebookLoginAuthorizeUrl({ appId, redirectUri, state, graphVersion = process.env.META_GRAPH_VERSION || "v23.0" }: {
  appId: string;
  redirectUri: string;
  state: string;
  graphVersion?: string;
}) {
  const url = new URL(`https://www.facebook.com/${graphVersion}/dialog/oauth`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", instagramTrendFacebookScopes.join(","));
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeFacebookLoginCode({
  code,
  appId,
  appSecret,
  redirectUri,
  fetchImpl = fetch,
  graphVersion = process.env.META_GRAPH_VERSION || "v23.0",
}: {
  code: string;
  appId: string;
  appSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
  graphVersion?: string;
}) {
  const shortUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);
  shortUrl.searchParams.set("client_id", appId);
  shortUrl.searchParams.set("client_secret", appSecret);
  shortUrl.searchParams.set("redirect_uri", redirectUri);
  shortUrl.searchParams.set("code", code);
  const shortLived = await readJson(await fetchImpl(shortUrl.toString(), { method: "GET" }));
  if (typeof shortLived.access_token !== "string" || !shortLived.access_token) throw new Error("meta_oauth_token_missing");

  const longUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", appId);
  longUrl.searchParams.set("client_secret", appSecret);
  longUrl.searchParams.set("fb_exchange_token", shortLived.access_token);
  const longLived = await readJson(await fetchImpl(longUrl.toString(), { method: "GET" }));
  const accessToken = typeof longLived.access_token === "string" && longLived.access_token
    ? longLived.access_token
    : shortLived.access_token;
  const expiresIn = typeof longLived.expires_in === "number"
    ? longLived.expires_in
    : typeof shortLived.expires_in === "number"
      ? shortLived.expires_in
      : null;
  return { accessToken, expiresIn };
}
