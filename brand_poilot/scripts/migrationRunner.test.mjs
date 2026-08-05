import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Client } from "pg";
import * as migrationRunner from "./migrationRunner.mjs";

const { buildMigrationPlan } = migrationRunner;

test("074 bootstrap role authorization rejects unsigned, replayed, stale, wrong image, and wrong migration requests", () => {
  const now = new Date("2026-08-05T00:00:00.000Z");
  const base = {
    contractVersion: "ai-content-bootstrap-role-authorization.v1",
    requestId: "bootstrap-074-1",
    migrationId: "074_ai_content_maintenance_write_fence.sql",
    migrationSha256: "1".repeat(64),
    imageDigest: `sha256:${"2".repeat(64)}`,
    imageSourceLabel: "3".repeat(40),
    roleCatalogSha256: "4".repeat(64),
    objectCatalogSha256: "5".repeat(64),
    migrationRoleName: "content_migration",
    schemaOwnerRoleName: "content_schema_owner",
    applicationRoleName: "content_application",
    operatorRoleName: "content_operator",
    cleanupRoleName: "content_cleanup",
    eventTriggerName: "ai_content_ddl_guard_074",
    eventTriggerFunction: "public.enforce_ai_content_ddl_allowlist",
    eventTriggerFunctionSha256: "6".repeat(64),
    eventTriggerDefinitionSha256: "7".repeat(64),
    issuedAt: "2026-08-04T23:59:00.000Z",
    expiresAt: "2026-08-05T00:01:00.000Z",
  };
  const signingKey = "bootstrap-test-signing-key";
  const authorization = {
    ...base,
    signature: migrationRunner.signBootstrapRoleAuthorization(base, signingKey),
  };
  const context = {
    signingKey,
    now,
    migration: { id: base.migrationId, checksum: base.migrationSha256 },
    imageDigest: base.imageDigest,
    imageSourceLabel: base.imageSourceLabel,
    roleCatalogSha256: base.roleCatalogSha256,
    objectCatalogSha256: base.objectCatalogSha256,
    usedRequestIds: new Set(),
  };

  assert.equal(migrationRunner.validateBootstrapRoleAuthorization(authorization, context).requestId, base.requestId);
  assert.throws(() => migrationRunner.validateBootstrapRoleAuthorization({ ...authorization, signature: "0".repeat(64) }, context), /bootstrap_role_authorization_signature_invalid/);
  assert.throws(() => migrationRunner.validateBootstrapRoleAuthorization(authorization, { ...context, usedRequestIds: new Set([base.requestId]) }), /bootstrap_role_authorization_replayed/);
  assert.throws(() => migrationRunner.validateBootstrapRoleAuthorization(authorization, { ...context, now: new Date("2026-08-05T00:02:00.000Z") }), /bootstrap_role_authorization_expired/);
  assert.throws(() => migrationRunner.validateBootstrapRoleAuthorization(authorization, { ...context, imageDigest: `sha256:${"9".repeat(64)}` }), /bootstrap_role_authorization_image_mismatch/);
  assert.throws(() => migrationRunner.validateBootstrapRoleAuthorization(authorization, { ...context, migration: { id: "075_ai_content_three_format_cutover.sql", checksum: base.migrationSha256 } }), /bootstrap_role_authorization_migration_mismatch/);
});

test("074 bootstrap role authorization seals provider install and consumes exact one-shot trigger evidence", () => {
  const signingKey = "bootstrap-key";
  const providerSigningKey = "provider-key";
  const base = {
    contractVersion: "ai-content-bootstrap-role-authorization.v1",
    requestId: "bootstrap-074-provider",
    migrationId: "074_ai_content_maintenance_write_fence.sql",
    migrationSha256: "1".repeat(64),
    imageDigest: `sha256:${"2".repeat(64)}`,
    imageSourceLabel: "3".repeat(40),
    roleCatalogSha256: "4".repeat(64),
    objectCatalogSha256: "5".repeat(64),
    migrationRoleName: "content_migration",
    schemaOwnerRoleName: "content_schema_owner",
    applicationRoleName: "content_application",
    operatorRoleName: "content_operator",
    cleanupRoleName: "content_cleanup",
    eventTriggerName: "ai_content_ddl_guard_074",
    eventTriggerFunction: "public.enforce_ai_content_ddl_allowlist",
    eventTriggerFunctionSha256: "6".repeat(64),
    eventTriggerDefinitionSha256: "7".repeat(64),
    issuedAt: "2026-08-04T23:59:00.000Z",
    expiresAt: "2026-08-05T00:01:00.000Z",
  };
  const authorization = { ...base, signature: migrationRunner.signBootstrapRoleAuthorization(base, signingKey) };
  const install = migrationRunner.buildProviderEventTriggerInstallRequest(authorization);
  const unsigned = {
    contractVersion: "ai-content-074-provider-attestation.v1",
    providerRequestSha256: install.requestSha256,
    authorizationRequestId: authorization.requestId,
    action: "create_enable_verify_074_event_trigger",
    eventTriggerName: authorization.eventTriggerName,
    eventTriggerFunction: authorization.eventTriggerFunction,
    eventTriggerFunctionSha256: authorization.eventTriggerFunctionSha256,
    eventTriggerDefinitionSha256: authorization.eventTriggerDefinitionSha256,
    eventTriggerOwner: "postgres",
    eventTriggerEnabled: "enabled",
    migrationId: authorization.migrationId,
    migrationSha256: authorization.migrationSha256,
    imageDigest: authorization.imageDigest,
    imageSourceLabel: authorization.imageSourceLabel,
    roleCatalogSha256: authorization.roleCatalogSha256,
    objectCatalogSha256: authorization.objectCatalogSha256,
    issuedAt: "2026-08-05T00:00:00.000Z",
  };
  const attestation = { ...unsigned, signature: migrationRunner.signProviderEventTriggerAttestation(unsigned, providerSigningKey) };
  const context = { authorization, installRequest: install, signingKey: providerSigningKey, now: new Date("2026-08-05T00:00:00.000Z") };

  assert.equal(migrationRunner.validateProviderEventTriggerAttestation(attestation, context).eventTriggerOwner, "postgres");
  assert.throws(() => migrationRunner.validateProviderEventTriggerAttestation({ ...attestation, action: "arbitrary_sql" }, context), /provider_attestation_signature_invalid|provider_attestation_action_mismatch/);
  assert.throws(() => migrationRunner.validateProviderEventTriggerAttestation({ ...attestation, eventTriggerOwner: "content_schema_owner" }, context), /provider_attestation_signature_invalid|provider_attestation_eventTriggerOwner_mismatch/);
  assert.throws(() => migrationRunner.validateProviderEventTriggerAttestation(attestation, { ...context, usedAttestationIds: new Set([install.requestSha256]) }), /provider_attestation_replayed/);
  assert.throws(() => migrationRunner.validateProviderEventTriggerAttestation({
    ...attestation,
    issuedAt: "2026-08-04T22:00:00.000Z",
    signature: migrationRunner.signProviderEventTriggerAttestation({
      ...unsigned,
      issuedAt: "2026-08-04T22:00:00.000Z",
    }, providerSigningKey),
  }, context), /provider_attestation_stale/);
});

test("074 migration source contains no provider-only event-trigger DDL", async () => {
  const migration = (await migrationRunner.loadMigrations()).find(({ id }) => id === "074_ai_content_maintenance_write_fence.sql");
  assert.ok(migration);
  assert.doesNotMatch(migration.sql, /^\s*(?:create|alter)\s+event\s+trigger\b/im);
});

test("074 bootstrap role authorization applies stage one then independently consumes provider evidence", async () => {
  const migration = { id: "074_ai_content_maintenance_write_fence.sql", checksum: "1".repeat(64), sql: "select 1" };
  const signingKey = "bootstrap-stage-key";
  const providerSigningKey = "provider-stage-key";
  const unsignedAuthorization = {
    contractVersion: "ai-content-bootstrap-role-authorization.v1", requestId: "stage-074",
    migrationId: migration.id, migrationSha256: migration.checksum,
    imageDigest: `sha256:${"2".repeat(64)}`, imageSourceLabel: "3".repeat(40),
    roleCatalogSha256: "4".repeat(64), objectCatalogSha256: "5".repeat(64),
    migrationRoleName: "content_migration", schemaOwnerRoleName: "content_schema_owner",
    applicationRoleName: "content_application", operatorRoleName: "content_operator",
    cleanupRoleName: "content_cleanup", eventTriggerName: "ai_content_ddl_guard_074",
    eventTriggerFunction: "public.enforce_ai_content_ddl_allowlist",
    eventTriggerFunctionSha256: "6".repeat(64), eventTriggerDefinitionSha256: "7".repeat(64),
    issuedAt: "2026-08-04T23:59:00.000Z", expiresAt: "2026-08-05T00:01:00.000Z",
  };
  const authorization = {
    ...unsignedAuthorization,
    signature: migrationRunner.signBootstrapRoleAuthorization(unsignedAuthorization, signingKey),
  };
  const calls = [];
  let applied = false;
  const client = {
    async query(sql, parameters = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      calls.push({ sql: normalized, parameters });
      if (normalized.includes("select id, checksum from schema_migrations")) {
        return { rows: applied ? [{ id: migration.id, checksum: migration.checksum }] : [] };
      }
      if (normalized.includes("to_regclass('public.workspaces')")) return { rows: [{ relation: null }] };
      if (normalized === "select session_user, current_user") {
        return { rows: [{ session_user: authorization.migrationRoleName, current_user: authorization.migrationRoleName }] };
      }
      if (normalized.includes("migration_noinherit")) {
        return { rows: [{ migration_noinherit: true, owner_nologin: true, exact_owner_membership: true, other_memberships: 0 }] };
      }
      if (normalized.includes("from ai_content_bootstrap_state where singleton")) {
        return { rows: [{
          authorization_request_id: authorization.requestId,
          migration_role_name: authorization.migrationRoleName,
          schema_owner_role_name: authorization.schemaOwnerRoleName,
          migration_sha256: authorization.migrationSha256,
          role_catalog_sha256: authorization.roleCatalogSha256,
          object_catalog_sha256: authorization.objectCatalogSha256,
        }] };
      }
      if (normalized.includes("app_superuser")) {
        return { rows: [{ app_superuser: false, app_bypassrls: false, app_inherit: false, app_privileged_membership: false, app_owns_fenced_relation: false }] };
      }
      if (normalized.startsWith("insert into schema_migrations")) applied = true;
      return { rows: [], rowCount: 0 };
    },
  };
  const bootstrap = {
    authorization, signingKey, now: new Date("2026-08-05T00:00:00.000Z"),
    imageDigest: authorization.imageDigest, imageSourceLabel: authorization.imageSourceLabel,
    roleCatalogSha256: authorization.roleCatalogSha256, objectCatalogSha256: authorization.objectCatalogSha256,
  };
  const stageOne = await migrationRunner.runMigrationsWithClient({ client, migrations: [migration], bootstrap074: bootstrap });
  assert.equal(stageOne.providerInstallRequest.action, "create_enable_verify_074_event_trigger");
  assert.ok(calls.some(({ sql }) => sql === 'set local role "content_schema_owner"'));
  assert.ok(calls.some(({ sql }) => sql === "select verify_ai_content_write_fence_catalog()"));

  const install = stageOne.providerInstallRequest;
  const unsignedAttestation = {
    contractVersion: "ai-content-074-provider-attestation.v1",
    providerRequestSha256: install.requestSha256, authorizationRequestId: authorization.requestId,
    action: install.action, eventTriggerName: authorization.eventTriggerName,
    eventTriggerFunction: authorization.eventTriggerFunction,
    eventTriggerFunctionSha256: authorization.eventTriggerFunctionSha256,
    eventTriggerDefinitionSha256: authorization.eventTriggerDefinitionSha256,
    eventTriggerOwner: "postgres", eventTriggerEnabled: "enabled",
    migrationId: authorization.migrationId, migrationSha256: authorization.migrationSha256,
    imageDigest: authorization.imageDigest, imageSourceLabel: authorization.imageSourceLabel,
    roleCatalogSha256: authorization.roleCatalogSha256, objectCatalogSha256: authorization.objectCatalogSha256,
    issuedAt: "2026-08-05T00:00:00.000Z",
  };
  const providerAttestation = {
    ...unsignedAttestation,
    signature: migrationRunner.signProviderEventTriggerAttestation(unsignedAttestation, providerSigningKey),
  };
  const originalQuery = client.query.bind(client);
  client.query = async (sql, parameters = []) => {
    if (sql.includes("from pg_event_trigger e")) return { rowCount: 1, rows: [{
      event_trigger_name: authorization.eventTriggerName,
      event_trigger_owner: "postgres", event_trigger_enabled: "enabled",
      event_trigger_function: authorization.eventTriggerFunction,
      event_trigger_function_sha256: authorization.eventTriggerFunctionSha256,
      event_trigger_definition_sha256: authorization.eventTriggerDefinitionSha256,
    }] };
    return originalQuery(sql, parameters);
  };
  const stageTwo = await migrationRunner.runMigrationsWithClient({
    client, migrations: [migration], bootstrap074: {
      ...bootstrap, providerAttestation, providerSigningKey,
    },
  });
  assert.equal(stageTwo.pending.length, 0);
  assert.equal(stageTwo.revocationRequest.migrationRoleName, authorization.migrationRoleName);
  await assert.rejects(
    migrationRunner.runMigrationsWithClient({
      client,
      migrations: [migration, { id: "075_ai_content_three_format_cutover.sql", checksum: "8".repeat(64), sql: "select forbidden_075" }],
      bootstrap074: { ...bootstrap, providerAttestation, providerSigningKey },
    }),
    /bootstrap_075_not_supported_before_cutover_runner/,
  );
  assert.equal(calls.some(({ sql }) => sql.includes("select forbidden_075")), false);
});

const migrations = [
  { id: "001_initial.sql", checksum: "first", sql: "create table first_table();" },
  { id: "002_second.sql", checksum: "second", sql: "create table second_table();" },
];

const legacyInstagramDeliveryChecksum =
  "7e45bc297cf35128368700b49f34974690d699198e465ecfb608ac9922cb1882";
const currentInstagramDeliveryChecksum =
  "db4ef9edcccd8f882ade789b1a2b0bc595c7f5c101fb3c9337b02576928e4a05";

const loadInstagramDeliveryMigrations = async () => {
  const loaded = await migrationRunner.loadMigrations();
  const instagramMigrations = loaded.filter((migration) =>
    [
      "014_instagram_delivery_formats.sql",
      "015_delivery_format_legacy_channels.sql",
    ].includes(migration.id),
  );
  assert.equal(instagramMigrations[0]?.checksum, currentInstagramDeliveryChecksum);
  return instagramMigrations;
};

const createRecordingClient = ({ failMigration = false } = {}) => {
  const calls = [];
  return {
    calls,
    async query(sql, parameters = []) {
      const normalizedSql = sql.replace(/\s+/g, " ").trim();
      calls.push({ sql: normalizedSql, parameters });

      if (normalizedSql === "select id, checksum from schema_migrations order by id asc") {
        return { rows: [] };
      }
      if (normalizedSql.includes("to_regclass('public.workspaces')")) {
        return { rows: [{ relation: null }] };
      }
      if (normalizedSql === "select migration_body" && failMigration) {
        throw new Error("migration_execution_failed");
      }
      return { rows: [], rowCount: 0 };
    },
  };
};

test("migration client uses verified TLS without sslmode conflicts", () => {
  const config = migrationRunner.resolveMigrationClientConfig(
    "postgresql://user:password@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require",
  );

  assert.doesNotMatch(config.connectionString, /sslmode=/);
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test("migration client includes a provided CA in verified TLS", () => {
  const config = migrationRunner.resolveMigrationClientConfig(
    "postgresql://user:password@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require",
    { caCertificate: "test-ca" },
  );

  assert.deepEqual(config.ssl, {
    rejectUnauthorized: true,
    ca: "test-ca",
  });
});

test("migration client uses verified TLS for direct Supabase database hosts", () => {
  const config = migrationRunner.resolveMigrationClientConfig(
    "postgresql://postgres:secret@db.project.supabase.co:5432/postgres?sslmode=require",
  );

  assert.doesNotMatch(config.connectionString, /sslmode=/);
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test("migration client keeps local PostgreSQL free of TLS overrides", () => {
  const connectionString = "postgresql://user:password@127.0.0.1:5432/brand_pilot";

  assert.deepEqual(
    migrationRunner.resolveMigrationClientConfig(connectionString),
    { connectionString },
  );
});

test("migration client strips duplicate case-insensitive SSL query overrides before pg parses them", () => {
  const config = migrationRunner.resolveMigrationClientConfig(
    "postgresql://postgres:secret@db.project.supabase.co:5432/postgres"
      + "?ssl=0&SSL=no-verify&ssl=no-verify&sslmode=disable&SSLMODE=no-verify"
      + "&sslcert=ignored&sslkey=ignored&sslrootcert=ignored"
      + "&sslnegotiation=direct&uselibpqcompat=true",
    { caCertificate: "test-ca" },
  );
  const overrideKeys = [...new URL(config.connectionString).searchParams.keys()]
    .filter((key) => key.toLowerCase().startsWith("ssl")
      || key.toLowerCase() === "uselibpqcompat");

  assert.deepEqual(overrideKeys, []);
  const client = new Client(config);
  assert.deepEqual(client.connectionParameters.ssl, {
    rejectUnauthorized: true,
    ca: "test-ca",
  });
});

test("migration client does not classify lookalike domains as Supabase", () => {
  const connectionString = "postgresql://user:secret@db.project.supabase.co.evil.example/postgres?ssl=no-verify";

  assert.deepEqual(
    migrationRunner.resolveMigrationClientConfig(connectionString),
    { connectionString },
  );
});

test("legacy 014 fixture has the exact allowlisted checksum", async () => {
  const fixture = await readFile(
    "scripts/fixtures/014_instagram_delivery_formats.legacy.sql",
  );
  assert.equal(
    createHash("sha256").update(fixture).digest("hex"),
    legacyInstagramDeliveryChecksum,
  );
});

test("Wiki refresh includes owned sources regardless of their enabled state", async () => {
  const sql = await readFile(
    "db/migrations/023_wiki_include_disabled_owned_sources.sql",
    "utf8",
  );

  assert.match(sql, /source\.source_type = 'owned'/);
  assert.doesNotMatch(sql, /source\.enabled/);
});

test("Wiki refresh indexes the latest snapshot for every owned-site content page", async () => {
  const sql = await readFile(
    "db/migrations/024_wiki_index_all_owned_pages.sql",
    "utf8",
  );

  assert.match(sql, /from source_content_items item/);
  assert.match(sql, /latest\.source_content_item_id = item\.id/);
  assert.doesNotMatch(sql, /source\.enabled/);
});

test("DM conversation operations migration defines the operational schema in one transaction", async () => {
  const sql = await readFile(
    "db/migrations/025_dm_conversation_operations.sql",
    "utf8",
  );

  assert.match(sql, /^begin;/);
  assert.match(sql, /commit;\s*$/);
  assert.match(sql, /alter table instagram_dm_conversations/);
  assert.match(sql, /automation_status text not null default 'active'/);
  assert.match(sql, /attention_status text not null default 'none'/);
  assert.match(sql, /unread_count integer not null default 0/);
  assert.match(sql, /check \(automation_status in \('active', 'paused'\)\)/);
  assert.match(sql, /check \(attention_status in \('none', 'open', 'resolved'\)\)/);
  assert.match(sql, /check \(unread_count >= 0\)/);
  assert.match(sql, /create table dm_turns/);
  assert.match(sql, /create table dm_attention_items/);
  assert.match(sql, /create table dm_delivery_attempts/);
  assert.match(sql, /alter table instagram_dm_messages[\s\S]*add column turn_id/);
  assert.match(sql, /add column decision/);
  assert.match(sql, /add column reason_code/);
  assert.match(sql, /add column delivery_attempt_id/);
});

test("DM conversation operations migration enforces lifecycle, dedupe, and JSON constraints", async () => {
  const sql = await readFile(
    "db/migrations/025_dm_conversation_operations.sql",
    "utf8",
  );

  assert.match(sql, /check \(status in \('collecting', 'queued', 'processing', 'completed', 'skipped'\)\)/);
  assert.match(sql, /create unique index dm_turns_collecting_conversation_unique[\s\S]*where status = 'collecting'/);
  assert.match(sql, /check \(attention_type in \('restricted_action', 'complaint', 'knowledge_gap', 'delivery_unknown', 'processing_error'\)\)/);
  assert.match(sql, /check \(reason_code in \('direct_faq', 'wiki_answer', 'restricted_action', 'complaint', 'knowledge_gap', 'low_confidence', 'processing_error', 'system_event'\)\)/);
  assert.match(sql, /check \(jsonb_typeof\(detail_json\) = 'object'\)/);
  assert.match(sql, /job_id uuid not null/);
  assert.match(sql, /constraint dm_delivery_attempts_job_unique unique \(job_id\)/);
  assert.match(sql, /create unique index dm_delivery_attempts_dedupe_unique[\s\S]*on dm_delivery_attempts\(dedupe_key\)/);
  assert.match(sql, /check \(status in \('prepared', 'sending', 'sent', 'unknown', 'failed'\)\)/);
});

test("DM conversation operations migration enforces composite tenant ownership", async () => {
  const sql = await readFile(
    "db/migrations/025_dm_conversation_operations.sql",
    "utf8",
  );

  assert.match(sql, /constraint instagram_dm_conversations_tenant_identity_unique\s+unique \(id, workspace_id, brand_id\)/);
  assert.match(sql, /constraint instagram_dm_messages_tenant_identity_unique\s+unique \(id, workspace_id, brand_id, conversation_id\)/);
  assert.match(sql, /constraint jobs_tenant_identity_unique\s+unique \(id, workspace_id, brand_id\)/);
  assert.match(sql, /constraint instagram_dm_messages_conversation_ownership_fk\s+foreign key \(conversation_id, workspace_id, brand_id\)\s+references instagram_dm_conversations\(id, workspace_id, brand_id\)/);
  assert.match(sql, /constraint dm_turns_tenant_identity_unique\s+unique \(id, workspace_id, brand_id, conversation_id\)/);
  assert.match(sql, /constraint dm_turns_conversation_ownership_fk\s+foreign key \(conversation_id, workspace_id, brand_id\)\s+references instagram_dm_conversations\(id, workspace_id, brand_id\)/);
  assert.match(sql, /constraint dm_attention_items_conversation_ownership_fk\s+foreign key \(conversation_id, workspace_id, brand_id\)\s+references instagram_dm_conversations\(id, workspace_id, brand_id\)/);
  assert.match(sql, /constraint dm_attention_items_trigger_message_ownership_fk\s+foreign key \(trigger_message_id, workspace_id, brand_id, conversation_id\)\s+references instagram_dm_messages\(id, workspace_id, brand_id, conversation_id\)/);
  assert.match(sql, /constraint dm_attention_items_trigger_turn_ownership_fk\s+foreign key \(trigger_turn_id, workspace_id, brand_id, conversation_id\)\s+references dm_turns\(id, workspace_id, brand_id, conversation_id\)/);
  assert.match(sql, /constraint dm_delivery_attempts_conversation_ownership_fk\s+foreign key \(conversation_id, workspace_id, brand_id\)\s+references instagram_dm_conversations\(id, workspace_id, brand_id\)/);
  assert.match(sql, /constraint dm_delivery_attempts_tenant_identity_unique\s+unique \(id, workspace_id, brand_id, conversation_id\)/);
  assert.match(sql, /constraint dm_delivery_attempts_job_ownership_fk\s+foreign key \(job_id, workspace_id, brand_id\)\s+references jobs\(id, workspace_id, brand_id\)\s+on delete restrict/);
  assert.match(sql, /constraint instagram_dm_messages_turn_ownership_fk\s+foreign key \(turn_id, workspace_id, brand_id, conversation_id\)\s+references dm_turns\(id, workspace_id, brand_id, conversation_id\)/);
  assert.match(sql, /constraint instagram_dm_messages_delivery_ownership_fk\s+foreign key \(delivery_attempt_id, workspace_id, brand_id, conversation_id\)\s+references dm_delivery_attempts\(id, workspace_id, brand_id, conversation_id\)/);
});

test("DM delivery attempts survive job cleanup", async () => {
  const sql = await readFile(
    "db/migrations/025_dm_conversation_operations.sql",
    "utf8",
  );

  assert.doesNotMatch(sql, /job_id uuid not null references jobs\(id\) on delete cascade/);
  assert.match(sql, /dm_delivery_attempts_job_ownership_fk[\s\S]*references jobs\(id, workspace_id, brand_id\)\s+on delete restrict/);
});

test("DM conversation operations migration preserves job types and limits updated_at triggers", async () => {
  const sql = await readFile(
    "db/migrations/025_dm_conversation_operations.sql",
    "utf8",
  );
  const expectedJobTypes = [
    "daily_generation_enqueue", "source_crawl", "topic_select", "master_draft_generate",
    "channel_output_generate", "auto_approval_check", "instagram_feed_render",
    "instagram_story_render", "instagram_reel_render", "threads_text_render",
    "artifact_upload", "instagram_publish", "threads_publish", "token_health_check",
    "storage_cleanup", "wiki_refresh", "instagram_dm_reply", "instagram_dm_profile_refresh",
  ];

  for (const jobType of expectedJobTypes) {
    assert.match(sql, new RegExp(`'${jobType}'`));
  }
  assert.match(sql, /create trigger dm_turns_set_updated_at\s+before update on dm_turns/);
  assert.match(sql, /create trigger dm_attention_items_set_updated_at\s+before update on dm_attention_items/);
  assert.match(sql, /create trigger dm_delivery_attempts_set_updated_at\s+before update on dm_delivery_attempts/);
  assert.doesNotMatch(sql, /instagram_dm_messages_set_updated_at/);
});

test("admin API foundation migration adds external actors and idempotent mutations", async () => {
  const sql = await readFile(
    "db/migrations/045_admin_api_foundation.sql",
    "utf8",
  );

  assert.match(sql, /alter table audit_events[\s\S]*add column actor_external_id text null/i);
  assert.match(sql, /audit_events_actor_type_check[\s\S]*'admin'/i);
  assert.match(sql, /create table admin_idempotency_keys/i);
  assert.match(sql, /request_hash text not null/i);
  assert.match(sql, /response_json jsonb not null/i);
  assert.match(sql, /unique \(actor_external_id, idempotency_key\)/i);
});

test("versioned Wiki migration expands knowledge entries with conditional item contracts", async () => {
  const sql = await readFile(
    "db/migrations/026_wiki_versions_and_knowledge_items.sql",
    "utf8",
  );

  assert.match(sql, /^begin;/);
  assert.match(sql, /commit;\s*$/);
  assert.match(sql, /add column entry_type text not null default 'faq'/);
  assert.match(sql, /add column title text/);
  assert.match(sql, /add column content text/);
  assert.match(sql, /add column aliases text\[\] not null default '\{\}'/);
  assert.match(sql, /add column structured_data jsonb not null default '\{\}'::jsonb/);
  assert.match(sql, /add column direct_reply_enabled boolean not null default true/);
  assert.match(sql, /set title = question,\s*content = answer/);
  assert.match(sql, /drop not null/);
  assert.match(sql, /entry_type in \('faq', 'product', 'policy'\)/);
  assert.match(sql, /entry_type <> 'faq'[\s\S]*question is not null[\s\S]*answer is not null/);
  assert.match(sql, /entry_type not in \('product', 'policy'\)[\s\S]*title is not null[\s\S]*content is not null/);
  assert.match(sql, /normalized_question is not null[\s\S]*length\(trim\(normalized_question\)\) > 0/);
  assert.match(sql, /jsonb_typeof\(structured_data\) = 'object'/);
});

test("versioned Wiki migration creates build tables and version-scoped documents", async () => {
  const sql = await readFile(
    "db/migrations/026_wiki_versions_and_knowledge_items.sql",
    "utf8",
  );

  assert.match(sql, /create table wiki_versions/);
  assert.match(sql, /status in \('building', 'active', 'failed', 'superseded'\)/);
  assert.match(sql, /source_count integer not null default 0/);
  assert.match(sql, /document_count integer not null default 0/);
  assert.match(sql, /chunk_count integer not null default 0/);
  assert.match(sql, /prompt_version text/);
  assert.match(sql, /embedding_model text/);
  assert.match(sql, /embedding_version text/);
  assert.match(sql, /create table wiki_build_items/);
  assert.match(sql, /status in \('pending', 'processing', 'succeeded', 'failed'\)/);
  assert.match(sql, /add column wiki_version_id uuid/);
  assert.match(sql, /constraint wiki_documents_version_ownership_fk\s+foreign key \(wiki_version_id, workspace_id, brand_id\)\s+references wiki_versions\(id, workspace_id, brand_id\) on delete cascade/);
  assert.match(sql, /add column normalized_json jsonb not null default '\{\}'::jsonb/);
  assert.match(sql, /add column source_url text/);
  assert.match(sql, /source_kind in \('faq', 'product', 'policy', 'owned_snapshot'\)/);
  assert.match(sql, /insert into wiki_versions[\s\S]*'active'/);
  assert.match(sql, /count\(distinct document\.id\)::integer,[\s\S]*count\(distinct document\.id\)::integer,[\s\S]*count\(distinct chunk\.id\)::integer/);
  assert.match(sql, /update wiki_documents document[\s\S]*set wiki_version_id = version\.id/);
  assert.match(sql, /drop index if exists wiki_documents_active_faq_unique/);
  assert.match(sql, /drop index if exists wiki_documents_active_snapshot_unique/);
  assert.match(sql, /create unique index wiki_documents_version_knowledge_entry_unique[\s\S]*wiki_version_id, knowledge_entry_id/);
  assert.match(sql, /create unique index wiki_documents_version_snapshot_unique[\s\S]*wiki_version_id, source_snapshot_id/);
});

test("Wiki activation validates completed items and preserves the current active version on failure", async () => {
  const sql = await readFile(
    "db/migrations/026_wiki_versions_and_knowledge_items.sql",
    "utf8",
  );
  const activation = sql.slice(sql.indexOf("create or replace function activate_wiki_version"));

  assert.match(activation, /returns boolean/);
  assert.match(activation, /item\.status <> 'succeeded'/);
  assert.match(activation, /from wiki_documents document/);
  assert.match(activation, /join wiki_chunks chunk/);
  assert.match(activation, /chunk\.enabled/);
  assert.match(activation, /set status = 'failed'/);
  assert.match(activation, /return false/);
  assert.match(activation, /set status = 'superseded'/);
  assert.match(activation, /set status = 'active'/);
  assert.match(activation, /set is_active = false/);
  assert.match(activation, /set is_active = true/);
  assert.ok(
    activation.indexOf("set status = 'failed'") < activation.indexOf("set status = 'superseded'"),
    "validation failure must be handled before the current active version is superseded",
  );
});

test("Wiki search v2 exposes absolute and ranking scores from only the active enabled Wiki", async () => {
  const sql = await readFile("db/migrations/027_wiki_search_v2.sql", "utf8");

  assert.match(sql, /^begin;/);
  assert.match(sql, /commit;\s*$/);
  assert.match(sql, /create or replace function search_brand_wiki_v2/);
  assert.match(sql, /chunk_id uuid/);
  assert.match(sql, /wiki_document_id uuid/);
  assert.match(sql, /knowledge_entry_id uuid/);
  assert.match(sql, /source_kind text/);
  assert.match(sql, /title text/);
  assert.match(sql, /content text/);
  assert.match(sql, /direct_answer text/);
  assert.match(sql, /cosine_similarity double precision/);
  assert.match(sql, /keyword_match double precision/);
  assert.match(sql, /rrf_score double precision/);
  assert.match(sql, /chunk\.embedding <=> p_query_embedding/);
  assert.match(sql, /1 - distance/);
  assert.match(sql, /version\.status = 'active'/);
  assert.match(sql, /chunk\.enabled/);
});

test("compiled Wiki migrations define a brand-scoped core and pgvector boundary", async () => {
  const core = await readFile("db/migrations/032_compounding_wiki_core.sql", "utf8");
  const vector = await readFile("db/migrations/033_compounding_wiki_pgvector.sql", "utf8");

  assert.match(core, /add column build_stage text/);
  assert.match(core, /status in \('building', 'ready', 'active', 'failed', 'superseded'\)/);
  for (const table of [
    "wiki_build_requests", "wiki_source_units", "wiki_pages", "wiki_page_sources",
    "wiki_page_links", "wiki_page_chunks", "wiki_compilation_items",
    "wiki_retrieval_runs", "wiki_maintenance_runs", "wiki_issues",
  ]) {
    assert.match(core, new RegExp(`create table ${table}`));
  }
  assert.doesNotMatch(core, /\bvector\s*\(/);
  assert.doesNotMatch(core, /\bwiki_engine\b|\blegacy_rag\b|\bcompiled_wiki\b/);

  assert.match(vector, /^-- requires: pgvector/);
  assert.match(vector, /add column embedding vector\(1536\)/);
  assert.match(vector, /create or replace function search_brand_compiled_wiki/);
  assert.match(vector, /create or replace function activate_compiled_wiki_version/);
  assert.match(vector, /jsonb_array_elements_text\(section -> 'sourceUnitIds'\)/);
  assert.match(vector, /source\.wiki_source_unit_id::text = listed_source\.source_unit_id/);
  assert.match(vector, /wiki_compilation_items_missing/);
  assert.doesNotMatch(vector, /\bwiki_engine\b|\blegacy_rag\b/);
});

test("070 adds bounded lexical compiled Wiki retrieval without a query vector", async () => {
  const sql = await readFile(
    "db/migrations/070_remove_embedding_runtime.sql",
    "utf8",
  );

  assert.match(sql, /^begin;/);
  assert.match(sql, /commit;\s*$/);
  assert.match(
    sql,
    /create or replace function search_brand_wiki_lexical\(\s*p_workspace_id uuid,\s*p_brand_id uuid,\s*p_query text,\s*p_limit integer default 12,\s*p_is_offering_question boolean default false,\s*p_is_product_question boolean default false,\s*p_is_offering_location_question boolean default false\s*\)/i,
  );
  for (const field of [
    "page_chunk_id uuid",
    "wiki_page_id uuid",
    "page_type text",
    "title text",
    "content text",
    "source_link_ids uuid[]",
    "cosine_similarity double precision",
    "keyword_match double precision",
    "rrf_score double precision",
  ]) {
    assert.match(sql, new RegExp(field.replace("[]", "\\[\\]"), "i"));
  }
  assert.match(sql, /websearch_to_tsquery\('simple'/i);
  assert.match(sql, /chunk\.search_vector/i);
  assert.match(sql, /version\.status = 'active'/i);
  assert.match(sql, /chunk\.enabled/i);
  assert.match(sql, /normalized_phrase_match/i);
  assert.match(sql, /token_overlap/i);
  assert.match(sql, /title_match/i);
  assert.match(sql, /stable_key_match/i);
  assert.match(sql, /alias_match/i);
  assert.match(sql, /keyword_array_match/i);
  assert.match(
    sql,
    /limit greatest\(1, least\(coalesce\(p_limit, 12\), 12\)\)/i,
  );
  assert.doesNotMatch(sql, /p_query_embedding/i);
  assert.doesNotMatch(sql, /<=>/);
});

test("070 preserves trusted offering filtering and product/location priorities before lexical rank", async () => {
  const sql = await readFile(
    "db/migrations/070_remove_embedding_runtime.sql",
    "utf8",
  );

  assert.match(
    sql,
    /not coalesce\(p_is_offering_question,\s*false\)[\s\S]*page\.page_type in \('product',\s*'service'\)[\s\S]*source\.source_kind in \('product',\s*'product_service',\s*'service'\)/i,
  );
  assert.match(
    sql,
    /source\.source_kind = 'owned_snapshot'[\s\S]*source\.source_url is not null[\s\S]*lower\(source\.source_url\) !~\s*'\/\(article\|articles\|blog\|content\|insight\|insights\|news\|resource\|resources\)/i,
  );

  const ordering = sql.slice(sql.lastIndexOf("order by"));
  const productPriority = ordering.indexOf("p_is_product_question");
  const locationPriority = ordering.indexOf("p_is_offering_location_question");
  const lexicalPriority = ordering.indexOf("lexical_score desc");
  assert.ok(productPriority >= 0, "product intent priority must be present");
  assert.ok(locationPriority > productPriority, "location priority must follow product priority");
  assert.ok(lexicalPriority > locationPriority, "lexical relevance must follow intent priorities");
});

test("070 returns no lexical Wiki chunks for blank or zero-signal queries", async () => {
  const sql = await readFile(
    "db/migrations/070_remove_embedding_runtime.sql",
    "utf8",
  );

  assert.match(
    sql,
    /query_input as \([\s\S]*where regexp_replace\(coalesce\(p_query, ''\), '\[\[:space:\]\]\+', '', 'g'\) <> ''[\s\S]*\), query_tokens as/i,
  );
  assert.match(
    sql,
    /from ranked\s+where lexical_score > 0\s+order by/i,
  );
});

test("070 makes enabled chunks sufficient for compiled Wiki activation and resumes validation", async () => {
  const sql = await readFile(
    "db/migrations/070_remove_embedding_runtime.sql",
    "utf8",
  );
  const activation = sql.slice(
    sql.indexOf("create or replace function activate_compiled_wiki_version"),
  );

  assert.match(
    sql,
    /set build_stage = 'validating'[\s\S]*status = 'building'[\s\S]*build_stage = 'embedding'/i,
  );
  assert.match(activation, /chunk\.enabled/i);
  assert.doesNotMatch(activation, /chunk\.embedding/i);
});

test("070 preserves exact FAQ and vector rollback surfaces", async () => {
  const sql = await readFile(
    "db/migrations/070_remove_embedding_runtime.sql",
    "utf8",
  );

  assert.doesNotMatch(sql, /create or replace function find_direct_faq_exact/i);
  assert.doesNotMatch(sql, /drop\s+function\s+(?:if exists\s+)?search_brand_compiled_wiki/i);
  assert.doesNotMatch(sql, /drop\s+(?:column\s+)?embedding/i);
  assert.doesNotMatch(sql, /update\s+wiki_page_chunks[\s\S]*embedding\s*=/i);
});

test("exact direct FAQ lookup returns one unique match or a knowledge conflict marker", async () => {
  const sql = await readFile("db/migrations/027_wiki_search_v2.sql", "utf8");
  const exactLookup = sql.slice(sql.indexOf("create or replace function find_direct_faq_exact"));

  assert.match(exactLookup, /entry\.entry_type = 'faq'/);
  assert.match(exactLookup, /entry\.enabled/);
  assert.match(exactLookup, /entry\.direct_reply_enabled/);
  assert.match(exactLookup, /entry\.normalized_question/);
  assert.match(exactLookup, /unnest\(entry\.keywords\)/);
  assert.match(exactLookup, /unnest\(entry\.aliases\)/);
  assert.match(exactLookup, /count\(\*\)/);
  assert.doesNotMatch(exactLookup, /min\(id\)/, "PostgreSQL does not provide min(uuid)");
  assert.match(exactLookup, /array_agg\(id order by id::text\)/);
  assert.match(exactLookup, /when match_count = 1 then/);
  assert.match(exactLookup, /when match_count > 1 then 'knowledge_conflict'/);
});

test("migration runner applies only migrations absent from history", () => {
  const plan = buildMigrationPlan(migrations, [{ id: "001_initial.sql", checksum: "first" }]);
  assert.deepEqual(plan.pending.map((migration) => migration.id), ["002_second.sql"]);
});

test("migration runner rejects history whose checksum differs from disk", () => {
  assert.throws(
    () => buildMigrationPlan(migrations, [{ id: "001_initial.sql", checksum: "changed" }]),
    /migration_checksum_mismatch:001_initial\.sql/,
  );
});

test("migration runner rejects an applied migration with an empty checksum", () => {
  assert.throws(
    () => buildMigrationPlan(migrations, [{ id: "001_initial.sql", checksum: "" }]),
    /migration_checksum_mismatch:001_initial\.sql/,
  );
});

test("migration runner accepts the exact legacy 014 checksum without rewriting history", async () => {
  const instagramDeliveryMigrations = await loadInstagramDeliveryMigrations();
  const applied = [
    {
      id: "014_instagram_delivery_formats.sql",
      checksum: legacyInstagramDeliveryChecksum,
    },
  ];

  const plan = buildMigrationPlan(instagramDeliveryMigrations, applied);

  assert.deepEqual(plan.pending.map((migration) => migration.id), [
    "015_delivery_format_legacy_channels.sql",
  ]);
  assert.equal(applied[0].checksum, legacyInstagramDeliveryChecksum);
});

test("migration runner rejects an unknown checksum mismatch for 014", async () => {
  const instagramDeliveryMigrations = await loadInstagramDeliveryMigrations();
  assert.throws(
    () =>
      buildMigrationPlan(instagramDeliveryMigrations, [
        {
          id: "014_instagram_delivery_formats.sql",
          checksum: "unknown-014-checksum",
        },
      ]),
    /migration_checksum_mismatch:014_instagram_delivery_formats\.sql/,
  );
});

test("migration runner accepts the exact current checksum for 014", async () => {
  const instagramDeliveryMigrations = await loadInstagramDeliveryMigrations();
  const plan = buildMigrationPlan(instagramDeliveryMigrations, [
    {
      id: "014_instagram_delivery_formats.sql",
      checksum: instagramDeliveryMigrations[0].checksum,
    },
  ]);

  assert.deepEqual(plan.pending.map((migration) => migration.id), [
    "015_delivery_format_legacy_channels.sql",
  ]);
});

test("legacy 014 compatibility does not permit a different current file checksum", async () => {
  const instagramDeliveryMigrations = await loadInstagramDeliveryMigrations();
  assert.throws(
    () =>
      buildMigrationPlan(
        [
          {
            ...instagramDeliveryMigrations[0],
            checksum: "unexpected-new-014-checksum",
          },
          instagramDeliveryMigrations[1],
        ],
        [
          {
            id: "014_instagram_delivery_formats.sql",
            checksum: legacyInstagramDeliveryChecksum,
          },
        ],
      ),
    /migration_checksum_mismatch:014_instagram_delivery_formats\.sql/,
  );
});

test("unwrapFileTransaction removes only the outer BEGIN and COMMIT lines", () => {
  const sql = [
    "-- migration header",
    "",
    "  BEGIN;  ",
    "select migration_body;",
    "-- migration body comment",
    " COMMIT;",
    "-- migration footer",
  ].join("\n");

  const unwrapped = migrationRunner.unwrapFileTransaction(sql);

  assert.match(unwrapped, /^-- migration header/);
  assert.match(unwrapped, /select migration_body;/);
  assert.match(unwrapped, /-- migration body comment/);
  assert.match(unwrapped, /-- migration footer$/);
  assert.doesNotMatch(unwrapped, /^\s*(?:begin|commit)\s*;\s*$/im);
});

test("unwrapFileTransaction rejects nested and unwrapped transaction control", () => {
  for (const sql of [
    "BEGIN;\nselect 1;\nCOMMIT;\nROLLBACK;\nCOMMIT;",
    "select 1;\nROLLBACK;",
    "select 1;\nCOMMIT; -- transaction control remains forbidden",
  ]) {
    assert.throws(
      () => migrationRunner.unwrapFileTransaction(sql),
      (error) => error.code === "migration_nested_transaction_control",
    );
  }
});

test("unwrapFileTransaction rejects top-level COMMIT after another statement on the same line", () => {
  assert.throws(
    () => migrationRunner.unwrapFileTransaction(
      "BEGIN;\nselect 1; COMMIT;\nCOMMIT;",
    ),
    (error) => error.code === "migration_nested_transaction_control",
  );
});

test("unwrapFileTransaction rejects top-level COMMIT after a block comment", () => {
  assert.throws(
    () => migrationRunner.unwrapFileTransaction(
      "BEGIN;\n/* transaction guard */ COMMIT;\nCOMMIT;",
    ),
    (error) => error.code === "migration_nested_transaction_control",
  );
});

test("unwrapFileTransaction ignores transaction words inside quoted values, identifiers, comments, and dollar quotes", () => {
  const sql = [
    "select 'BEGIN; COMMIT; ROLLBACK;', \"COMMIT;\";",
    "-- ROLLBACK;",
    "/* BEGIN; COMMIT; */",
    "do $migration_body$",
    "begin",
    "  perform 'ROLLBACK;';",
    "end;",
    "$migration_body$;",
  ].join("\n");

  assert.equal(migrationRunner.unwrapFileTransaction(sql), sql);
});

test("unwrapFileTransaction rejects PostgreSQL transaction-control variants", () => {
  for (const statement of [
    "START TRANSACTION;",
    "PREPARE TRANSACTION 'migration';",
    "COMMIT AND CHAIN;",
    "END;",
    "ABORT;",
  ]) {
    assert.throws(
      () => migrationRunner.unwrapFileTransaction(`select 1;\n${statement}`),
      (error) => error.code === "migration_nested_transaction_control",
      statement,
    );
  }
});

test("unwrapFileTransaction treats backslashes as ordinary characters in standard strings", () => {
  for (const sql of [
    String.raw`select '\'; COMMIT;`,
    String.raw`select '\\'; COMMIT;`,
  ]) {
    assert.throws(
      () => migrationRunner.unwrapFileTransaction(sql),
      (error) => error.code === "migration_nested_transaction_control",
    );
  }
});

test("unwrapFileTransaction applies backslash escapes only to PostgreSQL E strings", () => {
  for (const prefix of ["E", "e"]) {
    const sql = String.raw`select ${prefix}'escaped quote: \'; COMMIT;';`;
    assert.equal(migrationRunner.unwrapFileTransaction(sql), sql);
  }
});

test("unwrapFileTransaction does not start a dollar quote inside an unquoted identifier", () => {
  assert.throws(
    () => migrationRunner.unwrapFileTransaction(
      "select foo$tag$; COMMIT;",
    ),
    (error) => error.code === "migration_nested_transaction_control",
  );
});

test("migration runner executes the unwrapped body, records history, then commits", async () => {
  const client = createRecordingClient();

  await migrationRunner.runMigrationsWithClient({
    client,
    migrations: [
      {
        id: "001_wrapped.sql",
        checksum: "checksum-of-raw-wrapped-sql",
        sql: "BEGIN;\nselect migration_body;\nCOMMIT;",
      },
    ],
  });

  const transactionCalls = client.calls.filter((call) =>
    ["begin", "select migration_body;", "commit"].includes(call.sql)
    || call.sql.startsWith("insert into schema_migrations"),
  );
  assert.deepEqual(transactionCalls, [
    { sql: "begin", parameters: [] },
    { sql: "select migration_body;", parameters: [] },
    {
      sql: "insert into schema_migrations (id, checksum) values ($1, $2)",
      parameters: ["001_wrapped.sql", "checksum-of-raw-wrapped-sql"],
    },
    { sql: "commit", parameters: [] },
  ]);
});

test("migration runner holds one advisory lock before history read and migration application", async () => {
  const client = createRecordingClient();

  await migrationRunner.runMigrationsWithClient({
    client,
    migrations: [
      {
        id: "001_lock_test.sql",
        checksum: "lock-test",
        sql: "select migration_body",
      },
    ],
  });

  const lockIndex = client.calls.findIndex((call) => call.sql.includes("pg_advisory_lock"));
  const historyIndex = client.calls.findIndex((call) =>
    call.sql.startsWith("select id, checksum from schema_migrations"),
  );
  const migrationIndex = client.calls.findIndex((call) => call.sql === "select migration_body");
  const unlockIndex = client.calls.findIndex((call) => call.sql.includes("pg_advisory_unlock"));

  assert.ok(lockIndex >= 0 && lockIndex < historyIndex);
  assert.ok(lockIndex < migrationIndex);
  assert.equal(unlockIndex, client.calls.length - 1);
  assert.deepEqual(client.calls[lockIndex].parameters, ["brand-pilot:schema-migrations:v1"]);
  assert.deepEqual(client.calls[unlockIndex].parameters, ["brand-pilot:schema-migrations:v1"]);
});

test("migration runner unlocks its advisory lock in finally when migration application fails", async () => {
  const client = createRecordingClient({ failMigration: true });

  await assert.rejects(
    () =>
      migrationRunner.runMigrationsWithClient({
        client,
        migrations: [
          {
            id: "001_lock_error.sql",
            checksum: "lock-error",
            sql: "select migration_body",
          },
        ],
      }),
    /migration_execution_failed/,
  );

  const rollbackIndex = client.calls.findIndex((call) => call.sql === "rollback");
  const unlockIndex = client.calls.findIndex((call) => call.sql.includes("pg_advisory_unlock"));
  assert.ok(rollbackIndex >= 0 && rollbackIndex < unlockIndex);
  assert.equal(unlockIndex, client.calls.length - 1);
});

test("support request repair migration restores the table when migration history is stale", async () => {
  const sql = await readFile("db/migrations/040_restore_support_requests.sql", "utf8");

  assert.match(sql, /^begin;/);
  assert.match(sql, /create table if not exists support_requests/);
  assert.match(sql, /support_requests_brand_created_idx/);
  assert.match(sql, /support_requests_set_updated_at/);
  assert.match(sql, /commit;\s*$/);
  assert.doesNotMatch(sql, /drop table/);
});

test("subject analysis migration defines cached analyses, archived images, and generation snapshots", async () => {
  const sql = await readFile(
    "db/migrations/047_ai_content_subject_analysis.sql",
    "utf8",
  );

  assert.match(sql, /^begin;/);
  assert.match(sql, /create table if not exists ai_content_subject_analyses/i);
  assert.match(sql, /create table if not exists ai_content_subject_images/i);
  assert.match(sql, /subject_type in \('product', 'service'\)/i);
  assert.match(
    sql,
    /status in \([\s\S]*'queued'[\s\S]*'extracting'[\s\S]*'researching'[\s\S]*'ready'[\s\S]*'partial'[\s\S]*'failed'[\s\S]*\)/i,
  );
  assert.match(sql, /where superseded_at is null/i);
  assert.match(sql, /lease_expires_at/i);
  assert.match(
    sql,
    /ai_content_subject_claim_idx[\s\S]*where status in \('queued', 'extracting', 'researching'\)/i,
  );
  assert.match(sql, /ai_content_subject_selected_image_fk/i);
  assert.match(sql, /subject_analysis_snapshot/i);
  assert.doesNotMatch(sql, /is_selected/i);
  assert.match(sql, /ai_content_subject_analyses_workspace_idx/i);
  assert.match(sql, /ai_content_subject_images_workspace_idx/i);
  assert.match(sql, /ai_content_subject_images_brand_workspace_idx/i);
  assert.match(sql, /ai_content_subject_images_analysis_ownership_idx/i);
  assert.match(
    sql,
    /drop constraint if exists ai_content_subject_selected_image_fk/i,
  );
  assert.match(
    sql,
    /drop constraint if exists ai_content_generations_subject_analysis_snapshot_object_check/i,
  );
  assert.match(
    sql,
    /drop trigger if exists ai_content_subject_analyses_set_updated_at/i,
  );
  assert.match(sql, /commit;\s*$/);
});

test("an installation applied through 064 has every later migration pending", async () => {
  const loaded = await migrationRunner.loadMigrations();
  const applied = loaded
    .filter((migration) => migration.id <= "064_reference_upload_finalization.sql")
    .map(({ id, checksum }) => ({ id, checksum }));

  const plan = buildMigrationPlan(loaded, applied);

  assert.deepEqual(
    plan.pending.map((migration) => migration.id),
    [
      "065_ai_content_attachment_upload_sessions.sql",
      "066_ai_content_analyzed_subject_orchestration.sql",
      "067_wiki_refresh_outbox.sql",
      "068_brand_core_one_draft.sql",
      "069_brand_analysis_one_open_workflow.sql",
      "070_remove_embedding_runtime.sql",
      "071_brand_intelligence_onboarding_worker_v2.sql",
      "072_faq_suggestion_worker.sql",
      "073_ai_content_generation_v2_render_pipeline.sql",
    ],
  );
});
