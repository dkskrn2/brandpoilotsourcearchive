import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let database: PGlite | undefined;
let selectedProposalId = "";
let dismissedProposalId = "";

const ids = {
  actor: "10000000-0000-4000-8000-000000000001",
  competingActor: "10000000-0000-4000-8000-000000000002",
  workspace: "20000000-0000-4000-8000-000000000002",
  brand: "30000000-0000-4000-8000-000000000003",
  otherBrand: "30000000-0000-4000-8000-000000000004",
  core: "40000000-0000-4000-8000-000000000004",
  draftCore: "40000000-0000-4000-8000-000000000005",
  otherCore: "40000000-0000-4000-8000-000000000006",
  rules: "50000000-0000-4000-8000-000000000005",
  otherRules: "50000000-0000-4000-8000-000000000006",
  product: "60000000-0000-4000-8000-000000000006",
  productVersion: "70000000-0000-4000-8000-000000000007",
  draftProductVersion: "70000000-0000-4000-8000-000000000008",
  batch: "80000000-0000-4000-8000-000000000008",
  firstProposal: "90000000-0000-4000-8000-000000000009",
  secondProposal: "90000000-0000-4000-8000-000000000010",
  approvedProposal: "91000000-0000-4000-8000-000000000011",
  generation: "a0000000-0000-4000-8000-00000000000a",
  avatar: "b0000000-0000-4000-8000-00000000000b",
  avatarImage: "c0000000-0000-4000-8000-00000000000c",
  otherAvatar: "b0000000-0000-4000-8000-00000000000d",
  otherAvatarImage: "c0000000-0000-4000-8000-00000000000e",
  oneTimeAvatar: "b0000000-0000-4000-8000-00000000000f",
  oneTimeAvatarAsset: "c0000000-0000-4000-8000-00000000000f",
  sourceUrl: "d0000000-0000-4000-8000-00000000000d",
  referenceItem: "e0000000-0000-4000-8000-00000000000e",
  referenceSnapshot: "e1000000-0000-4000-8000-00000000000e",
  mutablePattern: "e2000000-0000-4000-8000-00000000000e",
  patternVersion: "f0000000-0000-4000-8000-00000000000f",
  wiki: "aa000000-0000-4000-8000-000000000001",
  readyWiki: "aa000000-0000-4000-8000-000000000002",
  otherWiki: "aa000000-0000-4000-8000-000000000003",
  noAvatarBatch: "11000000-0000-4000-8000-000000000011",
  noAvatarProposal: "12000000-0000-4000-8000-000000000012",
  noAvatarApproved: "12000000-0000-4000-8000-000000000013",
  noAvatarGeneration: "13000000-0000-4000-8000-000000000013",
  oneTimeBatch: "14000000-0000-4000-8000-000000000014",
  oneTimeProposal: "15000000-0000-4000-8000-000000000015",
  oneTimeApproved: "16000000-0000-4000-8000-000000000016",
  oneTimeGeneration: "17000000-0000-4000-8000-000000000017",
  equalityGeneration: "18000000-0000-4000-8000-000000000018",
};

const productProfileHash = "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a";
const wikiSnapshotHash = "94c400daf4714744abd2d87602cc780686c5555d6906197a40d350405266f6ac";

const approvedSnapshot = (proposalId: string, actorId = ids.actor) => ({
  contractVersion: "approved-proposal.v1",
  sourceProposalId: proposalId,
  revision: 1,
  effectiveProposal: { contractVersion: "content-proposal.v1" },
  editPatch: [],
  validationResultId: `validation-${proposalId}`,
  approvedBy: actorId,
  approvedAt: "2026-07-28T00:00:00.000Z",
});

const versionedSnapshot = (
  kind: "product_service" | "wiki",
  id: string,
  version: number,
  contentHash: string,
) => ({
  kind,
  id,
  version,
  title: kind === "product_service" ? "Approved service" : "Active Wiki",
  body: kind === "product_service" ? "{}" : "Approved Wiki facts",
  contentHash,
  capturedAt: "2026-07-28T00:00:00.000Z",
  stale: false,
  trustLevel: "approved",
  purpose: "both",
});

const canonicalReferenceSnapshot = {
  snapshotId: ids.referenceSnapshot,
  itemId: ids.referenceItem,
  version: 1,
  sourceUrl: "https://example.com/reference",
  capturedAt: "2026-07-28T00:00:00.000Z",
  contentHash: "92722245c0a680cff7a839bf84184056631adb36652ed97d10c26adc0cbc6f91",
  content: { text: "Bounded reference text" },
  media: {},
  sourceAvailability: "available",
  provenance: { kind: "saved_reference" },
  permittedUse: {
    displayPreview: true,
    archiveBytes: false,
    modelInput: true,
    derivativeInspiration: true,
  },
};

const canonicalPatternVersion = {
  patternVersionId: ids.patternVersion,
  itemId: ids.referenceItem,
  snapshotId: ids.referenceSnapshot,
  version: 1,
  analysisVersion: "reference-pattern.v1",
  observations: [],
  interpretation: "Bounded pattern",
  applicationIdeas: [],
  doNotCopy: [],
  confidence: 1,
};

const generationBrief = (overrides: Record<string, unknown> = {}) => ({
  contractVersion: "generation-brief.v1",
  proposalId: selectedProposalId,
  approvedProposalVersionId: ids.approvedProposal,
  approvedProposalSnapshot: approvedSnapshot(selectedProposalId),
  brandCoreVersionId: ids.core,
  ruleSetVersionId: ids.rules,
  subject: {
    kind: "approved_product_service",
    itemId: ids.product,
    version: versionedSnapshot("product_service", ids.productVersion, 1, productProfileHash),
    targetId: null,
    appealId: null,
  },
  wikiSnapshots: [versionedSnapshot("wiki", ids.wiki, 1, wikiSnapshotHash)],
  references: [{
    itemId: ids.referenceItem,
    snapshotId: ids.referenceSnapshot,
    patternVersionId: ids.patternVersion,
    roles: ["planning"],
  }],
  avatar: {
    id: ids.avatar,
    assetVersionId: ids.avatarImage,
    objectHash: "a".repeat(64),
    mime: "image/webp",
    provenance: "library",
  },
  outputFormat: "single_image",
  channels: ["instagram"],
  promptDefinitionVersions: { generation: "generation.v1" },
  ...overrides,
});

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
    insert into app_users (id, email) values
      ('${ids.actor}', 'orchestration@example.com'),
      ('${ids.competingActor}', 'orchestration-competitor@example.com');
    insert into workspaces (id, name, slug)
      values ('${ids.workspace}', 'Orchestration', 'orchestration');
    insert into workspace_members (workspace_id, user_id, role) values
      ('${ids.workspace}', '${ids.actor}', 'owner'),
      ('${ids.workspace}', '${ids.competingActor}', 'member');
    insert into brands (id, workspace_id, name) values
      ('${ids.brand}', '${ids.workspace}', 'Primary'),
      ('${ids.otherBrand}', '${ids.workspace}', 'Other');
    insert into brand_profiles (workspace_id, brand_id) values
      ('${ids.workspace}', '${ids.brand}'),
      ('${ids.workspace}', '${ids.otherBrand}');
    insert into brand_core_versions (
      id, workspace_id, brand_id, version, status, core_json, created_by, approved_at
    ) values
      ('${ids.core}', '${ids.workspace}', '${ids.brand}', 1, 'approved', '{}', 'user', now()),
      ('${ids.draftCore}', '${ids.workspace}', '${ids.brand}', 2, 'draft', '{}', 'user', null),
      ('${ids.otherCore}', '${ids.workspace}', '${ids.otherBrand}', 1, 'approved', '{}', 'user', now());
    insert into brand_rule_sets (
      id, workspace_id, brand_id, version, status, rules_json, created_by, approved_at
    ) values
      ('${ids.rules}', '${ids.workspace}', '${ids.brand}', 1, 'approved', '{}', 'user', now()),
      ('${ids.otherRules}', '${ids.workspace}', '${ids.otherBrand}', 1, 'approved', '{}', 'user', now());
    update brand_profiles
       set active_brand_core_id = '${ids.core}', active_brand_rule_set_id = '${ids.rules}'
     where brand_id = '${ids.brand}';
    update brand_profiles
       set active_brand_core_id = '${ids.otherCore}', active_brand_rule_set_id = '${ids.otherRules}'
     where brand_id = '${ids.otherBrand}';
    insert into product_services (
      id, workspace_id, brand_id, kind, display_name
    ) values ('${ids.product}', '${ids.workspace}', '${ids.brand}', 'service', 'Approved service');
    insert into product_service_versions (
      id, workspace_id, brand_id, product_service_id, version, status,
      profile_json, approved_at, created_at, updated_at
    ) values
      ('${ids.productVersion}', '${ids.workspace}', '${ids.brand}', '${ids.product}', 1, 'approved', '{}',
       '2026-07-28T00:00:00Z', '2026-07-28T00:00:00Z', '2026-07-28T00:00:00Z'),
      ('${ids.draftProductVersion}', '${ids.workspace}', '${ids.brand}', '${ids.product}', 2, 'draft', '{}',
       null, '2026-07-28T00:00:00Z', '2026-07-28T00:00:00Z');
    update product_services set active_version_id = '${ids.productVersion}' where id = '${ids.product}';
    insert into wiki_versions (
      id, workspace_id, brand_id, status, started_at, completed_at, activated_at, created_at, updated_at
    ) values
      ('${ids.wiki}', '${ids.workspace}', '${ids.brand}', 'active',
       '2026-07-28T00:00:00Z', '2026-07-28T00:00:00Z', '2026-07-28T00:00:00Z',
       '2026-07-28T00:00:00Z', '2026-07-28T00:00:00Z'),
      ('${ids.readyWiki}', '${ids.workspace}', '${ids.brand}', 'ready',
       '2026-07-28T00:00:00Z', '2026-07-28T00:00:00Z', null,
       '2026-07-28T00:00:00Z', '2026-07-28T00:00:00Z'),
      ('${ids.otherWiki}', '${ids.workspace}', '${ids.otherBrand}', 'active',
       '2026-07-28T00:00:00Z', '2026-07-28T00:00:00Z', '2026-07-28T00:00:00Z',
       '2026-07-28T00:00:00Z', '2026-07-28T00:00:00Z');
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
    insert into reference_patterns (
      id, workspace_id, brand_id, reference_item_id, confidence, analysis_version
    ) values (
      '${ids.mutablePattern}', '${ids.workspace}', '${ids.brand}',
      '${ids.referenceItem}', 1, 'reference-pattern.v1'
    );
    insert into reference_snapshots (
      id, workspace_id, brand_id, reference_item_id, version,
      content_hash, captured_at, snapshot_json
    ) values (
      '${ids.referenceSnapshot}', '${ids.workspace}', '${ids.brand}', '${ids.referenceItem}', 1,
      '${canonicalReferenceSnapshot.contentHash}', '2026-07-28T00:00:00Z',
      '${JSON.stringify(canonicalReferenceSnapshot)}'
    );
    insert into reference_pattern_versions (
      id, workspace_id, brand_id, reference_item_id, reference_snapshot_id,
      version, content_hash, analysis_version, pattern_json
    ) values (
      '${ids.patternVersion}', '${ids.workspace}', '${ids.brand}', '${ids.referenceItem}',
      '${ids.referenceSnapshot}', 1,
      encode(digest(('${JSON.stringify(canonicalPatternVersion)}'::jsonb)::text,'sha256'),'hex'),
      'reference-pattern.v1',
      '${JSON.stringify(canonicalPatternVersion)}'
    );
    insert into ai_content_proposal_batches (
      id, workspace_id, brand_id, origin, content_family, request_json,
      source_snapshot_json, status, idempotency_key, created_by_user_id
    ) values (
      '${ids.batch}', '${ids.workspace}', '${ids.brand}', 'manual', 'marketing',
      '{"contractVersion":"content-proposal-request.v1"}',
      '[{"sourceId":"source-1","url":"https://example.com/source","crawledAt":"2026-07-28T00:00:00Z","contentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","summary":"bounded source"}]',
      'ready', 'batch-1', '${ids.actor}'
    );
    insert into ai_content_proposals (
      id, workspace_id, brand_id, batch_id, position, proposal_json
    ) values
      ('${ids.firstProposal}', '${ids.workspace}', '${ids.brand}', '${ids.batch}', 1, '{}'),
      ('${ids.secondProposal}', '${ids.workspace}', '${ids.brand}', '${ids.batch}', 2, '{}');
    insert into ai_content_generations (
      id, workspace_id, brand_id, type, title, analysis_idempotency_key,
      content_family, output_format, subject_mode, product_service_id,
      generation_input_snapshot
    ) values (
      '${ids.generation}', '${ids.workspace}', '${ids.brand}', 'marketing', 'Generation',
      'orchestration-generation', 'marketing', 'single_image', 'product_service', '${ids.product}',
      '{"contractVersion":"content-generation-input.v2","contentType":"marketing"}'
    );
    begin;
    insert into brand_avatars (
      id, workspace_id, brand_id, name, created_by_user_id
    ) values
      ('${ids.avatar}', '${ids.workspace}', '${ids.brand}', 'Active avatar', '${ids.actor}'),
      ('${ids.otherAvatar}', '${ids.workspace}', '${ids.otherBrand}', 'Other avatar', '${ids.actor}');
    insert into brand_avatar_images (
      id, workspace_id, brand_id, avatar_id, position, is_representative,
      storage_url, storage_path, mime_type, size_bytes, checksum, created_by_user_id
    ) values
      ('${ids.avatarImage}', '${ids.workspace}', '${ids.brand}', '${ids.avatar}', 1, true,
       'https://cdn.example.com/avatar.webp', 'avatars/orchestration/avatar.webp',
       'image/webp', 1024, '${"a".repeat(64)}', '${ids.actor}'),
      ('${ids.otherAvatarImage}', '${ids.workspace}', '${ids.otherBrand}', '${ids.otherAvatar}', 1, true,
       'https://cdn.example.com/other-avatar.webp', 'avatars/orchestration/other-avatar.webp',
       'image/webp', 1024, '${"b".repeat(64)}', '${ids.actor}');
    commit;
  `);
}, 60_000);

afterAll(async () => {
  await database?.close();
});

describe("content orchestration PostgreSQL contract", () => {
  it("serializes competing proposal selections and audits the selected and dismissed rows", async () => {
    const db = database as PGlite;
    const outcomes = await Promise.allSettled([
      db.query("select select_ai_content_proposal($1, $2, $3, $4)", [
        ids.firstProposal, ids.workspace, ids.brand, ids.actor,
      ]),
      db.query("select select_ai_content_proposal($1, $2, $3, $4)", [
        ids.secondProposal, ids.workspace, ids.brand, ids.competingActor,
      ]),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);

    const proposals = await db.query<{
      id: string;
      status: string;
      selected_by_user_id: string | null;
      selected_at: string | null;
      dismissed_by_user_id: string | null;
      dismissed_at: string | null;
    }>("select * from ai_content_proposals where batch_id = $1 order by position", [ids.batch]);
    const selected = proposals.rows.find((row) => row.status === "selected");
    const dismissed = proposals.rows.find((row) => row.status === "dismissed");
    expect(selected?.selected_by_user_id).toBeTruthy();
    expect(selected?.selected_at).toBeTruthy();
    expect(dismissed?.dismissed_by_user_id).toBe(selected?.selected_by_user_id);
    expect(dismissed?.dismissed_at).toBeTruthy();
    selectedProposalId = String(selected?.id);
    dismissedProposalId = String(dismissed?.id);
  });

  it("returns the original idempotency resource for the same payload and rejects conflicts", async () => {
    const db = database as PGlite;
    const parameters = [
      ids.workspace, ids.brand, ids.actor, "generation_start", "client-request-1",
      "c".repeat(64), "generation", ids.generation, JSON.stringify({ status: "queued" }),
    ];
    const first = await db.query<{ record_id: string; resource_id: string; response_json: unknown }>(
      "select reserved.id record_id,reserved.resource_id,reserved.response_json from reserve_ai_content_create_idempotency($1,$2,$3,$4,$5,$6,$7,$8,$9) reserved",
      parameters,
    );
    const repeated = await db.query<{ record_id: string; resource_id: string; response_json: unknown }>(
      "select reserved.id record_id,reserved.resource_id,reserved.response_json from reserve_ai_content_create_idempotency($1,$2,$3,$4,$5,$6,$7,$8,$9) reserved",
      [...parameters.slice(0, 8), JSON.stringify({ status: "different-retry-response" })],
    );
    expect(repeated.rows[0]).toEqual(first.rows[0]);
    expect(repeated.rows[0]).toMatchObject({
      resource_id: ids.generation,
      response_json: { status: "queued" },
    });
    await expect(db.query(
      "select reserve_ai_content_create_idempotency($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [...parameters.slice(0, 5), "d".repeat(64), ...parameters.slice(6)],
    )).rejects.toThrow(/idempotency_conflict/);
    const actorScoped = await db.query<{ record_id: string }>(
      "select reserved.id record_id from reserve_ai_content_create_idempotency($1,$2,$3,$4,$5,$6,$7,$8,$9) reserved",
      [ids.workspace, ids.brand, ids.competingActor, ...parameters.slice(3)],
    );
    expect(actorScoped.rows[0]?.record_id).not.toBe(first.rows[0]?.record_id);
  });

  it("rejects forged content hashes on immutable reference resources", async () => {
    const db = database as PGlite;
    const forgedWiki = versionedSnapshot("wiki", ids.wiki, 1, "9".repeat(64));
    const snapshotValidation = await db.query<{ valid: boolean }>(
      "select ai_content_versioned_snapshot_is_valid($1,'wiki') valid",
      [JSON.stringify(forgedWiki)],
    );
    expect(snapshotValidation.rows[0]?.valid).toBe(false);

    const forgedSnapshotId = "e1000000-0000-4000-8000-000000000099";
    await db.exec("begin");
    try {
      await expect(db.query(
        `insert into reference_snapshots (
           id,workspace_id,brand_id,reference_item_id,version,
           content_hash,captured_at,snapshot_json
         ) values ($1,$2,$3,$4,2,$5,$6,$7)`,
        [
          forgedSnapshotId,
          ids.workspace,
          ids.brand,
          ids.referenceItem,
          "9".repeat(64),
          canonicalReferenceSnapshot.capturedAt,
          JSON.stringify({
            ...canonicalReferenceSnapshot,
            snapshotId: forgedSnapshotId,
            version: 2,
            contentHash: "9".repeat(64),
          }),
        ],
      )).rejects.toThrow();
    } finally {
      await db.exec("rollback");
    }

    await db.exec("begin");
    try {
      const forgedPatternId = "f1000000-0000-4000-8000-000000000099";
      await expect(db.query(
        `insert into reference_pattern_versions (
           id,workspace_id,brand_id,reference_item_id,reference_snapshot_id,
           version,content_hash,analysis_version,pattern_json
         ) values ($1,$2,$3,$4,$5,2,$6,'reference-pattern.v2',$7)`,
        [
          forgedPatternId,
          ids.workspace,
          ids.brand,
          ids.referenceItem,
          ids.referenceSnapshot,
          "9".repeat(64),
          JSON.stringify({
            ...canonicalPatternVersion,
            patternVersionId: forgedPatternId,
            version: 2,
            analysisVersion: "reference-pattern.v2",
          }),
        ],
      )).rejects.toThrow();
    } finally {
      await db.exec("rollback");
    }
  });

  it("rejects reduced briefs and non-exact or inactive resource snapshots before start", async () => {
    const db = database as PGlite;
    const snapshot = approvedSnapshot(selectedProposalId);
    await db.query(
      `insert into ai_content_approved_proposal_versions (
       id, workspace_id, brand_id, proposal_id, revision, approved_proposal_snapshot,
         validation_result_id, approved_by_user_id, approved_at
       ) values ($1,$2,$3,$4,1,$5,$6,$7,$8)`,
      [
        ids.approvedProposal, ids.workspace, ids.brand, selectedProposalId,
        JSON.stringify(snapshot), snapshot.validationResultId, ids.actor, snapshot.approvedAt,
      ],
    );
    await db.query(
      `insert into ai_content_generation_references (
         generation_id, reference_id, workspace_id, brand_id, position,
         reference_item_id, reference_snapshot_id, pattern_version_id, roles_json,
         reference_snapshot_json
       ) values (
         $1,gen_random_uuid(),$2,$3,1,$4,$5,$6,'["planning"]',$7
       )`,
      [
        ids.generation, ids.workspace, ids.brand, ids.referenceItem,
        ids.referenceSnapshot, ids.patternVersion, JSON.stringify(canonicalReferenceSnapshot),
      ],
    );

    const reduced = {
      contractVersion: "generation-brief.v1",
      proposalId: selectedProposalId,
      brandCoreVersionId: ids.core,
      ruleSetId: ids.rules,
      referenceSnapshots: [],
      avatarSnapshot: null,
      imageSnapshots: [],
    };
    await expect(db.query(
      "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)",
      [ids.generation, ids.workspace, ids.brand, JSON.stringify(reduced), "null", ids.actor],
    )).rejects.toThrow(/generation_brief_invalid/);

    await expect(db.query(
      "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)",
      [
        ids.generation, ids.workspace, ids.brand,
        JSON.stringify(generationBrief({ references: [] })),
        JSON.stringify(generationBrief().avatar), ids.actor,
      ],
    )).rejects.toThrow(/reference_snapshot_set_mismatch/);

    const incompleteProduct = generationBrief({
      subject: {
        kind: "approved_product_service",
        itemId: ids.product,
        version: { id: ids.productVersion, contentHash: "1".repeat(64) },
        targetId: null,
        appealId: null,
      },
    });
    await expect(db.query(
      "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)",
      [
        ids.generation, ids.workspace, ids.brand, JSON.stringify(incompleteProduct),
        JSON.stringify(incompleteProduct.avatar), ids.actor,
      ],
    )).rejects.toThrow(/generation_brief_invalid/);

    const incompleteWiki = generationBrief({
      wikiSnapshots: [{ id: ids.wiki, contentHash: "2".repeat(64) }],
    });
    await expect(db.query(
      "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)",
      [
        ids.generation, ids.workspace, ids.brand, JSON.stringify(incompleteWiki),
        JSON.stringify(incompleteWiki.avatar), ids.actor,
      ],
    )).rejects.toThrow(/generation_brief_invalid/);

    const changedApproval = generationBrief({
      approvedProposalSnapshot: {
        ...approvedSnapshot(selectedProposalId),
        effectiveProposal: { contractVersion: "content-proposal.v1", changed: true },
      },
    });
    await expect(db.query(
      "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)",
      [
        ids.generation, ids.workspace, ids.brand, JSON.stringify(changedApproval),
        JSON.stringify(changedApproval.avatar), ids.actor,
      ],
    )).rejects.toThrow(/approved_proposal_version_invalid/);

    const duplicateReference = generationBrief();
    duplicateReference.references = [duplicateReference.references[0], duplicateReference.references[0]];
    await expect(db.query(
      "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)",
      [
        ids.generation, ids.workspace, ids.brand, JSON.stringify(duplicateReference),
        JSON.stringify(duplicateReference.avatar), ids.actor,
      ],
    )).rejects.toThrow(/generation_brief_invalid/);

    for (const [brief, avatar, error] of [
      [generationBrief({ brandCoreVersionId: ids.draftCore }), generationBrief().avatar, "brand_versions_not_active_approved"],
      [generationBrief({ brandCoreVersionId: ids.otherCore }), generationBrief().avatar, "brand_versions_not_active_approved"],
      [generationBrief({
        subject: {
          kind: "approved_product_service",
          itemId: ids.product,
          version: versionedSnapshot("product_service", ids.draftProductVersion, 2, productProfileHash),
          targetId: null,
          appealId: null,
        },
      }), generationBrief().avatar, "product_version_not_active_approved"],
      [generationBrief({
        wikiSnapshots: [versionedSnapshot("wiki", ids.readyWiki, 1, wikiSnapshotHash)],
      }), generationBrief().avatar, "wiki_version_not_active"],
      [generationBrief({
        wikiSnapshots: [versionedSnapshot("wiki", ids.otherWiki, 1, wikiSnapshotHash)],
      }), generationBrief().avatar, "wiki_version_not_active"],
      [generationBrief({
        avatar: {
          id: ids.otherAvatar,
          assetVersionId: ids.otherAvatarImage,
          objectHash: "b".repeat(64),
          mime: "image/webp",
          provenance: "library",
        },
      }), {
        id: ids.otherAvatar,
        assetVersionId: ids.otherAvatarImage,
        objectHash: "b".repeat(64),
        mime: "image/webp",
        provenance: "library",
      }, "avatar_not_active_owned"],
    ] as const) {
      await expect(db.query(
        "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)",
        [ids.generation, ids.workspace, ids.brand, JSON.stringify(brief), JSON.stringify(avatar), ids.actor],
      )).rejects.toThrow(new RegExp(error));
    }

    await db.exec("begin");
    try {
      await db.query("update product_services set status='archived' where id=$1", [ids.product]);
      await expect(db.query(
        "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)",
        [
          ids.generation, ids.workspace, ids.brand, JSON.stringify(generationBrief()),
          JSON.stringify(generationBrief().avatar), ids.actor,
        ],
      )).rejects.toThrow(/product_version_not_active_approved/);
    } finally {
      await db.exec("rollback");
    }

    await expect(db.query(
      `insert into ai_content_generation_references (
         generation_id,reference_id,workspace_id,brand_id,position,
         reference_item_id,reference_snapshot_id,pattern_version_id,roles_json,
         reference_snapshot_json
       ) values (
         $1,gen_random_uuid(),$2,$3,2,$4,$5,$6,'["planning"]',$7
       )`,
      [
        ids.generation, ids.workspace, ids.otherBrand, ids.referenceItem,
        "e1000000-0000-4000-8000-000000000099", ids.patternVersion,
        JSON.stringify({ ...canonicalReferenceSnapshot, snapshotId: "e1000000-0000-4000-8000-000000000099" }),
      ],
    )).rejects.toThrow();

    await db.exec("begin");
    try {
      await expect(db.query(
        "update ai_content_generation_references set pattern_version_id=$2 where generation_id=$1",
        [ids.generation, ids.mutablePattern],
      )).rejects.toThrow();
    } finally {
      await db.exec("rollback");
    }

    await db.exec("begin");
    try {
      await db.query("update reference_items set archived_at=now() where id=$1", [ids.referenceItem]);
      await expect(db.query(
        "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)",
        [
          ids.generation, ids.workspace, ids.brand, JSON.stringify(generationBrief()),
          JSON.stringify(generationBrief().avatar), ids.actor,
        ],
      )).rejects.toThrow(/reference_snapshot_set_mismatch/);
    } finally {
      await db.exec("rollback");
    }

    await db.exec("begin");
    try {
      await db.query("update brand_avatars set status='archived' where id=$1", [ids.avatar]);
      await expect(db.query(
        "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)",
        [
          ids.generation, ids.workspace, ids.brand, JSON.stringify(generationBrief()),
          JSON.stringify(generationBrief().avatar), ids.actor,
        ],
      )).rejects.toThrow(/avatar_not_active_owned/);
    } finally {
      await db.exec("rollback");
    }
  });

  it("starts concurrently from one exact brief and retries the frozen snapshot without current reads", async () => {
    const db = database as PGlite;
    const brief = generationBrief();
    const calls = await Promise.all([
      db.query("select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)", [
        ids.generation, ids.workspace, ids.brand, JSON.stringify(brief),
        JSON.stringify(brief.avatar), ids.actor,
      ]),
      db.query("select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)", [
        ids.generation, ids.workspace, ids.brand, JSON.stringify(brief),
        JSON.stringify(brief.avatar), ids.actor,
      ]),
    ]);
    expect(calls).toHaveLength(2);

    await db.exec(`
      update product_services set status='archived' where id='${ids.product}';
      update reference_items set archived_at=now() where id='${ids.referenceItem}';
      update brand_avatars set status='archived' where id='${ids.avatar}';
      update brand_profiles set active_brand_core_id=null,active_brand_rule_set_id=null
       where brand_id='${ids.brand}';
    `);
    await expect(db.query(
      "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)",
      [
        ids.generation, ids.workspace, ids.brand, JSON.stringify(brief),
        JSON.stringify(brief.avatar), ids.actor,
      ],
    )).resolves.toBeDefined();
    const stored = await db.query<{ orchestration_snapshot: unknown; generation_input_snapshot: unknown }>(
      "select orchestration_snapshot,generation_input_snapshot from ai_content_generations where id=$1",
      [ids.generation],
    );
    expect(stored.rows[0]?.orchestration_snapshot).toEqual(brief);
    expect(stored.rows[0]?.generation_input_snapshot).toMatchObject({
      contractVersion: "content-generation-input.v2",
    });
    const resource = await db.query<{ brief_json: unknown; approved_proposal_version_id: string }>(
      "select brief_json,approved_proposal_version_id from ai_content_generation_briefs where generation_id=$1",
      [ids.generation],
    );
    expect(resource.rows).toEqual([{
      brief_json: brief,
      approved_proposal_version_id: ids.approvedProposal,
    }]);
  });

  it("starts and retries a canonical brand-topic brief without an avatar or references", async () => {
    const db = database as PGlite;
    const approval = approvedSnapshot(ids.noAvatarProposal);
    await db.exec(`
      update brand_profiles
         set active_brand_core_id='${ids.core}',active_brand_rule_set_id='${ids.rules}'
       where brand_id='${ids.brand}';
      insert into ai_content_proposal_batches (
        id,workspace_id,brand_id,origin,content_family,request_json,
        source_snapshot_json,status,idempotency_key,created_by_user_id
      ) values (
        '${ids.noAvatarBatch}','${ids.workspace}','${ids.brand}','manual',
        'informational','{}','[]','ready','no-avatar-batch','${ids.actor}'
      );
      insert into ai_content_proposals (
        id,workspace_id,brand_id,batch_id,position,proposal_json
      ) values (
        '${ids.noAvatarProposal}','${ids.workspace}','${ids.brand}',
        '${ids.noAvatarBatch}',1,'{}'
      );
      insert into ai_content_generations (
        id,workspace_id,brand_id,type,title,analysis_idempotency_key,
        content_family,output_format,subject_mode,generation_input_snapshot
      ) values (
        '${ids.noAvatarGeneration}','${ids.workspace}','${ids.brand}','blog',
        'No avatar','no-avatar-generation','informational','blog','brand_topic',
        '{"contractVersion":"content-generation-input.v2","contentType":"blog"}'
      );
    `);
    await db.query("select select_ai_content_proposal($1,$2,$3,$4)", [
      ids.noAvatarProposal, ids.workspace, ids.brand, ids.actor,
    ]);
    await db.query(
      `insert into ai_content_approved_proposal_versions (
         id,workspace_id,brand_id,proposal_id,revision,approved_proposal_snapshot,
         validation_result_id,approved_by_user_id,approved_at
       ) values ($1,$2,$3,$4,1,$5,$6,$7,$8)`,
      [
        ids.noAvatarApproved, ids.workspace, ids.brand, ids.noAvatarProposal,
        JSON.stringify(approval), approval.validationResultId, ids.actor, approval.approvedAt,
      ],
    );
    const brief = {
      contractVersion: "generation-brief.v1",
      proposalId: ids.noAvatarProposal,
      approvedProposalVersionId: ids.noAvatarApproved,
      approvedProposalSnapshot: approval,
      brandCoreVersionId: ids.core,
      ruleSetVersionId: ids.rules,
      subject: { kind: "brand_topic", topic: "Brand story", brandCoreEvidenceIds: [] },
      wikiSnapshots: [],
      references: [],
      avatar: null,
      outputFormat: "blog",
      channels: ["blog"],
      promptDefinitionVersions: { generation: "generation.v1" },
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(db.query(
        "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)",
        [
          ids.noAvatarGeneration, ids.workspace, ids.brand, JSON.stringify(brief),
          JSON.stringify(null), ids.actor,
        ],
      )).resolves.toBeDefined();
    }
  });

  it("allows a content-addressed one-time avatar without a library row", async () => {
    const db = database as PGlite;
    const approval = approvedSnapshot(ids.oneTimeProposal);
    await db.exec(`
      update brand_profiles
         set active_brand_core_id='${ids.core}',active_brand_rule_set_id='${ids.rules}'
       where brand_id='${ids.brand}';
      insert into ai_content_proposal_batches (
        id,workspace_id,brand_id,origin,content_family,request_json,
        source_snapshot_json,status,idempotency_key,created_by_user_id
      ) values (
        '${ids.oneTimeBatch}','${ids.workspace}','${ids.brand}','manual',
        'marketing','{}','[]','ready','one-time-avatar-batch','${ids.actor}'
      );
      insert into ai_content_proposals (
        id,workspace_id,brand_id,batch_id,position,proposal_json
      ) values (
        '${ids.oneTimeProposal}','${ids.workspace}','${ids.brand}',
        '${ids.oneTimeBatch}',1,'{}'
      );
      insert into ai_content_generations (
        id,workspace_id,brand_id,type,title,analysis_idempotency_key,
        content_family,output_format,subject_mode,generation_input_snapshot
      ) values (
        '${ids.oneTimeGeneration}','${ids.workspace}','${ids.brand}','marketing',
        'One-time avatar','one-time-avatar-generation','marketing','single_image','brand_topic',
        '{"contractVersion":"content-generation-input.v2","contentType":"marketing"}'
      );
    `);
    await db.query("select select_ai_content_proposal($1,$2,$3,$4)", [
      ids.oneTimeProposal, ids.workspace, ids.brand, ids.actor,
    ]);
    await db.query(
      `insert into ai_content_approved_proposal_versions (
         id,workspace_id,brand_id,proposal_id,revision,approved_proposal_snapshot,
         validation_result_id,approved_by_user_id,approved_at
       ) values ($1,$2,$3,$4,1,$5,$6,$7,$8)`,
      [
        ids.oneTimeApproved, ids.workspace, ids.brand, ids.oneTimeProposal,
        JSON.stringify(approval), approval.validationResultId, ids.actor, approval.approvedAt,
      ],
    );
    const avatar = {
      id: ids.oneTimeAvatar,
      assetVersionId: ids.oneTimeAvatarAsset,
      objectHash: "d".repeat(64),
      mime: "image/png",
      provenance: "one_time",
    };
    const brief = {
      contractVersion: "generation-brief.v1",
      proposalId: ids.oneTimeProposal,
      approvedProposalVersionId: ids.oneTimeApproved,
      approvedProposalSnapshot: approval,
      brandCoreVersionId: ids.core,
      ruleSetVersionId: ids.rules,
      subject: { kind: "brand_topic", topic: "One-time avatar", brandCoreEvidenceIds: [] },
      wikiSnapshots: [],
      references: [],
      avatar,
      outputFormat: "single_image",
      channels: ["instagram"],
      promptDefinitionVersions: { generation: "generation.v1" },
    };
    await expect(db.query(
      "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)",
      [
        ids.oneTimeGeneration, ids.workspace, ids.brand, JSON.stringify(brief),
        JSON.stringify(avatar), ids.actor,
      ],
    )).resolves.toBeDefined();
  });

  it("enforces immutable resource JSON equality on direct inserts", async () => {
    const db = database as PGlite;
    await db.exec("begin");
    try {
      const mismatchedApproval = approvedSnapshot(dismissedProposalId);
      await expect(db.query(
        `insert into ai_content_approved_proposal_versions (
           workspace_id,brand_id,proposal_id,revision,approved_proposal_snapshot,
           validation_result_id,approved_by_user_id,approved_at
         ) values ($1,$2,$3,2,$4,$5,$6,$7)`,
        [
          ids.workspace, ids.brand, dismissedProposalId, JSON.stringify(mismatchedApproval),
          mismatchedApproval.validationResultId, ids.actor, mismatchedApproval.approvedAt,
        ],
      )).rejects.toThrow();
    } finally {
      await db.exec("rollback");
    }

    await db.query(
      `insert into ai_content_generations (
         id,workspace_id,brand_id,type,title,analysis_idempotency_key,
         content_family,output_format,subject_mode,generation_input_snapshot
       ) values (
         $1,$2,$3,'blog','Equality generation','equality-generation',
         'informational','blog','brand_topic',
         '{"contractVersion":"content-generation-input.v2","contentType":"blog"}'
       )`,
      [ids.equalityGeneration, ids.workspace, ids.brand],
    );
    await expect(db.query(
      `insert into ai_content_generation_briefs (
         workspace_id,brand_id,generation_id,approved_proposal_version_id,
         brief_json,created_by_user_id
       ) values ($1,$2,$3,$4,$5,$6)`,
      [
        ids.workspace, ids.brand, ids.equalityGeneration, ids.noAvatarApproved,
        JSON.stringify({
          ...generationBrief({
            proposalId: selectedProposalId,
            approvedProposalVersionId: ids.approvedProposal,
            avatar: null,
            references: [],
            wikiSnapshots: [],
            outputFormat: "blog",
            subject: { kind: "brand_topic", topic: "Mismatch", brandCoreEvidenceIds: [] },
          }),
        }),
        ids.actor,
      ],
    )).rejects.toThrow();
  });

  it("keeps approved proposals, reference snapshots, patterns, and briefs immutable", async () => {
    const db = database as PGlite;
    await expect(db.query(
      "update ai_content_approved_proposal_versions set revision=2 where id=$1",
      [ids.approvedProposal],
    )).rejects.toThrow(/approved_proposal_version_immutable/);
    await expect(db.query(
      "update reference_snapshots set content_hash=$2 where id=$1",
      [ids.referenceSnapshot, "9".repeat(64)],
    )).rejects.toThrow(/reference_snapshot_immutable/);
    await expect(db.query(
      "update reference_pattern_versions set content_hash=$2 where id=$1",
      [ids.patternVersion, "9".repeat(64)],
    )).rejects.toThrow(/reference_pattern_version_immutable/);
    await expect(db.query(
      "update ai_content_generation_briefs set approved_proposal_version_id=$2 where generation_id=$1",
      [ids.generation, ids.noAvatarApproved],
    )).rejects.toThrow(/generation_brief_immutable/);
    expect(dismissedProposalId).toBeTruthy();
  });
});
