export interface ApiHttpRuntimePolicy {
  cookieSecure: boolean;
  corsAllowedOrigins: readonly string[];
  devAuthEnabled: boolean;
  previewFrontendOrigin?: string;
}

export interface ApiRuntimeConfig {
  http: ApiHttpRuntimePolicy;
  db: {
    max: number;
    idleTimeoutMillis: number;
    connectionTimeoutMillis: number;
    caCertificate?: string;
  };
  aiContentDatabaseUrlFile?: string;
  contentSuggestionOAuth?: {
    issuer: string;
    jwksUri: string;
    audience: string;
    resource: string;
    allowedSubjects: string[];
  };
  schedulerEnabled: boolean;
  instanceRole: "primary" | "canary" | "unassigned";
  instagramPublishEnabled: boolean;
  aiContentAttachmentUploadSessionsEnabled: boolean;
  automatedContentEnabled: boolean;
  contentProposalsEnabled: boolean;
  dmWorkersEnabled: boolean;
  faqMatching: FaqMatchingRuntimePolicy;
  readiness: {
    schedulerEnabled: boolean;
    publishingEnabled: boolean;
    contentProposalsEnabled: boolean;
    dmWorkersEnabled: boolean;
  };
}

export interface FaqMatchingRuntimePolicy {
  suggestionsEnabled: boolean;
  expandedExactEnabled: boolean;
  shadowMatchingEnabled: boolean;
  clarificationEnabled: boolean;
  brandAllowlist: readonly string[];
  clarifyThreshold: number;
  confirmationTtlSeconds: number;
}

const productionRequiredKeys = [
  "AI_CONTENT_DATABASE_URL_FILE",
  "AUTH_FRONTEND_URL",
  "WORKER_API_TOKEN",
  "CONTENT_PROPOSAL_WORKER_API_TOKEN",
  "ADMIN_SERVICE_TOKEN",
  "CRON_SECRET",
  "CREDENTIAL_ENCRYPTION_KEY",
  "KAKAO_REST_API_KEY",
  "KAKAO_CLIENT_SECRET",
  "KAKAO_REDIRECT_URI",
  "META_APP_ID",
  "META_APP_SECRET",
  "META_OAUTH_REDIRECT_URI",
  "META_TRENDS_OAUTH_REDIRECT_URI",
  "META_WEBHOOK_VERIFY_TOKEN",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "BLOB_READ_WRITE_TOKEN",
  "CONTENT_SUGGESTION_OAUTH_ISSUER",
  "CONTENT_SUGGESTION_OAUTH_JWKS_URI",
  "CONTENT_SUGGESTION_OAUTH_AUDIENCE",
  "CONTENT_SUGGESTION_OAUTH_RESOURCE",
  "CONTENT_SUGGESTION_OAUTH_ALLOWED_SUBJECTS",
] as const;

const productionFrontendOrigin = "https://app.danbammsg.co.kr";
const productionPreviewFrontendOrigin = "https://staging-app.danbammsg.co.kr";
const productionCorsOrigins = new Set([
  productionFrontendOrigin,
  "https://www.danbammsg.co.kr",
]);

function invalid(key: string): never {
  throw new Error(`runtime_config_invalid:${key}`);
}

const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function parseUuidList(value: string, key: string): string[] {
  const entries = value.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  if (
    entries.length === 0
    || entries.some((entry) => !uuidPattern.test(entry))
    || new Set(entries).size !== entries.length
  ) invalid(key);
  return entries;
}

function parseBoolean(value: string | undefined, key: string, fallback = false) {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  return invalid(key);
}

function parseInstanceRole(value: string | undefined): ApiRuntimeConfig["instanceRole"] {
  if (value === undefined) return "unassigned";
  if (value === "primary" || value === "canary") return value;
  return invalid("API_INSTANCE_ROLE");
}

function parsePositiveInteger(
  value: string | undefined,
  key: string,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) return invalid(key);
  return parsed;
}

function parseNumberRange(
  value: string | undefined,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) return invalid(key);
  return parsed;
}

function parseBrandAllowlist(value: string | undefined) {
  return [...new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean))];
}

function parseOrigin(value: string, key: string, production: boolean) {
  if (value === "*" || value.includes("*")) return invalid(key);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid(key);
  }
  if (
    url.origin !== value
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    return invalid(key);
  }
  if (production && url.protocol !== "https:") return invalid(key);
  return url.origin;
}

function parseHttpsUrl(value: string, key: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid(key);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash
    || url.toString() !== value) {
    return invalid(key);
  }
  return url.toString();
}

function parseOAuthAudience(value: string, key: string) {
  if (value === "authenticated") return value;
  return parseHttpsUrl(value, key);
}

function parseCorsOrigins(
  value: string | undefined,
  production: boolean,
  previewFrontendOrigin?: string,
) {
  const origins = (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => parseOrigin(origin, "CORS_ALLOWED_ORIGINS", production));
  const allowedProductionOrigins = new Set(productionCorsOrigins);
  if (previewFrontendOrigin) allowedProductionOrigins.add(previewFrontendOrigin);
  if (production && origins.some((origin) => !allowedProductionOrigins.has(origin))) {
    return invalid("CORS_ALLOWED_ORIGINS");
  }
  return [...new Set(origins)];
}

function decodeCaCertificate(value: string | undefined) {
  if (!value) return undefined;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return invalid("DB_SSL_CA_BASE64");
  }
  const decoded = Buffer.from(value, "base64");
  if (!decoded.length || decoded.toString("base64") !== value) return invalid("DB_SSL_CA_BASE64");
  return decoded.toString("utf8");
}

function assertProductionRequirements(env: NodeJS.ProcessEnv) {
  const missing: string[] = productionRequiredKeys.filter((key) => !env[key]?.trim());
  if (!env.SUPABASE_DATABASE_URL?.trim() && !env.DATABASE_URL?.trim()) {
    missing.unshift("SUPABASE_DATABASE_URL|DATABASE_URL");
  }
  if (missing.length) throw new Error(`runtime_config_missing:${missing.join(",")}`);
}

export function loadApiRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): ApiRuntimeConfig {
  const production = env.NODE_ENV === "production";
  if (production) assertProductionRequirements(env);
  const aiContentDatabaseUrlFile = env.AI_CONTENT_DATABASE_URL_FILE?.trim();
  if (
    aiContentDatabaseUrlFile
    && aiContentDatabaseUrlFile !== "/run/secrets/ai_content_application_database_url"
  ) {
    invalid("AI_CONTENT_DATABASE_URL_FILE");
  }

  const cookieSecure = parseBoolean(env.COOKIE_SECURE, "COOKIE_SECURE");
  const devAuthEnabled = parseBoolean(env.DEV_AUTH_ENABLED, "DEV_AUTH_ENABLED");
  const schedulerEnabled = parseBoolean(env.LOCAL_SCHEDULER_ENABLED, "LOCAL_SCHEDULER_ENABLED");
  const instanceRole = parseInstanceRole(env.API_INSTANCE_ROLE);
  const instagramPublishEnabled = parseBoolean(env.INSTAGRAM_PUBLISH_ENABLED, "INSTAGRAM_PUBLISH_ENABLED");
  const automatedContentEnabled = parseBoolean(
    env.AUTOMATED_CONTENT_ENABLED,
    "AUTOMATED_CONTENT_ENABLED",
  );
  const contentProposalsEnabled = parseBoolean(
    env.CONTENT_PROPOSALS_ENABLED,
    "CONTENT_PROPOSALS_ENABLED",
  );
  const dmWorkersEnabled = parseBoolean(env.DM_WORKERS_ENABLED, "DM_WORKERS_ENABLED");
  const faqMatching: FaqMatchingRuntimePolicy = {
    suggestionsEnabled: parseBoolean(
      env.FAQ_UTTERANCE_SUGGESTIONS_ENABLED,
      "FAQ_UTTERANCE_SUGGESTIONS_ENABLED",
    ),
    expandedExactEnabled: parseBoolean(
      env.FAQ_EXPANDED_EXACT_ENABLED,
      "FAQ_EXPANDED_EXACT_ENABLED",
    ),
    shadowMatchingEnabled: parseBoolean(
      env.FAQ_MATCH_SHADOW_ENABLED,
      "FAQ_MATCH_SHADOW_ENABLED",
    ),
    clarificationEnabled: parseBoolean(
      env.FAQ_CLARIFICATION_ENABLED,
      "FAQ_CLARIFICATION_ENABLED",
    ),
    brandAllowlist: parseBrandAllowlist(env.FAQ_MATCH_BRAND_ALLOWLIST),
    clarifyThreshold: parseNumberRange(
      env.FAQ_CLARIFY_THRESHOLD,
      "FAQ_CLARIFY_THRESHOLD",
      0.78,
      0,
      1,
    ),
    confirmationTtlSeconds: parsePositiveInteger(
      env.FAQ_CONFIRMATION_TTL_SECONDS,
      "FAQ_CONFIRMATION_TTL_SECONDS",
      300,
      900,
    ),
  };
  if (faqMatching.confirmationTtlSeconds < 30) invalid("FAQ_CONFIRMATION_TTL_SECONDS");
  const aiContentAttachmentUploadSessionsEnabled = parseBoolean(
    env.AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED,
    "AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED",
  );
  const frontendOrigin = production
    ? parseOrigin(env.AUTH_FRONTEND_URL!, "AUTH_FRONTEND_URL", true)
    : undefined;
  if (production && frontendOrigin !== productionFrontendOrigin) invalid("AUTH_FRONTEND_URL");
  const previewFrontendOrigin = env.AUTH_PREVIEW_FRONTEND_URL?.trim()
    ? parseOrigin(
      env.AUTH_PREVIEW_FRONTEND_URL.trim(),
      "AUTH_PREVIEW_FRONTEND_URL",
      production,
    )
    : undefined;
  if (
    production
    && previewFrontendOrigin
    && previewFrontendOrigin !== productionPreviewFrontendOrigin
  ) {
    invalid("AUTH_PREVIEW_FRONTEND_URL");
  }
  const corsAllowedOrigins = parseCorsOrigins(
    env.CORS_ALLOWED_ORIGINS,
    production,
    previewFrontendOrigin,
  );

  if (production) {
    if (!cookieSecure) invalid("COOKIE_SECURE");
    if (devAuthEnabled) invalid("DEV_AUTH_ENABLED");
    if (schedulerEnabled) invalid("LOCAL_SCHEDULER_ENABLED");

    if (!corsAllowedOrigins.includes(frontendOrigin!)) {
      invalid("AUTH_FRONTEND_URL");
    }
    if (
      previewFrontendOrigin
      && !corsAllowedOrigins.includes(previewFrontendOrigin)
    ) {
      invalid("AUTH_PREVIEW_FRONTEND_URL");
    }
  }

  const caCertificate = decodeCaCertificate(env.DB_SSL_CA_BASE64);
  const contentSuggestionOAuthValues = [
    env.CONTENT_SUGGESTION_OAUTH_ISSUER,
    env.CONTENT_SUGGESTION_OAUTH_JWKS_URI,
    env.CONTENT_SUGGESTION_OAUTH_AUDIENCE,
    env.CONTENT_SUGGESTION_OAUTH_RESOURCE,
    env.CONTENT_SUGGESTION_OAUTH_ALLOWED_SUBJECTS,
  ];
  const hasContentSuggestionOAuth = contentSuggestionOAuthValues.some((value) => value?.trim());
  if (hasContentSuggestionOAuth && contentSuggestionOAuthValues.some((value) => !value?.trim())) {
    throw new Error("runtime_config_missing:CONTENT_SUGGESTION_OAUTH_CONFIGURATION");
  }
  const contentSuggestionOAuth = hasContentSuggestionOAuth ? {
    issuer: parseHttpsUrl(env.CONTENT_SUGGESTION_OAUTH_ISSUER!.trim(), "CONTENT_SUGGESTION_OAUTH_ISSUER"),
    jwksUri: parseHttpsUrl(env.CONTENT_SUGGESTION_OAUTH_JWKS_URI!.trim(), "CONTENT_SUGGESTION_OAUTH_JWKS_URI"),
    audience: parseOAuthAudience(env.CONTENT_SUGGESTION_OAUTH_AUDIENCE!.trim(), "CONTENT_SUGGESTION_OAUTH_AUDIENCE"),
    resource: parseHttpsUrl(env.CONTENT_SUGGESTION_OAUTH_RESOURCE!.trim(), "CONTENT_SUGGESTION_OAUTH_RESOURCE"),
    allowedSubjects: parseUuidList(
      env.CONTENT_SUGGESTION_OAUTH_ALLOWED_SUBJECTS!.trim(),
      "CONTENT_SUGGESTION_OAUTH_ALLOWED_SUBJECTS",
    ),
  } : undefined;
  return {
    http: {
      cookieSecure,
      corsAllowedOrigins,
      devAuthEnabled,
      ...(previewFrontendOrigin ? { previewFrontendOrigin } : {}),
    },
    db: {
      max: parsePositiveInteger(env.DB_POOL_MAX, "DB_POOL_MAX", 3, 10),
      idleTimeoutMillis: parsePositiveInteger(
        env.DB_POOL_IDLE_TIMEOUT_MS,
        "DB_POOL_IDLE_TIMEOUT_MS",
        10_000,
      ),
      connectionTimeoutMillis: parsePositiveInteger(
        env.DB_POOL_CONNECTION_TIMEOUT_MS,
        "DB_POOL_CONNECTION_TIMEOUT_MS",
        10_000,
      ),
      ...(caCertificate ? { caCertificate } : {}),
    },
    ...(aiContentDatabaseUrlFile ? { aiContentDatabaseUrlFile } : {}),
    ...(contentSuggestionOAuth ? { contentSuggestionOAuth } : {}),
    schedulerEnabled,
    instanceRole,
    instagramPublishEnabled,
    aiContentAttachmentUploadSessionsEnabled,
    automatedContentEnabled,
    contentProposalsEnabled,
    dmWorkersEnabled,
    faqMatching,
    readiness: {
      schedulerEnabled,
      publishingEnabled: instagramPublishEnabled,
      contentProposalsEnabled,
      dmWorkersEnabled,
    },
  };
}
