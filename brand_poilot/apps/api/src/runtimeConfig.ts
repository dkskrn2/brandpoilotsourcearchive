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
  schedulerEnabled: boolean;
  instagramPublishEnabled: boolean;
  aiContentAttachmentUploadSessionsEnabled: boolean;
  automatedContentEnabled: boolean;
  contentProposalsEnabled: boolean;
  dmWorkersEnabled: boolean;
  readiness: {
    schedulerEnabled: boolean;
    publishingEnabled: boolean;
    contentProposalsEnabled: boolean;
    dmWorkersEnabled: boolean;
  };
}

const productionRequiredKeys = [
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

function parseBoolean(value: string | undefined, key: string, fallback = false) {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  return invalid(key);
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

  const cookieSecure = parseBoolean(env.COOKIE_SECURE, "COOKIE_SECURE");
  const devAuthEnabled = parseBoolean(env.DEV_AUTH_ENABLED, "DEV_AUTH_ENABLED");
  const schedulerEnabled = parseBoolean(env.LOCAL_SCHEDULER_ENABLED, "LOCAL_SCHEDULER_ENABLED");
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
    if (instagramPublishEnabled) invalid("INSTAGRAM_PUBLISH_ENABLED");

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
    schedulerEnabled,
    instagramPublishEnabled,
    aiContentAttachmentUploadSessionsEnabled,
    automatedContentEnabled,
    contentProposalsEnabled,
    dmWorkersEnabled,
    readiness: {
      schedulerEnabled,
      publishingEnabled: instagramPublishEnabled,
      contentProposalsEnabled,
      dmWorkersEnabled,
    },
  };
}
