import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import {
  bootstrapFenceRelations,
  canonicalBootstrapObjectCatalog,
  cutover075DomainTriggers,
  legacyTriggerSearchPathFunctionIdentities as runnerLegacyTriggerSearchPathFunctionIdentities,
  legacyTriggerSearchPathMigrationChecksum,
  fullSourceMigrationIds,
  loadMigrations,
  readCanonicalBootstrapCatalogs,
  readCanonicalEventTriggerCatalog,
  readFenceSecurityCatalog,
  runMigrationsWithClient,
} from "./migrationRunner.mjs";

const legacyInstagramDeliveryChecksum =
  "7e45bc297cf35128368700b49f34974690d699198e465ecfb608ac9922cb1882";
const legacyTriggerSearchPathMigrationId = "073a_legacy_trigger_function_search_path.sql";
const legacyTriggerSearchPathFunctionIdentities = Object.freeze([
  "public.ai_content_attachment_upload_sessions_immutable_metadata()",
  "public.ai_content_v2_freeze_batch_input_snapshot()",
  "public.ai_content_v2_freeze_output_plan()",
  "public.ai_content_v2_reject_snapshot_mutation()",
  "public.enforce_ai_content_attachment_upload_session_transition()",
  "public.enqueue_ai_content_attachment_deletion()",
  "public.enqueue_ai_content_upload_session_deletion()",
  "public.reject_ai_content_analyzed_subject_snapshot_mutation()",
  "public.reject_ai_content_approved_proposal_version_mutation()",
  "public.reject_ai_content_generation_brief_mutation()",
  "public.reject_ai_content_one_time_avatar_receipt_mutation()",
  "public.reject_ai_content_one_time_avatar_revocation_mutation()",
  "public.reject_ai_content_wiki_version_snapshot_mutation()",
  "public.release_ai_content_attachment_storage_path()",
  "public.reserve_ai_content_attachment_storage_path()",
  "public.revoke_ai_content_one_time_avatar_on_attachment_unavailable()",
  "public.seal_ai_content_one_time_avatar_receipt_from_upload()",
  "public.set_updated_at()",
  "public.revoke_ai_content_one_time_avatar_receipt(uuid,text)",
]);
const originalProductServiceLibraryChecksum =
  "3b3c9f6887d3f396c106a4a95cea6e4aa321c5dac0784c16a45fe2356a2b1b74";
const legacyInstagramDeliverySql = await readFile(
  "scripts/fixtures/014_instagram_delivery_formats.legacy.sql",
  "utf8",
);
assert.equal(
  createHash("sha256").update(legacyInstagramDeliverySql).digest("hex"),
  legacyInstagramDeliveryChecksum,
);

const withDatabase = async (callback) => {
  const database = await PGlite.create({ extensions: { pgcrypto } });
  try {
    return await callback(database);
  } finally {
    await database.close();
  }
};

const runMigrationRange = async (database, migrations, firstId, lastId) => {
  for (const migration of migrations) {
    if (migration.id >= firstId && migration.id <= lastId) {
      if (
        migration.sql.startsWith("-- requires: pgvector")
        || migration.id === "027_wiki_search_v2.sql"
      ) continue;
      await database.exec(migration.sql);
    }
  }
};

const run075SchemaBodyForPglite = async (database, migration075) => {
  const start = migration075.sql.indexOf("-- 075_FENCE_REGISTRATION_BEGIN");
  const end = migration075.sql.indexOf("-- 075_FENCE_REGISTRATION_END");
  assert.ok(start > 0 && end > start, "075 must expose one exact registration boundary");
  const schemaBody = `${migration075.sql.slice(0, start)}${migration075.sql.slice(
    end + "-- 075_FENCE_REGISTRATION_END".length,
  )}`;
  assert.doesNotMatch(schemaBody, /register_ai_content_075_fence_relations/);
  await database.exec(schemaBody);
};

test("073a hardens exactly the legacy trigger function closure before 074", async () => {
  const migrations = await loadMigrations();
  assert.deepEqual(fullSourceMigrationIds, migrations.map(({ id }) => id));
  const migrationIndex = migrations.findIndex(({ id }) => id === legacyTriggerSearchPathMigrationId);
  assert.ok(migrationIndex >= 0, `${legacyTriggerSearchPathMigrationId} must exist`);
  assert.equal(migrations[migrationIndex - 1]?.id, "073_ai_content_generation_v2_render_pipeline.sql");
  assert.equal(migrations[migrationIndex + 1]?.id, "074_ai_content_maintenance_write_fence.sql");

  const migration = migrations[migrationIndex];
  assert.equal(migration.checksum, "5acce238ce19656738aff6e311d7f3db4a9763c5aee8a3ea1d6e338ce6f84001");
  assert.equal(legacyTriggerSearchPathMigrationChecksum, migration.checksum);
  assert.deepEqual(runnerLegacyTriggerSearchPathFunctionIdentities, legacyTriggerSearchPathFunctionIdentities);
  assert.doesNotMatch(migration.sql, /create\s+(?:or\s+replace\s+)?function/i);
  const alteredFunctions = [...migration.sql.matchAll(
    /alter\s+function\s+([^;]+?\))\s+set\s+search_path\s*=\s*pg_catalog\s*,\s*public\s*,\s*pg_temp\s*;/gi,
  )].map((match) => match[1].replace(/\s+/g, "").toLowerCase());
  assert.deepEqual(alteredFunctions.toSorted(), [...legacyTriggerSearchPathFunctionIdentities].toSorted());
  assert.equal(new Set(alteredFunctions).size, legacyTriggerSearchPathFunctionIdentities.length);
  assert.equal((migration.sql.match(/alter\s+function/gi) ?? []).length, legacyTriggerSearchPathFunctionIdentities.length);
});

const expected074FenceCatalog = Object.freeze([
  ["ai_content_analyzed_subject_snapshots", "customer_execution", "whole_relation"],
  ["ai_content_approved_proposal_versions", "customer_execution", "whole_relation"],
  ["ai_content_attachment_deletion_jobs", "customer_execution", "whole_relation"],
  ["ai_content_attachment_storage_path_guards", "customer_execution", "whole_relation"],
  ["ai_content_attachment_upload_sessions", "customer_execution", "whole_relation"],
  ["ai_content_create_idempotency_records", "customer_execution", "whole_relation"],
  ["ai_content_generation_attachments", "customer_execution", "whole_relation"],
  ["ai_content_generation_briefs", "customer_execution", "whole_relation"],
  ["ai_content_generation_input_snapshots", "customer_execution", "whole_relation"],
  ["ai_content_generation_jobs", "customer_execution", "whole_relation"],
  ["ai_content_generation_outputs", "customer_execution", "whole_relation"],
  ["ai_content_generation_reference_migration_audits", "customer_execution", "whole_relation"],
  ["ai_content_generation_references", "customer_execution", "whole_relation"],
  ["ai_content_generation_render_jobs", "customer_execution", "whole_relation"],
  ["ai_content_generations", "customer_execution", "whole_relation"],
  ["ai_content_one_time_avatar_receipts", "customer_execution", "whole_relation"],
  ["ai_content_one_time_avatar_revocations", "customer_execution", "whole_relation"],
  ["ai_content_output_research_snapshots", "customer_execution", "whole_relation"],
  ["ai_content_proposal_batches", "customer_execution", "whole_relation"],
  ["ai_content_proposal_jobs", "customer_execution", "whole_relation"],
  ["ai_content_proposal_research_snapshots", "customer_execution", "whole_relation"],
  ["ai_content_proposals", "customer_execution", "whole_relation"],
  ["ai_content_subject_analyses", "customer_execution", "whole_relation"],
  ["ai_content_subject_appeal_regeneration_keys", "customer_execution", "whole_relation"],
  ["ai_content_subject_images", "customer_execution", "whole_relation"],
  ["ai_content_usage_ledger", "customer_execution", "whole_relation"],
  ["ai_content_wiki_version_snapshots", "customer_execution", "whole_relation"],
  ["auto_approval_checks", "customer_execution", "whole_relation"],
  ["automation_runs", "customer_execution", "daily_generation_automation"],
  ["brand_format_rotation_states", "customer_execution", "whole_relation"],
  ["channel_outputs", "customer_execution", "whole_relation"],
  ["content_topics", "customer_execution", "whole_relation"],
  ["jobs", "customer_execution", "legacy_content_job"],
  ["llm_runs", "customer_execution", "whole_relation"],
  ["master_drafts", "customer_execution", "whole_relation"],
  ["publish_queue", "customer_execution", "ai_content_scheduled_publish"],
  ["publish_attempts", "customer_execution", "ai_content_publish_attempt"],
  ["regeneration_requests", "customer_execution", "whole_relation"],
  ["review_events", "customer_execution", "whole_relation"],
  ["source_crawl_runs", "customer_execution", "scheduled_proposal_refresh"],
  ["storage_artifacts", "customer_execution", "ai_content_generated_artifact"],
  ["topic_publish_groups", "customer_execution", "whole_relation"],
  ["topic_rows", "customer_execution", "legacy_automated_topic"],
  ["topic_uploads", "customer_execution", "whole_relation"],
  ["ai_content_bootstrap_state", "cutover_control", "whole_relation"],
  ["ai_content_cutover_status_events", "cutover_control", "whole_relation"],
  ["ai_content_cutovers", "cutover_control", "whole_relation"],
  ["ai_content_ddl_allowlist", "cutover_control", "whole_relation"],
  ["ai_content_maintenance_state", "cutover_control", "whole_relation"],
  ["ai_content_write_fence_catalog", "cutover_control", "whole_relation"],
].map(([relation_name, relation_class, row_classifier]) => ({ relation_name, relation_class, row_classifier })));

test("074 maintenance write fence is default-off and installs the exact execution catalog", async () => {
  const migrations = await loadMigrations();
  const migration074 = migrations.find((migration) => migration.id === "074_ai_content_maintenance_write_fence.sql");
  assert.ok(migration074);
  assert.match(
    migration074.sql,
    /join pg_attribute attribute[\s\S]*cross join lateral aclexplode\(attribute\.attacl\) column_acl[\s\S]*ai_content_075_acl_final_catalog_invalid/i,
  );
  assert.doesNotMatch(
    migration074.sql,
    /aclexplode\(coalesce\(attribute\.attacl\s*,\s*acldefault/i,
  );
  assert.match(
    migration074.sql,
    /relpersistence<>'p'[\s\S]*relreplident<>'d'[\s\S]*relispartition[\s\S]*pg_inherits[\s\S]*tgisinternal[\s\S]*tgenabled='D'[\s\S]*ai_content_write_fence_relation_structure_mismatch/i,
  );

  await withDatabase(async (database) => {
    await runMigrationRange(database, migrations, "001_initial_schema.sql", "073_ai_content_generation_v2_render_pipeline.sql");
    await database.exec(migration074.sql);
    const state = await database.query("select enabled, cutover_id, enabled_at from ai_content_maintenance_state where singleton");
    assert.deepEqual(state.rows, [{ enabled: false, cutover_id: null, enabled_at: null }]);
    const catalog = await database.query("select relation_name, relation_class, row_classifier from ai_content_write_fence_catalog order by relation_name");
    assert.deepEqual(catalog.rows, expected074FenceCatalog.toSorted((left, right) => left.relation_name.localeCompare(right.relation_name)));
    const triggers = await database.query(`
      select catalog.relation_name, trigger.tgenabled,
             trigger.tgtype::integer as trigger_type,
             trigger.tgfoid = 'enforce_ai_content_write_fence()'::regprocedure as function_matches
        from ai_content_write_fence_catalog catalog
        join pg_trigger trigger
          on trigger.tgrelid=to_regclass('public.' || catalog.relation_name)
         and trigger.tgname=ai_content_fence_trigger_name(catalog.relation_name)
       where catalog.relation_class='customer_execution'
       order by catalog.relation_name
    `);
    assert.deepEqual(triggers.rows, expected074FenceCatalog
      .filter((row) => row.relation_class === "customer_execution")
      .toSorted((left, right) => left.relation_name.localeCompare(right.relation_name))
      .map((row) => ({ relation_name: row.relation_name, tgenabled: "A", trigger_type: 31, function_matches: true })));
    const extras = await database.query(`
      select count(*)::integer as count
        from pg_trigger trigger
       where not trigger.tgisinternal
         and trigger.tgfoid='enforce_ai_content_write_fence()'::regprocedure
         and not exists (
           select 1 from ai_content_write_fence_catalog catalog
            where catalog.relation_class='customer_execution'
              and trigger.tgrelid=to_regclass('public.' || catalog.relation_name)
              and trigger.tgname=ai_content_fence_trigger_name(catalog.relation_name)
         )
    `);
    assert.equal(extras.rows[0].count, 0);
    const managedTriggerName = (await database.query(
      "select ai_content_fence_trigger_name('content_topics') as trigger_name",
    )).rows[0].trigger_name;
    assert.match(managedTriggerName, /^ai_content_fence_[a-z0-9_]+$/);
    await database.exec(`
      drop trigger ${managedTriggerName} on content_topics;
      create trigger ${managedTriggerName}
        before insert or update or delete on content_topics
        for each row when (false) execute function enforce_ai_content_write_fence();
      alter table content_topics enable always trigger ${managedTriggerName};
    `);
    await assert.rejects(
      database.query("select verify_ai_content_write_fence_catalog()"),
      /ai_content_write_fence_catalog_mismatch/,
    );
    await database.exec(`
      drop trigger ${managedTriggerName} on content_topics;
      create trigger ${managedTriggerName}
        before insert or update or delete on content_topics
        for each row execute function enforce_ai_content_write_fence();
      alter table content_topics enable always trigger ${managedTriggerName};
    `);
    assert.equal((await database.query(
      "select verify_ai_content_write_fence_catalog() as verified",
    )).rows[0].verified, true);
    await database.exec("alter table topic_uploads enable row level security");
    await assert.rejects(
      database.query("select verify_ai_content_write_fence_catalog()"),
      /ai_content_write_fence_relation_structure_mismatch/,
    );
    await database.exec("alter table topic_uploads disable row level security");
    await database.exec(
      "create rule task3o_topic_uploads_deny_update as on update to topic_uploads do instead nothing",
    );
    await assert.rejects(
      database.query("select verify_ai_content_write_fence_catalog()"),
      /ai_content_write_fence_relation_structure_mismatch/,
    );
    await database.exec("drop rule task3o_topic_uploads_deny_update on topic_uploads");
    await database.exec("alter table ai_content_attachment_storage_path_guards set unlogged");
    await assert.rejects(
      database.query("select verify_ai_content_write_fence_catalog()"),
      /ai_content_write_fence_relation_structure_mismatch/,
    );
    await database.exec("alter table ai_content_attachment_storage_path_guards set logged");
    await database.exec("alter table topic_uploads replica identity full");
    await assert.rejects(
      database.query("select verify_ai_content_write_fence_catalog()"),
      /ai_content_write_fence_relation_structure_mismatch/,
    );
    await database.exec("alter table topic_uploads replica identity default");
    const internalFenceConstraintTrigger = (await database.query(`
      select relation.relname as relation_name,trigger.tgname as trigger_name
        from pg_trigger trigger
        join pg_class relation on relation.oid=trigger.tgrelid
       where trigger.tgisinternal and trigger.tgconstraint<>0
         and relation.relname=any($1::text[])
       order by relation.relname,trigger.tgname limit 1
    `, [expected074FenceCatalog.map((row) => row.relation_name)])).rows[0];
    assert.ok(internalFenceConstraintTrigger);
    const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
    await database.exec(`alter table public.${quoteIdentifier(internalFenceConstraintTrigger.relation_name)}
      disable trigger ${quoteIdentifier(internalFenceConstraintTrigger.trigger_name)}`);
    await assert.rejects(
      database.query("select verify_ai_content_write_fence_catalog()"),
      /ai_content_write_fence_relation_structure_mismatch/,
    );
    await database.exec(`alter table public.${quoteIdentifier(internalFenceConstraintTrigger.relation_name)}
      enable trigger ${quoteIdentifier(internalFenceConstraintTrigger.trigger_name)}`);
    assert.equal((await database.query(
      "select verify_ai_content_write_fence_catalog() as verified",
    )).rows[0].verified, true);
    const acceptedControlTriggerBypasses = [];
    for (const variant of [{
      label: "status-events-immutable",
      apply: `
        drop trigger ai_content_cutover_status_events_immutable on ai_content_cutover_status_events;
        create trigger ai_content_cutover_status_events_immutable
          before update or delete on ai_content_cutover_status_events
          for each row when (false) execute function forbid_ai_content_cutover_event_mutation();
        alter table ai_content_cutover_status_events
          enable trigger ai_content_cutover_status_events_immutable;
      `,
      restore: `
        drop trigger ai_content_cutover_status_events_immutable on ai_content_cutover_status_events;
        create trigger ai_content_cutover_status_events_immutable
          before update or delete on ai_content_cutover_status_events
          for each row execute function forbid_ai_content_cutover_event_mutation();
        alter table ai_content_cutover_status_events
          enable trigger ai_content_cutover_status_events_immutable;
      `,
    }, {
      label: "bootstrap-registration-seal",
      apply: `
        drop trigger ai_content_bootstrap_075_registration_must_clear on ai_content_bootstrap_state;
        create constraint trigger ai_content_bootstrap_075_registration_must_clear
          after insert or update on ai_content_bootstrap_state
          deferrable initially deferred for each row when (false)
          execute function enforce_ai_content_075_registration_seal_cleared();
        alter table ai_content_bootstrap_state
          enable trigger ai_content_bootstrap_075_registration_must_clear;
      `,
      restore: `
        drop trigger ai_content_bootstrap_075_registration_must_clear on ai_content_bootstrap_state;
        create constraint trigger ai_content_bootstrap_075_registration_must_clear
          after insert or update on ai_content_bootstrap_state
          deferrable initially deferred for each row
          execute function enforce_ai_content_075_registration_seal_cleared();
        alter table ai_content_bootstrap_state
          enable trigger ai_content_bootstrap_075_registration_must_clear;
      `,
    }]) {
      await database.exec(variant.apply);
      try {
        await database.query("select verify_ai_content_write_fence_catalog()");
        acceptedControlTriggerBypasses.push(variant.label);
      } catch (error) {
        assert.match(String(error), /ai_content_write_fence_control_trigger_mismatch/);
      } finally {
        await database.exec(variant.restore);
      }
    }
    assert.deepEqual(acceptedControlTriggerBypasses, []);
    assert.equal((await database.query(
      "select verify_ai_content_write_fence_catalog() as verified",
    )).rows[0].verified, true);
    await database.query("update ai_content_write_fence_catalog set row_classifier='scheduled_proposal_refresh' where relation_name='topic_rows'");
    await assert.rejects(database.query("select verify_ai_content_write_fence_catalog()"), /ai_content_write_fence_catalog_exact_mismatch/);
    await database.query("update ai_content_write_fence_catalog set row_classifier='legacy_automated_topic' where relation_name='topic_rows'");
    await database.query("begin");
    await database.query("delete from ai_content_write_fence_catalog");
    await assert.rejects(database.query("select verify_ai_content_write_fence_catalog()"), /ai_content_write_fence_catalog_exact_mismatch/);
    await database.query("rollback");
    assert.equal((await database.query("select count(*)::integer as count from ai_content_write_fence_catalog")).rows[0].count, expected074FenceCatalog.length);

    const workspace = await database.query(
      "insert into workspaces (name, slug) values ('Fence', $1) returning id",
      [`fence-${randomUUID()}`],
    );
    const brand = await database.query(
      "insert into brands (workspace_id, name) values ($1, 'Fence Brand') returning id",
      [workspace.rows[0].id],
    );
    await database.query(
      "insert into content_topics (workspace_id, brand_id, title, angle) values ($1,$2,'default off','safe')",
      [workspace.rows[0].id, brand.rows[0].id],
    );
    const upload = await database.query(
      "insert into topic_uploads (workspace_id,brand_id,file_name) values ($1,$2,'topics.csv') returning id",
      [workspace.rows[0].id, brand.rows[0].id],
    );
    await database.query("update topic_uploads set file_name='topics-updated.csv' where id=$1", [upload.rows[0].id]);
    const disposableUpload = await database.query(
      "insert into topic_uploads (workspace_id,brand_id,file_name) values ($1,$2,'disposable.csv') returning id",
      [workspace.rows[0].id, brand.rows[0].id],
    );
    await database.query("delete from topic_uploads where id=$1", [disposableUpload.rows[0].id]);
    const cutoverId = randomUUID();
    const eventHash = "a".repeat(64);
    const preflightIdentity = JSON.stringify({
      preflightCandidateSha: "c".repeat(40), contentProposalWorkerImageDigest: `sha256:${"b".repeat(64)}`,
      proposalWorkerSourceSha: "c".repeat(40), proposalWorkerTreeSha: "d".repeat(40),
      proposalContractSourceSha256: "b".repeat(64), proposalSchemaSha256: "b".repeat(64),
      proposalCatalogSha256: "b".repeat(64), proposalModelId: "gpt-5.6-terra",
      proposalCommandDescriptorSha256: "b".repeat(64), migrationSha256: "b".repeat(64),
    });
    await database.query(
      `insert into ai_content_cutovers (
         id,status,migration_id,schema_owner_role_name,application_role_name,
         operator_role_name,migration_role_name,cleanup_role_name,bypass_token_sha256,
         cleanup_token_sha256,database_role_catalog_sha256,provider_backup_id,
         provider_snapshot_created_at,incident_bundle_sha256,preserved_data_manifest_sha256,
         proposal_preflight_identity_json,proposal_preflight_identity_sha256,
         proposal_preflight_transfer_sha256,intended_release_sha,latest_status_event_sha256
       ) values ($1,'prepared','075_ai_content_three_format_cutover.sql','content_owner',
         'content_app','content_operator','content_migration','content_cleanup',$2,$2,$2,
         'backup-1',now(),$2,$2,$5::jsonb,$2,$2,$3,$4)`,
      [cutoverId, "b".repeat(64), "c".repeat(40), eventHash, preflightIdentity],
    );
    await database.query(
      `insert into ai_content_cutover_status_events (
         cutover_id,sequence_number,from_status,to_status,evidence_sha256,event_sha256
       ) values ($1,0,null,'prepared',$2,$3)`,
      [cutoverId, "d".repeat(64), eventHash],
    );
    await database.query(
      "update ai_content_maintenance_state set enabled=true,cutover_id=$1,enabled_at=now() where singleton",
      [cutoverId],
    );
    await assert.rejects(
      database.query(
        "insert into content_topics (workspace_id, brand_id, title, angle) values ($1,$2,'blocked','blocked')",
        [workspace.rows[0].id, brand.rows[0].id],
      ),
      /ai_content_maintenance/,
    );
    await assert.rejects(
      database.query(
        "insert into topic_uploads (workspace_id,brand_id,file_name) values ($1,$2,'blocked.csv')",
        [workspace.rows[0].id, brand.rows[0].id],
      ),
      /ai_content_maintenance/,
    );
    await assert.rejects(
      database.query("update topic_uploads set file_name='blocked-update.csv' where id=$1", [upload.rows[0].id]),
      /ai_content_maintenance/,
    );
    await assert.rejects(
      database.query("delete from topic_uploads where id=$1", [upload.rows[0].id]),
      /ai_content_maintenance/,
    );
    const topic = await database.query(
      `insert into topic_rows (
         workspace_id,brand_id,topic_upload_id,row_number,status,topic_title,topic_angle,topic_key
       ) values ($1,$2,$3,1,'skipped','unrelated','manual','unrelated-key') returning id`,
      [workspace.rows[0].id, brand.rows[0].id, upload.rows[0].id],
    );
    await database.query("update topic_rows set status='invalid' where id=$1", [topic.rows[0].id]);
    await assert.rejects(
      database.query("update topic_rows set status='used',used_at=now() where id=$1", [topic.rows[0].id]),
      /ai_content_maintenance/,
    );
  });
});

test("074 maintenance write fence classifies every shared execution row for insert update and delete", async () => {
  const migrations = await loadMigrations();
  const migration074 = migrations.find((migration) => migration.id === "074_ai_content_maintenance_write_fence.sql");
  assert.ok(migration074);

  await withDatabase(async (database) => {
    await runMigrationRange(database, migrations, "001_initial_schema.sql", "073_ai_content_generation_v2_render_pipeline.sql");
    await database.exec(migration074.sql);
    const publishing = await insertPublishingFixture(database);

    const upload = await database.query(
      "insert into topic_uploads(workspace_id,brand_id,file_name) values($1,$2,'fence.csv') returning id",
      [publishing.workspaceId, publishing.brandId],
    );
    const topicRows = [];
    for (const [rowNumber, status] of [[1, "uploaded"], [2, "uploaded"], [3, "skipped"]]) {
      const result = await database.query(
        `insert into topic_rows(workspace_id,brand_id,topic_upload_id,row_number,status,topic_title,topic_angle,topic_key)
         values($1,$2,$3,$4,$5,$6,'angle',$7) returning id`,
        [publishing.workspaceId, publishing.brandId, upload.rows[0].id, rowNumber, status, `topic-${rowNumber}`, `key-${randomUUID()}`],
      );
      topicRows.push(result.rows[0].id);
    }

    const source = await database.query(
      `insert into source_urls(workspace_id,brand_id,source_type,url,url_hash)
       values($1,$2,'owned','https://example.com/fence',$3) returning id`,
      [publishing.workspaceId, publishing.brandId, randomUUID()],
    );
    const crawlRows = [];
    for (const runKey of [`scheduled-proposal-refresh:${randomUUID()}`, `scheduled-proposal-refresh:${randomUUID()}`, `manual:${randomUUID()}`]) {
      const result = await database.query(
        `insert into source_crawl_runs(workspace_id,brand_id,source_url_id,trigger,run_key)
         values($1,$2,$3,'manual',$4) returning id`,
        [publishing.workspaceId, publishing.brandId, source.rows[0].id, runKey],
      );
      crawlRows.push(result.rows[0].id);
    }

    const jobRows = [];
    for (const jobType of ["instagram_feed_render", "instagram_feed_render", "source_crawl"]) {
      const result = await database.query(
        "insert into jobs(workspace_id,brand_id,job_type) values($1,$2,$3) returning id",
        [publishing.workspaceId, publishing.brandId, jobType],
      );
      jobRows.push(result.rows[0].id);
    }

    const generatedArtifacts = [];
    for (const index of [1, 2]) {
      const result = await database.query(
        `insert into storage_artifacts(workspace_id,brand_id,artifact_type,bucket,path)
         values($1,$2,'generated_manifest','vercel-blob',$3) returning id`,
        [publishing.workspaceId, publishing.brandId, `ai-content/${publishing.brandId}/${randomUUID()}/manifest-${index}.json`],
      );
      generatedArtifacts.push(result.rows[0].id);
    }
    const brandArtifact = await database.query(
      `insert into storage_artifacts(workspace_id,brand_id,artifact_type,bucket,path)
       values($1,$2,'brand_asset','vercel-blob',$3) returning id`,
      [publishing.workspaceId, publishing.brandId, `brands/${publishing.brandId}/${randomUUID()}.png`],
    );

    const queueRows = await database.query(
      `select queue.*, output.id as linked_output_id
         from publish_queue queue join channel_outputs output on output.id=queue.channel_output_id
        where queue.workspace_id=$1 order by queue.created_at,queue.id`,
      [publishing.workspaceId],
    );
    assert.ok(queueRows.rows.length >= 4);
    for (let index = 0; index < 3; index += 1) {
      const generation = await database.query(
        `insert into ai_content_generations(workspace_id,brand_id,type,title,status,analysis_idempotency_key)
         values($1,$2,'card_news',$3,'completed',$4) returning id`,
        [publishing.workspaceId, publishing.brandId, `fence-${index}`, `analysis-${randomUUID()}`],
      );
      const output = await database.query(
        `insert into ai_content_generation_outputs(workspace_id,brand_id,generation_id,output_index,title,status)
         values($1,$2,$3,1,$4,'completed') returning id`,
        [publishing.workspaceId, publishing.brandId, generation.rows[0].id, `fence-${index}`],
      );
      await database.query("update channel_outputs set ai_content_generation_output_id=$1 where id=$2", [output.rows[0].id, queueRows.rows[index].channel_output_id]);
    }
    const relatedInsertRow = queueRows.rows[2];
    await database.query("delete from publish_queue where id=$1", [relatedInsertRow.id]);
    const unrelatedRow = queueRows.rows[3];
    const insertAttempt = (queue, attemptNumber) => database.query(
      `insert into publish_attempts(workspace_id,brand_id,publish_queue_id,attempt_number)
       values($1,$2,$3,$4) returning id`,
      [publishing.workspaceId, publishing.brandId, queue.id, attemptNumber],
    );
    const relatedAttemptUpdate = await insertAttempt(queueRows.rows[0], 91);
    const relatedAttemptDelete = await insertAttempt(queueRows.rows[1], 92);
    const relatedAttemptEscape = await insertAttempt(queueRows.rows[0], 93);
    const unrelatedAttemptReclassify = await insertAttempt(unrelatedRow, 94);
    const unrelatedAttemptAllowed = await insertAttempt(unrelatedRow, 95);

    // The current production constraint only permits daily_generation. Drop it in
    // this fixture so the narrow shared-table classifier is proven future-safe.
    await database.query("alter table automation_runs drop constraint automation_runs_type_check");
    const automationRows = [];
    for (const runType of ["daily_generation", "daily_generation", "manual_maintenance"]) {
      const result = await database.query(
        `insert into automation_runs(workspace_id,brand_id,run_type,run_key,scheduled_date)
         values($1,$2,$3,$4,current_date) returning id`,
        [publishing.workspaceId, publishing.brandId, runType, `${runType}:${randomUUID()}`],
      );
      automationRows.push(result.rows[0].id);
    }

    const cutoverId = randomUUID();
    const digest = "b".repeat(64);
    const eventHash = "a".repeat(64);
    const preflightIdentity = JSON.stringify({
      preflightCandidateSha: "c".repeat(40), contentProposalWorkerImageDigest: `sha256:${digest}`,
      proposalWorkerSourceSha: "c".repeat(40), proposalWorkerTreeSha: "d".repeat(40),
      proposalContractSourceSha256: digest, proposalSchemaSha256: digest,
      proposalCatalogSha256: digest, proposalModelId: "gpt-5.6-terra",
      proposalCommandDescriptorSha256: digest, migrationSha256: digest,
    });
    await database.query(
      `insert into ai_content_cutovers(
         id,status,migration_id,schema_owner_role_name,application_role_name,operator_role_name,migration_role_name,
         cleanup_role_name,bypass_token_sha256,cleanup_token_sha256,database_role_catalog_sha256,provider_backup_id,
         provider_snapshot_created_at,incident_bundle_sha256,preserved_data_manifest_sha256,
         proposal_preflight_identity_json,proposal_preflight_identity_sha256,proposal_preflight_transfer_sha256,
         intended_release_sha,latest_status_event_sha256)
       values($1,'prepared','075_ai_content_three_format_cutover.sql','content_owner','content_app','content_operator',
         'content_migration','content_cleanup',$2,$2,$2,'backup',now(),$2,$2,$5::jsonb,$2,$2,$3,$4)`,
      [cutoverId, digest, "c".repeat(40), eventHash, preflightIdentity],
    );

    await database.query(
      `insert into ai_content_cutover_status_events(cutover_id,sequence_number,from_status,to_status,evidence_sha256,event_sha256)
       values($1,0,null,'prepared',$2,$3)`,
      [cutoverId, "d".repeat(64), eventHash],
    );
    await database.query("update ai_content_maintenance_state set enabled=true,cutover_id=$1,enabled_at=now() where singleton", [cutoverId]);

    const queueStatusBeforeAttempt = await database.query("select status from publish_queue where id=$1", [queueRows.rows[0].id]);
    await assert.rejects(insertAttempt(queueRows.rows[0], 99), /ai_content_maintenance/);
    await assert.rejects(database.query("update publish_attempts set status='succeeded',finished_at=now() where id=$1", [relatedAttemptUpdate.rows[0].id]), /ai_content_maintenance/);
    await assert.rejects(database.query("delete from publish_attempts where id=$1", [relatedAttemptDelete.rows[0].id]), /ai_content_maintenance/);
    await assert.rejects(database.query("update publish_attempts set publish_queue_id=$2 where id=$1", [relatedAttemptEscape.rows[0].id, unrelatedRow.id]), /ai_content_maintenance/);
    await assert.rejects(database.query("update publish_attempts set publish_queue_id=$2 where id=$1", [unrelatedAttemptReclassify.rows[0].id, queueRows.rows[0].id]), /ai_content_maintenance/);
    await database.query("update publish_attempts set status='succeeded',finished_at=now() where id=$1", [unrelatedAttemptAllowed.rows[0].id]);
    await database.query("delete from publish_attempts where id=$1", [unrelatedAttemptAllowed.rows[0].id]);
    const queueStatusAfterAttempt = await database.query("select status from publish_queue where id=$1", [queueRows.rows[0].id]);
    assert.deepEqual(queueStatusAfterAttempt.rows, queueStatusBeforeAttempt.rows);

    await assert.rejects(database.query(
      `insert into topic_rows(workspace_id,brand_id,topic_upload_id,row_number,status,topic_title,topic_angle,topic_key)
       values($1,$2,$3,10,'uploaded','blocked','angle',$4)`,
      [publishing.workspaceId, publishing.brandId, upload.rows[0].id, `key-${randomUUID()}`],
    ), /ai_content_maintenance/);
    await assert.rejects(database.query("update topic_rows set status='used',used_at=now() where id=$1", [topicRows[0]]), /ai_content_maintenance/);
    await assert.rejects(database.query("delete from topic_rows where id=$1", [topicRows[1]]), /ai_content_maintenance/);
    await assert.rejects(database.query("update topic_rows set status='skipped' where id=$1", [topicRows[0]]), /ai_content_maintenance/);
    await database.query("update topic_rows set status='invalid' where id=$1", [topicRows[2]]);
    await database.query("delete from topic_rows where id=$1", [topicRows[2]]);

    await assert.rejects(database.query(
      `insert into source_crawl_runs(workspace_id,brand_id,source_url_id,trigger,run_key)
       values($1,$2,$3,'scheduled',$4)`,
      [publishing.workspaceId, publishing.brandId, source.rows[0].id, `scheduled-proposal-refresh:${randomUUID()}`],
    ), /ai_content_maintenance/);
    await assert.rejects(database.query("update source_crawl_runs set status='running' where id=$1", [crawlRows[0]]), /ai_content_maintenance/);
    await assert.rejects(database.query("delete from source_crawl_runs where id=$1", [crawlRows[1]]), /ai_content_maintenance/);
    await assert.rejects(database.query("update source_crawl_runs set run_key=$2 where id=$1", [crawlRows[0], `manual:${randomUUID()}`]), /ai_content_maintenance/);
    await database.query("update source_crawl_runs set status='failed' where id=$1", [crawlRows[2]]);
    await database.query("delete from source_crawl_runs where id=$1", [crawlRows[2]]);

    await assert.rejects(database.query("insert into jobs(workspace_id,brand_id,job_type) values($1,$2,'instagram_feed_render')", [publishing.workspaceId, publishing.brandId]), /ai_content_maintenance/);
    await assert.rejects(database.query("update jobs set status='running' where id=$1", [jobRows[0]]), /ai_content_maintenance/);
    await assert.rejects(database.query("delete from jobs where id=$1", [jobRows[1]]), /ai_content_maintenance/);
    await assert.rejects(database.query("update jobs set job_type='source_crawl' where id=$1", [jobRows[0]]), /ai_content_maintenance/);
    await database.query("update jobs set status='running' where id=$1", [jobRows[2]]);
    await database.query("delete from jobs where id=$1", [jobRows[2]]);

    await assert.rejects(database.query(
      `insert into storage_artifacts(workspace_id,brand_id,artifact_type,bucket,path)
       values($1,$2,'generated_manifest','vercel-blob',$3)`,
      [publishing.workspaceId, publishing.brandId, `ai-content/${publishing.brandId}/${randomUUID()}/manifest.json`],
    ), /ai_content_maintenance/);
    await assert.rejects(database.query("update storage_artifacts set byte_size=1 where id=$1", [generatedArtifacts[0]]), /ai_content_maintenance/);
    await assert.rejects(database.query("delete from storage_artifacts where id=$1", [generatedArtifacts[1]]), /ai_content_maintenance/);
    await assert.rejects(database.query("update storage_artifacts set artifact_type='brand_asset' where id=$1", [generatedArtifacts[0]]), /ai_content_maintenance/);
    await database.query("update storage_artifacts set byte_size=1 where id=$1", [brandArtifact.rows[0].id]);
    await database.query("delete from storage_artifacts where id=$1", [brandArtifact.rows[0].id]);

    await assert.rejects(database.query("update publish_queue set status='deferred' where id=$1", [queueRows.rows[0].id]), /ai_content_maintenance/);
    await assert.rejects(database.query("delete from publish_queue where id=$1", [queueRows.rows[1].id]), /ai_content_maintenance/);
    await assert.rejects(database.query("update publish_queue set channel_output_id=$2 where id=$1", [queueRows.rows[0].id, unrelatedRow.channel_output_id]), /ai_content_maintenance/);
    await assert.rejects(database.query(
      `insert into publish_queue(id,workspace_id,brand_id,channel_output_id,topic_publish_group_id,brand_channel_id,channel,status,approval_type,idempotency_key)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [relatedInsertRow.id, relatedInsertRow.workspace_id, relatedInsertRow.brand_id, relatedInsertRow.channel_output_id,
        relatedInsertRow.topic_publish_group_id, relatedInsertRow.brand_channel_id, relatedInsertRow.channel,
        relatedInsertRow.status, relatedInsertRow.approval_type, relatedInsertRow.idempotency_key],
    ), /ai_content_maintenance/);
    await database.query("update publish_queue set status='deferred' where id=$1", [unrelatedRow.id]);
    await database.query("delete from publish_queue where id=$1", [unrelatedRow.id]);
    await database.query(
      `insert into publish_queue(id,workspace_id,brand_id,channel_output_id,topic_publish_group_id,brand_channel_id,channel,status,approval_type,idempotency_key)
       values($1,$2,$3,$4,$5,$6,$7,'queued',$8,$9)`,
      [unrelatedRow.id, unrelatedRow.workspace_id, unrelatedRow.brand_id, unrelatedRow.channel_output_id,
        unrelatedRow.topic_publish_group_id, unrelatedRow.brand_channel_id, unrelatedRow.channel,
        unrelatedRow.approval_type, unrelatedRow.idempotency_key],
    );

    await assert.rejects(database.query(
      `insert into automation_runs(workspace_id,brand_id,run_type,run_key,scheduled_date)
       values($1,$2,'daily_generation',$3,current_date)`,
      [publishing.workspaceId, publishing.brandId, `daily_generation:${randomUUID()}`],
    ), /ai_content_maintenance/);
    await assert.rejects(database.query("update automation_runs set status='failed' where id=$1", [automationRows[0]]), /ai_content_maintenance/);
    await assert.rejects(database.query("delete from automation_runs where id=$1", [automationRows[1]]), /ai_content_maintenance/);
    await assert.rejects(database.query("update automation_runs set run_type='manual_maintenance' where id=$1", [automationRows[0]]), /ai_content_maintenance/);
    await database.query("update automation_runs set status='succeeded' where id=$1", [automationRows[2]]);
    await database.query("delete from automation_runs where id=$1", [automationRows[2]]);
  });
});

test("074 prepare cutover accepts only the five roles sealed by bootstrap", async () => {
  const migrations = await loadMigrations();
  const migration074 = migrations.find((migration) => migration.id === "074_ai_content_maintenance_write_fence.sql");
  assert.ok(migration074);
  await withDatabase(async (database) => {
    await runMigrationRange(database, migrations, "001_initial_schema.sql", "073_ai_content_generation_v2_render_pipeline.sql");
    await database.exec(migration074.sql);
    await database.query(
      `insert into ai_content_bootstrap_state(
         singleton,authorization_request_id,authorization_sha256,migration_role_name,schema_owner_role_name,
         application_role_name,operator_role_name,cleanup_role_name,migration_sha256,role_catalog_sha256,
         object_catalog_sha256,fence_security_catalog_sha256,event_trigger_catalog_before_json,
         event_trigger_catalog_before_sha256,event_trigger_catalog_before_count,install_request_json,install_request_sha256)
       values(true,'request-074',$1,'content_migration','content_owner','content_app','content_operator','content_cleanup',
         $1,$1,$1,$1,'{"contractVersion":"ai-content-event-trigger-catalog.v2","eventTriggers":[]}'::jsonb,$1,0,'{}'::jsonb,$1)`,
      ["a".repeat(64)],
    );
    await assert.rejects(database.query(
      `select prepare_ai_content_cutover($1,'content_owner','content_app','content_operator','content_app','content_cleanup',
         $2,$2,$2,'backup',now(),$2,$2,'{}'::jsonb,$2,$3,$2)`,
      [randomUUID(), "b".repeat(64), "c".repeat(40)],
    ), /ai_content_cutover_roles_not_sealed/);
  });
});

test("074 canonical authorization hashes are recomputed from the live PostgreSQL catalogs", async () => {
  const migrations = await loadMigrations();
  await withDatabase(async (database) => {
    await runMigrationRange(database, migrations, "001_initial_schema.sql", legacyTriggerSearchPathMigrationId);
    await database.exec(`
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
    for (const relation of bootstrapFenceRelations) {
      await database.exec(`alter table public."${relation}" owner to content_schema_owner`);
    }
    await database.exec("set session authorization content_migration; set search_path=public,pg_catalog,pg_temp");
    const catalogs = await readCanonicalBootstrapCatalogs({
      query: (sql, parameters = []) => database.query(sql, parameters),
    }, {
      schemaOwnerRoleName: "content_schema_owner",
      applicationRoleName: "content_application",
      operatorRoleName: "content_operator",
      migrationRoleName: "content_migration",
      cleanupRoleName: "content_cleanup",
    });
    assert.equal(catalogs.roleRows.length, 5);
    assert.equal(catalogs.objectRows.length, 44);
    assert.equal(catalogs.membershipEdges.length, 1);
    assert.deepEqual(catalogs.membershipEdges[0], {
      member_role_name: "content_migration", parent_role_name: "content_schema_owner",
      set_option: true, inherit_option: false, admin_option: false,
    });
    assert.equal(catalogs.roleCatalogSha256, "e4ba37a8732ded18b8ccf21766059600062ef24a3eaafa3e5b627cd990793d6b");
    assert.equal(catalogs.objectCatalogSha256, "e0a668cd048d07833651f3b6607351a001291b39b80e4e5f3f8d469351b6a788");
    for (const row of catalogs.objectRows) {
      assert.equal(row.relation_persistence, "p", row.relation_name);
      assert.equal(row.is_partition, false, row.relation_name);
      assert.equal(row.partition_bound, null, row.relation_name);
      assert.deepEqual(row.inheritance_parents, [], row.relation_name);
      assert.ok(row.internal_constraint_triggers.every((trigger) => trigger.enabled !== "D"));
    }
    assert.ok(catalogs.objectRows.some((row) => row.internal_constraint_triggers.length > 0));
    const sealedObjects = JSON.parse(canonicalBootstrapObjectCatalog(catalogs.objectRows)).objects;
    const topicUploadsTrigger = sealedObjects
      .find((row) => row.relationName === "topic_uploads")
      ?.triggers.find((trigger) => trigger.functionIdentity === "public.set_updated_at()");
    assert.deepEqual(topicUploadsTrigger?.functionCatalog?.config, ["search_path=pg_catalog,public,pg_temp"]);
    const avatarDependency = sealedObjects
      .flatMap((row) => row.triggers)
      .flatMap((trigger) => trigger.functionCatalog.dependencyFunctions)
      .find((dependency) => dependency.identity === "public.revoke_ai_content_one_time_avatar_receipt(uuid,text)");
    assert.deepEqual(avatarDependency?.config, ["search_path=pg_catalog,public,pg_temp"]);
    await database.exec("set role content_schema_owner; alter table public.topic_uploads replica identity full; reset role");
    const replicaIdentityDrift = await readCanonicalBootstrapCatalogs({
      query: (sql, parameters = []) => database.query(sql, parameters),
    }, {
      schemaOwnerRoleName: "content_schema_owner", applicationRoleName: "content_application",
      operatorRoleName: "content_operator", migrationRoleName: "content_migration",
      cleanupRoleName: "content_cleanup",
    });
    assert.notEqual(replicaIdentityDrift.objectCatalogSha256, catalogs.objectCatalogSha256);
    await database.exec("set role content_schema_owner; alter table public.topic_uploads replica identity default; alter table public.ai_content_attachment_storage_path_guards set unlogged; reset role");
    await assert.rejects(readCanonicalBootstrapCatalogs({
      query: (sql, parameters = []) => database.query(sql, parameters),
    }, {
      schemaOwnerRoleName: "content_schema_owner", applicationRoleName: "content_application",
      operatorRoleName: "content_operator", migrationRoleName: "content_migration",
      cleanupRoleName: "content_cleanup",
    }), /bootstrap_object_catalog_invalid:ai_content_attachment_storage_path_guards/);
    await database.exec("set role content_schema_owner; alter table public.ai_content_attachment_storage_path_guards set logged; reset role");
    const internalConstraintTrigger = (await database.query(`
      select relation.relname as relation_name,trigger.tgname as trigger_name
        from pg_trigger trigger
        join pg_class relation on relation.oid=trigger.tgrelid
       where trigger.tgisinternal and trigger.tgconstraint<>0
         and relation.relname=any($1::text[])
       order by relation.relname,trigger.tgname limit 1
    `, [bootstrapFenceRelations])).rows[0];
    assert.ok(internalConstraintTrigger);
    const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
    await database.exec(`set session authorization postgres; alter table public.${quoteIdentifier(internalConstraintTrigger.relation_name)}
      disable trigger ${quoteIdentifier(internalConstraintTrigger.trigger_name)};
      set session authorization content_migration; set search_path=public,pg_catalog,pg_temp`);
    await assert.rejects(readCanonicalBootstrapCatalogs({
      query: (sql, parameters = []) => database.query(sql, parameters),
    }, {
      schemaOwnerRoleName: "content_schema_owner", applicationRoleName: "content_application",
      operatorRoleName: "content_operator", migrationRoleName: "content_migration",
      cleanupRoleName: "content_cleanup",
    }), /bootstrap_object_catalog_invalid/);
    await database.exec(`set session authorization postgres; alter table public.${quoteIdentifier(internalConstraintTrigger.relation_name)}
      enable trigger ${quoteIdentifier(internalConstraintTrigger.trigger_name)};
      set session authorization content_migration; set search_path=public,pg_catalog,pg_temp`);
    const originalSetUpdatedAtDefinition = (await database.query(
      "select pg_get_functiondef('public.set_updated_at()'::regprocedure) as definition",
    )).rows[0].definition;
    await database.exec(`set session authorization postgres; create or replace function public.set_updated_at() returns trigger
      language plpgsql as $$ begin return new; end; $$;
      set session authorization content_migration; set search_path=public,pg_catalog,pg_temp`);
    const triggerFunctionDriftCatalogs = await readCanonicalBootstrapCatalogs({
      query: (sql, parameters = []) => database.query(sql, parameters),
    }, {
      schemaOwnerRoleName: "content_schema_owner",
      applicationRoleName: "content_application",
      operatorRoleName: "content_operator",
      migrationRoleName: "content_migration",
      cleanupRoleName: "content_cleanup",
    });
    assert.notEqual(triggerFunctionDriftCatalogs.objectCatalogSha256, catalogs.objectCatalogSha256);
    await database.exec(`set session authorization postgres; ${originalSetUpdatedAtDefinition};
      set session authorization content_migration; set search_path=public,pg_catalog,pg_temp`);
    const restoredTriggerFunctionCatalogs = await readCanonicalBootstrapCatalogs({
      query: (sql, parameters = []) => database.query(sql, parameters),
    }, {
      schemaOwnerRoleName: "content_schema_owner",
      applicationRoleName: "content_application",
      operatorRoleName: "content_operator",
      migrationRoleName: "content_migration",
      cleanupRoleName: "content_cleanup",
    });
    assert.equal(restoredTriggerFunctionCatalogs.objectCatalogSha256, catalogs.objectCatalogSha256);
    const originalAvatarRevocationDefinition = (await database.query(
      "select pg_get_functiondef('public.revoke_ai_content_one_time_avatar_receipt(uuid,text)'::regprocedure) as definition",
    )).rows[0].definition;
    await database.exec(`set session authorization postgres; create or replace function public.revoke_ai_content_one_time_avatar_receipt(
      target_receipt_id uuid,target_reason text)
      returns uuid language plpgsql as $$ begin return null; end; $$;
      set session authorization content_migration; set search_path=public,pg_catalog,pg_temp`);
    const dependencyFunctionDriftCatalogs = await readCanonicalBootstrapCatalogs({
      query: (sql, parameters = []) => database.query(sql, parameters),
    }, {
      schemaOwnerRoleName: "content_schema_owner",
      applicationRoleName: "content_application",
      operatorRoleName: "content_operator",
      migrationRoleName: "content_migration",
      cleanupRoleName: "content_cleanup",
    });
    assert.notEqual(dependencyFunctionDriftCatalogs.objectCatalogSha256, catalogs.objectCatalogSha256);
    await database.exec(`set session authorization postgres; ${originalAvatarRevocationDefinition};
      set session authorization content_migration; set search_path=public,pg_catalog,pg_temp`);
    const restoredDependencyFunctionCatalogs = await readCanonicalBootstrapCatalogs({
      query: (sql, parameters = []) => database.query(sql, parameters),
    }, {
      schemaOwnerRoleName: "content_schema_owner",
      applicationRoleName: "content_application",
      operatorRoleName: "content_operator",
      migrationRoleName: "content_migration",
      cleanupRoleName: "content_cleanup",
    });
    assert.equal(restoredDependencyFunctionCatalogs.objectCatalogSha256, catalogs.objectCatalogSha256);
    await database.exec("set role content_schema_owner; grant update on table public.topic_uploads to public; reset role");
    const tableGrantCatalogs = await readCanonicalBootstrapCatalogs({
      query: (sql, parameters = []) => database.query(sql, parameters),
    }, {
      schemaOwnerRoleName: "content_schema_owner",
      applicationRoleName: "content_application",
      operatorRoleName: "content_operator",
      migrationRoleName: "content_migration",
      cleanupRoleName: "content_cleanup",
    });
    assert.notEqual(tableGrantCatalogs.objectCatalogSha256, catalogs.objectCatalogSha256);
    assert.ok(
      tableGrantCatalogs.objectRows.find((row) => row.relation_name === "topic_uploads")
        .acl.some((item) => item.grantee === "PUBLIC" && item.privilege === "UPDATE" && item.grantable === false),
    );
    await database.exec("set role content_schema_owner; revoke update on table public.topic_uploads from public; reset role");
    assert.equal((await readCanonicalBootstrapCatalogs({
      query: (sql, parameters = []) => database.query(sql, parameters),
    }, {
      schemaOwnerRoleName: "content_schema_owner",
      applicationRoleName: "content_application",
      operatorRoleName: "content_operator",
      migrationRoleName: "content_migration",
      cleanupRoleName: "content_cleanup",
    })).objectCatalogSha256, catalogs.objectCatalogSha256);
    await database.exec("set role content_schema_owner; grant update(file_name) on table public.topic_uploads to content_application; reset role");
    const columnGrantCatalogs = await readCanonicalBootstrapCatalogs({
      query: (sql, parameters = []) => database.query(sql, parameters),
    }, {
      schemaOwnerRoleName: "content_schema_owner",
      applicationRoleName: "content_application",
      operatorRoleName: "content_operator",
      migrationRoleName: "content_migration",
      cleanupRoleName: "content_cleanup",
    });
    assert.notEqual(columnGrantCatalogs.objectCatalogSha256, catalogs.objectCatalogSha256);
    assert.deepEqual(
      columnGrantCatalogs.objectRows.find((row) => row.relation_name === "topic_uploads")
        .columns.find((column) => column.column_name === "file_name").acl,
      [{ grantee: "content_application", privilege: "UPDATE", grantable: false }],
    );
    await database.exec("set role content_schema_owner; revoke update(file_name) on table public.topic_uploads from content_application; reset role");
    assert.equal((await readCanonicalBootstrapCatalogs({
      query: (sql, parameters = []) => database.query(sql, parameters),
    }, {
      schemaOwnerRoleName: "content_schema_owner",
      applicationRoleName: "content_application",
      operatorRoleName: "content_operator",
      migrationRoleName: "content_migration",
      cleanupRoleName: "content_cleanup",
    })).objectCatalogSha256, catalogs.objectCatalogSha256);
    const assertRoleBoundaryRejected = async (pattern = /bootstrap_role_/) => assert.rejects(
      readCanonicalBootstrapCatalogs({ query: (sql, parameters = []) => database.query(sql, parameters) }, {
        schemaOwnerRoleName: "content_schema_owner", applicationRoleName: "content_application",
        operatorRoleName: "content_operator", migrationRoleName: "content_migration",
        cleanupRoleName: "content_cleanup",
      }),
      pattern,
    );
    await database.exec("set session authorization postgres; alter role content_application set search_path=public; set session authorization content_migration; set search_path=public,pg_catalog,pg_temp");
    await assertRoleBoundaryRejected(/bootstrap_role_catalog_invalid/);
    await database.exec("set session authorization postgres; alter role content_application set search_path=pg_catalog,public,pg_temp; set session authorization content_migration; set search_path=public,pg_catalog,pg_temp");
    const databaseName = (await database.query("select current_database() as name")).rows[0].name;
    await database.exec(`set session authorization postgres; alter role content_application in database ${quoteIdentifier(databaseName)} set statement_timeout='1s'; set session authorization content_migration; set search_path=public,pg_catalog,pg_temp`);
    await assertRoleBoundaryRejected(/bootstrap_role_database_settings_invalid/);
    await database.exec(`set session authorization postgres; alter role content_application in database ${quoteIdentifier(databaseName)} reset statement_timeout; set session authorization content_migration; set search_path=public,pg_catalog,pg_temp`);
    await database.exec("set session authorization postgres; grant usage on schema public to public; set session authorization content_migration; set search_path=public,pg_catalog,pg_temp");
    await assertRoleBoundaryRejected(/bootstrap_role_public_schema_acl_invalid/);
    await database.exec("set session authorization postgres; revoke usage on schema public from public; alter schema public owner to content_schema_owner; set session authorization content_migration; set search_path=public,pg_catalog,pg_temp");
    await assertRoleBoundaryRejected(/bootstrap_role_database_boundary_invalid/);
    await database.exec("set session authorization postgres; alter schema public owner to pg_database_owner; set session authorization content_migration; set search_path=public,pg_catalog,pg_temp");
    await database.exec("set session authorization postgres; grant content_schema_owner to content_application; set session authorization content_migration; set search_path=public,pg_catalog,pg_temp");
    await assert.rejects(readCanonicalBootstrapCatalogs({
      query: (sql, parameters = []) => database.query(sql, parameters),
    }, {
      schemaOwnerRoleName: "content_schema_owner",
      applicationRoleName: "content_application",
      operatorRoleName: "content_operator",
      migrationRoleName: "content_migration",
      cleanupRoleName: "content_cleanup",
    }), /bootstrap_role_catalog_invalid/);
  });
});

test("074 post-migration security catalog is independently read from live PostgreSQL catalogs", async () => {
  const migrations = await loadMigrations();
  const migration074 = migrations.find((migration) => migration.id === "074_ai_content_maintenance_write_fence.sql");
  assert.ok(migration074);
  await withDatabase(async (database) => {
    await runMigrationRange(database, migrations, "001_initial_schema.sql", "073_ai_content_generation_v2_render_pipeline.sql");
    await database.exec(`
      create role content_schema_owner nologin;
      create role content_application login;
      create role content_operator login;
      create role content_migration login noinherit;
      create role content_cleanup login;
      grant content_schema_owner to content_migration with set true;
      grant content_schema_owner to content_migration with inherit false;
      grant content_schema_owner to content_migration with admin false;
      grant usage,create on schema public to content_schema_owner;
    `);
    for (const relation of bootstrapFenceRelations) await database.exec(`alter table public."${relation}" owner to content_schema_owner`);
    const topicUploadsAcl = async () => (await database.query(`
      select case acl.grantee when 0 then 'PUBLIC' else grantee.rolname end as grantee,
             acl.privilege_type as privilege,acl.is_grantable as grantable
        from pg_class relation
        cross join lateral aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) acl
        left join pg_roles grantee on grantee.oid=acl.grantee
       where relation.oid='public.topic_uploads'::regclass
       order by (case acl.grantee when 0 then 'PUBLIC' else grantee.rolname end) collate "C",
                acl.privilege_type collate "C"
    `)).rows;
    const topicUploadsAclBefore074 = await topicUploadsAcl();
    await database.exec(`set role content_schema_owner; ${migration074.sql} reset role;`);
    assert.deepEqual(await topicUploadsAcl(), topicUploadsAclBefore074,
      "074 managed fence installation must not mutate customer relation ACLs");
    await database.exec(`
      revoke all on table ai_content_cutovers,ai_content_cutover_status_events,ai_content_maintenance_state,ai_content_bootstrap_state,ai_content_ddl_allowlist,ai_content_write_fence_catalog from content_application;
      grant select on table ai_content_maintenance_state to content_application;
      grant execute on function assert_ai_content_writable() to content_application;
      grant execute on function prepare_ai_content_cutover(uuid,name,name,name,name,name,text,text,text,text,timestamptz,text,text,jsonb,text,text,text),set_ai_content_maintenance(uuid,boolean),transition_ai_content_cutover_status(uuid,text,text,text,text,uuid,timestamptz,text,text) to content_operator;
      grant select on table ai_content_bootstrap_state,ai_content_ddl_allowlist,ai_content_write_fence_catalog to content_migration;
      grant execute on function ai_content_cutover_bypass_allowed(),lock_ai_content_cutover_transaction_state(uuid),verify_ai_content_cutover_preflight_identity(uuid,jsonb,text,text),verify_ai_content_write_fence_catalog(),consume_ai_content_provider_attestation(),read_ai_content_cutover_migration_body_evidence(uuid),register_ai_content_075_fence_relations(),transition_ai_content_cutover_status(uuid,text,text,text,text,uuid,timestamptz,text,text) to content_migration;
      grant execute on function register_ai_content_075_fence_relations() to content_schema_owner;
    `);
    const names = { schemaOwnerRoleName: "content_schema_owner", applicationRoleName: "content_application", operatorRoleName: "content_operator", migrationRoleName: "content_migration", cleanupRoleName: "content_cleanup" };
    const catalog = await readFenceSecurityCatalog({ query: (sql, parameters = []) => database.query(sql, parameters) }, names);
    assert.match(catalog.catalogSha256, /^[0-9a-f]{64}$/);
    assert.equal(catalog.ordinaryTriggers.length, 44);
    const eventCatalog = await readCanonicalEventTriggerCatalog({ query: (sql, parameters = []) => database.query(sql, parameters) });
    assert.equal(eventCatalog.count, 0);
    await database.exec("alter function assert_ai_content_writable() set search_path=public");
    await assert.rejects(readFenceSecurityCatalog({ query: (sql, parameters = []) => database.query(sql, parameters) }, names), /bootstrap_074_fence_security_function_mismatch/);
  });
});

const createPgliteMigrationClient = (database) => ({
  async query(sql, parameters = []) {
    const normalized = sql.trim().toLowerCase();
    if (normalized.startsWith("select pg_advisory_lock")) return { rows: [{ pg_advisory_lock: null }] };
    if (normalized.startsWith("select pg_advisory_unlock")) return { rows: [{ pg_advisory_unlock: null }] };
    if (parameters.length || normalized.startsWith("select ")) {
      return database.query(sql, parameters);
    }
    await database.exec(sql);
    return { rows: [], rowCount: 0 };
  },
});

const insertPublishingFixture = async (database) => {
  const deliveryFormatColumn = await database.query(`
    select is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'channel_outputs'
      and column_name = 'delivery_format'
  `);
  const deliveryFormatRequired =
    deliveryFormatColumn.rows[0]?.is_nullable === "NO";
  const topicPublishGroupColumn = await database.query(`
    select is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'publish_queue'
      and column_name = 'topic_publish_group_id'
  `);
  const topicPublishGroupRequired =
    topicPublishGroupColumn.rows[0]?.is_nullable === "NO";

  const workspace = await database.query(
    "insert into workspaces (name, slug) values ($1, $2) returning id",
    ["Migration Test", `migration-${randomUUID()}`],
  );
  const workspaceId = workspace.rows[0].id;
  const brand = await database.query(
    "insert into brands (workspace_id, name) values ($1, $2) returning id",
    [workspaceId, "Migration Brand"],
  );
  const brandId = brand.rows[0].id;
  await database.query(
    "insert into brand_profiles (workspace_id, brand_id) values ($1, $2)",
    [workspaceId, brandId],
  );

  const brandChannels = new Map();
  for (const channel of ["instagram", "threads"]) {
    const result = await database.query(
      "insert into brand_channels (workspace_id, brand_id, channel, status) values ($1, $2, $3, 'connected') returning id",
      [workspaceId, brandId, channel],
    );
    brandChannels.set(channel, result.rows[0].id);
  }

  const createTopic = async (title, queueFixtures) => {
    const topic = await database.query(
      "insert into content_topics (workspace_id, brand_id, title, angle) values ($1, $2, $3, $4) returning id",
      [workspaceId, brandId, title, `${title} angle`],
    );
    const topicId = topic.rows[0].id;
    const topicPublishGroupId = topicPublishGroupRequired
      ? (
          await database.query(
            "insert into topic_publish_groups (workspace_id, brand_id, content_topic_id) values ($1, $2, $3) returning id",
            [workspaceId, brandId, topicId],
          )
        ).rows[0].id
      : null;
    const draft = await database.query(
      "insert into master_drafts (workspace_id, brand_id, content_topic_id, prompt_version) values ($1, $2, $3, $4) returning id",
      [workspaceId, brandId, topicId, "integration-v1"],
    );
    const outputIds = new Map();
    const queueIds = [];

    for (const fixture of queueFixtures) {
      const outputValues = [
        workspaceId,
        brandId,
        topicId,
        draft.rows[0].id,
        fixture.channel,
        `${title} ${fixture.channel}`,
      ];
      const output = deliveryFormatRequired
        ? await database.query(
            "insert into channel_outputs (workspace_id, brand_id, content_topic_id, master_draft_id, channel, status, title, delivery_format) values ($1, $2, $3, $4, $5, 'approved', $6, $7) returning id",
            [
              ...outputValues,
              fixture.channel === "instagram"
                ? "instagram_feed_carousel"
                : "threads_text",
            ],
          )
        : await database.query(
            "insert into channel_outputs (workspace_id, brand_id, content_topic_id, master_draft_id, channel, status, title) values ($1, $2, $3, $4, $5, 'approved', $6) returning id",
            outputValues,
      );
      outputIds.set(fixture.channel, output.rows[0].id);
      const queueValues = [
        workspaceId,
        brandId,
        output.rows[0].id,
        brandChannels.get(fixture.channel),
        fixture.channel,
        fixture.status ?? "scheduled",
        fixture.slotDate,
        fixture.slotNumber,
        fixture.scheduledFor,
        fixture.queuedAt,
        `${title}-${fixture.channel}-${randomUUID()}`,
      ];
      const queue = topicPublishGroupRequired
        ? await database.query(
            "insert into publish_queue (workspace_id, brand_id, channel_output_id, brand_channel_id, channel, status, approval_type, slot_date, slot_number, scheduled_for, queued_at, idempotency_key, topic_publish_group_id) values ($1, $2, $3, $4, $5, $6, 'manual', $7, $8, $9, $10, $11, $12) returning id",
            [...queueValues, topicPublishGroupId],
          )
        : await database.query(
            "insert into publish_queue (workspace_id, brand_id, channel_output_id, brand_channel_id, channel, status, approval_type, slot_date, slot_number, scheduled_for, queued_at, idempotency_key) values ($1, $2, $3, $4, $5, $6, 'manual', $7, $8, $9, $10, $11) returning id",
            queueValues,
          );
      queueIds.push(queue.rows[0].id);
      if (fixture.createPublishAttempt) {
        await database.query(
          "insert into publish_attempts (workspace_id, brand_id, publish_queue_id, attempt_number, status) values ($1, $2, $3, 1, 'succeeded')",
          [workspaceId, brandId, queue.rows[0].id],
        );
      }
    }

    return { topicId, outputIds, queueIds };
  };

  const primary = await createTopic("Primary topic", [
    {
      channel: "instagram",
      slotDate: "2026-02-02",
      slotNumber: 4,
      scheduledFor: "2026-01-01T00:00:00.000Z",
      queuedAt: "2026-01-03T00:00:00.000Z",
    },
    {
      channel: "threads",
      slotDate: "2026-01-01",
      slotNumber: 1,
      scheduledFor: "2026-01-02T00:00:00.000Z",
      queuedAt: "2026-01-02T00:00:00.000Z",
    },
  ]);
  await createTopic("Duplicate topic", [
    {
      channel: "instagram",
      status: "published",
      slotDate: "2026-01-15",
      slotNumber: 2,
      scheduledFor: "2025-12-31T00:00:00.000Z",
      queuedAt: "2026-01-03T00:00:00.000Z",
      createPublishAttempt: true,
    },
    {
      channel: "threads",
      slotDate: "2026-02-02",
      slotNumber: 4,
      scheduledFor: "2026-01-05T00:00:00.000Z",
      queuedAt: "2026-01-04T00:00:00.000Z",
    },
  ]);

  const jobsTypeConstraint = await database.query(`
    select pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conrelid = 'jobs'::regclass
      and conname = 'jobs_type_check'
  `);
  const instagramRenderJobType = jobsTypeConstraint.rows[0]?.definition.includes(
    "'instagram_feed_render'",
  )
    ? "instagram_feed_render"
    : "instagram_render";
  await database.query(
    "insert into jobs (workspace_id, brand_id, channel_output_id, job_type) values ($1, $2, $3, $4)",
    [
      workspaceId,
      brandId,
      primary.outputIds.get("instagram"),
      instagramRenderJobType,
    ],
  );
  await database.query(
    "insert into storage_artifacts (workspace_id, brand_id, artifact_type, bucket, path) values ($1, $2, 'rendered_image', $3, $4)",
    [
      workspaceId,
      brandId,
      "migration-test",
      `rendered/${randomUUID()}.png`,
    ],
  );

  return {
    workspaceId,
    brandId,
    channelOutputId: primary.outputIds.get("instagram"),
    publishQueueId: primary.queueIds[0],
  };
};

const readConstraintValues = async (database, table, constraint) => {
  const result = await database.query(
    "select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = to_regclass($1) and conname = $2",
    [table, constraint],
  );
  assert.equal(result.rows.length, 1);
  return [...result.rows[0].definition.matchAll(/'([^']+)'::text/g)]
    .map((match) => match[1])
    .sort();
};

const readSnapshot = async (database, brandId) => {
  const brandFormats = await database.query(
    "select format, enabled, rotation_order, capability_status from brand_content_formats where brand_id = $1 order by rotation_order",
    [brandId],
  );
  const rotationState = await database.query(
    "select count(*)::int as count, count(*) filter (where last_selected_format is null)::int as null_count from brand_format_rotation_states where brand_id = $1",
    [brandId],
  );
  const selectedFormatColumn = await database.query(
    "select count(*)::int as count from information_schema.columns where table_name = 'content_topics' and column_name = 'selected_instagram_format'",
  );
  const groups = await database.query(
    `select
       topics.title,
       groups.status,
       to_char(groups.slot_date, 'YYYY-MM-DD') as slot_date,
       groups.slot_number,
       to_char(groups.scheduled_for at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as scheduled_for
     from topic_publish_groups groups
     join content_topics topics on topics.id = groups.content_topic_id
     order by topics.title`,
  );
  const queueLinks = await database.query(
    "select count(*)::int as queue_count, count(topic_publish_group_id)::int as linked_count, count(distinct topic_publish_group_id)::int as group_count from publish_queue",
  );
  const jobRows = await database.query(
    "select job_type, count(*)::int as count from jobs group by job_type order by job_type",
  );
  const renderIndexes = await database.query(
    `select
       index_class.relname as name,
       index_data.indisunique as is_unique,
       regexp_replace(pg_get_expr(index_data.indpred, index_data.indrelid), '\\s+', ' ', 'g') as predicate
     from pg_index index_data
     join pg_class index_class on index_class.oid = index_data.indexrelid
     where index_data.indrelid = 'jobs'::regclass
       and index_class.relname in (
         'jobs_render_output_idx',
         'jobs_active_render_output_unique',
         'jobs_threads_text_render_output_idx',
         'jobs_active_threads_text_render_output_unique'
       )
     order by index_class.relname`,
  );
  const artifactRows = await database.query(
    "select artifact_type, count(*)::int as count from storage_artifacts group by artifact_type order by artifact_type",
  );
  const attemptRows = await database.query(
    "select count(*)::int as count from publish_attempts",
  );

  return {
    deliveryConstraint: await readConstraintValues(
      database,
      "channel_outputs",
      "channel_outputs_delivery_format_check",
    ),
    brandFormats: brandFormats.rows,
    rotationState: rotationState.rows[0],
    selectedFormatColumn: selectedFormatColumn.rows[0],
    selectedFormatConstraint: await readConstraintValues(
      database,
      "content_topics",
      "content_topics_selected_instagram_format_check",
    ),
    groups: groups.rows,
    queueLinks: queueLinks.rows[0],
    jobsConstraint: await readConstraintValues(database, "jobs", "jobs_type_check"),
    jobRows: jobRows.rows,
    renderIndexes: renderIndexes.rows,
    artifactsConstraint: await readConstraintValues(
      database,
      "storage_artifacts",
      "storage_artifacts_type_check",
    ),
    artifactRows: artifactRows.rows,
    attemptRows: attemptRows.rows[0],
  };
};

const readGroupUpdatedAt = async (database) => {
  const result = await database.query(
    `select topics.title, groups.updated_at::text as updated_at
     from topic_publish_groups groups
     join content_topics topics on topics.id = groups.content_topic_id
     order by topics.title`,
  );
  return result.rows;
};

test("fresh and authentic legacy paths converge after migration 019", async (context) => {
  const migrations = await loadMigrations();
  let freshSnapshot;

  await context.test("fresh path executes migrations 001-019", async () => {
    freshSnapshot = await withDatabase(async (database) => {
      await runMigrationRange(
        database,
        migrations,
        "001_initial_schema.sql",
        "013_automation_runs.sql",
      );
      const fixture = await insertPublishingFixture(database);
      await runMigrationRange(
        database,
        migrations,
        "014_instagram_delivery_formats.sql",
        "019_threads_text_render_jobs.sql",
      );
      const snapshot = await readSnapshot(database, fixture.brandId);
      const migration017 = migrations.find(
        (migration) => migration.id === "017_preserve_topic_publish_group_status.sql",
      );
      if (migration017) {
        const updatedAtBefore = await readGroupUpdatedAt(database);
        await new Promise((resolve) => setTimeout(resolve, 20));
        await database.exec(migration017.sql);
        assert.deepEqual(await readGroupUpdatedAt(database), updatedAtBefore);
        assert.deepEqual(await readSnapshot(database, fixture.brandId), snapshot);
      }
      return snapshot;
    });
  });

  await context.test(
    "legacy path executes the authentic 014 fixture followed by 015 through 019",
    async () => {
      const legacySnapshot = await withDatabase(async (database) => {
        await runMigrationRange(
          database,
          migrations,
          "001_initial_schema.sql",
          "013_automation_runs.sql",
        );
        const fixture = await insertPublishingFixture(database);
        await database.exec(legacyInstagramDeliverySql);
        await runMigrationRange(
          database,
          migrations,
          "015_delivery_format_legacy_channels.sql",
          "019_threads_text_render_jobs.sql",
        );
        return readSnapshot(database, fixture.brandId);
      });

      assert.deepEqual(legacySnapshot, freshSnapshot);
    },
  );

  assert.deepEqual(freshSnapshot.groups, [
    {
      title: "Duplicate topic",
      status: "partially_published",
      slot_date: null,
      slot_number: null,
      scheduled_for: null,
    },
    {
      title: "Primary topic",
      status: "scheduled",
      slot_date: "2026-02-02",
      slot_number: 4,
      scheduled_for: "2026-01-01T00:00:00Z",
    },
  ]);
  assert.deepEqual(freshSnapshot.queueLinks, {
    queue_count: 4,
    linked_count: 4,
    group_count: 2,
  });
  assert.deepEqual(freshSnapshot.attemptRows, { count: 1 });
  assert.ok(freshSnapshot.jobsConstraint.includes("threads_text_render"));
  assert.ok(freshSnapshot.renderIndexes.some(({ name }) => name === "jobs_threads_text_render_output_idx"));
  assert.ok(freshSnapshot.renderIndexes.some(({ name, is_unique }) => (
    name === "jobs_active_threads_text_render_output_unique" && is_unique
  )));
});

test("DM Wiki core migration runs in PGlite and pgvector migration is explicitly deferred", async () => {
  const migrations = await loadMigrations();
  const coreMigration = migrations.find((migration) => migration.id === "020_dm_wiki_core.sql");
  const vectorMigration = migrations.find((migration) => migration.id === "021_dm_wiki_pgvector.sql");
  const instagramLoginMigration = migrations.find((migration) => migration.id === "022_instagram_login_auth_mode.sql");

  assert.ok(coreMigration);
  assert.ok(vectorMigration);
  assert.ok(instagramLoginMigration);
  assert.match(vectorMigration.sql, /^-- requires: pgvector/);
  assert.match(vectorMigration.sql, /vector\(1536\)/);
  assert.match(vectorMigration.sql, /using hnsw/);
  assert.match(vectorMigration.sql, /search_brand_wiki/);

  await withDatabase(async (database) => {
    await runMigrationRange(database, migrations, "001_initial_schema.sql", "022_instagram_login_auth_mode.sql");
    const tables = await database.query(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name in ('knowledge_imports', 'knowledge_entries', 'wiki_documents', 'wiki_chunks', 'instagram_dm_settings', 'instagram_dm_conversations', 'instagram_dm_messages', 'unanswered_questions', 'worker_instances') order by table_name",
    );
    assert.equal(tables.rows.length, 9);
    const jobsConstraint = await readConstraintValues(database, "jobs", "jobs_type_check");
    assert.ok(jobsConstraint.includes("wiki_refresh"));
    assert.ok(jobsConstraint.includes("instagram_dm_reply"));
    const authMode = await database.query("select column_name from information_schema.columns where table_name = 'channel_credentials' and column_name = 'auth_mode'");
    assert.equal(authMode.rows.length, 1);
  });
});

test("brand profile logo migration adds nullable storage columns and remains idempotent", async () => {
  const migrations = await loadMigrations();
  const initialMigration = migrations.find((migration) => migration.id === "001_initial_schema.sql");
  const logoMigration = migrations.find((migration) => migration.id === "028_brand_profile_logo.sql");

  assert.ok(initialMigration);
  assert.ok(logoMigration);

  await withDatabase(async (database) => {
    await database.exec(initialMigration.sql);
    await database.exec(logoMigration.sql);
    await database.exec(logoMigration.sql);

    const columns = await database.query(
      `select column_name, is_nullable
       from information_schema.columns
       where table_name = 'brand_profiles'
         and column_name in ('logo_url', 'logo_storage_path')
       order by column_name`,
    );
    assert.deepEqual(columns.rows, [
      { column_name: "logo_storage_path", is_nullable: "YES" },
      { column_name: "logo_url", is_nullable: "YES" },
    ]);
  });
});

test("029-031 migrations satisfy the expanded schema smoke contract", async () => {
  const migrations = await loadMigrations();
  const migration029 = migrations.find(
    (migration) => migration.id === "029_instagram_hashtag_trends.sql",
  );
  const migration030 = migrations.find(
    (migration) => migration.id === "030_multichannel_foundation.sql",
  );
  const migration031 = migrations.find(
    (migration) => migration.id === "031_content_performance_dashboard.sql",
  );

  assert.ok(migration029, "missing migration 029_instagram_hashtag_trends.sql");
  assert.ok(migration030, "missing migration 030_multichannel_foundation.sql");
  assert.ok(migration031, "missing migration 031_content_performance_dashboard.sql");

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "028_brand_profile_logo.sql",
    );

    const legacyProfiles = [];
    for (const industry of ["금융 및 보험업", "서비스", "여행 서비스"]) {
      const workspace = await database.query(
        "insert into workspaces (name, slug) values ($1, $2) returning id",
        [`Legacy ${industry}`, `legacy-${randomUUID()}`],
      );
      const brand = await database.query(
        "insert into brands (workspace_id, name) values ($1, $2) returning id",
        [workspace.rows[0].id, `Legacy ${industry}`],
      );
      const profile = await database.query(
        "insert into brand_profiles (workspace_id, brand_id, industry) values ($1, $2, $3) returning id",
        [workspace.rows[0].id, brand.rows[0].id, industry],
      );
      legacyProfiles.push({ id: profile.rows[0].id, industry });
    }

    await database.exec(migration029.sql);

    const counts = await database.query(`
      select
        (select count(*)::int from content_categories where active) as categories,
        (select count(*)::int from content_subcategories where active) as subcategories,
        (select count(*)::int from content_category_hashtags where active) as hashtags
    `);
    assert.deepEqual(counts.rows[0], {
      categories: 15,
      subcategories: 105,
      hashtags: 45,
    });

    const invalidSeedDistribution = await database.query(`
      select category.code
      from content_categories category
      left join content_subcategories subcategory
        on subcategory.category_id = category.id and subcategory.active
      left join content_category_hashtags hashtag
        on hashtag.category_id = category.id and hashtag.active
      where category.active
      group by category.code
      having count(distinct subcategory.id) <> 7
        or count(distinct hashtag.id) <> 3
    `);
    assert.deepEqual(invalidSeedDistribution.rows, []);

    const columns = await database.query(`
      select column_name
      from information_schema.columns
      where table_name = 'brand_profiles'
        and column_name in ('industry', 'primary_category_id')
      order by column_name
    `);
    assert.deepEqual(
      columns.rows.map((row) => row.column_name),
      ["industry", "primary_category_id"],
    );

    const expectedTables = [
      "brand_profile_subcategories",
      "brand_trend_saved_media",
      "brand_trend_searches",
      "content_categories",
      "content_category_hashtags",
      "content_subcategories",
      "instagram_trend_account_hashtags",
      "instagram_trend_hashtag_media",
      "instagram_trend_hashtags",
      "instagram_trend_media",
    ];
    const tables = await database.query(
      `select table_name
       from information_schema.tables
       where table_schema = 'public'
         and table_name = any($1::text[])
       order by table_name`,
      [expectedTables],
    );
    assert.deepEqual(
      tables.rows.map((row) => row.table_name),
      expectedTables,
    );

    const expectedIndexes = [
      "brand_profile_subcategories_brand_idx",
      "brand_profile_subcategories_custom_unique",
      "brand_profile_subcategories_system_unique",
      "brand_trend_saved_media_brand_idx",
      "brand_trend_searches_brand_searched_idx",
      "content_category_hashtags_unique",
      "instagram_trend_account_hashtags_channel_quota_idx",
    ];
    const indexes = await database.query(
      `select indexname
       from pg_indexes
       where schemaname = 'public'
         and indexname = any($1::text[])
       order by indexname`,
      [expectedIndexes],
    );
    assert.deepEqual(
      indexes.rows.map((row) => row.indexname),
      expectedIndexes,
    );

    const expectedConstraints = [
      "brand_channels_tenant_identity_unique",
      "brand_profile_subcategories_custom_name_check",
      "brand_profile_subcategories_mode_check",
      "brand_profile_subcategories_profile_owner_fkey",
      "brand_profiles_tenant_identity_unique",
      "brand_trend_saved_media_brand_id_trend_media_id_key",
      "brand_trend_saved_media_source_owner_fkey",
      "brand_trend_saved_media_source_url_id_key",
      "brand_trend_searches_brand_id_hashtag_id_key",
      "brand_trend_searches_brand_owner_fkey",
      "brand_trend_searches_search_count_check",
      "brands_tenant_identity_unique",
      "content_categories_code_key",
      "content_subcategories_category_id_code_key",
      "instagram_trend_account_hashtags_channel_hashtag_unique",
      "instagram_trend_account_hashtags_channel_owner_fkey",
      "instagram_trend_hashtag_media_hashtag_id_meta_rank_key",
      "instagram_trend_hashtag_media_meta_rank_check",
      "instagram_trend_hashtag_media_pkey",
      "instagram_trend_hashtags_normalized_tag_key",
      "instagram_trend_media_comments_count_check",
      "instagram_trend_media_instagram_media_id_key",
      "instagram_trend_media_like_count_check",
      "instagram_trend_media_media_type_check",
      "instagram_trend_media_raw_metadata_object_check",
      "source_urls_tenant_identity_unique",
    ];
    const constraints = await database.query(
      `select conname
       from pg_constraint
       where conname = any($1::text[])
       order by conname`,
      [expectedConstraints],
    );
    assert.deepEqual(
      constraints.rows.map((row) => row.conname),
      expectedConstraints,
    );

    const backfill = await database.query(
      `select profile.industry, category.code as category_code
       from brand_profiles profile
       left join content_categories category on category.id = profile.primary_category_id
       where profile.id = any($1::uuid[])
       order by profile.industry`,
      [legacyProfiles.map((profile) => profile.id)],
    );
    assert.deepEqual(backfill.rows, [
      { industry: "금융 및 보험업", category_code: "finance_insurance" },
      { industry: "서비스", category_code: null },
      { industry: "여행 서비스", category_code: null },
    ]);

    const fixture = await database.query(`
      with workspace as (
        insert into workspaces (name, slug)
        values ('Trend Test', 'trend-test-${randomUUID()}')
        returning id
      ), brand as (
        insert into brands (workspace_id, name)
        select id, 'Trend Test' from workspace
        returning id, workspace_id
      ), profile as (
        insert into brand_profiles (workspace_id, brand_id)
        select workspace_id, id from brand
        returning id, workspace_id, brand_id
      )
      select profile.id as profile_id,
             profile.workspace_id,
             profile.brand_id,
             subcategory.id as subcategory_id
      from profile
      cross join content_subcategories subcategory
      order by subcategory.sort_order, subcategory.id
      limit 1
    `);
    const fixtureRow = fixture.rows[0];

    const otherWorkspace = await database.query(
      "insert into workspaces (name, slug) values ('Other Tenant', $1) returning id",
      [`other-tenant-${randomUUID()}`],
    );
    const otherBrand = await database.query(
      "insert into brands (workspace_id, name) values ($1, 'Other Brand') returning id",
      [otherWorkspace.rows[0].id],
    );
    const otherProfile = await database.query(
      `insert into brand_profiles (workspace_id, brand_id)
       values ($1, $2) returning id`,
      [otherWorkspace.rows[0].id, otherBrand.rows[0].id],
    );
    const otherChannel = await database.query(
      `insert into brand_channels (workspace_id, brand_id, channel)
       values ($1, $2, 'instagram') returning id`,
      [otherWorkspace.rows[0].id, otherBrand.rows[0].id],
    );
    const otherSource = await database.query(
      `insert into source_urls
         (workspace_id, brand_id, source_type, url, url_hash)
       values ($1, $2, 'reference', $3, $4) returning id`,
      [
        otherWorkspace.rows[0].id,
        otherBrand.rows[0].id,
        `https://example.com/${randomUUID()}`,
        randomUUID(),
      ],
    );

    await assert.rejects(
      database.query(
        `insert into brand_profile_subcategories
           (workspace_id, brand_id, brand_profile_id, subcategory_id)
         values ($1, $2, $3, $4)`,
        [
          fixtureRow.workspace_id,
          fixtureRow.brand_id,
          otherProfile.rows[0].id,
          fixtureRow.subcategory_id,
        ],
      ),
      /brand_profile_subcategories_profile_owner_fkey/,
    );

    await database.query(
      `insert into brand_profile_subcategories
         (workspace_id, brand_id, brand_profile_id, subcategory_id)
       values ($1, $2, $3, $4)`,
      [
        fixtureRow.workspace_id,
        fixtureRow.brand_id,
        fixtureRow.profile_id,
        fixtureRow.subcategory_id,
      ],
    );
    await database.query(
      `insert into brand_profile_subcategories
         (workspace_id, brand_id, brand_profile_id, custom_name, custom_key)
       values ($1, $2, $3, '직접 입력', '직접 입력')`,
      [fixtureRow.workspace_id, fixtureRow.brand_id, fixtureRow.profile_id],
    );

    await assert.rejects(
      database.query(
        `insert into brand_profile_subcategories
           (workspace_id, brand_id, brand_profile_id, subcategory_id, custom_name, custom_key)
         values ($1, $2, $3, $4, '잘못된 입력', '잘못된 입력')`,
        [
          fixtureRow.workspace_id,
          fixtureRow.brand_id,
          fixtureRow.profile_id,
          fixtureRow.subcategory_id,
        ],
      ),
      /brand_profile_subcategories_mode_check/,
    );
    await assert.rejects(
      database.query(
        `insert into brand_profile_subcategories
           (workspace_id, brand_id, brand_profile_id)
         values ($1, $2, $3)`,
        [fixtureRow.workspace_id, fixtureRow.brand_id, fixtureRow.profile_id],
      ),
      /brand_profile_subcategories_mode_check/,
    );
    await assert.rejects(
      database.query(
        `insert into brand_profile_subcategories
           (workspace_id, brand_id, brand_profile_id, custom_name, custom_key)
         values ($1, $2, $3, '   ', 'blank')`,
        [fixtureRow.workspace_id, fixtureRow.brand_id, fixtureRow.profile_id],
      ),
      /brand_profile_subcategories_custom_name_check/,
    );
    await assert.rejects(
      database.query(
        `insert into brand_profile_subcategories
           (workspace_id, brand_id, brand_profile_id, custom_name, custom_key)
         values ($1, $2, $3, $4, 'too-long')`,
        [
          fixtureRow.workspace_id,
          fixtureRow.brand_id,
          fixtureRow.profile_id,
          "x".repeat(31),
        ],
      ),
      /brand_profile_subcategories_custom_name_check/,
    );

    const hashtag = await database.query(
      `insert into instagram_trend_hashtags (normalized_tag, display_tag)
       values ('trendtest', 'trendtest') returning id`,
    );
    const firstMedia = await database.query(
      `insert into instagram_trend_media
         (instagram_media_id, media_type, permalink, last_fetched_at)
       values ('meta-media-1', 'IMAGE', 'https://instagram.com/p/1', now())
       returning id`,
    );
    await assert.rejects(
      database.query(
        `insert into brand_trend_searches
           (workspace_id, brand_id, hashtag_id, last_searched_at)
         values ($1, $2, $3, now())`,
        [
          fixtureRow.workspace_id,
          otherBrand.rows[0].id,
          hashtag.rows[0].id,
        ],
      ),
      /brand_trend_searches_brand_owner_fkey/,
    );
    await assert.rejects(
      database.query(
        `insert into instagram_trend_account_hashtags
           (workspace_id, brand_id, brand_channel_id, hashtag_id,
            quota_window_started_at, last_meta_queried_at)
         values ($1, $2, $3, $4, now(), now())`,
        [
          fixtureRow.workspace_id,
          fixtureRow.brand_id,
          otherChannel.rows[0].id,
          hashtag.rows[0].id,
        ],
      ),
      /instagram_trend_account_hashtags_channel_owner_fkey/,
    );
    await assert.rejects(
      database.query(
        `insert into brand_trend_saved_media
           (workspace_id, brand_id, trend_media_id, source_url_id)
         values ($1, $2, $3, $4)`,
        [
          fixtureRow.workspace_id,
          fixtureRow.brand_id,
          firstMedia.rows[0].id,
          otherSource.rows[0].id,
        ],
      ),
      /brand_trend_saved_media_source_owner_fkey/,
    );
    await assert.rejects(
      database.query(
        `insert into instagram_trend_media
           (instagram_media_id, media_type, permalink, last_fetched_at)
         values ('meta-invalid-type', 'STORY', 'https://instagram.com/p/type', now())`,
      ),
      /instagram_trend_media_media_type_check/,
    );
    await assert.rejects(
      database.query(
        `insert into instagram_trend_media
           (instagram_media_id, media_type, permalink, like_count, last_fetched_at)
         values ('meta-negative-likes', 'IMAGE', 'https://instagram.com/p/likes', -1, now())`,
      ),
      /instagram_trend_media_like_count_check/,
    );
    await assert.rejects(
      database.query(
        `insert into instagram_trend_media
           (instagram_media_id, media_type, permalink, comments_count, last_fetched_at)
         values ('meta-negative-comments', 'IMAGE', 'https://instagram.com/p/comments', -1, now())`,
      ),
      /instagram_trend_media_comments_count_check/,
    );
    await assert.rejects(
      database.query(
        `insert into instagram_trend_media
           (instagram_media_id, media_type, permalink, last_fetched_at)
         values ('meta-media-1', 'VIDEO', 'https://instagram.com/p/duplicate', now())`,
      ),
      /instagram_trend_media_instagram_media_id_key/,
    );

    const secondMedia = await database.query(
      `insert into instagram_trend_media
         (instagram_media_id, media_type, permalink, last_fetched_at)
       values ('meta-media-2', 'VIDEO', 'https://instagram.com/p/2', now())
       returning id`,
    );
    await database.query(
      `insert into instagram_trend_hashtag_media
         (hashtag_id, media_id, meta_rank, first_seen_at, last_seen_at)
       values ($1, $2, 1, now(), now())`,
      [hashtag.rows[0].id, firstMedia.rows[0].id],
    );
    await assert.rejects(
      database.query(
        `insert into instagram_trend_hashtag_media
           (hashtag_id, media_id, meta_rank, first_seen_at, last_seen_at)
         values ($1, $2, 1, now(), now())`,
        [hashtag.rows[0].id, secondMedia.rows[0].id],
      ),
      /instagram_trend_hashtag_media_hashtag_id_meta_rank_key/,
    );
    for (const invalidRank of [0, 51]) {
      await assert.rejects(
        database.query(
          `insert into instagram_trend_hashtag_media
             (hashtag_id, media_id, meta_rank, first_seen_at, last_seen_at)
           values ($1, $2, $3, now(), now())`,
          [hashtag.rows[0].id, secondMedia.rows[0].id, invalidRank],
        ),
        /instagram_trend_hashtag_media_meta_rank_check/,
      );
    }

    for (const invalidSearchCount of [0, -1]) {
      await assert.rejects(
        database.query(
          `insert into brand_trend_searches
             (workspace_id, brand_id, hashtag_id, last_searched_at, search_count)
           values ($1, $2, $3, now(), $4)`,
          [
            fixtureRow.workspace_id,
            fixtureRow.brand_id,
            hashtag.rows[0].id,
            invalidSearchCount,
          ],
        ),
        /brand_trend_searches_search_count_check/,
      );
    }

    await database.exec(migration030.sql);
    await database.exec(migration030.sql);
    await database.exec(migration031.sql);

    const schemaSmokeSql = await readFile("db/smoke/001_schema_smoke.sql", "utf8");
    for (const constraint of [
      "instagram_trend_media_like_count_check",
      "instagram_trend_media_comments_count_check",
      "instagram_trend_hashtag_media_meta_rank_check",
      "brand_trend_searches_search_count_check",
      "instagram_trend_media_media_type_check",
      "brand_profile_subcategories_custom_name_check",
    ]) {
      assert.match(schemaSmokeSql, new RegExp(`'${constraint}'`));
    }
    const subjectPipelineV2SmokeMarker = "do $$\ndeclare\n  pipeline_workspace_id uuid;";
    const subjectPipelineV2SmokeStart = schemaSmokeSql.indexOf(subjectPipelineV2SmokeMarker);
    assert.notEqual(subjectPipelineV2SmokeStart, -1, "missing subject pipeline v2 smoke block");
    const subjectPipelineV2TransactionStart = schemaSmokeSql.lastIndexOf(
      "begin;",
      subjectPipelineV2SmokeStart,
    );
    await database.exec(schemaSmokeSql.slice(0, subjectPipelineV2TransactionStart));
  });
});

test("031 creates the content performance dashboard schema", async () => {
  const migrations = await loadMigrations();
  const migration031 = migrations.find(
    (migration) => migration.id === "031_content_performance_dashboard.sql",
  );

  assert.ok(migration031, "missing migration 031_content_performance_dashboard.sql");
  assert.match(migration031.sql, /create table content_performance_snapshots/i);
  assert.match(migration031.sql, /unique\s*\(publish_queue_id, snapshot_date\)/i);
  assert.match(migration031.sql, /create table performance_sync_runs/i);
  assert.match(migration031.sql, /unique\s*\(brand_id, channel, run_date\)/i);
  assert.match(migration031.sql, /channel_outputs_performance_identity_unique/i);
  assert.match(migration031.sql, /publish_queue_performance_identity_unique/i);
  assert.match(migration031.sql, /content_performance_snapshots_publish_queue_owner_fkey/i);
  assert.match(migration031.sql, /content_performance_snapshots_channel_output_owner_fkey/i);
  assert.match(migration031.sql, /brand_id uuid not null references brands\(id\)/i);
  assert.doesNotMatch(migration031.sql, /performance_sync_runs_brand_owner_fkey/i);

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "031_content_performance_dashboard.sql",
    );

    const tables = await database.query(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in ('content_performance_snapshots', 'performance_sync_runs')
      order by table_name
    `);
    assert.deepEqual(
      tables.rows.map((row) => row.table_name),
      ["content_performance_snapshots", "performance_sync_runs"],
    );

    const columns = await database.query(`
      select table_name, column_name, is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and table_name in ('content_performance_snapshots', 'performance_sync_runs')
      order by table_name, column_name
    `);
    assert.deepEqual(columns.rows, [
      { table_name: "content_performance_snapshots", column_name: "brand_id", is_nullable: "NO" },
      { table_name: "content_performance_snapshots", column_name: "channel", is_nullable: "NO" },
      { table_name: "content_performance_snapshots", column_name: "channel_output_id", is_nullable: "NO" },
      { table_name: "content_performance_snapshots", column_name: "collected_at", is_nullable: "NO" },
      { table_name: "content_performance_snapshots", column_name: "created_at", is_nullable: "NO" },
      { table_name: "content_performance_snapshots", column_name: "exposure_count", is_nullable: "YES" },
      { table_name: "content_performance_snapshots", column_name: "external_post_id", is_nullable: "NO" },
      { table_name: "content_performance_snapshots", column_name: "id", is_nullable: "NO" },
      { table_name: "content_performance_snapshots", column_name: "publish_queue_id", is_nullable: "NO" },
      { table_name: "content_performance_snapshots", column_name: "raw_metrics", is_nullable: "NO" },
      { table_name: "content_performance_snapshots", column_name: "snapshot_date", is_nullable: "NO" },
      { table_name: "content_performance_snapshots", column_name: "updated_at", is_nullable: "NO" },
      { table_name: "content_performance_snapshots", column_name: "workspace_id", is_nullable: "NO" },
      { table_name: "performance_sync_runs", column_name: "brand_id", is_nullable: "NO" },
      { table_name: "performance_sync_runs", column_name: "channel", is_nullable: "NO" },
      { table_name: "performance_sync_runs", column_name: "completed_at", is_nullable: "YES" },
      { table_name: "performance_sync_runs", column_name: "created_at", is_nullable: "NO" },
      { table_name: "performance_sync_runs", column_name: "error_summary", is_nullable: "YES" },
      { table_name: "performance_sync_runs", column_name: "failure_count", is_nullable: "NO" },
      { table_name: "performance_sync_runs", column_name: "id", is_nullable: "NO" },
      { table_name: "performance_sync_runs", column_name: "run_date", is_nullable: "NO" },
      { table_name: "performance_sync_runs", column_name: "started_at", is_nullable: "NO" },
      { table_name: "performance_sync_runs", column_name: "status", is_nullable: "NO" },
      { table_name: "performance_sync_runs", column_name: "success_count", is_nullable: "NO" },
      { table_name: "performance_sync_runs", column_name: "target_count", is_nullable: "NO" },
      { table_name: "performance_sync_runs", column_name: "updated_at", is_nullable: "NO" },
      { table_name: "performance_sync_runs", column_name: "workspace_id", is_nullable: "NO" },
    ]);

    const indexColumns = await database.query(`
      select array_agg(attribute.attname::text order by key.ordinality) as columns
      from pg_class index_class
      join pg_index index_data on index_data.indexrelid = index_class.oid
      cross join lateral unnest(index_data.indkey) with ordinality as key(attnum, ordinality)
      join pg_attribute attribute
        on attribute.attrelid = index_data.indrelid
       and attribute.attnum = key.attnum
      where index_class.relname = 'content_performance_brand_channel_date_idx'
      group by index_class.oid
    `);
    assert.deepEqual(indexColumns.rows, [
      { columns: ["brand_id", "channel", "snapshot_date"] },
    ]);

    assert.deepEqual(
      await readConstraintValues(
        database,
        "content_performance_snapshots",
        "content_performance_snapshots_channel_check",
      ),
      ["instagram", "linkedin", "threads", "tiktok", "webflow", "x", "youtube"],
    );
    assert.deepEqual(
      await readConstraintValues(
        database,
        "performance_sync_runs",
        "performance_sync_runs_channel_check",
      ),
      ["instagram", "linkedin", "threads", "tiktok", "webflow", "x", "youtube"],
    );
    assert.deepEqual(
      await readConstraintValues(
        database,
        "performance_sync_runs",
        "performance_sync_runs_status_check",
      ),
      ["completed", "failed", "not_configured", "partially_failed", "running"],
    );

    const exposureConstraint = await database.query(
      "select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = 'content_performance_snapshots'::regclass and conname = 'content_performance_snapshots_exposure_count_check'",
    );
    assert.equal(exposureConstraint.rows.length, 1);
    assert.match(exposureConstraint.rows[0].definition, /exposure_count >= 0/);

    const ownershipConstraints = await database.query(`
      select conname
      from pg_constraint
      where conname in (
        'channel_outputs_performance_identity_unique',
        'publish_queue_performance_identity_unique',
        'content_performance_snapshots_publish_queue_owner_fkey',
        'content_performance_snapshots_channel_output_owner_fkey'
      )
      order by conname
    `);
    assert.deepEqual(
      ownershipConstraints.rows.map((row) => row.conname),
      [
        "channel_outputs_performance_identity_unique",
        "content_performance_snapshots_channel_output_owner_fkey",
        "content_performance_snapshots_publish_queue_owner_fkey",
        "publish_queue_performance_identity_unique",
      ],
    );

    const firstFixture = await insertPublishingFixture(database);
    const secondFixture = await insertPublishingFixture(database);

    await assert.rejects(
      database.query(
        `insert into content_performance_snapshots
           (workspace_id, brand_id, channel, publish_queue_id, channel_output_id,
            external_post_id, snapshot_date, raw_metrics, collected_at)
         values ($1, $2, 'instagram', $3, $4, 'cross-tenant', '2026-07-16', '{}', now())`,
        [
          firstFixture.workspaceId,
          firstFixture.brandId,
          secondFixture.publishQueueId,
          secondFixture.channelOutputId,
        ],
      ),
      /content_performance_snapshots_publish_queue_owner_fkey/,
    );

    await database.query(
      `update publish_queue
       set workspace_id = $1,
           brand_id = $2,
           brand_channel_id = (
             select id from brand_channels
             where brand_id = $2 and channel = 'instagram'
           )
       where id = $3`,
      [
        firstFixture.workspaceId,
        firstFixture.brandId,
        secondFixture.publishQueueId,
      ],
    );
    await assert.rejects(
      database.query(
        `insert into content_performance_snapshots
           (workspace_id, brand_id, channel, publish_queue_id, channel_output_id,
            external_post_id, snapshot_date, raw_metrics, collected_at)
         values ($1, $2, 'instagram', $3, $4, 'cross-output', '2026-07-16', '{}', now())`,
        [
          firstFixture.workspaceId,
          firstFixture.brandId,
          secondFixture.publishQueueId,
          secondFixture.channelOutputId,
        ],
      ),
      /content_performance_snapshots_channel_output_owner_fkey/,
    );

    await assert.rejects(
      database.query(
        `insert into performance_sync_runs
           (workspace_id, brand_id, channel, run_date, status,
            target_count, success_count, failure_count)
         values ($1, $2, 'instagram', '2026-07-16', 'completed', 2, 2, 1)`,
        [firstFixture.workspaceId, firstFixture.brandId],
      ),
      /performance_sync_runs_counts_check/,
    );
  });
});

test("029 remains inside the migration runner transaction", async () => {
  const migrations = await loadMigrations();
  const initialMigration = migrations.find(
    (migration) => migration.id === "001_initial_schema.sql",
  );
  const migration029 = migrations.find(
    (migration) => migration.id === "029_instagram_hashtag_trends.sql",
  );

  assert.ok(initialMigration);
  assert.ok(migration029);

  await withDatabase(async (database) => {
    await database.exec(initialMigration.sql);
    await database.exec("begin");
    await database.exec(migration029.sql);

    const insideTransaction = await database.query(
      "select to_regclass('public.content_categories')::text as relation",
    );
    assert.equal(insideTransaction.rows[0].relation, "content_categories");

    await database.exec("rollback");

    const afterRollback = await database.query(
      "select to_regclass('public.content_categories')::text as relation",
    );
    assert.equal(afterRollback.rows[0].relation, null);
  });

  assert.doesNotMatch(migration029.sql, /^\s*(?:begin|commit)\s*;/im);
});

test("032 creates the brand-scoped compiled Wiki core in PGlite", async () => {
  const migrations = await loadMigrations();
  const coreMigration = migrations.find(
    (migration) => migration.id === "032_compounding_wiki_core.sql",
  );
  const vectorMigration = migrations.find(
    (migration) => migration.id === "033_compounding_wiki_pgvector.sql",
  );

  assert.ok(coreMigration, "missing migration 032_compounding_wiki_core.sql");
  assert.ok(vectorMigration, "missing migration 033_compounding_wiki_pgvector.sql");
  assert.match(vectorMigration.sql, /^-- requires: pgvector/);
  assert.match(
    vectorMigration.sql,
    /jsonb_typeof\(section -> 'sourceUnitIds'\) <> 'array'/i,
  );
  assert.doesNotMatch(vectorMigration.sql, /section\.value/);
  assert.doesNotMatch(vectorMigration.sql, /chunk\.embedding is null/);

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "032_compounding_wiki_core.sql",
    );

    const tables = await database.query(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in (
          'wiki_build_requests', 'wiki_source_units', 'wiki_pages',
          'wiki_page_sources', 'wiki_page_links', 'wiki_page_chunks',
          'wiki_compilation_items', 'wiki_retrieval_runs',
          'wiki_maintenance_runs', 'wiki_issues'
        )
      order by table_name
    `);
    assert.equal(tables.rows.length, 10);

    const versionColumns = await database.query(`
      select column_name, is_nullable
      from information_schema.columns
      where table_name = 'wiki_versions'
        and column_name = 'build_stage'
    `);
    assert.deepEqual(versionColumns.rows, [
      { column_name: "build_stage", is_nullable: "YES" },
    ]);
    assert.deepEqual(
      await readConstraintValues(
        database,
        "wiki_versions",
        "wiki_versions_status_check",
      ),
      ["active", "building", "failed", "ready", "superseded"],
    );

    const chunkEmbedding = await database.query(`
      select column_name
      from information_schema.columns
      where table_name = 'wiki_page_chunks'
        and column_name = 'embedding'
    `);
    assert.equal(chunkEmbedding.rows.length, 0);

    const workspace = await database.query(
      "insert into workspaces (name, slug) values ('Compiled Wiki', $1) returning id",
      [`compiled-wiki-${randomUUID()}`],
    );
    const firstBrand = await database.query(
      "insert into brands (workspace_id, name) values ($1, 'First') returning id",
      [workspace.rows[0].id],
    );
    const secondBrand = await database.query(
      "insert into brands (workspace_id, name) values ($1, 'Second') returning id",
      [workspace.rows[0].id],
    );
    const version = await database.query(
      `insert into wiki_versions (workspace_id, brand_id, status, build_stage)
       values ($1, $2, 'building', 'collecting') returning id`,
      [workspace.rows[0].id, firstBrand.rows[0].id],
    );

    await database.query(
      `insert into wiki_build_requests
         (workspace_id, brand_id, requested_revision, status, quiet_until)
       values ($1, $2, 1, 'pending', now())`,
      [workspace.rows[0].id, firstBrand.rows[0].id],
    );
    await assert.rejects(
      database.query(
        `insert into wiki_build_requests
           (workspace_id, brand_id, requested_revision, status, quiet_until)
         values ($1, $2, 2, 'building', now())`,
        [workspace.rows[0].id, firstBrand.rows[0].id],
      ),
      /wiki_build_requests_brand_active_unique/,
    );

    await database.query(
      `insert into wiki_pages
         (workspace_id, brand_id, wiki_version_id, page_type, stable_key,
          title, content_json)
       values ($1, $2, $3, 'brand_overview', 'brand', 'Brand',
               '{"sections": []}')`,
      [workspace.rows[0].id, firstBrand.rows[0].id, version.rows[0].id],
    );
    await assert.rejects(
      database.query(
        `insert into wiki_pages
           (workspace_id, brand_id, wiki_version_id, page_type, stable_key,
            title, content_json)
         values ($1, $2, $3, 'brand_overview', 'brand', 'Duplicate',
                 '{"sections": []}')`,
        [workspace.rows[0].id, firstBrand.rows[0].id, version.rows[0].id],
      ),
      /wiki_pages_version_stable_key_unique/,
    );
    await assert.rejects(
      database.query(
        `insert into wiki_pages
           (workspace_id, brand_id, wiki_version_id, page_type, stable_key,
            title, content_json)
         values ($1, $2, $3, 'catalog', 'catalog', 'Wrong owner',
                 '{"sections": []}')`,
        [workspace.rows[0].id, secondBrand.rows[0].id, version.rows[0].id],
      ),
      /wiki_pages_version_ownership_fk/,
    );

    await assert.rejects(
      database.query(
        `insert into wiki_compilation_items
           (workspace_id, brand_id, wiki_version_id, item_type, stable_key,
            idempotency_key, status)
         values ($1, $2, $3, 'brand_core_pages', 'brand-core',
                 'version-1:brand-core', 'processing')`,
        [workspace.rows[0].id, firstBrand.rows[0].id, version.rows[0].id],
      ),
      /wiki_compilation_items_lease_check/,
    );
  });
});

test("036 hardens performance ownership and compiled Wiki activation", async () => {
  const migrations = await loadMigrations();
  const hardeningMigration = migrations.find(
    (migration) =>
      migration.id === "036_harden_performance_and_wiki_activation.sql",
  );

  assert.ok(
    hardeningMigration,
    "missing migration 036_harden_performance_and_wiki_activation.sql",
  );
  assert.match(
    hardeningMigration.sql,
    /drop constraint if exists performance_sync_runs_brand_id_fkey/i,
  );
  assert.match(
    hardeningMigration.sql,
    /foreign key \(brand_id, workspace_id\)\s+references brands\(id, workspace_id\)[\s\S]*not valid/i,
  );
  assert.match(
    hardeningMigration.sql,
    /validate constraint performance_sync_runs_brand_owner_fkey/i,
  );
  assert.match(
    hardeningMigration.sql,
    /jsonb_typeof\(section\.value\)\s+is distinct from 'object'/i,
  );
  assert.match(
    hardeningMigration.sql,
    /jsonb_typeof\(section\.value\s*->\s*'sourceUnitIds'\)\s+is distinct from 'array'/i,
  );
  assert.match(
    hardeningMigration.sql,
    /when\s+jsonb_array_length\(section\.value\s*->\s*'sourceUnitIds'\)\s*=\s*0\s+then true/i,
  );
  assert.match(
    hardeningMigration.sql,
    /from wiki_page_chunks chunk\s+where chunk\.wiki_version_id = p_wiki_version_id\s+and chunk\.enabled\s+and chunk\.embedding is null/i,
  );

  const activationStart = hardeningMigration.sql.indexOf(
    "create or replace function activate_compiled_wiki_version",
  );
  assert.ok(activationStart > 0);
  const ownershipSql = hardeningMigration.sql.slice(0, activationStart);

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "035_remove_webflow_and_split_content_status.sql",
    );

    const firstWorkspace = await database.query(
      "insert into workspaces (name, slug) values ('First Tenant', $1) returning id",
      [`first-tenant-${randomUUID()}`],
    );
    const firstBrand = await database.query(
      "insert into brands (workspace_id, name) values ($1, 'First Brand') returning id",
      [firstWorkspace.rows[0].id],
    );
    const secondWorkspace = await database.query(
      "insert into workspaces (name, slug) values ('Second Tenant', $1) returning id",
      [`second-tenant-${randomUUID()}`],
    );
    const secondBrand = await database.query(
      "insert into brands (workspace_id, name) values ($1, 'Second Brand') returning id",
      [secondWorkspace.rows[0].id],
    );

    await database.exec("begin");
    await database.query(
      `insert into performance_sync_runs
         (workspace_id, brand_id, channel, run_date, status)
       values ($1, $2, 'instagram', '2026-07-17', 'running')`,
      [firstWorkspace.rows[0].id, secondBrand.rows[0].id],
    );
    await assert.rejects(
      database.exec(ownershipSql),
      /performance_sync_runs_brand_owner_fkey/,
    );
    await database.exec("rollback");

    await database.exec(ownershipSql);
    await database.exec(ownershipSql);

    await assert.rejects(
      database.query(
        `insert into performance_sync_runs
           (workspace_id, brand_id, channel, run_date, status)
         values ($1, $2, 'instagram', '2026-07-17', 'running')`,
        [firstWorkspace.rows[0].id, secondBrand.rows[0].id],
      ),
      /performance_sync_runs_brand_owner_fkey/,
    );
    await database.query(
      `insert into performance_sync_runs
         (workspace_id, brand_id, channel, run_date, status)
       values ($1, $2, 'instagram', '2026-07-17', 'running')`,
      [firstWorkspace.rows[0].id, firstBrand.rows[0].id],
    );
  });
});

test("034 creates expiring cross-process worker resource leases", async () => {
  const migrations = await loadMigrations();

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "034_worker_resource_limits.sql",
    );

    const table = await database.query(
      "select to_regclass('public.worker_resource_leases')::text as relation",
    );
    assert.equal(table.rows[0].relation, "worker_resource_leases");

    await database.query(
      `insert into worker_resource_leases
         (resource_type, workload_type, worker_id, expires_at)
       values ('codex_cli', 'dm', 'dm-worker-1', now() + interval '45 seconds')`,
    );
    await assert.rejects(
      database.query(
        `insert into worker_resource_leases
           (resource_type, workload_type, worker_id, expires_at)
         values ('codex_cli', 'dm', 'dm-worker-1', now() + interval '45 seconds')`,
      ),
      /worker_resource_leases_resource_type_worker_id_key/,
    );
    await assert.rejects(
      database.query(
        `insert into worker_resource_leases
           (resource_type, workload_type, worker_id, expires_at)
         values ('codex_cli', 'invalid', 'invalid-worker', now() + interval '45 seconds')`,
      ),
      /worker_resource_leases_workload_check/,
    );
  });
});

test("035 removes Webflow runtime data and separates pending generation state", async () => {
  const migrations = await loadMigrations();
  const migration035 = migrations.find(
    (migration) =>
      migration.id === "035_remove_webflow_and_split_content_status.sql",
  );

  assert.ok(
    migration035,
    "missing migration 035_remove_webflow_and_split_content_status.sql",
  );

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "034_worker_resource_limits.sql",
    );

    const workspace = await database.query(
      "insert into workspaces (name, slug) values ('Webflow Removal', $1) returning id",
      [`webflow-removal-${randomUUID()}`],
    );
    const workspaceId = workspace.rows[0].id;
    const brand = await database.query(
      "insert into brands (workspace_id, name) values ($1, 'Migration Brand') returning id",
      [workspaceId],
    );
    const brandId = brand.rows[0].id;
    const brandChannels = await database.query(
      `insert into brand_channels
         (workspace_id, brand_id, channel, status, account_label)
       values
         ($1, $2, 'instagram', 'connected', 'Instagram'),
         ($1, $2, 'webflow', 'connected', 'Webflow')
       returning id, channel`,
      [workspaceId, brandId],
    );
    const brandChannelIds = new Map(
      brandChannels.rows.map((row) => [row.channel, row.id]),
    );

    const credential = await database.query(
      `insert into channel_credentials
         (workspace_id, brand_id, brand_channel_id, provider, credential_type,
          encrypted_payload)
       values ($1, $2, $3, 'webflow', 'api_token', 'integration-fixture')
       returning id`,
      [workspaceId, brandId, brandChannelIds.get("webflow")],
    );
    const topic = await database.query(
      `insert into content_topics (workspace_id, brand_id, title, angle)
       values ($1, $2, 'Migration topic', 'Migration angle')
       returning id`,
      [workspaceId, brandId],
    );
    const topicId = topic.rows[0].id;
    const publishGroup = await database.query(
      `insert into topic_publish_groups
         (workspace_id, brand_id, content_topic_id)
       values ($1, $2, $3)
       returning id`,
      [workspaceId, brandId, topicId],
    );
    const draft = await database.query(
      `insert into master_drafts
         (workspace_id, brand_id, content_topic_id, prompt_version)
       values ($1, $2, $3, 'migration-035')
       returning id`,
      [workspaceId, brandId, topicId],
    );
    const draftId = draft.rows[0].id;
    const webflowOutput = await database.query(
      `insert into channel_outputs
         (workspace_id, brand_id, content_topic_id, master_draft_id, channel,
          status, title, delivery_format)
       values ($1, $2, $3, $4, 'webflow', 'approved', 'Webflow output',
               'webflow_article')
       returning id`,
      [workspaceId, brandId, topicId, draftId],
    );
    const webflowOutputId = webflowOutput.rows[0].id;
    const pendingInstagramOutput = await database.query(
      `insert into channel_outputs
         (workspace_id, brand_id, content_topic_id, master_draft_id, channel,
          status, title, delivery_format, output_json, block_reasons)
       values ($1, $2, $3, $4, 'instagram', 'auto_approval_blocked',
               'Pending Instagram output', 'instagram_feed_carousel',
               '{"generationState":"pending","artifactStatus":"pending"}',
               '["instagram_artifact_pending","policy_violation"]')
       returning id`,
      [workspaceId, brandId, topicId, draftId],
    );
    const pendingInstagramOutputId = pendingInstagramOutput.rows[0].id;

    const blockedTopic = await database.query(
      `insert into content_topics (workspace_id, brand_id, title, angle)
       values ($1, $2, 'Blocked topic', 'Blocked angle')
       returning id`,
      [workspaceId, brandId],
    );
    const blockedDraft = await database.query(
      `insert into master_drafts
         (workspace_id, brand_id, content_topic_id, prompt_version)
       values ($1, $2, $3, 'migration-035')
       returning id`,
      [workspaceId, brandId, blockedTopic.rows[0].id],
    );
    const blockedInstagramOutput = await database.query(
      `insert into channel_outputs
         (workspace_id, brand_id, content_topic_id, master_draft_id, channel,
          status, title, delivery_format, output_json, block_reasons)
       values ($1, $2, $3, $4, 'instagram', 'auto_approval_blocked',
               'Blocked Instagram output', 'instagram_feed_carousel',
               '{"generationState":"ready","artifactStatus":"ready"}',
               '["policy_violation"]')
       returning id`,
      [workspaceId, brandId, blockedTopic.rows[0].id, blockedDraft.rows[0].id],
    );

    const slot = await database.query(
      `insert into publish_slots
         (workspace_id, brand_id, channel, slot_number, base_time)
       values ($1, $2, 'webflow', 1, '09:00')
       returning id`,
      [workspaceId, brandId],
    );
    const queue = await database.query(
      `insert into publish_queue
         (workspace_id, brand_id, channel_output_id, brand_channel_id, channel,
          status, approval_type, queued_at, idempotency_key,
          topic_publish_group_id)
       values ($1, $2, $3, $4, 'webflow', 'published', 'manual', now(), $5, $6)
       returning id`,
      [
        workspaceId,
        brandId,
        webflowOutputId,
        brandChannelIds.get("webflow"),
        `webflow-${randomUUID()}`,
        publishGroup.rows[0].id,
      ],
    );
    const queueId = queue.rows[0].id;
    const attempt = await database.query(
      `insert into publish_attempts
         (workspace_id, brand_id, publish_queue_id, attempt_number, status)
       values ($1, $2, $3, 1, 'succeeded')
       returning id`,
      [workspaceId, brandId, queueId],
    );
    const job = await database.query(
      `insert into jobs
         (workspace_id, brand_id, channel_output_id, job_type, status)
       values ($1, $2, $3, 'channel_output_generate', 'succeeded')
       returning id`,
      [workspaceId, brandId, webflowOutputId],
    );
    const reviewEvent = await database.query(
      `insert into review_events
         (workspace_id, brand_id, channel_output_id, actor_type, event_type)
       values ($1, $2, $3, 'system', 'status_changed')
       returning id`,
      [workspaceId, brandId, webflowOutputId],
    );
    const snapshot = await database.query(
      `insert into content_performance_snapshots
         (workspace_id, brand_id, channel, publish_queue_id, channel_output_id,
          external_post_id, snapshot_date, exposure_count, collected_at)
       values ($1, $2, 'webflow', $3, $4, 'webflow-post', '2026-07-16', 10, now())
       returning id`,
      [workspaceId, brandId, queueId, webflowOutputId],
    );
    const syncRun = await database.query(
      `insert into performance_sync_runs
         (workspace_id, brand_id, channel, run_date, status, target_count,
          success_count, failure_count)
       values ($1, $2, 'webflow', '2026-07-16', 'completed', 1, 1, 0)
       returning id`,
      [workspaceId, brandId],
    );

    await database.exec(migration035.sql);
    await database.exec(migration035.sql);

    for (const [table, id] of [
      ["content_performance_snapshots", snapshot.rows[0].id],
      ["performance_sync_runs", syncRun.rows[0].id],
      ["publish_attempts", attempt.rows[0].id],
      ["publish_queue", queueId],
      ["publish_slots", slot.rows[0].id],
      ["jobs", job.rows[0].id],
      ["review_events", reviewEvent.rows[0].id],
      ["channel_outputs", webflowOutputId],
      ["channel_credentials", credential.rows[0].id],
      ["brand_channels", brandChannelIds.get("webflow")],
    ]) {
      const result = await database.query(
        `select count(*)::int as count from ${table} where id = $1`,
        [id],
      );
      assert.equal(result.rows[0].count, 0, `${table} Webflow row remains`);
    }

    const migratedPendingOutput = await database.query(
      `select status, block_reasons
       from channel_outputs
       where id = $1`,
      [pendingInstagramOutputId],
    );
    assert.deepEqual(migratedPendingOutput.rows, [
      { status: "generating", block_reasons: ["policy_violation"] },
    ]);
    const preservedBlockedOutput = await database.query(
      `select status, block_reasons
       from channel_outputs
       where id = $1`,
      [blockedInstagramOutput.rows[0].id],
    );
    assert.deepEqual(preservedBlockedOutput.rows, [
      {
        status: "auto_approval_blocked",
        block_reasons: ["policy_violation"],
      },
    ]);

    const defaultTopic = await database.query(
      `insert into content_topics (workspace_id, brand_id, title, angle)
       values ($1, $2, 'Default status topic', 'Default status angle')
       returning id`,
      [workspaceId, brandId],
    );
    const defaultDraft = await database.query(
      `insert into master_drafts
         (workspace_id, brand_id, content_topic_id, prompt_version)
       values ($1, $2, $3, 'migration-035')
       returning id`,
      [workspaceId, brandId, defaultTopic.rows[0].id],
    );
    const defaultOutput = await database.query(
      `insert into channel_outputs
         (workspace_id, brand_id, content_topic_id, master_draft_id, channel,
          title, delivery_format)
       values ($1, $2, $3, $4, 'instagram', 'Default status output',
               'instagram_feed_carousel')
       returning status`,
      [workspaceId, brandId, defaultTopic.rows[0].id, defaultDraft.rows[0].id],
    );
    assert.equal(defaultOutput.rows[0].status, "generating");

    const supportedChannels = [
      "instagram",
      "linkedin",
      "threads",
      "tiktok",
      "x",
      "youtube",
    ];
    for (const [table, constraint] of [
      ["brand_channels", "brand_channels_channel_check"],
      ["channel_outputs", "channel_outputs_channel_check"],
      ["publish_slots", "publish_slots_channel_check"],
      ["publish_queue", "publish_queue_channel_check"],
      [
        "content_performance_snapshots",
        "content_performance_snapshots_channel_check",
      ],
      ["performance_sync_runs", "performance_sync_runs_channel_check"],
    ]) {
      assert.deepEqual(
        await readConstraintValues(database, table, constraint),
        supportedChannels,
      );
    }
    assert.deepEqual(
      await readConstraintValues(
        database,
        "channel_credentials",
        "channel_credentials_provider_check",
      ),
      ["google", "linkedin", "meta", "tiktok", "x"],
    );
    assert.deepEqual(
      await readConstraintValues(
        database,
        "channel_outputs",
        "channel_outputs_delivery_format_check",
      ),
      [
        "instagram_feed_carousel",
        "instagram_reel",
        "instagram_story",
        "linkedin_post",
        "threads_text",
        "tiktok_video",
        "x_post",
        "youtube_short",
        "youtube_video",
      ],
    );
    assert.deepEqual(
      await readConstraintValues(
        database,
        "channel_outputs",
        "channel_outputs_status_check",
      ),
      [
        "approved",
        "auto_approval_blocked",
        "auto_approved",
        "generating",
        "generation_failed",
        "pending_review",
        "regenerated",
        "regenerating",
        "rejected",
      ],
    );

    await assert.rejects(
      database.query(
        `insert into brand_channels (workspace_id, brand_id, channel)
         values ($1, $2, 'webflow')`,
        [workspaceId, brandId],
      ),
      /brand_channels_channel_check/,
    );
  });
});

test("037 fails orphaned or terminal generation outputs instead of leaving them pending", async () => {
  const migration = await readFile("db/migrations/037_repair_orphaned_generation_outputs.sql", "utf8");
  assert.match(migration, /status = 'generation_failed'/i);
  assert.match(migration, /not exists[\s\S]*from jobs/i);
  assert.match(migration, /status in \('failed', 'cancelled'\)/i);
  assert.match(migration, /generation_adapter_not_configured/i);
});

test("038 closes expired generation jobs that exhausted their retry budget", async () => {
  const migration = await readFile("db/migrations/038_fail_exhausted_generation_jobs.sql", "utf8");
  assert.match(migration, /locked_until < now\(\)/i);
  assert.match(migration, /attempt_count >= max_attempts/i);
  assert.match(migration, /update jobs/i);
  assert.match(migration, /status = 'generation_failed'/i);
});

test("051 scopes v2 subject pipelines to AI content generations", async () => {
  const migrations = await loadMigrations();
  const migration051 = migrations.find(
    (migration) => migration.id === "051_ai_content_subject_pipeline_v2.sql",
  );
  assert.ok(migration051, "051 subject pipeline v2 migration must exist");

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "051_ai_content_subject_pipeline_v2.sql",
    );

    const workspace = await database.query(
      "insert into workspaces (name, slug) values ($1, $2) returning id",
      ["Subject Pipeline V2", `subject-pipeline-v2-${randomUUID()}`],
    );
    const workspaceId = workspace.rows[0].id;
    const brand = await database.query(
      "insert into brands (workspace_id, name) values ($1, $2) returning id",
      [workspaceId, "Subject Pipeline V2 Brand"],
    );
    const brandId = brand.rows[0].id;

    const createGeneration = async (key) => (
      await database.query(
        `insert into ai_content_generations
           (workspace_id, brand_id, type, title, status, analysis_idempotency_key)
         values ($1, $2, 'card_news', 'Subject pipeline', 'draft', $3)
         returning id`,
        [workspaceId, brandId, key],
      )
    ).rows[0].id;
    const firstGenerationId = await createGeneration(`generation-${randomUUID()}`);
    const secondGenerationId = await createGeneration(`generation-${randomUUID()}`);

    await assert.rejects(
      database.query(
        `insert into ai_content_subject_analyses
           (workspace_id, brand_id, generation_id, contract_version,
            subject_type, status, idempotency_key)
         values ($1, $2, $3, 'subject-analysis.v1', 'product', 'queued', $4)`,
        [workspaceId, brandId, firstGenerationId, `invalid-v1-scope-${randomUUID()}`],
      ),
      /ai_content_subject_analyses_scope_version_check/,
    );
    await assert.rejects(
      database.query(
        `insert into ai_content_subject_analyses
           (workspace_id, brand_id, generation_id, contract_version,
            subject_type, status, idempotency_key)
         values ($1, $2, null, 'subject-analysis.v2', 'product', 'queued', $3)`,
        [workspaceId, brandId, `invalid-v2-scope-${randomUUID()}`],
      ),
      /ai_content_subject_analyses_scope_version_check/,
    );
    await assert.rejects(
      database.query(
        `insert into ai_content_subject_analyses
           (workspace_id, brand_id, generation_id, contract_version,
            subject_type, status, idempotency_key)
         values ($1, $2, null, 'subject-analysis.v3', 'product', 'queued', $3)`,
        [workspaceId, brandId, `invalid-version-${randomUUID()}`],
      ),
      /ai_content_subject_analyses_(contract_version|scope_version)_check/,
    );

    const legacy = await database.query(
      `insert into ai_content_subject_analyses
         (workspace_id, brand_id, subject_type, source_url, normalized_url,
          status, idempotency_key)
       values ($1, $2, 'product', 'https://example.com/legacy',
               'https://example.com/legacy', 'ready', $3)
       returning generation_id, contract_version, attachment_ids_json,
                 analysis_result_json`,
      [workspaceId, brandId, `legacy-${randomUUID()}`],
    );
    assert.deepEqual(legacy.rows, [{
      generation_id: null,
      contract_version: "subject-analysis.v1",
      attachment_ids_json: [],
      analysis_result_json: {},
    }]);

    const insertV2 = (generationId, key) => database.query(
      `insert into ai_content_subject_analyses
         (workspace_id, brand_id, generation_id, contract_version,
          subject_type, source_url, normalized_url, status, idempotency_key)
       values ($1, $2, $3, 'subject-analysis.v2', 'product',
               'https://example.com/shared-product',
               'https://example.com/shared-product', 'queued', $4)
       returning id`,
      [workspaceId, brandId, generationId, key],
    );

    const firstAnalysis = await insertV2(firstGenerationId, `v2-${randomUUID()}`);
    await insertV2(secondGenerationId, `v2-${randomUUID()}`);
    await assert.rejects(
      insertV2(firstGenerationId, `duplicate-${randomUUID()}`),
      /ai_content_subject_generation_active_uq/,
    );

    await database.query("delete from ai_content_generations where id = $1", [firstGenerationId]);
    const cascaded = await database.query(
      "select id from ai_content_subject_analyses where id = $1",
      [firstAnalysis.rows[0].id],
    );
    assert.equal(cascaded.rows.length, 0);
  });
});

test("051 can be applied twice", async () => {
  const migrations = await loadMigrations();
  const migration051 = migrations.find(
    (migration) => migration.id === "051_ai_content_subject_pipeline_v2.sql",
  );
  assert.ok(migration051, "051 subject pipeline v2 migration must exist");

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "050_support_request_contact_phone.sql",
    );
    await database.exec(migration051.sql);
    await database.exec(migration051.sql);
  });
});

test("052 normalizes subject appeal regeneration idempotency keys", async () => {
  const migrations = await loadMigrations();
  const migration052 = migrations.find(
    (migration) => migration.id === "052_ai_content_subject_appeal_regeneration_keys.sql",
  );
  assert.ok(migration052, "052 subject appeal regeneration key migration must exist");

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "051_ai_content_subject_pipeline_v2.sql",
    );
    const workspace = await database.query(
      "insert into workspaces (name, slug) values ($1, $2) returning id",
      ["Subject appeal keys", `subject-appeal-keys-${randomUUID()}`],
    );
    const workspaceId = workspace.rows[0].id;
    const brand = await database.query(
      "insert into brands (workspace_id, name) values ($1, $2) returning id",
      [workspaceId, "Subject appeal key brand"],
    );
    const brandId = brand.rows[0].id;
    const generation = await database.query(
      `insert into ai_content_generations
         (workspace_id, brand_id, type, title, status, analysis_idempotency_key)
       values ($1, $2, 'card_news', 'Subject appeal keys', 'draft', $3)
       returning id`,
      [workspaceId, brandId, `generation-${randomUUID()}`],
    );
    const analysis = await database.query(
      `insert into ai_content_subject_analyses
         (workspace_id, brand_id, generation_id, contract_version,
          subject_type, input_json, status, idempotency_key)
       values ($1, $2, $3, 'subject-analysis.v2', 'product', $4::jsonb,
               'ready', $5)
       returning id`,
      [workspaceId, brandId, generation.rows[0].id, JSON.stringify({
        manualInput: { name: "Product", promotionOrTerms: "", description: "Description" },
        brandContext: { companyOverview: "Acme" },
        regenerationIdempotencyKeys: ["legacy-key-1", "legacy-key-2"],
      }), `analysis-${randomUUID()}`],
    );
    const analysisId = analysis.rows[0].id;

    await database.exec(migration052.sql);
    await database.exec(migration052.sql);

    const keys = await database.query(
      `select idempotency_key
         from ai_content_subject_appeal_regeneration_keys
        where analysis_id = $1
        order by idempotency_key`,
      [analysisId],
    );
    assert.deepEqual(keys.rows, [
      { idempotency_key: "legacy-key-1" },
      { idempotency_key: "legacy-key-2" },
    ]);
    const input = await database.query(
      "select input_json from ai_content_subject_analyses where id = $1",
      [analysisId],
    );
    assert.equal("regenerationIdempotencyKeys" in input.rows[0].input_json, false);
    await assert.rejects(
      database.query(
        `insert into ai_content_subject_appeal_regeneration_keys
           (analysis_id, idempotency_key)
         values ($1, 'legacy-key-1')`,
        [analysisId],
      ),
      /ai_content_subject_appeal_regeneration_keys_pkey/,
    );

    await database.query("delete from ai_content_subject_analyses where id = $1", [analysisId]);
    const cascaded = await database.query(
      "select analysis_id from ai_content_subject_appeal_regeneration_keys where analysis_id = $1",
      [analysisId],
    );
    assert.equal(cascaded.rows.length, 0);
  });
});

test("subject pipeline v2 smoke fails before migration 051", async () => {
  const migrations = await loadMigrations();
  const schemaSmokeSql = await readFile("db/smoke/001_schema_smoke.sql", "utf8");
  const marker = "do $$\ndeclare\n  pipeline_workspace_id uuid;";
  const start = schemaSmokeSql.indexOf(marker);
  assert.notEqual(start, -1, "missing subject pipeline v2 smoke block");

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "050_support_request_contact_phone.sql",
    );
    await assert.rejects(
      database.exec(`begin;\n${schemaSmokeSql.slice(start)}`),
      /Missing subject pipeline v2 columns/,
    );
  });
});

test("039 stores Facebook Login credentials separately for Instagram trends", async () => {
  const migration = await readFile("db/migrations/039_instagram_trend_connections.sql", "utf8");
  assert.match(migration, /create table instagram_trend_connections/i);
  assert.match(migration, /unique \(brand_id\)/i);
  assert.match(migration, /references brand_channels/i);
  assert.doesNotMatch(migration, /alter table channel_credentials/i);
});

test("044 creates the tenant-safe AI content studio runtime schema", async () => {
  const migrations = await loadMigrations();
  const migration044 = migrations.find(
    (migration) => migration.id === "044_ai_content_studio_runtime.sql",
  );

  assert.ok(migration044);

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "044_ai_content_studio_runtime.sql",
    );

    const runtimeTables = [
      "ai_content_generations",
      "ai_content_generation_outputs",
      "ai_content_generation_attachments",
      "ai_content_generation_jobs",
      "ai_content_generation_references",
      "ai_content_usage_ledger",
      "brand_audiences",
      "brand_appeals",
    ];

    for (const tableName of runtimeTables) {
      const result = await database.query(
        "select to_regclass($1) as table_name",
        [`public.${tableName}`],
      );
      assert.equal(result.rows[0].table_name, tableName);
    }

    assert.deepEqual(
      await readConstraintValues(
        database,
        "ai_content_generations",
        "ai_content_generations_type_check",
      ),
      ["blog", "card_news", "marketing"],
    );
    assert.deepEqual(
      await readConstraintValues(
        database,
        "ai_content_generations",
        "ai_content_generations_status_check",
      ),
      [
        "analysis_ready",
        "analyzing",
        "completed",
        "draft",
        "failed",
        "generating",
        "partial_failed",
        "planning",
        "queued",
      ],
    );
    assert.deepEqual(
      await readConstraintValues(
        database,
        "ai_content_generation_outputs",
        "ai_content_generation_outputs_status_check",
      ),
      ["completed", "failed", "generating", "planning", "queued"],
    );
    assert.deepEqual(
      await readConstraintValues(
        database,
        "ai_content_generation_attachments",
        "ai_content_generation_attachments_role_check",
      ),
      ["document", "person", "product", "scale", "visual_reference"],
    );
    assert.deepEqual(
      await readConstraintValues(
        database,
        "ai_content_generation_jobs",
        "ai_content_generation_jobs_type_check",
      ),
      ["analyze", "generate"],
    );
    assert.deepEqual(
      await readConstraintValues(
        database,
        "ai_content_generation_jobs",
        "ai_content_generation_jobs_content_type_check",
      ),
      ["blog", "card_news", "marketing"],
    );
    assert.deepEqual(
      await readConstraintValues(
        database,
        "ai_content_generation_jobs",
        "ai_content_generation_jobs_status_check",
      ),
      ["failed", "processing", "queued", "succeeded"],
    );
    assert.deepEqual(
      await readConstraintValues(
        database,
        "ai_content_usage_ledger",
        "ai_content_usage_ledger_type_check",
      ),
      ["generation", "new_download", "reversal"],
    );

    const uuidColumns = await database.query(`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name in (
          'ai_content_generations',
          'ai_content_generation_outputs',
          'ai_content_generation_attachments',
          'ai_content_generation_jobs',
          'ai_content_generation_references',
          'ai_content_usage_ledger',
          'brand_audiences',
          'brand_appeals'
        )
        and (column_name = 'id' or column_name like '%\\_id' escape '\\')
        and column_name != 'worker_id'
        and data_type != 'uuid'
    `);
    assert.deepEqual(uuidColumns.rows, []);

    const workspace = await database.query(
      "insert into workspaces (name, slug) values ($1, $2) returning id",
      ["AI Content Migration", `ai-content-${randomUUID()}`],
    );
    const workspaceId = workspace.rows[0].id;
    const brand = await database.query(
      "insert into brands (workspace_id, name) values ($1, $2) returning id",
      [workspaceId, "AI Content Brand"],
    );
    const brandId = brand.rows[0].id;
    const otherWorkspace = await database.query(
      "insert into workspaces (name, slug) values ($1, $2) returning id",
      ["Other AI Content Migration", `other-ai-content-${randomUUID()}`],
    );
    const otherWorkspaceId = otherWorkspace.rows[0].id;
    const otherBrand = await database.query(
      "insert into brands (workspace_id, name) values ($1, $2) returning id",
      [otherWorkspaceId, "Other AI Content Brand"],
    );
    const otherBrandId = otherBrand.rows[0].id;

    await assert.rejects(
      database.query(
        `insert into ai_content_generations
           (workspace_id, brand_id, type, title, status,
            analysis_idempotency_key)
         values ($1, $2, 'video', 'Invalid type', 'draft', $3)`,
        [workspaceId, brandId, `analysis-${randomUUID()}`],
      ),
      /ai_content_generations_type_check/,
    );
    await assert.rejects(
      database.query(
        `insert into ai_content_generations
           (workspace_id, brand_id, type, title, status,
            analysis_idempotency_key)
         values ($1, $2, 'card_news', 'Wrong owner', 'draft', $3)`,
        [otherWorkspaceId, brandId, `analysis-${randomUUID()}`],
      ),
      /ai_content_generations_brand_ownership_fk/,
    );

    const analysisKey = `analysis-${randomUUID()}`;
    const generationKey = `generation-${randomUUID()}`;
    const generation = await database.query(
      `insert into ai_content_generations
         (workspace_id, brand_id, type, title, status,
          analysis_idempotency_key, generation_idempotency_key)
       values ($1, $2, 'card_news', 'Runtime generation', 'queued', $3, $4)
       returning id`,
      [workspaceId, brandId, analysisKey, generationKey],
    );
    const generationId = generation.rows[0].id;

    await assert.rejects(
      database.query(
        `insert into ai_content_generations
           (workspace_id, brand_id, type, title, status,
            analysis_idempotency_key)
         values ($1, $2, 'blog', 'Duplicate analysis', 'draft', $3)`,
        [workspaceId, brandId, analysisKey],
      ),
      /ai_content_generations_brand_analysis_key_unique/,
    );
    await assert.rejects(
      database.query(
        `insert into ai_content_generations
           (workspace_id, brand_id, type, title, status,
            analysis_idempotency_key, generation_idempotency_key)
         values ($1, $2, 'marketing', 'Duplicate generation', 'draft', $3, $4)`,
        [workspaceId, brandId, `analysis-${randomUUID()}`, generationKey],
      ),
      /uq_ai_content_generation_key/,
    );

    const output = await database.query(
      `insert into ai_content_generation_outputs
         (workspace_id, brand_id, generation_id, output_index, title, status)
       values ($1, $2, $3, 1, 'Runtime output', 'queued')
       returning id`,
      [workspaceId, brandId, generationId],
    );
    const outputId = output.rows[0].id;

    await assert.rejects(
      database.query(
        `insert into ai_content_generation_outputs
           (workspace_id, brand_id, generation_id, output_index, title, status)
         values ($1, $2, $3, 1, 'Duplicate output', 'queued')`,
        [workspaceId, brandId, generationId],
      ),
      /ai_content_generation_outputs_generation_index_unique/,
    );
    await assert.rejects(
      database.query(
        `insert into ai_content_generation_outputs
           (workspace_id, brand_id, generation_id, output_index, title, status)
         values ($1, $2, $3, 2, 'Wrong output owner', 'queued')`,
        [otherWorkspaceId, otherBrandId, generationId],
      ),
      /ai_content_generation_outputs_generation_ownership_fk/,
    );

    const secondGeneration = await database.query(
      `insert into ai_content_generations
         (workspace_id, brand_id, type, title, status,
          analysis_idempotency_key)
       values ($1, $2, 'card_news', 'Second runtime generation', 'queued', $3)
       returning id`,
      [workspaceId, brandId, `analysis-${randomUUID()}`],
    );
    const secondGenerationId = secondGeneration.rows[0].id;
    const secondOutput = await database.query(
      `insert into ai_content_generation_outputs
         (workspace_id, brand_id, generation_id, output_index, title, status)
       values ($1, $2, $3, 1, 'Second runtime output', 'queued')
       returning id`,
      [workspaceId, brandId, secondGenerationId],
    );
    const secondOutputId = secondOutput.rows[0].id;

    await database.query(
      `insert into ai_content_generation_jobs
         (workspace_id, brand_id, generation_id, job_type, content_type, status)
       values ($1, $2, $3, 'analyze', 'card_news', 'queued')`,
      [workspaceId, brandId, generationId],
    );
    await assert.rejects(
      database.query(
        `insert into ai_content_generation_jobs
           (workspace_id, brand_id, generation_id, job_type, content_type, status)
         values ($1, $2, $3, 'analyze', 'card_news', 'processing')`,
        [workspaceId, brandId, generationId],
      ),
      /uq_ai_content_active_analyze_job/,
    );

    await database.query(
      `insert into ai_content_generation_jobs
         (workspace_id, brand_id, generation_id, output_id, job_type,
          content_type, status)
       values ($1, $2, $3, $4, 'generate', 'card_news', 'queued')`,
      [workspaceId, brandId, generationId, outputId],
    );
    await assert.rejects(
      database.query(
        `insert into ai_content_generation_jobs
           (workspace_id, brand_id, generation_id, output_id, job_type,
            content_type, status)
         values ($1, $2, $3, $4, 'generate', 'card_news', 'processing')`,
        [workspaceId, brandId, generationId, outputId],
      ),
      /uq_ai_content_active_generate_job/,
    );
    await assert.rejects(
      database.query(
        `insert into ai_content_generation_jobs
           (workspace_id, brand_id, generation_id, output_id, job_type,
            content_type, status)
         values ($1, $2, $3, $4, 'generate', 'card_news', 'failed')`,
        [otherWorkspaceId, otherBrandId, generationId, outputId],
      ),
      /ai_content_generation_jobs_generation_ownership_fk/,
    );
    await assert.rejects(
      database.query(
        `insert into ai_content_generation_jobs
           (workspace_id, brand_id, generation_id, output_id, job_type,
            content_type, status)
         values ($1, $2, $3, $4, 'generate', 'card_news', 'failed')`,
        [workspaceId, brandId, generationId, secondOutputId],
      ),
      /ai_content_generation_jobs_output_ownership_fk/,
    );

    await assert.rejects(
      database.query(
        `insert into ai_content_usage_ledger
           (workspace_id, brand_id, generation_id, output_id, usage_type,
            quantity, usage_date, idempotency_key)
         values ($1, $2, $3, $4, 'preview', 1, current_date, $5)`,
        [workspaceId, brandId, generationId, outputId, `usage-${randomUUID()}`],
      ),
      /ai_content_usage_ledger_type_check/,
    );
    await assert.rejects(
      database.query(
        `insert into ai_content_usage_ledger
           (workspace_id, brand_id, generation_id, output_id, usage_type,
            quantity, usage_date, idempotency_key)
         values ($1, $2, $3, $4, 'new_download', 1, current_date, $5)`,
        [
          workspaceId,
          brandId,
          generationId,
          secondOutputId,
          `usage-${randomUUID()}`,
        ],
      ),
      /ai_content_usage_ledger_output_ownership_fk/,
    );

    const indexes = await database.query(`
      select indexname, indexdef
      from pg_indexes
      where schemaname = 'public'
        and indexname in (
          'uq_ai_content_generation_key',
          'uq_ai_content_active_analyze_job',
          'uq_ai_content_active_generate_job',
          'ai_content_generation_jobs_claim_idx',
          'ai_content_usage_ledger_idempotency_unique'
        )
      order by indexname
    `);
    assert.deepEqual(
      indexes.rows.map(({ indexname }) => indexname),
      [
        "ai_content_generation_jobs_claim_idx",
        "ai_content_usage_ledger_idempotency_unique",
        "uq_ai_content_active_analyze_job",
        "uq_ai_content_active_generate_job",
        "uq_ai_content_generation_key",
      ],
    );
    assert.match(
      indexes.rows.find(({ indexname }) =>
        indexname === "ai_content_generation_jobs_claim_idx"
      ).indexdef,
      /\(content_type, status, available_at, created_at\)/i,
    );

    const channelOutputLink = await database.query(`
      select data_type, is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'channel_outputs'
        and column_name = 'ai_content_generation_output_id'
    `);
    assert.deepEqual(channelOutputLink.rows, [
      { data_type: "uuid", is_nullable: "YES" },
    ]);
  });
});

test("046 stores trend relevance and content performance learning milestones", async () => {
  const migrations = await loadMigrations();
  await withDatabase(async (database) => {
    await runMigrationRange(database, migrations, "001_initial_schema.sql", "046_content_quality_learning.sql");

    const columns = await database.query(`
      select table_name, column_name, is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and (
          (table_name = 'instagram_trend_hashtag_media'
            and column_name in ('relevance_score', 'relevance_status', 'relevance_reason'))
          or
          (table_name = 'content_performance_snapshots'
            and column_name in ('measurement_window', 'content_features'))
        )
      order by table_name, column_name
    `);
    assert.deepEqual(columns.rows, [
      { table_name: "content_performance_snapshots", column_name: "content_features", is_nullable: "NO" },
      { table_name: "content_performance_snapshots", column_name: "measurement_window", is_nullable: "YES" },
      { table_name: "instagram_trend_hashtag_media", column_name: "relevance_reason", is_nullable: "YES" },
      { table_name: "instagram_trend_hashtag_media", column_name: "relevance_score", is_nullable: "NO" },
      { table_name: "instagram_trend_hashtag_media", column_name: "relevance_status", is_nullable: "NO" },
    ]);

    const indexes = await database.query(`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and indexname in (
          'instagram_trend_hashtag_media_relevant_idx',
          'content_performance_snapshot_milestone_unique'
        )
      order by indexname
    `);
    assert.deepEqual(indexes.rows.map(({ indexname }) => indexname), [
      "content_performance_snapshot_milestone_unique",
      "instagram_trend_hashtag_media_relevant_idx",
    ]);

    const constraints = await database.query(`
      select conname, pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conname in (
        'content_performance_snapshots_measurement_window_check',
        'content_performance_snapshots_content_features_object_check',
        'instagram_trend_hashtag_media_relevance_score_check',
        'instagram_trend_hashtag_media_relevance_status_check'
      )
      order by conname
    `);
    assert.deepEqual(constraints.rows.map(({ conname }) => conname), [
      "content_performance_snapshots_content_features_object_check",
      "content_performance_snapshots_measurement_window_check",
      "instagram_trend_hashtag_media_relevance_score_check",
      "instagram_trend_hashtag_media_relevance_status_check",
    ]);
    assert.match(
      constraints.rows.find(({ conname }) =>
        conname === "content_performance_snapshots_measurement_window_check"
      ).definition,
      /24h.*72h.*7d/i,
    );
  });
});

test("047 creates tenant-safe cached subject analyses and archived images", async () => {
  const migrations = await loadMigrations();
  const migration047 = migrations.find(
    (migration) => migration.id === "047_ai_content_subject_analysis.sql",
  );
  assert.ok(migration047, "047 subject analysis migration must exist");

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "047_ai_content_subject_analysis.sql",
    );

    const tables = await database.query(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in (
          'ai_content_subject_analyses',
          'ai_content_subject_images'
        )
      order by table_name
    `);
    assert.deepEqual(tables.rows.map(({ table_name }) => table_name), [
      "ai_content_subject_analyses",
      "ai_content_subject_images",
    ]);

    assert.deepEqual(
      await readConstraintValues(
        database,
        "ai_content_subject_analyses",
        "ai_content_subject_analyses_subject_type_check",
      ),
      ["product", "service"],
    );
    assert.deepEqual(
      await readConstraintValues(
        database,
        "ai_content_subject_analyses",
        "ai_content_subject_analyses_status_check",
      ),
      ["extracting", "failed", "partial", "queued", "ready", "researching"],
    );
    assert.deepEqual(
      await readConstraintValues(
        database,
        "ai_content_subject_images",
        "ai_content_subject_images_role_check",
      ),
      ["detail", "logo", "product", "service", "unknown"],
    );

    const jsonConstraints = await database.query(`
      select conname
      from pg_constraint
      where conname in (
        'ai_content_subject_analyses_input_json_object_check',
        'ai_content_subject_analyses_facts_json_array_check',
        'ai_content_subject_analyses_structured_data_json_object_check',
        'ai_content_subject_analyses_research_json_object_check',
        'ai_content_subject_analyses_targets_json_array_check',
        'ai_content_subject_analyses_appeals_json_object_check',
        'ai_content_generations_subject_analysis_snapshot_object_check'
      )
      order by conname
    `);
    assert.equal(jsonConstraints.rows.length, 7);

    const workspace = await database.query(
      "insert into workspaces (name, slug) values ($1, $2) returning id",
      ["Subject Analysis", `subject-analysis-${randomUUID()}`],
    );
    const workspaceId = workspace.rows[0].id;
    const brand = await database.query(
      "insert into brands (workspace_id, name) values ($1, $2) returning id",
      [workspaceId, "Subject Analysis Brand"],
    );
    const brandId = brand.rows[0].id;
    const otherWorkspace = await database.query(
      "insert into workspaces (name, slug) values ($1, $2) returning id",
      ["Other Subject Analysis", `other-subject-analysis-${randomUUID()}`],
    );
    const otherWorkspaceId = otherWorkspace.rows[0].id;
    const otherBrand = await database.query(
      "insert into brands (workspace_id, name) values ($1, $2) returning id",
      [otherWorkspaceId, "Other Subject Analysis Brand"],
    );
    const otherBrandId = otherBrand.rows[0].id;

    await assert.rejects(
      database.query(
        `insert into ai_content_subject_analyses
           (workspace_id, brand_id, subject_type, source_url, normalized_url,
            status, idempotency_key)
         values ($1, $2, 'product', 'https://example.com/a',
                 'https://example.com/a', 'queued', $3)`,
        [otherWorkspaceId, brandId, `wrong-owner-${randomUUID()}`],
      ),
      /ai_content_subject_analyses_brand_ownership_fk/,
    );

    const analysisKey = `analysis-${randomUUID()}`;
    const analysis = await database.query(
      `insert into ai_content_subject_analyses
         (workspace_id, brand_id, subject_type, source_url, normalized_url,
          status, idempotency_key, leased_by, lease_token, lease_expires_at)
       values ($1, $2, 'product', 'https://example.com/product?utm_source=test',
               'https://example.com/product', 'queued', $3, 'worker-1', $4,
               now() + interval '5 minutes')
       returning id, analysis_version`,
      [workspaceId, brandId, analysisKey, randomUUID()],
    );
    const analysisId = analysis.rows[0].id;
    assert.equal(analysis.rows[0].analysis_version, 1);

    await assert.rejects(
      database.query(
        `insert into ai_content_subject_analyses
           (workspace_id, brand_id, subject_type, source_url, normalized_url,
            status, idempotency_key)
         values ($1, $2, 'service', 'https://example.com/service',
                 'https://example.com/service', 'queued', $3)`,
        [workspaceId, brandId, analysisKey],
      ),
      /ai_content_subject_analyses_brand_idempotency_key_unique/,
    );
    await assert.rejects(
      database.query(
        `insert into ai_content_subject_analyses
           (workspace_id, brand_id, subject_type, source_url, normalized_url,
            status, idempotency_key, analysis_version)
         values ($1, $2, 'product', 'https://example.com/product',
                 'https://example.com/product', 'researching', $3, 2)`,
        [workspaceId, brandId, `active-cache-${randomUUID()}`],
      ),
      /ai_content_subject_active_cache_uq/,
    );

    const image = await database.query(
      `insert into ai_content_subject_images
         (analysis_id, workspace_id, brand_id, source_url, storage_url,
          storage_path, width, height, mime_type, alt_text, role,
          selection_score)
       values ($1, $2, $3, 'https://cdn.example.com/product.jpg',
               'https://storage.example.com/product.jpg',
               'subject-analysis/product.jpg', 1200, 1200, 'image/jpeg',
               'Product front view', 'product', 0.95)
       returning id`,
      [analysisId, workspaceId, brandId],
    );
    const imageId = image.rows[0].id;
    await database.query(
      `update ai_content_subject_analyses
       set selected_image_id = $1
       where id = $2`,
      [imageId, analysisId],
    );

    await assert.rejects(
      database.query(
        `insert into ai_content_subject_images
           (analysis_id, workspace_id, brand_id, source_url, storage_url,
            storage_path, mime_type, role)
         values ($1, $2, $3, 'https://cdn.example.com/wrong.jpg',
                 'https://storage.example.com/wrong.jpg',
                 'subject-analysis/wrong.jpg', 'image/jpeg', 'unknown')`,
        [analysisId, otherWorkspaceId, otherBrandId],
      ),
      /ai_content_subject_images_analysis_ownership_fk/,
    );

    const otherAnalysis = await database.query(
      `insert into ai_content_subject_analyses
         (workspace_id, brand_id, subject_type, source_url, normalized_url,
          status, idempotency_key)
       values ($1, $2, 'service', 'https://example.com/other-service',
               'https://example.com/other-service', 'ready', $3)
       returning id`,
      [workspaceId, brandId, `other-analysis-${randomUUID()}`],
    );
    await assert.rejects(
      database.query(
        `update ai_content_subject_analyses
         set selected_image_id = $1
         where id = $2`,
        [imageId, otherAnalysis.rows[0].id],
      ),
      /ai_content_subject_selected_image_fk/,
    );

    const indexes = await database.query(`
      select indexname, indexdef
      from pg_indexes
      where schemaname = 'public'
        and indexname in (
          'ai_content_subject_active_cache_uq',
          'ai_content_subject_claim_idx',
          'ai_content_subject_analyses_workspace_idx',
          'ai_content_subject_images_workspace_idx',
          'ai_content_subject_images_brand_workspace_idx',
          'ai_content_subject_images_analysis_ownership_idx'
        )
      order by indexname
    `);
    assert.deepEqual(indexes.rows.map(({ indexname }) => indexname), [
      "ai_content_subject_active_cache_uq",
      "ai_content_subject_analyses_workspace_idx",
      "ai_content_subject_claim_idx",
      "ai_content_subject_images_analysis_ownership_idx",
      "ai_content_subject_images_brand_workspace_idx",
      "ai_content_subject_images_workspace_idx",
    ]);
    assert.match(
      indexes.rows.find(({ indexname }) =>
        indexname === "ai_content_subject_active_cache_uq"
      ).indexdef,
      /\(brand_id, subject_type, normalized_url\).*superseded_at is null/i,
    );
    assert.match(
      indexes.rows.find(({ indexname }) =>
        indexname === "ai_content_subject_claim_idx"
      ).indexdef,
      /\(available_at, created_at\).*status.*queued.*extracting.*researching/i,
    );

    const snapshotColumn = await database.query(`
      select data_type, is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'ai_content_generations'
        and column_name = 'subject_analysis_snapshot'
    `);
    assert.deepEqual(snapshotColumn.rows, [
      { data_type: "jsonb", is_nullable: "YES" },
    ]);
  });
});

test("048 allows one AI content output to publish to multiple channel formats", async () => {
  const migrations = await loadMigrations();
  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "048_ai_content_direct_social_publishing.sql",
    );

    const indexes = await database.query(`
      select indexname, indexdef
      from pg_indexes
      where schemaname = 'public'
        and indexname in (
          'uq_channel_outputs_ai_content_generation_target',
          'channel_outputs_current_master_channel_format_unique'
        )
      order by indexname
    `);
    assert.equal(indexes.rows.length, 2);
    const definitions = indexes.rows.map(({ indexdef }) => indexdef).join("\n");
    assert.match(definitions, /ai_content_generation_output_id, channel, delivery_format/i);
    assert.match(definitions, /master_draft_id, channel, delivery_format/i);

    const deliveryFormats = await readConstraintValues(
      database,
      "channel_outputs",
      "channel_outputs_delivery_format_check",
    );
    assert.ok(deliveryFormats.includes("instagram_feed_single"));
  });
});

test("049 creates tenant-safe versioned brand intelligence analyses", async () => {
  const migrations = await loadMigrations();
  const migration049 = migrations.find(
    (migration) => migration.id === "049_brand_intelligence_onboarding.sql",
  );
  assert.ok(migration049, "049 brand intelligence migration must exist");

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "049_brand_intelligence_onboarding.sql",
    );

    const tables = await database.query(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in ('brand_analysis_runs', 'brand_analysis_uploads')
      order by table_name
    `);
    assert.deepEqual(tables.rows.map(({ table_name }) => table_name), [
      "brand_analysis_runs",
      "brand_analysis_uploads",
    ]);
    assert.deepEqual(
      await readConstraintValues(
        database,
        "brand_analysis_runs",
        "brand_analysis_runs_status_check",
      ),
      ["analyzing", "confirmed", "extracting", "failed", "queued", "review_ready"],
    );

    const activeColumn = await database.query(`
      select data_type, is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'brand_profiles'
        and column_name = 'active_brand_analysis_id'
    `);
    assert.deepEqual(activeColumn.rows, [{ data_type: "uuid", is_nullable: "YES" }]);

    const indexes = await database.query(`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and indexname in (
          'brand_analysis_runs_one_active_per_brand_uq',
          'brand_analysis_runs_claim_idx'
        )
      order by indexname
    `);
    assert.deepEqual(indexes.rows.map(({ indexname }) => indexname), [
      "brand_analysis_runs_claim_idx",
      "brand_analysis_runs_one_active_per_brand_uq",
    ]);

  });
});

test("055 backfills tenant-safe approved brand core and rules without mutating confirmed analyses", async () => {
  const migrations = await loadMigrations();
  const migration055 = migrations.find(
    (migration) => migration.id === "055_brand_core_and_rules.sql",
  );
  assert.ok(migration055, "055 brand core migration must exist");

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "054_feedback_submissions.sql",
    );

    const user = await database.query(
      "insert into app_users (email) values ($1) returning id",
      [`brand-core-${randomUUID()}@example.com`],
    );
    const workspace = await database.query(
      "insert into workspaces (name, slug, created_by_user_id) values ('Brand Core', $1, $2) returning id",
      [`brand-core-${randomUUID()}`, user.rows[0].id],
    );
    await database.query(
      "insert into workspace_members (workspace_id, user_id, role, status) values ($1, $2, 'owner', 'active')",
      [workspace.rows[0].id, user.rows[0].id],
    );
    const firstBrand = await database.query(
      "insert into brands (workspace_id, name) values ($1, 'First Brand') returning id",
      [workspace.rows[0].id],
    );
    const secondBrand = await database.query(
      "insert into brands (workspace_id, name) values ($1, 'Second Brand') returning id",
      [workspace.rows[0].id],
    );
    await database.query(
      `insert into brand_profiles (
         workspace_id, brand_id, forbidden_terms, default_cta, auto_approval_enabled
       ) values
       ($1, $2, '["금지 표현"]'::jsonb, '지금 확인하기', true),
       ($1, $3, '[]'::jsonb, null, false)`,
      [workspace.rows[0].id, firstBrand.rows[0].id, secondBrand.rows[0].id],
    );
    const analysis = await database.query(
      `insert into brand_analysis_runs (
         workspace_id, brand_id, status, input_json, evidence_json, result_json,
         edited_result_json, idempotency_key, is_active, confirmed_at
       ) values (
         $1, $2, 'confirmed', '{}'::jsonb, '[{"sourceId":"owned"}]'::jsonb,
         '{"primaryTarget":"AI 고객","businessDescription":"AI 설명"}'::jsonb,
         '{"primaryTarget":"사용자 고객","businessDescription":"사용자 설명","evidence":[{"field":"businessDescription","claim":"사용자 설명","sourceId":"owned-url","sourceUrl":"https://example.com/about"}]}'::jsonb,
         'confirmed-1', true, now()
       ) returning id, result_json, edited_result_json`,
      [workspace.rows[0].id, firstBrand.rows[0].id],
    );
    await database.query(
      "update brand_profiles set active_brand_analysis_id = $1 where brand_id = $2",
      [analysis.rows[0].id, firstBrand.rows[0].id],
    );
    const knowledgeImport = await database.query(
      `insert into knowledge_imports (
         workspace_id, brand_id, file_name, source_rows, result_json, status
       ) values ($1, $2, 'legacy.json', '[]'::jsonb, '{}'::jsonb, 'succeeded') returning id`,
      [workspace.rows[0].id, firstBrand.rows[0].id],
    );
    await database.query(
      `insert into knowledge_entries (
         workspace_id, brand_id, normalized_question, entry_type, title, content,
         structured_data, direct_reply_enabled, enabled, last_import_id
       ) values (
         $1, $2, '__confirmed_brand_intelligence__', 'policy', 'Legacy', 'Legacy projection',
         '{}'::jsonb, false, true, $3
       )`,
      [workspace.rows[0].id, firstBrand.rows[0].id, knowledgeImport.rows[0].id],
    );

    await database.exec(migration055.sql);
    await database.exec(migration055.sql);

    const core = await database.query(
      `select id, source_analysis_id, version, status, core_json, evidence_json, created_by
         from brand_core_versions
        where workspace_id = $1 and brand_id = $2`,
      [workspace.rows[0].id, firstBrand.rows[0].id],
    );
    assert.equal(core.rows.length, 1);
    assert.equal(core.rows[0].source_analysis_id, analysis.rows[0].id);
    assert.equal(core.rows[0].version, 1);
    assert.equal(core.rows[0].status, "approved");
    assert.equal(core.rows[0].core_json.contractVersion, "brand-core.v1");
    assert.equal(core.rows[0].core_json.audiences[0].name, "사용자 고객");
    assert.deepEqual(core.rows[0].evidence_json, [{
      fieldPath: "summary.description",
      sourceType: "owned_url",
      sourceId: "owned-url",
      sourceUrl: "https://example.com/about",
      excerpt: "사용자 설명",
      confidence: null,
    }]);
    assert.equal(core.rows[0].created_by, "migration");

    const profile = await database.query(
      `select active_brand_analysis_id, active_brand_core_id, active_brand_rule_set_id
         from brand_profiles where brand_id = $1`,
      [firstBrand.rows[0].id],
    );
    assert.equal(profile.rows[0].active_brand_analysis_id, analysis.rows[0].id);
    assert.equal(profile.rows[0].active_brand_core_id, core.rows[0].id);
    assert.ok(profile.rows[0].active_brand_rule_set_id);

    const rules = await database.query(
      "select status, rules_json from brand_rule_sets where brand_id = $1",
      [firstBrand.rows[0].id],
    );
    assert.equal(rules.rows.length, 1);
    assert.equal(rules.rows[0].status, "approved");
    assert.deepEqual(rules.rows[0].rules_json.forbiddenPhrases, ["금지 표현"]);
    assert.equal(rules.rows[0].rules_json.ctaRules.defaultCta, "지금 확인하기");

    const legacy = await database.query(
      `select enabled, direct_reply_enabled, structured_data
         from knowledge_entries
        where brand_id = $1 and normalized_question = '__confirmed_brand_intelligence__'`,
      [firstBrand.rows[0].id],
    );
    assert.equal(legacy.rows[0].enabled, false);
    assert.equal(legacy.rows[0].direct_reply_enabled, false);
    assert.equal(legacy.rows[0].structured_data.legacyProjection, true);

    await assert.rejects(
      database.query(
        "update brand_profiles set active_brand_core_id = $1 where brand_id = $2",
        [core.rows[0].id, secondBrand.rows[0].id],
      ),
    );
    const unchanged = await database.query(
      "select result_json, edited_result_json from brand_analysis_runs where id = $1",
      [analysis.rows[0].id],
    );
    assert.deepEqual(unchanged.rows[0], {
      result_json: analysis.rows[0].result_json,
      edited_result_json: analysis.rows[0].edited_result_json,
    });
  });
});

test("069 preserves the newest open brand analysis and terminally supersedes older duplicates", async () => {
  const migrations = await loadMigrations();
  const migration069 = migrations.find(
    (migration) => migration.id === "069_brand_analysis_one_open_workflow.sql",
  );
  assert.ok(migration069, "069 brand analysis open workflow migration must exist");
  assert.match(
    migration069.sql,
    /begin;\s*lock table brand_analysis_runs in share row exclusive mode;\s*with ranked as/i,
  );

  await withDatabase(async (database) => {
    await runMigrationRange(database, migrations, "001_initial_schema.sql", "049_brand_intelligence_onboarding.sql");
    const workspace = await database.query(
      "insert into workspaces (name, slug) values ('Open workflows', $1) returning id",
      [`open-workflows-${randomUUID()}`],
    );
    const brand = await database.query(
      "insert into brands (workspace_id, name) values ($1, 'Workflow Brand') returning id",
      [workspace.rows[0].id],
    );
    const runs = await database.query(
      `insert into brand_analysis_runs (
         workspace_id, brand_id, status, idempotency_key, created_at
       ) values
         ($1, $2, 'review_ready', 'older-open', '2026-07-29T00:00:00Z'),
         ($1, $2, 'queued', 'newer-open', '2026-07-30T00:00:00Z')
       returning id, idempotency_key`,
      [workspace.rows[0].id, brand.rows[0].id],
    );

    await database.exec(migration069.sql);

    const after = await database.query(
      `select id, idempotency_key, status, error_code, completed_at
         from brand_analysis_runs
        where brand_id = $1
        order by created_at`,
      [brand.rows[0].id],
    );
    assert.equal(after.rows.length, 2);
    assert.deepEqual(after.rows.map((row) => ({
      idempotencyKey: row.idempotency_key,
      status: row.status,
      errorCode: row.error_code,
      completed: row.completed_at !== null,
    })), [
      {
        idempotencyKey: "older-open",
        status: "failed",
        errorCode: "brand_analysis_superseded",
        completed: true,
      },
      {
        idempotencyKey: "newer-open",
        status: "queued",
        errorCode: null,
        completed: false,
      },
    ]);
    assert.notEqual(runs.rows[0].id, runs.rows[1].id);
    await assert.rejects(
      database.query(
        `insert into brand_analysis_runs (workspace_id, brand_id, status, idempotency_key)
         values ($1, $2, 'analyzing', 'third-open')`,
        [workspace.rows[0].id, brand.rows[0].id],
      ),
    );
  });
});

test("068 refuses legacy duplicate core drafts without changing user data", async () => {
  const migrations = await loadMigrations();
  const migration068 = migrations.find(
    (migration) => migration.id === "068_brand_core_one_draft.sql",
  );
  assert.ok(migration068, "068 brand core draft uniqueness migration must exist");

  await withDatabase(async (database) => {
    await runMigrationRange(database, migrations, "001_initial_schema.sql", "055_brand_core_and_rules.sql");
    const workspace = await database.query(
      "insert into workspaces (name, slug) values ('Legacy Drafts', $1) returning id",
      [`legacy-drafts-${randomUUID()}`],
    );
    const brand = await database.query(
      "insert into brands (workspace_id, name) values ($1, 'Legacy Draft Brand') returning id",
      [workspace.rows[0].id],
    );
    await database.query(
      "insert into brand_profiles (workspace_id, brand_id) values ($1, $2)",
      [workspace.rows[0].id, brand.rows[0].id],
    );
    await database.query(
      `insert into brand_core_versions (
         workspace_id, brand_id, version, status, core_json, created_by
       ) values
         ($1, $2, 1, 'draft', '{}'::jsonb, 'migration'),
         ($1, $2, 2, 'draft', '{}'::jsonb, 'migration')`,
      [workspace.rows[0].id, brand.rows[0].id],
    );

    await assert.rejects(
      database.exec(migration068.sql),
      /brand_core_duplicate_drafts_require_manual_resolution/,
    );
    const drafts = await database.query(
      `select id, version from brand_core_versions
        where workspace_id = $1 and brand_id = $2 and status = 'draft'
        order by version`,
      [workspace.rows[0].id, brand.rows[0].id],
    );
    assert.equal(drafts.rows.length, 2);
    assert.deepEqual(drafts.rows.map((row) => row.version), [1, 2]);
  });
});

test("056 backfills legacy product knowledge into one approved reusable product", async () => {
  const migrations = await loadMigrations();
  const migration056 = migrations.find(
    (migration) => migration.id === "056_product_service_library.sql",
  );
  assert.ok(migration056, "056 product service migration must exist");

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "055_brand_core_and_rules.sql",
    );
    const workspace = await database.query(
      "insert into workspaces (name, slug) values ('Products', $1) returning id",
      [`products-${randomUUID()}`],
    );
    const brand = await database.query(
      "insert into brands (workspace_id, name) values ($1, 'Product Brand') returning id",
      [workspace.rows[0].id],
    );
    const knowledgeImport = await database.query(
      `insert into knowledge_imports (
         workspace_id, brand_id, file_name, source_rows, result_json, status
       ) values ($1, $2, 'products.csv', '[]', '{}', 'succeeded') returning id`,
      [workspace.rows[0].id, brand.rows[0].id],
    );
    const legacy = await database.query(
      `insert into knowledge_entries (
         workspace_id, brand_id, normalized_question, entry_type, title, content,
         structured_data, last_import_id
       ) values (
         $1, $2, 'legacy-product', 'product', '기존 제품', '기존 설명',
         '{"features":["기능"]}', $3
       ) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, knowledgeImport.rows[0].id],
    );

    await database.exec(migration056.sql);
    await database.exec(migration056.sql);

    const items = await database.query(
      `select item.id, item.active_version_id, version.profile_json, version.status
         from product_services item
         join product_service_versions version on version.id = item.active_version_id
        where item.brand_id = $1`,
      [brand.rows[0].id],
    );
    assert.equal(items.rows.length, 1);
    assert.equal(items.rows[0].status, "approved");
    assert.equal(items.rows[0].profile_json.contractVersion, "product-service.v1");
    assert.deepEqual(items.rows[0].profile_json.features, ["기능"]);

    const projection = await database.query(
      "select status, provenance_json from knowledge_entries where id = $1",
      [legacy.rows[0].id],
    );
    assert.equal(projection.rows[0].status, "legacy_projection");
    assert.equal(projection.rows[0].provenance_json.productServiceId, items.rows[0].id);
  });
});

test("migration runner upgrades the original 056 state to Wiki source kinds in 057", async () => {
  const migrations = await loadMigrations();
  const migration056 = migrations.find(
    (migration) => migration.id === "056_product_service_library.sql",
  );
  const migration057 = migrations.find(
    (migration) => migration.id === "057_wiki_source_kinds.sql",
  );
  assert.equal(
    migration056?.checksum,
    originalProductServiceLibraryChecksum,
    "committed migration 056 must remain byte-for-byte stable",
  );
  assert.ok(migration057, "057 Wiki source kinds migration must exist");
  const runnableMigrations = migrations.filter(
    (migration) => !migration.sql.startsWith("-- requires: pgvector")
      && migration.id !== "027_wiki_search_v2.sql"
      && migration.id <= "057_wiki_source_kinds.sql",
  );
  const through056 = runnableMigrations.filter(
    (migration) => migration.id <= "056_product_service_library.sql",
  );
  const sourceKinds = [
    "faq",
    "product",
    "product_service",
    "service",
    "policy",
    "guide",
    "owned_snapshot",
  ].sort();

  await withDatabase(async (database) => {
    const client = createPgliteMigrationClient(database);
    const initial = await runMigrationsWithClient({
      client,
      migrations: through056,
    });
    assert.equal(initial.pending.at(-1), "056_product_service_library.sql");

    const stored056 = await database.query(
      "select checksum from schema_migrations where id = '056_product_service_library.sql'",
    );
    assert.equal(stored056.rows[0].checksum, originalProductServiceLibraryChecksum);
    assert.deepEqual(
      await readConstraintValues(
        database,
        "wiki_build_items",
        "wiki_build_items_source_kind_check",
      ),
      ["faq", "owned_snapshot", "policy", "product"],
    );
    const beforeColumn = await database.query(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'wiki_documents'
         and column_name = 'product_service_id'`,
    );
    assert.equal(beforeColumn.rows.length, 0);

    const upgraded = await runMigrationsWithClient({
      client,
      migrations: runnableMigrations,
    });
    assert.deepEqual(upgraded.pending, ["057_wiki_source_kinds.sql"]);

    for (const [table, constraint] of [
      ["wiki_build_items", "wiki_build_items_source_kind_check"],
      ["wiki_documents", "wiki_documents_source_kind_check"],
      ["wiki_source_units", "wiki_source_units_source_kind_check"],
    ]) {
      assert.deepEqual(
        await readConstraintValues(database, table, constraint),
        sourceKinds,
      );
    }
    const column = await database.query(
      `select is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'wiki_documents'
         and column_name = 'product_service_id'`,
    );
    assert.deepEqual(column.rows, [{ is_nullable: "YES" }]);
    const foreignKey = await database.query(
      `select pg_get_constraintdef(oid) as definition
       from pg_constraint
       where conrelid = 'wiki_documents'::regclass
         and conname = 'wiki_documents_product_service_ownership_fk'`,
    );
    assert.match(
      foreignKey.rows[0].definition,
      /FOREIGN KEY \(product_service_id, workspace_id, brand_id\).*product_services\(id, workspace_id, brand_id\)/,
    );
    const index = await database.query(
      `select indexname from pg_indexes
       where schemaname = 'public'
         and indexname = 'wiki_documents_version_product_service_unique'`,
    );
    assert.equal(index.rows.length, 1);
    const history = await database.query(
      `select id, checksum from schema_migrations
       where id in ('056_product_service_library.sql', '057_wiki_source_kinds.sql')
       order by id`,
    );
    assert.equal(history.rows.length, 2);
    assert.deepEqual(history.rows[0], {
      id: "056_product_service_library.sql",
      checksum: originalProductServiceLibraryChecksum,
    });

    const repeated = await runMigrationsWithClient({
      client,
      migrations: runnableMigrations,
    });
    assert.deepEqual(repeated.pending, []);
  });
});

test("057 upgrades existing Wiki rows and accepts every source kind idempotently", async () => {
  const migrations = await loadMigrations();
  const migration056 = migrations.find(
    (migration) => migration.id === "056_product_service_library.sql",
  );
  assert.ok(migration056, "056 product service migration must exist");
  const migration057 = migrations.find(
    (migration) => migration.id === "057_wiki_source_kinds.sql",
  );
  assert.ok(migration057, "057 Wiki source kinds migration must exist");
  const sourceKinds = [
    "faq",
    "product",
    "product_service",
    "service",
    "policy",
    "guide",
    "owned_snapshot",
  ].sort();

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "055_brand_core_and_rules.sql",
    );
    const workspace = await database.query(
      "insert into workspaces (name, slug) values ('Wiki Upgrade', $1) returning id",
      [`wiki-upgrade-${randomUUID()}`],
    );
    const brand = await database.query(
      "insert into brands (workspace_id, name) values ($1, 'Wiki Upgrade Brand') returning id",
      [workspace.rows[0].id],
    );
    const knowledgeImport = await database.query(
      `insert into knowledge_imports (
         workspace_id, brand_id, file_name, source_rows, result_json, status
       ) values ($1, $2, 'wiki.csv', '[]', '{}', 'succeeded') returning id`,
      [workspace.rows[0].id, brand.rows[0].id],
    );
    const existingEntry = await database.query(
      `insert into knowledge_entries (
         workspace_id, brand_id, normalized_question, question, answer, entry_type,
         title, content, last_import_id
       ) values ($1, $2, 'existing-faq', '기존 질문', '기존 답변', 'faq',
         '기존 질문', '기존 답변', $3) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, knowledgeImport.rows[0].id],
    );
    const legacyProduct = await database.query(
      `insert into knowledge_entries (
         workspace_id, brand_id, normalized_question, entry_type, title, content,
         last_import_id
       ) values ($1, $2, 'existing-product', 'product', '기존 제품', '기존 제품 설명',
         $3) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, knowledgeImport.rows[0].id],
    );
    const version = await database.query(
      `insert into wiki_versions (workspace_id, brand_id, status, build_stage)
       values ($1, $2, 'building', 'collecting') returning id`,
      [workspace.rows[0].id, brand.rows[0].id],
    );
    const existingBuildItem = await database.query(
      `insert into wiki_build_items (
         workspace_id, brand_id, wiki_version_id, source_kind, source_id
       ) values ($1, $2, $3, 'faq', $4) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, version.rows[0].id, existingEntry.rows[0].id],
    );
    const existingDocument = await database.query(
      `insert into wiki_documents (
         workspace_id, brand_id, wiki_version_id, source_kind, knowledge_entry_id,
         title, content, content_hash, is_active
       ) values ($1, $2, $3, 'faq', $4, '기존 질문', '기존 답변', 'existing-document', false)
       returning id`,
      [workspace.rows[0].id, brand.rows[0].id, version.rows[0].id, existingEntry.rows[0].id],
    );
    const existingUnit = await database.query(
      `insert into wiki_source_units (
         workspace_id, brand_id, wiki_version_id, source_kind, source_id,
         unit_type, stable_key, title, content, content_hash, source_quote
       ) values ($1, $2, $3, 'faq', $4, 'faq', 'faq:existing',
         '기존 질문', '기존 답변', 'existing-unit', '기존 답변') returning id`,
      [workspace.rows[0].id, brand.rows[0].id, version.rows[0].id, existingEntry.rows[0].id],
    );

    await database.exec(migration056.sql);
    await database.exec(migration057.sql);
    await database.exec(migration057.sql);

    for (const [table, constraint] of [
      ["wiki_build_items", "wiki_build_items_source_kind_check"],
      ["wiki_documents", "wiki_documents_source_kind_check"],
      ["wiki_source_units", "wiki_source_units_source_kind_check"],
    ]) {
      assert.deepEqual(
        await readConstraintValues(database, table, constraint),
        sourceKinds,
      );
    }

    const preserved = await database.query(
      `select
         exists(select 1 from wiki_build_items where id = $1) as build_item,
         exists(select 1 from wiki_documents where id = $2) as document,
         exists(select 1 from wiki_source_units where id = $3) as source_unit`,
      [existingBuildItem.rows[0].id, existingDocument.rows[0].id, existingUnit.rows[0].id],
    );
    assert.deepEqual(preserved.rows[0], {
      build_item: true,
      document: true,
      source_unit: true,
    });

    const directEntries = await database.query(
      `insert into knowledge_entries (
         workspace_id, brand_id, normalized_question, entry_type, title, content,
         last_import_id, origin
       ) values
         ($1, $2, 'service-entry', 'service', '서비스', '서비스 설명', null, 'manual'),
         ($1, $2, 'guide-entry', 'guide', '가이드', '가이드 설명', null, 'manual')
       returning id, entry_type`,
      [workspace.rows[0].id, brand.rows[0].id],
    );
    const entryIds = new Map(directEntries.rows.map((row) => [row.entry_type, row.id]));
    const productService = await database.query(
      `select product_service_id as id
         from product_service_legacy_mappings
        where knowledge_entry_id = $1`,
      [legacyProduct.rows[0].id],
    );
    assert.equal(productService.rows.length, 1);

    for (const [sourceKind, sourceId, unitType] of [
      ["product_service", productService.rows[0].id, "product"],
      ["service", entryIds.get("service"), "service"],
      ["guide", entryIds.get("guide"), "guide_section"],
    ]) {
      await database.query(
        `insert into wiki_build_items (
           workspace_id, brand_id, wiki_version_id, source_kind, source_id
         ) values ($1, $2, $3, $4, $5)`,
        [workspace.rows[0].id, brand.rows[0].id, version.rows[0].id, sourceKind, sourceId],
      );
      await database.query(
        `insert into wiki_source_units (
           workspace_id, brand_id, wiki_version_id, source_kind, source_id,
           unit_type, stable_key, title, content, content_hash, source_quote
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $9)`,
        [
          workspace.rows[0].id,
          brand.rows[0].id,
          version.rows[0].id,
          sourceKind,
          sourceId,
          unitType,
          `${sourceKind}:new`,
          `${sourceKind} title`,
          `${sourceKind} content`,
          `${sourceKind}-hash`,
        ],
      );
    }

    await database.query(
      `insert into wiki_documents (
         workspace_id, brand_id, wiki_version_id, source_kind, knowledge_entry_id,
         title, content, content_hash, is_active
       ) values
         ($1, $2, $3, 'service', $4, '서비스', '서비스 설명', 'service-document', false),
         ($1, $2, $3, 'guide', $5, '가이드', '가이드 설명', 'guide-document', false)`,
      [
        workspace.rows[0].id,
        brand.rows[0].id,
        version.rows[0].id,
        entryIds.get("service"),
        entryIds.get("guide"),
      ],
    );
    await database.query(
      `insert into wiki_documents (
         workspace_id, brand_id, wiki_version_id, source_kind, product_service_id,
         title, content, content_hash, is_active
       ) values ($1, $2, $3, 'product_service', $4,
         '기존 제품', '기존 제품 설명', 'product-service-document', false)`,
      [
        workspace.rows[0].id,
        brand.rows[0].id,
        version.rows[0].id,
        productService.rows[0].id,
      ],
    );

    const insertedKinds = await database.query(
      `select distinct source_kind
         from wiki_source_units
        where wiki_version_id = $1
          and source_kind in ('product_service', 'service', 'guide')
        order by source_kind`,
      [version.rows[0].id],
    );
    assert.deepEqual(
      insertedKinds.rows.map((row) => row.source_kind),
      ["guide", "product_service", "service"],
    );
  });
});

test("058 backfills one canonical trend item plus unlinked active reference URLs idempotently", async () => {
  const migrations = await loadMigrations();
  const migration058 = migrations.find(
    (migration) => migration.id === "058_avatar_and_reference_libraries.sql",
  );
  assert.ok(migration058, "058 avatar and reference libraries migration must exist");

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "057_wiki_source_kinds.sql",
    );
    const actor = await database.query(
      "insert into app_users (email) values ($1) returning id",
      [`libraries-${randomUUID()}@example.com`],
    );
    const workspace = await database.query(
      "insert into workspaces (name, slug) values ('Libraries', $1) returning id",
      [`libraries-${randomUUID()}`],
    );
    await database.query(
      "insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')",
      [workspace.rows[0].id, actor.rows[0].id],
    );
    const brand = await database.query(
      "insert into brands (workspace_id, name) values ($1, 'Library Brand') returning id",
      [workspace.rows[0].id],
    );
    const otherBrand = await database.query(
      "insert into brands (workspace_id, name) values ($1, 'Other Brand') returning id",
      [workspace.rows[0].id],
    );
    const linkedSource = await database.query(
      `insert into source_urls (
         workspace_id, brand_id, source_type, url, url_hash, status, enabled
       ) values ($1, $2, 'reference', 'https://example.com/trend', $3, 'crawled', true)
       returning id`,
      [workspace.rows[0].id, brand.rows[0].id, `trend-${randomUUID()}`],
    );
    const standaloneSource = await database.query(
      `insert into source_urls (
         workspace_id, brand_id, source_type, url, url_hash, title, status, enabled
       ) values ($1, $2, 'reference', 'https://example.com/standalone', $3,
         'Standalone', 'active', true)
       returning id`,
      [workspace.rows[0].id, brand.rows[0].id, `standalone-${randomUUID()}`],
    );
    await database.query(
      `insert into source_urls (
         workspace_id, brand_id, source_type, url, url_hash, status, enabled
       ) values ($1, $2, 'owned', 'https://example.com/owned', $3, 'active', true)`,
      [workspace.rows[0].id, brand.rows[0].id, `owned-${randomUUID()}`],
    );
    const media = await database.query(
      `insert into instagram_trend_media (
         instagram_media_id, username, caption, media_type, media_url, permalink,
         last_fetched_at
       ) values ($1, 'real_creator', 'Legacy trend', 'IMAGE',
         'https://cdn.example.com/trend.webp', 'https://instagram.com/p/legacy', now())
       returning id`,
      [`media-${randomUUID()}`],
    );
    const saved = await database.query(
      `insert into brand_trend_saved_media (
         workspace_id, brand_id, trend_media_id, source_url_id
       ) values ($1, $2, $3, $4) returning id`,
      [
        workspace.rows[0].id,
        brand.rows[0].id,
        media.rows[0].id,
        linkedSource.rows[0].id,
      ],
    );

    await database.exec(migration058.sql);
    await database.exec(migration058.sql);

    const items = await database.query(
      `select kind, saved_trend_id, source_url_id, content_purpose, source_url
         from reference_items
        where brand_id = $1
        order by kind`,
      [brand.rows[0].id],
    );
    assert.deepEqual(items.rows, [
      {
        kind: "external_url",
        saved_trend_id: null,
        source_url_id: standaloneSource.rows[0].id,
        content_purpose: "both",
        source_url: "https://example.com/standalone",
      },
      {
        kind: "trend",
        saved_trend_id: saved.rows[0].id,
        source_url_id: null,
        content_purpose: "both",
        source_url: "https://example.com/trend",
      },
    ]);
    const provenance = await database.query(
      `select source_url_id
         from reference_item_source_url_provenance
        where workspace_id = $1 and brand_id = $2`,
      [workspace.rows[0].id, brand.rows[0].id],
    );
    assert.deepEqual(provenance.rows, [{ source_url_id: linkedSource.rows[0].id }]);
    const purposes = await database.query(
      "select source_type, content_purpose from source_urls where brand_id = $1 order by source_type, url",
      [brand.rows[0].id],
    );
    assert.ok(purposes.rows.every((row) => row.content_purpose === "both"));
    await assert.rejects(database.query(
      `update source_urls
          set content_purpose = 'marketing'
        where brand_id = $1 and source_type = 'owned'`,
      [brand.rows[0].id],
    ));

    await database.exec("begin");
    const avatar = await database.query(
      `insert into brand_avatars (
         workspace_id, brand_id, name, is_default, created_by_user_id
       ) values ($1, $2, 'Founder', true, $3) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, actor.rows[0].id],
    );
    await database.query(
      `insert into brand_avatar_images (
         workspace_id, brand_id, avatar_id, position, is_representative,
         storage_url, storage_path, mime_type, size_bytes, checksum, created_by_user_id
       ) values ($1, $2, $3, 1, true, 'https://cdn.example.com/avatar.webp',
         'avatars/avatar.webp', 'image/webp', 1024, $4, $5)`,
      [
        workspace.rows[0].id,
        brand.rows[0].id,
        avatar.rows[0].id,
        "a".repeat(64),
        actor.rows[0].id,
      ],
    );
    await database.exec("commit");
    await assert.rejects(database.query(
      `insert into brand_avatars (
         workspace_id, brand_id, name, is_default, created_by_user_id
       ) values ($1, $2, 'Duplicate default', true, $3)`,
      [workspace.rows[0].id, brand.rows[0].id, actor.rows[0].id],
    ));
    await assert.rejects(database.query(
      `insert into brand_avatar_images (
         workspace_id, brand_id, avatar_id, position, is_representative,
         storage_url, storage_path, mime_type, size_bytes, checksum, created_by_user_id
       ) values ($1, $2, $3, 2, true, 'https://cdn.example.com/avatar-2.webp',
         'avatars/avatar-2.webp', 'image/webp', 1024, $4, $5)`,
      [
        workspace.rows[0].id,
        brand.rows[0].id,
        avatar.rows[0].id,
        "b".repeat(64),
        actor.rows[0].id,
      ],
    ));
    await assert.rejects(database.query(
      `insert into brand_avatar_images (
         workspace_id, brand_id, avatar_id, position, is_representative,
         storage_url, storage_path, mime_type, size_bytes, checksum, created_by_user_id
       ) values ($1, $2, $3, 2, false, 'https://cdn.example.com/cross.webp',
         'avatars/cross.webp', 'image/webp', 1024, $4, $5)`,
      [
        workspace.rows[0].id,
        otherBrand.rows[0].id,
        avatar.rows[0].id,
        "c".repeat(64),
        actor.rows[0].id,
      ],
    ));
    await assert.rejects(database.query(
      `insert into reference_items (
         workspace_id, brand_id, kind, source_url_id, saved_trend_id, created_by_user_id
       ) values ($1, $2, 'trend', $3, $4, $5)`,
      [
        workspace.rows[0].id,
        brand.rows[0].id,
        standaloneSource.rows[0].id,
        saved.rows[0].id,
        actor.rows[0].id,
      ],
    ));
    await assert.rejects(database.query(
      `insert into reference_items (
         workspace_id, brand_id, kind, source_url_id, created_by_user_id
       ) values ($1, $2, 'external_url', $3, $4)`,
      [
        workspace.rows[0].id,
        otherBrand.rows[0].id,
        standaloneSource.rows[0].id,
        actor.rows[0].id,
      ],
    ));
  });
});

test("060 upgrades legacy generations idempotently without truncating oversized reference history", async () => {
  const migrations = await loadMigrations();
  const migration060 = migrations.find(
    (migration) => migration.id === "060_content_orchestration.sql",
  );
  assert.ok(migration060, "060 content orchestration migration must exist");

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "058_avatar_and_reference_libraries.sql",
    );
    const workspace = await database.query(
      "insert into workspaces (name, slug) values ('Orchestration upgrade', $1) returning id",
      [`orchestration-upgrade-${randomUUID()}`],
    );
    const brand = await database.query(
      "insert into brands (workspace_id, name) values ($1, 'Legacy content') returning id",
      [workspace.rows[0].id],
    );
    const generation = await database.query(
      `insert into ai_content_generations (
         workspace_id, brand_id, type, title, analysis_idempotency_key, draft_json
       ) values ($1, $2, 'marketing', 'Legacy generation', $3, '{"contractVersion":"content-generation-input.v2"}')
       returning id`,
      [workspace.rows[0].id, brand.rows[0].id, `legacy-${randomUUID()}`],
    );
    for (let position = 1; position <= 7; position += 1) {
      await database.query(
        `insert into ai_content_generation_references (
           generation_id, reference_id, workspace_id, brand_id, position
         ) values ($1, $2, $3, $4, $5)`,
        [
          generation.rows[0].id,
          randomUUID(),
          workspace.rows[0].id,
          brand.rows[0].id,
          position,
        ],
      );
    }

    await database.exec(migration060.sql);
    await database.exec(migration060.sql);

    const upgraded = await database.query(
      `select content_family, output_format, orchestration_snapshot, draft_json
         from ai_content_generations where id = $1`,
      [generation.rows[0].id],
    );
    assert.deepEqual(upgraded.rows[0], {
      content_family: "marketing",
      output_format: "single_image",
      orchestration_snapshot: null,
      draft_json: { contractVersion: "content-generation-input.v2" },
    });
    const references = await database.query(
      "select count(*)::integer as count, max(position)::integer as max_position from ai_content_generation_references where generation_id = $1",
      [generation.rows[0].id],
    );
    assert.deepEqual(references.rows[0], { count: 7, max_position: 7 });
    const audit = await database.query(
      `select reference_count, exceeds_canonical_limit
         from ai_content_generation_reference_migration_audits
        where generation_id = $1`,
      [generation.rows[0].id],
    );
    assert.deepEqual(audit.rows, [{ reference_count: 7, exceeds_canonical_limit: true }]);

    for (const table of [
      "ai_content_proposal_batches",
      "ai_content_proposals",
      "ai_content_proposal_jobs",
      "ai_content_approved_proposal_versions",
      "ai_content_generation_briefs",
      "ai_content_create_idempotency_records",
      "reference_snapshots",
      "reference_pattern_versions",
    ]) {
      const found = await database.query("select to_regclass($1) as name", [table]);
      assert.equal(found.rows[0].name, table);
    }
  });
});

test("060 independently validates sealed one-time avatar receipts and remains compatible through 065", async () => {
  const migrations = await loadMigrations();
  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "060_content_orchestration.sql",
    );

    const actorId = randomUUID();
    const workspaceId = randomUUID();
    const brandId = randomUUID();
    const coreId = randomUUID();
    const rulesId = randomUUID();
    const batchId = randomUUID();
    const proposalId = randomUUID();
    const approvalId = randomUUID();
    const otherBatchId = randomUUID();
    const otherProposalId = randomUUID();
    const otherApprovalId = randomUUID();
    const generationId = randomUUID();
    const otherGenerationId = randomUUID();
    await database.query(
      "insert into app_users (id,email) values ($1,$2)",
      [actorId, `through-060-${randomUUID()}@example.com`],
    );
    await database.query(
      "insert into workspaces (id,name,slug,created_by_user_id) values ($1,'Through 060',$2,$3)",
      [workspaceId, `through-060-${randomUUID()}`, actorId],
    );
    await database.query(
      `insert into workspace_members (workspace_id,user_id,role,status)
       values ($1,$2,'owner','active')`,
      [workspaceId, actorId],
    );
    await database.query(
      "insert into brands (id,workspace_id,name,created_by_user_id) values ($1,$2,'Through 060 Brand',$3)",
      [brandId, workspaceId, actorId],
    );
    await database.query(
      "insert into brand_profiles (workspace_id,brand_id) values ($1,$2)",
      [workspaceId, brandId],
    );
    await database.query(
      `insert into brand_core_versions (
         id,workspace_id,brand_id,version,status,core_json,created_by,approved_at
       ) values ($1,$2,$3,1,'approved','{}','user','2026-07-28T00:00:00Z')`,
      [coreId, workspaceId, brandId],
    );
    await database.query(
      `insert into brand_rule_sets (
         id,workspace_id,brand_id,version,status,rules_json,created_by,approved_at
       ) values ($1,$2,$3,1,'approved','{}','user','2026-07-28T00:00:00Z')`,
      [rulesId, workspaceId, brandId],
    );
    await database.query(
      `update brand_profiles
          set active_brand_core_id=$1,active_brand_rule_set_id=$2
        where workspace_id=$3 and brand_id=$4`,
      [coreId, rulesId, workspaceId, brandId],
    );
    await database.query(
      `insert into ai_content_proposal_batches (
         id,workspace_id,brand_id,origin,content_family,request_json,
         source_snapshot_json,status,idempotency_key,created_by_user_id
       ) values
         ($1,$3,$4,'manual','marketing','{}','[]','ready',$5,$7),
         ($2,$3,$4,'manual','marketing','{}','[]','ready',$6,$7)`,
      [
        batchId,
        otherBatchId,
        workspaceId,
        brandId,
        `through-060-${randomUUID()}`,
        `through-060-other-${randomUUID()}`,
        actorId,
      ],
    );
    await database.query(
      `insert into ai_content_proposals (
         id,workspace_id,brand_id,batch_id,position,proposal_json,status,
         selected_by_user_id,selected_at
       ) values
         ($1,$3,$4,$5,1,'{}','selected',$7,'2026-07-28T00:00:00Z'),
         ($2,$3,$4,$6,1,'{}','selected',$7,'2026-07-28T00:00:00Z')`,
      [proposalId, otherProposalId, workspaceId, brandId, batchId, otherBatchId, actorId],
    );
    const approvalSnapshot = {
      contractVersion: "approved-proposal.v1",
      sourceProposalId: proposalId,
      revision: 1,
      effectiveProposal: { contractVersion: "content-proposal.v1" },
      editPatch: [],
      validationResultId: `through-060-${approvalId}`,
      approvedBy: actorId,
      approvedAt: "2026-07-28T00:00:00.000Z",
    };
    const otherApprovalSnapshot = {
      ...approvalSnapshot,
      sourceProposalId: otherProposalId,
      validationResultId: `through-060-${otherApprovalId}`,
    };
    await database.query(
      `insert into ai_content_approved_proposal_versions (
         id,workspace_id,brand_id,proposal_id,revision,approved_proposal_snapshot,
         validation_result_id,approved_by_user_id,approved_at
       ) values ($1,$2,$3,$4,1,$5,$6,$7,$8)`,
      [
        approvalId,
        workspaceId,
        brandId,
        proposalId,
        JSON.stringify(approvalSnapshot),
        approvalSnapshot.validationResultId,
        actorId,
        approvalSnapshot.approvedAt,
      ],
    );
    await database.query(
      `insert into ai_content_approved_proposal_versions (
         id,workspace_id,brand_id,proposal_id,revision,approved_proposal_snapshot,
         validation_result_id,approved_by_user_id,approved_at
       ) values ($1,$2,$3,$4,1,$5,$6,$7,$8)`,
      [
        otherApprovalId,
        workspaceId,
        brandId,
        otherProposalId,
        JSON.stringify(otherApprovalSnapshot),
        otherApprovalSnapshot.validationResultId,
        actorId,
        otherApprovalSnapshot.approvedAt,
      ],
    );
    await database.query(
      `insert into ai_content_generations (
         id,workspace_id,brand_id,type,title,analysis_idempotency_key,
         content_family,output_format,subject_mode
       ) values
         ($1,$3,$4,'marketing','Through 060 target',$5,'marketing','single_image',
          'brand_topic'),
         ($2,$3,$4,'marketing','Through 060 other',$6,'marketing','single_image',
          'brand_topic')`,
      [
        generationId,
        otherGenerationId,
        workspaceId,
        brandId,
        `through-060-target-${randomUUID()}`,
        `through-060-other-${randomUUID()}`,
      ],
    );

    const avatarSnapshot = (sessionId, receiptId) => ({
      id: sessionId,
      assetVersionId: receiptId,
      objectHash: "d".repeat(64),
      mime: "image/png",
      provenance: "one_time",
    });
    const brief = (
      avatar,
      selectedProposalId = proposalId,
      selectedApprovalId = approvalId,
      selectedApprovalSnapshot = approvalSnapshot,
    ) => ({
      contractVersion: "generation-brief.v1",
      proposalId: selectedProposalId,
      approvedProposalVersionId: selectedApprovalId,
      approvedProposalSnapshot: selectedApprovalSnapshot,
      brandCoreVersionId: coreId,
      ruleSetVersionId: rulesId,
      subject: { kind: "brand_topic", topic: "Through 060", brandCoreEvidenceIds: [] },
      wikiSnapshots: [],
      references: [],
      avatar,
      outputFormat: "single_image",
      channels: ["instagram"],
      promptDefinitionVersions: { generation: "generation.v1" },
    });
    const pendingAvatar = avatarSnapshot(randomUUID(), randomUUID());
    await assert.rejects(
      database.query(
        "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)",
        [
          generationId,
          workspaceId,
          brandId,
          JSON.stringify(brief(pendingAvatar)),
          JSON.stringify(pendingAvatar),
          actorId,
        ],
      ),
      /one_time_avatar_receipt_invalid/,
    );

    const crossSessionId = randomUUID();
    const crossReceiptId = randomUUID();
    await database.query(
      `insert into ai_content_one_time_avatar_receipts (
         id,upload_session_id,generation_id,workspace_id,brand_id,created_by_user_id,
         object_hash,mime_type,storage_url,storage_path,confirmed_at
       ) values ($1,$2,$3,$4,$5,$6,$7,'image/png',$8,$9,'2026-07-28T00:00:00Z')`,
      [
        crossReceiptId,
        crossSessionId,
        otherGenerationId,
        workspaceId,
        brandId,
        actorId,
        "d".repeat(64),
        `https://cdn.example.com/${crossReceiptId}.png`,
        `one-time/${crossReceiptId}.png`,
      ],
    );
    const crossAvatar = avatarSnapshot(crossSessionId, crossReceiptId);
    await assert.rejects(
      database.query(
        "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)",
        [
          generationId,
          workspaceId,
          brandId,
          JSON.stringify(brief(crossAvatar)),
          JSON.stringify(crossAvatar),
          actorId,
        ],
      ),
      /one_time_avatar_receipt_invalid/,
    );

    const sessionId = randomUUID();
    const receiptId = randomUUID();
    await database.query(
      `insert into ai_content_one_time_avatar_receipts (
         id,upload_session_id,generation_id,workspace_id,brand_id,created_by_user_id,
         object_hash,mime_type,storage_url,storage_path,confirmed_at
       ) values ($1,$2,$3,$4,$5,$6,$7,'image/png',$8,$9,'2026-07-28T00:00:00Z')`,
      [
        receiptId,
        sessionId,
        generationId,
        workspaceId,
        brandId,
        actorId,
        "d".repeat(64),
        `https://cdn.example.com/${receiptId}.png`,
        `one-time/${receiptId}.png`,
      ],
    );
    const confirmedAvatar = avatarSnapshot(sessionId, receiptId);
    await database.query(
      "select revoke_ai_content_one_time_avatar_receipt($1,'attachment_unavailable')",
      [receiptId],
    );
    await assert.rejects(
      database.query(
        "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)",
        [
          generationId,
          workspaceId,
          brandId,
          JSON.stringify(brief(confirmedAvatar)),
          JSON.stringify(confirmedAvatar),
          actorId,
        ],
      ),
      /one_time_avatar_receipt_revoked/,
    );

    const otherBrief = brief(
      crossAvatar,
      otherProposalId,
      otherApprovalId,
      otherApprovalSnapshot,
    );
    const started = await database.query(
      "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6) generation_id",
      [
        otherGenerationId,
        workspaceId,
        brandId,
        JSON.stringify(otherBrief),
        JSON.stringify(crossAvatar),
        actorId,
      ],
    );
    assert.equal(started.rows[0].generation_id, otherGenerationId);
    await database.query(
      "select revoke_ai_content_one_time_avatar_receipt($1,'attachment_logically_deleted')",
      [crossReceiptId],
    );
    const replayed = await database.query(
      "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6) generation_id",
      [
        otherGenerationId,
        workspaceId,
        brandId,
        JSON.stringify(otherBrief),
        JSON.stringify(crossAvatar),
        actorId,
      ],
    );
    assert.equal(replayed.rows[0].generation_id, otherGenerationId);
    await assert.rejects(
      database.query(
        "update ai_content_one_time_avatar_revocations set reason='attachment_deleting' where receipt_id=$1",
        [receiptId],
      ),
      /one_time_avatar_revocation_immutable/,
    );

    const staleReceiptId = randomUUID();
    const staleAttachmentId = randomUUID();
    const staleSessionId = randomUUID();
    const staleStorageUrl = `https://cdn.example.com/${staleAttachmentId}.png`;
    const staleStoragePath = `one-time/${staleAttachmentId}.png`;
    const activeReceiptId = randomUUID();
    const activeSessionId = randomUUID();
    const activeStorageUrl = `https://cdn.example.com/${activeReceiptId}.png`;
    const activeStoragePath = `one-time/${activeReceiptId}.png`;
    await database.query(
      `insert into ai_content_one_time_avatar_receipts (
         id,upload_session_id,generation_id,workspace_id,brand_id,created_by_user_id,
         object_hash,mime_type,storage_url,storage_path,confirmed_at
       ) values
         ($1,$2,$7,$8,$9,$10,$11,'image/png',$3,$4,'2026-07-28T00:00:00Z'),
         ($5,$6,$7,$8,$9,$10,$11,'image/png',$12,$13,'2026-07-28T00:00:00Z')`,
      [
        staleReceiptId,
        staleSessionId,
        staleStorageUrl,
        staleStoragePath,
        activeReceiptId,
        activeSessionId,
        generationId,
        workspaceId,
        brandId,
        actorId,
        "f".repeat(64),
        activeStorageUrl,
        activeStoragePath,
      ],
    );
    await database.query(
      `insert into ai_content_generation_attachments (
         id,generation_id,workspace_id,brand_id,role,file_name,mime_type,size_bytes,
         checksum,storage_url,storage_path
       ) values
         ($1,$3,$4,$5,'person','stale.png','image/png',1024,$6,$7,$8),
         ($2,$3,$4,$5,'person','active.png','image/png',1024,$6,$9,$10)`,
      [
        staleAttachmentId,
        activeReceiptId,
        generationId,
        workspaceId,
        brandId,
        "f".repeat(64),
        staleStorageUrl,
        staleStoragePath,
        activeStorageUrl,
        activeStoragePath,
      ],
    );
    await database.query(
      "update ai_content_generation_attachments set deleted_at=now() where id=$1",
      [staleAttachmentId],
    );

    await runMigrationRange(
      database,
      migrations,
      "061_avatar_image_checksum_uniqueness.sql",
      "065_ai_content_attachment_upload_sessions.sql",
    );
    const retained = await database.query(
      "select id,upload_session_id from ai_content_one_time_avatar_receipts where id=$1",
      [receiptId],
    );
    assert.deepEqual(retained.rows, [{ id: receiptId, upload_session_id: sessionId }]);
    const backfilledRevocations = await database.query(
      `select receipt_id,reason
         from ai_content_one_time_avatar_revocations
        where receipt_id in ($1,$2)
        order by receipt_id`,
      [staleReceiptId, activeReceiptId],
    );
    assert.deepEqual(backfilledRevocations.rows, [{
      receipt_id: staleReceiptId,
      reason: "attachment_logically_deleted",
    }]);
    const staleAvatar = {
      ...avatarSnapshot(staleSessionId, staleReceiptId),
      objectHash: "f".repeat(64),
    };
    await assert.rejects(
      database.query(
        "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)",
        [
          generationId,
          workspaceId,
          brandId,
          JSON.stringify(brief(staleAvatar)),
          JSON.stringify(staleAvatar),
          actorId,
        ],
      ),
      /one_time_avatar_receipt_revoked/,
    );

    const compatibleGenerationId = randomUUID();
    const compatibleSessionId = randomUUID();
    const compatibleAttachmentId = randomUUID();
    await database.query(
      `insert into ai_content_generations (
         id,workspace_id,brand_id,type,title,analysis_idempotency_key,
         content_family,output_format,subject_mode,generation_input_snapshot
       ) values ($1,$2,$3,'marketing','065 mapping',$4,'marketing','single_image',
         'brand_topic','{"contractVersion":"content-generation-input.v2","contentType":"marketing"}')`,
      [compatibleGenerationId, workspaceId, brandId, `065-mapping-${randomUUID()}`],
    );
    await database.query(
      `insert into ai_content_attachment_upload_sessions (
         id,generation_id,workspace_id,brand_id,created_by_user_id,role,file_name,
         expected_mime_type,expected_size_bytes,expected_checksum,storage_url,storage_path
       ) values ($1,$2,$3,$4,$5,'person','avatar.png','image/png',1024,$6,$7,$8)`,
      [
        compatibleSessionId,
        compatibleGenerationId,
        workspaceId,
        brandId,
        actorId,
        "e".repeat(64),
        `https://cdn.example.com/${compatibleAttachmentId}.png`,
        `one-time/${compatibleAttachmentId}.png`,
      ],
    );
    await database.query(
      `insert into ai_content_generation_attachments (
         id,generation_id,workspace_id,brand_id,upload_session_id,role,file_name,
         mime_type,size_bytes,checksum,storage_url,storage_path
       ) values ($1,$2,$3,$4,$5,'person','avatar.png','image/png',1024,$6,$7,$8)`,
      [
        compatibleAttachmentId,
        compatibleGenerationId,
        workspaceId,
        brandId,
        compatibleSessionId,
        "e".repeat(64),
        `https://cdn.example.com/${compatibleAttachmentId}.png`,
        `one-time/${compatibleAttachmentId}.png`,
      ],
    );
    await database.query(
      `update ai_content_attachment_upload_sessions
          set status='confirmed',confirmed_at=now(),confirmed_attachment_id=$2
        where id=$1`,
      [compatibleSessionId, compatibleAttachmentId],
    );
    const mapped = await database.query(
      `select id,upload_session_id,generation_id,created_by_user_id,object_hash,mime_type
         from ai_content_one_time_avatar_receipts where id=$1`,
      [compatibleAttachmentId],
    );
    assert.deepEqual(mapped.rows, [{
      id: compatibleAttachmentId,
      upload_session_id: compatibleSessionId,
      generation_id: compatibleGenerationId,
      created_by_user_id: actorId,
      object_hash: "e".repeat(64),
      mime_type: "image/png",
    }]);
  });
});

test("061 deterministically removes legacy duplicate avatar bytes and prevents new duplicates", async () => {
  const migrations = await loadMigrations();
  const migration061 = migrations.find(
    (migration) => migration.id === "061_avatar_image_checksum_uniqueness.sql",
  );
  assert.ok(migration061, "061 avatar image checksum uniqueness migration must exist");

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "058_avatar_and_reference_libraries.sql",
    );
    const actor = await database.query(
      "insert into app_users (email) values ($1) returning id",
      [`avatar-checksum-${randomUUID()}@example.com`],
    );
    const workspace = await database.query(
      "insert into workspaces (name, slug) values ('Avatar checksum', $1) returning id",
      [`avatar-checksum-${randomUUID()}`],
    );
    await database.query(
      "insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')",
      [workspace.rows[0].id, actor.rows[0].id],
    );
    const brand = await database.query(
      "insert into brands (workspace_id, name) values ($1, 'Checksum Brand') returning id",
      [workspace.rows[0].id],
    );
    await database.exec("begin");
    const avatar = await database.query(
      `insert into brand_avatars (workspace_id, brand_id, name, created_by_user_id)
       values ($1, $2, 'Legacy duplicate', $3) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, actor.rows[0].id],
    );
    const firstImageId = randomUUID();
    const representativeImageId = randomUUID();
    const duplicateChecksum = "d".repeat(64);
    await database.query(
      `insert into brand_avatar_images (
         id, workspace_id, brand_id, avatar_id, position, is_representative,
         storage_url, storage_path, mime_type, size_bytes, checksum, created_by_user_id
       ) values
       ($1, $2, $3, $4, 1, false, 'https://cdn.example.com/legacy-first.webp',
        'avatars/legacy-first.webp', 'image/webp', 100, $5, $6),
       ($7, $2, $3, $4, 2, true, 'https://cdn.example.com/legacy-representative.webp',
        'avatars/legacy-representative.webp', 'image/webp', 100, $5, $6)`,
      [
        firstImageId,
        workspace.rows[0].id,
        brand.rows[0].id,
        avatar.rows[0].id,
        duplicateChecksum,
        actor.rows[0].id,
        representativeImageId,
      ],
    );
    await database.exec("commit");

    await database.exec(migration061.sql);
    await database.exec(migration061.sql);

    const retained = await database.query(
      `select id, position, is_representative
         from brand_avatar_images
        where avatar_id = $1`,
      [avatar.rows[0].id],
    );
    assert.deepEqual(retained.rows, [{
      id: representativeImageId,
      position: 1,
      is_representative: true,
    }]);
    await assert.rejects(database.query(
      `insert into brand_avatar_images (
         workspace_id, brand_id, avatar_id, position, is_representative,
         storage_url, storage_path, mime_type, size_bytes, checksum, created_by_user_id
       ) values ($1, $2, $3, 1, false, 'https://cdn.example.com/new-duplicate.webp',
         'avatars/new-duplicate.webp', 'image/webp', 100, $4, $5)`,
      [
        workspace.rows[0].id,
        brand.rows[0].id,
        avatar.rows[0].id,
        duplicateChecksum,
        actor.rows[0].id,
      ],
    ));
  });
});

test("migration runner records forward-only 060 through 073 without changing the applied 058 checksum", async () => {
  const migrations = await loadMigrations();
  const runnableMigrations = migrations.filter(
    (migration) => !migration.sql.startsWith("-- requires: pgvector")
      && migration.id !== "027_wiki_search_v2.sql",
  );
  const through058 = runnableMigrations.filter(
    (migration) => migration.id <= "058_avatar_and_reference_libraries.sql",
  );

  await withDatabase(async (database) => {
    const client = createPgliteMigrationClient(database);
    await runMigrationsWithClient({ client, migrations: through058 });
    const before = await database.query(
      "select id, checksum from schema_migrations order by id desc limit 1",
    );
    assert.equal(before.rows[0].id, "058_avatar_and_reference_libraries.sql");
    assert.equal(
      before.rows[0].checksum,
      migrations.find((migration) => migration.id === "058_avatar_and_reference_libraries.sql")?.checksum,
    );

    const upgraded = await runMigrationsWithClient({
      client,
      migrations: runnableMigrations,
    });
    assert.deepEqual(upgraded.pending.slice(-14), [
      "060_content_orchestration.sql",
      "061_avatar_image_checksum_uniqueness.sql",
      "062_avatar_upload_cancellation.sql",
      "063_avatar_upload_finalization.sql",
      "064_reference_upload_finalization.sql",
      "065_ai_content_attachment_upload_sessions.sql",
      "066_ai_content_analyzed_subject_orchestration.sql",
      "067_wiki_refresh_outbox.sql",
      "068_brand_core_one_draft.sql",
      "069_brand_analysis_one_open_workflow.sql",
      "070_remove_embedding_runtime.sql",
      "071_brand_intelligence_onboarding_worker_v2.sql",
      "072_faq_suggestion_worker.sql",
      "073_ai_content_generation_v2_render_pipeline.sql",
    ]);
    const recorded = await database.query(
      "select id, checksum from schema_migrations where id in ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) order by id",
      [
        "058_avatar_and_reference_libraries.sql",
        "060_content_orchestration.sql",
        "061_avatar_image_checksum_uniqueness.sql",
        "062_avatar_upload_cancellation.sql",
        "063_avatar_upload_finalization.sql",
        "064_reference_upload_finalization.sql",
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
    assert.deepEqual(recorded.rows, [
      {
        id: "058_avatar_and_reference_libraries.sql",
        checksum: migrations.find((migration) => migration.id === "058_avatar_and_reference_libraries.sql")?.checksum,
      },
      {
        id: "060_content_orchestration.sql",
        checksum: migrations.find((migration) => migration.id === "060_content_orchestration.sql")?.checksum,
      },
      {
        id: "061_avatar_image_checksum_uniqueness.sql",
        checksum: migrations.find((migration) => migration.id === "061_avatar_image_checksum_uniqueness.sql")?.checksum,
      },
      {
        id: "062_avatar_upload_cancellation.sql",
        checksum: migrations.find((migration) => migration.id === "062_avatar_upload_cancellation.sql")?.checksum,
      },
      {
        id: "063_avatar_upload_finalization.sql",
        checksum: migrations.find((migration) => migration.id === "063_avatar_upload_finalization.sql")?.checksum,
      },
      {
        id: "064_reference_upload_finalization.sql",
        checksum: migrations.find((migration) => migration.id === "064_reference_upload_finalization.sql")?.checksum,
      },
      {
        id: "065_ai_content_attachment_upload_sessions.sql",
        checksum: migrations.find((migration) => migration.id === "065_ai_content_attachment_upload_sessions.sql")?.checksum,
      },
      {
        id: "066_ai_content_analyzed_subject_orchestration.sql",
        checksum: migrations.find((migration) => migration.id === "066_ai_content_analyzed_subject_orchestration.sql")?.checksum,
      },
      {
        id: "067_wiki_refresh_outbox.sql",
        checksum: migrations.find((migration) => migration.id === "067_wiki_refresh_outbox.sql")?.checksum,
      },
      {
        id: "068_brand_core_one_draft.sql",
        checksum: migrations.find((migration) => migration.id === "068_brand_core_one_draft.sql")?.checksum,
      },
      {
        id: "069_brand_analysis_one_open_workflow.sql",
        checksum: migrations.find((migration) => migration.id === "069_brand_analysis_one_open_workflow.sql")?.checksum,
      },
      {
        id: "070_remove_embedding_runtime.sql",
        checksum: migrations.find((migration) => migration.id === "070_remove_embedding_runtime.sql")?.checksum,
      },
      {
        id: "071_brand_intelligence_onboarding_worker_v2.sql",
        checksum: migrations.find((migration) => migration.id === "071_brand_intelligence_onboarding_worker_v2.sql")?.checksum,
      },
      {
        id: "072_faq_suggestion_worker.sql",
        checksum: migrations.find((migration) => migration.id === "072_faq_suggestion_worker.sql")?.checksum,
      },
      {
        id: "073_ai_content_generation_v2_render_pipeline.sql",
        checksum: migrations.find((migration) => migration.id === "073_ai_content_generation_v2_render_pipeline.sql")?.checksum,
      },
    ]);
    const repeated = await runMigrationsWithClient({
      client,
      migrations: runnableMigrations,
    });
    assert.deepEqual(repeated.pending, []);
  });
});

test("066 can be applied twice without duplicating its orchestration patch", async () => {
  const migrations = await loadMigrations();
  const migration066 = migrations.find(
    (migration) => migration.id === "066_ai_content_analyzed_subject_orchestration.sql",
  );
  assert.ok(migration066);

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "066_ai_content_analyzed_subject_orchestration.sql",
    );
    await database.exec(migration066.sql);
    const definition = await database.query(
      "select pg_get_functiondef('start_ai_content_orchestration(uuid,uuid,uuid,jsonb,jsonb,uuid)'::regprocedure) definition",
    );
    assert.equal(
      definition.rows[0].definition.match(/analyzed_subject_snapshot_invalid/g)?.length,
      1,
    );
  });
});

test("064 keeps reference upload cancellation identity separate from avatar receipts", async () => {
  const migrations = await loadMigrations();
  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "064_reference_upload_finalization.sql",
    );
    const columns = await database.query(
      `select column_name,is_nullable
        from information_schema.columns
        where table_schema='public'
          and table_name='reference_upload_cancellation_receipts'
        order by ordinal_position`,
    );
    const byName = new Map(columns.rows.map((row) => [row.column_name, row.is_nullable]));
    for (const required of [
      "session_id", "workspace_id", "brand_id", "created_by_user_id",
      "storage_path_prefix", "token_expires_at", "status", "next_attempt_at",
    ]) {
      assert.equal(byName.get(required), "NO");
    }
    assert.equal(byName.get("storage_path"), "YES");
    assert.equal(byName.has("avatar_id"), false);
    const dueIndex = await database.query(
      `select indexdef from pg_indexes
        where schemaname='public'
          and indexname='reference_upload_cancellation_receipts_due_idx'`,
    );
    assert.equal(dueIndex.rows.length, 1);
    assert.match(dueIndex.rows[0].indexdef, /WHERE \(status = 'pending'::text\)/i);
  });
});

test("063 upgrades pathless pre-062 sessions and backoff lets a newer cleanup enter the batch", async () => {
  const migrations = await loadMigrations();
  const migration062 = migrations.find((migration) => migration.id === "062_avatar_upload_cancellation.sql");
  const migration063 = migrations.find((migration) => migration.id === "063_avatar_upload_finalization.sql");
  assert.ok(migration062);
  assert.ok(migration063);

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "061_avatar_image_checksum_uniqueness.sql",
    );
    const actor = await database.query(
      "insert into app_users(email) values($1) returning id",
      [`avatar-cleanup-${randomUUID()}@example.com`],
    );
    const workspace = await database.query(
      "insert into workspaces(name,slug) values('Avatar cleanup',$1) returning id",
      [`avatar-cleanup-${randomUUID()}`],
    );
    await database.query(
      "insert into workspace_members(workspace_id,user_id,role) values($1,$2,'owner')",
      [workspace.rows[0].id, actor.rows[0].id],
    );
    const brand = await database.query(
      "insert into brands(workspace_id,name) values($1,'Cleanup Brand') returning id",
      [workspace.rows[0].id],
    );
    const avatarId = randomUUID();
    const sessionIds = Array.from({ length: 101 }, () => randomUUID());
    for (const [index, sessionId] of sessionIds.entries()) {
      await database.query(
        `insert into reference_upload_sessions(
          id,nonce,workspace_id,brand_id,storage_path_prefix,expected_mime_type,
          expected_size_bytes,expected_checksum,expires_at,created_by_user_id,created_at
        ) values($1,$2,$3,$4,$5,'image/webp',100,$6,
          now()-interval '10 minutes',$7,now()-interval '20 minutes')`,
        [
          sessionId,
          `legacy-cleanup-${index}-${randomUUID()}`,
          workspace.rows[0].id,
          brand.rows[0].id,
          `brands/${brand.rows[0].id}/asset-library/avatars/${avatarId}/${sessionId}/`,
          String(index).padStart(64, "0"),
          actor.rows[0].id,
        ],
      );
    }

    await database.exec(migration062.sql);
    const upgradedLegacy = await database.query(
      "select file_name,storage_path from reference_upload_sessions where id=$1",
      [sessionIds[0]],
    );
    assert.deepEqual(upgradedLegacy.rows, [{ file_name: null, storage_path: null }]);
    await database.exec(migration063.sql);

    for (const sessionId of sessionIds.slice(0, 100)) {
      await database.query(
        `insert into avatar_upload_cancellation_receipts(
          session_id,workspace_id,brand_id,avatar_id,created_by_user_id,storage_path,
          storage_path_prefix,token_expires_at,status,next_attempt_at,attempt_count,last_error,reason
        ) select id,workspace_id,brand_id,$2,created_by_user_id,null,storage_path_prefix,
          expires_at,'pending',now()+interval '1 hour',1,'provider unavailable','expired'
          from reference_upload_sessions where id=$1`,
        [sessionId, avatarId],
      );
    }
    const eligible = await database.query(
      `select session.id
        from reference_upload_sessions session
        left join avatar_upload_cancellation_receipts receipt on receipt.session_id=session.id
        where session.expires_at <= now()
          and (
            receipt.session_id is null
            or (receipt.status='pending' and receipt.token_expires_at <= now()
              and receipt.next_attempt_at <= now())
          )
        order by session.expires_at,session.id
        limit 100`,
    );
    assert.deepEqual(eligible.rows, [{ id: sessionIds[100] }]);
  });
});

const attachmentLifecycleCatalog = async (database) => {
  const columns = await database.query(`
    select table_name, column_name, data_type, is_nullable, column_default
      from information_schema.columns
     where table_schema = 'public'
       and table_name in (
         'ai_content_generations',
         'ai_content_generation_attachments',
         'ai_content_attachment_upload_sessions',
         'ai_content_attachment_deletion_jobs',
         'ai_content_attachment_storage_path_guards'
       )
     order by table_name, ordinal_position
  `);
  const constraints = await database.query(`
    select conrelid::regclass::text as table_name, conname,
           pg_get_constraintdef(oid) as definition,
           confdeltype, condeferrable, condeferred
      from pg_constraint
     where conrelid in (
       'ai_content_generations'::regclass,
       'ai_content_generation_attachments'::regclass,
       'ai_content_attachment_upload_sessions'::regclass,
       'ai_content_attachment_deletion_jobs'::regclass,
       'ai_content_attachment_storage_path_guards'::regclass
     )
     order by table_name, conname
  `);
  const indexes = await database.query(`
    select tablename, indexname, indexdef
      from pg_indexes
     where schemaname = 'public'
       and tablename in (
         'ai_content_generations',
         'ai_content_generation_attachments',
         'ai_content_attachment_upload_sessions',
         'ai_content_attachment_deletion_jobs',
         'ai_content_attachment_storage_path_guards'
       )
     order by tablename, indexname
  `);
  return { columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows };
};

const createAttachmentLifecycleIdentity = async (database, label) => {
  const actor = await database.query(
    "insert into app_users(email) values($1) returning id",
    [`${label}-${randomUUID()}@example.com`],
  );
  const workspace = await database.query(
    "insert into workspaces(name,slug) values($1,$2) returning id",
    [label, `${label}-${randomUUID()}`],
  );
  await database.query(
    "insert into workspace_members(workspace_id,user_id,role) values($1,$2,'owner')",
    [workspace.rows[0].id, actor.rows[0].id],
  );
  const brand = await database.query(
    "insert into brands(workspace_id,name) values($1,$2) returning id",
    [workspace.rows[0].id, label],
  );
  const generation = await database.query(
    `insert into ai_content_generations(
       workspace_id,brand_id,type,title,status,analysis_idempotency_key
     ) values($1,$2,'blog',$3,'queued',$4) returning id`,
    [workspace.rows[0].id, brand.rows[0].id, label, randomUUID()],
  );
  return {
    actorId: actor.rows[0].id,
    workspaceId: workspace.rows[0].id,
    brandId: brand.rows[0].id,
    generationId: generation.rows[0].id,
  };
};

test("073a fixes all 19 function configs and defeats TEMP relation shadowing", async () => {
  const migrations = await loadMigrations();
  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      legacyTriggerSearchPathMigrationId,
    );
    const configs = await database.query(
      `select requested.identity,function.proconfig
         from unnest($1::text[]) requested(identity)
         left join pg_proc function on function.oid=to_regprocedure(requested.identity)
        order by requested.identity`,
      [legacyTriggerSearchPathFunctionIdentities],
    );
    assert.equal(configs.rows.length, legacyTriggerSearchPathFunctionIdentities.length);
    assert.deepEqual(
      configs.rows.map((row) => row.identity),
      [...legacyTriggerSearchPathFunctionIdentities].toSorted(),
    );
    for (const row of configs.rows) {
      assert.deepEqual(
        row.proconfig?.map((item) => item.replace(/\s+/g, "")),
        ["search_path=pg_catalog,public,pg_temp"],
        row.identity,
      );
    }

    await database.exec(`
      create temporary table ai_content_attachment_storage_path_guards (
        storage_path text primary key,
        legacy_session_count integer not null default 0,
        nonlegacy_session_count integer not null default 0
      )
    `);
    const identity = await createAttachmentLifecycleIdentity(database, "search-path-shadow");
    const storagePath = `generation/${randomUUID()}/shadow-proof.pdf`;
    await database.query(
      `insert into ai_content_attachment_upload_sessions(
         generation_id,workspace_id,brand_id,created_by_user_id,nonce,role,file_name,
         expected_mime_type,expected_size_bytes,expected_checksum,storage_path,status,
         token_expires_at,created_at,is_legacy_backfill
       ) values($1,$2,$3,$4,$5,'document','shadow-proof.pdf','application/pdf',100,$6,$7,
         'pending',now()+interval '10 minutes',now(),false)`,
      [identity.generationId, identity.workspaceId, identity.brandId, identity.actorId,
        randomUUID(), "a".repeat(64), storagePath],
    );
    const publicGuard = await database.query(
      "select nonlegacy_session_count from public.ai_content_attachment_storage_path_guards where storage_path=$1",
      [storagePath],
    );
    const tempGuard = await database.query(
      "select count(*)::integer as count from pg_temp.ai_content_attachment_storage_path_guards",
    );
    assert.deepEqual(publicGuard.rows, [{ nonlegacy_session_count: 1 }]);
    assert.equal(tempGuard.rows[0].count, 0);
  });
});

const seedAttachmentLifecycleUpgradeFixture = async (database, fixture) => {
  await database.query(
    "insert into workspaces(id,name,slug) values($1,'Lifecycle convergence',$2)",
    [fixture.workspaceId, `lifecycle-convergence-${fixture.workspaceId}`],
  );
  await database.query(
    "insert into brands(id,workspace_id,name) values($1,$2,'Lifecycle convergence')",
    [fixture.brandId, fixture.workspaceId],
  );
  const snapshot = {
    contentGenerationInput: { subject: "fixture", order: [2, 1] },
    stable: true,
  };
  await database.query(
    `insert into ai_content_generations(
       id,workspace_id,brand_id,type,title,status,analysis_idempotency_key,
       subject_analysis_snapshot,completed_at,updated_at
     ) values($1,$2,$3,'blog','Lifecycle convergence','completed',$4,$5::jsonb,
       '2026-02-03T04:05:06Z',now())`,
    [
      fixture.generationId,
      fixture.workspaceId,
      fixture.brandId,
      `convergence-${fixture.generationId}`,
      JSON.stringify(snapshot),
    ],
  );
  await database.query(
    `insert into ai_content_generation_attachments(
       id,generation_id,workspace_id,brand_id,role,file_name,mime_type,size_bytes,
       checksum,storage_url,storage_path,deleted_at,created_at
     ) values($1,$2,$3,$4,'document','fixture.pdf','application/pdf',321,$5,
       'https://cdn.example.com/fixture.pdf','generation/convergence/fixture.pdf',
       '2026-02-04T00:00:00Z','2026-02-01T00:00:00Z')`,
    [
      fixture.attachmentId,
      fixture.generationId,
      fixture.workspaceId,
      fixture.brandId,
      "9".repeat(64),
    ],
  );
  await database.query(
    `insert into ai_content_subject_analyses(
       id,workspace_id,brand_id,generation_id,contract_version,subject_type,input_json,
       attachment_ids_json,status,analysis_version,idempotency_key
     ) values($1,$2,$3,$4,'subject-analysis.v2','product','{"stable":"input"}',$5::jsonb,
       'ready',1,$6)`,
    [
      fixture.analysisId,
      fixture.workspaceId,
      fixture.brandId,
      fixture.generationId,
      JSON.stringify([fixture.missingId, fixture.attachmentId]),
      `analysis-${fixture.analysisId}`,
    ],
  );
};

const attachmentLifecycleRowState = async (database, fixture) => {
  const sessions = await database.query(
    `select id,generation_id,workspace_id,brand_id,created_by_user_id,nonce,storage_path,
            status,token_expires_at,confirmed_at,confirmed_attachment_id,is_legacy_backfill
       from ai_content_attachment_upload_sessions order by id`,
  );
  const attachments = await database.query(
    `select id,upload_session_id,deletion_reason,physical_delete_status,physically_deleted_at
       from ai_content_generation_attachments order by id`,
  );
  const generations = await database.query(
    `select id,generation_input_snapshot,terminal_at,retryable_until
       from ai_content_generations where id=$1`,
    [fixture.generationId],
  );
  const analyses = await database.query(
    `select id,input_json from ai_content_subject_analyses where id=$1`,
    [fixture.analysisId],
  );
  const deletionJobs = await database.query(
    `select id,workspace_id,brand_id,generation_id,attachment_id,upload_session_id,
            storage_url,storage_path,reason,status
       from ai_content_attachment_deletion_jobs order by id`,
  );
  const pathGuards = await database.query(
    `select storage_path,legacy_session_count,nonlegacy_session_count
       from ai_content_attachment_storage_path_guards order by storage_path`,
  );
  return {
    sessions: sessions.rows,
    attachments: attachments.rows,
    generations: generations.rows,
    analyses: analyses.rows,
    deletionJobs: deletionJobs.rows,
    pathGuards: pathGuards.rows,
  };
};

test("065 preserves duplicate legacy attachment paths across generations", async () => {
  const migrations = await loadMigrations();
  const migration065 = migrations.find(
    (migration) => migration.id === "065_ai_content_attachment_upload_sessions.sql",
  );
  assert.ok(migration065);

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "064_reference_upload_finalization.sql",
    );
    const workspace = await database.query(
      "insert into workspaces(name,slug) values('Legacy duplicate path',$1) returning id",
      [`legacy-duplicate-path-${randomUUID()}`],
    );
    const brand = await database.query(
      "insert into brands(workspace_id,name) values($1,'Legacy duplicate path') returning id",
      [workspace.rows[0].id],
    );
    const generationIds = [];
    for (const title of ["First legacy generation", "Second legacy generation"]) {
      const generation = await database.query(
        `insert into ai_content_generations(
           workspace_id,brand_id,type,title,status,analysis_idempotency_key
         ) values($1,$2,'blog',$3,'queued',$4) returning id`,
        [workspace.rows[0].id, brand.rows[0].id, title, randomUUID()],
      );
      generationIds.push(generation.rows[0].id);
    }
    const attachmentIds = [randomUUID(), randomUUID()];
    const sharedPath = "generation/shared-legacy-source.png";
    await database.query(
      `insert into ai_content_generation_attachments(
         id,generation_id,workspace_id,brand_id,role,file_name,mime_type,size_bytes,
         checksum,storage_url,storage_path,deleted_at
       ) values
       ($1,$3,$5,$6,'visual_reference','first.png','image/png',101,$7,
        'https://cdn.example.com/shared.png',$9,now()),
       ($2,$4,$5,$6,'visual_reference','second.png','image/png',202,$8,
        'https://cdn.example.com/shared.png',$9,now())`,
      [
        attachmentIds[0],
        attachmentIds[1],
        generationIds[0],
        generationIds[1],
        workspace.rows[0].id,
        brand.rows[0].id,
        "a".repeat(64),
        "b".repeat(64),
        sharedPath,
      ],
    );

    await database.exec(migration065.sql);

    const sessions = await database.query(
      `select id,confirmed_attachment_id,storage_path,is_legacy_backfill
         from ai_content_attachment_upload_sessions order by confirmed_attachment_id`,
    );
    assert.deepEqual(
      sessions.rows,
      [...attachmentIds].sort().map((attachmentId) => ({
        id: createHash("md5")
          .update(`ai-content-attachment-upload-session:${attachmentId}`)
          .digest("hex")
          .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5"),
        confirmed_attachment_id: attachmentId,
        storage_path: sharedPath,
        is_legacy_backfill: true,
      })),
    );
    const obligations = await database.query(
      `select workspace_id,storage_path,count(*)::integer as job_count
         from ai_content_attachment_deletion_jobs
        group by workspace_id,storage_path`,
    );
    assert.deepEqual(obligations.rows, [{
      workspace_id: workspace.rows[0].id,
      storage_path: sharedPath,
      job_count: 1,
    }]);
  });
});

test("065 direct SQL and migration runner pending-tail paths converge on lifecycle row state", async () => {
  const migrations = await loadMigrations();
  const runnable = migrations.filter(
    (migration) => !migration.sql.startsWith("-- requires: pgvector")
      && migration.id !== "027_wiki_search_v2.sql",
  );
  const through064 = runnable.filter(
    (migration) => migration.id <= "064_reference_upload_finalization.sql",
  );
  const migration065 = runnable.find(
    (migration) => migration.id === "065_ai_content_attachment_upload_sessions.sql",
  );
  assert.ok(migration065);
  const fixture = {
    workspaceId: randomUUID(),
    brandId: randomUUID(),
    generationId: randomUUID(),
    attachmentId: randomUUID(),
    analysisId: randomUUID(),
    missingId: randomUUID(),
  };

  const directState = await withDatabase(async (database) => {
    const client = createPgliteMigrationClient(database);
    await runMigrationsWithClient({ client, migrations: through064 });
    await seedAttachmentLifecycleUpgradeFixture(database, fixture);
    await database.exec(migration065.sql);
    return attachmentLifecycleRowState(database, fixture);
  });
  const runnerState = await withDatabase(async (database) => {
    const client = createPgliteMigrationClient(database);
    await runMigrationsWithClient({ client, migrations: through064 });
    await seedAttachmentLifecycleUpgradeFixture(database, fixture);
    const result = await runMigrationsWithClient({ client, migrations: runnable });
    assert.deepEqual(result.pending, [
      "065_ai_content_attachment_upload_sessions.sql",
      "066_ai_content_analyzed_subject_orchestration.sql",
      "067_wiki_refresh_outbox.sql",
      "068_brand_core_one_draft.sql",
      "069_brand_analysis_one_open_workflow.sql",
      "070_remove_embedding_runtime.sql",
      "071_brand_intelligence_onboarding_worker_v2.sql",
      "072_faq_suggestion_worker.sql",
      "073_ai_content_generation_v2_render_pipeline.sql",
    ]);
    return attachmentLifecycleRowState(database, fixture);
  });

  assert.deepEqual(runnerState, directState);
  assert.deepEqual(
    directState.analyses[0].input_json.attachmentSnapshot.map((item) => item.id),
    [fixture.attachmentId],
  );
  assert.deepEqual(
    directState.analyses[0].input_json.attachmentSnapshotMissingIds,
    [fixture.missingId],
  );
});

test("065 enforces nonlegacy actor, state, and storage path semantics", async () => {
  const migrations = await loadMigrations();
  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "065_ai_content_attachment_upload_sessions.sql",
    );
    const identity = await createAttachmentLifecycleIdentity(database, "session-semantics");
    const insertPending = (overrides = {}) => database.query(
      `insert into ai_content_attachment_upload_sessions(
         generation_id,workspace_id,brand_id,created_by_user_id,nonce,role,file_name,
         expected_mime_type,expected_size_bytes,expected_checksum,storage_path,status,
         token_expires_at,created_at,is_legacy_backfill
       ) values($1,$2,$3,$4,$5,'document','contract.pdf','application/pdf',100,$6,$7,$8,
         now()+interval '10 minutes',now(),$9)`,
      [
        identity.generationId,
        identity.workspaceId,
        identity.brandId,
        Object.hasOwn(overrides, "actorId") ? overrides.actorId : identity.actorId,
        randomUUID(),
        "a".repeat(64),
        overrides.storagePath ?? `generation/${randomUUID()}.pdf`,
        overrides.status ?? "pending",
        overrides.isLegacy ?? false,
      ],
    );

    await assert.rejects(
      insertPending({ actorId: null }),
      /actor_semantics|check constraint/i,
    );
    await assert.rejects(
      insertPending({ isLegacy: true }),
      /legacy_semantics|check constraint/i,
    );
    const duplicatePath = `generation/${randomUUID()}/duplicate.pdf`;
    await insertPending({ storagePath: duplicatePath });
    await assert.rejects(
      insertPending({ storagePath: duplicatePath }),
      /storage_path_uq|unique constraint/i,
    );
  });
});

test("065 makes every terminal upload-session lifecycle irreversible", async () => {
  const migrations = await loadMigrations();
  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "065_ai_content_attachment_upload_sessions.sql",
    );
    const identity = await createAttachmentLifecycleIdentity(database, "terminal-transitions");
    const terminalSessions = new Map();
    for (const state of [
      { status: "cancelled", timestampColumn: "cancelled_at", error: null },
      { status: "expired", timestampColumn: "expired_at", error: null },
      { status: "failed", timestampColumn: "failed_at", error: "provider_failed" },
    ]) {
      const inserted = await database.query(
        `insert into ai_content_attachment_upload_sessions(
           generation_id,workspace_id,brand_id,created_by_user_id,nonce,role,file_name,
           expected_mime_type,expected_size_bytes,expected_checksum,storage_path,status,
           token_expires_at,created_at,last_error_code,${state.timestampColumn}
         ) values($1,$2,$3,$4,$5,'document',$6,'application/pdf',100,$7,$8,$9,
           now()+interval '10 minutes',now(),$10,now()) returning id`,
        [
          identity.generationId,
          identity.workspaceId,
          identity.brandId,
          identity.actorId,
          randomUUID(),
          `${state.status}.pdf`,
          "3".repeat(64),
          `generation/${randomUUID()}/${state.status}.pdf`,
          state.status,
          state.error,
        ],
      );
      terminalSessions.set(state.status, inserted.rows[0].id);
    }

    const confirmedSession = await database.query(
      `insert into ai_content_attachment_upload_sessions(
         generation_id,workspace_id,brand_id,created_by_user_id,nonce,role,file_name,
         expected_mime_type,expected_size_bytes,expected_checksum,storage_path,
         token_expires_at,created_at
       ) values($1,$2,$3,$4,$5,'document','confirmed.pdf','application/pdf',100,$6,$7,
         now()+interval '10 minutes',now()) returning id`,
      [
        identity.generationId,
        identity.workspaceId,
        identity.brandId,
        identity.actorId,
        randomUUID(),
        "4".repeat(64),
        `generation/${randomUUID()}/confirmed.pdf`,
      ],
    );
    const confirmedAttachmentId = randomUUID();
    await database.exec("begin");
    await database.query(
      `insert into ai_content_generation_attachments(
         id,generation_id,workspace_id,brand_id,role,file_name,mime_type,size_bytes,
         checksum,storage_url,storage_path,upload_session_id
       ) values($1,$2,$3,$4,'document','confirmed.pdf','application/pdf',100,$5,
         'https://cdn.example.com/confirmed.pdf',$6,$7)`,
      [
        confirmedAttachmentId,
        identity.generationId,
        identity.workspaceId,
        identity.brandId,
        "4".repeat(64),
        `generation/${randomUUID()}/confirmed-attachment.pdf`,
        confirmedSession.rows[0].id,
      ],
    );
    await database.query(
      `update ai_content_attachment_upload_sessions
          set status='confirmed',confirmed_at=now(),confirmed_attachment_id=$2,
              storage_url='https://cdn.example.com/confirmed.pdf'
        where id=$1`,
      [confirmedSession.rows[0].id, confirmedAttachmentId],
    );
    await database.exec("commit");
    terminalSessions.set("confirmed", confirmedSession.rows[0].id);

    const terminalRewrites = new Map([
      ["cancelled", "status='expired',cancelled_at=null,expired_at=now()"],
      ["expired", "status='failed',expired_at=null,failed_at=now(),last_error_code='provider_failed'"],
      ["failed", "status='cancelled',failed_at=null,last_error_code=null,cancelled_at=now()"],
      ["confirmed", "status='cancelled',confirmed_at=null,confirmed_attachment_id=null,cancelled_at=now()"],
    ]);
    for (const [status, sessionId] of terminalSessions) {
      await assert.rejects(
        database.query(
          `update ai_content_attachment_upload_sessions
              set status='pending',confirmed_at=null,cancelled_at=null,expired_at=null,
                  failed_at=null,confirmed_attachment_id=null,last_error_code=null
            where id=$1`,
          [sessionId],
        ),
        /transition_invalid/i,
      );
      await assert.rejects(
        database.query(
          `update ai_content_attachment_upload_sessions
              set ${terminalRewrites.get(status)}
            where id=$1`,
          [sessionId],
        ),
        /transition_invalid/i,
      );
      await database.query(
        `update ai_content_attachment_upload_sessions
            set status=status,updated_at=updated_at
          where id=$1`,
        [sessionId],
      );
    }

    const replacementAttachmentId = randomUUID();
    await database.query(
      `insert into ai_content_generation_attachments(
         id,generation_id,workspace_id,brand_id,role,file_name,mime_type,size_bytes,
         checksum,storage_url,storage_path
       ) values($1,$2,$3,$4,'document','replacement.pdf','application/pdf',100,$5,
         'https://cdn.example.com/replacement.pdf',$6)`,
      [
        replacementAttachmentId,
        identity.generationId,
        identity.workspaceId,
        identity.brandId,
        "5".repeat(64),
        `generation/${randomUUID()}/replacement.pdf`,
      ],
    );
    await assert.rejects(
      database.query(
        `update ai_content_attachment_upload_sessions
            set confirmed_attachment_id=$2
          where id=$1`,
        [confirmedSession.rows[0].id, replacementAttachmentId],
      ),
      /transition_invalid/i,
    );

    const pendingToCancelled = await database.query(
      `insert into ai_content_attachment_upload_sessions(
         generation_id,workspace_id,brand_id,created_by_user_id,nonce,role,file_name,
         expected_mime_type,expected_size_bytes,expected_checksum,storage_path,
         token_expires_at,created_at
       ) values($1,$2,$3,$4,$5,'document','pending.pdf','application/pdf',100,$6,$7,
         now()+interval '10 minutes',now()) returning id`,
      [
        identity.generationId,
        identity.workspaceId,
        identity.brandId,
        identity.actorId,
        randomUUID(),
        "6".repeat(64),
        `generation/${randomUUID()}/pending.pdf`,
      ],
    );
    await database.query(
      `update ai_content_attachment_upload_sessions
          set status='cancelled',cancelled_at=now()
        where id=$1`,
      [pendingToCancelled.rows[0].id],
    );
  });
});

test("065 rejects a nonlegacy session that reuses a truthful legacy storage path", async () => {
  const migrations = await loadMigrations();
  const migration065 = migrations.find(
    (migration) => migration.id === "065_ai_content_attachment_upload_sessions.sql",
  );
  assert.ok(migration065);
  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "064_reference_upload_finalization.sql",
    );
    const identity = await createAttachmentLifecycleIdentity(database, "cross-boundary-path");
    const storagePath = "generation/truthful-legacy-path.pdf";
    await database.query(
      `insert into ai_content_generation_attachments(
         generation_id,workspace_id,brand_id,role,file_name,mime_type,size_bytes,
         checksum,storage_url,storage_path
       ) values($1,$2,$3,'document','legacy.pdf','application/pdf',100,$4,
         'https://cdn.example.com/legacy.pdf',$5)`,
      [
        identity.generationId,
        identity.workspaceId,
        identity.brandId,
        "1".repeat(64),
        storagePath,
      ],
    );
    await database.exec(migration065.sql);

    await assert.rejects(
      database.query(
        `insert into ai_content_attachment_upload_sessions(
           generation_id,workspace_id,brand_id,created_by_user_id,nonce,role,file_name,
           expected_mime_type,expected_size_bytes,expected_checksum,storage_path,
           token_expires_at,created_at
         ) values($1,$2,$3,$4,$5,'document','new.pdf','application/pdf',100,$6,$7,
           now()+interval '10 minutes',now())`,
        [
          identity.generationId,
          identity.workspaceId,
          identity.brandId,
          identity.actorId,
          randomUUID(),
          "2".repeat(64),
          storagePath,
        ],
      ),
      (error) => {
        assert.equal(error.code, "23505");
        assert.doesNotMatch(error.message, new RegExp(storagePath));
        return true;
      },
    );
  });
});

test("065 serializes attachment path reservations through a per-path guard row", async () => {
  const migrations = await loadMigrations();
  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "065_ai_content_attachment_upload_sessions.sql",
    );
    const guardTable = await database.query(
      "select to_regclass('public.ai_content_attachment_storage_path_guards')::text as name",
    );
    assert.deepEqual(guardTable.rows, [{
      name: "ai_content_attachment_storage_path_guards",
    }]);
    const primaryKey = await database.query(
      `select pg_get_constraintdef(oid) as definition
         from pg_constraint
        where conrelid='ai_content_attachment_storage_path_guards'::regclass
          and contype='p'`,
    );
    assert.deepEqual(primaryKey.rows, [{
      definition: "PRIMARY KEY (storage_path)",
    }]);
    const triggerFunctions = await database.query(
      `select trigger_name,action_timing,event_manipulation,action_statement
         from information_schema.triggers
        where event_object_schema='public'
          and event_object_table='ai_content_attachment_upload_sessions'
          and trigger_name in (
            'ai_content_attachment_upload_sessions_reserve_storage_path',
            'ai_content_attachment_upload_sessions_release_storage_path'
          )
        order by trigger_name`,
    );
    assert.deepEqual(
      triggerFunctions.rows.map((row) => ({
        trigger_name: row.trigger_name,
        action_timing: row.action_timing,
        event_manipulation: row.event_manipulation,
      })),
      [
        {
          trigger_name: "ai_content_attachment_upload_sessions_release_storage_path",
          action_timing: "AFTER",
          event_manipulation: "DELETE",
        },
        {
          trigger_name: "ai_content_attachment_upload_sessions_reserve_storage_path",
          action_timing: "AFTER",
          event_manipulation: "INSERT",
        },
      ],
    );
    const reservationFunction = await database.query(
      `select pg_get_functiondef(p.oid) as definition
         from pg_proc p
         join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public'
          and p.proname='reserve_ai_content_attachment_storage_path'`,
    );
    assert.equal(reservationFunction.rows.length, 1);
    assert.match(
      reservationFunction.rows[0].definition,
      /insert into ai_content_attachment_storage_path_guards[\s\S]*on conflict \(storage_path\) do update/i,
    );
    assert.match(
      reservationFunction.rows[0].definition,
      /nonlegacy_session_count = 0[\s\S]*excluded\.nonlegacy_session_count = 0[\s\S]*legacy_session_count = 0/i,
    );
  });
});

test("065 defers circular confirmation links until commit and rejects cross-tenant links", async () => {
  const migrations = await loadMigrations();
  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "065_ai_content_attachment_upload_sessions.sql",
    );
    const first = await createAttachmentLifecycleIdentity(database, "circular-first");
    const second = await createAttachmentLifecycleIdentity(database, "circular-second");
    const insertSession = async (identity, storagePath) => {
      const session = await database.query(
        `insert into ai_content_attachment_upload_sessions(
           generation_id,workspace_id,brand_id,created_by_user_id,nonce,role,file_name,
           expected_mime_type,expected_size_bytes,expected_checksum,storage_path,
           token_expires_at,created_at
         ) values($1,$2,$3,$4,$5,'document','confirm.pdf','application/pdf',100,$6,$7,
           now()+interval '10 minutes',now()) returning id`,
        [
          identity.generationId,
          identity.workspaceId,
          identity.brandId,
          identity.actorId,
          randomUUID(),
          "b".repeat(64),
          storagePath,
        ],
      );
      return session.rows[0].id;
    };

    const validSessionId = await insertSession(
      first,
      `generation/${randomUUID()}/valid.pdf`,
    );
    const validAttachmentId = randomUUID();
    await database.exec("begin");
    await database.query(
      `insert into ai_content_generation_attachments(
         id,generation_id,workspace_id,brand_id,role,file_name,mime_type,size_bytes,
         checksum,storage_url,storage_path,upload_session_id
       ) values($1,$2,$3,$4,'document','confirm.pdf','application/pdf',100,$5,
         'https://cdn.example.com/confirmed.pdf',$6,$7)`,
      [
        validAttachmentId,
        first.generationId,
        first.workspaceId,
        first.brandId,
        "b".repeat(64),
        `generation/${randomUUID()}/confirmed.pdf`,
        validSessionId,
      ],
    );
    await database.query(
      `update ai_content_attachment_upload_sessions
          set status='confirmed',confirmed_at=now(),confirmed_attachment_id=$2
        where id=$1`,
      [validSessionId, validAttachmentId],
    );
    await database.exec("commit");

    const invalidSessionId = await insertSession(
      first,
      `generation/${randomUUID()}/invalid.pdf`,
    );
    const invalidAttachmentId = randomUUID();
    await database.exec("begin");
    await database.query(
      `insert into ai_content_generation_attachments(
         id,generation_id,workspace_id,brand_id,role,file_name,mime_type,size_bytes,
         checksum,storage_url,storage_path,upload_session_id
       ) values($1,$2,$3,$4,'document','cross-tenant.pdf','application/pdf',100,$5,
         'https://cdn.example.com/cross-tenant.pdf',$6,$7)`,
      [
        invalidAttachmentId,
        second.generationId,
        second.workspaceId,
        second.brandId,
        "c".repeat(64),
        `generation/${randomUUID()}/cross-tenant.pdf`,
        invalidSessionId,
      ],
    );
    await database.query(
      `update ai_content_attachment_upload_sessions
          set status='confirmed',confirmed_at=now(),confirmed_attachment_id=$2
        where id=$1`,
      [invalidSessionId, invalidAttachmentId],
    );
    await assert.rejects(
      database.exec("commit"),
      /foreign key constraint/i,
    );
    await database.exec("rollback");
  });
});

test("065 deleting every unconfirmed session state creates expiry-safe parent-independent jobs", async () => {
  const migrations = await loadMigrations();
  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "065_ai_content_attachment_upload_sessions.sql",
    );
    const identity = await createAttachmentLifecycleIdentity(database, "session-cleanup");
    const states = [
      { status: "pending", timestampColumn: null, error: null },
      { status: "cancelled", timestampColumn: "cancelled_at", error: null },
      { status: "failed", timestampColumn: "failed_at", error: "provider_failed" },
      { status: "expired", timestampColumn: "expired_at", error: null },
    ];
    const expiries = new Map();
    for (const state of states) {
      const sessionId = randomUUID();
      const path = `generation/${sessionId}/${state.status}.bin`;
      const timestampColumns = state.timestampColumn ? `,${state.timestampColumn}` : "";
      const timestampValues = state.timestampColumn ? ",now()" : "";
      const inserted = await database.query(
        `insert into ai_content_attachment_upload_sessions(
           id,generation_id,workspace_id,brand_id,created_by_user_id,nonce,role,file_name,
           expected_mime_type,expected_size_bytes,expected_checksum,storage_path,status,
           token_expires_at,created_at,last_error_code${timestampColumns}
         ) values($1,$2,$3,$4,$5,$6,'document',$7,'application/octet-stream',100,$8,$9,$10,
           now()+interval '10 minutes',now(),$11${timestampValues})
         returning token_expires_at`,
        [
          sessionId,
          identity.generationId,
          identity.workspaceId,
          identity.brandId,
          identity.actorId,
          randomUUID(),
          `${state.status}.bin`,
          "d".repeat(64),
          path,
          state.status,
          state.error,
        ],
      );
      expiries.set(sessionId, inserted.rows[0].token_expires_at);
      await database.query(
        "delete from ai_content_attachment_upload_sessions where id=$1",
        [sessionId],
      );
    }

    const jobs = await database.query(
      `select upload_session_id,attachment_id,reason,next_attempt_at
         from ai_content_attachment_deletion_jobs
        where workspace_id=$1 order by reason`,
      [identity.workspaceId],
    );
    assert.equal(jobs.rows.length, states.length);
    for (const job of jobs.rows) {
      assert.equal(job.attachment_id, null);
      assert.ok(job.reason.startsWith("upload_session_"));
      assert.ok(
        new Date(job.next_attempt_at) >= new Date(expiries.get(job.upload_session_id)),
      );
    }
    const staleGuards = await database.query(
      `select count(*)::integer as count
         from ai_content_attachment_storage_path_guards`,
    );
    assert.deepEqual(staleGuards.rows, [{ count: 0 }]);
  });
});

test("065 attachment deletion skips only physically deleted bytes", async () => {
  const migrations = await loadMigrations();
  const migration065 = migrations.find(
    (migration) => migration.id === "065_ai_content_attachment_upload_sessions.sql",
  );
  assert.ok(migration065);
  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "064_reference_upload_finalization.sql",
    );
    const identity = await createAttachmentLifecycleIdentity(database, "attachment-trigger");
    const attachmentIds = [randomUUID(), randomUUID()];
    const paths = ["generation/needs-delete.bin", "generation/already-deleted.bin"];
    await database.query(
      `insert into ai_content_generation_attachments(
         id,generation_id,workspace_id,brand_id,role,file_name,mime_type,size_bytes,
         checksum,storage_url,storage_path
       ) values
       ($1,$3,$4,$5,'document','needs-delete.bin','application/octet-stream',100,$6,
        'https://cdn.example.com/needs-delete.bin',$8),
       ($2,$3,$4,$5,'document','already-deleted.bin','application/octet-stream',100,$7,
        'https://cdn.example.com/already-deleted.bin',$9)`,
      [
        attachmentIds[0],
        attachmentIds[1],
        identity.generationId,
        identity.workspaceId,
        identity.brandId,
        "e".repeat(64),
        "f".repeat(64),
        paths[0],
        paths[1],
      ],
    );
    await database.exec(migration065.sql);
    await database.query(
      `update ai_content_generation_attachments
          set physical_delete_status='deleted',physically_deleted_at=now()
        where id=$1`,
      [attachmentIds[1]],
    );
    await database.query(
      "delete from ai_content_generations where id=$1",
      [identity.generationId],
    );
    const jobs = await database.query(
      `select storage_path from ai_content_attachment_deletion_jobs
        where workspace_id=$1 order by storage_path`,
      [identity.workspaceId],
    );
    assert.deepEqual(jobs.rows, [{ storage_path: paths[0] }]);
  });
});

test("065 workspace cascade preserves cleanup for a nonlegacy pending session", async () => {
  const migrations = await loadMigrations();
  const migration065 = migrations.find(
    (migration) => migration.id === "065_ai_content_attachment_upload_sessions.sql",
  );
  assert.ok(migration065);

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "064_reference_upload_finalization.sql",
    );
    const identity = await createAttachmentLifecycleIdentity(database, "pending-cascade");
    await database.exec(migration065.sql);
    const sessionId = randomUUID();
    const storagePath = `generation/${sessionId}/pending.png`;
    const inserted = await database.query(
      `insert into ai_content_attachment_upload_sessions(
         id,generation_id,workspace_id,brand_id,created_by_user_id,nonce,role,file_name,
         expected_mime_type,expected_size_bytes,expected_checksum,storage_path,
         token_expires_at,created_at
       ) values($1,$2,$3,$4,$5,$6,'visual_reference','pending.png','image/png',123,$7,$8,
         now()+interval '10 minutes',now())
       returning token_expires_at`,
      [
        sessionId,
        identity.generationId,
        identity.workspaceId,
        identity.brandId,
        identity.actorId,
        randomUUID(),
        "c".repeat(64),
        storagePath,
      ],
    );

    await database.query("delete from workspaces where id=$1", [identity.workspaceId]);

    const session = await database.query(
      "select id from ai_content_attachment_upload_sessions where id=$1",
      [sessionId],
    );
    assert.equal(session.rows.length, 0);
    const jobs = await database.query(
      `select workspace_id,brand_id,generation_id,attachment_id,upload_session_id,
              storage_path,next_attempt_at
         from ai_content_attachment_deletion_jobs where workspace_id=$1`,
      [identity.workspaceId],
    );
    assert.equal(jobs.rows.length, 1);
    assert.equal(jobs.rows[0].storage_path, storagePath);
    assert.equal(jobs.rows[0].attachment_id, null);
    assert.equal(jobs.rows[0].upload_session_id, sessionId);
    assert.ok(
      new Date(jobs.rows[0].next_attempt_at) >= new Date(inserted.rows[0].token_expires_at),
    );
    const staleGuard = await database.query(
      `select storage_path
         from ai_content_attachment_storage_path_guards
        where storage_path=$1`,
      [storagePath],
    );
    assert.equal(staleGuard.rows.length, 0);
  });
});

test("065 fresh and through-064 upgrade paths converge on the attachment lifecycle catalog", async () => {
  const migrations = await loadMigrations();
  const migration065 = migrations.find(
    (migration) => migration.id === "065_ai_content_attachment_upload_sessions.sql",
  );
  assert.ok(migration065, "065 attachment lifecycle migration must exist");

  const freshCatalog = await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "065_ai_content_attachment_upload_sessions.sql",
    );
    return attachmentLifecycleCatalog(database);
  });
  const upgradedCatalog = await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "064_reference_upload_finalization.sql",
    );
    await database.exec(migration065.sql);
    return attachmentLifecycleCatalog(database);
  });

  assert.deepEqual(upgradedCatalog, freshCatalog);
  const generationColumns = new Set(
    freshCatalog.columns
      .filter((column) => column.table_name === "ai_content_generations")
      .map((column) => column.column_name),
  );
  for (const name of [
    "attachments_locked_at",
    "generation_input_snapshot",
    "terminal_at",
    "retryable_until",
  ]) {
    assert.ok(generationColumns.has(name), `missing generation column ${name}`);
  }
  for (const index of [
    "ai_content_attachment_upload_sessions_nonce_uq",
    "ai_content_attachment_upload_sessions_storage_path_uq",
    "ai_content_attachment_upload_sessions_generation_fk_idx",
    "ai_content_attachment_upload_sessions_actor_fk_idx",
    "ai_content_attachment_upload_sessions_pending_expiry_idx",
    "ai_content_upload_sessions_generation_reservation_idx",
    "ai_content_attachment_deletion_jobs_due_idx",
    "ai_content_attachment_deletion_jobs_expired_lease_idx",
    "ai_content_generations_terminal_retention_idx",
  ]) {
    assert.ok(
      freshCatalog.indexes.some((entry) => entry.indexname === index),
      `missing lifecycle index ${index}`,
    );
  }
  const actorForeignKey = freshCatalog.constraints.find(
    (entry) => entry.conname === "ai_content_attachment_upload_sessions_actor_fk",
  );
  assert.match(actorForeignKey?.definition ?? "", /FOREIGN KEY/i);
  assert.equal(actorForeignKey?.confdeltype, "a");
  assert.equal(actorForeignKey?.condeferrable, true);
  assert.equal(actorForeignKey?.condeferred, true);
  const storagePathIndex = freshCatalog.indexes.find(
    (entry) => entry.indexname === "ai_content_attachment_upload_sessions_storage_path_uq",
  );
  assert.match(storagePathIndex?.indexdef ?? "", /WHERE \(NOT is_legacy_backfill\)/i);
  const generationForeignKeyIndex = freshCatalog.indexes.find(
    (entry) =>
      entry.indexname === "ai_content_attachment_upload_sessions_generation_fk_idx",
  );
  assert.match(
    generationForeignKeyIndex?.indexdef ?? "",
    /\(generation_id, workspace_id, brand_id\)$/i,
  );
  const actorForeignKeyIndex = freshCatalog.indexes.find(
    (entry) => entry.indexname === "ai_content_attachment_upload_sessions_actor_fk_idx",
  );
  assert.match(
    actorForeignKeyIndex?.indexdef ?? "",
    /\(workspace_id, created_by_user_id\) WHERE \(created_by_user_id IS NOT NULL\)/i,
  );
  assert.equal(
    freshCatalog.constraints.some(
      (entry) =>
        entry.table_name === "ai_content_attachment_deletion_jobs"
        && /^FOREIGN KEY/i.test(entry.definition),
    ),
    false,
    "deletion jobs must not retain foreign keys to parent lifecycle tables",
  );
});

test("065 backfills snapshots, sessions, missing IDs, retention, and durable deletion obligations", async () => {
  const migrations = await loadMigrations();
  const migration065 = migrations.find(
    (migration) => migration.id === "065_ai_content_attachment_upload_sessions.sql",
  );
  assert.ok(migration065);

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "064_reference_upload_finalization.sql",
    );
    const actor = await database.query(
      "insert into app_users(email) values($1) returning id",
      [`attachment-lifecycle-${randomUUID()}@example.com`],
    );
    const workspace = await database.query(
      "insert into workspaces(name,slug) values('Attachment lifecycle',$1) returning id",
      [`attachment-lifecycle-${randomUUID()}`],
    );
    await database.query(
      "insert into workspace_members(workspace_id,user_id,role) values($1,$2,'owner')",
      [workspace.rows[0].id, actor.rows[0].id],
    );
    const brand = await database.query(
      "insert into brands(workspace_id,name) values($1,'Lifecycle Brand') returning id",
      [workspace.rows[0].id],
    );
    const terminalSnapshot = {
      contentGenerationInput: { subject: "unchanged", nested: { order: [2, 1] } },
      marker: "preserve-me",
    };
    const terminal = await database.query(
      `insert into ai_content_generations(
         workspace_id,brand_id,type,title,status,analysis_idempotency_key,
         subject_analysis_snapshot,updated_at,completed_at
       ) values($1,$2,'blog','Terminal','completed',$3,$4::jsonb,
         '2026-01-02T03:04:05Z',null) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, `terminal-${randomUUID()}`, JSON.stringify(terminalSnapshot)],
    );
    const active = await database.query(
      `insert into ai_content_generations(
         workspace_id,brand_id,type,title,status,analysis_idempotency_key,
         subject_analysis_snapshot
       ) values($1,$2,'blog','Active','queued',$3,$4::jsonb) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, `active-${randomUUID()}`, JSON.stringify(terminalSnapshot)],
    );
    const output = await database.query(
      `insert into ai_content_generation_outputs(
         generation_id,workspace_id,brand_id,output_index,status
       ) values($1,$2,$3,1,'queued') returning id`,
      [active.rows[0].id, workspace.rows[0].id, brand.rows[0].id],
    );
    await database.query(
      `insert into ai_content_generation_jobs(
         generation_id,output_id,workspace_id,brand_id,job_type,content_type,status,payload_json
       ) values($1,$2,$3,$4,'generate','blog','queued','{}')`,
      [active.rows[0].id, output.rows[0].id, workspace.rows[0].id, brand.rows[0].id],
    );
    const attachmentIds = [randomUUID(), randomUUID()];
    await database.query(
      `insert into ai_content_generation_attachments(
         id,generation_id,workspace_id,brand_id,role,file_name,mime_type,size_bytes,
         checksum,storage_url,storage_path,deleted_at
       ) values
       ($1,$3,$4,$5,'document','first.pdf','application/pdf',101,$6,
        'https://cdn.example.com/first.pdf','generation/first.pdf',null),
       ($2,$3,$4,$5,'visual_reference','second.png','image/png',202,$7,
        'https://cdn.example.com/second.png','generation/second.png',now())`,
      [
        attachmentIds[0],
        attachmentIds[1],
        active.rows[0].id,
        workspace.rows[0].id,
        brand.rows[0].id,
        "a".repeat(64),
        "b".repeat(64),
      ],
    );
    const missingId = randomUUID();
    await database.query(
      `insert into ai_content_subject_analyses(
         workspace_id,brand_id,generation_id,contract_version,subject_type,input_json,
         attachment_ids_json,status,analysis_version,idempotency_key
       ) values($1,$2,$3,'subject-analysis.v2','product','{}',$4::jsonb,
         'queued',1,$5)`,
      [
        workspace.rows[0].id,
        brand.rows[0].id,
        active.rows[0].id,
        JSON.stringify([attachmentIds[1], missingId, attachmentIds[0]]),
        `analysis-${randomUUID()}`,
      ],
    );
    const emptyGeneration = await database.query(
      `insert into ai_content_generations(
         workspace_id,brand_id,type,title,status,analysis_idempotency_key
       ) values($1,$2,'blog','Empty attachments','analysis_ready',$3) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, `empty-${randomUUID()}`],
    );
    const emptyAnalysis = await database.query(
      `insert into ai_content_subject_analyses(
         workspace_id,brand_id,generation_id,contract_version,subject_type,input_json,
         attachment_ids_json,status,analysis_version,idempotency_key
       ) values($1,$2,$3,'subject-analysis.v2','product','{}','[]','ready',1,$4)
       returning id`,
      [
        workspace.rows[0].id,
        brand.rows[0].id,
        emptyGeneration.rows[0].id,
        `empty-analysis-${randomUUID()}`,
      ],
    );

    await database.exec(migration065.sql);

    const generations = await database.query(
      `select id,generation_input_snapshot,terminal_at,retryable_until
         from ai_content_generations
        where id in ($1,$2) order by id`,
      [terminal.rows[0].id, active.rows[0].id],
    );
    const terminalRow = generations.rows.find((row) => row.id === terminal.rows[0].id);
    const activeRow = generations.rows.find((row) => row.id === active.rows[0].id);
    assert.deepEqual(terminalRow.generation_input_snapshot, terminalSnapshot);
    assert.equal(new Date(terminalRow.terminal_at).toISOString(), "2026-01-02T03:04:05.000Z");
    assert.equal(new Date(terminalRow.retryable_until).toISOString(), "2026-01-17T03:04:05.000Z");
    assert.equal(activeRow.terminal_at, null);
    assert.equal(activeRow.retryable_until, null);
    const job = await database.query(
      "select payload_json from ai_content_generation_jobs where generation_id=$1",
      [active.rows[0].id],
    );
    assert.deepEqual(job.rows[0].payload_json.contentGenerationInput, terminalSnapshot);
    const analysis = await database.query(
      "select input_json from ai_content_subject_analyses where generation_id=$1",
      [active.rows[0].id],
    );
    assert.deepEqual(
      analysis.rows[0].input_json.attachmentSnapshot.map((item) => item.id),
      [attachmentIds[1], attachmentIds[0]],
    );
    assert.deepEqual(analysis.rows[0].input_json.attachmentSnapshotMissingIds, [missingId]);
    const emptyAnalysisAfter = await database.query(
      "select input_json from ai_content_subject_analyses where id=$1",
      [emptyAnalysis.rows[0].id],
    );
    assert.deepEqual(emptyAnalysisAfter.rows[0].input_json.attachmentSnapshot, []);
    assert.deepEqual(
      emptyAnalysisAfter.rows[0].input_json.attachmentSnapshotMissingIds,
      [],
    );
    const sessions = await database.query(
      `select created_by_user_id,is_legacy_backfill,confirmed_at,confirmed_attachment_id
         from ai_content_attachment_upload_sessions
        where generation_id=$1 order by confirmed_attachment_id`,
      [active.rows[0].id],
    );
    assert.equal(sessions.rows.length, 2);
    assert.ok(sessions.rows.every((row) =>
      row.created_by_user_id === null
      && row.is_legacy_backfill === true
      && row.confirmed_at !== null
      && row.confirmed_attachment_id !== null
    ));
    const deletedAttachment = await database.query(
      `select physical_delete_status,physically_deleted_at
         from ai_content_generation_attachments where id=$1`,
      [attachmentIds[1]],
    );
    assert.deepEqual(deletedAttachment.rows, [{
      physical_delete_status: "pending",
      physically_deleted_at: null,
    }]);
    const backfillJobs = await database.query(
      `select storage_path,status from ai_content_attachment_deletion_jobs
        where workspace_id=$1 order by storage_path`,
      [workspace.rows[0].id],
    );
    assert.deepEqual(backfillJobs.rows, [{
      storage_path: "generation/second.png",
      status: "pending",
    }]);

    await database.query("delete from ai_content_generations where id=$1", [active.rows[0].id]);
    const afterGenerationDelete = await database.query(
      `select storage_path from ai_content_attachment_deletion_jobs
        where workspace_id=$1 order by storage_path`,
      [workspace.rows[0].id],
    );
    assert.deepEqual(
      afterGenerationDelete.rows.map((row) => row.storage_path),
      ["generation/first.pdf", "generation/second.png"],
    );
    await database.query("delete from workspaces where id=$1", [workspace.rows[0].id]);
    const afterWorkspaceDelete = await database.query(
      `select workspace_id,storage_path from ai_content_attachment_deletion_jobs
        where workspace_id=$1 order by storage_path`,
      [workspace.rows[0].id],
    );
    assert.equal(afterWorkspaceDelete.rows.length, 2);
  });
});

test("050 stores normalized support request mobile phone numbers", async () => {
  const migrations = await loadMigrations();
  const migration050 = migrations.find(
    (migration) => migration.id === "050_support_request_contact_phone.sql",
  );
  assert.ok(migration050, "050 support request contact phone migration must exist");

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "050_support_request_contact_phone.sql",
    );

    const columns = await database.query(`
      select data_type, is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'support_requests'
        and column_name = 'contact_phone'
    `);
    assert.deepEqual(columns.rows, [{ data_type: "text", is_nullable: "YES" }]);

    const constraints = await database.query(`
      select pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conname = 'support_requests_contact_phone_format'
    `);
    assert.equal(constraints.rows.length, 1);
    assert.match(constraints.rows[0].definition, /010-/);
  });
});

test("070 activates and deterministically searches compiled Wiki chunks without embeddings", async () => {
  const migrations = await loadMigrations();
  const lexicalMigration = migrations.find(
    (migration) => migration.id === "070_remove_embedding_runtime.sql",
  );

  assert.ok(
    lexicalMigration,
    "missing migration 070_remove_embedding_runtime.sql",
  );

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "032_compounding_wiki_core.sql",
    );
    await database.exec(
      "alter table wiki_page_chunks add column embedding text null",
    );

    const workspace = await database.query(
      "insert into workspaces (name, slug) values ('Lexical Wiki', $1) returning id",
      [`lexical-wiki-${randomUUID()}`],
    );
    const brand = await database.query(
      "insert into brands (workspace_id, name) values ($1, 'Lexical Brand') returning id",
      [workspace.rows[0].id],
    );
    const inflight = await database.query(
      `insert into wiki_versions (workspace_id, brand_id, status, build_stage)
       values ($1, $2, 'building', 'embedding') returning id`,
      [workspace.rows[0].id, brand.rows[0].id],
    );

    await database.exec(lexicalMigration.sql);

    const resumed = await database.query(
      "select status, build_stage from wiki_versions where id = $1",
      [inflight.rows[0].id],
    );
    assert.deepEqual(resumed.rows, [{
      status: "building",
      build_stage: "validating",
    }]);

    const version = await database.query(
      `insert into wiki_versions (workspace_id, brand_id, status, build_stage)
       values ($1, $2, 'ready', null) returning id`,
      [workspace.rows[0].id, brand.rows[0].id],
    );
    const sourceUnit = await database.query(
      `insert into wiki_source_units (
         workspace_id, brand_id, wiki_version_id, source_kind, source_id,
         unit_type, stable_key, title, content, content_hash, keywords,
         aliases, source_quote
       ) values (
         $1, $2, $3, 'policy', $4, 'policy', 'returns-policy-source',
         '교환 및 반품 안내', '교환과 반품 신청 방법', 'source-hash',
         array['교환', '반품'], array['교환 안내', '반품 도움말'],
         '교환 및 반품 신청 방법'
       ) returning id`,
      [
        workspace.rows[0].id,
        brand.rows[0].id,
        version.rows[0].id,
        randomUUID(),
      ],
    );
    const pageFixtures = [
      {
        pageType: "brand_overview",
        stableKey: "brand-overview",
        title: "브랜드 소개",
        content: "브랜드의 가치와 운영 원칙을 소개합니다.",
      },
      {
        pageType: "catalog",
        stableKey: "product-catalog",
        title: "상품 카탈로그",
        content: "판매 중인 상품을 한눈에 안내합니다.",
      },
      {
        pageType: "policy",
        stableKey: "returns-policy",
        title: "교환 및 반품 안내",
        content: "수령 후 칠 일 안에 교환 또는 반품을 신청할 수 있습니다.",
      },
    ];
    const pages = [];
    for (const fixture of pageFixtures) {
      const page = await database.query(
        `insert into wiki_pages (
           workspace_id, brand_id, wiki_version_id, page_type, stable_key,
           title, content_json
         ) values (
           $1, $2, $3, $4, $5, $6,
           jsonb_build_object(
             'sections',
             jsonb_build_array(
               jsonb_build_object(
                 'sectionKey', 'main',
                 'sourceUnitIds', jsonb_build_array($7::text)
               )
             )
           )
         ) returning id`,
        [
          workspace.rows[0].id,
          brand.rows[0].id,
          version.rows[0].id,
          fixture.pageType,
          fixture.stableKey,
          fixture.title,
          sourceUnit.rows[0].id,
        ],
      );
      pages.push({ ...fixture, id: page.rows[0].id });
      await database.query(
        `insert into wiki_page_sources (
           workspace_id, brand_id, wiki_version_id, wiki_page_id,
           wiki_source_unit_id, section_key, source_kind, source_id,
           source_quote
         ) values ($1, $2, $3, $4, $5, 'main', 'policy', $6, $7)`,
        [
          workspace.rows[0].id,
          brand.rows[0].id,
          version.rows[0].id,
          page.rows[0].id,
          sourceUnit.rows[0].id,
          randomUUID(),
          fixture.content,
        ],
      );
      await database.query(
        `insert into wiki_page_chunks (
           workspace_id, brand_id, wiki_version_id, wiki_page_id,
           chunk_index, content, content_hash, enabled, embedding
         ) values ($1, $2, $3, $4, 0, $5, $6, true, null)`,
        [
          workspace.rows[0].id,
          brand.rows[0].id,
          version.rows[0].id,
          page.rows[0].id,
          fixture.content,
          `${fixture.stableKey}-0`,
        ],
      );
    }
    const catalog = pages.find((page) => page.pageType === "catalog");
    for (let chunkIndex = 1; chunkIndex <= 12; chunkIndex += 1) {
      await database.query(
        `insert into wiki_page_chunks (
           workspace_id, brand_id, wiki_version_id, wiki_page_id,
           chunk_index, content, content_hash, enabled, embedding
         ) values ($1, $2, $3, $4, $5, $6, $7, true, null)`,
        [
          workspace.rows[0].id,
          brand.rows[0].id,
          version.rows[0].id,
          catalog.id,
          chunkIndex,
          `상품 안내 ${chunkIndex}`,
          `catalog-${chunkIndex}`,
        ],
      );
    }
    await database.query(
      `insert into wiki_compilation_items (
         workspace_id, brand_id, wiki_version_id, item_type, stable_key,
         idempotency_key, status, completed_at
       ) values (
         $1, $2, $3, 'validate', 'validate', $4, 'succeeded', now()
       )`,
      [
        workspace.rows[0].id,
        brand.rows[0].id,
        version.rows[0].id,
        `validate-${randomUUID()}`,
      ],
    );

    const activated = await database.query(
      "select activate_compiled_wiki_version($1) as activated",
      [version.rows[0].id],
    );
    assert.equal(activated.rows[0].activated, true);
    const activeVersion = await database.query(
      "select status, chunk_count from wiki_versions where id = $1",
      [version.rows[0].id],
    );
    assert.deepEqual(activeVersion.rows, [{
      status: "active",
      chunk_count: 15,
    }]);
    const legacyEmbeddings = await database.query(
      `select count(*)::integer as count
         from wiki_page_chunks
        where wiki_version_id = $1 and embedding is not null`,
      [version.rows[0].id],
    );
    assert.deepEqual(legacyEmbeddings.rows, [{ count: 0 }]);

    const search = async (query, limit) => database.query(
      "select * from search_brand_wiki_lexical($1, $2, $3, $4)",
      [workspace.rows[0].id, brand.rows[0].id, query, limit],
    );
    for (const fixture of [
      { label: "NULL query", query: null },
      { label: "blank query", query: "  \t\n  " },
      { label: "wholly unmatched query", query: "절대존재하지않는검색어" },
    ]) {
      const result = await search(fixture.query, 12);
      assert.equal(
        result.rows.length,
        0,
        `${fixture.label} must not return arbitrary Wiki chunks`,
      );
    }
    const first = await search("교환 안내", 12);
    const second = await search("교환 안내", 12);
    const policy = pages.find((page) => page.pageType === "policy");
    assert.equal(first.rows[0].wiki_page_id, policy.id);
    assert.deepEqual(
      second.rows.map((row) => row.page_chunk_id),
      first.rows.map((row) => row.page_chunk_id),
    );
    assert.equal(first.rows[0].cosine_similarity, 0);
    assert.ok(first.rows[0].keyword_match >= 0);
    assert.ok(first.rows[0].rrf_score > 0);
    assert.equal(first.rows[0].source_link_ids.length, 1);

    const bounded = await search("안내", 999);
    assert.equal(bounded.rows.length, 12);

    const insertOfferingPage = async ({
      pageType,
      sourceKind,
      stableKey,
      title,
      content,
      sourceUrl,
      destinationUrl,
    }) => {
      const sourceId = randomUUID();
      const source = await database.query(
        `insert into wiki_source_units (
           workspace_id, brand_id, wiki_version_id, source_kind, source_id,
           unit_type, stable_key, title, content, content_hash,
           source_url, destination_url, source_quote
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $9
         ) returning id`,
        [
          workspace.rows[0].id,
          brand.rows[0].id,
          version.rows[0].id,
          sourceKind,
          sourceId,
          pageType,
          stableKey,
          title,
          content,
          `${stableKey}-source`,
          sourceUrl,
          destinationUrl,
        ],
      );
      const page = await database.query(
        `insert into wiki_pages (
           workspace_id, brand_id, wiki_version_id, page_type, stable_key,
           title, content_json, is_active
         ) values (
           $1, $2, $3, $4, $5, $6,
           jsonb_build_object(
             'sections',
             jsonb_build_array(
               jsonb_build_object(
                 'sectionKey', 'main',
                 'sourceUnitIds', jsonb_build_array($7::text)
               )
             )
           ),
           true
         ) returning id`,
        [
          workspace.rows[0].id,
          brand.rows[0].id,
          version.rows[0].id,
          pageType,
          stableKey,
          title,
          source.rows[0].id,
        ],
      );
      await database.query(
        `insert into wiki_page_sources (
           workspace_id, brand_id, wiki_version_id, wiki_page_id,
           wiki_source_unit_id, section_key, source_kind, source_id,
           source_url, destination_url, source_quote
         ) values ($1, $2, $3, $4, $5, 'main', $6, $7, $8, $9, $10)`,
        [
          workspace.rows[0].id,
          brand.rows[0].id,
          version.rows[0].id,
          page.rows[0].id,
          source.rows[0].id,
          sourceKind,
          sourceId,
          sourceUrl,
          destinationUrl,
          content,
        ],
      );
      await database.query(
        `insert into wiki_page_chunks (
           workspace_id, brand_id, wiki_version_id, wiki_page_id,
           chunk_index, content, content_hash, enabled, embedding
         ) values ($1, $2, $3, $4, 0, $5, $6, true, null)`,
        [
          workspace.rows[0].id,
          brand.rows[0].id,
          version.rows[0].id,
          page.rows[0].id,
          content,
          `${stableKey}-chunk`,
        ],
      );
      return page.rows[0].id;
    };
    const validProductPageId = await insertOfferingPage({
      pageType: "product",
      sourceKind: "product",
      stableKey: "product-basic",
      title: "기본 상품",
      content: "프리미엄 상품 기본 안내",
      sourceUrl: "https://example.com/products/basic",
      destinationUrl: "https://example.com/products/basic",
    });
    const ownedProductPageId = await insertOfferingPage({
      pageType: "product",
      sourceKind: "owned_snapshot",
      stableKey: "owned-product",
      title: "상품 안내",
      content: "상품 안내와 구매 정보를 확인합니다.",
      sourceUrl: "https://example.com/shop/owned-product",
      destinationUrl: "https://example.com/shop/owned-product",
    });
    const articleProductPageId = await insertOfferingPage({
      pageType: "product",
      sourceKind: "owned_snapshot",
      stableKey: "article-product",
      title: "상품 안내 블로그",
      content: "프리미엄 상품 안내와 자세한 서비스 정보",
      sourceUrl: "https://example.com/blog/product-story",
      destinationUrl: "https://example.com/blog/product-story",
    });
    const shortLocationServicePageId = await insertOfferingPage({
      pageType: "service",
      sourceKind: "owned_snapshot",
      stableKey: "service-short-location",
      title: "서비스 정보",
      content: "자세한 서비스 상세 정보 안내",
      sourceUrl: "https://x.co/s",
      destinationUrl: "https://x.co/s",
    });
    await insertOfferingPage({
      pageType: "service",
      sourceKind: "owned_snapshot",
      stableKey: "service-exact-location",
      title: "프리미엄 상품 안내 자세한 서비스 정보",
      content: "프리미엄 상품 안내 자세한 서비스 정보",
      sourceUrl: "https://example.com/services/very-long-location-path",
      destinationUrl: "https://example.com/services/very-long-location-path",
    });

    const searchWithIntent = async (
      query,
      isOffering,
      isProduct,
      isOfferingLocation,
    ) => database.query(
      "select * from search_brand_wiki_lexical($1, $2, $3, $4, $5, $6, $7)",
      [
        workspace.rows[0].id,
        brand.rows[0].id,
        query,
        12,
        isOffering,
        isProduct,
        isOfferingLocation,
      ],
    );
    const offering = await searchWithIntent("상품 안내", true, false, false);
    assert.ok(offering.rows.some((row) => row.wiki_page_id === ownedProductPageId));
    assert.ok(offering.rows.every((row) => ["product", "service"].includes(row.page_type)));
    assert.ok(offering.rows.every((row) => row.wiki_page_id !== articleProductPageId));
    assert.ok(offering.rows.every((row) => row.wiki_page_id !== catalog.id));

    const productPriority = await searchWithIntent(
      "프리미엄 상품 안내",
      true,
      true,
      false,
    );
    assert.equal(productPriority.rows[0].wiki_page_id, validProductPageId);

    const locationPriority = await searchWithIntent(
      "자세한 서비스 정보",
      true,
      false,
      true,
    );
    assert.equal(locationPriority.rows[0].wiki_page_id, shortLocationServicePageId);
  });
});

test("071 creates the onboarding worker v2 lifecycle and remains idempotent", async () => {
  const migrations = await loadMigrations();
  const migration071 = migrations.find(
    (migration) => migration.id === "071_brand_intelligence_onboarding_worker_v2.sql",
  );
  assert.ok(migration071);

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "070_remove_embedding_runtime.sql",
    );
    const workspace = await database.query(
      "insert into workspaces (name, slug) values ('Onboarding V2', $1) returning id",
      [`onboarding-v2-${randomUUID()}`],
    );
    const brand = await database.query(
      "insert into brands (workspace_id, name) values ($1, '내 브랜드') returning id",
      [workspace.rows[0].id],
    );

    await database.exec(migration071.sql);
    await database.exec(migration071.sql);

    const company = await database.query(
      `select company_name_state, company_name_confirmed_at
         from brands where id = $1`,
      [brand.rows[0].id],
    );
    assert.deepEqual(company.rows, [{
      company_name_state: "provisional",
      company_name_confirmed_at: null,
    }]);

    const lifecycleColumns = await database.query(
      `select column_name from information_schema.columns
        where table_schema = 'public'
          and table_name = 'brand_analysis_runs'
          and column_name in (
            'active_started_at', 'deadline_at', 'cancel_requested_at',
            'selected_page_count', 'successful_page_count',
            'required_page_count', 'completed_cli_stage_count'
          )
        order by column_name`,
    );
    assert.equal(lifecycleColumns.rows.length, 7);

    const tables = await database.query(
      `select table_name from information_schema.tables
        where table_schema = 'public'
          and table_name in (
            'brand_analysis_stage_runs', 'brand_analysis_cli_calls',
            'brand_analysis_cli_attempts', 'brand_offerings'
          )
        order by table_name`,
    );
    assert.deepEqual(tables.rows.map((row) => row.table_name), [
      "brand_analysis_cli_attempts",
      "brand_analysis_cli_calls",
      "brand_analysis_stage_runs",
      "brand_offerings",
    ]);

    const resourceConstraint = await database.query(
      `select pg_get_constraintdef(oid) as definition
         from pg_constraint
        where conname = 'worker_resource_leases_workload_check'`,
    );
    assert.match(resourceConstraint.rows[0].definition, /onboarding/);
  });
});

test("072 creates the isolated FAQ suggestion queue and remains idempotent", async () => {
  const migrations = await loadMigrations();
  const migration072 = migrations.find(
    (migration) => migration.id === "072_faq_suggestion_worker.sql",
  );
  assert.ok(migration072);

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "071_brand_intelligence_onboarding_worker_v2.sql",
    );
    await database.exec(migration072.sql);
    await database.exec(migration072.sql);

    const tables = await database.query(
      `select table_name
         from information_schema.tables
        where table_schema = 'public'
          and table_name in ('faq_suggestion_runs', 'faq_suggestion_items')
        order by table_name`,
    );
    assert.deepEqual(tables.rows.map((row) => row.table_name), [
      "faq_suggestion_items",
      "faq_suggestion_runs",
    ]);

    const workerTypeConstraint = await database.query(
      `select pg_get_constraintdef(oid) as definition
         from pg_constraint
        where conname = 'worker_instances_type_check'`,
    );
    assert.match(workerTypeConstraint.rows[0].definition, /faq/);

    const resourceConstraint = await database.query(
      `select pg_get_constraintdef(oid) as definition
         from pg_constraint
        where conname = 'worker_resource_leases_workload_check'`,
    );
    assert.match(resourceConstraint.rows[0].definition, /faq/);
    assert.match(resourceConstraint.rows[0].definition, /onboarding/);

    const actor = await database.query(
      `insert into app_users (email)
       values ($1)
       returning id`,
      [`faq-worker-${randomUUID()}@example.com`],
    );
    const workspace = await database.query(
      `insert into workspaces (name, slug)
       values ('FAQ Worker', $1)
       returning id`,
      [`faq-worker-${randomUUID()}`],
    );
    await database.query(
      `insert into workspace_members (workspace_id, user_id, role, status)
       values ($1, $2, 'owner', 'active')`,
      [workspace.rows[0].id, actor.rows[0].id],
    );
    const brand = await database.query(
      `insert into brands (workspace_id, name)
       values ($1, 'FAQ Brand')
       returning id`,
      [workspace.rows[0].id],
    );

    const run = await database.query(
      `insert into faq_suggestion_runs (
         workspace_id, brand_id, input_fingerprint, source_snapshot_json,
         created_by_user_id
       ) values ($1, $2, $3, $4::jsonb, $5)
       returning id`,
      [
        workspace.rows[0].id,
        brand.rows[0].id,
        "a".repeat(64),
        JSON.stringify({
          contractVersion: "faq-suggestion-sources.v1",
          sources: [{
            sourceType: "brand_core",
            sourceId: randomUUID(),
            contentHash: "b".repeat(64),
            label: "브랜드 코어",
          }],
        }),
        actor.rows[0].id,
      ],
    );

    await assert.rejects(
      database.query(
        `insert into faq_suggestion_runs (
           workspace_id, brand_id, input_fingerprint, source_snapshot_json,
           created_by_user_id
         ) values ($1, $2, $3, $4::jsonb, $5)`,
        [
          workspace.rows[0].id,
          brand.rows[0].id,
          "c".repeat(64),
          JSON.stringify({
            contractVersion: "faq-suggestion-sources.v1",
            sources: [{
              sourceType: "brand_core",
              sourceId: randomUUID(),
              contentHash: "d".repeat(64),
              label: "브랜드 코어",
            }],
          }),
          actor.rows[0].id,
        ],
      ),
      /faq_suggestion_runs_one_active_per_brand_uq/,
    );

    await database.query(
      `insert into faq_suggestion_items (
         workspace_id, brand_id, run_id, position, category, question,
         answer, evidence_json, confidence
       ) values ($1, $2, $3, 0, 'service', '상담이 가능한가요?',
         '브랜드 상담 채널에서 문의할 수 있습니다.', $4::jsonb, 0.9)`,
      [
        workspace.rows[0].id,
        brand.rows[0].id,
        run.rows[0].id,
        JSON.stringify([{
          sourceType: "brand_core",
          sourceId: randomUUID(),
          label: "브랜드 코어",
        }]),
      ],
    );

    await database.query(
      `insert into worker_instances (worker_id, worker_type)
       values ('faq-migration-test', 'faq')`,
    );
    await database.query(
      `insert into worker_resource_leases (
         resource_type, worker_id, workload_type, lease_token, expires_at
       ) values ('codex_cli', 'faq-migration-test', 'faq', gen_random_uuid(), now() + interval '1 minute')`,
    );
  });
});

test("075 creates the durable proposal audit, automated run, prompt binding, cleanup outbox, and topic upload idempotency contract", async () => {
  const migrations = await loadMigrations();
  const migration075 = migrations.find(
    (migration) => migration.id === "075_ai_content_three_format_cutover.sql",
  );
  assert.ok(migration075, "075 migration is required");
  assert.deepEqual({
    relations: [...migration075.sql.matchAll(/^create table\b/gim)].length,
    functions: [...migration075.sql.matchAll(/^create (?:or replace )?function\b/gim)].length,
    triggers: [...migration075.sql.matchAll(/^create (?:constraint )?trigger\b/gim)].length,
  }, {
    relations: 13,
    functions: 35,
    triggers: 22,
  }, "075 failure handling and retry lineage must reuse the sealed relation/function/trigger identities");
  assert.doesNotMatch(
    migration075.sql,
    /create (?:or replace )?function\s+copy_ai_content_generation_prompt_binding\b/i,
  );
  assert.doesNotMatch(
    migration075.sql,
    /create (?:constraint )?trigger\s+ai_content_generations_operation_required_before_start\b/i,
  );

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "074_ai_content_maintenance_write_fence.sql",
    );
    await run075SchemaBodyForPglite(database, migration075);

    const liveDomainTriggerDefinitions = await database.query(`
      select relation.relname as relation_name,trigger.tgname as trigger_name,
             pg_get_triggerdef(trigger.oid,true) as definition
        from pg_trigger trigger
        join pg_class relation on relation.oid=trigger.tgrelid
       where not trigger.tgisinternal
         and relation.relname || '|' || trigger.tgname = any($1::text[])
       order by relation.relname,trigger.tgname
    `, [cutover075DomainTriggers.map(({ relationName, triggerName }) => `${relationName}|${triggerName}`)]);
    assert.deepEqual(liveDomainTriggerDefinitions.rows, cutover075DomainTriggers.map((trigger) => ({
      relation_name: trigger.relationName,
      trigger_name: trigger.triggerName,
      definition: trigger.definition,
    })));

    const requiredTables = [
      "ai_content_proposal_performance_audits",
      "automated_content_proposal_runs",
      "ai_content_proposal_job_contracts",
      "ai_content_proposal_compositions",
      "ai_content_proposal_research_attempts",
      "ai_content_proposal_research_attempt_events",
      "ai_content_proposal_model_attempts",
      "ai_content_proposal_attempt_events",
      "ai_content_generation_prompt_bindings",
      "ai_content_generation_operations",
      "ai_content_cutover_release_adoptions",
      "ai_content_cutover_release_adoption_events",
      "ai_content_storage_cleanup_outbox",
    ];
    const found = await database.query(
      `select table_name
         from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])
        order by table_name`,
      [requiredTables],
    );
    assert.deepEqual(
      found.rows.map((row) => row.table_name),
      requiredTables.toSorted(),
    );

    assert.deepEqual(
      await readConstraintValues(
        database,
        "automated_content_proposal_runs",
        "automated_content_proposal_runs_status_check",
      ),
      ["dismissed", "failed", "queued", "ready", "selected"],
    );
    assert.deepEqual(
      await readConstraintValues(
        database,
        "ai_content_storage_cleanup_outbox",
        "ai_content_storage_cleanup_outbox_status_check",
      ),
      ["dead_letter", "deleted", "deleting", "failed", "pending", "retained_reference"],
    );

    const topicColumns = await database.query(
      `select column_name
         from information_schema.columns
        where table_schema='public' and table_name='topic_uploads'
          and column_name in ('operation_key','request_fingerprint')
        order by column_name`,
    );
    assert.deepEqual(topicColumns.rows, [
      { column_name: "operation_key" },
      { column_name: "request_fingerprint" },
    ]);

    const failClosedConstraints = await database.query(`
      select constraint_record.conname,pg_get_constraintdef(constraint_record.oid) as definition
        from pg_constraint constraint_record
       where constraint_record.conrelid in (
         'public.ai_content_proposal_jobs'::regclass,
         'public.topic_uploads'::regclass,
         'public.automated_content_proposal_runs'::regclass,
         'public.ai_content_storage_cleanup_outbox'::regclass,
         'public.ai_content_proposal_compositions'::regclass,
         'public.ai_content_generation_prompt_bindings'::regclass
       ) and constraint_record.conname in (
         'ai_content_proposal_jobs_lease_check','topic_uploads_operation_identity_check',
         'automated_content_proposal_runs_state_check',
         'ai_content_storage_cleanup_outbox_storage_path_check',
         'ai_content_proposal_compositions_input_contract_check',
         'ai_content_generation_prompt_bindings_json_check'
       ) order by constraint_record.conname
    `);
    const constraintDefinition = Object.fromEntries(
      failClosedConstraints.rows.map((row) => [row.conname, row.definition]),
    );
    assert.match(constraintDefinition.ai_content_proposal_jobs_lease_check, /IS TRUE/i);
    assert.match(constraintDefinition.ai_content_proposal_jobs_lease_check, /lease_owner IS NOT NULL/i);
    assert.match(constraintDefinition.topic_uploads_operation_identity_check, /IS TRUE/i);
    assert.match(constraintDefinition.topic_uploads_operation_identity_check, /request_fingerprint IS NOT NULL/i);
    assert.match(
      constraintDefinition.automated_content_proposal_runs_state_check,
      /status = 'failed'[\s\S]*selected_proposal_id IS NULL[\s\S]*selected_generation_id IS NULL/i,
    );
    assert.match(
      constraintDefinition.automated_content_proposal_runs_state_check,
      /status = 'dismissed'[\s\S]*selected_proposal_id IS NULL[\s\S]*selected_generation_id IS NULL/i,
    );
    assert.match(
      constraintDefinition.ai_content_storage_cleanup_outbox_storage_path_check,
      /storage_path = (?:btrim\(storage_path\)|TRIM\(BOTH FROM storage_path\))[\s\S]*IS TRUE/i,
    );
    assert.match(
      constraintDefinition.ai_content_proposal_compositions_input_contract_check,
      /contractVersion[\s\S]*composed_contract_version[\s\S]*IS TRUE/i,
    );
    assert.match(
      constraintDefinition.ai_content_generation_prompt_bindings_json_check,
      /binding_sha256[\s\S]*IS TRUE/i,
    );

    const beginAdoptionDefinition = (await database.query(
      "select pg_get_functiondef('public.begin_ai_content_cutover_release_adoption(uuid,uuid,text,text,text,text,text,text)'::regprocedure) as definition",
    )).rows[0].definition;
    assert.match(beginAdoptionDefinition, /normalized_reason\s+text/i);
    assert.match(beginAdoptionDefinition, /normalized_operator_identity\s+text/i);
    assert.match(
      beginAdoptionDefinition,
      /existing\.reason is distinct from normalized_reason/i,
    );
    assert.match(
      beginAdoptionDefinition,
      /existing\.operator_identity is distinct from normalized_operator_identity/i,
    );

    const hardenedFunctionDefinitions = Object.fromEntries(await Promise.all([
      "reject_ai_content_cutover_record_mutation()",
      "enforce_ai_content_proposal_model_attempt_contract()",
      "create_ai_content_cutover_topic_upload(uuid,uuid,uuid,text,text,jsonb)",
      "freeze_automated_content_proposal_run_identity()",
      "transition_automated_content_proposal_run(uuid,text,text,uuid,uuid,uuid,text,text)",
    ].map(async (identity) => [identity, (await database.query(
      "select pg_get_functiondef($1::regprocedure) as definition",
      [`public.${identity}`],
    )).rows[0].definition])));
    assert.match(
      hardenedFunctionDefinitions["reject_ai_content_cutover_record_mutation()"],
      /proposal_active_invocation_lease_takeover_invalid/,
    );
    assert.match(
      hardenedFunctionDefinitions["enforce_ai_content_proposal_model_attempt_contract()"],
      /proposal_model_attempt_unresolved_invocation/,
    );
    assert.match(
      hardenedFunctionDefinitions["create_ai_content_cutover_topic_upload(uuid,uuid,uuid,text,text,jsonb)"],
      /normalized_topics[\s\S]*stored_topics/i,
    );
    assert.match(
      hardenedFunctionDefinitions["freeze_automated_content_proposal_run_identity()"],
      /proposal_batch_id[\s\S]*automated_content_proposal_run_batch_immutable/i,
    );
    assert.match(
      hardenedFunctionDefinitions["transition_automated_content_proposal_run(uuid,text,text,uuid,uuid,uuid,text,text)"],
      /current_run[\s\S]*for update/i,
    );

    for (const identity of [
      "enforce_ai_content_proposal_research_attempt_contract()",
      "append_ai_content_proposal_research_attempt_event(uuid,uuid,integer,text,uuid,jsonb,text,text)",
      "enforce_ai_content_proposal_model_attempt_contract()",
      "append_ai_content_proposal_attempt_event(uuid,uuid,integer,integer,text,text,text,text,text,text,text,text,boolean)",
    ]) {
      const definition = (await database.query(
        "select pg_get_functiondef($1::regprocedure) as definition",
        [`public.${identity}`],
      )).rows[0].definition;
      assert.match(definition, /IS DISTINCT FROM/i, `${identity} must reject SQL NULL drift`);
      assert.match(definition, /lease_expires_at IS NULL/i, `${identity} must reject a NULL lease expiry`);
    }

    const invocationGuardTriggers = await database.query(`
      select tgname,tgdeferrable,tginitdeferred
        from pg_trigger
       where tgrelid='public.ai_content_proposal_jobs'::regclass
         and tgname in (
           'ai_content_proposal_jobs_invocation_reclaim_guard',
           'ai_content_proposal_jobs_invocation_evidence_guard'
         ) and not tgisinternal order by tgname
    `);
    assert.deepEqual(invocationGuardTriggers.rows, [{
      tgname: "ai_content_proposal_jobs_invocation_evidence_guard",
      tgdeferrable: true,
      tginitdeferred: true,
    }, {
      tgname: "ai_content_proposal_jobs_invocation_reclaim_guard",
      tgdeferrable: false,
      tginitdeferred: false,
    }]);

    const readPerformanceAuditTrigger = async () => (await database.query(`
      select trigger.tgtype::integer as trigger_type,trigger.tgenabled as enabled,
             trigger.tgdeferrable as deferrable,trigger.tginitdeferred as initially_deferred,
             namespace.nspname || '.' || function.proname || '(' || pg_get_function_identity_arguments(function.oid) || ')' as function_identity,
             pg_get_triggerdef(trigger.oid,true) as definition
        from pg_trigger trigger
        join pg_proc function on function.oid=trigger.tgfoid
        join pg_namespace namespace on namespace.oid=function.pronamespace
       where trigger.tgrelid='public.ai_content_proposal_performance_audits'::regclass
         and trigger.tgname='ai_content_proposal_performance_audits_immutable'
         and not trigger.tgisinternal
    `)).rows[0];
    const originalPerformanceAuditTrigger = await readPerformanceAuditTrigger();
    await database.exec(`
      drop trigger ai_content_proposal_performance_audits_immutable
        on ai_content_proposal_performance_audits;
      create trigger ai_content_proposal_performance_audits_immutable
        before update or delete on ai_content_proposal_performance_audits
        for each row execute function reject_ai_content_cutover_record_mutation('task3n-inert');
    `);
    const inertArgumentPerformanceAuditTrigger = await readPerformanceAuditTrigger();
    assert.deepEqual(
      { ...inertArgumentPerformanceAuditTrigger, definition: undefined },
      { ...originalPerformanceAuditTrigger, definition: undefined },
      "legacy domain-trigger metadata must demonstrate that inert TG_ARGV is otherwise invisible",
    );
    assert.notEqual(
      inertArgumentPerformanceAuditTrigger.definition,
      originalPerformanceAuditTrigger.definition,
    );
    await database.exec(`
      drop trigger ai_content_proposal_performance_audits_immutable
        on ai_content_proposal_performance_audits;
      create trigger ai_content_proposal_performance_audits_immutable
        before update or delete on ai_content_proposal_performance_audits
        for each row execute function reject_ai_content_cutover_record_mutation();
    `);
    assert.equal((await readPerformanceAuditTrigger()).definition, originalPerformanceAuditTrigger.definition);

    const researchCompletionFunction = await database.query(`
      select function.prosecdef as security_definer,
             pg_get_function_result(function.oid) as result_type,
             pg_get_functiondef(function.oid) as definition
        from pg_proc function
       where function.oid=to_regprocedure(
         'public.complete_ai_content_proposal_research(uuid,uuid,jsonb,text,jsonb,text,text)'
       )
    `);
    assert.equal(researchCompletionFunction.rows.length, 1);
    assert.equal(researchCompletionFunction.rows[0].security_definer, true);
    assert.match(
      researchCompletionFunction.rows[0].result_type,
      /ai_content_proposal_compositions$/,
    );
    assert.match(researchCompletionFunction.rows[0].definition, /pg_advisory_xact_lock/i);
    assert.match(researchCompletionFunction.rows[0].definition, /p_evidence_json::text/i);
    assert.match(researchCompletionFunction.rows[0].definition, /p_composed_input_json::text/i);

    const researchCompletionTrigger = await database.query(`
      select trigger.tgdeferrable,trigger.tginitdeferred,
             trigger.tgtype::integer as trigger_type,
             function.proname as function_name
        from pg_trigger trigger
        join pg_proc function on function.oid=trigger.tgfoid
       where trigger.tgrelid='public.ai_content_proposal_research_attempt_events'::regclass
         and trigger.tgname='ai_content_proposal_research_attempt_events_completion_pair'
         and not trigger.tgisinternal
    `);
    assert.deepEqual(researchCompletionTrigger.rows, [{
      tgdeferrable: true,
      tginitdeferred: true,
      trigger_type: 21,
      function_name: "enforce_ai_content_proposal_research_completion_pair",
    }]);

  });
});

test("075 rejects deletion-graph drift before DDL and declares protected-path reconciliation", async () => {
  const migrations = await loadMigrations();
  const migration075 = migrations.find(
    (migration) => migration.id === "075_ai_content_three_format_cutover.sql",
  );
  assert.ok(migration075, "075 migration is required");
  assert.match(migration075.sql, /075_DELETION_GRAPH_GUARD_BEGIN/);
  assert.match(migration075.sql, /ai_content_deletion_graph_mismatch/);
  assert.match(migration075.sql, /075_PROTECTED_STORAGE_RECONCILIATION_BEGIN/);
  assert.match(migration075.sql, /ai_content_attachment_deletion_lease_active/);
  assert.match(migration075.sql, /retained_reference/);
  assert.match(
    migration075.sql,
    /from ai_content_subject_images image\s+join ai_content_subject_analyses analysis[\s\S]*analysis\.generation_id is not null/,
    "only subject images in the generation-bound deletion graph may become cleanup candidates",
  );
  assert.match(migration075.sql, /output\.manifest_url/);
  assert.match(migration075.sql, /render\.result_json/);
  assert.match(migration075.sql, /brand_avatar_images/);
  assert.match(migration075.sql, /product_service_assets/);
  assert.match(migration075.sql, /reference_snapshots/);
  assert.match(
    migration075.sql,
    /status='pending'[\s\S]*where status in \('deleting','failed','dead_letter'\)/,
    "expired and terminal attachment cleanup attempts must be reset for cutover",
  );
  assert.doesNotMatch(
    migration075.sql,
    /on conflict\s*\(cutover_id,workspace_id,storage_path\)\s*do nothing/i,
    "an existing cleanup identity must never hide a source or checksum conflict",
  );
  assert.doesNotMatch(migration075.sql, /truncate[\s\S]*cascade/i);

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "074_ai_content_maintenance_write_fence.sql",
    );
    await database.exec(`
      create table task4_unexpected_generation_fk (
        id uuid primary key default gen_random_uuid(),
        generation_id uuid references ai_content_generations(id) on delete restrict
      );
    `);
    await assert.rejects(
      run075SchemaBodyForPglite(database, migration075),
      /ai_content_deletion_graph_mismatch/,
    );
    await database.exec("rollback");
    assert.equal(
      (await database.query("select to_regclass('public.ai_content_generation_operations') as relation"))
        .rows[0].relation,
      null,
      "graph drift must abort before the first 075 table is created",
    );
  });
});

test("075 leaves only the exact three-format and two-purpose relational schema", async () => {
  const migrations = await loadMigrations();
  const migration075 = migrations.find(
    (migration) => migration.id === "075_ai_content_three_format_cutover.sql",
  );
  assert.ok(migration075);
  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "074_ai_content_maintenance_write_fence.sql",
    );
    await run075SchemaBodyForPglite(database, migration075);
    const columns = await database.query(`
      select table_name,column_name,is_nullable
        from information_schema.columns
       where table_schema='public' and table_name in (
         'ai_content_generations','ai_content_proposal_batches','ai_content_generation_jobs'
       ) and column_name in ('type','content_family','content_type','output_format','purpose')
       order by table_name,column_name
    `);
    assert.deepEqual(columns.rows, [
      { table_name: "ai_content_generation_jobs", column_name: "output_format", is_nullable: "NO" },
      { table_name: "ai_content_generations", column_name: "output_format", is_nullable: "NO" },
      { table_name: "ai_content_generations", column_name: "purpose", is_nullable: "NO" },
      { table_name: "ai_content_proposal_batches", column_name: "purpose", is_nullable: "NO" },
    ]);
    const canonicalChecks = await database.query(`
      select conrelid::regclass::text relation,conname,pg_get_constraintdef(oid,true) definition
        from pg_constraint
       where conname in (
         'ai_content_generation_jobs_output_format_check',
         'ai_content_generations_output_format_check','ai_content_generations_purpose_check',
         'ai_content_proposal_batches_purpose_check','worker_instances_type_check'
       ) order by conname
    `);
    assert.equal(canonicalChecks.rows.length, 5);
    const definitions = canonicalChecks.rows.map((row) => row.definition).join("\n");
    assert.match(definitions, /card_news/);
    assert.match(definitions, /blog/);
    assert.match(definitions, /reel/);
    assert.match(definitions, /informational/);
    assert.match(definitions, /marketing/);
    assert.doesNotMatch(definitions, /single_image|channel_text|marketing_content/);
    assert.match(definitions, /content_proposal/);
    assert.match(definitions, /card_news/);
    const retiredWriter = await database.query(
      `select pg_get_functiondef(
         'start_ai_content_orchestration(uuid,uuid,uuid,jsonb,jsonb,uuid)'::regprocedure
       ) definition`,
    );
    assert.match(retiredWriter.rows[0].definition, /ai_content_orchestration_retired/);
    assert.doesNotMatch(retiredWriter.rows[0].definition, /insert\s+into|update\s+ai_content/i);
  });
});

test("075 makes proposal contracts, compositions, research and model attempt evidence, prompt bindings, and release adoption events immutable", async () => {
  const migrations = await loadMigrations();
  const migration075 = migrations.find(
    (migration) => migration.id === "075_ai_content_three_format_cutover.sql",
  );
  assert.ok(migration075, "075 migration is required");

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "074_ai_content_maintenance_write_fence.sql",
    );
    await run075SchemaBodyForPglite(database, migration075);
    const guarded = [
      "ai_content_proposal_job_contracts",
      "ai_content_proposal_compositions",
      "ai_content_proposal_research_attempts",
      "ai_content_proposal_research_attempt_events",
      "ai_content_proposal_model_attempts",
      "ai_content_proposal_attempt_events",
      "ai_content_generation_prompt_bindings",
      "ai_content_cutover_release_adoptions",
      "ai_content_cutover_release_adoption_events",
    ];
    for (const tableName of guarded) {
      const trigger = await database.query(
        `select trigger.tgenabled,
                trigger.tgtype::integer as trigger_type
           from pg_trigger trigger
          where trigger.tgrelid=to_regclass($1)
            and not trigger.tgisinternal
            and trigger.tgname=$2`,
        [`public.${tableName}`, `${tableName}_immutable`],
      );
      assert.deepEqual(
        trigger.rows,
        [{ tgenabled: "O", trigger_type: 27 }],
        `${tableName} must reject UPDATE and DELETE`,
      );
    }
  });
});

test("075 gives usage reservation, one exact reversal, and retry operations durable identities", async () => {
  const migrations = await loadMigrations();
  const migration075 = migrations.find(
    (migration) => migration.id === "075_ai_content_three_format_cutover.sql",
  );
  assert.ok(migration075, "075 migration is required");

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "074_ai_content_maintenance_write_fence.sql",
    );
    await run075SchemaBodyForPglite(database, migration075);
    const columns = await database.query(
      `select column_name
         from information_schema.columns
        where table_schema='public' and table_name='ai_content_usage_ledger'
          and column_name in ('operation_id','reservation_id','reversal_of_ledger_id')
        order by column_name`,
    );
    assert.deepEqual(columns.rows, [
      { column_name: "operation_id" },
      { column_name: "reservation_id" },
      { column_name: "reversal_of_ledger_id" },
    ]);
    const indexes = await database.query(
      `select indexname
         from pg_indexes
        where schemaname='public'
          and indexname in (
            'ai_content_usage_one_reservation_per_operation_uq',
            'ai_content_usage_one_reversal_per_reservation_uq',
            'topic_uploads_brand_operation_key_uq'
          )
        order by indexname`,
    );
    assert.deepEqual(indexes.rows, [
      { indexname: "ai_content_usage_one_reservation_per_operation_uq" },
      { indexname: "ai_content_usage_one_reversal_per_reservation_uq" },
      { indexname: "topic_uploads_brand_operation_key_uq" },
    ]);
  });
});
