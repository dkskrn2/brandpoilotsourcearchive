import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applicationRuntimeRelationSecurityCatalog } from "./ai-content-database-roles.mjs";
import { loadMigrations, validatePost075SchemaMigration } from "./migrationRunner.mjs";

const migrationPath = "db/migrations/082_manual_brand_visual_assets.sql";

async function migrationSql() {
  return readFile(migrationPath, "utf8").catch(() => "");
}

test("migration 082 defines tenant-owned named style presets and immutable manual selections", async () => {
  const sql = await migrationSql();
  assert.match(sql, /create table if not exists brand_style_presets/i);
  assert.match(sql, /create table if not exists brand_style_preset_references/i);
  assert.match(sql, /create table if not exists manual_ai_content_visual_selections/i);
  assert.match(sql, /alter table brand_avatars\s+add column if not exists revision integer not null default 1/i);
  assert.match(sql, /brand_style_presets_one_active_default/i);
  assert.match(sql, /revision integer not null[^;]*check\s*\(revision > 0\)/is);
  assert.match(sql, /visual_tokens_json jsonb not null[^;]*jsonb_typeof\(visual_tokens_json\) = 'object'/is);
  assert.match(sql, /style_preset_revision integer null/is);
  assert.match(sql, /avatar_revision integer null/is);
  assert.match(sql, /selection_sha256 text not null[^;]*\^\[0-9a-f\]\{64\}\$/is);
  assert.match(sql, /frozen_json jsonb null/i);
  assert.match(sql, /frozen_sha256 text null/i);
  assert.match(sql, /manual_visual_selection_frozen_pair_check/i);
  assert.match(sql, /references brand_style_presets\(id, workspace_id, brand_id\)/i);
  assert.match(sql, /references reference_items\(id, workspace_id, brand_id\)/i);
  assert.match(sql, /references ai_content_generations\(id, workspace_id, brand_id\)/i);
});

test("migration 082 extends product assets for verified new uploads without rewriting old rows", async () => {
  const sql = await migrationSql();
  assert.match(sql, /alter table product_service_assets[\s\S]*add column if not exists storage_artifact_id uuid null/i);
  assert.match(sql, /alter table product_service_assets[\s\S]*add column if not exists checksum text null/i);
  assert.match(sql, /alter table product_service_assets[\s\S]*add column if not exists created_by_user_id uuid null/i);
  assert.doesNotMatch(sql, /update\s+product_service_assets\s+set\s+(?:storage_artifact_id|checksum|created_by_user_id)/i);
  assert.match(
    sql,
    /grant update\s*\(role,\s*position\) on table public\.product_service_assets/i,
  );
  assert.doesNotMatch(
    sql,
    /grant select, insert, update, delete on table public\.product_service_assets/i,
  );
});

test("new manual visual relations are protected by application ACL declarations", () => {
  const relationNames = new Set(applicationRuntimeRelationSecurityCatalog.map((entry) => entry.relationName));
  for (const relation of [
    "brand_style_presets",
    "brand_style_preset_references",
    "manual_ai_content_visual_selections",
  ]) {
    assert.equal(relationNames.has(relation), true, `${relation} missing from application ACL catalog`);
  }
});

test("migration runner registers 082 after the sealed 081 migration", async () => {
  const migrations = await loadMigrations();
  const migration = migrations.at(-1);
  assert.equal(migration?.id, "082_manual_brand_visual_assets.sql");
  assert.equal(validatePost075SchemaMigration(migration), true);
});

test("post-075 schema runner applies pending 082 without replaying applied 077 through 081", async () => {
  const migrations = await loadMigrations();
  const migration082 = migrations.find(({ id }) => id === "082_manual_brand_visual_assets.sql");
  assert.ok(migration082);
  const history = migrations
    .filter(({ id }) => id !== migration082.id)
    .map(({ id, checksum }) => ({ id, checksum }));
  const calls = [];
  const client = {
    async query(sql) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      calls.push(normalized);
      if (normalized === "select id, checksum from public.schema_migrations order by id asc") return { rows: history };
      if (normalized.includes("post_075_schema_provider_session_v1")) {
        return { rows: [{
          session_user_name: "postgres",
          current_user_name: "postgres",
          event_trigger_name: "ai_content_ddl_guard_074",
          event_trigger_enabled: "O",
          event_trigger_owner: "postgres",
          schema_owner_role_name: "content_schema_owner",
          application_role_name: "content_app",
        }] };
      }
      if (normalized.includes("post_075_manual_visual_assets_catalog_v1")) {
        return { rows: [{
          guard_enabled: "O",
          preset_owner: "content_schema_owner",
          preset_reference_owner: "content_schema_owner",
          selection_owner: "content_schema_owner",
          app_preset_select: true,
          app_preset_insert: true,
          app_preset_update: true,
          app_preset_delete: true,
          app_reference_select: true,
          app_reference_insert: true,
          app_reference_update: true,
          app_reference_delete: true,
          app_selection_select: true,
          app_selection_insert: true,
          app_selection_update: true,
          app_product_asset_select: true,
          app_product_asset_insert: true,
          app_product_asset_delete: true,
          app_product_asset_role_update: true,
          app_product_asset_position_update: true,
          app_product_asset_storage_update: false,
          selection_fence_enabled: "A",
          selection_fence_owner: "content_schema_owner",
          public_preset_privilege: false,
          public_reference_privilege: false,
          public_selection_privilege: false,
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
          billing_plan_count: 1,
        }] };
      }
      if (normalized.includes("post_075_schema_migration_marker_v1")) {
        return { rows: [{ id: migration082.id, checksum: migration082.checksum }] };
      }
      return { rows: [] };
    },
  };

  const result = await (await import("./migrationRunner.mjs")).runPost075SchemaMigrationsWithClient({
    client,
    migrations,
    expectedProviderRoleName: "postgres",
  });
  assert.deepEqual(result.pending, [migration082.id]);
  assert.equal(calls.some((sql) => sql.includes("create table if not exists brand_style_presets")), true);
  assert.equal(calls.some((sql) => sql.includes("create table content_suggestion_batches")), false);
});
