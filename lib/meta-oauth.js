const DEFAULT_GRAPH_VERSION = "v20.0";
const DEFAULT_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments"
].join(",");
const DEFAULT_DEV_REDIRECT_URL = "http://127.0.0.1:4000/auth/meta/dev-complete";
const DEFAULT_ALLOWED_DEV_REDIRECT_ORIGINS = [
  "http://127.0.0.1:4000",
  "http://localhost:4000"
];

function requestOrigin(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}`;
}

function requestUrl(req) {
  return new URL(req.url || "/", requestOrigin(req));
}

function graphVersion(env = process.env) {
  return env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION;
}

function callbackUrl(req, env = process.env) {
  return env.META_REDIRECT_URI || `${requestOrigin(req)}/api/auth/meta/callback`;
}

function oauthScopes(env = process.env) {
  return env.META_OAUTH_SCOPES || DEFAULT_SCOPES;
}

function loginConfigId(env = process.env) {
  return env.META_LOGIN_CONFIG_ID || "";
}

function allowedDevRedirectOrigins(env = process.env) {
  if (!env.BRAND_PILOT_ALLOWED_DEV_REDIRECT_ORIGINS) {
    return DEFAULT_ALLOWED_DEV_REDIRECT_ORIGINS;
  }
  return env.BRAND_PILOT_ALLOWED_DEV_REDIRECT_ORIGINS
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isAllowedDevRedirect(value, env = process.env) {
  try {
    const url = new URL(value);
    return allowedDevRedirectOrigins(env).includes(url.origin);
  } catch {
    return false;
  }
}

function devRedirectUrl(value, env = process.env) {
  const requestedValue = value || env.BRAND_PILOT_DEV_REDIRECT_URL || DEFAULT_DEV_REDIRECT_URL;
  if (!isAllowedDevRedirect(requestedValue, env)) {
    throw new Error("invalid_dev_redirect");
  }
  return requestedValue;
}

function encodeState(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeState(value) {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return decoded && typeof decoded === "object" ? decoded : null;
  } catch {
    return null;
  }
}

function tokenPreview(token) {
  if (typeof token !== "string" || token.length === 0) {
    return "";
  }
  if (token.length <= 10) {
    return `${token.slice(0, 2)}...${token.slice(-2)}`;
  }
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store"
  });
  return res.end();
}

function methodNotAllowed(res, method) {
  res.setHeader("Allow", method);
  return res.status(405).json({ ok: false, error: "Method Not Allowed" });
}

function metaDialogUrl({ appId, redirectUri, state, scopes, env = process.env }) {
  const url = new URL(`https://www.facebook.com/${graphVersion(env)}/dialog/oauth`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes);
  const configId = loginConfigId(env);
  if (configId) {
    url.searchParams.set("config_id", configId);
  }
  return url;
}

async function exchangeCodeForToken({ code, redirectUri, env = process.env, fetcher = fetch }) {
  if (!env.META_APP_ID) {
    throw new Error("missing_meta_app_id");
  }
  if (!env.META_APP_SECRET) {
    throw new Error("missing_meta_app_secret");
  }

  const tokenUrl = new URL(`https://graph.facebook.com/${graphVersion(env)}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", env.META_APP_ID);
  tokenUrl.searchParams.set("client_secret", env.META_APP_SECRET);
  tokenUrl.searchParams.set("redirect_uri", redirectUri);
  tokenUrl.searchParams.set("code", code);

  const response = await fetcher(tokenUrl.toString());
  const payload = await response.json();
  if (!response.ok) {
    const errorMessage = payload?.error?.message || "meta_token_exchange_failed";
    throw new Error(errorMessage);
  }
  if (typeof payload.access_token !== "string" || payload.access_token.length === 0) {
    throw new Error("meta_token_missing");
  }
  return payload;
}

function completionUrl({ stateParam, tokenResponse, env = process.env }) {
  const state = decodeState(stateParam);
  const redirectTarget = devRedirectUrl(
    typeof state?.devRedirect === "string" ? state.devRedirect : null,
    env
  );
  const url = new URL(redirectTarget);
  url.searchParams.set("status", "connected");
  url.searchParams.set("token_preview", tokenPreview(tokenResponse.access_token));
  if (tokenResponse.expires_in !== undefined) {
    url.searchParams.set("expires_in", String(tokenResponse.expires_in));
  }
  if (stateParam) {
    url.searchParams.set("state", stateParam);
  }
  if (env.BRAND_PILOT_ALLOW_DEV_TOKEN_REDIRECT === "true") {
    url.searchParams.set("access_token", tokenResponse.access_token);
    if (tokenResponse.token_type) {
      url.searchParams.set("token_type", tokenResponse.token_type);
    }
  }
  return url;
}

function errorCompletionUrl({ stateParam, error, description, env = process.env }) {
  const state = decodeState(stateParam);
  const redirectTarget = devRedirectUrl(
    typeof state?.devRedirect === "string" ? state.devRedirect : null,
    env
  );
  const url = new URL(redirectTarget);
  url.searchParams.set("status", "error");
  url.searchParams.set("error", error);
  if (description) {
    url.searchParams.set("error_description", description);
  }
  if (stateParam) {
    url.searchParams.set("state", stateParam);
  }
  return url;
}

module.exports = {
  callbackUrl,
  completionUrl,
  devRedirectUrl,
  errorCompletionUrl,
  exchangeCodeForToken,
  methodNotAllowed,
  metaDialogUrl,
  oauthScopes,
  redirect,
  requestUrl,
  tokenPreview,
  encodeState
};
