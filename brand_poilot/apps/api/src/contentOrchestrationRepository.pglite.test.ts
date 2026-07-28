import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let database: PGlite | undefined;

const ids = {
  user: "10000000-0000-4000-8000-000000000001",
  workspace: "20000000-0000-4000-8000-000000000002",
  brand: "30000000-0000-4000-8000-000000000003",
  otherBrand: "30000000-0000-4000-8000-000000000004",
  core: "40000000-0000-4000-8000-000000000004",
  rules: "50000000-0000-4000-8000-000000000005",
  product: "60000000-0000-4000-8000-000000000006",
  productVersion: "70000000-0000-4000-8000-000000000007",
  batch: "80000000-0000-4000-8000-000000000008",
  firstProposal: "90000000-0000-4000-8000-000000000009",
  secondProposal: "90000000-0000-4000-8000-000000000010",
  generation: "a0000000-0000-4000-8000-00000000000a",
  avatar: "b0000000-0000-4000-8000-00000000000b",
  avatarImage: "c0000000-0000-4000-8000-00000000000c",
  otherBatch: "d0000000-0000-4000-8000-00000000000d",
  sourceUrl: "e0000000-0000-4000-8000-00000000000e",
  referenceItem: "f0000000-0000-4000-8000-00000000000f",
  noAvatarBatch: "11000000-0000-4000-8000-000000000011",
  noAvatarProposal: "12000000-0000-4000-8000-000000000012",
  noAvatarGeneration: "13000000-0000-4000-8000-000000000013",
};

beforeAll(async () => {
  database = await PGlite.create({ extensions: { pgcrypto } });
  const directory = resolve(process.cwd(), "../../db/migrations");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(resolve(directory, file), "utf8");
    if (sql.startsWith("-- requires: pgvector") || file === "027_wiki_search_v2.sql") continue;
    await database.exec(sql);
  }
  await database.exec(`
    insert into app_users (id, email) values ('${ids.user}', 'orchestration@example.com');
    insert into workspaces (id, name, slug) values ('${ids.workspace}', 'Orchestration', 'orchestration');
    insert into workspace_members (workspace_id, user_id, role)
      values ('${ids.workspace}', '${ids.user}', 'owner');
    insert into brands (id, workspace_id, name) values
      ('${ids.brand}', '${ids.workspace}', 'Primary'),
      ('${ids.otherBrand}', '${ids.workspace}', 'Other');
    insert into brand_profiles (workspace_id, brand_id) values
      ('${ids.workspace}', '${ids.brand}'),
      ('${ids.workspace}', '${ids.otherBrand}');
    insert into brand_core_versions (
      id, workspace_id, brand_id, version, status, core_json, created_by, approved_at
    ) values (
      '${ids.core}', '${ids.workspace}', '${ids.brand}', 1, 'approved', '{}', 'user', now()
    );
    insert into brand_rule_sets (
      id, workspace_id, brand_id, version, status, rules_json, created_by, approved_at
    ) values (
      '${ids.rules}', '${ids.workspace}', '${ids.brand}', 1, 'approved', '{}', 'user', now()
    );
    update brand_profiles
       set active_brand_core_id = '${ids.core}', active_brand_rule_set_id = '${ids.rules}'
     where brand_id = '${ids.brand}';
    insert into product_services (
      id, workspace_id, brand_id, kind, display_name
    ) values ('${ids.product}', '${ids.workspace}', '${ids.brand}', 'service', 'Approved service');
    insert into product_service_versions (
      id, workspace_id, brand_id, product_service_id, version, status,
      profile_json, approved_at
    ) values (
      '${ids.productVersion}', '${ids.workspace}', '${ids.brand}', '${ids.product}',
      1, 'approved', '{}', now()
    );
    update product_services set active_version_id = '${ids.productVersion}' where id = '${ids.product}';
    insert into source_urls (
      id, workspace_id, brand_id, source_type, url, url_hash, content_purpose
    ) values (
      '${ids.sourceUrl}', '${ids.workspace}', '${ids.brand}', 'reference',
      'https://example.com/reference', 'orchestration-reference', 'both'
    );
    insert into reference_items (
      id, workspace_id, brand_id, kind, source_url_id, content_purpose
    ) values (
      '${ids.referenceItem}', '${ids.workspace}', '${ids.brand}',
      'external_url', '${ids.sourceUrl}', 'both'
    );
    insert into ai_content_proposal_batches (
      id, workspace_id, brand_id, origin, content_family, request_json,
      source_snapshot_json, status, idempotency_key, created_by_user_id
    ) values (
      '${ids.batch}', '${ids.workspace}', '${ids.brand}', 'manual', 'marketing',
      '{"contractVersion":"content-proposal-request.v1"}',
      '[{"sourceId":"source-1","url":"https://example.com/source","crawledAt":"2026-07-28T00:00:00Z","contentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","summary":"bounded source"}]',
      'ready', 'batch-1', '${ids.user}'
    );
    insert into ai_content_proposals (
      id, workspace_id, brand_id, batch_id, position, proposal_json
    ) values
      ('${ids.firstProposal}', '${ids.workspace}', '${ids.brand}', '${ids.batch}', 1, '{"contractVersion":"content-proposal.v1"}'),
      ('${ids.secondProposal}', '${ids.workspace}', '${ids.brand}', '${ids.batch}', 2, '{"contractVersion":"content-proposal.v1"}');
    insert into ai_content_generations (
      id, workspace_id, brand_id, type, title, analysis_idempotency_key,
      content_family, output_format, subject_mode, product_service_id
    ) values (
      '${ids.generation}', '${ids.workspace}', '${ids.brand}', 'marketing', 'Generation',
      'orchestration-generation', 'marketing', 'single_image', 'product_service', '${ids.product}'
    );
    begin;
    insert into brand_avatars (
      id, workspace_id, brand_id, name, created_by_user_id
    ) values ('${ids.avatar}', '${ids.workspace}', '${ids.brand}', 'Active avatar', '${ids.user}');
    insert into brand_avatar_images (
      id, workspace_id, brand_id, avatar_id, position, is_representative,
      storage_url, storage_path, mime_type, size_bytes, checksum, created_by_user_id
    ) values (
      '${ids.avatarImage}', '${ids.workspace}', '${ids.brand}', '${ids.avatar}', 1, true,
      'https://cdn.example.com/avatar.webp', 'avatars/orchestration/avatar.webp',
      'image/webp', 1024, '${"a".repeat(64)}', '${ids.user}'
    );
    commit;
  `);
}, 60_000);

afterAll(async () => {
  await database?.close();
});

describe("content orchestration PostgreSQL contract", () => {
  it("selects one proposal atomically and dismisses its siblings", async () => {
    const db = database as PGlite;
    await Promise.all([
      db.query("select select_ai_content_proposal($1, $2, $3, $4)", [
        ids.firstProposal, ids.workspace, ids.brand, ids.user,
      ]),
      db.query("select select_ai_content_proposal($1, $2, $3, $4)", [
        ids.firstProposal, ids.workspace, ids.brand, ids.user,
      ]),
    ]);
    const proposals = await db.query<{ id: string; status: string; selected_by_user_id: string | null }>(
      "select id, status, selected_by_user_id from ai_content_proposals where batch_id = $1 order by position",
      [ids.batch],
    );
    expect(proposals.rows).toEqual([
      { id: ids.firstProposal, status: "selected", selected_by_user_id: ids.user },
      { id: ids.secondProposal, status: "dismissed", selected_by_user_id: null },
    ]);
    await expect(
      db.query("select select_ai_content_proposal($1, $2, $3, $4)", [
        ids.secondProposal, ids.workspace, ids.brand, ids.user,
      ]),
    ).rejects.toThrow(/proposal_already_selected/);
  });

  it("rejects an image snapshot that is not owned by the generation tenant", async () => {
    const db = database as PGlite;
    const snapshot = {
      contractVersion: "generation-brief.v1",
      brandCoreVersionId: ids.core,
      ruleSetId: ids.rules,
      productServiceVersionId: ids.productVersion,
      wikiVersionId: null,
      proposalId: ids.firstProposal,
      referenceSnapshots: [],
      avatarSnapshot: { avatarId: ids.avatar, imageId: ids.avatarImage },
      imageSnapshots: [{
        imageId: "eeeeeeee-0000-4000-8000-00000000000e",
        objectHash: "a".repeat(64),
      }],
    };
    await db.exec("begin");
    try {
      await expect(
        db.query("select start_ai_content_orchestration($1, $2, $3, $4, $5, $6)", [
          ids.generation, ids.workspace, ids.brand, JSON.stringify(snapshot),
          JSON.stringify(snapshot.avatarSnapshot), ids.user,
        ]),
      ).rejects.toThrow(/image_snapshot_not_owned/);
    } finally {
      await db.exec("rollback");
    }
  });

  it("freezes validated active snapshots once and preserves them for retries", async () => {
    const db = database as PGlite;
    const snapshot = {
      contractVersion: "generation-brief.v1",
      brandCoreVersionId: ids.core,
      ruleSetId: ids.rules,
      productServiceVersionId: ids.productVersion,
      wikiVersionId: null,
      proposalId: ids.firstProposal,
      referenceSnapshots: [],
      avatarSnapshot: { avatarId: ids.avatar, imageId: ids.avatarImage },
      imageSnapshots: [{ imageId: ids.avatarImage, objectHash: "a".repeat(64) }],
    };
    await Promise.all([
      db.query("select start_ai_content_orchestration($1, $2, $3, $4, $5, $6)", [
        ids.generation, ids.workspace, ids.brand, JSON.stringify(snapshot),
        JSON.stringify(snapshot.avatarSnapshot), ids.user,
      ]),
      db.query("select start_ai_content_orchestration($1, $2, $3, $4, $5, $6)", [
        ids.generation, ids.workspace, ids.brand, JSON.stringify(snapshot),
        JSON.stringify(snapshot.avatarSnapshot), ids.user,
      ]),
    ]);
    const frozen = await db.query<{ orchestration_snapshot: unknown }>(
      "select orchestration_snapshot from ai_content_generations where id = $1",
      [ids.generation],
    );
    expect(frozen.rows[0]?.orchestration_snapshot).toEqual(snapshot);

    await db.exec(`
      update product_services set status = 'archived' where id = '${ids.product}';
      update brand_avatars set status = 'archived' where id = '${ids.avatar}';
    `);
    await db.query("select start_ai_content_orchestration($1, $2, $3, $4, $5, $6)", [
      ids.generation, ids.workspace, ids.brand, JSON.stringify(snapshot),
      JSON.stringify(snapshot.avatarSnapshot), ids.user,
    ]);
    const retried = await db.query<{ orchestration_snapshot: unknown }>(
      "select orchestration_snapshot from ai_content_generations where id = $1",
      [ids.generation],
    );
    expect(retried.rows[0]?.orchestration_snapshot).toEqual(snapshot);
  });

  it("keeps a no-avatar start idempotent after storing JSON null as SQL null", async () => {
    const db = database as PGlite;
    await db.exec(`
      insert into ai_content_proposal_batches (
        id, workspace_id, brand_id, origin, content_family, request_json,
        source_snapshot_json, status, idempotency_key, created_by_user_id
      ) values (
        '${ids.noAvatarBatch}', '${ids.workspace}', '${ids.brand}', 'manual',
        'informational', '{}', '[]', 'ready', 'no-avatar-batch', '${ids.user}'
      );
      insert into ai_content_proposals (
        id, workspace_id, brand_id, batch_id, position, proposal_json
      ) values (
        '${ids.noAvatarProposal}', '${ids.workspace}', '${ids.brand}',
        '${ids.noAvatarBatch}', 1, '{}'
      );
      insert into ai_content_generations (
        id, workspace_id, brand_id, type, title, analysis_idempotency_key,
        content_family, output_format, subject_mode
      ) values (
        '${ids.noAvatarGeneration}', '${ids.workspace}', '${ids.brand}', 'blog',
        'No avatar generation', 'no-avatar-generation', 'informational', 'blog', 'brand_topic'
      );
    `);
    await db.query("select select_ai_content_proposal($1, $2, $3, $4)", [
      ids.noAvatarProposal, ids.workspace, ids.brand, ids.user,
    ]);
    const snapshot = {
      contractVersion: "generation-brief.v1",
      brandCoreVersionId: ids.core,
      ruleSetId: ids.rules,
      productServiceVersionId: null,
      wikiVersionId: null,
      proposalId: ids.noAvatarProposal,
      referenceSnapshots: [],
      avatarSnapshot: null,
      imageSnapshots: [],
    };
    await db.query("select start_ai_content_orchestration($1, $2, $3, $4, $5, $6)", [
      ids.noAvatarGeneration, ids.workspace, ids.brand, JSON.stringify(snapshot),
      JSON.stringify(null), ids.user,
    ]);
    await expect(
      db.query("select start_ai_content_orchestration($1, $2, $3, $4, $5, $6)", [
        ids.noAvatarGeneration, ids.workspace, ids.brand, JSON.stringify(snapshot),
        JSON.stringify(null), ids.user,
      ]),
    ).resolves.toBeDefined();
  });

  it("rejects cross-tenant links, invalid roles, and inactive start inputs", async () => {
    const db = database as PGlite;
    await expect(db.exec(`
      insert into ai_content_proposal_batches (
        id, workspace_id, brand_id, origin, content_family, request_json,
        source_snapshot_json, status, idempotency_key
      ) values (
        '${ids.otherBatch}', '${ids.workspace}', '${ids.otherBrand}', 'manual', 'marketing', '{}',
        '[{"sourceId":"source-1","url":"https://example.com","crawledAt":"2026-07-28T00:00:00Z","contentHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","summary":"summary"}]',
        'ready', 'cross-tenant'
      );
      insert into ai_content_proposals (
        workspace_id, brand_id, batch_id, position, proposal_json
      ) values ('${ids.workspace}', '${ids.brand}', '${ids.otherBatch}', 1, '{}');
    `)).rejects.toThrow();

    await expect(db.exec(`
      insert into ai_content_generation_references (
        generation_id, reference_id, workspace_id, brand_id, position, reference_item_id, roles_json
      ) values (
        '${ids.generation}', gen_random_uuid(), '${ids.workspace}', '${ids.brand}', 1,
        '${ids.referenceItem}', '["planning","not_allowed"]'
      )
    `)).rejects.toThrow(/ai_content_generation_references_canonical_check/);
    await expect(db.exec(`
      insert into ai_content_generation_references (
        generation_id, reference_id, workspace_id, brand_id, position, reference_item_id, roles_json
      ) values (
        '${ids.generation}', gen_random_uuid(), '${ids.workspace}', '${ids.brand}', 6,
        '${ids.referenceItem}', '["planning"]'
      )
    `)).rejects.toThrow(/ai_content_generation_references_canonical_check/);
    await expect(db.exec(`
      insert into ai_content_proposal_batches (
        workspace_id, brand_id, origin, content_family, request_json,
        source_snapshot_json, status, idempotency_key
      ) values (
        '${ids.workspace}', '${ids.brand}', 'manual', 'marketing', '{}',
        '[{"sourceId":"source-without-hash","url":"https://example.com","crawledAt":"2026-07-28T00:00:00Z","summary":"summary"}]',
        'ready', 'invalid-snapshot'
      )
    `)).rejects.toThrow();
  });
});
