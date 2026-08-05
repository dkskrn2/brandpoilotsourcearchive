import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { Client } from "pg";
import {
  bootstrapFenceRelations,
  loadMigrations,
  providerEnforcementBundle,
  readCanonicalEventTriggerCatalog,
  readFenceSecurityCatalog,
  required074DdlGuardTags,
} from "./migrationRunner.mjs";

const connectionString = process.env.AI_CONTENT_074_REAL_POSTGRES_URL;
const enabled = typeof connectionString === "string" && connectionString.length > 0;
const maxOverheadRatio = Number(process.env.AI_CONTENT_074_BULK_DML_MAX_OVERHEAD_RATIO ?? "8");
const names = {
  schemaOwnerRoleName: "content_schema_owner",
  applicationRoleName: "content_application",
  operatorRoleName: "content_operator",
  migrationRoleName: "content_migration",
  cleanupRoleName: "content_cleanup",
};

const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
const triggerName = (relation) => `ai_content_fence_${relation.slice(0, 30)}_${createHash("md5").update(relation).digest("hex").slice(0, 12)}`;

async function asMigrationSchemaOwner(client, statement) {
  await client.query("set session authorization content_migration");
  try {
    await client.query("set role content_schema_owner");
    await client.query("begin");
    let rejection;
    try {
      await client.query(statement);
    } catch (error) {
      rejection = error;
    }
    await client.query("rollback");
    assert.ok(rejection, `expected provider-owned 074 guard rejection: ${statement}`);
  } finally {
    await client.query("reset session authorization");
  }
}

async function transferProviderBundle(client) {
  for (const identity of providerEnforcementBundle.functions) {
    await client.query(`alter function ${identity} owner to postgres`);
    await client.query(`revoke all on function ${identity} from public,content_schema_owner,content_application,content_operator,content_migration,content_cleanup`);
    const grantee = identity.includes("assert_ai_content_writable") ? "content_application"
      : /prepare_ai_content_cutover|set_ai_content_maintenance|transition_ai_content_cutover_status/.test(identity) ? "content_operator"
        : /ai_content_cutover_bypass_allowed|verify_ai_content_write_fence_catalog|consume_ai_content_provider_attestation/.test(identity) ? "content_migration"
          : null;
    if (grantee) await client.query(`grant execute on function ${identity} to ${quoteIdentifier(grantee)}`);
  }
  for (const relation of providerEnforcementBundle.controlRelations) {
    await client.query(`alter table public.${quoteIdentifier(relation)} owner to postgres`);
    await client.query(`revoke all on table public.${quoteIdentifier(relation)} from public,content_schema_owner,content_application,content_operator,content_migration,content_cleanup`);
    if (relation === "ai_content_maintenance_state") {
      await client.query("grant select on table public.ai_content_maintenance_state to content_application");
    } else if (relation === "ai_content_bootstrap_state" || relation === "ai_content_write_fence_catalog") {
      await client.query(`grant select on table public.${quoteIdentifier(relation)} to content_migration`);
    }
  }
}

test("074 real PostgreSQL provider-owned bundle blocks migration-to-schema-owner exploits and meets bulk threshold", {
  skip: enabled ? false : "AI_CONTENT_074_REAL_POSTGRES_URL is not configured; real PostgreSQL evidence not claimed",
  timeout: 10 * 60_000,
}, async () => {
  assert.ok(Number.isFinite(maxOverheadRatio) && maxOverheadRatio >= 1 && maxOverheadRatio <= 100,
    "AI_CONTENT_074_BULK_DML_MAX_OVERHEAD_RATIO must be a reviewed ratio between 1 and 100");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const identity = await client.query("select current_user,current_database() as database_name,version() as version");
    assert.equal(identity.rows[0].current_user, "postgres", "provider fixture must authenticate as platform postgres");
    assert.match(identity.rows[0].version, /PostgreSQL 1[6-9]/);
    assert.match(identity.rows[0].database_name, /(?:074|harness|test)/i, "refusing a database not explicitly named as a test harness");
    const existing = await client.query("select count(*)::integer as count from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'");
    assert.equal(existing.rows[0].count, 0, "real PostgreSQL harness requires an empty disposable database");

    const migrations = await loadMigrations();
    const migration074 = migrations.find(({ id }) => id === "074_ai_content_maintenance_write_fence.sql");
    assert.ok(migration074);
    for (const migration of migrations.filter(({ id }) => id < migration074.id)) await client.query(migration.sql);
    await client.query(`create table if not exists schema_migrations(
      id text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`);
    await client.query(`
      create role content_schema_owner nologin;
      create role content_application login;
      create role content_operator login;
      create role content_migration login noinherit;
      create role content_cleanup login;
      grant content_schema_owner to content_migration;
      grant usage,create on schema public to content_schema_owner;
    `);
    for (const relation of bootstrapFenceRelations) await client.query(`alter table public.${quoteIdentifier(relation)} owner to content_schema_owner`);
    await client.query(`set role content_schema_owner; ${migration074.sql} reset role;`);
    await client.query(`
      revoke all on table ai_content_cutovers,ai_content_cutover_status_events,ai_content_maintenance_state,ai_content_bootstrap_state,ai_content_ddl_allowlist,ai_content_write_fence_catalog from content_application;
      grant select on table ai_content_maintenance_state to content_application;
      grant execute on function assert_ai_content_writable() to content_application;
      grant execute on function prepare_ai_content_cutover(uuid,name,name,name,name,name,text,text,text,text,timestamptz,text,text,text,text,text),set_ai_content_maintenance(uuid,boolean),transition_ai_content_cutover_status(uuid,text,text,text,text,uuid,timestamptz,text) to content_operator;
      grant select on table ai_content_bootstrap_state,ai_content_write_fence_catalog to content_migration;
      grant execute on function ai_content_cutover_bypass_allowed(),verify_ai_content_write_fence_catalog(),consume_ai_content_provider_attestation() to content_migration;
    `);
    const interim = await readFenceSecurityCatalog(client, names);
    assert.equal(interim.ordinaryTriggers.length, 43);

    await transferProviderBundle(client);
    await client.query(`insert into ai_content_bootstrap_state(
      singleton,authorization_request_id,authorization_sha256,migration_role_name,schema_owner_role_name,
      application_role_name,operator_role_name,cleanup_role_name,migration_sha256,role_catalog_sha256,
      object_catalog_sha256,fence_security_catalog_sha256,event_trigger_catalog_before_json,
      event_trigger_catalog_before_sha256,event_trigger_catalog_before_count,install_request_json,install_request_sha256
    ) values(true,'harness',$1,'content_migration','content_schema_owner','content_application','content_operator',
      'content_cleanup',$1,$1,$1,$2,'{"contractVersion":"ai-content-event-trigger-catalog.v1","eventTriggers":[]}',
      $1,0,'{}',$1)`, ["a".repeat(64), interim.catalogSha256]);
    const tagSql = required074DdlGuardTags.map((tag) => `'${tag}'`).join(",");
    await client.query(`create event trigger ai_content_ddl_guard_074 on ddl_command_end when tag in (${tagSql}) execute function public.enforce_ai_content_ddl_allowlist()`);
    await client.query("alter event trigger ai_content_ddl_guard_074 enable always");
    const finalCatalog = await readFenceSecurityCatalog(client, names, { ownerRoleName: "postgres" });
    assert.deepEqual(finalCatalog.functions.map((row) => row.definition_sha256), interim.functions.map((row) => row.definition_sha256));
    const eventCatalog = await readCanonicalEventTriggerCatalog(client);
    assert.equal(eventCatalog.count, 1);
    assert.equal(eventCatalog.rows[0].event_trigger_owner, "postgres");

    const protectedStateBefore = await client.query(`select
      (select count(*) from ai_content_ddl_allowlist)::integer as allowlist_count,
      (select count(*) from ai_content_bootstrap_state)::integer as bootstrap_count,
      (select count(*) from ai_content_maintenance_state)::integer as maintenance_count,
      (select count(*) from ai_content_cutovers)::integer as cutover_count`);
    const exploitStatements = [
      "create or replace function public.assert_ai_content_writable() returns void language sql as 'select'",
      "create or replace function public.enforce_ai_content_ddl_allowlist() returns event_trigger language plpgsql as 'begin null; end'",
      "create or replace function public.enforce_ai_content_write_fence() returns trigger language plpgsql as 'begin return new; end'",
      "create or replace function public.verify_ai_content_write_fence_catalog() returns boolean language sql as 'select true'",
      "delete from public.ai_content_ddl_allowlist",
      "delete from public.ai_content_bootstrap_state",
      "update public.ai_content_maintenance_state set enabled=false",
      "delete from public.ai_content_cutovers",
      `alter table public.ai_content_generations disable trigger ${quoteIdentifier(triggerName("ai_content_generations"))}`,
      `drop trigger ${quoteIdentifier(triggerName("ai_content_generations"))} on public.ai_content_generations`,
      "create table public.ai_content_074_arbitrary_ddl(id integer)",
    ];
    for (const statement of exploitStatements) await asMigrationSchemaOwner(client, statement);
    const protectedStateAfter = await client.query(`select
      (select count(*) from ai_content_ddl_allowlist)::integer as allowlist_count,
      (select count(*) from ai_content_bootstrap_state)::integer as bootstrap_count,
      (select count(*) from ai_content_maintenance_state)::integer as maintenance_count,
      (select count(*) from ai_content_cutovers)::integer as cutover_count`);
    assert.deepEqual(protectedStateAfter.rows, protectedStateBefore.rows);
    assert.equal((await readFenceSecurityCatalog(client, names, { ownerRoleName: "postgres" })).catalogSha256, finalCatalog.catalogSha256);

    const workspace = (await client.query("insert into workspaces(name,slug) values('074 Harness',$1) returning id", [`harness-${randomUUID()}`])).rows[0];
    const brand = (await client.query("insert into brands(workspace_id,name) values($1,'074 Harness') returning id", [workspace.id])).rows[0];
    await client.query(`insert into automation_runs(workspace_id,brand_id,run_type,run_key,scheduled_date)
      select $1,$2,'daily_generation','074-bulk-' || item::text,current_date from generate_series(1,2000) item`, [workspace.id, brand.id]);
    const runBulkUpdate = async () => {
      const started = performance.now();
      await client.query("update automation_runs set result_json=result_json where run_key like '074-bulk-%'");
      return performance.now() - started;
    };
    const maintenanceOffMs = await runBulkUpdate();
    const cutoverId = randomUUID();
    const token = `074-token-${randomUUID()}`;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await client.query(`insert into ai_content_cutovers(
      id,status,migration_id,schema_owner_role_name,application_role_name,operator_role_name,migration_role_name,
      cleanup_role_name,bypass_token_sha256,cleanup_token_sha256,database_role_catalog_sha256,provider_backup_id,
      provider_snapshot_created_at,incident_bundle_sha256,preserved_data_manifest_sha256,
      proposal_preflight_transfer_sha256,intended_release_sha,latest_status_event_sha256
    ) values($1,'maintenance_verified','075_ai_content_three_format_cutover.sql','content_schema_owner','content_application',
      'content_operator','content_migration','content_cleanup',$2,$2,$3,'harness',now(),$3,$3,$3,$4,$3)`,
    [cutoverId, tokenHash, "b".repeat(64), "c".repeat(40)]);
    await client.query("update ai_content_maintenance_state set enabled=true,cutover_id=$1,enabled_at=now() where singleton", [cutoverId]);
    await client.query("set session authorization content_migration");
    let maintenanceOnMs;
    try {
      await client.query("set role content_schema_owner");
      await client.query("select set_config('app.ai_content_cutover_id',$1,false),set_config('app.ai_content_cutover_token',$2,false)", [cutoverId, token]);
      maintenanceOnMs = await runBulkUpdate();
    } finally {
      await client.query("reset session authorization");
    }
    const overheadRatio = maintenanceOnMs / Math.max(maintenanceOffMs, 0.001);
    assert.ok(overheadRatio <= maxOverheadRatio,
      `43-trigger maintenance bulk overhead ${overheadRatio.toFixed(3)} exceeds ${maxOverheadRatio}`);
  } finally {
    await client.end();
  }
});
