import cors from "@fastify/cors";
import { randomUUID, timingSafeEqual } from "node:crypto";
import Fastify, { LogController } from "fastify";
import type { FastifyLoggerOptions } from "fastify/types/logger";
import type { FastifyInstance } from "fastify";
import { instagramFormats } from "./instagramFormats.js";
import { sanitizeInstagramCapabilityMetadata } from "./instagramCapabilities.js";
import { resolveInstagramConnection } from "./metaGraph.js";
import { buildInstagramLoginAuthorizeUrl, exchangeInstagramLoginCode, instagramLoginScopes, resolveInstagramLoginConnection } from "./instagramLoginGraph.js";
import { StoryCapabilityRequiredError } from "./repository.js";
import type { ApiRepository, Channel, InstagramDeliveryFormat, InstagramFormatSettingsInput, SourceType, SupportRequestCategory, SupportRequestStatus } from "./types.js";
import { createKakaoAuthStore, type KakaoProfile } from "./kakaoAuth.js";

const channels = new Set(["instagram", "threads", "tiktok", "youtube", "x"]);
const sourceTypes = new Set(["owned", "reference"]);
const supportRequestCategories = new Set(["bug", "feature", "channel", "account", "other"]);
const supportRequestStatuses = new Set(["new", "in_progress", "resolved"]);
const topicRowStatuses = new Set(["uploaded", "queued", "used", "skipped", "invalid", "failed", "disabled"]);
const instagramFormatSet = new Set<string>(instagramFormats);
const defaultDevBrandId = "00000000-0000-4000-8000-000000000100";
const maxBrandProfileShortFieldLength = 30;
const kakaoStateCookiePrefix = "bp_kakao_state_";
const instagramLoginStateCookie = "bp_instagram_login_state";
const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

interface CreateServerOptions {
  repository: ApiRepository;
  workerApiToken?: string;
  cronSecret?: string;
  kakaoAuth?: ReturnType<typeof createKakaoAuthStore>;
  kakao?: { restApiKey: string; clientSecret?: string; redirectUri: string; frontendUrl: string };
  instagramLogin?: { appId: string; appSecret: string; redirectUri: string; frontendUrl: string };
  logger?: boolean | FastifyLoggerOptions;
}

function asChannel(value: string): Channel {
  if (!channels.has(value)) {
    throw new Error("invalid_channel");
  }
  return value as Channel;
}

function asSourceType(value: unknown): SourceType | null {
  return typeof value === "string" && sourceTypes.has(value) ? (value as SourceType) : null;
}

function asSupportRequestCategory(value: unknown): SupportRequestCategory | null {
  return typeof value === "string" && supportRequestCategories.has(value) ? (value as SupportRequestCategory) : null;
}

function asSupportRequestStatus(value: unknown): SupportRequestStatus | null {
  return typeof value === "string" && supportRequestStatuses.has(value) ? (value as SupportRequestStatus) : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function hasOverlongBrandProfileShortField(value: Record<string, unknown>) {
  return [value.industry, value.primaryCustomer].some(
    (field) => typeof field === "string" && field.length > maxBrandProfileShortFieldLength
  );
}

function validateInstagramFormatSettings(value: unknown):
  | { input: InstagramFormatSettingsInput; error?: never }
  | { input?: never; error: string } {
  if (!isObject(value)) return { error: "invalid_body" };
  if (Object.prototype.hasOwnProperty.call(value, "rotationOrder")) {
    return { error: "instagram_rotation_order_read_only" };
  }

  const input: InstagramFormatSettingsInput = {};
  let hasEffectiveChange = false;
  if (Object.prototype.hasOwnProperty.call(value, "brandColor")) {
    if (value.brandColor !== null && typeof value.brandColor !== "string") {
      return { error: "invalid_brand_color" };
    }
    const brandColor = typeof value.brandColor === "string" ? value.brandColor.trim() || null : null;
    if (brandColor && brandColor.length > 30) return { error: "brand_color_too_long" };
    input.brandColor = brandColor;
    hasEffectiveChange = true;
  }

  if (Object.prototype.hasOwnProperty.call(value, "formats")) {
    if (!Array.isArray(value.formats)) return { error: "invalid_instagram_formats" };
    const seen = new Set<string>();
    const formats: NonNullable<InstagramFormatSettingsInput["formats"]> = [];
    for (const item of value.formats) {
      if (!isObject(item)) return { error: "invalid_instagram_formats" };
      if (Object.prototype.hasOwnProperty.call(item, "rotationOrder")) {
        return { error: "instagram_rotation_order_read_only" };
      }
      if (typeof item.format !== "string" || !instagramFormatSet.has(item.format)) {
        return { error: "invalid_instagram_format" };
      }
      if (typeof item.enabled !== "boolean") return { error: "invalid_instagram_formats" };
      if (seen.has(item.format)) return { error: "duplicate_instagram_format" };
      seen.add(item.format);
      formats.push({ format: item.format as InstagramDeliveryFormat, enabled: item.enabled });
    }
    if (formats.length > 0) {
      input.formats = formats;
      hasEffectiveChange = true;
    }
  }

  return hasEffectiveChange ? { input } : { error: "instagram_formats_update_required" };
}

function tokenPreview(token: string) {
  if (token.length <= 10) {
    return `${token.slice(0, 2)}...${token.slice(-2)}`;
  }
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

function expiresAtFromSeconds(value: unknown) {
  if (typeof value !== "string") return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function htmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function readCookie(header: string | undefined, name: string) {
  return header?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
}

function cookie(name: string, value: string, maxAge: number, secure = false) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function kakaoStateCookieName(state: string) {
  return uuidPattern.test(state) ? `${kakaoStateCookiePrefix}${state}` : null;
}

function hasRequiredTopicHeaders(csvText: string) {
  const headerLine = csvText.split(/\r?\n/).find((line) => line.trim().length > 0);
  if (!headerLine) return false;
  const headers = headerLine.split(",").map((header) => header.trim());
  return headers.includes("topic_title") && headers.includes("topic_angle");
}

function isSourceDuplicateError(error: unknown) {
  return isObject(error) &&
    error.code === "23505" &&
    error.constraint === "source_urls_brand_type_hash_active_unique";
}

function safeInternalErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown_error";
  const match = /^([a-z][a-z0-9_]*)/.exec(message);
  return match?.[1] ?? "unclassified_error";
}

function matchesBearerSecret(header: string | undefined, secret: string | undefined) {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const candidate = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function createFastifyOptions(logger?: boolean | FastifyLoggerOptions) {
  return {
    logger: logger ?? process.env.NODE_ENV !== "test",
    logController: new LogController({ disableRequestLogging: true })
  };
}

export function createServer(
  { repository, workerApiToken, cronSecret, kakaoAuth, kakao, instagramLogin, logger }: CreateServerOptions,
  app: FastifyInstance = Fastify(createFastifyOptions(logger))
) {
  void app.register(cors, { origin: true, credentials: true, methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] });

  app.setErrorHandler((error, request, reply) => {
    const message = error instanceof Error ? error.message : "unknown_error";
    if (message === "invalid_channel") {
      reply.code(400).send({ error: "invalid_channel" });
      return;
    }
    if (message.endsWith("_not_found")) {
      reply.code(404).send({ error: message });
      return;
    }
    if (message === "topic_upload_invalid_csv" || message === "faq_upload_invalid_file") {
      reply.code(400).send({ error: message });
      return;
    }
    if (message === "source_update_required") {
      reply.code(400).send({ error: message });
      return;
    }
    if (message === "source_url_invalid") {
      reply.code(400).send({ error: message });
      return;
    }
    if (message === "source_reference_limit_exceeded") {
      reply.code(400).send({ error: message });
      return;
    }
    if (message === "brand_color_too_long") {
      reply.code(400).send({ error: message });
      return;
    }
    if (error instanceof StoryCapabilityRequiredError || message === "story_capability_required") {
      reply.code(409).send({ error: "story_capability_required" });
      return;
    }
    if (isSourceDuplicateError(error)) {
      reply.code(409).send({ error: "source_url_duplicate" });
      return;
    }
    request.log.error({
      event: "request_failed",
      errorCode: safeInternalErrorCode(error),
      requestId: request.id,
      method: request.method,
      route: request.routeOptions.url ?? request.url.split("?", 1)[0]
    }, "request_failed");
    reply.code(500).send({ error: "internal_error" });
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!kakaoAuth || request.url.startsWith("/health") || request.url.startsWith("/auth/") || request.url.startsWith("/worker/") || request.url.startsWith("/internal/cron/")) return;
    const token = readCookie(request.headers.cookie, "bp_session");
    const session = token ? await kakaoAuth.getSession(token) : null;
    if (!session) {
      reply.code(401).send({ error: "authentication_required" });
      return reply;
    }
    const params = request.params as Record<string, string>;
    const brandId = params.brandId;
    const route = request.routeOptions.url;
    const permitted = brandId
      ? await kakaoAuth.canAccessBrand(session.userId, brandId)
      : params.sourceId
        ? await kakaoAuth.canAccessResource(session.userId, "source_urls", params.sourceId)
        : params.outputId
          ? await kakaoAuth.canAccessResource(session.userId, "content_outputs", params.outputId)
          : params.queueId
            ? await kakaoAuth.canAccessResource(session.userId, "publish_queue", params.queueId)
            : params.requestId
              ? await kakaoAuth.canAccessResource(session.userId, "support_requests", params.requestId)
            : route === "/health";
    if (!permitted) {
      reply.code(403).send({ error: "workspace_access_denied" });
      return reply;
    }
  });

  app.get("/health", async () => {
    const health = await repository.health();
    return { ok: true, database: health.database };
  });

  app.get("/internal/cron/source-crawl", async (request, reply) => {
    if (!matchesBearerSecret(request.headers.authorization, cronSecret)) {
      reply.code(401);
      return { error: "cron_unauthorized" };
    }
    return repository.crawlDueSources(new Date());
  });

  app.get("/internal/cron/daily-generation", async (request, reply) => {
    if (!matchesBearerSecret(request.headers.authorization, cronSecret)) {
      reply.code(401);
      return { error: "cron_unauthorized" };
    }
    return repository.runDailyGeneration(new Date());
  });

  app.get("/internal/cron/publish-due", async (request, reply) => {
    if (!matchesBearerSecret(request.headers.authorization, cronSecret)) {
      reply.code(401);
      return { error: "cron_unauthorized" };
    }
    return repository.runDuePublishing(new Date());
  });

  app.get("/auth/me", async (request, reply) => {
    if (!kakaoAuth) return { user: null };
    const token = readCookie(request.headers.cookie, "bp_session");
    const session = token ? await kakaoAuth.getSession(token) : null;
    if (!session) {
      reply.code(401);
      return { error: "authentication_required" };
    }
    return { user: { id: session.userId, displayName: session.displayName, email: session.email }, workspace: { id: session.workspaceId, name: session.workspaceName }, brand: { id: session.brandId, name: session.brandName } };
  });

  app.get("/auth/kakao/login", async (request, reply) => {
    if (!kakao?.restApiKey || !kakao.redirectUri) {
      reply.code(503);
      return { error: "kakao_auth_not_configured" };
    }
    const state = crypto.randomUUID();
    reply.header("set-cookie", cookie(`${kakaoStateCookiePrefix}${state}`, "1", 600, process.env.VERCEL === "1"));
    const url = new URL("https://kauth.kakao.com/oauth/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", kakao.restApiKey);
    url.searchParams.set("redirect_uri", kakao.redirectUri);
    url.searchParams.set("state", state);
    return reply.redirect(url.toString());
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/auth/kakao/callback", async (request, reply) => {
    const frontendUrl = kakao?.frontendUrl ?? "http://localhost:5173";
    if (!kakaoAuth || !kakao?.restApiKey || !kakao.redirectUri) {
      request.log.warn({ event: "kakao_callback_failed", reason: "configuration_missing" }, "kakao_callback_failed");
      return reply.redirect(`${frontendUrl}/login?error=kakao_configuration_missing`);
    }
    if (request.query.error || !request.query.code) {
      request.log.warn({ event: "kakao_callback_failed", reason: "authorization_denied", kakaoError: request.query.error ?? null }, "kakao_callback_failed");
      return reply.redirect(`${frontendUrl}/login?error=kakao_authorization_denied`);
    }
    const stateCookieName = request.query.state ? kakaoStateCookieName(request.query.state) : null;
    const stateCookie = stateCookieName ? readCookie(request.headers.cookie, stateCookieName) : null;
    // Supports an in-flight login initiated before the per-attempt cookie rollout.
    const legacyStateMatches = request.query.state !== undefined && readCookie(request.headers.cookie, "bp_kakao_state") === request.query.state;
    if (!request.query.state || (stateCookie !== "1" && !legacyStateMatches)) {
      request.log.warn({ event: "kakao_callback_failed", reason: "state_mismatch" }, "kakao_callback_failed");
      return reply.redirect(`${frontendUrl}/login?error=kakao_state_mismatch`);
    }
    const clearStateCookie = cookie(
      legacyStateMatches ? "bp_kakao_state" : stateCookieName!,
      "",
      0,
      process.env.VERCEL === "1"
    );
    const tokenBody = new URLSearchParams({ grant_type: "authorization_code", client_id: kakao.restApiKey, redirect_uri: kakao.redirectUri, code: request.query.code });
    if (kakao.clientSecret) tokenBody.set("client_secret", kakao.clientSecret);
    const tokenResponse = await fetch("https://kauth.kakao.com/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" }, body: tokenBody });
    const tokenPayload = await tokenResponse.json() as Record<string, unknown>;
    if (!tokenResponse.ok || typeof tokenPayload.access_token !== "string") {
      request.log.warn({ event: "kakao_callback_failed", reason: "token_exchange_failed", status: tokenResponse.status }, "kakao_callback_failed");
      reply.header("set-cookie", clearStateCookie);
      return reply.redirect(`${kakao.frontendUrl}/login?error=kakao_token_exchange_failed`);
    }
    const profileResponse = await fetch("https://kapi.kakao.com/v2/user/me", { headers: { authorization: `Bearer ${tokenPayload.access_token}` } });
    const profilePayload = await profileResponse.json() as Record<string, unknown>;
    const account = isObject(profilePayload.kakao_account) ? profilePayload.kakao_account : {};
    const properties = isObject(profilePayload.properties) ? profilePayload.properties : {};
    if (!profileResponse.ok || (typeof profilePayload.id !== "number" && typeof profilePayload.id !== "string")) {
      request.log.warn({ event: "kakao_callback_failed", reason: "profile_fetch_failed", status: profileResponse.status }, "kakao_callback_failed");
      reply.header("set-cookie", clearStateCookie);
      return reply.redirect(`${kakao.frontendUrl}/login?error=kakao_profile_fetch_failed`);
    }
    const profile: KakaoProfile = { subject: String(profilePayload.id), nickname: typeof properties.nickname === "string" ? properties.nickname : null, email: typeof account.email === "string" ? account.email : null };
    const session = await kakaoAuth.createOrLoadUser(profile);
    const sessionToken = await kakaoAuth.createSession(session.userId);
    reply.header("set-cookie", [cookie("bp_session", sessionToken, 60 * 60 * 24 * 7, process.env.VERCEL === "1"), clearStateCookie]);
    return reply.redirect(`${kakao.frontendUrl}/onboarding`);
  });

  app.post("/auth/logout", async (request, reply) => {
    const token = readCookie(request.headers.cookie, "bp_session");
    if (token && kakaoAuth) await kakaoAuth.revokeSession(token);
    reply.header("set-cookie", cookie("bp_session", "", 0, process.env.VERCEL === "1"));
    return { ok: true };
  });

  app.get("/auth/meta/start", async (request, reply) => {
    if (!instagramLogin?.appId || !instagramLogin.appSecret || !instagramLogin.redirectUri) {
      reply.code(503);
      return { error: "instagram_login_not_configured" };
    }
    if (kakaoAuth) {
      const token = readCookie(request.headers.cookie, "bp_session");
      const session = token ? await kakaoAuth.getSession(token) : null;
      if (!session) {
        reply.code(401);
        return { error: "authentication_required" };
      }
    }
    const state = randomUUID();
    reply.header("set-cookie", cookie(instagramLoginStateCookie, state, 10 * 60, process.env.VERCEL === "1"));
    return reply.redirect(buildInstagramLoginAuthorizeUrl({
      appId: instagramLogin.appId,
      redirectUri: instagramLogin.redirectUri,
      state,
    }));
  });

  app.get<{
    Querystring: { code?: string; state?: string; error?: string; error_description?: string };
  }>("/auth/meta/callback", async (request, reply) => {
    const clearState = cookie(instagramLoginStateCookie, "", 0, process.env.VERCEL === "1");
    if (!instagramLogin?.appId || !instagramLogin.appSecret || !instagramLogin.redirectUri) {
      reply.header("set-cookie", clearState).code(503);
      return { error: "instagram_login_not_configured" };
    }
    if (request.query.error) {
      reply.header("set-cookie", clearState).code(400);
      return { error: request.query.error, errorDescription: request.query.error_description ?? null };
    }
    if (!request.query.code || request.query.state !== readCookie(request.headers.cookie, instagramLoginStateCookie)) {
      reply.header("set-cookie", clearState).code(400);
      return { error: "meta_oauth_state_invalid" };
    }
    let brandId = process.env.BRAND_PILOT_DEV_BRAND_ID ?? defaultDevBrandId;
    if (kakaoAuth) {
      const token = readCookie(request.headers.cookie, "bp_session");
      const session = token ? await kakaoAuth.getSession(token) : null;
      if (!session) {
        reply.header("set-cookie", clearState).code(401);
        return { error: "authentication_required" };
      }
      brandId = session.brandId;
    }
    try {
      const token = await exchangeInstagramLoginCode({
        code: request.query.code,
        appId: instagramLogin.appId,
        appSecret: instagramLogin.appSecret,
        redirectUri: instagramLogin.redirectUri,
      });
      const connection = await resolveInstagramLoginConnection({ accessToken: token.accessToken });
      const accountLabel = connection.instagramUsername
        ? `@${connection.instagramUsername}`
        : "Instagram professional account";
      await repository.saveChannelCredentials(brandId, "instagram", {
        accountLabel,
        connectionStatus: "connected",
        credentialType: "oauth",
        externalAccountId: connection.instagramBusinessAccountId,
        expiresAt: token.expiresIn ? new Date(Date.now() + token.expiresIn * 1000).toISOString() : null,
        maskedDisplay: tokenPreview(token.accessToken),
        provider: "meta",
        scopes: [...instagramLoginScopes],
        secretValue: token.accessToken,
        authMode: "instagram_login",
      });
      reply.header("set-cookie", clearState);
      return reply.redirect(`${instagramLogin.frontendUrl}/channels?instagram=connected`);
    } catch (error) {
      request.log.warn({ event: "instagram_login_callback_failed", errorCode: safeInternalErrorCode(error) }, "instagram_login_callback_failed");
      reply.header("set-cookie", clearState).code(400);
      return { error: "meta_instagram_connection_failed" };
    }
  });

  app.get<{
    Querystring: {
      access_token?: string;
      brand_id?: string;
      channel?: string;
      error?: string;
      error_description?: string;
      expires_in?: string;
      status?: string;
      token_type?: string;
    }
  }>("/auth/meta/dev-complete", async (request, reply) => {
    if (process.env.VERCEL === "1") {
      reply.code(404);
      return { error: "not_found" };
    }
    if (request.query.status === "error" || request.query.error) {
      reply.code(400);
      return {
        error: request.query.error ?? "meta_oauth_error",
        errorDescription: request.query.error_description ?? null
      };
    }

    const accessToken = request.query.access_token;
    if (!accessToken) {
      reply.code(400);
      return { error: "missing_access_token" };
    }

    const channel: Channel = request.query.channel === "threads" ? "threads" : "instagram";
    let brandId = request.query.brand_id ?? process.env.BRAND_PILOT_DEV_BRAND_ID ?? defaultDevBrandId;
    if (kakaoAuth) {
      const token = readCookie(request.headers.cookie, "bp_session");
      const session = token ? await kakaoAuth.getSession(token) : null;
      if (!session) {
        reply.code(401);
        return { error: "authentication_required" };
      }
      brandId = session.brandId;
    }
    let accountLabel = "Meta OAuth";
    let credentialToken = accessToken;
    let externalAccountId = "meta-oauth-dev";
    let scopes: string[] = [];
    let connectionStatus: "connected" | "needs_attention" = "needs_attention";

    if (channel === "instagram") {
      try {
        const connection = await resolveInstagramConnection({ accessToken });
        credentialToken = connection.accessToken;
        externalAccountId = connection.instagramBusinessAccountId;
        accountLabel = connection.instagramUsername
          ? `@${connection.instagramUsername}`
          : connection.pageName ?? "Instagram Business Account";
        scopes = connection.scopes;
        connectionStatus = "connected";
      } catch (error) {
        reply.code(400);
        return {
          error: "meta_instagram_connection_failed",
          errorDescription: error instanceof Error ? error.message : "unknown_error"
        };
      }
    }

    const maskedDisplay = tokenPreview(credentialToken);
    await repository.saveChannelCredentials(brandId, channel, {
      accountLabel,
      connectionStatus,
      credentialType: "oauth",
      externalAccountId,
      expiresAt: expiresAtFromSeconds(request.query.expires_in),
      maskedDisplay,
      provider: "meta",
      scopes,
      secretValue: credentialToken,
      authMode: "facebook_login"
    });

    reply.type("text/html; charset=utf-8");
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Brand Pilot Meta OAuth</title>
</head>
<body>
  <h1>Meta OAuth token received</h1>
  <p>Brand Pilot local API stored the ${htmlEscape(channel)} credential for ${htmlEscape(brandId)}.</p>
  <p>Connected account: ${htmlEscape(accountLabel)} (${htmlEscape(externalAccountId)})</p>
  <p>Token preview: ${htmlEscape(maskedDisplay)}</p>
  <p>You can close this tab and return to Brand Pilot.</p>
</body>
</html>`;
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/ui-status", async (request) => {
    return repository.getBrandUiStatus(request.params.brandId);
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/billing/summary", async (request) => {
    return repository.getBillingSummary(request.params.brandId);
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/profile", async (request) => {
    return repository.getBrandProfile(request.params.brandId);
  });

  app.put<{ Params: { brandId: string }; Body: Record<string, unknown> }>("/brands/:brandId/profile", async (request, reply) => {
    if (!isObject(request.body)) {
      reply.code(400);
      return { error: "invalid_body" };
    }
    if (hasOverlongBrandProfileShortField(request.body)) {
      reply.code(400);
      return { error: "brand_profile_field_too_long" };
    }
    return repository.updateBrandProfile(request.params.brandId, request.body);
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/instagram-formats", async (request) => {
    const settings = await repository.listInstagramFormats(request.params.brandId);
    return {
      ...settings,
      formats: settings.formats.map((format) => ({
        ...format,
        capabilityMetadata: sanitizeInstagramCapabilityMetadata(format.capabilityMetadata)
      }))
    };
  });

  app.put<{ Params: { brandId: string }; Body: Record<string, unknown> }>("/brands/:brandId/instagram-formats", async (request, reply) => {
    const validation = validateInstagramFormatSettings(request.body);
    if ("error" in validation) {
      reply.code(400);
      return { error: validation.error };
    }
    return repository.updateInstagramFormats(request.params.brandId, validation.input);
  });

  app.post<{ Params: { brandId: string; format: string } }>("/brands/:brandId/instagram-formats/:format/check", async (request, reply) => {
    if (!instagramFormatSet.has(request.params.format)) {
      reply.code(400);
      return { error: "invalid_instagram_format" };
    }
    if (request.params.format !== "instagram_story") {
      reply.code(400);
      return { error: "instagram_capability_check_not_supported" };
    }
    return repository.checkInstagramCapability(request.params.brandId, "instagram_story");
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/sources", async (request) => {
    return repository.listSources(request.params.brandId);
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/source-snapshots", async (request) => {
    return repository.listSourceSnapshots(request.params.brandId);
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/source-crawl-runs", async (request) => {
    return repository.listSourceCrawlRuns(request.params.brandId);
  });

  app.post<{ Params: { brandId: string } }>("/brands/:brandId/sources/crawl", async (request) => {
    return repository.crawlSources(request.params.brandId);
  });

  app.post<{ Params: { brandId: string; sourceId: string } }>("/brands/:brandId/sources/:sourceId/crawl", async (request) => {
    return repository.crawlSingleSource(request.params.brandId, request.params.sourceId, "manual");
  });

  app.post<{ Params: { brandId: string }; Body: Record<string, unknown> }>("/brands/:brandId/sources", async (request, reply) => {
    const sourceType = asSourceType(request.body?.sourceType);
    if (!sourceType || typeof request.body?.url !== "string" || request.body.url.trim().length === 0) {
      reply.code(400);
      return { error: "source_type_and_url_required" };
    }
    const source = await repository.createSourceWithInitialCrawl(request.params.brandId, { sourceType, url: request.body.url });
    reply.code(201);
    return source;
  });

  app.put<{ Params: { sourceId: string }; Body: Record<string, unknown> }>("/sources/:sourceId", async (request, reply) => {
    if (!isObject(request.body)) {
      reply.code(400);
      return { error: "invalid_body" };
    }
    const sourceType = request.body.sourceType === undefined ? undefined : asSourceType(request.body.sourceType) ?? undefined;
    if (request.body.sourceType !== undefined && !sourceType) {
      reply.code(400);
      return { error: "invalid_source_type" };
    }
    if (request.body.url !== undefined && (typeof request.body.url !== "string" || request.body.url.trim().length === 0)) {
      reply.code(400);
      return { error: "invalid_url" };
    }
    if (request.body.enabled !== undefined && typeof request.body.enabled !== "boolean") {
      reply.code(400);
      return { error: "invalid_source_enabled" };
    }
    return repository.updateSource(request.params.sourceId, {
      sourceType,
      url: typeof request.body.url === "string" ? request.body.url : undefined,
      enabled: typeof request.body.enabled === "boolean" ? request.body.enabled : undefined
    });
  });

  app.delete<{ Params: { sourceId: string } }>("/sources/:sourceId", async (request) => {
    return repository.deleteSource(request.params.sourceId);
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/channels", async (request) => {
    return repository.listChannels(request.params.brandId);
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/channel-connection-request", async (request) => {
    return repository.getChannelConnectionRequest(request.params.brandId);
  });

  app.put<{ Params: { brandId: string }; Body: Record<string, unknown> }>("/brands/:brandId/channel-connection-request", async (request, reply) => {
    if (!isObject(request.body)) {
      reply.code(400);
      return { error: "invalid_body" };
    }
    return repository.updateChannelConnectionRequest(request.params.brandId, {
      instagramHandle: optionalString(request.body.instagramHandle),
      instagramProfileUrl: optionalString(request.body.instagramProfileUrl),
      facebookPageUrl: optionalString(request.body.facebookPageUrl),
      metaBusinessName: optionalString(request.body.metaBusinessName),
      threadsProfileUrl: optionalString(request.body.threadsProfileUrl),
      contactName: optionalString(request.body.contactName),
      contactEmail: optionalString(request.body.contactEmail),
      hasAdminAccess: request.body.hasAdminAccess === true,
      requestNote: optionalString(request.body.requestNote),
      submit: request.body.submit === true
    });
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/support-requests", async (request) => {
    return repository.listSupportRequests(request.params.brandId);
  });

  app.post<{ Params: { brandId: string }; Body: Record<string, unknown> }>("/brands/:brandId/support-requests", async (request, reply) => {
    if (!isObject(request.body)) {
      reply.code(400);
      return { error: "invalid_body" };
    }
    const category = asSupportRequestCategory(request.body.category);
    const title = typeof request.body.title === "string" ? request.body.title.trim() : "";
    const message = typeof request.body.message === "string" ? request.body.message.trim() : "";
    if (!category || title.length === 0 || message.length === 0) {
      reply.code(400);
      return { error: "support_request_required_fields" };
    }
    const supportRequest = await repository.createSupportRequest(request.params.brandId, {
      category,
      title,
      message,
      contactEmail: optionalString(request.body.contactEmail)
    });
    reply.code(201);
    return supportRequest;
  });

  app.patch<{ Params: { requestId: string }; Body: Record<string, unknown> }>("/support-requests/:requestId", async (request, reply) => {
    if (!isObject(request.body)) {
      reply.code(400);
      return { error: "invalid_body" };
    }
    const status = asSupportRequestStatus(request.body.status);
    if (!status) {
      reply.code(400);
      return { error: "invalid_support_request_status" };
    }
    return repository.updateSupportRequestStatus(request.params.requestId, status);
  });

  app.put<{ Params: { brandId: string; channel: string }; Body: Record<string, unknown> }>(
    "/brands/:brandId/channels/:channel/credentials",
    async (request, reply) => {
      const channel = asChannel(request.params.channel);
      if (channel !== "instagram" && channel !== "threads") {
        reply.code(400);
        return { error: "channel_credentials_not_supported" };
      }
      if (typeof request.body?.secretValue !== "string" || request.body.secretValue.trim().length === 0) {
        reply.code(400);
        return { error: "secret_value_required" };
      }
      return repository.saveChannelCredentials(request.params.brandId, channel, {
        secretValue: request.body.secretValue,
        accountLabel: typeof request.body.accountLabel === "string" ? request.body.accountLabel : undefined,
        externalAccountId: typeof request.body.externalAccountId === "string" ? request.body.externalAccountId : undefined,
        maskedDisplay: typeof request.body.maskedDisplay === "string" ? request.body.maskedDisplay : undefined,
        provider: request.body.provider === "meta" ? "meta" : undefined,
        credentialType: request.body.credentialType === "api_token" ? "api_token" : request.body.credentialType === "oauth" ? "oauth" : undefined,
        scopes: Array.isArray(request.body.scopes) ? request.body.scopes.filter((item): item is string => typeof item === "string") : undefined,
        expiresAt: typeof request.body.expiresAt === "string" ? request.body.expiresAt : null
      });
    }
  );

  app.post<{ Params: { brandId: string; channel: string } }>("/brands/:brandId/channels/:channel/check", async (request) => {
    const channel = asChannel(request.params.channel);
    if (channel !== "instagram" && channel !== "threads") {
      return { channel, status: "not_connected", accountLabel: "연결 전", lastHealthyAt: null, lastPublishedAt: null, lastError: "채널 연결 기능은 아직 준비 중입니다." };
    }
    return repository.checkChannel(request.params.brandId, channel);
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/content-outputs", async (request) => {
    return repository.listContentOutputs(request.params.brandId);
  });

  app.post<{ Params: { brandId: string } }>("/brands/:brandId/content-generation/run", async (request) => {
    return repository.generateContent(request.params.brandId);
  });

  app.post<{ Params: { brandId: string }; Body: Record<string, unknown> }>("/brands/:brandId/topic-uploads", async (request, reply) => {
    if (
      typeof request.body?.fileName !== "string" ||
      request.body.fileName.trim().length === 0 ||
      typeof request.body.csvText !== "string" ||
      request.body.csvText.trim().length === 0
    ) {
      reply.code(400);
      return { error: "topic_upload_file_and_csv_required" };
    }
    if (!hasRequiredTopicHeaders(request.body.csvText)) {
      reply.code(400);
      return { error: "topic_upload_invalid_csv" };
    }
    const upload = await repository.createTopicUpload(request.params.brandId, {
      fileName: request.body.fileName,
      csvText: request.body.csvText
    });
    reply.code(201);
    return upload;
  });

  app.post<{ Params: { brandId: string }; Body: Record<string, unknown> }>("/brands/:brandId/knowledge-imports", async (request, reply) => {
    if (
      typeof request.body?.fileName !== "string" ||
      request.body.fileName.trim().length === 0 ||
      typeof request.body.fileBase64 !== "string" ||
      request.body.fileBase64.trim().length === 0
    ) {
      reply.code(400);
      return { error: "faq_upload_file_required" };
    }
    const imported = await repository.createKnowledgeImport(request.params.brandId, {
      fileName: request.body.fileName,
      fileBase64: request.body.fileBase64,
    });
    reply.code(201);
    return imported;
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/knowledge-imports", async (request) => {
    return repository.listKnowledgeImports(request.params.brandId);
  });

  app.post<{ Params: { brandId: string } }>("/brands/:brandId/wiki/refresh", async (request, reply) => {
    const job = await repository.enqueueWikiRefresh(request.params.brandId);
    reply.code(202);
    return job;
  });

  app.get<{ Params: { brandId: string }; Querystring: { status?: string } }>("/brands/:brandId/topic-rows", async (request, reply) => {
    const status = typeof request.query.status === "string" ? request.query.status : undefined;
    if (status && !topicRowStatuses.has(status)) {
      reply.code(400);
      return { error: "invalid_topic_row_status" };
    }
    return repository.listTopicRows(request.params.brandId, status);
  });

  app.post<{ Params: { outputId: string }; Body: Record<string, unknown> }>("/content-outputs/:outputId/review", async (request, reply) => {
    const action = request.body?.action;
    if (action !== "approve" && action !== "reject" && action !== "regenerate") {
      reply.code(400);
      return { error: "valid_review_action_required" };
    }
    return repository.reviewContentOutput(
      request.params.outputId,
      action,
      typeof request.body.reason === "string" ? request.body.reason : undefined
    );
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/publish-queue", async (request) => {
    return repository.listPublishQueue(request.params.brandId);
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/publish-results", async (request) => {
    return repository.listPublishResults(request.params.brandId);
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/publish-queue/download", async (request, reply) => {
    const packageResult = await repository.downloadPublishedResults(request.params.brandId);
    reply
      .header("content-type", packageResult.mimeType)
      .header("content-disposition", `attachment; filename="${packageResult.fileName}"`)
      .header("x-published-result-count", String(packageResult.itemCount));
    return reply.send(packageResult.buffer);
  });

  app.post<{ Params: { brandId: string } }>("/brands/:brandId/publish-queue/schedule", async (request) => {
    return repository.schedulePublishQueue(request.params.brandId);
  });

  app.post<{ Params: { queueId: string } }>("/publish-queue/:queueId/publish", async (request) => {
    return repository.publishQueueItem(request.params.queueId);
  });

  function assertWorkerAuthentication(authorization: string | undefined) {
    if (!workerApiToken) throw new Error("worker_api_not_configured");
    if (authorization !== `Bearer ${workerApiToken}`) throw new Error("worker_api_unauthorized");
  }

  app.post<{ Body: Record<string, unknown> }>("/worker/image-jobs/claim", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (typeof request.body?.workerId !== "string" || request.body.workerId.trim().length === 0) {
      reply.code(400);
      return { error: "worker_id_required" };
    }
    const job = await repository.claimImageRenderJob(request.body.workerId.trim());
    if (!job) {
      reply.code(204);
      return reply.send();
    }
    return job;
  });

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>("/worker/image-jobs/:jobId/heartbeat", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (typeof request.body?.workerId !== "string" || typeof request.body?.leaseToken !== "string") {
      reply.code(400);
      return { error: "worker_id_and_lease_token_required" };
    }
    return repository.heartbeatImageRenderJob(request.params.jobId, request.body.workerId, request.body.leaseToken);
  });

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>("/worker/image-jobs/:jobId/complete", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (typeof request.body?.workerId !== "string" || typeof request.body?.leaseToken !== "string" || typeof request.body?.manifestUrl !== "string") {
      reply.code(400);
      return { error: "worker_completion_fields_required" };
    }
    return repository.completeImageRenderJob(request.params.jobId, {
      workerId: request.body.workerId,
      leaseToken: request.body.leaseToken,
      manifestUrl: request.body.manifestUrl
    });
  });

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>("/worker/image-jobs/:jobId/fail", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (
      typeof request.body?.workerId !== "string" ||
      typeof request.body?.leaseToken !== "string" ||
      typeof request.body?.error !== "string" ||
      typeof request.body?.retryable !== "boolean" ||
      typeof request.body?.retryAfterMs !== "number"
    ) {
      reply.code(400);
      return { error: "worker_failure_fields_required" };
    }
    return repository.failImageRenderJob(request.params.jobId, {
      workerId: request.body.workerId,
      leaseToken: request.body.leaseToken,
      error: request.body.error,
      retryable: request.body.retryable,
      retryAfterMs: request.body.retryAfterMs
    });
  });

  app.post<{ Body: Record<string, unknown> }>("/worker/text-jobs/claim", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (typeof request.body?.workerId !== "string" || request.body.workerId.trim().length === 0) {
      reply.code(400);
      return { error: "worker_id_required" };
    }
    const job = await repository.claimTextRenderJob(request.body.workerId.trim());
    if (!job) {
      reply.code(204);
      return reply.send();
    }
    return job;
  });

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>("/worker/text-jobs/:jobId/heartbeat", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (typeof request.body?.workerId !== "string" || typeof request.body?.leaseToken !== "string") {
      reply.code(400);
      return { error: "worker_id_and_lease_token_required" };
    }
    return repository.heartbeatTextRenderJob(request.params.jobId, request.body.workerId, request.body.leaseToken);
  });

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>("/worker/text-jobs/:jobId/complete", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (
      typeof request.body?.workerId !== "string"
      || typeof request.body?.leaseToken !== "string"
      || !isObject(request.body?.result)
    ) {
      reply.code(400);
      return { error: "worker_completion_fields_required" };
    }
    return repository.completeTextRenderJob(request.params.jobId, {
      workerId: request.body.workerId,
      leaseToken: request.body.leaseToken,
      result: request.body.result
    });
  });

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>("/worker/text-jobs/:jobId/fail", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (
      typeof request.body?.workerId !== "string"
      || typeof request.body?.leaseToken !== "string"
      || typeof request.body?.error !== "string"
      || typeof request.body?.retryable !== "boolean"
      || typeof request.body?.retryAfterMs !== "number"
    ) {
      reply.code(400);
      return { error: "worker_failure_fields_required" };
    }
    return repository.failTextRenderJob(request.params.jobId, {
      workerId: request.body.workerId,
      leaseToken: request.body.leaseToken,
      error: request.body.error,
      retryable: request.body.retryable,
      retryAfterMs: request.body.retryAfterMs
    });
  });

  return app;
}
