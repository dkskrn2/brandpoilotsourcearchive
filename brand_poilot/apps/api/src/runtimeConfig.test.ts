import { describe, expect, it } from "vitest";
import { loadApiRuntimeConfig } from "./runtimeConfig.js";

function validProductionEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    SUPABASE_DATABASE_URL: "postgresql://database.example.com/brand_pilot",
    AI_CONTENT_DATABASE_URL_FILE: "/run/secrets/ai_content_application_database_url",
    AUTH_FRONTEND_URL: "https://app.danbammsg.co.kr",
    WORKER_API_TOKEN: "worker-secret",
    CONTENT_PROPOSAL_WORKER_API_TOKEN: "content-proposal-worker-secret",
    ADMIN_SERVICE_TOKEN: "admin-secret",
    CRON_SECRET: "cron-secret",
    API_INSTANCE_ROLE: "primary",
    CREDENTIAL_ENCRYPTION_KEY: "credential-secret-that-is-long-enough",
    KAKAO_REST_API_KEY: "kakao-key",
    KAKAO_CLIENT_SECRET: "kakao-secret",
    KAKAO_REDIRECT_URI: "https://api.danbammsg.co.kr/auth/kakao/callback",
    META_APP_ID: "meta-id",
    META_APP_SECRET: "meta-secret",
    META_OAUTH_REDIRECT_URI: "https://api.danbammsg.co.kr/auth/meta/callback",
    META_TRENDS_OAUTH_REDIRECT_URI: "https://api.danbammsg.co.kr/auth/meta/trends/callback",
    META_WEBHOOK_VERIFY_TOKEN: "meta-webhook-secret",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "supabase-secret",
    BLOB_READ_WRITE_TOKEN: "blob-secret",
    CONTENT_SUGGESTION_OAUTH_ISSUER: "https://login.example.com/",
    CONTENT_SUGGESTION_OAUTH_JWKS_URI: "https://login.example.com/.well-known/jwks.json",
    CONTENT_SUGGESTION_OAUTH_AUDIENCE: "authenticated",
    CONTENT_SUGGESTION_OAUTH_RESOURCE: "https://api.danbammsg.co.kr/plugins/content-suggestions/mcp",
    CONTENT_SUGGESTION_OAUTH_ALLOWED_SUBJECTS: "11111111-1111-4111-8111-111111111111",
    COOKIE_SECURE: "true",
    CORS_ALLOWED_ORIGINS: "https://app.danbammsg.co.kr,https://www.danbammsg.co.kr",
    DEV_AUTH_ENABLED: "false",
    LOCAL_SCHEDULER_ENABLED: "false",
    INSTAGRAM_PUBLISH_ENABLED: "false",
    AUTOMATED_CONTENT_ENABLED: "false",
    CONTENT_PROPOSALS_ENABLED: "false",
  };
}

describe("loadApiRuntimeConfig", () => {
  it("parses explicit scheduler instance roles and fails closed when the role is absent", () => {
    expect(loadApiRuntimeConfig({ API_INSTANCE_ROLE: "primary" }).instanceRole).toBe("primary");
    expect(loadApiRuntimeConfig({ API_INSTANCE_ROLE: "canary" }).instanceRole).toBe("canary");
    expect(loadApiRuntimeConfig({}).instanceRole).toBe("unassigned");
  });

  it.each(["PRIMARY", "preview", "", "worker"])(
    "rejects invalid API_INSTANCE_ROLE=%s",
    (value) => {
      expect(() => loadApiRuntimeConfig({ API_INSTANCE_ROLE: value })).toThrow("API_INSTANCE_ROLE");
    },
  );

  it("requires the dedicated AI-content database secret in production", () => {
    const env = validProductionEnv();
    delete env.AI_CONTENT_DATABASE_URL_FILE;

    expect(() => loadApiRuntimeConfig(env)).toThrow(
      "runtime_config_missing:AI_CONTENT_DATABASE_URL_FILE",
    );
  });

  it("accepts only the fixed read-only mount path for the AI-content database secret", () => {
    const env = validProductionEnv();
    env.AI_CONTENT_DATABASE_URL_FILE = "/opt/brand-pilot/shared/secrets/application-database-url";

    expect(() => loadApiRuntimeConfig(env)).toThrow("AI_CONTENT_DATABASE_URL_FILE");
  });

  it("requires a dedicated content proposal worker token in production", () => {
    const env = validProductionEnv();
    delete env.CONTENT_PROPOSAL_WORKER_API_TOKEN;

    expect(() => loadApiRuntimeConfig(env)).toThrow(
      "runtime_config_missing:CONTENT_PROPOSAL_WORKER_API_TOKEN",
    );
  });

  it.each([
    "CONTENT_SUGGESTION_OAUTH_ISSUER",
    "CONTENT_SUGGESTION_OAUTH_JWKS_URI",
    "CONTENT_SUGGESTION_OAUTH_AUDIENCE",
    "CONTENT_SUGGESTION_OAUTH_RESOURCE",
    "CONTENT_SUGGESTION_OAUTH_ALLOWED_SUBJECTS",
  ])("requires %s in production", (key) => {
    const env = validProductionEnv();
    delete env[key];
    expect(() => loadApiRuntimeConfig(env)).toThrow(`runtime_config_missing:${key}`);
  });

  it("parses the content suggestion OAuth resource-server configuration", () => {
    expect(loadApiRuntimeConfig(validProductionEnv()).contentSuggestionOAuth).toEqual({
      issuer: "https://login.example.com/",
      jwksUri: "https://login.example.com/.well-known/jwks.json",
      audience: "authenticated",
      resource: "https://api.danbammsg.co.kr/plugins/content-suggestions/mcp",
      allowedSubjects: ["11111111-1111-4111-8111-111111111111"],
    });
  });

  it("rejects malformed or duplicate content suggestion OAuth subjects", () => {
    const malformed = validProductionEnv();
    malformed.CONTENT_SUGGESTION_OAUTH_ALLOWED_SUBJECTS = "not-a-uuid";
    expect(() => loadApiRuntimeConfig(malformed)).toThrow(
      "runtime_config_invalid:CONTENT_SUGGESTION_OAUTH_ALLOWED_SUBJECTS",
    );

    const duplicate = validProductionEnv();
    duplicate.CONTENT_SUGGESTION_OAUTH_ALLOWED_SUBJECTS = [
      "11111111-1111-4111-8111-111111111111",
      "11111111-1111-4111-8111-111111111111",
    ].join(",");
    expect(() => loadApiRuntimeConfig(duplicate)).toThrow(
      "runtime_config_invalid:CONTENT_SUGGESTION_OAUTH_ALLOWED_SUBJECTS",
    );
  });

  it("reports only the missing production variable name", () => {
    const env = validProductionEnv();
    delete env.META_APP_SECRET;
    env.WORKER_API_TOKEN = "must-not-appear";

    expect(() => loadApiRuntimeConfig(env)).toThrow("META_APP_SECRET");
    try {
      loadApiRuntimeConfig(env);
    } catch (error) {
      expect(String(error)).not.toContain("must-not-appear");
    }
  });

  it("accepts DATABASE_URL as the configured database URL", () => {
    const env = validProductionEnv();
    env.DATABASE_URL = env.SUPABASE_DATABASE_URL;
    delete env.SUPABASE_DATABASE_URL;

    expect(loadApiRuntimeConfig(env).db.max).toBe(3);
  });

  it.each([
    ["wildcard CORS", "*"],
    ["HTTP production origin", "http://app.danbammsg.co.kr"],
    ["origin path", "https://app.danbammsg.co.kr/path"],
    ["origin query", "https://app.danbammsg.co.kr?x=1"],
    ["origin hash", "https://app.danbammsg.co.kr#fragment"],
    ["origin userinfo", "https://user@app.danbammsg.co.kr"],
  ])("rejects %s", (_caseName, origin) => {
    const env = validProductionEnv();
    env.CORS_ALLOWED_ORIGINS = origin;
    expect(() => loadApiRuntimeConfig(env)).toThrow("CORS_ALLOWED_ORIGINS");
  });

  it("rejects AUTH_FRONTEND_URL when it is missing from CORS", () => {
    const env = validProductionEnv();
    env.CORS_ALLOWED_ORIGINS = "https://www.danbammsg.co.kr";
    expect(() => loadApiRuntimeConfig(env)).toThrow("AUTH_FRONTEND_URL");
  });

  it("allows one exact Danbam preview origin when it is explicitly configured", () => {
    const env = validProductionEnv();
    env.AUTH_PREVIEW_FRONTEND_URL = "https://staging-app.danbammsg.co.kr";
    env.CORS_ALLOWED_ORIGINS = `${env.CORS_ALLOWED_ORIGINS},${env.AUTH_PREVIEW_FRONTEND_URL}`;

    expect(loadApiRuntimeConfig(env).http).toEqual({
      cookieSecure: true,
      corsAllowedOrigins: [
        "https://app.danbammsg.co.kr",
        "https://www.danbammsg.co.kr",
        "https://staging-app.danbammsg.co.kr",
      ],
      devAuthEnabled: false,
      previewFrontendOrigin: "https://staging-app.danbammsg.co.kr",
    });
  });

  it.each([
    "https://brand-pilot-git-feature.example.vercel.app",
    "https://staging-app.danbammsg.co.kr:8443",
  ])("rejects an unsafe production preview origin: %s", (origin) => {
    const env = validProductionEnv();
    env.AUTH_PREVIEW_FRONTEND_URL = origin;
    env.CORS_ALLOWED_ORIGINS = `${env.CORS_ALLOWED_ORIGINS},${origin}`;

    expect(() => loadApiRuntimeConfig(env)).toThrow("AUTH_PREVIEW_FRONTEND_URL");
  });

  it("rejects a configured preview origin when it is missing from CORS", () => {
    const env = validProductionEnv();
    env.AUTH_PREVIEW_FRONTEND_URL = "https://staging-app.danbammsg.co.kr";

    expect(() => loadApiRuntimeConfig(env)).toThrow("AUTH_PREVIEW_FRONTEND_URL");
  });

  it("rejects production COOKIE_SECURE other than true", () => {
    const env = validProductionEnv();
    env.COOKIE_SECURE = "false";
    expect(() => loadApiRuntimeConfig(env)).toThrow("COOKIE_SECURE");
  });

  it("rejects production DEV_AUTH_ENABLED=true", () => {
    const env = validProductionEnv();
    env.DEV_AUTH_ENABLED = "true";
    expect(() => loadApiRuntimeConfig(env)).toThrow("DEV_AUTH_ENABLED");
  });

  it("defaults scheduler and publication to false", () => {
    const config = loadApiRuntimeConfig({});
    expect(config.schedulerEnabled).toBe(false);
    expect(config.instagramPublishEnabled).toBe(false);
    expect(config.aiContentAttachmentUploadSessionsEnabled).toBe(false);
    expect(config.automatedContentEnabled).toBe(false);
    expect(config.contentProposalsEnabled).toBe(false);
    expect(config.readiness).toEqual({
      schedulerEnabled: false,
      publishingEnabled: false,
      dmWorkersEnabled: false,
      contentProposalsEnabled: false,
    });
    expect(config.faqMatching).toEqual({
      suggestionsEnabled: false,
      expandedExactEnabled: false,
      shadowMatchingEnabled: false,
      clarificationEnabled: false,
      brandAllowlist: [],
      clarifyThreshold: 0.78,
      confirmationTtlSeconds: 300,
    });
  });

  it("loads FAQ matching gates and brand allowlist", () => {
    expect(loadApiRuntimeConfig({
      FAQ_UTTERANCE_SUGGESTIONS_ENABLED: "true",
      FAQ_EXPANDED_EXACT_ENABLED: "true",
      FAQ_MATCH_SHADOW_ENABLED: "true",
      FAQ_CLARIFICATION_ENABLED: "true",
      FAQ_MATCH_BRAND_ALLOWLIST: "brand-a, brand-b,brand-a",
      FAQ_CLARIFY_THRESHOLD: "0.82",
      FAQ_CONFIRMATION_TTL_SECONDS: "120",
    }).faqMatching).toEqual({
      suggestionsEnabled: true,
      expandedExactEnabled: true,
      shadowMatchingEnabled: true,
      clarificationEnabled: true,
      brandAllowlist: ["brand-a", "brand-b"],
      clarifyThreshold: 0.82,
      confirmationTtlSeconds: 120,
    });
  });

  it.each([
    ["FAQ_CLARIFY_THRESHOLD", "-0.1"],
    ["FAQ_CLARIFY_THRESHOLD", "1.1"],
    ["FAQ_CLARIFY_THRESHOLD", "NaN"],
    ["FAQ_CONFIRMATION_TTL_SECONDS", "29"],
    ["FAQ_CONFIRMATION_TTL_SECONDS", "901"],
  ])("rejects invalid %s=%s", (key, value) => {
    expect(() => loadApiRuntimeConfig({ [key]: value })).toThrow(key);
  });

  it.each([
    "FAQ_UTTERANCE_SUGGESTIONS_ENABLED",
    "FAQ_EXPANDED_EXACT_ENABLED",
    "FAQ_MATCH_SHADOW_ENABLED",
    "FAQ_CLARIFICATION_ENABLED",
  ])("requires literal booleans for %s", (key) => {
    expect(() => loadApiRuntimeConfig({ [key]: "1" })).toThrow(key);
  });

  it("keeps manual proposal and scheduled automation gates independent", () => {
    expect(loadApiRuntimeConfig({
      CONTENT_PROPOSALS_ENABLED: "true",
      AUTOMATED_CONTENT_ENABLED: "false",
    })).toMatchObject({
      contentProposalsEnabled: true,
      automatedContentEnabled: false,
      readiness: { contentProposalsEnabled: true },
    });
    expect(loadApiRuntimeConfig({
      CONTENT_PROPOSALS_ENABLED: "false",
      AUTOMATED_CONTENT_ENABLED: "true",
    })).toMatchObject({
      contentProposalsEnabled: false,
      dmWorkersEnabled: false,
      automatedContentEnabled: true,
      readiness: { contentProposalsEnabled: false },
    });
  });

  it.each(["yes", "1", "TRUE", ""])(
    "rejects invalid proposal gate booleans (%s)",
    (value) => {
      expect(() => loadApiRuntimeConfig({
        CONTENT_PROPOSALS_ENABLED: value,
      })).toThrow("CONTENT_PROPOSALS_ENABLED");
      expect(() => loadApiRuntimeConfig({
        AUTOMATED_CONTENT_ENABLED: value,
      })).toThrow("AUTOMATED_CONTENT_ENABLED");
    },
  );

  it("enables attachment upload sessions only with literal true", () => {
    expect(loadApiRuntimeConfig({
      AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED: "true",
    }).aiContentAttachmentUploadSessionsEnabled).toBe(true);
    expect(loadApiRuntimeConfig({
      AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED: "false",
    }).aiContentAttachmentUploadSessionsEnabled).toBe(false);
  });

  it.each(["yes", "1", "TRUE", ""])(
    "rejects a non-literal attachment upload sessions boolean (%s)",
    (value) => {
      expect(() => loadApiRuntimeConfig({
        AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED: value,
      })).toThrow("AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED");
    },
  );

  it("forces LOCAL_SCHEDULER_ENABLED off in production", () => {
    const env = validProductionEnv();
    env.LOCAL_SCHEDULER_ENABLED = "true";

    expect(() => loadApiRuntimeConfig(env)).toThrow("LOCAL_SCHEDULER_ENABLED");
  });

  it("allows Instagram publishing in production while the local scheduler stays off", () => {
    const env = validProductionEnv();
    env.INSTAGRAM_PUBLISH_ENABLED = "true";
    env.LOCAL_SCHEDULER_ENABLED = "false";

    expect(loadApiRuntimeConfig(env)).toMatchObject({
      schedulerEnabled: false,
      instagramPublishEnabled: true,
      readiness: {
        schedulerEnabled: false,
        publishingEnabled: true,
      },
    });
  });

  it("defaults the database pool to three connections", () => {
    expect(loadApiRuntimeConfig({}).db.max).toBe(3);
  });

  it.each(["0", "11", "1.5", "not-a-number"])("rejects DB_POOL_MAX=%s", (value) => {
    expect(() => loadApiRuntimeConfig({ DB_POOL_MAX: value })).toThrow("DB_POOL_MAX");
  });

  it("accepts database pool limits from one through ten", () => {
    expect(loadApiRuntimeConfig({ DB_POOL_MAX: "1" }).db.max).toBe(1);
    expect(loadApiRuntimeConfig({ DB_POOL_MAX: "10" }).db.max).toBe(10);
  });

  it.each(["DB_POOL_IDLE_TIMEOUT_MS", "DB_POOL_CONNECTION_TIMEOUT_MS"])(
    "requires %s to be a positive integer",
    (key) => {
      expect(() => loadApiRuntimeConfig({ [key]: "0" })).toThrow(key);
      expect(() => loadApiRuntimeConfig({ [key]: "1.5" })).toThrow(key);
    },
  );

  it("loads the dark-deploy Ubuntu policy", () => {
    const config = loadApiRuntimeConfig(validProductionEnv());
    expect(config.http).toEqual({
      cookieSecure: true,
      corsAllowedOrigins: [
        "https://app.danbammsg.co.kr",
        "https://www.danbammsg.co.kr",
      ],
      devAuthEnabled: false,
    });
    expect(config.schedulerEnabled).toBe(false);
    expect(config.instagramPublishEnabled).toBe(false);
    expect(config.readiness).toEqual({
      schedulerEnabled: false,
      publishingEnabled: false,
      dmWorkersEnabled: false,
      contentProposalsEnabled: false,
    });
    expect(config.db).toEqual({
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    expect(config.aiContentDatabaseUrlFile).toBe(
      "/run/secrets/ai_content_application_database_url",
    );
  });

  it.each(["yes", "1", "TRUE", ""])("accepts only literal true or false booleans (%s)", (value) => {
    expect(() => loadApiRuntimeConfig({ COOKIE_SECURE: value })).toThrow("COOKIE_SECURE");
  });

  it("rejects a production frontend hostname typo", () => {
    const env = validProductionEnv();
    env.AUTH_FRONTEND_URL = "https://app.danbamsg.co.kr";
    env.CORS_ALLOWED_ORIGINS = `${env.AUTH_FRONTEND_URL},https://www.danbammsg.co.kr`;
    expect(() => loadApiRuntimeConfig(env)).toThrow("AUTH_FRONTEND_URL");
  });

  it("decodes a strict base64 CA certificate", () => {
    const ca = "-----BEGIN CERTIFICATE-----\ncertificate\n-----END CERTIFICATE-----";
    const config = loadApiRuntimeConfig({ DB_SSL_CA_BASE64: Buffer.from(ca).toString("base64") });
    expect(config.db.caCertificate).toBe(ca);
  });

  it("rejects malformed base64 CA data", () => {
    expect(() => loadApiRuntimeConfig({ DB_SSL_CA_BASE64: "not%%%base64" })).toThrow("DB_SSL_CA_BASE64");
  });
});
