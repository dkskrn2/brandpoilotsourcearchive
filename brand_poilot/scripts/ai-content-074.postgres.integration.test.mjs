import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { Client } from "pg";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import {
  bootstrapFenceCatalog,
  bootstrapFenceRelations,
  loadMigrations,
  readCanonicalBootstrapCatalogs,
  providerEnforcementBundle,
  readCanonicalEventTriggerCatalog,
  readFenceSecurityCatalog,
} from "./migrationRunner.mjs";
import { abortCutoverPreMarker } from "./ai-content-cutover-control.mjs";

const maxOverheadRatio = Number(process.env.AI_CONTENT_074_BULK_DML_MAX_OVERHEAD_RATIO ?? "8");
const benchmarkRowCount = Number(process.env.AI_CONTENT_074_BENCHMARK_ROW_COUNT ?? "250");
const preflightHashOnly = process.env.AI_CONTENT_074_PREFLIGHT_HASH_ONLY === "true";
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
const canonicalJson = (value) => JSON.stringify(Object.fromEntries(
  Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
));

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
      : /prepare_ai_content_cutover|read_ai_content_cutover_control_state|set_ai_content_maintenance/.test(identity) ? "content_operator"
        : /ai_content_cutover_bypass_allowed|lock_ai_content_cutover_transaction_state|verify_ai_content_cutover_preflight_identity|verify_ai_content_write_fence_catalog|consume_ai_content_provider_attestation|read_ai_content_cutover_migration_body_evidence|register_ai_content_075_fence_relations/.test(identity) ? "content_migration"
          : null;
    if (grantee) await client.query(`grant execute on function ${identity} to ${quoteIdentifier(grantee)}`);
    if (identity.includes("register_ai_content_075_fence_relations")) {
      await client.query(`grant execute on function ${identity} to content_schema_owner`);
    }
    if (identity.includes("transition_ai_content_cutover_status")) {
      await client.query(`grant execute on function ${identity} to content_operator,content_migration`);
    }
  }
  for (const relation of providerEnforcementBundle.controlRelations) {
    await client.query(`alter table public.${quoteIdentifier(relation)} owner to postgres`);
    await client.query(`revoke all on table public.${quoteIdentifier(relation)} from public,content_schema_owner,content_application,content_operator,content_migration,content_cleanup`);
    if (relation === "ai_content_cutovers") {
      await client.query("grant references on table public.ai_content_cutovers to content_schema_owner");
    } else if (relation === "ai_content_maintenance_state") {
      await client.query("grant select on table public.ai_content_maintenance_state to content_application");
    } else if (["ai_content_bootstrap_state", "ai_content_ddl_allowlist", "ai_content_write_fence_catalog"].includes(relation)) {
      await client.query(`grant select on table public.${quoteIdentifier(relation)} to content_migration`);
    }
    if (relation === "ai_content_bootstrap_state") {
      await client.query("grant select on table public.ai_content_bootstrap_state to content_schema_owner");
    }
  }
}

test("074 real PostgreSQL provider-owned bundle blocks migration-to-schema-owner exploits and measures bulk overhead", {
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
  let container;
  let client;
  try {
    container = await new PostgreSqlContainer("postgres:16-alpine")
      .withUsername("postgres")
      .withPassword("postgres")
      .withDatabase("ai_content_074_harness")
      .withEnvironment("POSTGRES_INITDB_ARGS", "--locale=C")
      .start();
    const extensionInstall = await container.exec([
      "sh", "-lc",
      "apk update >/dev/null && apk add --no-cache build-base postgresql16-dev clang21 llvm21 >/dev/null && wget -q -O /tmp/pgvector.tar.gz https://codeload.github.com/pgvector/pgvector/tar.gz/778dacf20c07caf904557a88705142631818d8cb && echo '4c33cf053329784ba6d992d05c9588b93789e907a7511f20ff5a5a5b8a0703c1  /tmp/pgvector.tar.gz' | sha256sum -c - >/dev/null && test \"$(tar -tzf /tmp/pgvector.tar.gz | head -n 1)\" = 'pgvector-778dacf20c07caf904557a88705142631818d8cb/' && tar -xzf /tmp/pgvector.tar.gz -C /tmp && make -C /tmp/pgvector-778dacf20c07caf904557a88705142631818d8cb OPTFLAGS='' >/dev/null && make -C /tmp/pgvector-778dacf20c07caf904557a88705142631818d8cb install >/dev/null",
    ]);
    assert.equal(extensionInstall.exitCode, 0, `pgvector install failed: ${extensionInstall.stderr}`);
    client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();
    const identity = await client.query("select current_user,current_database() as database_name,version() as version");
    assert.equal(identity.rows[0].current_user, "postgres", "provider fixture must authenticate as platform postgres");
    assert.match(identity.rows[0].version, /PostgreSQL 16\./);
    assert.match(identity.rows[0].database_name, /(?:074|harness|test)/i, "refusing a database not explicitly named as a test harness");
    const existing = await client.query("select count(*)::integer as count from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'");
    assert.equal(existing.rows[0].count, 0, "real PostgreSQL harness requires an empty disposable database");
    assert.equal((await client.query("select to_regclass('public.workspaces') as workspaces")).rows[0].workspaces, null);

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
      alter role content_schema_owner set search_path=public,pg_catalog,pg_temp;
      alter role content_application set search_path=pg_catalog,public,pg_temp;
      alter role content_operator set search_path=pg_catalog,public,pg_temp;
      alter role content_migration set search_path=public,pg_catalog,pg_temp;
      alter role content_cleanup set search_path=pg_catalog,public,pg_temp;
      grant content_schema_owner to content_migration with set true;
      grant content_schema_owner to content_migration with inherit false;
      grant content_schema_owner to content_migration with admin false;
      revoke all on schema public from public;
      grant usage,create on schema public to content_schema_owner;
      grant usage on schema public to content_application,content_operator,content_migration,content_cleanup;
    `);
    await client.query(`
      create table public.ai_content_074_grant_event_probe(id uuid primary key);
      create table public.ai_content_074_grant_event_capture(
        command_tag text not null,
        object_type text null,
        schema_name text null,
        object_identity text null,
        in_extension boolean not null,
        classid oid null,
        objid oid null,
        objsubid integer null
      );
      create function public.capture_ai_content_074_grant_event() returns event_trigger
      language plpgsql set search_path=pg_catalog,public as $$
      begin
        insert into public.ai_content_074_grant_event_capture
          (command_tag,object_type,schema_name,object_identity,in_extension,classid,objid,objsubid)
        select command_tag,object_type,schema_name,object_identity,in_extension,classid,objid,objsubid
          from pg_event_trigger_ddl_commands();
      end;
      $$;
      create event trigger ai_content_074_grant_event_capture
        on ddl_command_end when tag in ('GRANT')
        execute function public.capture_ai_content_074_grant_event();
      grant select,insert on table public.ai_content_074_grant_event_probe to content_operator;
      drop event trigger ai_content_074_grant_event_capture;
    `);
    assert.deepEqual((await client.query(`
      select command_tag,object_type,schema_name,object_identity,in_extension,
             classid::text,objid::text,objsubid
        from public.ai_content_074_grant_event_capture
    `)).rows, [{
      command_tag: "GRANT",
      object_type: "TABLE",
      schema_name: null,
      object_identity: null,
      in_extension: false,
      classid: null,
      objid: null,
      objsubid: null,
    }], "PostgreSQL 16 must report a combined table GRANT as exactly one NULL-identity event row");
    assert.deepEqual((await client.query(`
      select privilege_type
        from pg_class relation
        cross join lateral aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) acl
       where relation.oid='public.ai_content_074_grant_event_probe'::regclass
         and acl.grantee='content_operator'::regrole
       order by privilege_type
    `)).rows, [{ privilege_type: "INSERT" }, { privilege_type: "SELECT" }]);
    await client.query(`
      drop function public.capture_ai_content_074_grant_event();
      drop table public.ai_content_074_grant_event_capture,public.ai_content_074_grant_event_probe;
    `);
    for (const relation of bootstrapFenceRelations) await client.query(`alter table public.${quoteIdentifier(relation)} owner to content_schema_owner`);
    await client.query(`set role content_schema_owner; ${migration074.sql} reset role;`);
    await client.query(`
      revoke all on table ai_content_cutovers,ai_content_cutover_status_events,ai_content_maintenance_state,ai_content_bootstrap_state,ai_content_ddl_allowlist,ai_content_write_fence_catalog from content_application;
      grant select on table ai_content_maintenance_state to content_application;
      grant execute on function assert_ai_content_writable() to content_application;
      grant execute on function prepare_ai_content_cutover(uuid,name,name,name,name,name,text,text,text,text,timestamptz,text,text,jsonb,text,text,text,text),read_ai_content_cutover_control_state(uuid),set_ai_content_maintenance(uuid,boolean),transition_ai_content_cutover_status(uuid,text,text,text,text,uuid,timestamptz,text,text) to content_operator;
      grant select on table ai_content_bootstrap_state,ai_content_ddl_allowlist,ai_content_write_fence_catalog to content_migration;
      grant select on table ai_content_bootstrap_state to content_schema_owner;
      grant select,insert on table schema_migrations to content_migration;
      grant execute on function transition_ai_content_cutover_status(uuid,text,text,text,text,uuid,timestamptz,text,text),ai_content_cutover_bypass_allowed(),lock_ai_content_cutover_transaction_state(uuid),verify_ai_content_cutover_preflight_identity(uuid,jsonb,text,text),verify_ai_content_write_fence_catalog(),consume_ai_content_provider_attestation(),read_ai_content_cutover_migration_body_evidence(uuid),register_ai_content_075_fence_relations() to content_migration;
    `);
    const interim = await readFenceSecurityCatalog(client, names);
    assert.equal(interim.ordinaryTriggers.length, 44);

    await transferProviderBundle(client);
    for (const deniedRole of [
      "content_schema_owner", "content_application", "content_operator", "content_cleanup",
    ]) {
      await client.query(`set session authorization ${quoteIdentifier(deniedRole)}`);
      try {
        await assert.rejects(
          client.query("select * from read_ai_content_cutover_migration_body_evidence(gen_random_uuid())"),
          /permission denied for function read_ai_content_cutover_migration_body_evidence/,
        );
      } finally {
        await client.query("reset session authorization");
      }
    }
    await client.query(`insert into ai_content_bootstrap_state(
      singleton,authorization_request_id,authorization_sha256,migration_role_name,schema_owner_role_name,
      application_role_name,operator_role_name,cleanup_role_name,migration_sha256,role_catalog_sha256,
      object_catalog_sha256,fence_security_catalog_sha256,event_trigger_catalog_before_json,
      event_trigger_catalog_before_sha256,event_trigger_catalog_before_count,install_request_json,install_request_sha256
    ) values(true,'harness',$1,'content_migration','content_schema_owner','content_application','content_operator',
      'content_cleanup',$1,$1,$1,$2,'{"contractVersion":"ai-content-event-trigger-catalog.v2","eventTriggers":[]}',
      $1,0,'{}',$1)`, ["a".repeat(64), interim.catalogSha256]);
    await client.query("create event trigger ai_content_ddl_guard_074 on ddl_command_end execute function public.enforce_ai_content_ddl_allowlist()");
    await client.query("alter event trigger ai_content_ddl_guard_074 enable");
    const finalCatalog = await readFenceSecurityCatalog(client, names, { ownerRoleName: "postgres" });
    assert.deepEqual(finalCatalog.functions.map((row) => row.definition_sha256), interim.functions.map((row) => row.definition_sha256));
    assert.deepEqual(finalCatalog.controlTriggers.map((row) => ({
      relation_name: row.relation_name,
      trigger_name: row.trigger_name,
      trigger_type: row.trigger_type,
      enabled: row.enabled,
      deferrable: row.deferrable,
      initially_deferred: row.initially_deferred,
      function_identity: row.function_identity,
    })), [{
      relation_name: "ai_content_bootstrap_state",
      trigger_name: "ai_content_bootstrap_075_registration_must_clear",
      trigger_type: 21,
      enabled: "O",
      deferrable: true,
      initially_deferred: true,
      function_identity: "public.enforce_ai_content_075_registration_seal_cleared()",
    }, {
      relation_name: "ai_content_cutover_status_events",
      trigger_name: "ai_content_cutover_status_events_immutable",
      trigger_type: 27,
      enabled: "O",
      deferrable: false,
      initially_deferred: false,
      function_identity: "public.forbid_ai_content_cutover_event_mutation()",
    }]);
    for (const attack of [
      "alter table public.ai_content_bootstrap_state disable trigger ai_content_bootstrap_075_registration_must_clear",
      "drop trigger ai_content_bootstrap_075_registration_must_clear on public.ai_content_bootstrap_state",
      `drop trigger ai_content_bootstrap_075_registration_must_clear on public.ai_content_bootstrap_state;
       create constraint trigger ai_content_bootstrap_075_registration_must_clear
       after insert or update on public.ai_content_bootstrap_state deferrable initially deferred
       for each row execute function public.enforce_ai_content_write_fence()`,
      `create trigger ai_content_control_rogue before update on public.ai_content_bootstrap_state
       for each row execute function public.forbid_ai_content_cutover_event_mutation()`,
      `create trigger ai_content_control_rogue before update on public.ai_content_maintenance_state
       for each row execute function public.forbid_ai_content_cutover_event_mutation()`,
    ]) {
      await client.query("begin");
      await client.query("alter event trigger ai_content_ddl_guard_074 disable");
      await client.query(attack);
      await assert.rejects(
        readFenceSecurityCatalog(client, names, { ownerRoleName: "postgres" }),
        /bootstrap_074_fence_security_(?:control_)?trigger_mismatch/,
      );
      await client.query("rollback");
    }
    const eventCatalog = await readCanonicalEventTriggerCatalog(client);
    assert.equal(eventCatalog.count, 1);
    assert.equal(eventCatalog.rows[0].event_trigger_owner, "postgres");

    await client.query("set session authorization content_migration");
    await client.query("set search_path=public,pg_catalog,pg_temp");
    const liveRoleCatalog = await readCanonicalBootstrapCatalogs(client, names);
    await client.query("reset session authorization");
    await client.query("reset search_path");
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
    assert.equal(Object.values(expectedClassifierCounts).reduce((total, count) => total+count, 0), 44);
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
    const measureBranch = async ({ classifier, query }, repetitions = 1) => {
      const started = performance.now();
      for (let repetition = 0; repetition < repetitions; repetition += 1) {
        const result = await client.query(query, [brand.id]);
        assert.equal(result.rowCount, benchmarkRowCount, `${classifier} benchmark fixture count drift`);
      }
      return performance.now()-started;
    };
    const measureStableBranch = async (branch) => {
      await measureBranch(branch);
      const samples = [];
      for (let sample = 0; sample < 5; sample += 1) samples.push(await measureBranch(branch, 3));
      return median(samples);
    };
    const maintenanceOff = {};
    for (const branch of benchmarkBranches) {
      maintenanceOff[branch.classifier] = await measureStableBranch(branch);
    }
    const cutoverId = randomUUID();
    const token = `074-token-${randomUUID()}`;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const preparedPreflightIdentityValue = {
      preflightCandidateSha: "c".repeat(40), contentProposalWorkerImageDigest: `sha256:${"a".repeat(64)}`,
      proposalWorkerSourceSha: "c".repeat(40), proposalWorkerTreeSha: "d".repeat(40),
      proposalContractSourceSha256: "a".repeat(64), proposalSchemaSha256: "a".repeat(64),
      proposalCatalogSha256: "a".repeat(64), proposalModelId: "gpt-5.6-terra",
      proposalCommandDescriptorSha256: "a".repeat(64), migrationSha256: "a".repeat(64),
    };
    const preparedPreflightIdentity = JSON.stringify(preparedPreflightIdentityValue);
    const canonicalPreflightIdentitySha256 = createHash("sha256")
      .update(canonicalJson(preparedPreflightIdentityValue)).digest("hex");
    const prepareCutoverFixture = (fixtureCutoverId) => client.query(
      `select prepare_ai_content_cutover($1,'content_schema_owner','content_application','content_operator',
      'content_migration','content_cleanup',$2,$2,$3,'harness',now(),$3,$3,$5::jsonb,$6,$3,$4,$3)`,
      [fixtureCutoverId, tokenHash, "a".repeat(64), "c".repeat(40), preparedPreflightIdentity,
        canonicalPreflightIdentitySha256],
    );
    const abortCutoverId = randomUUID();
    await client.query("set session authorization content_operator");
    await prepareCutoverFixture(abortCutoverId);
    await client.query("select set_ai_content_maintenance($1,true)", [abortCutoverId]);
    const abortResult = await abortCutoverPreMarker(client, {
      cutoverId: abortCutoverId,
      fromStatus: "prepared",
      evidenceSha256: "b".repeat(64),
    });
    assert.deepEqual({ ...abortResult, eventSha256: undefined }, {
      cutoverId: abortCutoverId,
      status: "abandoned_pre_marker",
      markerPresent: false,
      maintenanceEnabled: false,
      eventSha256: undefined,
      evidenceSha256: "b".repeat(64),
    });
    assert.match(abortResult.eventSha256, /^[0-9a-f]{64}$/);
    await client.query("reset session authorization");
    assert.deepEqual((await client.query(
      `select cutover.status,cutover.abandoned_reason,maintenance.enabled,
              maintenance.cutover_id,
              (select count(*)::integer from ai_content_cutovers active
                where active.status not in ('completed','abandoned_pre_marker')) as active_count
         from ai_content_cutovers cutover
         cross join ai_content_maintenance_state maintenance
        where cutover.id=$1 and maintenance.singleton`,
      [abortCutoverId],
    )).rows, [{
      status: "abandoned_pre_marker",
      abandoned_reason: "operator_requested_pre_marker_abort",
      enabled: false,
      cutover_id: null,
      active_count: 0,
    }]);
    await client.query("set session authorization content_operator");
    await prepareCutoverFixture(cutoverId);
    await client.query("select set_ai_content_maintenance($1,true)", [cutoverId]);
    await client.query("reset session authorization");
    const preparedPreflightIdentityRow = (await client.query(
      `select proposal_preflight_identity_sha256,
              encode(digest(proposal_preflight_identity_json::text,'sha256'),'hex') as postgres_jsonb_text_sha256
         from ai_content_cutovers where id=$1`,
      [cutoverId],
    )).rows[0];
    const preparedPreflightIdentityHash = preparedPreflightIdentityRow.proposal_preflight_identity_sha256;
    assert.equal(preparedPreflightIdentityHash, canonicalPreflightIdentitySha256);
    assert.notEqual(preparedPreflightIdentityHash, preparedPreflightIdentityRow.postgres_jsonb_text_sha256,
      "the sealed canonical preflight SHA must not be replaced by PostgreSQL jsonb::text serialization");
    const beginPreflightVerification = async ({ role = null } = {}) => {
      await client.query("set session authorization content_migration");
      await client.query("begin");
      if (role) await client.query(`set local role ${quoteIdentifier(role)}`);
    };
    const endPreflightVerification = async () => {
      await client.query("rollback");
      await client.query("reset session authorization");
    };
    const verifyPreflight = (identity = preparedPreflightIdentity,
      identitySha256 = preparedPreflightIdentityHash, transferSha256 = "a".repeat(64), id = cutoverId) => client.query(
      "select verify_ai_content_cutover_preflight_identity($1,$2::jsonb,$3,$4) as verified",
      [id, identity, identitySha256, transferSha256],
    );
    const expectPreflightRejection = async (
      call, expected = /ai_content_cutover_preflight_identity_/,
    ) => {
      await client.query("savepoint preflight_rejection");
      let rejection;
      try {
        await call();
      } catch (error) {
        rejection = error;
      }
      await client.query("rollback to savepoint preflight_rejection");
      await client.query("release savepoint preflight_rejection");
      assert.ok(rejection, "expected preflight verifier rejection");
      assert.match(rejection.message, expected);
    };
    await beginPreflightVerification();
    await expectPreflightRejection(() => verifyPreflight());
    await endPreflightVerification();
    await client.query("set session authorization content_operator");
    await client.query("select transition_ai_content_cutover_status($1,'prepared','maintenance_verified',$2)", [cutoverId, "a".repeat(64)]);
    await client.query("reset session authorization");
    await beginPreflightVerification();
    assert.deepEqual((await verifyPreflight()).rows, [{ verified: true }]);
    if (preflightHashOnly) {
      t.diagnostic("canonical preflight identity hash round-trip verified against PostgreSQL 16");
      return;
    }
    for (const invalidCall of [
      () => verifyPreflight(preparedPreflightIdentity, preparedPreflightIdentityHash, "a".repeat(64), null),
      () => verifyPreflight(null),
      () => verifyPreflight(preparedPreflightIdentity, null),
      () => verifyPreflight(preparedPreflightIdentity, preparedPreflightIdentityHash, null),
      () => verifyPreflight(JSON.stringify({ ...JSON.parse(preparedPreflightIdentity), proposalModelId: "drift" })),
      () => verifyPreflight(preparedPreflightIdentity, "0".repeat(64)),
      () => verifyPreflight(preparedPreflightIdentity, preparedPreflightIdentityHash, "0".repeat(64)),
    ]) {
      await expectPreflightRejection(invalidCall);
    }
    await client.query("set local role content_schema_owner");
    await expectPreflightRejection(
      () => verifyPreflight(),
      /permission denied for function verify_ai_content_cutover_preflight_identity/,
    );
    await endPreflightVerification();
    await client.query("set session authorization content_operator");
    await assert.rejects(verifyPreflight(), /permission denied for function verify_ai_content_cutover_preflight_identity/);
    await client.query("reset session authorization");
    await client.query(`insert into ai_content_ddl_allowlist(migration_id,command_tag,object_identity_pattern)
      values('075_ai_content_three_format_cutover.sql','CREATE TABLE','public.ai_content_075_allowlisted_probe')`);
    await runPositiveAllowlistedDdl(client, "create table public.ai_content_075_allowlisted_probe(id integer)", { cutoverId, token });
    assert.equal((await client.query("select to_regclass('public.ai_content_075_allowlisted_probe')::text as relation")).rows[0].relation, "ai_content_075_allowlisted_probe");
    await client.query("drop table public.ai_content_075_allowlisted_probe");
    await client.query("set session authorization content_migration");
    await client.query("begin");
    await client.query("set local role content_schema_owner");
    await client.query(
      "select set_config('app.ai_content_cutover_id',$1,true),set_config('app.ai_content_cutover_token',$2,true),set_config('app.ai_content_migration_id','075_ai_content_three_format_cutover.sql',true)",
      [cutoverId, token],
    );
    await assert.rejects(
      client.query("create table public.aiXcontent_075_allowlisted_probe(id integer)"),
      /ai_content_ddl_not_allowlisted/,
    );
    await client.query("rollback");
    await client.query("reset session authorization");
    await client.query(`insert into ai_content_ddl_allowlist(migration_id,command_tag,object_identity_pattern)
      values('075_ai_content_three_format_cutover.sql','ALTER TABLE','public.topic_uploads')`);
    await runPositiveAllowlistedDdl(
      client,
      "alter table public.topic_uploads add column ai_content_074_owner_probe integer",
      { cutoverId, token },
    );
    assert.equal((await client.query(
      "select count(*)::integer as count from information_schema.columns where table_schema='public' and table_name='topic_uploads' and column_name='ai_content_074_owner_probe'",
    )).rows[0].count, 1);
    await runPositiveAllowlistedDdl(
      client,
      "alter table public.topic_uploads drop column ai_content_074_owner_probe",
      { cutoverId, token },
    );

    await client.query("create role content_rogue login");
    await client.query("grant content_schema_owner to content_rogue with set true");
    await client.query("grant content_schema_owner to content_rogue with inherit false");
    await client.query("grant content_schema_owner to content_rogue with admin false");
    await client.query("set session authorization content_migration");
    await client.query("set search_path=public,pg_catalog,pg_temp");
    await assert.rejects(readCanonicalBootstrapCatalogs(client, names), /bootstrap_role_catalog_invalid/);
    await client.query("reset session authorization");
    await client.query("reset search_path");
    await asRoleExpectRejection(client, "content_rogue", "content_schema_owner", "create table public.ai_content_074_rogue_ddl(id integer)");
    await client.query("revoke content_schema_owner from content_rogue");
    await client.query("drop role content_rogue");
    await client.query("set session authorization content_migration");
    await client.query("set search_path=public,pg_catalog,pg_temp");
    assert.equal((await readCanonicalBootstrapCatalogs(client, names)).roleCatalogSha256, liveRoleCatalog.roleCatalogSha256);
    await client.query("reset session authorization");
    await client.query("reset search_path");

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
      "create index public.ai_content_074_arbitrary_index on public.ai_content_generations(id)",
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
        maintenanceOn[branch.classifier] = await measureStableBranch(branch);
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
    const maxObservedRatio = Math.max(...benchmarkEvidence.map(({ ratio }) => ratio));
    const enforceBenchmark = process.env.AI_CONTENT_074_ENFORCE_BENCHMARK !== "false";
    if (enforceBenchmark) {
      for (const evidence of benchmarkEvidence) {
        assert.ok(evidence.ratio <= evidence.threshold,
          `${evidence.classifier} overhead ${evidence.ratio.toFixed(3)} exceeds ${evidence.threshold}`);
      }
      assert.ok(maxObservedRatio <= maxOverheadRatio,
        `maximum classifier overhead ${maxObservedRatio.toFixed(3)} exceeds ${maxOverheadRatio}`);
    }

    const cutover075CustomerRelations = [
      "ai_content_generation_operations",
      "ai_content_generation_prompt_bindings",
      "ai_content_proposal_attempt_events",
      "ai_content_proposal_compositions",
      "ai_content_proposal_job_contracts",
      "ai_content_proposal_model_attempts",
      "ai_content_proposal_performance_audits",
      "ai_content_proposal_research_attempt_events",
      "ai_content_proposal_research_attempts",
      "automated_content_proposal_runs",
    ];
    const cutover075ControlRelations = [
      "ai_content_cutover_release_adoption_events",
      "ai_content_cutover_release_adoptions",
      "ai_content_storage_cleanup_outbox",
    ];
    for (const relation of [...cutover075CustomerRelations, ...cutover075ControlRelations]) {
      await client.query(`create table public.${quoteIdentifier(relation)}(id uuid primary key default gen_random_uuid())`);
      await client.query(`alter table public.${quoteIdentifier(relation)} owner to content_schema_owner`);
    }
    const cutover075ProviderFunctionDefinitions = [
      `create function public.reject_ai_content_cutover_record_mutation() returns trigger
       language plpgsql set search_path=pg_catalog,public,pg_temp as $$ begin raise exception 'immutable'; end $$`,
      `create function public.begin_ai_content_cutover_release_adoption(uuid,uuid,text,text,text,text,text,text)
       returns uuid language sql security definer set search_path=pg_catalog,public,pg_temp as $$ select $1 $$`,
      `create function public.append_ai_content_cutover_release_adoption_event(uuid,integer,integer,text,jsonb,text)
       returns text language sql security definer set search_path=pg_catalog,public,pg_temp as $$ select $6 $$`,
      `create function public.claim_ai_content_storage_cleanup(uuid,uuid,text,text,uuid,integer)
       returns text language sql security definer set search_path=pg_catalog,public,pg_temp as $$ select $3 $$`,
      `create function public.complete_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)
       returns text language sql security definer set search_path=pg_catalog,public,pg_temp as $$ select $6 $$`,
      `create function public.fail_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)
       returns text language sql security definer set search_path=pg_catalog,public,pg_temp as $$ select $6 $$`,
      `create function public.is_ai_content_storage_path_protected(uuid,text)
       returns boolean language sql security definer set search_path=pg_catalog,public,pg_temp as $$ select false $$`,
    ];
    for (const definition of cutover075ProviderFunctionDefinitions) await client.query(definition);
    const cutover075CustomerTriggerFunctions = [
      "enforce_ai_content_generation_operation_identity",
      "require_ai_content_generation_operation_on_insert",
      "freeze_ai_content_generation_operation_identity",
      "freeze_automated_content_proposal_run_identity",
      "enforce_ai_content_proposal_research_attempt_contract",
      "enforce_ai_content_proposal_research_completion_pair",
      "enforce_ai_content_proposal_composition_research_success",
      "enforce_ai_content_proposal_model_attempt_contract",
      "enforce_ai_content_proposal_success_event",
      "enforce_ai_content_prompt_binding_source",
      "freeze_topic_upload_operation_identity",
      "enforce_ai_content_usage_reversal_identity",
      "reject_ai_content_usage_ledger_mutation",
    ];
    for (const functionName of cutover075CustomerTriggerFunctions) {
      await client.query(
        `create function public.${functionName}() returns trigger
         language plpgsql set search_path=pg_catalog,public,pg_temp as $$ begin return new; end $$`,
      );
      await client.query(`alter function public.${functionName}() owner to content_schema_owner`);
    }
    const cutover075CustomerCallableFunctions = [
      "transition_ai_content_generation_operation(uuid,text,text)",
      "transition_automated_content_proposal_run(uuid,text,text,uuid,uuid,uuid,text,text)",
      "append_ai_content_proposal_research_attempt_event(uuid,uuid,integer,text,uuid,jsonb,text,text)",
      "complete_ai_content_proposal_research(uuid,uuid,jsonb,text,jsonb,text,text)",
      "append_ai_content_proposal_attempt_event(uuid,uuid,integer,integer,text,text,text,text,text,text,text,text,boolean)",
      "create_ai_content_generation_prompt_binding(uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb)",
      "create_ai_content_cutover_topic_upload(uuid,uuid,uuid,text,text,jsonb)",
    ];
    for (const identity of cutover075CustomerCallableFunctions) {
      await client.query(
        `create function public.${identity} returns text
         language sql security definer set search_path=pg_catalog,public,pg_temp as $$ select 'ok'::text $$`,
      );
      await client.query(`alter function public.${identity} owner to content_schema_owner`);
    }
    const cutover075ProviderFunctions = [
      "public.reject_ai_content_cutover_record_mutation()",
      "public.begin_ai_content_cutover_release_adoption(uuid,uuid,text,text,text,text,text,text)",
      "public.append_ai_content_cutover_release_adoption_event(uuid,integer,integer,text,jsonb,text)",
      "public.claim_ai_content_storage_cleanup(uuid,uuid,text,text,uuid,integer)",
      "public.complete_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)",
      "public.fail_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)",
      "public.is_ai_content_storage_path_protected(uuid,text)",
    ];
    for (const identity of cutover075ProviderFunctions) {
      await client.query(`alter function ${identity} owner to content_schema_owner`);
      await client.query(
        `insert into ai_content_ddl_allowlist(migration_id,command_tag,object_identity_pattern)
         values('075_ai_content_three_format_cutover.sql','ALTER FUNCTION',$1)`,
        [identity.replace(/\b(uuid|text|jsonb)\b/g, "pg_catalog.$1")],
      );
    }
    for (const relation of cutover075ControlRelations) {
      await client.query(
        `insert into ai_content_ddl_allowlist(migration_id,command_tag,object_identity_pattern)
         values('075_ai_content_three_format_cutover.sql','ALTER TABLE',$1)`,
        [`public.${relation}`],
      );
    }
    const allCutover075FunctionIdentities = [
      ...cutover075ProviderFunctions,
      ...cutover075CustomerTriggerFunctions.map((name) => `public.${name}()`),
      ...cutover075CustomerCallableFunctions.map((identity) => `public.${identity}`),
    ];
    const aclDescriptorRows = [
      ...[...cutover075CustomerRelations, ...cutover075ControlRelations]
        .map((relation) => ["REVOKE", `table:public.${relation}|PUBLIC|ALL`]),
      ...allCutover075FunctionIdentities
        .map((identity) => ["REVOKE", `function:${identity}|PUBLIC|ALL`]),
      ...cutover075ControlRelations.slice(0, 2)
        .map((relation) => ["GRANT", `table:public.${relation}|content_operator|SELECT`]),
      ["GRANT", "table:public.ai_content_storage_cleanup_outbox|content_cleanup|SELECT"],
      ...["ai_content_generation_operations", "ai_content_proposal_performance_audits",
        "automated_content_proposal_runs", "ai_content_proposal_job_contracts",
        "ai_content_proposal_compositions", "ai_content_proposal_research_attempts",
        "ai_content_proposal_model_attempts"]
        .map((relation) => ["GRANT", `table:public.${relation}|content_application|INSERT,SELECT`]),
      ...["ai_content_proposal_research_attempt_events", "ai_content_proposal_attempt_events",
        "ai_content_generation_prompt_bindings"]
        .map((relation) => ["GRANT", `table:public.${relation}|content_application|SELECT`]),
      ...cutover075ProviderFunctions.slice(1, 3)
        .map((identity) => ["GRANT", `function:${identity}|content_operator|EXECUTE`]),
      ...cutover075ProviderFunctions.slice(3, 6)
        .map((identity) => ["GRANT", `function:${identity}|content_cleanup|EXECUTE`]),
      ...[
        ...cutover075CustomerCallableFunctions.map((identity) => `public.${identity}`),
        cutover075ProviderFunctions[6],
      ]
        .map((identity) => ["GRANT", `function:${identity}|content_application|EXECUTE`]),
    ];
    assert.ok(
      aclDescriptorRows
        .filter(([, descriptor]) => descriptor.startsWith("function:"))
        .every(([, descriptor]) => descriptor.startsWith("function:public.")),
      "every function ACL descriptor must use the canonical public-qualified identity",
    );
    for (const [commandTag, descriptor] of aclDescriptorRows) {
      await client.query(
        `insert into ai_content_ddl_allowlist(migration_id,command_tag,object_identity_pattern)
         values('075_ai_content_three_format_cutover.sql',$1,$2) on conflict do nothing`,
        [commandTag, descriptor],
      );
    }
    const assertAclMutationRejected = async (statement) => {
      await client.query("begin");
      try {
        await client.query(
          `update public.ai_content_bootstrap_state
              set cutover_075_fence_registration_xid=pg_current_xact_id()::text,
                  cutover_075_fence_registration_cutover_id=$1,
                  cutover_075_acl_command_tag='GRANT',
                  cutover_075_acl_object_identity='table:public.ai_content_cutover_release_adoptions',
                  cutover_075_acl_grantee='content_operator',
                  cutover_075_acl_privileges='SELECT',
                  cutover_075_acl_pre_catalog_sha256=encode(digest(
                    public.ai_content_075_acl_catalog(null,null,null,null)::text,'sha256'),'hex'),
                  cutover_075_acl_post_catalog_sha256=encode(digest(
                    public.ai_content_075_acl_catalog(
                      'GRANT','table:public.ai_content_cutover_release_adoptions','content_operator','SELECT'
                    )::text,'sha256'),'hex')
            where singleton`,
          [cutoverId],
        );
        await client.query("set session authorization content_migration");
        await client.query("set local role content_schema_owner");
        await client.query(
          "select set_config('app.ai_content_cutover_id',$1,true),set_config('app.ai_content_cutover_token',$2,true),set_config('app.ai_content_migration_id','075_ai_content_three_format_cutover.sql',true),set_config('app.ai_content_075_fence_registration','acl',true)",
          [cutoverId, token],
        );
        await assert.rejects(
          client.query(statement),
          /ai_content_075_acl_(?:catalog|poststate|command_effect)_invalid/,
        );
      } finally {
        await client.query("rollback").catch(() => {});
        await client.query("reset session authorization").catch(() => {});
      }
    };
    await assertAclMutationRejected(
      "grant select,insert on table public.ai_content_cutover_release_adoptions to content_operator",
    );
    await assertAclMutationRejected(
      "grant select on table public.ai_content_cutover_release_adoption_events to content_operator",
    );
    await assertAclMutationRejected(
      "grant select on table public.ai_content_cutover_release_adoptions,public.ai_content_cutover_release_adoption_events to content_operator",
    );
    for (const relation of cutover075CustomerRelations) {
      await client.query(
        `insert into ai_content_ddl_allowlist(migration_id,command_tag,object_identity_pattern)
         values
           ('075_ai_content_three_format_cutover.sql','CREATE TRIGGER',$1),
           ('075_ai_content_three_format_cutover.sql','ALTER TABLE',$2)`,
        [`${triggerName(relation)} on public.${relation}`, `public.${relation}`],
      );
    }

    await client.query("set session authorization content_migration");
    await assert.rejects(
      client.query("select register_ai_content_075_fence_relations()"),
      /ai_content_075_fence_registration_identity_invalid/,
    );
    await client.query("reset session authorization");
    await client.query("set session authorization content_operator");
    await assert.rejects(
      client.query("select register_ai_content_075_fence_relations()"),
      /permission denied/,
    );
    await client.query("reset session authorization");

    const beginRegistration = async ({
      suppliedCutover = cutoverId,
      suppliedToken = token,
      suppliedMigration = "075_ai_content_three_format_cutover.sql",
    } = {}) => {
      await client.query("set session authorization content_migration");
      await client.query("begin");
      await client.query("set local role content_schema_owner");
      await client.query(
        "select set_config('app.ai_content_cutover_id',$1,true),set_config('app.ai_content_cutover_token',$2,true),set_config('app.ai_content_migration_id',$3,true)",
        [suppliedCutover, suppliedToken, suppliedMigration],
      );
    };
    const endRegistrationSession = async () => {
      await client.query("rollback").catch(() => {});
      await client.query("reset session authorization");
    };
    const assertLegacyFenceState = async () => {
      assert.equal((await client.query(
        "select count(*)::integer as count from ai_content_write_fence_catalog",
      )).rows[0].count, 50);
      assert.equal((await client.query(
        "select count(*)::integer as count from pg_trigger where not tgisinternal and tgfoid='public.enforce_ai_content_write_fence()'::regprocedure",
      )).rows[0].count, 44);
    };

    await client.query("begin");
    await client.query("alter event trigger ai_content_ddl_guard_074 disable");
    await client.query("alter table public.ai_content_bootstrap_state disable trigger ai_content_bootstrap_075_registration_must_clear");
    await client.query("alter event trigger ai_content_ddl_guard_074 enable");
    await client.query("commit");
    await beginRegistration();
    await assert.rejects(
      client.query("select register_ai_content_075_fence_relations()"),
      /ai_content_075_registration_seal_trigger_invalid/,
    );
    await endRegistrationSession();
    await client.query("begin");
    await client.query("alter event trigger ai_content_ddl_guard_074 disable");
    await client.query("alter table public.ai_content_bootstrap_state enable trigger ai_content_bootstrap_075_registration_must_clear");
    await client.query("alter event trigger ai_content_ddl_guard_074 enable");
    await client.query("commit");
    await assertLegacyFenceState();
    for (const relation of ["ai_content_bootstrap_state", "ai_content_maintenance_state"]) {
      await client.query("begin");
      await client.query("alter event trigger ai_content_ddl_guard_074 disable");
      await client.query(
        `create trigger ai_content_control_rogue before update on public.${relation}
         for each row execute function public.forbid_ai_content_cutover_event_mutation()`,
      );
      await client.query("alter event trigger ai_content_ddl_guard_074 enable");
      await client.query("commit");
      await beginRegistration();
      await assert.rejects(
        client.query("select register_ai_content_075_fence_relations()"),
        /ai_content_075_registration_seal_trigger_invalid/,
      );
      await endRegistrationSession();
      await client.query("begin");
      await client.query("alter event trigger ai_content_ddl_guard_074 disable");
      await client.query(`drop trigger ai_content_control_rogue on public.${relation}`);
      await client.query("alter event trigger ai_content_ddl_guard_074 enable");
      await client.query("commit");
      await assertLegacyFenceState();
    }

    await beginRegistration({ suppliedToken: `wrong-${token}` });
    await assert.rejects(
      client.query("select register_ai_content_075_fence_relations()"),
      /ai_content_075_fence_registration_state_invalid/,
    );
    await endRegistrationSession();
    await assertLegacyFenceState();

    for (const suppliedCutover of ["", randomUUID()]) {
      await beginRegistration({ suppliedCutover });
      await assert.rejects(
        client.query("select register_ai_content_075_fence_relations()"),
        /ai_content_075_fence_registration_(?:identity|state)_invalid|query returned no rows/,
      );
      await endRegistrationSession();
      await assertLegacyFenceState();
    }
    for (const suppliedMigration of ["", "074_ai_content_maintenance_write_fence.sql"]) {
      await beginRegistration({ suppliedMigration });
      await assert.rejects(
        client.query("select register_ai_content_075_fence_relations()"),
        /ai_content_075_fence_registration_identity_invalid/,
      );
      await endRegistrationSession();
      await assertLegacyFenceState();
    }

    await client.query("drop table ai_content_generation_operations");
    await beginRegistration();
    await assert.rejects(
      client.query("select register_ai_content_075_fence_relations()"),
      /ai_content_075_fence_registration_relation_missing/,
    );
    await endRegistrationSession();
    await assertLegacyFenceState();
    await client.query("create table ai_content_generation_operations(id uuid primary key default gen_random_uuid())");
    await client.query("alter table ai_content_generation_operations owner to content_schema_owner");

    await client.query("begin");
    await client.query(
      `create trigger ${quoteIdentifier(triggerName("ai_content_generation_operations"))}
       before insert or update or delete on ai_content_generation_operations
       for each row execute function enforce_ai_content_write_fence()`,
    );
    await client.query(
      `alter table ai_content_generation_operations enable always trigger ${quoteIdentifier(triggerName("ai_content_generation_operations"))}`,
    );
    await client.query("set session authorization content_migration");
    await client.query("set local role content_schema_owner");
    await client.query(
      "select set_config('app.ai_content_cutover_id',$1,true),set_config('app.ai_content_cutover_token',$2,true),set_config('app.ai_content_migration_id','075_ai_content_three_format_cutover.sql',true)",
      [cutoverId, token],
    );
    await assert.rejects(
      client.query("select register_ai_content_075_fence_relations()"),
      /ai_content_write_fence_extra_trigger/,
    );
    await endRegistrationSession();
    await assertLegacyFenceState();

    await client.query(
      `create trigger ${quoteIdentifier("ai_content_075_unrelated_extra")}
       before insert or update or delete on topic_uploads
       for each row execute function enforce_ai_content_write_fence()`,
    );
    await client.query(
      `alter table topic_uploads enable always trigger ${quoteIdentifier("ai_content_075_unrelated_extra")}`,
    );
    await beginRegistration();
    await assert.rejects(
      client.query("select register_ai_content_075_fence_relations()"),
      /ai_content_write_fence_extra_trigger/,
    );
    await endRegistrationSession();
    await client.query(`drop trigger ${quoteIdentifier("ai_content_075_unrelated_extra")} on topic_uploads`);
    await assertLegacyFenceState();

    await client.query(
      `insert into ai_content_write_fence_catalog(relation_name,relation_class,row_classifier)
       values('ai_content_generation_operations','customer_execution','whole_relation')`,
    );
    await beginRegistration();
    await assert.rejects(
      client.query("select register_ai_content_075_fence_relations()"),
      /ai_content_075_fence_registration_catalog_invalid/,
    );
    await endRegistrationSession();
    await client.query("delete from ai_content_write_fence_catalog where relation_name='ai_content_generation_operations'");
    await assertLegacyFenceState();

    await client.query(
      `insert into ai_content_write_fence_catalog(relation_name,relation_class,row_classifier)
       values('ai_content_075_rogue','customer_execution','whole_relation')`,
    );
    await beginRegistration();
    await assert.rejects(
      client.query("select register_ai_content_075_fence_relations()"),
      /ai_content_075_fence_registration_catalog_invalid/,
    );
    await endRegistrationSession();
    await client.query("delete from ai_content_write_fence_catalog where relation_name='ai_content_075_rogue'");
    await assertLegacyFenceState();

    await client.query("begin");
    await client.query("delete from ai_content_write_fence_catalog");
    await assert.rejects(
      client.query("select verify_ai_content_write_fence_catalog()"),
      /ai_content_write_fence_catalog_exact_mismatch/,
    );
    await client.query("rollback");
    await assertLegacyFenceState();

    await beginRegistration();
    assert.equal(
      (await client.query("select register_ai_content_075_fence_relations() as registered")).rows[0].registered,
      "22ebe515247269120f8996bc63f335f27b7f767c36fcf667011312cfb03f3661",
    );
    for (const statement of [
      "grant select on table public.topic_uploads to content_operator",
      "revoke select on table public.ai_content_generation_operations from content_application",
    ]) {
      await client.query("savepoint acl_attack");
      await client.query("select set_config('app.ai_content_075_fence_registration','acl',true)");
      await assert.rejects(client.query(statement), /ai_content_075_acl_command_effect_invalid/);
      await client.query("rollback to savepoint acl_attack");
      await client.query("reset role");
      assert.deepEqual((await client.query(`
        select cutover_075_acl_command_tag,cutover_075_acl_object_identity,
               cutover_075_acl_grantee,cutover_075_acl_privileges,
               cutover_075_acl_pre_catalog_sha256,cutover_075_acl_post_catalog_sha256
          from public.ai_content_bootstrap_state where singleton
      `)).rows, [{
        cutover_075_acl_command_tag: null,
        cutover_075_acl_object_identity: null,
        cutover_075_acl_grantee: null,
        cutover_075_acl_privileges: null,
        cutover_075_acl_pre_catalog_sha256: null,
        cutover_075_acl_post_catalog_sha256: null,
      }]);
      await client.query("set local role content_schema_owner");
      assert.equal((await client.query("select current_user")).rows[0].current_user, "content_schema_owner");
      assert.deepEqual((await client.query(`
        select has_table_privilege('content_operator','public.topic_uploads','SELECT') as rogue_grant_present,
               has_table_privilege('content_application','public.ai_content_generation_operations','SELECT') as required_grant_present
      `)).rows, [{ rogue_grant_present: false, required_grant_present: true }]);
    }
    await client.query("reset role");
    await client.query("reset session authorization");
    assert.equal((await client.query("select count(*)::integer as count from ai_content_write_fence_catalog")).rows[0].count, 63);
    assert.equal((await client.query(
      "select count(*)::integer as count from pg_trigger where not tgisinternal and tgfoid='public.enforce_ai_content_write_fence()'::regprocedure",
    )).rows[0].count, 54);
    await endRegistrationSession();
    await assertLegacyFenceState();

    await beginRegistration();
    await client.query("select register_ai_content_075_fence_relations()");
    await client.query("reset role");
    await client.query("reset session authorization");
    await client.query(
      `update ai_content_bootstrap_state
          set cutover_075_fence_registration_xid=null,
              cutover_075_fence_registration_cutover_id=null
        where singleton`,
    );
    await client.query("set session authorization content_migration");
    await client.query(
      "select set_config('app.ai_content_cutover_id',$1,true),set_config('app.ai_content_cutover_token',$2,true),set_config('app.ai_content_migration_id','075_ai_content_three_format_cutover.sql',true),set_config('app.ai_content_075_fence_registration','armed',true)",
      [cutoverId, token],
    );
    await assert.rejects(
      client.query("select verify_ai_content_write_fence_catalog()"),
      /ai_content_write_fence_catalog_exact_mismatch/,
    );
    await endRegistrationSession();
    await assertLegacyFenceState();

    await beginRegistration();
    await client.query("select register_ai_content_075_fence_relations()");
    await client.query("reset role");
    await assert.rejects(
      client.query("commit"),
      /ai_content_075_fence_registration_unfinished/,
    );
    await client.query("reset session authorization");
    await assertLegacyFenceState();
    assert.equal((await client.query(
      "select count(*)::integer as count from schema_migrations where id='075_ai_content_three_format_cutover.sql'",
    )).rows[0].count, 0);

    await beginRegistration();
    await client.query("select register_ai_content_075_fence_relations()");
    await client.query("reset role");
    await client.query(
      "insert into schema_migrations(id,checksum) values('075_ai_content_three_format_cutover.sql',$1)",
      ["f".repeat(64)],
    );
    await assert.rejects(
      client.query("commit"),
      /ai_content_075_fence_registration_unfinished/,
    );
    await client.query("reset session authorization");
    await assertLegacyFenceState();
    assert.equal((await client.query(
      "select count(*)::integer as count from schema_migrations where id='075_ai_content_three_format_cutover.sql'",
    )).rows[0].count, 0);

    await beginRegistration();
    await client.query("select register_ai_content_075_fence_relations()");
    await client.query("reset role");
    await client.query(
      "insert into schema_migrations(id,checksum) values('075_ai_content_three_format_cutover.sql',$1)",
      ["f".repeat(64)],
    );
    await client.query("select set_config('app.ai_content_migration_id','',true)");
    await assert.rejects(
      client.query(
        `select transition_ai_content_cutover_status(
          $1,'maintenance_verified','migration_body_complete',$2,null,null,null,null,$3
        )`,
        [cutoverId, "e".repeat(64), "d".repeat(64)],
      ),
      /ai_content_cutover_migration_transition_invalid/,
    );
    await endRegistrationSession();
    await assertLegacyFenceState();
    assert.equal((await client.query(
      "select count(*)::integer as count from schema_migrations where id='075_ai_content_three_format_cutover.sql'",
    )).rows[0].count, 0);

    await beginRegistration();
    const firstRegistration = await client.query("select register_ai_content_075_fence_relations() as registered");
    const replayRegistration = await client.query("select register_ai_content_075_fence_relations() as registered");
    assert.deepEqual(firstRegistration.rows, [{
      registered: "22ebe515247269120f8996bc63f335f27b7f767c36fcf667011312cfb03f3661",
    }]);
    assert.deepEqual(replayRegistration.rows, firstRegistration.rows);
    await client.query("reset role");
    await client.query(
      "insert into schema_migrations(id,checksum) values('075_ai_content_three_format_cutover.sql',$1)",
      ["f".repeat(64)],
    );
    await expectPreflightRejection(() => verifyPreflight());
    assert.equal((await client.query("select verify_ai_content_write_fence_catalog() as verified")).rows[0].verified, true);
    await client.query(
      `select transition_ai_content_cutover_status(
        $1,'maintenance_verified','migration_body_complete',$2,null,null,null,null,$3
      )`,
      [cutoverId, "e".repeat(64), "d".repeat(64)],
    );
    assert.deepEqual((await verifyPreflight()).rows, [{ verified: true }]);
    assert.deepEqual((await client.query(
      `select bootstrap.cutover_075_fence_registration_xid as registration_xid,
              bootstrap.cutover_075_fence_registration_cutover_id as registration_cutover_id
         from ai_content_bootstrap_state bootstrap
        where bootstrap.singleton`,
    )).rows, [{
      registration_xid: null,
      registration_cutover_id: null,
    }]);
    await client.query("commit");
    await client.query("reset session authorization");
    assert.equal((await client.query(
      "select status from ai_content_cutovers where id=$1",
      [cutoverId],
    )).rows[0].status, "migration_body_complete");

    await client.query("set session authorization content_migration");
    await client.query("begin");
    await client.query("set local role content_schema_owner");
    await client.query(
      "select set_config('app.ai_content_cutover_id',$1,true),set_config('app.ai_content_cutover_token',$2,true),set_config('app.ai_content_migration_id','075_ai_content_three_format_cutover.sql',true)",
      [cutoverId, token],
    );
    await assert.rejects(
      client.query("select register_ai_content_075_fence_relations()"),
      /ai_content_075_fence_registration_state_invalid/,
    );
    await endRegistrationSession();
    t.diagnostic(JSON.stringify({ benchmarkEnforced: enforceBenchmark, perBranchThreshold,
      maxObservedRatio, benchmarkEvidence }));
  } finally {
    const teardownFailures = [];
    try {
      const clientResults = await Promise.allSettled(client ? [client.end()] : []);
      teardownFailures.push(...clientResults.filter(({ status }) => status === "rejected").map(({ reason }) => reason));
    } finally {
      if (container) {
        try { await container.stop(); } catch (error) { teardownFailures.push(error); }
      }
    }
    if (teardownFailures.length > 0) throw new AggregateError(teardownFailures, "074_harness_teardown_failed");
  }
});
