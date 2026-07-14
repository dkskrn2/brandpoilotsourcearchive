import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as migrationRunner from "./migrationRunner.mjs";

const { buildMigrationPlan } = migrationRunner;

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
