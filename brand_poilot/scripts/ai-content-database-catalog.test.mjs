import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { loadMigrations } from "./migrationRunner.mjs";

import {
  PRESERVED_DATASETS,
  buildPreservedDataCatalog,
  collectPreservedDataCatalog,
} from "./ai-content-database-catalog.mjs";

const REQUIRED_DATASET_KEYS = [
  "brands",
  "brand_core",
  "brand_rules",
  "users",
  "products",
  "product_versions",
  "product_assets",
  "analyses",
  "source_library",
  "reference_library",
  "published_outputs",
  "publication_history",
  "storage_artifacts",
];

test("preserved catalog declares every protected dataset and exact relation allowlists", () => {
  assert.deepEqual(PRESERVED_DATASETS.map(({ key }) => key), REQUIRED_DATASET_KEYS);
  assert.deepEqual(PRESERVED_DATASETS.find(({ key }) => key === "brands")?.relations, [
    "brands",
    "brand_profiles",
    "brand_channels",
    "brand_content_formats",
    "brand_format_rotation_states",
    "brand_profile_subcategories",
    "brand_trend_searches",
    "brand_trend_saved_media",
    "brand_audiences",
    "brand_appeals",
    "brand_avatars",
    "brand_avatar_images",
  ]);
  assert.deepEqual(PRESERVED_DATASETS.find(({ key }) => key === "products")?.relations, [
    "product_services",
    "product_service_legacy_mappings",
  ]);
  assert.deepEqual(PRESERVED_DATASETS.find(({ key }) => key === "product_versions")?.relations, [
    "product_service_versions",
  ]);
  assert.deepEqual(PRESERVED_DATASETS.find(({ key }) => key === "product_assets")?.relations, [
    "product_service_assets",
  ]);
  assert.deepEqual(PRESERVED_DATASETS.find(({ key }) => key === "published_outputs")?.relations, [
    "channel_outputs",
  ]);
  assert.deepEqual(PRESERVED_DATASETS.find(({ key }) => key === "publication_history")?.relations, [
    "publish_slots",
    "publish_queue",
    "publish_attempts",
  ]);
  assert.deepEqual(PRESERVED_DATASETS.find(({ key }) => key === "analyses")?.relations, [
    "ai_content_subject_analyses",
    "ai_content_subject_images",
    "brand_analysis_runs",
    "brand_analysis_uploads",
    "brand_analysis_stage_runs",
    "brand_analysis_cli_calls",
    "brand_analysis_cli_attempts",
    "brand_analysis_upload_attempts",
    "brand_offerings",
  ]);
  assert.ok(PRESERVED_DATASETS.find(({ key }) => key === "users")?.relations.includes("user_sessions"));
  assert.deepEqual(PRESERVED_DATASETS.find(({ key }) => key === "source_library")?.relations, [
    "source_urls",
    "source_content_items",
    "source_snapshots",
    "source_crawl_runs",
    "knowledge_imports",
    "knowledge_entries",
    "wiki_documents",
    "wiki_chunks",
    "wiki_versions",
    "wiki_build_items",
    "wiki_build_requests",
    "wiki_source_units",
    "wiki_pages",
    "wiki_page_sources",
    "wiki_page_links",
    "wiki_page_chunks",
    "wiki_compilation_items",
    "wiki_retrieval_runs",
    "wiki_maintenance_runs",
    "wiki_issues",
    "wiki_refresh_outbox",
  ]);
});

test("preserved catalog is deterministic across object key and database row order", () => {
  const inputA = {
    brands: ['{"id":"b","value":{"a":2,"z":1}}', '{"id":"a"}'],
    brand_profiles: ['{"brand_id":"a"}'],
  };
  const inputB = {
    brand_profiles: ['{"brand_id":"a"}'],
    brands: ['{"id":"a"}', '{"id":"b","value":{"a":2,"z":1}}'],
  };
  const first = buildPreservedDataCatalog(inputA);
  const second = buildPreservedDataCatalog(inputB);

  assert.deepEqual(first, second);
  assert.match(first.catalog_sha256, /^[0-9a-f]{64}$/);
  assert.equal(first.datasets.brands.count, "3");
  assert.equal(first.datasets.brands.relations.brands.count, "2");
  assert.equal(first.datasets.brands.relations.brand_profiles.count, "1");
  assert.equal(first.datasets.brand_core.status, "incomplete");
  assert.deepEqual(first.datasets.brand_core.relations.brand_core_versions, { status: "not_found" });
  assert.match(first.datasets.brands.sha256, /^[0-9a-f]{64}$/);
  assert.match(first.datasets.brands.relations.brands.sha256, /^[0-9a-f]{64}$/);
  const duplicate = buildPreservedDataCatalog({ brands: ['{"id":"same"}', '{"id":"same"}'] });
  const single = buildPreservedDataCatalog({ brands: ['{"id":"same"}'] });
  assert.notEqual(
    duplicate.datasets.brands.relations.brands.sha256,
    single.datasets.brands.relations.brands.sha256,
  );
});

test("collector reads only the declared preserved relations and records zero-row hashes", async () => {
  const calls = [];
  const cursors = new Map();
  const fetched = new Set();
  let released = false;
  const session = {
    async query({ text, values }) {
      calls.push({ text, values });
      if (/pg_class/.test(text)) return { rows: [{ relation_name: `public.${values[0]}`, relation_kind: "r" }] };
      if (/^declare /.test(text)) {
        const cursor = /^declare ([a-z0-9_]+)/.exec(text)[1];
        cursors.set(cursor, /public\."([a-z0-9_]+)"/.exec(text)[1]);
        return { rows: [] };
      }
      if (/^fetch /.test(text)) {
        const cursor = / from ([a-z0-9_]+)/.exec(text)[1];
        const relation = cursors.get(cursor);
        if (relation === "brands" && !fetched.has(cursor)) {
          fetched.add(cursor);
          return { rows: [{ row_json_text: '{"id":"brand-1"}' }] };
        }
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() { released = true; },
  };
  const queryable = {
    async query() { throw new Error("pool_query_must_not_be_used_for_cursor_transaction"); },
    async connect() { return session; },
  };

  const catalog = await collectPreservedDataCatalog(queryable);
  const expectedRelations = PRESERVED_DATASETS.flatMap(({ relations }) => relations);
  assert.deepEqual(
    calls.filter(({ text }) => /pg_class/.test(text)).map(({ values }) => values[0]),
    expectedRelations,
  );
  assert.equal(catalog.datasets.brands.relations.brands.count, "1");
  assert.equal(catalog.datasets.storage_artifacts.relations.storage_artifacts.count, "0");
  assert.match(catalog.datasets.storage_artifacts.relations.storage_artifacts.sha256, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(catalog).includes("token-secret"), false);
  assert.match(calls[0].text, /^begin transaction isolation level repeatable read read only$/);
  assert.equal(calls.filter(({ text }) => /^declare /.test(text)).length, expectedRelations.length);
  assert.equal(calls.at(-1).text, "commit");
  assert.equal(released, true);
});

test("analysis preservation uses deterministic bounded selectors, while session secrets remain hash-only", async () => {
  const selectedSql = new Map();
  const cursors = new Map();
  const queryable = {
    async query({ text, values }) {
      if (/pg_class/.test(text)) return { rows: [{ relation_name: `public.${values[0]}`, relation_kind: "r" }] };
      if (/^declare /.test(text)) {
        const cursor = /^declare ([a-z0-9_]+)/.exec(text)[1];
        const relation = /public\."([a-z0-9_]+)"/.exec(text)[1];
        cursors.set(cursor, relation);
        selectedSql.set(relation, text);
        return { rows: [] };
      }
      if (/^fetch /.test(text)) {
        const cursor = / from ([a-z0-9_]+)/.exec(text)[1];
        if (cursors.get(cursor) === "user_sessions" && !selectedSql.has("user_sessions_fetched")) {
          selectedSql.set("user_sessions_fetched", "yes");
          return { rows: [{ row_json_text: '{"token_hash":"token-secret"}' }] };
        }
      }
      return { rows: [] };
    },
  };
  const catalog = await collectPreservedDataCatalog(queryable);
  assert.match(selectedSql.get("ai_content_subject_analyses"), /generation_id is null/i);
  assert.match(selectedSql.get("ai_content_subject_analyses"), /product_service_versions/i);
  assert.match(selectedSql.get("ai_content_subject_analyses"), /product_service_assets/i);
  assert.match(selectedSql.get("ai_content_subject_analyses"), /source_image_id/i);
  assert.match(selectedSql.get("ai_content_subject_images"), /product_service_versions/i);
  assert.match(selectedSql.get("ai_content_subject_images"), /product_service_assets/i);
  assert.match(selectedSql.get("ai_content_subject_images"), /source_image_id/i);
  assert.equal(JSON.stringify(catalog).includes("token-secret"), false);
  assert.equal(catalog.datasets.users.relations.user_sessions.count, "1");
});

test("collector cursor-pages exact JSON text with duplicate runs spanning pages and unsafe integers", async () => {
  const pageCalls = [];
  const cursors = new Map();
  let brandFetch = 0;
  const queryable = { async query({ text, values }) {
    if (/pg_class/.test(text)) return { rows: [{ relation_name: `public.${values[0]}`, relation_kind: "r" }] };
    if (/^declare /.test(text)) {
      const cursor = /^declare ([a-z0-9_]+)/.exec(text)[1];
      cursors.set(cursor, /public\."([a-z0-9_]+)"/.exec(text)[1]);
      return { rows: [] };
    }
    if (/^fetch /.test(text)) {
      const cursor = / from ([a-z0-9_]+)/.exec(text)[1];
      const relation = cursors.get(cursor);
      pageCalls.push({ relation, text });
      if (relation !== "brands") return { rows: [] };
      brandFetch += 1;
      if (brandFetch <= 2) return { rows: [{ row_json_text: '{"n":9007199254740993}' }] };
      if (brandFetch === 3) return { rows: [{ row_json_text: '{"n":9007199254740994}' }] };
    }
    return { rows: [] };
  } };
  const catalog = await collectPreservedDataCatalog(queryable, { pageSize: 1 });
  assert.equal(catalog.schema_version, "ai-content-preserved-data-catalog.v2");
  assert.equal(catalog.row_encoding, "postgres-jsonb-text.v1");
  assert.match(catalog.hash_encoding, /length-prefixed-postgres-jsonb-text/);
  assert.equal(catalog.datasets.brands.relations.brands.count, "3");
  assert.equal(pageCalls.filter(({ relation }) => relation === "brands").length, 4);
  assert.ok(pageCalls.filter(({ relation }) => relation === "brands").every(({ text }) => /^fetch forward 1 /.test(text)));
});

test("BEGIN response loss always rolls back before safely releasing a pooled client", async () => {
  const originalError = new Error("begin_response_lost");
  const commands = [];
  const releaseArguments = [];
  const session = {
    async query({ text }) {
      commands.push(text);
      if (/^begin /.test(text)) throw originalError;
      if (text === "rollback") return { rows: [] };
      throw new Error(`unexpected:${text}`);
    },
    release(...args) { releaseArguments.push(args); },
  };
  const pool = { query: async () => { throw new Error("pool_query_forbidden"); }, connect: async () => session };
  await assert.rejects(collectPreservedDataCatalog(pool), (error) => error === originalError);
  assert.deepEqual(commands, ["begin transaction isolation level repeatable read read only", "rollback"]);
  assert.deepEqual(releaseArguments, [[]]);
});

test("rollback failure preserves the original error and destroys the pooled client", async () => {
  const originalError = new Error("begin_response_lost");
  const rollbackError = new Error("rollback_connection_lost");
  let releasedWith;
  const session = {
    async query({ text }) {
      if (/^begin /.test(text)) throw originalError;
      if (text === "rollback") throw rollbackError;
      throw new Error(`unexpected:${text}`);
    },
    release(error) { releasedWith = error; },
  };
  const pool = { query: async () => { throw new Error("pool_query_forbidden"); }, connect: async () => session };
  await assert.rejects(collectPreservedDataCatalog(pool), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.cause, originalError);
    assert.deepEqual(error.errors, [originalError, rollbackError]);
    return true;
  });
  assert.equal(releasedWith, rollbackError);
});

test("cursor FETCH remains unnamed across sequential page-size changes on one pinned client", async () => {
  const fetchCalls = [];
  const session = { async query(command) {
    const { text, values } = command;
    if (/pg_class/.test(text)) return { rows: [{ relation_name: `public.${values[0]}`, relation_kind: "r" }] };
    if (/^fetch /.test(text)) {
      fetchCalls.push(command);
      return { rows: [] };
    }
    return { rows: [] };
  } };
  await collectPreservedDataCatalog(session, { pageSize: 1000 });
  await collectPreservedDataCatalog(session, { pageSize: 1 });
  assert.ok(fetchCalls.some(({ text }) => /^fetch forward 1000 /.test(text)));
  assert.ok(fetchCalls.some(({ text }) => /^fetch forward 1 /.test(text)));
  assert.ok(fetchCalls.every((command) => !Object.hasOwn(command, "name")));
});

test("content catalog collectors compile against a fresh 001-073 PGlite schema", { timeout: 120_000 }, async () => {
  const database = await PGlite.create({ extensions: { pgcrypto } });
  try {
    const migrations = await loadMigrations();
    for (const migration of migrations) {
      if (migration.id > "073_ai_content_generation_v2_render_pipeline.sql") break;
      if (migration.sql.startsWith("-- requires: pgvector") || migration.id === "027_wiki_search_v2.sql") continue;
      await database.exec(migration.sql);
    }
    await database.exec("create table schema_migrations(id text primary key, applied_at timestamptz not null default now())");
    await database.query("insert into schema_migrations(id) values ($1)", ["073_ai_content_generation_v2_render_pipeline.sql"]);
    await database.exec(`
      set session_replication_role=replica;
      alter table ai_content_generations drop constraint ai_content_generations_orchestration_snapshot_check;
      alter table ai_content_wiki_version_snapshots drop constraint ai_content_wiki_version_snapshots_snapshot_json_check;
      insert into ai_content_generations (
        id,workspace_id,brand_id,type,title,analysis_idempotency_key,orchestration_snapshot
      ) values (
        '26998aec-b8c4-4abb-a1d8-a7204c1b6226',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        'blog','fixture','fixture-analysis',
        '{"wikiSnapshots":[{"id":"66666666-6666-4666-8666-666666666666"}]}'::jsonb
      );
      insert into ai_content_subject_analyses (
        id,workspace_id,brand_id,subject_type,input_json,idempotency_key,generation_id,contract_version
      ) values (
        '44444444-4444-4444-8444-444444444444',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        'product','{}','fixture-subject','26998aec-b8c4-4abb-a1d8-a7204c1b6226','subject-analysis.v2'
      );
      update ai_content_subject_analyses
      set status='failed',error_code='fixture_subject_failed',error_message='fixture'
      where id='44444444-4444-4444-8444-444444444444';
      insert into ai_content_subject_images (
        id,analysis_id,workspace_id,brand_id,source_url,storage_url,storage_path,mime_type,role
      ) values (
        '55555555-5555-4555-8555-555555555555',
        '44444444-4444-4444-8444-444444444444',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        'https://example.test/source.png','https://storage.test/source.png','fixture/source.png','image/png','product'
      );
      insert into ai_content_subject_appeal_regeneration_keys (analysis_id,idempotency_key)
      values ('44444444-4444-4444-8444-444444444444','fixture-regeneration');
      insert into ai_content_generation_reference_migration_audits (
        generation_id,workspace_id,brand_id,reference_count,exceeds_canonical_limit
      ) values (
        '26998aec-b8c4-4abb-a1d8-a7204c1b6226',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',0,false
      );
      insert into ai_content_wiki_version_snapshots (
        id,workspace_id,brand_id,wiki_version_id,snapshot_json
      ) values (
        '66666666-6666-4666-8666-666666666666',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '77777777-7777-4777-8777-777777777777',
        '{"id":"66666666-6666-4666-8666-666666666666"}'::jsonb
      );
      insert into ai_content_one_time_avatar_receipts (
        id,upload_session_id,generation_id,workspace_id,brand_id,created_by_user_id,
        object_hash,mime_type,storage_url,storage_path,confirmed_at
      ) values (
        '88888888-8888-4888-8888-888888888888','99999999-9999-4999-8999-999999999999',
        '26998aec-b8c4-4abb-a1d8-a7204c1b6226',
        '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333','${"a".repeat(64)}','image/png',
        'https://storage.test/avatar.png','fixture/avatar.png',now()
      );
      insert into ai_content_one_time_avatar_revocations (
        receipt_id,generation_id,workspace_id,brand_id,receipt_created_by_user_id,reason
      ) values (
        '88888888-8888-4888-8888-888888888888','26998aec-b8c4-4abb-a1d8-a7204c1b6226',
        '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333','attachment_unavailable'
      );
      insert into product_services (id,workspace_id,brand_id,kind,display_name)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222','product','fixture product');
      insert into product_service_versions (
        id,workspace_id,brand_id,product_service_id,version,status,profile_json
      ) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,'draft','{}');
      insert into product_service_assets (
        id,workspace_id,brand_id,product_service_id,product_service_version_id,source_image_id,
        storage_url,mime_type,size_bytes,role
      ) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','55555555-5555-4555-8555-555555555555',
        'https://storage.test/product.png','image/png',1,'hero');
      set session_replication_role=origin;
    `);
    const incidentIds = [
      "26998aec-b8c4-4abb-a1d8-a7204c1b6226",
      "71565421-d205-4627-8ea5-84633ac879cb",
    ];
    for (const [offset, generationId] of incidentIds.entries()) {
      const digit = String(offset + 1);
      const id = (prefix) => `${prefix}${digit.repeat(7)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
      if (offset === 1) {
        await database.exec("set session_replication_role=replica");
        await database.query(`insert into ai_content_generations
          (id,workspace_id,brand_id,type,title,analysis_idempotency_key)
          values ($1,'11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
            'blog','fixture second','fixture-analysis-second')`, [generationId]);
        await database.exec("set session_replication_role=origin");
      }
      await database.exec(`set session_replication_role=replica;
        insert into ai_content_proposal_batches
          (id,workspace_id,brand_id,origin,content_family,request_json,source_snapshot_json,status,idempotency_key)
        values ('${id("d")}', '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
          'manual','informational','{}','[]','ready','batch-${digit}');
        insert into ai_content_proposals
          (id,workspace_id,brand_id,batch_id,position,proposal_json,status,generation_id,selected_by_user_id,selected_at)
        values ('${id("e")}', '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
          '${id("d")}',1,'{}','selected','${generationId}','33333333-3333-4333-8333-333333333333',now());
        insert into ai_content_approved_proposal_versions
          (id,workspace_id,brand_id,proposal_id,revision,approved_proposal_snapshot,validation_result_id,approved_by_user_id,approved_at)
        values ('${id("f")}', '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
          '${id("e")}',1,'{"contractVersion":"approved-proposal.v1","sourceProposalId":"${id("e")}",
            "revision":1,"effectiveProposal":{},"editPatch":[],"validationResultId":"validation-${digit}",
            "approvedBy":"33333333-3333-4333-8333-333333333333","approvedAt":"2026-08-05T00:00:00Z"}',
          'validation-${digit}','33333333-3333-4333-8333-333333333333','2026-08-05T00:00:00Z');
        insert into ai_content_generation_outputs
          (id,generation_id,workspace_id,brand_id,output_index,title,status)
        values ('${id("0")}', '${generationId}','11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',1,'output-${digit}','completed');
        insert into ai_content_generation_jobs
          (id,generation_id,output_id,workspace_id,brand_id,job_type,content_type,status)
        values ('${id("1")}', '${generationId}','${id("0")}', '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222','generate','blog','succeeded');
        insert into channel_outputs
          (id,workspace_id,brand_id,content_topic_id,master_draft_id,channel,status,title,delivery_format,ai_content_generation_output_id)
        values ('${id("2")}', '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
          '${id("7")}','${id("8")}','instagram','pending_review','channel-${digit}','instagram_reel','${id("0")}');
        insert into jobs (id,workspace_id,brand_id,job_type,status,channel_output_id)
        values ('${id("3")}', '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
          'instagram_reel_render','succeeded','${id("2")}');
        insert into ai_content_generation_render_jobs
          (id,generation_id,output_id,workspace_id,brand_id,job_kind,status,payload_json)
        values ('${id("4")}', '${generationId}','${id("0")}', '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222','package_finalize','succeeded','{}');
        insert into ai_content_create_idempotency_records
          (id,workspace_id,brand_id,actor_user_id,operation,client_request_id,normalized_payload_hash,resource_type,resource_id)
        values ('${id("5")}', '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
          '33333333-3333-4333-8333-333333333333','generation_start','request-${digit}','${digit.repeat(64)}',
          'generation','${generationId}');
        set session_replication_role=origin;`);
    }
    const queryable = {
      query: ({ text, values }) => database.query(text, values),
    };
    const { collectIncidentEvidence } = await import("./ai-content-cutover-evidence.mjs");
    const evidence = await collectIncidentEvidence(queryable, { metadata: {
      release_sha: "893242d9a10b2a0af6b238297c124dcb666caf49",
      release_images: [{ component: "api", digest: `sha256:${"a".repeat(64)}` }],
    } });
    const catalog = await collectPreservedDataCatalog(queryable);
    assert.equal(catalog.datasets.users.relations.user_sessions.count, "0");
    const exactKinds = (section) => new Set(evidence.incidents[0][section].data.map(({ json_text }) => JSON.parse(json_text).kind));
    const orchestrationKinds = exactKinds("orchestration");
    assert.deepEqual(
      [...orchestrationKinds].filter((kind) => [
        "subject_appeal_regeneration_key",
        "generation_reference_migration_audit",
        "wiki_version_snapshot",
      ].includes(kind)).sort(),
      ["generation_reference_migration_audit", "subject_appeal_regeneration_key", "wiki_version_snapshot"],
    );
    const attachmentKinds = exactKinds("attachment_paths");
    assert.ok(attachmentKinds.has("one_time_avatar_receipt"));
    assert.ok(attachmentKinds.has("one_time_avatar_revocation"));
    const idempotencyKinds = exactKinds("idempotency");
    assert.ok(idempotencyKinds.has("subject_appeal_regeneration_key"));
    const errorKinds = exactKinds("errors");
    assert.ok(errorKinds.has("subject_analysis"));
    assert.equal(catalog.datasets.analyses.relations.ai_content_subject_analyses.count, "1");
    assert.equal(catalog.datasets.analyses.relations.ai_content_subject_images.count, "1");
    for (const [incidentIndex, generationId] of incidentIds.entries()) {
      const incident = evidence.incidents[incidentIndex];
      const digit = String(incidentIndex + 1);
      const expectedId = (prefix) => `${prefix}${digit.repeat(7)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
      assert.equal(incident.generation_id, generationId);
      const records = (section) => {
        const data = incident[section].data;
        return (Array.isArray(data) ? data : [data]).map(({ json_text }) => JSON.parse(json_text));
      };
      assert.ok(records("proposal_batch").some(({ kind, record }) => kind === "proposal_batch" && record.id === expectedId("d")));
      assert.ok(records("approval").some(({ kind, record }) => kind === "approved_proposal_version" && record.id === expectedId("f")));
      assert.ok(records("jobs").some(({ kind, record }) => kind === "generation_job" && record.id === expectedId("1") && record.generation_id === generationId));
      assert.ok(records("jobs").some(({ kind, record }) => kind === "legacy_channel_job" && record.id === expectedId("3")));
      assert.ok(records("outputs").some(({ kind, record }) => kind === "generation_output" && record.id === expectedId("0") && record.generation_id === generationId));
      assert.ok(records("render").some(({ kind, record }) => kind === "render_job" && record.id === expectedId("4") && record.generation_id === generationId));
      assert.ok(records("idempotency").some(({ kind, record }) => kind === "create_idempotency" && record.id === expectedId("5") && record.resource_id === generationId));
    }
  } finally {
    await database.close();
  }
});

test("collector fails closed when an exact preserved relation is missing", async () => {
  const commands = [];
  const queryable = {
    async query({ text, values }) {
      commands.push(text);
      if (/pg_class/.test(text)) {
        return { rows: values[0] === "brand_core_versions"
          ? []
          : [{ relation_name: `public.${values[0]}`, relation_kind: "r" }] };
      }
      return { rows: [] };
    },
  };

  await assert.rejects(
    collectPreservedDataCatalog(queryable),
    /preserved_relation_not_found:brand_core_versions/,
  );
  assert.match(commands[0], /^begin transaction isolation level repeatable read read only$/);
  assert.equal(commands.at(-1), "rollback");
});

test("collector rejects a view substituted for an exact preserved table", async () => {
  const queryable = {
    async query({ text, values }) {
      if (/pg_class/.test(text)) {
        return { rows: [{ relation_name: `public.${values[0]}`, relation_kind: values[0] === "brands" ? "v" : "r" }] };
      }
      return { rows: [] };
    },
  };

  await assert.rejects(
    collectPreservedDataCatalog(queryable),
    /preserved_relation_kind_invalid:brands:v/,
  );
});

test("catalog builder rejects rows for an undeclared relation", () => {
  assert.throws(
    () => buildPreservedDataCatalog({ brands: [], ai_content_generations: [] }),
    /preserved_relation_not_declared:ai_content_generations/,
  );
  assert.throws(
    () => buildPreservedDataCatalog({ brands: [{ id: "not-exact-text" }] }),
    /preserved_relation_exact_text_required:brands/,
  );
});
