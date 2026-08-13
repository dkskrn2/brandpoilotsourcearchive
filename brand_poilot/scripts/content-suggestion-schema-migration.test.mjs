import assert from "node:assert/strict";
import test from "node:test";
import * as migrationRunner from "./migrationRunner.mjs";

test("content suggestion schema is a sealed 077 post-cutover migration", async () => {
  const migrations = await migrationRunner.loadMigrations();
  const migration077 = migrations.find(({ id }) => id === "077_content_suggestion_batches.sql");
  assert.ok(migration077);
  assert.equal(migrationRunner.validatePost075SchemaMigration(migration077), true);

  const history = migrations
    .filter(({ id }) => id !== migration077.id)
    .map(({ id, checksum }) => ({ id, checksum }));
  assert.equal(
    migrationRunner.isExactPost075SchemaMigrationPlan(migrations, history),
    true,
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
});

test("content suggestion schema runner uses the exact provider session and restores the DDL guard", async () => {
  const migrations = await migrationRunner.loadMigrations();
  const migration077 = migrations.find(({ id }) => id === "077_content_suggestion_batches.sql");
  assert.ok(migration077);
  const history = migrations
    .filter(({ id }) => id !== migration077.id)
    .map(({ id, checksum }) => ({ id, checksum }));
  const calls = [];
  const client = {
    async query(sql, parameters = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      calls.push({ sql: normalized, parameters });
      if (normalized === "select id, checksum from schema_migrations order by id asc") {
        return { rows: history };
      }
      if (normalized.includes("post_075_schema_provider_session_v1")) {
        return { rows: [{
          session_user_name: "postgres",
          current_user_name: "postgres",
          is_superuser: true,
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
      if (normalized.includes("post_075_schema_migration_marker_v1")) {
        return { rows: [{ id: migration077.id, checksum: migration077.checksum }] };
      }
      return { rows: [] };
    },
  };

  const result = await migrationRunner.runPost075SchemaMigrationsWithClient({
    client,
    migrations,
    expectedProviderRoleName: "postgres",
  });

  assert.deepEqual(result.pending, [migration077.id]);
  assert.equal(calls.some(({ sql }) => sql === "alter event trigger ai_content_ddl_guard_074 disable"), true);
  assert.equal(calls.some(({ sql }) => sql === "alter event trigger ai_content_ddl_guard_074 enable"), true);
  const disableIndex = calls.findIndex(({ sql }) => sql === "alter event trigger ai_content_ddl_guard_074 disable");
  const migrationIndex = calls.findIndex(({ sql }) => sql.includes("create table content_suggestion_batches"));
  const enableIndex = calls.findIndex(({ sql }) => sql === "alter event trigger ai_content_ddl_guard_074 enable");
  const commitIndex = calls.findIndex(({ sql }) => sql === "commit");
  assert.ok(disableIndex < migrationIndex && migrationIndex < enableIndex && enableIndex < commitIndex);
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
});

test("content suggestion schema runner rejects a non-normal DDL guard before mutation", async () => {
  const migrations = await migrationRunner.loadMigrations();
  const migration077 = migrations.find(({ id }) => id === "077_content_suggestion_batches.sql");
  assert.ok(migration077);
  const history = migrations
    .filter(({ id }) => id !== migration077.id)
    .map(({ id, checksum }) => ({ id, checksum }));
  const calls = [];
  const client = {
    async query(sql) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      calls.push(normalized);
      if (normalized === "select id, checksum from schema_migrations order by id asc") {
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
