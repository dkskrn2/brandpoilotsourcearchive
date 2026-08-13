import assert from "node:assert/strict";
import { test } from "node:test";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

import { loadMigrations, runPost075DataMigrationsWithClient } from "./migrationRunner.mjs";

const { Client } = pg;
const enabled = process.env.RUN_POSTGRES_INTEGRATION === "true";

function roleConnectionString(container, roleName, password) {
  const value = new URL(container.getConnectionUri());
  value.username = roleName;
  value.password = password;
  return value.toString();
}

test("post-075 provider migration rejects lower roles and succeeds with provider ownership", {
  skip: !enabled,
  timeout: 180_000,
}, async () => {
  const container = await new PostgreSqlContainer("postgres:17-alpine").start();
  const provider = new Client({ connectionString: container.getConnectionUri() });
  let migrationClient;
  let schemaOwnerClient;
  try {
    await provider.connect();
    const migrations = await loadMigrations();
    const migration076 = migrations.find(({ id }) => id === "076_manual_content_generation_brand_rules.sql");
    await provider.query(`
      create table public.schema_migrations (
        id text primary key,
        checksum text not null
      );
      create table public.brand_profiles (
        workspace_id uuid not null,
        brand_id uuid not null,
        active_brand_core_id uuid,
        active_brand_rule_set_id uuid,
        forbidden_terms jsonb not null default '[]'::jsonb,
        default_cta text,
        auto_approval_enabled boolean not null default false
      );
      create table public.brand_rule_sets (
        id uuid primary key default gen_random_uuid(),
        workspace_id uuid not null,
        brand_id uuid not null,
        version integer not null,
        status text not null,
        rules_json jsonb not null,
        created_by text not null,
        approved_at timestamptz,
        created_at timestamptz not null,
        updated_at timestamptz not null
      );
      create table public.storage_artifacts (
        id uuid primary key default gen_random_uuid(),
        workspace_id uuid not null,
        brand_id uuid not null,
        deleted_at timestamptz,
        public_url text,
        path text,
        checksum text not null,
        mime_type text not null
      );
      create table public.reference_items (
        id uuid primary key default gen_random_uuid(),
        workspace_id uuid not null,
        brand_id uuid not null,
        storage_artifact_id uuid references public.storage_artifacts(id),
        kind text not null,
        archived_at timestamptz
      );
      create unique index brand_rule_sets_approved_once
        on public.brand_rule_sets(workspace_id,brand_id) where status='approved';
      create role content_schema_owner login password 'schema-owner-password';
      create role content_migration login password 'migration-password';
      grant usage on schema public to content_schema_owner,content_migration;
      grant select on public.schema_migrations to content_schema_owner,content_migration;
    `);
    for (const migration of migrations.filter(({ id }) => ![
      migration076.id,
      "077_content_suggestion_batches.sql",
      "078_faq_utterance_matching.sql",
    ].includes(id))) {
      await provider.query(
        "insert into public.schema_migrations(id,checksum) values($1,$2)",
        [migration.id, migration.checksum],
      );
    }

    migrationClient = new Client({
      connectionString: roleConnectionString(container, "content_migration", "migration-password"),
    });
    await migrationClient.connect();
    await assert.rejects(runPost075DataMigrationsWithClient({
      client: migrationClient,
      migrations,
      expectedProviderRoleName: "postgres",
    }), /post_075_provider_session_invalid/);

    schemaOwnerClient = new Client({
      connectionString: roleConnectionString(container, "content_schema_owner", "schema-owner-password"),
    });
    await schemaOwnerClient.connect();
    await assert.rejects(runPost075DataMigrationsWithClient({
      client: schemaOwnerClient,
      migrations,
      expectedProviderRoleName: "postgres",
    }), /post_075_provider_session_invalid/);

    const applied = await runPost075DataMigrationsWithClient({
      client: provider,
      migrations,
      expectedProviderRoleName: "postgres",
    });
    assert.deepEqual(applied.pending, [migration076.id]);
    const marker = await provider.query(
      "select checksum from public.schema_migrations where id=$1",
      [migration076.id],
    );
    assert.equal(marker.rows[0]?.checksum, migration076.checksum);
  } finally {
    await migrationClient?.end().catch(() => {});
    await schemaOwnerClient?.end().catch(() => {});
    await provider.end().catch(() => {});
    await container.stop();
  }
});
