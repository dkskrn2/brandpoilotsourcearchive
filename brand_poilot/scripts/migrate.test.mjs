import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const migrateModule = await import("./migrate.mjs");
const migrationRunner = await import("./migrationRunner.mjs");

test("migration CLI has an ESM main guard and is safe to import", async () => {
  const source = await readFile(
    new URL("./migrate.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /pathToFileURL\(process\.argv\[1\]\)\.href === import\.meta\.url/);
  assert.match(source, /export async function main/);
});

test("migration CLI reserves stdout for its JSON evidence", async () => {
  const originalCwd = process.cwd();
  const originalConsoleLog = console.log;
  const directory = await mkdtemp(join(tmpdir(), "brand-pilot-migrate-"));
  const messages = [];
  try {
    await writeFile(join(directory, ".env"), "MIGRATE_STDOUT_TEST=loaded\n", "utf8");
    process.chdir(directory);
    console.log = (...args) => messages.push(args.join(" "));

    await migrateModule.main({
      env: { SUPABASE_DATABASE_URL: "postgresql://database.example/postgres" },
      argv: ["node", "scripts/migrate.mjs", "--dry-run"],
      runMigrationsImpl: async () => ({ pending: [], migrations: [], baselineRequired: false }),
      logger: console,
    });

    assert.equal(messages.length, 1);
    assert.deepEqual(JSON.parse(messages[0]), {
      applied: [],
      migrationCount: 0,
      baselineRequired: false,
    });
  } finally {
    console.log = originalConsoleLog;
    process.chdir(originalCwd);
    delete process.env.MIGRATE_STDOUT_TEST;
    await rm(directory, { recursive: true, force: true });
  }
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
    allowConsumedRecovery: false,
  });
  assert.equal(migrateModule.resolveMigrationRuntimeConfig({
    SUPABASE_DATABASE_URL: "postgresql://database.example/postgres",
    AI_CONTENT_074_AUTHORIZATION_FILE: "/run/secrets/authorization.json",
    AI_CONTENT_074_AUTHORIZATION_PUBLIC_KEY_FILE: "/run/secrets/authorization-public.pem",
    AI_CONTENT_074_AUTHORIZATION_KEY_ID: "authorization-2026-08",
    AI_CONTENT_074_AUTHORIZATION_PUBLIC_KEY_SHA256: "a".repeat(64),
    AI_CONTENT_074_PROVIDER_ATTESTATION_FILE: "/run/secrets/provider-attestation.json",
    AI_CONTENT_074_PROVIDER_ATTESTATION_PUBLIC_KEY_FILE: "/run/secrets/provider-public.pem",
    AI_CONTENT_074_PROVIDER_ATTESTATION_KEY_ID: "provider-2026-08",
    AI_CONTENT_074_PROVIDER_ATTESTATION_PUBLIC_KEY_SHA256: "b".repeat(64),
    AI_CONTENT_074_ALLOW_CONSUMED_RECOVERY: "true",
  }).bootstrap074Files.allowConsumedRecovery, true);
  assert.throws(() => migrateModule.resolveMigrationRuntimeConfig({
    AI_CONTENT_074_ALLOW_CONSUMED_RECOVERY: "TRUE",
  }), /bootstrap_074_consumed_recovery_flag_invalid/);
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

test("migration CLI reads a protected database URL file without exposing it as container env", async () => {
  let receivedOptions;
  const reads = [];
  await migrateModule.main({
    env: { SUPABASE_DATABASE_URL_FILE: "/run/secrets/migration-database-url" },
    argv: ["node", "scripts/migrate.mjs", "--dry-run"],
    loadEnvironment: () => {},
    readDatabaseUrlFileImpl: async (fileName) => {
      reads.push(fileName);
      return "postgresql://content_migration:secret@database.example/postgres\n";
    },
    runMigrationsImpl: async (options) => {
      receivedOptions = options;
      return { pending: [], migrations: [], baselineRequired: false };
    },
    logger: { log() {} },
  });
  assert.deepEqual(reads, ["/run/secrets/migration-database-url"]);
  assert.equal(receivedOptions.connectionString, "postgresql://content_migration:secret@database.example/postgres");
  assert.equal(Object.hasOwn(receivedOptions, "connectionStringFile"), false);
  await assert.rejects(migrateModule.main({
    env: {
      SUPABASE_DATABASE_URL: "postgresql://inline.example/postgres",
      SUPABASE_DATABASE_URL_FILE: "/run/secrets/migration-database-url",
    },
    loadEnvironment: () => {},
    readDatabaseUrlFileImpl: async () => "postgresql://file.example/postgres",
    runMigrationsImpl: async () => ({ pending: [], migrations: [], baselineRequired: false }),
    logger: { log() {} },
  }), /migration_database_url_input_ambiguous/);
});

test("migration CLI exposes the 073a-to-074 restart boundary", async () => {
  const messages = [];
  await migrateModule.main({
    env: { SUPABASE_DATABASE_URL: "postgresql://database.example/postgres" },
    argv: ["node", "scripts/migrate.mjs"],
    loadEnvironment: () => {},
    runMigrationsImpl: async () => ({
      pending: ["073a_legacy_trigger_function_search_path.sql"],
      migrations: [{ id: "073a_legacy_trigger_function_search_path.sql" }, { id: "074_ai_content_maintenance_write_fence.sql" }],
      baselineRequired: false,
      bootstrap074RestartRequired: true,
      bootstrap074PrerequisiteMigrationId: "073a_legacy_trigger_function_search_path.sql",
    }),
    logger: { log: (message) => messages.push(message) },
  });
  assert.deepEqual(JSON.parse(messages[0]), {
    applied: ["073a_legacy_trigger_function_search_path.sql"],
    migrationCount: 2,
    baselineRequired: false,
    bootstrap074RestartRequired: true,
    bootstrap074PrerequisiteMigrationId: "073a_legacy_trigger_function_search_path.sql",
  });
});

test("migration CLI routes the real full source through 073a before touching 074 or 075", async () => {
  const migrations = await migrationRunner.loadMigrations();
  const history = migrations
    .filter(({ id }) => id <= "073_ai_content_generation_v2_render_pipeline.sql")
    .map(({ id, checksum }) => ({ id, checksum }));
  const makeClient = (historyRows = history) => {
    const calls = [];
    let localSchemaOwner = false;
    return { calls, client: {
    async query(sql) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      calls.push(normalized);
      if (normalized === 'set local role "content_schema_owner"') localSchemaOwner = true;
      if (["commit", "rollback"].includes(normalized)) localSchemaOwner = false;
      if (normalized.includes("bootstrap_role_catalog_v4")) return { rows: [
        { role_name: "content_schema_owner", can_login: false, is_superuser: false, bypass_rls: false, can_create_db: false, can_create_role: false, can_replicate: false, inherit: true, config: ["search_path=public,pg_catalog,pg_temp"] },
        ...["content_application", "content_operator", "content_cleanup"].map((role_name) => ({ role_name, can_login: true, is_superuser: false, bypass_rls: false, can_create_db: false, can_create_role: false, can_replicate: false, inherit: true, config: ["search_path=pg_catalog,public,pg_temp"] })),
        { role_name: "content_migration", can_login: true, is_superuser: false, bypass_rls: false, can_create_db: false, can_create_role: false, can_replicate: false, inherit: false, config: ["search_path=public,pg_catalog,pg_temp"] },
      ] };
      if (normalized.includes("bootstrap_role_membership_catalog_v2")) return { rows: [{ member_role_name: "content_migration", parent_role_name: "content_schema_owner", set_option: true, inherit_option: false, admin_option: false }] };
      const schemaAcl = [
        { grantee: "pg_database_owner", privilege: "CREATE", grantable: false }, { grantee: "pg_database_owner", privilege: "USAGE", grantable: false },
        { grantee: "content_schema_owner", privilege: "CREATE", grantable: false }, { grantee: "content_schema_owner", privilege: "USAGE", grantable: false },
        ...["content_application", "content_operator", "content_migration", "content_cleanup"].map((grantee) => ({ grantee, privilege: "USAGE", grantable: false })),
      ];
      if (normalized.includes("bootstrap_role_environment_catalog_v1")) return { rows: [{ database_name: "test", database_owner_role_name: "postgres", public_schema_owner_role_name: "pg_database_owner", public_schema_acl: schemaAcl, database_settings: [], session_user_name: "content_migration", current_user_name: "content_migration", effective_search_path: "public,pg_catalog,pg_temp" }] };
      if (normalized.includes("bootstrap_session_environment_v1")) return { rows: [{ session_user_name: "content_migration", current_user_name: localSchemaOwner ? "content_schema_owner" : "content_migration", effective_search_path: "public,pg_catalog,pg_temp" }] };
      if (normalized.includes("to_regclass('public.schema_migrations')")) {
        return { rows: [{ relation: "schema_migrations" }] };
      }
      if (normalized.includes("select id, checksum from schema_migrations")) return { rows: historyRows };
      if (normalized.includes("legacy_trigger_search_path_provider_owner_v1")) {
        return { rows: [{
          owner_role_name: "postgres", function_count: 19, owner_count: 1,
          session_user_name: "postgres", current_user_name: "postgres",
        }] };
      }
      return { rows: [] };
    },
    } };
  };
  const rejected = makeClient();
  await assert.rejects(migrateModule.main({
    env: {
      SUPABASE_DATABASE_URL: "postgresql://database.example/postgres",
      AI_CONTENT_074_SCHEMA_OWNER_ROLE: "content_schema_owner",
      AI_CONTENT_074_APPLICATION_ROLE: "content_application",
      AI_CONTENT_074_OPERATOR_ROLE: "content_operator",
      AI_CONTENT_074_MIGRATION_ROLE: "content_migration",
      AI_CONTENT_074_CLEANUP_ROLE: "content_cleanup",
    },
    argv: ["node", "scripts/migrate.mjs"],
    loadEnvironment: () => {},
    runMigrationsImpl: async (options) => migrationRunner.runMigrationsWithClient({
      client: rejected.client,
      migrations,
      bootstrap074Prerequisite: options.bootstrap074Prerequisite,
      bootstrap074PrerequisiteMode: options.bootstrap074PrerequisiteMode,
      bootstrap074PrerequisiteProviderRoleName: options.bootstrap074PrerequisiteProviderRoleName,
    }),
    logger: { log() {} },
  }), /bootstrap_074_prerequisite_required/);
  assert.equal(rejected.calls.some((sql) => /^(?:begin|alter|insert|update|delete|commit|rollback)\b/i.test(sql)), false);

  const optedIn = makeClient();
  const messages = [];
  await migrateModule.main({
    env: {
      SUPABASE_DATABASE_URL: "postgresql://database.example/postgres",
      AI_CONTENT_074_SCHEMA_OWNER_ROLE: "content_schema_owner",
      AI_CONTENT_074_APPLICATION_ROLE: "content_application",
      AI_CONTENT_074_OPERATOR_ROLE: "content_operator",
      AI_CONTENT_074_MIGRATION_ROLE: "content_migration",
      AI_CONTENT_074_CLEANUP_ROLE: "content_cleanup",
      AI_CONTENT_074_PREREQUISITE_PROVIDER_ROLE: "postgres",
    },
    argv: ["node", "scripts/migrate.mjs", "--bootstrap-074-prerequisite"],
    loadEnvironment: () => {},
    runMigrationsImpl: async (options) => migrationRunner.runMigrationsWithClient({
      client: optedIn.client,
      migrations,
      bootstrap074Prerequisite: options.bootstrap074Prerequisite,
      bootstrap074PrerequisiteMode: options.bootstrap074PrerequisiteMode,
      bootstrap074PrerequisiteProviderRoleName: options.bootstrap074PrerequisiteProviderRoleName,
    }),
    logger: { log: (message) => messages.push(message) },
  });
  const output = JSON.parse(messages[0]);
  assert.deepEqual(output.applied, ["073a_legacy_trigger_function_search_path.sql"]);
  assert.equal(output.bootstrap074RestartRequired, true);
  assert.equal(optedIn.calls.some((sql) => sql.startsWith("set local role")), false);
  assert.ok(optedIn.calls.some((sql) => sql.includes("legacy_trigger_search_path_provider_owner_v1")));
  assert.equal(optedIn.calls.some((sql) => sql.includes("bootstrap_object_catalog_")), false);
  assert.equal(optedIn.calls.some((sql) => sql.includes("bootstrap_event_trigger_catalog_")), false);
  assert.equal(optedIn.calls.some((sql) => /create table ai_content_maintenance_state/i.test(sql)), false);
  assert.equal(optedIn.calls.some((sql) => /create table ai_content_proposal_performance_audits/i.test(sql)), false);

  const postPrerequisiteHistory = [
    ...history,
    migrations.find(({ id }) => id === "073a_legacy_trigger_function_search_path.sql"),
  ].map(({ id, checksum }) => ({ id, checksum }));
  const postPrerequisite = makeClient(postPrerequisiteHistory);
  await assert.rejects(migrationRunner.runMigrationsWithClient({
    client: postPrerequisite.client,
    migrations,
    bootstrap074Prerequisite: {
      schemaOwnerRoleName: "content_schema_owner", applicationRoleName: "content_application",
      operatorRoleName: "content_operator", migrationRoleName: "content_migration", cleanupRoleName: "content_cleanup",
    },
  }), /bootstrap_role_authorization_required/);
  assert.equal(postPrerequisite.calls.some((sql) => /create table ai_content_proposal_performance_audits/i.test(sql)), false);
  assert.equal(postPrerequisite.calls.some((sql) => /^(?:begin|alter|insert|update|delete|commit|rollback)\b/i.test(sql)), false);
});

test("075 migration CLI requires a protected preflight evidence file", () => {
  const env = {
    SUPABASE_DATABASE_URL: "postgresql://database.example/postgres",
    AI_CONTENT_075_CUTOVER_ID: "11111111-1111-4111-8111-111111111111",
    AI_CONTENT_075_BYPASS_TOKEN_FILE: "/run/secrets/bypass-token",
    AI_CONTENT_075_EXPECTED_DATABASE_ROLE: "content_migration",
    AI_CONTENT_075_ALLOWLIST_AUTHORIZATION_FILE: "/run/secrets/allowlist-authorization.json",
    AI_CONTENT_075_ALLOWLIST_ATTESTATION_FILE: "/run/secrets/allowlist-attestation.json",
    AI_CONTENT_075_PREFLIGHT_EVIDENCE_FILE: "/run/secrets/proposal-preflight.json",
    AI_CONTENT_075_AUTHORIZATION_PUBLIC_KEY_FILE: "/run/secrets/authorization-public.pem",
    AI_CONTENT_075_AUTHORIZATION_KEY_ID: "authorization-2026-08",
    AI_CONTENT_075_AUTHORIZATION_PUBLIC_KEY_SHA256: "a".repeat(64),
    AI_CONTENT_075_PROVIDER_ATTESTATION_PUBLIC_KEY_FILE: "/run/secrets/provider-public.pem",
    AI_CONTENT_075_PROVIDER_ATTESTATION_KEY_ID: "provider-2026-08",
    AI_CONTENT_075_PROVIDER_ATTESTATION_PUBLIC_KEY_SHA256: "b".repeat(64),
  };
  assert.equal(
    migrateModule.resolveMigrationRuntimeConfig(env).cutover075Files.preflightEvidenceFile,
    "/run/secrets/proposal-preflight.json",
  );
  const { AI_CONTENT_075_PREFLIGHT_EVIDENCE_FILE: _missing, ...missingEvidence } = env;
  assert.throws(
    () => migrateModule.resolveMigrationRuntimeConfig(missingEvidence),
    /cutover_075_public_config_required/,
  );
});

test("075 preflight evidence parser binds exact cutover and migration identity", () => {
  const cutoverId = "11111111-1111-4111-8111-111111111111";
  const migrationSha256 = "c".repeat(64);
  const proposalPreflightIdentity = {
    preflightCandidateSha: "d".repeat(40),
    contentProposalWorkerImageDigest: `sha256:${"e".repeat(64)}`,
    proposalWorkerSourceSha: "f".repeat(40),
    proposalWorkerTreeSha: "0".repeat(40),
    proposalContractSourceSha256: "1".repeat(64),
    proposalSchemaSha256: "2".repeat(64),
    proposalCatalogSha256: "3".repeat(64),
    proposalModelId: "gpt-5.6-terra",
    proposalCommandDescriptorSha256: "4".repeat(64),
    migrationSha256,
  };
  const evidence = {
    contractVersion: "ai-content-075-proposal-preflight-evidence.v1",
    cutoverId,
    proposalPreflightIdentity,
    proposalPreflightIdentitySha256: "5".repeat(64),
    proposalPreflightTransferSha256: "6".repeat(64),
  };
  assert.deepEqual(
    migrateModule.parseCutover075PreflightEvidence(evidence, { cutoverId, migrationSha256 }),
    {
      proposalPreflightIdentity,
      proposalPreflightIdentitySha256: "5".repeat(64),
      proposalPreflightTransferSha256: "6".repeat(64),
    },
  );
  for (const invalid of [
    { ...evidence, cutoverId: "22222222-2222-4222-8222-222222222222" },
    { ...evidence, proposalPreflightIdentity: null },
    { ...evidence, proposalPreflightIdentity: { ...proposalPreflightIdentity, migrationSha256: "7".repeat(64) } },
    { ...evidence, proposalPreflightIdentitySha256: null },
    { ...evidence, proposalPreflightTransferSha256: "short" },
    { ...evidence, unexpected: true },
  ]) {
    assert.throws(
      () => migrateModule.parseCutover075PreflightEvidence(invalid, { cutoverId, migrationSha256 }),
      /cutover_075_preflight_evidence_invalid/,
    );
  }
});
