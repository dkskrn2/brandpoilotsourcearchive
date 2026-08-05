import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const migrateModule = await import("./migrate.mjs");

test("migration CLI has an ESM main guard and is safe to import", async () => {
  const source = await readFile(
    new URL("./migrate.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /pathToFileURL\(process\.argv\[1\]\)\.href === import\.meta\.url/);
  assert.match(source, /export async function main/);
});

test("migration CLI strictly decodes optional CA runtime configuration", () => {
  assert.equal(typeof migrateModule.resolveMigrationRuntimeConfig, "function");
  const certificate = "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----";

  assert.deepEqual(
    migrateModule.resolveMigrationRuntimeConfig(
      {
        SUPABASE_DATABASE_URL: "postgresql://database.example/postgres",
        MIGRATION_BASELINE_UP_TO: "054_feedback_submissions.sql",
        DB_SSL_CA_BASE64: Buffer.from(certificate).toString("base64"),
      },
      ["node", "scripts/migrate.mjs", "--dry-run"],
    ),
    {
      connectionString: "postgresql://database.example/postgres",
      baselineUpTo: "054_feedback_submissions.sql",
      dryRun: true,
      caCertificate: certificate,
    },
  );
});

test("migration CLI rejects invalid CA before returning client options", () => {
  assert.equal(typeof migrateModule.resolveMigrationRuntimeConfig, "function");

  assert.throws(
    () => migrateModule.resolveMigrationRuntimeConfig({
      SUPABASE_DATABASE_URL: "postgresql://database.example/postgres",
      DB_SSL_CA_BASE64: "secret%%%invalid",
    }),
    (error) => error.message === "invalid_environment: DB_SSL_CA_BASE64",
  );
});

test("074 migration CLI exposes only pinned Ed25519 public-key inputs", () => {
  const config = migrateModule.resolveMigrationRuntimeConfig({
    SUPABASE_DATABASE_URL: "postgresql://database.example/postgres",
    AI_CONTENT_074_AUTHORIZATION_FILE: "/run/secrets/authorization.json",
    AI_CONTENT_074_AUTHORIZATION_PUBLIC_KEY_FILE: "/run/secrets/authorization-public.pem",
    AI_CONTENT_074_AUTHORIZATION_KEY_ID: "authorization-2026-08",
    AI_CONTENT_074_AUTHORIZATION_PUBLIC_KEY_SHA256: "a".repeat(64),
    AI_CONTENT_074_PROVIDER_ATTESTATION_FILE: "/run/secrets/provider-attestation.json",
    AI_CONTENT_074_PROVIDER_ATTESTATION_PUBLIC_KEY_FILE: "/run/secrets/provider-public.pem",
    AI_CONTENT_074_PROVIDER_ATTESTATION_KEY_ID: "provider-2026-08",
    AI_CONTENT_074_PROVIDER_ATTESTATION_PUBLIC_KEY_SHA256: "b".repeat(64),
  });
  assert.deepEqual(config.bootstrap074Files, {
    authorizationFile: "/run/secrets/authorization.json",
    authorizationPublicKeyFile: "/run/secrets/authorization-public.pem",
    authorizationKeyId: "authorization-2026-08",
    authorizationPublicKeySha256: "a".repeat(64),
    providerAttestationFile: "/run/secrets/provider-attestation.json",
    providerAttestationPublicKeyFile: "/run/secrets/provider-public.pem",
    providerAttestationKeyId: "provider-2026-08",
    providerAttestationPublicKeySha256: "b".repeat(64),
    imageDigest: undefined,
    imageSourceLabel: undefined,
    roleCatalogSha256: undefined,
    objectCatalogSha256: undefined,
  });
  assert.throws(() => migrateModule.resolveMigrationRuntimeConfig({
    AI_CONTENT_074_AUTHORIZATION_FILE: "/run/secrets/authorization.json",
    AI_CONTENT_074_AUTHORIZATION_KEY_FILE: "/run/secrets/private.key",
  }), /private_key_input_forbidden/);
  assert.throws(() => migrateModule.resolveMigrationRuntimeConfig({
    AI_CONTENT_074_AUTHORIZATION_FILE: "/run/secrets/authorization.json",
    AI_CONTENT_074_AUTHORIZATION_PUBLIC_KEY_FILE: "/run/secrets/authorization-public.pem",
    AI_CONTENT_074_AUTHORIZATION_KEY_ID: "authorization-2026-08",
    AI_CONTENT_074_AUTHORIZATION_PUBLIC_KEY_SHA256: "a".repeat(64),
  }), /bootstrap_074_public_key_config_required/);
});

test("migration CLI passes decoded CA to the migration runner without connecting", async () => {
  let receivedOptions;
  const certificate = "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----";

  await migrateModule.main({
    env: {
      SUPABASE_DATABASE_URL: "postgresql://database.example/postgres",
      DB_SSL_CA_BASE64: Buffer.from(certificate).toString("base64"),
    },
    argv: ["node", "scripts/migrate.mjs", "--dry-run"],
    loadEnvironment: () => {},
    runMigrationsImpl: async (options) => {
      receivedOptions = options;
      return { pending: [], migrations: [], baselineRequired: false };
    },
    logger: { log() {} },
  });

  assert.deepEqual(receivedOptions, {
    connectionString: "postgresql://database.example/postgres",
    baselineUpTo: undefined,
    dryRun: true,
    caCertificate: certificate,
  });
});
