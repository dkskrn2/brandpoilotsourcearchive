import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client } from "pg";
import * as migrationRunner from "./migrationRunner.mjs";

test("content suggestion 077, FAQ utterance 078, and publish calendar 079 are an ordered sealed post-cutover schema plan", async () => {
  const migrations = await migrationRunner.loadMigrations();
  const migration077 = migrations.find(({ id }) => id === "077_content_suggestion_batches.sql");
  const migration078 = migrations.find(({ id }) => id === "078_faq_utterance_matching.sql");
  const migration079 = migrations.find(({ id }) => id === "079_publish_calendar_runtime.sql");
  assert.ok(migration077);
  assert.ok(migration078);
  assert.ok(migration079);
  assert.equal(migrationRunner.validatePost075SchemaMigration(migration077), true);
  assert.equal(migrationRunner.validatePost075SchemaMigration(migration078), true);
  assert.equal(migrationRunner.validatePost075SchemaMigration(migration079), true);

  const history = migrations
    .filter(({ id }) => ![migration077.id, migration078.id, migration079.id].includes(id))
    .map(({ id, checksum }) => ({ id, checksum }));
  assert.equal(
    migrationRunner.isExactPost075SchemaMigrationPlan(migrations, history),
    true,
  );
  assert.equal(
    migrationRunner.isExactPost075SchemaMigrationPlan(
      migrations,
      [...history, { id: migration078.id, checksum: migration078.checksum }],
    ),
    false,
    "078 cannot be accepted as applied while its 077 ancestor is absent",
  );
  assert.equal(
    migrationRunner.isExactPost075SchemaMigrationPlan(
      migrations,
      [...history,
        { id: migration077.id, checksum: migration077.checksum },
        { id: migration079.id, checksum: migration079.checksum }],
    ),
    false,
    "079 cannot be accepted as applied while its 078 ancestor is absent",
  );
  assert.equal(
    migrationRunner.isExactPost075SchemaMigrationPlan(
      migrations,
      history.filter(({ id }) => id !== "076_manual_content_generation_brand_rules.sql"),
    ),
    false,
  );
  assert.equal(
    migrationRunner.isExactPost075DataMigrationPlan(
      migrations,
      migrations
        .filter(({ id }) => id !== "076_manual_content_generation_brand_rules.sql")
        .map(({ id, checksum }) => ({ id, checksum })),
    ),
    false,
  );
  assert.throws(
    () => migrationRunner.validatePost075SchemaMigration({
      ...migration077,
      checksum: "0".repeat(64),
    }),
    /post_075_schema_migration_invalid/,
  );
  assert.throws(
    () => migrationRunner.validatePost075SchemaMigration({
      ...migration078,
      sql: `${migration078.sql}\nselect 1;`,
    }),
    /post_075_schema_migration_invalid/,
  );
  assert.throws(
    () => migrationRunner.validatePost075SchemaMigration({
      ...migration079,
      checksum: "0".repeat(64),
    }),
    /post_075_schema_migration_invalid/,
  );
});

test("FAQ utterance schema seals new tables under the schema owner and grants only the application role", async () => {
  const sql = await readFile("db/migrations/078_faq_utterance_matching.sql", "utf8");
  for (const relation of ["faq_alias_suggestion_results", "dm_faq_confirmations"]) {
    assert.match(sql, new RegExp(`alter table public\\.${relation} owner to %I`, "i"));
  }
  assert.match(sql, /revoke all on table public\.faq_alias_suggestion_results, public\.dm_faq_confirmations from public/i);
  assert.match(sql, /grant select, insert, update, delete on table public\.faq_alias_suggestion_results to %I/i);
  assert.match(sql, /grant select, insert, update, delete on table public\.dm_faq_confirmations to %I/i);
});

test("publish calendar tenant guards are schema-owned and executable only by the application role", async () => {
  const sql = await readFile("db/migrations/079_publish_calendar_runtime.sql", "utf8");
  for (const functionName of [
    "enforce_publish_calendar_brand_scope",
    "enforce_publish_calendar_slot_scope",
  ]) {
    assert.match(sql, new RegExp(`alter function public\\.${functionName}\\(\\) owner to %I`, "i"));
    assert.match(sql, new RegExp(`revoke all on function public\\.${functionName}\\(\\) from public`, "i"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${functionName}\\(\\) to %I`, "i"));
  }
  assert.match(sql, /create trigger publish_calendar_slots_link_scope[\s\S]*execute function enforce_publish_calendar_slot_scope\(\)/i);
  assert.match(sql, /content_suggestions and its batch\/category ancestry have no workspace or brand/i);
});

test("content suggestion schema runner accepts the exact managed provider session and restores the DDL guard", async () => {
  const migrations = await migrationRunner.loadMigrations();
  const migration077 = migrations.find(({ id }) => id === "077_content_suggestion_batches.sql");
  const migration078 = migrations.find(({ id }) => id === "078_faq_utterance_matching.sql");
  const migration079 = migrations.find(({ id }) => id === "079_publish_calendar_runtime.sql");
  assert.ok(migration077);
  assert.ok(migration078);
  assert.ok(migration079);
  const history = migrations
    .filter(({ id }) => ![migration077.id, migration078.id, migration079.id].includes(id))
    .map(({ id, checksum }) => ({ id, checksum }));
  const calls = [];
  const client = {
    async query(sql, parameters = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      calls.push({ sql: normalized, parameters });
      if (normalized === "select id, checksum from public.schema_migrations order by id asc") {
        return { rows: history };
      }
      if (normalized.includes("post_075_schema_provider_session_v1")) {
        return { rows: [{
          session_user_name: "postgres",
          current_user_name: "postgres",
          is_superuser: false,
          event_trigger_name: "ai_content_ddl_guard_074",
          event_trigger_enabled: "O",
          event_trigger_owner: "postgres",
          schema_owner_role_name: "content_schema_owner",
          application_role_name: "content_app",
        }] };
      }
      if (normalized.includes("post_075_schema_catalog_v1")) {
        return { rows: [{
          guard_enabled: "O",
          batch_owner: "content_schema_owner",
          suggestion_owner: "content_schema_owner",
          app_batch_select: true,
          app_batch_insert: true,
          app_batch_update: true,
          app_batch_delete: true,
          app_suggestion_select: true,
          app_suggestion_insert: true,
          app_suggestion_update: true,
          app_suggestion_delete: true,
          public_batch_privilege: false,
          public_suggestion_privilege: false,
        }] };
      }
      if (normalized.includes("faq_utterance_schema_catalog_v1")) {
        return { rows: [{
          manual_aliases_valid: true,
          example_utterances_valid: true,
          suggestion_run_columns_valid: true,
          alias_result_table_valid: true,
          confirmation_table_valid: true,
          index_definition_count: 4,
          trigger_count: 1,
          reason_constraint_definition_count: 2,
          named_constraint_definition_count: 20,
          missing_named_constraints: [],
          faq_count_constraint_definition_count: 3,
          owner_count: 1,
          owned_relation_count: 2,
          public_privilege_count: 0,
          application_privilege_count: 8,
        }] };
      }
      if (normalized.includes("publish_calendar_schema_catalog_v1")) {
        return { rows: [{
          billing_plan_owner: "content_schema_owner",
          brand_subscription_owner: "content_schema_owner",
          calendar_settings_owner: "content_schema_owner",
          calendar_slot_owner: "content_schema_owner",
          app_billing_plan_select: true,
          app_billing_plan_insert: true,
          app_billing_plan_update: true,
          app_billing_plan_delete: false,
          app_brand_subscription_select: true,
          app_brand_subscription_insert: true,
          app_brand_subscription_update: true,
          app_brand_subscription_delete: false,
          app_calendar_settings_select: true,
          app_calendar_settings_insert: true,
          app_calendar_settings_update: true,
          app_calendar_settings_delete: false,
          app_calendar_slot_select: true,
          app_calendar_slot_insert: true,
          app_calendar_slot_update: true,
          app_calendar_slot_delete: false,
          public_billing_plan_privilege: false,
          public_brand_subscription_privilege: false,
          public_calendar_settings_privilege: false,
          public_calendar_slot_privilege: false,
          runtime_columns_valid: true,
          enabled_default_false: true,
          constraint_catalog_valid: true,
          index_catalog_valid: true,
          trigger_catalog_valid: true,
          write_fence_row_count: 4,
          function_owner_count: 2,
          application_function_execute_count: 2,
          public_function_execute_count: 0,
          billing_plan_count: 0,
        }] };
      }
      if (normalized.includes("post_075_schema_migration_marker_v1")) {
        const migration = [migration077, migration078, migration079].find(({ id }) => id === parameters[0]);
        return { rows: migration ? [{ id: migration.id, checksum: migration.checksum }] : [] };
      }
      return { rows: [] };
    },
  };

  const result = await migrationRunner.runPost075SchemaMigrationsWithClient({
    client,
    migrations,
    expectedProviderRoleName: "postgres",
  });

  assert.deepEqual(result.pending, [migration077.id, migration078.id, migration079.id]);
  assert.equal(calls.some(({ sql }) => sql === "alter event trigger ai_content_ddl_guard_074 disable"), true);
  assert.equal(calls.some(({ sql }) => sql === "alter event trigger ai_content_ddl_guard_074 enable"), true);
  const disableIndex = calls.findIndex(({ sql }) => sql === "alter event trigger ai_content_ddl_guard_074 disable");
  const grantIndex = calls.findIndex(({ sql }) => sql === "grant \"content_schema_owner\" to \"postgres\" with set true, inherit true, admin false");
  const searchPathIndex = calls.findIndex(({ sql }) => sql === "select set_config('search_path','public,pg_catalog,pg_temp',true)");
  const migrationIndex = calls.findIndex(({ sql }) => sql.includes("create table content_suggestion_batches"));
  const faqMigrationIndex = calls.findIndex(({ sql }) => sql.includes("create table faq_alias_suggestion_results"));
  const calendarMigrationIndex = calls.findIndex(({ sql }) => sql.includes("create table billing_plan_catalog"));
  const revokeIndex = calls.findIndex(({ sql }) => sql === "revoke \"content_schema_owner\" from \"postgres\" granted by \"postgres\"");
  const enableIndex = calls.findIndex(({ sql }) => sql === "alter event trigger ai_content_ddl_guard_074 enable");
  const commitIndex = calls.findIndex(({ sql }) => sql === "commit");
  assert.ok(disableIndex < grantIndex && grantIndex < searchPathIndex && searchPathIndex < migrationIndex
    && migrationIndex < faqMigrationIndex && faqMigrationIndex < calendarMigrationIndex
    && calendarMigrationIndex < revokeIndex
    && revokeIndex < enableIndex && enableIndex < commitIndex);
  const catalogSql = calls.find(({ sql }) => sql.includes("post_075_schema_catalog_v1"))?.sql ?? "";
  for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
    assert.match(
      catalogSql,
      new RegExp(`has_table_privilege\\(\\$1,'public\\.content_suggestion_batches','${privilege}'\\)`),
    );
    assert.match(
      catalogSql,
      new RegExp(`has_table_privilege\\(\\$1,'public\\.content_suggestions','${privilege}'\\)`),
    );
  }
  const calendarCatalogSql = calls.find(({ sql }) => sql.includes("publish_calendar_schema_catalog_v1"))?.sql ?? "";
  for (const marker of [
    "publish_calendar_settings", "publish_calendar_slots", "enabled_default_false",
    "expected_constraint", "constraint_catalog_valid", "pg_get_constraintdef",
    "expected_index", "index_catalog_valid", "pg_get_indexdef",
    "expected_trigger", "trigger_catalog_valid", "pg_get_triggerdef",
    "write_fence_row_count", "function_owner_count", "public_function_execute_count",
    "billing_plan_count",
  ]) assert.match(calendarCatalogSql, new RegExp(marker));
  assert.doesNotMatch(calendarCatalogSql, /required_(?:constraint|index|trigger)_count/);
});

test("content suggestion schema runner rejects a non-normal DDL guard before mutation", async () => {
  const migrations = await migrationRunner.loadMigrations();
  const migration077 = migrations.find(({ id }) => id === "077_content_suggestion_batches.sql");
  const migration078 = migrations.find(({ id }) => id === "078_faq_utterance_matching.sql");
  const migration079 = migrations.find(({ id }) => id === "079_publish_calendar_runtime.sql");
  assert.ok(migration077);
  assert.ok(migration078);
  assert.ok(migration079);
  const history = migrations
    .filter(({ id }) => ![migration077.id, migration078.id, migration079.id].includes(id))
    .map(({ id, checksum }) => ({ id, checksum }));
  const calls = [];
  const client = {
    async query(sql) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      calls.push(normalized);
      if (normalized === "select id, checksum from public.schema_migrations order by id asc") {
        return { rows: history };
      }
      if (normalized.includes("post_075_schema_provider_session_v1")) {
        return { rows: [{
          session_user_name: "postgres",
          current_user_name: "postgres",
          is_superuser: true,
          event_trigger_name: "ai_content_ddl_guard_074",
          event_trigger_enabled: "A",
          event_trigger_owner: "postgres",
          schema_owner_role_name: "content_schema_owner",
          application_role_name: "content_app",
        }] };
      }
      return { rows: [] };
    },
  };

  await assert.rejects(
    migrationRunner.runPost075SchemaMigrationsWithClient({
      client,
      migrations,
      expectedProviderRoleName: "postgres",
    }),
    /post_075_schema_provider_session_invalid/,
  );
  assert.equal(calls.includes("begin"), false);
});

test("ordered 077, 078, and 079 schemas apply and replay against PostgreSQL 16", {
  skip: process.env.RUN_FAQ_SCHEMA_POSTGRES_INTEGRATION !== "1",
  timeout: 300_000,
}, async () => {
  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
  const container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
    .withUsername("postgres")
    .withPassword("postgres")
    .withDatabase("faq_schema_harness")
    .start();
  const client = new Client({ connectionString: container.getConnectionUri() });
  try {
    await client.connect();
    await client.query("create extension if not exists pgcrypto; create extension if not exists vector");
    const migrations = await migrationRunner.loadMigrations();
    const pre074 = migrations.filter(({ id }) => id < "073a_legacy_trigger_function_search_path.sql");
    await migrationRunner.runMigrationsWithClient({ client, migrations: pre074 });
    await client.query(`
      create role content_schema_owner nologin;
      create role content_application nologin;
      create table ai_content_bootstrap_state (
        singleton boolean primary key,
        schema_owner_role_name name not null,
        application_role_name name not null
      );
      insert into ai_content_bootstrap_state values (true,'content_schema_owner','content_application');
      create function faq_schema_harness_guard() returns event_trigger language plpgsql as $$ begin end $$;
      create event trigger ai_content_ddl_guard_074 on ddl_command_end execute function faq_schema_harness_guard();
    `);
    // Production retains the provider owner on pre-existing relations. Migration 078
    // changes ownership only for its two newly created relations.
    for (const id of [
      "073a_legacy_trigger_function_search_path.sql",
      "074_ai_content_maintenance_write_fence.sql",
      "075_ai_content_three_format_cutover.sql",
      "076_manual_content_generation_brand_rules.sql",
    ]) {
      const migration = migrations.find((row) => row.id === id);
      assert.ok(migration);
      await client.query("insert into schema_migrations(id,checksum) values($1,$2)", [migration.id, migration.checksum]);
    }

    const applied = await migrationRunner.runPost075SchemaMigrationsWithClient({
      client,
      migrations,
      expectedProviderRoleName: "postgres",
    });
    assert.deepEqual(applied.pending, [
      "077_content_suggestion_batches.sql",
      "078_faq_utterance_matching.sql",
      "079_publish_calendar_runtime.sql",
    ]);
    const topicScope = await client.query(
      `select relation.relname as relation_name,constraint_row.conname,
              pg_get_constraintdef(constraint_row.oid,true) as definition
         from pg_constraint constraint_row
         join pg_class relation on relation.oid=constraint_row.conrelid
        where constraint_row.conname in (
          'topic_publish_groups_tenant_identity_unique',
          'publish_calendar_slots_topic_publish_group_scope_fk'
        ) order by constraint_row.conname`,
    );
    assert.deepEqual(topicScope.rows.map(({ relation_name, conname }) => ({ relation_name, conname })), [
      {
        relation_name: "publish_calendar_slots",
        conname: "publish_calendar_slots_topic_publish_group_scope_fk",
      },
      {
        relation_name: "topic_publish_groups",
        conname: "topic_publish_groups_tenant_identity_unique",
      },
    ]);
    assert.match(topicScope.rows[0].definition, /foreign key \(topic_publish_group_id, workspace_id, brand_id\).*references topic_publish_groups\(id, workspace_id, brand_id\)/i);
    assert.match(topicScope.rows[1].definition, /unique \(id, workspace_id, brand_id\)/i);
    const replayed = await migrationRunner.runPost075SchemaMigrationsWithClient({
      client,
      migrations,
      expectedProviderRoleName: "postgres",
    });
    assert.deepEqual(replayed.pending, []);
    assert.equal(replayed.post075SchemaMigration.status, "already_applied");
  } finally {
    await client.end().catch(() => undefined);
    await container.stop();
  }
});
