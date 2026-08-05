import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { Client } from "pg";
import {
  bootstrapFenceCatalog,
  bootstrapFenceRelations,
  loadMigrations,
  readCanonicalBootstrapCatalogs,
  providerEnforcementBundle,
  readCanonicalEventTriggerCatalog,
  readFenceSecurityCatalog,
  required074DdlGuardTags,
} from "./migrationRunner.mjs";

const connectionString = process.env.AI_CONTENT_074_REAL_POSTGRES_URL;
const enabled = typeof connectionString === "string" && connectionString.length > 0;
const maxOverheadRatio = Number(process.env.AI_CONTENT_074_BULK_DML_MAX_OVERHEAD_RATIO ?? "8");
const benchmarkRowCount = Number(process.env.AI_CONTENT_074_BENCHMARK_ROW_COUNT ?? "250");
const classifierNames = Object.freeze([
  "whole_relation", "legacy_automated_topic", "scheduled_proposal_refresh", "legacy_content_job",
  "ai_content_generated_artifact", "ai_content_scheduled_publish", "ai_content_publish_attempt",
  "daily_generation_automation",
]);
const classifierEnvSuffix = (classifier) => classifier.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_");
const perBranchThreshold = Object.freeze(Object.fromEntries(classifierNames.map((classifier) => [
  classifier,
  Number(process.env[`AI_CONTENT_074_${classifierEnvSuffix(classifier)}_MAX_OVERHEAD_RATIO`] ?? maxOverheadRatio),
])));
const names = {
  schemaOwnerRoleName: "content_schema_owner",
  applicationRoleName: "content_application",
  operatorRoleName: "content_operator",
  migrationRoleName: "content_migration",
  cleanupRoleName: "content_cleanup",
};

const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
const triggerName = (relation) => `ai_content_fence_${relation.slice(0, 30)}_${createHash("md5").update(relation).digest("hex").slice(0, 12)}`;

async function asRoleExpectRejection(client, sessionRole, effectiveRole, statement) {
  await client.query(`set session authorization ${quoteIdentifier(sessionRole)}`);
  try {
    await client.query("begin");
    await client.query(`set local role ${quoteIdentifier(effectiveRole)}`);
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

const asMigrationSchemaOwner = (client, statement) => asRoleExpectRejection(
  client, "content_migration", "content_schema_owner", statement,
);

async function runPositiveAllowlistedDdl(client, statement, { cutoverId, token }) {
  await client.query("set session authorization content_migration");
  try {
    await client.query("begin");
    await client.query("set local role content_schema_owner");
    await client.query(
      "select set_config('app.ai_content_cutover_id',$1,true),set_config('app.ai_content_cutover_token',$2,true),set_config('app.ai_content_migration_id','075_ai_content_three_format_cutover.sql',true)",
      [cutoverId, token],
    );
    await client.query(statement);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.query("reset session authorization");
  }
}

const median = (values) => [...values].sort((left, right) => left-right)[Math.floor(values.length/2)];

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
}, async (t) => {
  assert.ok(Number.isFinite(maxOverheadRatio) && maxOverheadRatio >= 1 && maxOverheadRatio <= 100,
    "AI_CONTENT_074_BULK_DML_MAX_OVERHEAD_RATIO must be a reviewed ratio between 1 and 100");
  assert.ok(Number.isInteger(benchmarkRowCount) && benchmarkRowCount >= 25 && benchmarkRowCount <= 10_000,
    "AI_CONTENT_074_BENCHMARK_ROW_COUNT must be an integer between 25 and 10000");
  for (const [classifier, threshold] of Object.entries(perBranchThreshold)) {
    assert.ok(Number.isFinite(threshold) && threshold >= 1 && threshold <= 100,
      `${classifier} threshold must be between 1 and 100`);
  }
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
      grant content_schema_owner to content_migration with set true, inherit false, admin false;
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

    const liveRoleCatalog = await readCanonicalBootstrapCatalogs(client, names);
    assert.deepEqual(liveRoleCatalog.membershipEdges, [{
      member_role_name: "content_migration", parent_role_name: "content_schema_owner",
      set_option: true, inherit_option: false, admin_option: false,
    }]);
    const expectedClassifierCounts = Object.fromEntries(classifierNames.map((classifier) => [
      classifier,
      bootstrapFenceCatalog.filter((row) => row.relation_class === "customer_execution" && row.row_classifier === classifier).length,
    ]));
    const liveClassifierCounts = await client.query(`select row_classifier,count(*)::integer as count
      from ai_content_write_fence_catalog where relation_class='customer_execution'
      group by row_classifier order by row_classifier`);
    assert.equal(Object.values(expectedClassifierCounts).reduce((total, count) => total+count, 0), 43);
    assert.deepEqual(Object.fromEntries(liveClassifierCounts.rows.map((row) => [row.row_classifier, row.count])), expectedClassifierCounts);

    const workspace = (await client.query("insert into workspaces(name,slug) values('074 Harness',$1) returning id", [`harness-${randomUUID()}`])).rows[0];
    const brand = (await client.query("insert into brands(workspace_id,name) values($1,'074 Harness') returning id", [workspace.id])).rows[0];
    const brandChannel = (await client.query("insert into brand_channels(workspace_id,brand_id,channel,status) values($1,$2,'instagram','connected') returning id", [workspace.id, brand.id])).rows[0];
    await client.query(`insert into content_topics(workspace_id,brand_id,title,angle)
      select $1,$2,'074-whole-'||item::text,'benchmark' from generate_series(1,$3::integer) item`, [workspace.id, brand.id, benchmarkRowCount]);
    const topicUpload = (await client.query("insert into topic_uploads(workspace_id,brand_id,file_name) values($1,$2,'074-benchmark.csv') returning id", [workspace.id, brand.id])).rows[0];
    await client.query(`insert into topic_rows(workspace_id,brand_id,topic_upload_id,row_number,status,topic_title,topic_angle,topic_key)
      select $1,$2,$3,item,'uploaded','074-topic-'||item::text,'benchmark','074-topic-'||item::text
      from generate_series(1,$4::integer) item`, [workspace.id, brand.id, topicUpload.id, benchmarkRowCount]);
    const sourceUrl = (await client.query(`insert into source_urls(workspace_id,brand_id,source_type,url,url_hash)
      values($1,$2,'reference','https://074-harness.invalid','074-harness') returning id`, [workspace.id, brand.id])).rows[0];
    await client.query(`insert into source_crawl_runs(workspace_id,brand_id,source_url_id,trigger,run_key)
      select $1,$2,$3,'scheduled','scheduled-proposal-refresh:074:'||item::text
      from generate_series(1,$4::integer) item`, [workspace.id, brand.id, sourceUrl.id, benchmarkRowCount]);
    await client.query(`insert into jobs(workspace_id,brand_id,job_type,payload_json)
      select $1,$2,'instagram_reel_render',jsonb_build_object('harnessItem',item)
      from generate_series(1,$3::integer) item`, [workspace.id, brand.id, benchmarkRowCount]);
    await client.query(`insert into storage_artifacts(workspace_id,brand_id,artifact_type,bucket,path)
      select $1,$2,'generated_manifest','074-harness','manifest-'||item::text||'.json'
      from generate_series(1,$3::integer) item`, [workspace.id, brand.id, benchmarkRowCount]);
    await client.query(`insert into automation_runs(workspace_id,brand_id,run_type,run_key,scheduled_date)
      select $1,$2,'daily_generation','074-daily-'||item::text,current_date
      from generate_series(1,$3::integer) item`, [workspace.id, brand.id, benchmarkRowCount]);
    await client.query(`insert into ai_content_generations(workspace_id,brand_id,type,title,status,analysis_idempotency_key)
      select $1,$2,'blog','074-publish-generation-'||item::text,'completed','074-publish-analysis-'||item::text
      from generate_series(1,$3::integer) item`, [workspace.id, brand.id, benchmarkRowCount]);
    await client.query(`insert into ai_content_generation_outputs(generation_id,workspace_id,brand_id,output_index,status)
      select id,workspace_id,brand_id,1,'completed' from ai_content_generations
      where brand_id=$1 and analysis_idempotency_key like '074-publish-analysis-%'`, [brand.id]);
    await client.query(`insert into content_topics(workspace_id,brand_id,title,angle)
      select $1,$2,'074-publish-topic-'||item::text,'benchmark' from generate_series(1,$3::integer) item`, [workspace.id, brand.id, benchmarkRowCount]);
    await client.query(`insert into master_drafts(workspace_id,brand_id,content_topic_id,prompt_version)
      select workspace_id,brand_id,id,'074-harness' from content_topics
      where brand_id=$1 and title like '074-publish-topic-%'`, [brand.id]);
    await client.query(`insert into topic_publish_groups(workspace_id,brand_id,content_topic_id)
      select workspace_id,brand_id,id from content_topics where brand_id=$1 and title like '074-publish-topic-%'`, [brand.id]);
    await client.query(`with drafts as (
        select draft.id as draft_id,draft.content_topic_id,row_number() over(order by draft.id) as item
          from master_drafts draft join content_topics topic on topic.id=draft.content_topic_id
         where topic.brand_id=$1 and topic.title like '074-publish-topic-%'
      ), outputs as (
        select output.id as output_id,row_number() over(order by output.id) as item
          from ai_content_generation_outputs output join ai_content_generations generation on generation.id=output.generation_id
         where generation.brand_id=$1 and generation.analysis_idempotency_key like '074-publish-analysis-%'
      )
      insert into channel_outputs(workspace_id,brand_id,content_topic_id,master_draft_id,channel,status,title,delivery_format,ai_content_generation_output_id)
      select $2,$1,drafts.content_topic_id,drafts.draft_id,'instagram','approved','074-publish-output-'||drafts.item::text,
             'instagram_feed_carousel',outputs.output_id from drafts join outputs using(item)`, [brand.id, workspace.id]);
    await client.query(`insert into publish_queue(workspace_id,brand_id,channel_output_id,topic_publish_group_id,brand_channel_id,channel,status,approval_type,idempotency_key)
      select output.workspace_id,output.brand_id,output.id,publish_group.id,$2,'instagram','queued','manual','074-publish-queue-'||output.id::text
        from channel_outputs output join topic_publish_groups publish_group on publish_group.content_topic_id=output.content_topic_id
       where output.brand_id=$1 and output.title like '074-publish-output-%'`, [brand.id, brandChannel.id]);
    await client.query(`insert into publish_attempts(workspace_id,brand_id,publish_queue_id,attempt_number,status)
      select workspace_id,brand_id,id,1,'running' from publish_queue where brand_id=$1 and idempotency_key like '074-publish-queue-%'`, [brand.id]);

    const benchmarkBranches = Object.freeze([
      { classifier: "whole_relation", query: "update content_topics set source_context=source_context where brand_id=$1 and title like '074-whole-%'" },
      { classifier: "legacy_automated_topic", query: "update topic_rows set notes=notes where brand_id=$1 and topic_key like '074-topic-%'" },
      { classifier: "scheduled_proposal_refresh", query: "update source_crawl_runs set metadata=metadata where brand_id=$1 and run_key like 'scheduled-proposal-refresh:074:%'" },
      { classifier: "legacy_content_job", query: "update jobs set payload_json=payload_json where brand_id=$1 and job_type='instagram_reel_render' and payload_json ? 'harnessItem'" },
      { classifier: "ai_content_generated_artifact", query: "update storage_artifacts set checksum=checksum where brand_id=$1 and artifact_type='generated_manifest' and bucket='074-harness'" },
      { classifier: "ai_content_scheduled_publish", query: "update publish_queue set last_error=last_error where brand_id=$1 and idempotency_key like '074-publish-queue-%'" },
      { classifier: "ai_content_publish_attempt", query: "update publish_attempts set response_metadata=response_metadata where brand_id=$1 and publish_queue_id in (select id from publish_queue where idempotency_key like '074-publish-queue-%')" },
      { classifier: "daily_generation_automation", query: "update automation_runs set result_json=result_json where brand_id=$1 and run_key like '074-daily-%'" },
    ]);
    const measureBranch = async ({ classifier, query }) => {
      const started = performance.now();
      const result = await client.query(query, [brand.id]);
      assert.equal(result.rowCount, benchmarkRowCount, `${classifier} benchmark fixture count drift`);
      return performance.now()-started;
    };
    const maintenanceOff = {};
    for (const branch of benchmarkBranches) {
      maintenanceOff[branch.classifier] = median([await measureBranch(branch), await measureBranch(branch), await measureBranch(branch)]);
    }
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
    await client.query(`insert into ai_content_ddl_allowlist(migration_id,command_tag,object_identity_pattern)
      values('075_ai_content_three_format_cutover.sql','CREATE TABLE','public.ai_content_075_allowlisted_probe')`);
    await runPositiveAllowlistedDdl(client, "create table public.ai_content_075_allowlisted_probe(id integer)", { cutoverId, token });
    assert.equal((await client.query("select to_regclass('public.ai_content_075_allowlisted_probe')::text as relation")).rows[0].relation, "ai_content_075_allowlisted_probe");
    await client.query("drop table public.ai_content_075_allowlisted_probe");

    await client.query("create role content_rogue login");
    await client.query("grant content_schema_owner to content_rogue with set true, inherit false, admin false");
    await assert.rejects(readCanonicalBootstrapCatalogs(client, names), /bootstrap_role_catalog_invalid/);
    await asRoleExpectRejection(client, "content_rogue", "content_schema_owner", "create table public.ai_content_074_rogue_ddl(id integer)");
    await client.query("revoke content_schema_owner from content_rogue");
    await client.query("drop role content_rogue");
    assert.equal((await readCanonicalBootstrapCatalogs(client, names)).roleCatalogSha256, liveRoleCatalog.roleCatalogSha256);

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

    const maintenanceOn = {};
    await client.query("set session authorization content_migration");
    try {
      await client.query("set role content_schema_owner");
      await client.query("select set_config('app.ai_content_cutover_id',$1,false),set_config('app.ai_content_cutover_token',$2,false)", [cutoverId, token]);
      for (const branch of benchmarkBranches) {
        maintenanceOn[branch.classifier] = median([await measureBranch(branch), await measureBranch(branch), await measureBranch(branch)]);
      }
    } finally {
      await client.query("reset session authorization");
    }
    const benchmarkEvidence = benchmarkBranches.map(({ classifier }) => ({
      classifier,
      rowCount: benchmarkRowCount,
      maintenanceOffMs: maintenanceOff[classifier],
      maintenanceOnMs: maintenanceOn[classifier],
      ratio: maintenanceOn[classifier]/Math.max(maintenanceOff[classifier], 0.001),
      threshold: perBranchThreshold[classifier],
    }));
    for (const evidence of benchmarkEvidence) {
      assert.ok(evidence.ratio <= evidence.threshold,
        `${evidence.classifier} overhead ${evidence.ratio.toFixed(3)} exceeds ${evidence.threshold}`);
    }
    const maxObservedRatio = Math.max(...benchmarkEvidence.map(({ ratio }) => ratio));
    assert.ok(maxObservedRatio <= maxOverheadRatio,
      `maximum classifier overhead ${maxObservedRatio.toFixed(3)} exceeds ${maxOverheadRatio}`);
    t.diagnostic(JSON.stringify({ perBranchThreshold, maxObservedRatio, benchmarkEvidence }));
  } finally {
    await client.end();
  }
});
