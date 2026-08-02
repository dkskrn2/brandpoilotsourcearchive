import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAiContentRepository } from "./aiContentRepository.js";
import { enqueueAutomatedCardNews } from "./automatedCardNews.js";

let database: PGlite | undefined;
let selectedProposalId = "";
let dismissedProposalId = "";

const ids = {
  actor: "10000000-0000-4000-8000-000000000001",
  competingActor: "10000000-0000-4000-8000-000000000002",
  inactiveActor: "10000000-0000-4000-8000-000000000003",
  deletedActor: "10000000-0000-4000-8000-000000000004",
  nonmemberActor: "10000000-0000-4000-8000-000000000005",
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
  pendingAvatar: "b1000000-0000-4000-8000-00000000000f",
  pendingAvatarAsset: "c1000000-0000-4000-8000-00000000000f",
  crossGenerationAvatar: "b2000000-0000-4000-8000-00000000000f",
  crossGenerationAvatarAsset: "c2000000-0000-4000-8000-00000000000f",
  crossActorAvatar: "b3000000-0000-4000-8000-00000000000f",
  crossActorAvatarAsset: "c3000000-0000-4000-8000-00000000000f",
  crossBrandAvatar: "b4000000-0000-4000-8000-00000000000f",
  crossBrandAvatarAsset: "c4000000-0000-4000-8000-00000000000f",
  revokedAvatar: "b5000000-0000-4000-8000-00000000000f",
  revokedAvatarAsset: "c5000000-0000-4000-8000-00000000000f",
  physicallyDeletedAvatar: "b6000000-0000-4000-8000-00000000000f",
  physicallyDeletedAvatarAsset: "c6000000-0000-4000-8000-00000000000f",
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
  receiptGeneration: "19000000-0000-4000-8000-000000000019",
  otherBrandGeneration: "1a000000-0000-4000-8000-00000000001a",
  analyzedSubject: "1b000000-0000-4000-8000-00000000001b",
  analyzedSnapshot: "1c000000-0000-4000-8000-00000000001c",
  analyzedBatch: "1d000000-0000-4000-8000-00000000001d",
  analyzedProposal: "1e000000-0000-4000-8000-00000000001e",
  analyzedApproved: "1f000000-0000-4000-8000-00000000001f",
  analyzedGeneration: "2a000000-0000-4000-8000-00000000002a",
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

async function insertOneTimeReceipt(
  db: PGlite,
  input: {
    sessionId: string;
    attachmentId: string;
    generationId: string;
    brandId: string;
    actorId: string;
    status?: "pending" | "confirmed";
    checksum?: string;
    mime?: "image/png" | "image/jpeg" | "image/webp";
  },
) {
  const status = input.status ?? "confirmed";
  const checksum = input.checksum ?? "d".repeat(64);
  const mime = input.mime ?? "image/png";
  const storagePath = `one-time/${input.sessionId}.png`;
  const storageUrl = `https://cdn.example.com/${input.sessionId}.png`;
  await db.query(
    `insert into ai_content_attachment_upload_sessions (
       id,generation_id,workspace_id,brand_id,created_by_user_id,role,file_name,
       expected_mime_type,expected_size_bytes,expected_checksum,storage_url,storage_path
     ) values ($1,$2,$3,$4,$5,'person','avatar.png',$6,1024,$7,$8,$9)`,
    [
      input.sessionId,
      input.generationId,
      ids.workspace,
      input.brandId,
      input.actorId,
      mime,
      checksum,
      storageUrl,
      storagePath,
    ],
  );
  if (status === "pending") return;
  await db.query(
    `insert into ai_content_generation_attachments (
       id,generation_id,workspace_id,brand_id,upload_session_id,role,file_name,
       mime_type,size_bytes,checksum,storage_url,storage_path
     ) values ($1,$2,$3,$4,$5,'person','avatar.png',$6,1024,$7,$8,$9)`,
    [
      input.attachmentId,
      input.generationId,
      ids.workspace,
      input.brandId,
      input.sessionId,
      mime,
      checksum,
      storageUrl,
      storagePath,
    ],
  );
  await db.query(
    `update ai_content_attachment_upload_sessions
        set status='confirmed',confirmed_at=now(),confirmed_attachment_id=$2
      where id=$1`,
    [input.sessionId, input.attachmentId],
  );
}

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
      ('${ids.competingActor}', 'orchestration-competitor@example.com'),
      ('${ids.inactiveActor}', 'orchestration-inactive@example.com'),
      ('${ids.deletedActor}', 'orchestration-deleted@example.com'),
      ('${ids.nonmemberActor}', 'orchestration-nonmember@example.com');
    insert into workspaces (id, name, slug)
      values ('${ids.workspace}', 'Orchestration', 'orchestration');
    insert into workspace_members (
      workspace_id, user_id, role, status, created_at, updated_at, deleted_at
    ) values
      ('${ids.workspace}', '${ids.actor}', 'owner', 'active', now(), now(), null),
      ('${ids.workspace}', '${ids.competingActor}', 'member', 'active', now(), now(), null),
      ('${ids.workspace}', '${ids.inactiveActor}', 'member', 'disabled', now(), now(), null),
      ('${ids.workspace}', '${ids.deletedActor}', 'member', 'active', now(), now(), now());
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
    insert into ai_content_wiki_version_snapshots (
      id, workspace_id, brand_id, wiki_version_id, snapshot_json
    ) values
      ('${ids.wiki}', '${ids.workspace}', '${ids.brand}', '${ids.wiki}',
       '${JSON.stringify(versionedSnapshot("wiki", ids.wiki, 1, wikiSnapshotHash))}'),
      ('${ids.readyWiki}', '${ids.workspace}', '${ids.brand}', '${ids.readyWiki}',
       '${JSON.stringify(versionedSnapshot("wiki", ids.readyWiki, 1, wikiSnapshotHash))}'),
      ('${ids.otherWiki}', '${ids.workspace}', '${ids.otherBrand}', '${ids.otherWiki}',
       '${JSON.stringify(versionedSnapshot("wiki", ids.otherWiki, 1, wikiSnapshotHash))}');
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
  it("keeps the legacy repository fixture queryable after migration 072", async () => {
    const persisted = await database!.query(
      `select output_format,generation_input_snapshot
         from ai_content_generations
        where id=$1`,
      [ids.generation],
    );
    expect(persisted.rows).toEqual([{
      output_format: "single_image",
      generation_input_snapshot: {
        contractVersion: "content-generation-input.v2",
        contentType: "marketing",
      },
    }]);

    const migrationColumns = await database!.query(
      `select input_snapshot_json
         from ai_content_proposal_batches
        where id=$1`,
      [ids.batch],
    );
    expect(migrationColumns.rows).toEqual([{ input_snapshot_json: null }]);
  });

  it("starts with a frozen ready analyzed-subject snapshot without masquerading as a product or topic", async () => {
    await database!.exec("begin");
    try {
      await database!.query(
        `insert into ai_content_subject_analyses (
           id,workspace_id,brand_id,subject_type,source_url,normalized_url,input_json,
           status,facts_json,structured_data_json,research_json,analysis_result_json,
           contract_version,analysis_version,idempotency_key,completed_at
         ) values (
           $1,$2,$3,'service','https://example.com/service','https://example.com/service',
           '{"name":"Analyzed service"}','ready','[{"key":"name","value":"Analyzed service"}]',
           '{}','{"sources":[]}','{"summary":"Ready analysis"}','subject-analysis.v1',2,
           'analyzed-subject-066','2026-07-28T00:00:00Z'
         )`,
        [ids.analyzedSubject, ids.workspace, ids.brand],
      );
      const snapshot = {
        contractVersion: "analyzed-subject-snapshot.v1",
        snapshotId: ids.analyzedSnapshot,
        analysisId: ids.analyzedSubject,
        analysisVersion: 2,
        analysisContractVersion: "subject-analysis.v1",
        subjectType: "service",
        source: {
          sourceUrl: "https://example.com/service",
          normalizedUrl: "https://example.com/service",
          input: { name: "Analyzed service" },
        },
        facts: [{ key: "name", value: "Analyzed service" }],
        research: { sources: [] },
        analysisResult: { summary: "Ready analysis" },
        selectedImages: [],
        capturedAt: "2026-07-28T00:00:00.000Z",
      };
      await database!.query(
        `insert into ai_content_analyzed_subject_snapshots (
           id,workspace_id,brand_id,analysis_id,snapshot_json
         ) values ($1,$2,$3,$4,$5::jsonb)`,
        [ids.analyzedSnapshot, ids.workspace, ids.brand, ids.analyzedSubject, JSON.stringify(snapshot)],
      );
      await database!.query(
        `insert into ai_content_proposal_batches (
           id,workspace_id,brand_id,origin,content_family,request_json,
           source_snapshot_json,status,idempotency_key,created_by_user_id
         ) values ($1,$2,$3,'manual','informational','{}','[]','ready','analyzed-066',$4)`,
        [ids.analyzedBatch, ids.workspace, ids.brand, ids.actor],
      );
      await database!.query(
        `insert into ai_content_proposals (
           id,workspace_id,brand_id,batch_id,position,proposal_json,status,
           selected_by_user_id,selected_at
         ) values ($1,$2,$3,$4,1,'{}','selected',$5,'2026-07-28T00:00:00Z')`,
        [ids.analyzedProposal, ids.workspace, ids.brand, ids.analyzedBatch, ids.actor],
      );
      await database!.query(
        `insert into ai_content_generations (
           id,workspace_id,brand_id,type,title,status,analysis_idempotency_key,
           content_family,output_format,subject_mode
         ) values ($1,$2,$3,'blog','Analyzed subject','draft','analyzed-generation-066',
                   'informational','blog','new_subject')`,
        [ids.analyzedGeneration, ids.workspace, ids.brand],
      );
      await database!.query(
        "update ai_content_proposals set generation_id=$2 where id=$1",
        [ids.analyzedProposal, ids.analyzedGeneration],
      );
      const approval = approvedSnapshot(ids.analyzedProposal);
      await database!.query(
        `insert into ai_content_approved_proposal_versions (
           id,workspace_id,brand_id,proposal_id,revision,approved_proposal_snapshot,
           validation_result_id,approved_by_user_id,approved_at
         ) values ($1,$2,$3,$4,1,$5::jsonb,$6,$7,'2026-07-28T00:00:00Z')`,
        [
          ids.analyzedApproved, ids.workspace, ids.brand, ids.analyzedProposal,
          JSON.stringify(approval), approval.validationResultId, ids.actor,
        ],
      );
      const brief = generationBrief({
        proposalId: ids.analyzedProposal,
        approvedProposalVersionId: ids.analyzedApproved,
        approvedProposalSnapshot: approval,
        subject: {
          kind: "analyzed_subject",
          analysisId: ids.analyzedSubject,
          snapshotId: ids.analyzedSnapshot,
          snapshot,
        },
        wikiSnapshots: [],
        references: [],
        avatar: null,
        outputFormat: "blog",
        channels: ["blog_export"],
      });

      await database!.exec("savepoint subject_mode_mismatch");
      await database!.query(
        "update ai_content_generations set subject_mode='brand_topic' where id=$1",
        [ids.analyzedGeneration],
      );
      await expect(database!.query(
        "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)",
        [
          ids.analyzedGeneration, ids.workspace, ids.brand, JSON.stringify(brief),
          JSON.stringify(null), ids.actor,
        ],
      )).rejects.toThrow(/generation_subject_mode_mismatch/);
      await database!.exec("rollback to savepoint subject_mode_mismatch");
      await expect(database!.query(
        "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)",
        [
          ids.analyzedGeneration, ids.workspace, ids.brand, JSON.stringify(brief),
          JSON.stringify(null), ids.actor,
        ],
      )).resolves.toBeDefined();
      const stored = await database!.query<{ orchestration_snapshot: Record<string, any> }>(
        "select orchestration_snapshot from ai_content_generations where id=$1",
        [ids.analyzedGeneration],
      );
      expect(stored.rows[0]?.orchestration_snapshot.subject).toMatchObject({
        kind: "analyzed_subject",
        analysisId: ids.analyzedSubject,
        snapshotId: ids.analyzedSnapshot,
      });
    } finally {
      await database!.exec("rollback");
    }
  });

  it("requires an active nondeleted member for selection and idempotency replay", async () => {
    const db = database as PGlite;
    for (const actorId of [ids.inactiveActor, ids.deletedActor, ids.nonmemberActor]) {
      await expect(db.query("select select_ai_content_proposal($1,$2,$3,$4)", [
        ids.firstProposal, ids.workspace, ids.brand, actorId,
      ])).rejects.toThrow(/proposal_selection_actor_forbidden/);
      await expect(db.query(
        "select reserve_ai_content_create_idempotency($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          ids.workspace, ids.brand, actorId, "generation_start", `inactive-${actorId}`,
          "c".repeat(64), "generation", ids.generation, JSON.stringify({ status: "queued" }),
        ],
      )).rejects.toThrow(/idempotency_actor_forbidden/);
    }

    const replayParameters = [
      ids.workspace, ids.brand, ids.competingActor, "generation_start", "disabled-replay",
      "c".repeat(64), "generation", ids.generation, JSON.stringify({ status: "queued" }),
    ];
    await db.query(
      "select reserve_ai_content_create_idempotency($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      replayParameters,
    );
    await db.query(
      "update workspace_members set status='disabled' where workspace_id=$1 and user_id=$2",
      [ids.workspace, ids.competingActor],
    );
    await expect(db.query(
      "select reserve_ai_content_create_idempotency($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      replayParameters,
    )).rejects.toThrow(/idempotency_actor_forbidden/);
    await db.query(
      "update workspace_members set status='active' where workspace_id=$1 and user_id=$2",
      [ids.workspace, ids.competingActor],
    );
    await db.query(
      "update workspace_members set deleted_at=now() where workspace_id=$1 and user_id=$2",
      [ids.workspace, ids.competingActor],
    );
    await expect(db.query(
      "select reserve_ai_content_create_idempotency($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      replayParameters,
    )).rejects.toThrow(/idempotency_actor_forbidden/);
    await db.query(
      "update workspace_members set deleted_at=null where workspace_id=$1 and user_id=$2",
      [ids.workspace, ids.competingActor],
    );
  });

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

  it("replays proposal batches for structurally equal JSON regardless of object key order", async () => {
    const query = async (sql: string, params?: unknown[]) => {
      const result = await database!.query(sql, params);
      return {
        ...result,
        rowCount: result.rows.length > 0 ? result.rows.length : (result.affectedRows ?? 0),
      };
    };
    const repository = createAiContentRepository({
      query,
      connect: async () => ({ query, release() {} }),
    } as never);
    const firstRequest = {
      contractVersion: "content-proposal-request.v1" as const,
      contentFamily: "informational" as const,
      subjectInput: { topic: "여름 관리", filters: { region: "서울", age: 30 } },
      channelTargets: ["blog_export" as const],
      outputFormats: ["blog" as const],
      sourceSnapshotIds: [],
      performanceSnapshotIds: [],
    };
    const reorderedRequest = {
      performanceSnapshotIds: [],
      sourceSnapshotIds: [],
      outputFormats: ["blog" as const],
      channelTargets: ["blog_export" as const],
      subjectInput: { filters: { age: 30, region: "서울" }, topic: "여름 관리" },
      contentFamily: "informational" as const,
      contractVersion: "content-proposal-request.v1" as const,
    };
    const input = {
      workspaceId: ids.workspace,
      brandId: ids.brand,
      actorUserId: ids.actor,
      origin: "manual" as const,
      idempotencyKey: "proposal-jsonb-order",
    };

    const created = await repository.createAiContentProposalBatch({ ...input, request: firstRequest });
    await expect(repository.createAiContentProposalBatch({
      ...input,
      request: reorderedRequest,
    })).resolves.toMatchObject({ id: created.id });
    await expect(repository.createAiContentProposalBatch({
      ...input,
      request: {
        ...reorderedRequest,
        subjectInput: { topic: "다른 주제", filters: { age: 30, region: "서울" } },
      },
    })).rejects.toThrow("ai_content_proposal_batch_conflict");
  });

  it("replays the frozen batch before mutable source freshness checks or refresh scheduling", async () => {
    const snapshotA = "41000000-0000-4000-8000-000000000041";
    const snapshotB = "42000000-0000-4000-8000-000000000042";
    await database!.query(
      `insert into source_snapshots (
         id,workspace_id,brand_id,source_url_id,status,fetched_at,
         content_hash,extracted_text,summary
       ) values ($1,$2,$3,$4,'succeeded',now(),$5,'Snapshot A','Snapshot A')`,
      [snapshotA, ids.workspace, ids.brand, ids.sourceUrl, "a".repeat(64)],
    );
    const query = async (sql: string, params?: unknown[]) => {
      const result = await database!.query(sql, params);
      return {
        ...result,
        rowCount: result.rows.length > 0 ? result.rows.length : (result.affectedRows ?? 0),
      };
    };
    const repository = createAiContentRepository({
      query,
      connect: async () => ({ query, release() {} }),
    } as never);
    const input = {
      workspaceId: ids.workspace,
      brandId: ids.brand,
      actorUserId: ids.actor,
      origin: "manual" as const,
      idempotencyKey: "proposal-frozen-source-replay",
      request: {
        contractVersion: "content-proposal-request.v1" as const,
        contentFamily: "informational" as const,
        subjectInput: { topic: "Frozen source replay" },
        channelTargets: ["blog_export" as const],
        outputFormats: ["blog" as const],
        sourceSnapshotIds: [snapshotA],
        performanceSnapshotIds: [],
      },
    };
    const created = await repository.createAiContentProposalBatch(input);
    await database!.query(
      "update source_snapshots set fetched_at=now()-interval '9 days' where id=$1",
      [snapshotA],
    );
    await database!.query(
      `insert into source_snapshots (
         id,workspace_id,brand_id,source_url_id,status,fetched_at,
         content_hash,extracted_text,summary
       ) values ($1,$2,$3,$4,'succeeded',now()-interval '8 days',$5,'Snapshot B','Snapshot B')`,
      [snapshotB, ids.workspace, ids.brand, ids.sourceUrl, "b".repeat(64)],
    );
    await database!.query(
      "delete from source_crawl_runs where source_url_id=$1",
      [ids.sourceUrl],
    );

    await expect(repository.createAiContentProposalBatch(input))
      .resolves.toMatchObject({ id: created.id });
    const jobs = await database!.query<{ count: string }>(
      "select count(*)::text count from ai_content_proposal_jobs where batch_id=$1",
      [created.id],
    );
    expect(jobs.rows[0]?.count).toBe("1");
    const refreshes = await database!.query<{ count: string }>(
      "select count(*)::text count from source_crawl_runs where source_url_id=$1",
      [ids.sourceUrl],
    );
    expect(refreshes.rows[0]?.count).toBe("0");
    await expect(repository.createAiContentProposalBatch({
      ...input,
      actorUserId: ids.inactiveActor,
    })).rejects.toThrow("ai_content_actor_forbidden");
  });

  it.each(["queued", "completed", "failed"] as const)(
    "does not enqueue a replacement proposal job when an idempotent batch job is %s",
    async (terminalStatus) => {
      const query = async (sql: string, params?: unknown[]) => {
        const result = await database!.query(sql, params);
        return {
          ...result,
          rowCount: result.rows.length > 0 ? result.rows.length : (result.affectedRows ?? 0),
        };
      };
      const repository = createAiContentRepository({
        query,
        connect: async () => ({ query, release() {} }),
      } as never);
      const request = {
        contractVersion: "content-proposal-request.v1" as const,
        contentFamily: "informational" as const,
        subjectInput: { topic: `Replay ${terminalStatus}` },
        channelTargets: ["blog_export" as const],
        outputFormats: ["blog" as const],
        sourceSnapshotIds: [],
        performanceSnapshotIds: [],
      };
      const input = {
        workspaceId: ids.workspace,
        brandId: ids.brand,
        actorUserId: ids.actor,
        origin: "manual" as const,
        idempotencyKey: `proposal-job-replay-${terminalStatus}`,
        request,
      };
      const batch = await repository.createAiContentProposalBatch(input);
      if (terminalStatus === "completed") {
        await database!.query(
          `update ai_content_proposal_jobs
              set status='completed',completed_at=now()
            where batch_id=$1`,
          [batch.id],
        );
        await database!.query(
          "update ai_content_proposal_batches set status='ready' where id=$1",
          [batch.id],
        );
      } else if (terminalStatus === "failed") {
        await database!.query(
          `update ai_content_proposal_jobs
              set status='failed',error_code='proposal_failed',
                  error_message='failed',completed_at=now()
            where batch_id=$1`,
          [batch.id],
        );
        await database!.query(
          `update ai_content_proposal_batches
              set status='failed',error_code='proposal_failed',error_message='failed'
            where id=$1`,
          [batch.id],
        );
      }

      await expect(repository.createAiContentProposalBatch(input))
        .resolves.toMatchObject({ id: batch.id });
      const jobs = await database!.query<{ status: string }>(
        "select status from ai_content_proposal_jobs where batch_id=$1 order by created_at,id",
        [batch.id],
      );
      expect(jobs.rows.map(({ status }) => status)).toEqual([terminalStatus]);
    },
  );

  it.each(["queued", "completed", "failed"] as const)(
    "does not enqueue a replacement scheduled proposal job when the existing job is %s",
    async (terminalStatus) => {
      const channelOutputId = `scheduled-terminal-${terminalStatus}`;
      const input = {
        workspaceId: ids.workspace,
        brandId: ids.brand,
        contentTopicId: `topic-${terminalStatus}`,
        channelOutputId,
        brand: { name: "Brand", brandColor: null },
        topic: { title: `Scheduled ${terminalStatus}`, angle: "replay" },
        representativeUrl: null,
        sourceMaterials: [],
      };
      const first = await enqueueAutomatedCardNews(database! as never, input, {
        automatedContentEnabled: true,
      });
      if (terminalStatus === "completed") {
        await database!.query(
          `update ai_content_proposal_jobs
              set status='completed',completed_at=now()
            where batch_id=$1`,
          [first.batchId],
        );
        await database!.query(
          "update ai_content_proposal_batches set status='ready' where id=$1",
          [first.batchId],
        );
      } else if (terminalStatus === "failed") {
        await database!.query(
          `update ai_content_proposal_jobs
              set status='failed',error_code='proposal_failed',
                  error_message='failed',completed_at=now()
            where batch_id=$1`,
          [first.batchId],
        );
        await database!.query(
          `update ai_content_proposal_batches
              set status='failed',error_code='proposal_failed',error_message='failed'
            where id=$1`,
          [first.batchId],
        );
      }

      await expect(enqueueAutomatedCardNews(database! as never, input, {
        automatedContentEnabled: true,
      })).resolves.toMatchObject({ batchId: first.batchId });
      const jobs = await database!.query<{ status: string }>(
        "select status from ai_content_proposal_jobs where batch_id=$1 order by created_at,id",
        [first.batchId],
      );
      expect(jobs.rows.map(({ status }) => status)).toEqual([terminalStatus]);
    },
  );

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

    const forgedWiki = generationBrief({
      wikiSnapshots: [{
        ...versionedSnapshot("wiki", ids.wiki, 1, wikiSnapshotHash),
        title: "Caller-forged Wiki title",
      }],
    });
    await expect(db.query(
      "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)",
      [
        ids.generation, ids.workspace, ids.brand, JSON.stringify(forgedWiki),
        JSON.stringify(forgedWiki.avatar), ids.actor,
      ],
    )).rejects.toThrow(/wiki_snapshot_not_sealed/);

    await db.exec("begin");
    try {
      await db.query(
        "update ai_content_generations set content_family='informational' where id=$1",
        [ids.generation],
      );
      await expect(db.query(
        "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)",
        [
          ids.generation, ids.workspace, ids.brand, JSON.stringify(generationBrief()),
          JSON.stringify(generationBrief().avatar), ids.actor,
        ],
      )).rejects.toThrow(/proposal_generation_family_mismatch/);
    } finally {
      await db.exec("rollback");
    }

    for (const column of ["content_family", "output_format", "subject_mode"]) {
      await db.exec("begin");
      try {
        await db.query(`update ai_content_generations set ${column}=null where id=$1`, [
          ids.generation,
        ]);
        await expect(db.query(
          "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)",
          [
            ids.generation, ids.workspace, ids.brand, JSON.stringify(generationBrief()),
            JSON.stringify(generationBrief().avatar), ids.actor,
          ],
        )).rejects.toThrow(/generation_canonical_mapping_missing/);
      } finally {
        await db.exec("rollback");
      }
    }

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

  it("resolves every canonical asset only from same-tenant incomplete unstarted drafts", async () => {
    const db = database as PGlite;
    const productDraft = "2b000000-0000-4000-8000-00000000002b";
    const wikiDraft = "2c000000-0000-4000-8000-00000000002c";
    const startedDraft = "2d000000-0000-4000-8000-00000000002d";
    const completedDraft = "2e000000-0000-4000-8000-00000000002e";
    const otherTenantDraft = "2f000000-0000-4000-8000-00000000002f";
    const productOrchestration = {
      subject: { mode: "product_service", productServiceId: ids.product },
      avatar: { mode: "library", id: ids.avatar, snapshot: {} },
    };
    const wikiOrchestration = {
      subject: { mode: "brand_topic", topic: "Topic", wikiItemIds: [ids.wiki] },
      avatar: null,
    };
    await db.query(
      `insert into ai_content_generations (
         id,workspace_id,brand_id,type,title,status,analysis_idempotency_key,draft_json,
         content_family,output_format,subject_mode,product_service_id,attachments_locked_at
       ) values
       ($1,$6,$7,'blog','Product draft','draft','draft-assets-product',$10::jsonb,
        'informational','blog','product_service',$8,null),
       ($2,$6,$7,'blog','Wiki draft','analysis_ready','draft-assets-wiki',$11::jsonb,
        'informational','blog','brand_topic',null,null),
       ($3,$6,$7,'blog','Started draft','draft','draft-assets-started',$10::jsonb,
        'informational','blog','product_service',$8,now()),
       ($4,$6,$7,'blog','Completed draft','completed','draft-assets-completed',$10::jsonb,
        'informational','blog','product_service',$8,null),
       ($5,$6,$9,'blog','Other tenant draft','draft','draft-assets-other',$12::jsonb,
        'informational','blog','brand_topic',null,null)`,
      [
        productDraft, wikiDraft, startedDraft, completedDraft, otherTenantDraft,
        ids.workspace, ids.brand, ids.product, ids.otherBrand,
        JSON.stringify({ orchestration: productOrchestration }),
        JSON.stringify({ orchestration: wikiOrchestration }),
        JSON.stringify({
          orchestration: {
            subject: { mode: "brand_topic", topic: "Other", wikiItemIds: [ids.otherWiki] },
            avatar: { mode: "library", id: ids.otherAvatar, snapshot: {} },
          },
        }),
      ],
    );
    await db.query(
      `insert into ai_content_generation_references (
         generation_id,reference_id,workspace_id,brand_id,position,reference_item_id,
         reference_snapshot_id,pattern_version_id,roles_json,reference_snapshot_json
       ) values ($1,gen_random_uuid(),$2,$3,1,$4,$5,$6,'["planning"]',$7::jsonb)`,
      [
        productDraft, ids.workspace, ids.brand, ids.referenceItem, ids.referenceSnapshot,
        ids.patternVersion, JSON.stringify(canonicalReferenceSnapshot),
      ],
    );
    const repository = createAiContentRepository({
      query: db.query.bind(db),
    } as never);

    const referenceDrafts = await repository.listAiContentDraftReferences({
      workspaceId: ids.workspace, brandId: ids.brand,
      assetType: "reference", assetId: ids.referenceItem,
    });
    expect(referenceDrafts).toEqual(expect.arrayContaining([
      expect.objectContaining({ generationId: productDraft }),
    ]));
    expect(referenceDrafts.map((reference) => reference.generationId))
      .not.toEqual(expect.arrayContaining([startedDraft, completedDraft]));
    await expect(repository.listAiContentDraftReferences({
      workspaceId: ids.workspace, brandId: ids.brand,
      assetType: "avatar", assetId: ids.avatar,
    })).resolves.toEqual([expect.objectContaining({ generationId: productDraft })]);
    await expect(repository.listAiContentDraftReferences({
      workspaceId: ids.workspace, brandId: ids.brand,
      assetType: "product_service", assetId: ids.product,
    })).resolves.toEqual([expect.objectContaining({ generationId: productDraft })]);
    await expect(repository.listAiContentDraftReferences({
      workspaceId: ids.workspace, brandId: ids.brand,
      assetType: "wiki", assetId: ids.wiki,
    })).resolves.toEqual([expect.objectContaining({ generationId: wikiDraft })]);
    await expect(repository.listAiContentDraftReferences({
      workspaceId: ids.workspace, brandId: ids.brand,
      assetType: "avatar", assetId: ids.otherAvatar,
    })).resolves.toEqual([]);
  });

  it("resolves only active same-tenant avatar library references from draft JSON", async () => {
    const db = database as PGlite;
    const validDraft = "31000000-0000-4000-8000-000000000031";
    const missingDraft = "32000000-0000-4000-8000-000000000032";
    const crossBrandDraft = "33000000-0000-4000-8000-000000000033";
    const missingAvatar = "34000000-0000-4000-8000-000000000034";
    const repository = createAiContentRepository({ query: db.query.bind(db) } as never);

    await db.exec("begin");
    try {
      await db.query(
        `insert into ai_content_generations (
           id,workspace_id,brand_id,type,title,status,analysis_idempotency_key,draft_json,
           content_family,output_format,subject_mode
         ) values
         ($1,$4,$5,'blog','Valid avatar draft','draft','avatar-valid',$6::jsonb,
          'informational','blog','brand_topic'),
         ($2,$4,$5,'blog','Missing avatar draft','draft','avatar-missing',$7::jsonb,
          'informational','blog','brand_topic'),
         ($3,$4,$5,'blog','Cross-brand avatar draft','draft','avatar-cross-brand',$8::jsonb,
          'informational','blog','brand_topic')`,
        [
          validDraft,
          missingDraft,
          crossBrandDraft,
          ids.workspace,
          ids.brand,
          JSON.stringify({ orchestration: { avatar: { mode: "library", id: ids.avatar } } }),
          JSON.stringify({ orchestration: { avatar: { mode: "library", id: missingAvatar } } }),
          JSON.stringify({ orchestration: { avatar: { mode: "library", id: ids.otherAvatar } } }),
        ],
      );

      const valid = await repository.listAiContentDraftReferences({
        workspaceId: ids.workspace,
        brandId: ids.brand,
        assetType: "avatar",
        assetId: ids.avatar,
      });
      expect(valid).toEqual(expect.arrayContaining([
        expect.objectContaining({ generationId: validDraft }),
      ]));
      await expect(repository.listAiContentDraftReferences({
        workspaceId: ids.workspace,
        brandId: ids.brand,
        assetType: "avatar",
        assetId: missingAvatar,
      })).resolves.toEqual([]);
      await expect(repository.listAiContentDraftReferences({
        workspaceId: ids.workspace,
        brandId: ids.brand,
        assetType: "avatar",
        assetId: ids.otherAvatar,
      })).resolves.toEqual([]);

      await db.query("update brand_avatars set status='archived' where id=$1", [ids.avatar]);
      await expect(repository.listAiContentDraftReferences({
        workspaceId: ids.workspace,
        brandId: ids.brand,
        assetType: "avatar",
        assetId: ids.avatar,
      })).resolves.toEqual([]);
    } finally {
      await db.exec("rollback");
    }
  });

  it("resolves only active same-tenant Wiki versions from draft JSON", async () => {
    const db = database as PGlite;
    const validDraft = "35000000-0000-4000-8000-000000000035";
    const missingDraft = "36000000-0000-4000-8000-000000000036";
    const crossBrandDraft = "37000000-0000-4000-8000-000000000037";
    const inactiveDraft = "38000000-0000-4000-8000-000000000038";
    const missingWiki = "39000000-0000-4000-8000-000000000039";
    const repository = createAiContentRepository({ query: db.query.bind(db) } as never);

    await db.exec("begin");
    try {
      await db.query(
        `insert into ai_content_generations (
           id,workspace_id,brand_id,type,title,status,analysis_idempotency_key,draft_json,
           content_family,output_format,subject_mode
         ) values
         ($1,$5,$6,'blog','Valid Wiki draft','draft','wiki-valid',$7::jsonb,
          'informational','blog','brand_topic'),
         ($2,$5,$6,'blog','Missing Wiki draft','draft','wiki-missing',$8::jsonb,
          'informational','blog','brand_topic'),
         ($3,$5,$6,'blog','Cross-brand Wiki draft','draft','wiki-cross-brand',$9::jsonb,
          'informational','blog','brand_topic'),
         ($4,$5,$6,'blog','Inactive Wiki draft','draft','wiki-inactive',$10::jsonb,
          'informational','blog','brand_topic')`,
        [
          validDraft,
          missingDraft,
          crossBrandDraft,
          inactiveDraft,
          ids.workspace,
          ids.brand,
          JSON.stringify({ orchestration: { subject: { mode: "brand_topic", wikiItemIds: [ids.wiki] } } }),
          JSON.stringify({ orchestration: { subject: { mode: "brand_topic", wikiItemIds: [missingWiki] } } }),
          JSON.stringify({ orchestration: { subject: { mode: "brand_topic", wikiItemIds: [ids.otherWiki] } } }),
          JSON.stringify({ orchestration: { subject: { mode: "brand_topic", wikiItemIds: [ids.readyWiki] } } }),
        ],
      );

      const valid = await repository.listAiContentDraftReferences({
        workspaceId: ids.workspace,
        brandId: ids.brand,
        assetType: "wiki",
        assetId: ids.wiki,
      });
      expect(valid).toEqual(expect.arrayContaining([
        expect.objectContaining({ generationId: validDraft }),
      ]));
      for (const assetId of [missingWiki, ids.otherWiki, ids.readyWiki]) {
        await expect(repository.listAiContentDraftReferences({
          workspaceId: ids.workspace,
          brandId: ids.brand,
          assetType: "wiki",
          assetId,
        })).resolves.toEqual([]);
      }
    } finally {
      await db.exec("rollback");
    }
  });

  it("resolves product and saved-reference drafts only through active tenant-owned library rows", async () => {
    const db = database as PGlite;
    const missingDraft = "3a000000-0000-4000-8000-00000000003a";
    const crossBrandDraft = "3b000000-0000-4000-8000-00000000003b";
    const missingProduct = "3c000000-0000-4000-8000-00000000003c";
    const crossBrandProduct = "3d000000-0000-4000-8000-00000000003d";
    const crossBrandVersion = "3e000000-0000-4000-8000-00000000003e";
    const repository = createAiContentRepository({ query: db.query.bind(db) } as never);

    await db.exec("begin");
    try {
      await db.query(
        `insert into product_services (
           id,workspace_id,brand_id,kind,display_name
         ) values ($1,$2,$3,'service','Other brand service')`,
        [crossBrandProduct, ids.workspace, ids.otherBrand],
      );
      await db.query(
        `insert into product_service_versions (
           id,workspace_id,brand_id,product_service_id,version,status,profile_json,approved_at
         ) values ($1,$2,$3,$4,1,'approved','{}',now())`,
        [crossBrandVersion, ids.workspace, ids.otherBrand, crossBrandProduct],
      );
      await db.query(
        "update product_services set active_version_id=$2 where id=$1",
        [crossBrandProduct, crossBrandVersion],
      );
      await db.query(
        `insert into ai_content_generations (
           id,workspace_id,brand_id,type,title,status,analysis_idempotency_key,draft_json,
           content_family,output_format,subject_mode,product_service_id
         ) values
         ($1,$3,$4,'blog','Missing product draft','draft','product-missing',$5::jsonb,
          'informational','blog','product_service',null),
         ($2,$3,$4,'blog','Cross-brand product draft','draft','product-cross-brand',$6::jsonb,
          'informational','blog','product_service',null)`,
        [
          missingDraft,
          crossBrandDraft,
          ids.workspace,
          ids.brand,
          JSON.stringify({
            orchestration: {
              subject: { mode: "product_service", productServiceId: missingProduct },
            },
          }),
          JSON.stringify({
            orchestration: {
              subject: { mode: "product_service", productServiceId: crossBrandProduct },
            },
          }),
        ],
      );

      for (const assetId of [missingProduct, crossBrandProduct]) {
        await expect(repository.listAiContentDraftReferences({
          workspaceId: ids.workspace,
          brandId: ids.brand,
          assetType: "product_service",
          assetId,
        })).resolves.toEqual([]);
      }

      await db.query("update product_services set status='archived' where id=$1", [ids.product]);
      await expect(repository.listAiContentDraftReferences({
        workspaceId: ids.workspace,
        brandId: ids.brand,
        assetType: "product_service",
        assetId: ids.product,
      })).resolves.toEqual([]);

      await db.query("update reference_items set archived_at=now() where id=$1", [ids.referenceItem]);
      await expect(repository.listAiContentDraftReferences({
        workspaceId: ids.workspace,
        brandId: ids.brand,
        assetType: "reference",
        assetId: ids.referenceItem,
      })).resolves.toEqual([]);
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
    await db.query(
      "update workspace_members set status='disabled' where workspace_id=$1 and user_id=$2",
      [ids.workspace, ids.actor],
    );
    await expect(db.query(
      "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)",
      [
        ids.generation, ids.workspace, ids.brand, JSON.stringify(brief),
        JSON.stringify(brief.avatar), ids.actor,
      ],
    )).rejects.toThrow(/generation_start_actor_forbidden/);
    await db.query(
      "update workspace_members set status='active' where workspace_id=$1 and user_id=$2",
      [ids.workspace, ids.actor],
    );
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
    await db.query(
      `insert into ai_content_generations (
         id,workspace_id,brand_id,type,title,analysis_idempotency_key,
         content_family,output_format,subject_mode,generation_input_snapshot
       ) values
         ($1,$3,$4,'marketing','Receipt generation','receipt-generation',
          'marketing','single_image','brand_topic','{"contractVersion":"content-generation-input.v2"}'),
         ($2,$3,$5,'marketing','Other-brand receipt','other-brand-receipt',
          'marketing','single_image','brand_topic','{"contractVersion":"content-generation-input.v2"}')`,
      [
        ids.receiptGeneration,
        ids.otherBrandGeneration,
        ids.workspace,
        ids.brand,
        ids.otherBrand,
      ],
    );
    await insertOneTimeReceipt(db, {
      sessionId: ids.pendingAvatar,
      attachmentId: ids.pendingAvatarAsset,
      generationId: ids.oneTimeGeneration,
      brandId: ids.brand,
      actorId: ids.actor,
      status: "pending",
    });
    await insertOneTimeReceipt(db, {
      sessionId: ids.crossGenerationAvatar,
      attachmentId: ids.crossGenerationAvatarAsset,
      generationId: ids.receiptGeneration,
      brandId: ids.brand,
      actorId: ids.actor,
    });
    await insertOneTimeReceipt(db, {
      sessionId: ids.crossActorAvatar,
      attachmentId: ids.crossActorAvatarAsset,
      generationId: ids.oneTimeGeneration,
      brandId: ids.brand,
      actorId: ids.competingActor,
    });
    await insertOneTimeReceipt(db, {
      sessionId: ids.crossBrandAvatar,
      attachmentId: ids.crossBrandAvatarAsset,
      generationId: ids.otherBrandGeneration,
      brandId: ids.otherBrand,
      actorId: ids.actor,
    });
    await insertOneTimeReceipt(db, {
      sessionId: ids.revokedAvatar,
      attachmentId: ids.revokedAvatarAsset,
      generationId: ids.oneTimeGeneration,
      brandId: ids.brand,
      actorId: ids.actor,
    });
    await db.query(
      `update ai_content_generation_attachments
          set deleted_at=now(),deletion_reason='user_removed',physical_delete_status='pending'
        where id=$1`,
      [ids.revokedAvatarAsset],
    );
    await insertOneTimeReceipt(db, {
      sessionId: ids.physicallyDeletedAvatar,
      attachmentId: ids.physicallyDeletedAvatarAsset,
      generationId: ids.oneTimeGeneration,
      brandId: ids.brand,
      actorId: ids.actor,
    });
    await db.query(
      `update ai_content_generation_attachments
          set deleted_at=now(),deletion_reason='gc_completed',
              physical_delete_status='deleted',physically_deleted_at=now()
        where id=$1`,
      [ids.physicallyDeletedAvatarAsset],
    );
    const oneTimeBrief = (candidate: Record<string, unknown>) => ({
      contractVersion: "generation-brief.v1",
      proposalId: ids.oneTimeProposal,
      approvedProposalVersionId: ids.oneTimeApproved,
      approvedProposalSnapshot: approval,
      brandCoreVersionId: ids.core,
      ruleSetVersionId: ids.rules,
      subject: { kind: "brand_topic", topic: "One-time avatar", brandCoreEvidenceIds: [] },
      wikiSnapshots: [],
      references: [],
      avatar: candidate,
      outputFormat: "single_image",
      channels: ["instagram"],
      promptDefinitionVersions: { generation: "generation.v1" },
    });
    for (const candidate of [
      {
        id: "b5000000-0000-4000-8000-00000000000f",
        assetVersionId: "c5000000-0000-4000-8000-00000000000f",
        objectHash: "d".repeat(64),
        mime: "image/png",
        provenance: "one_time",
      },
      {
        id: ids.pendingAvatar,
        assetVersionId: ids.pendingAvatarAsset,
        objectHash: "d".repeat(64),
        mime: "image/png",
        provenance: "one_time",
      },
      {
        id: ids.crossGenerationAvatar,
        assetVersionId: ids.crossGenerationAvatarAsset,
        objectHash: "d".repeat(64),
        mime: "image/png",
        provenance: "one_time",
      },
      {
        id: ids.crossActorAvatar,
        assetVersionId: ids.crossActorAvatarAsset,
        objectHash: "d".repeat(64),
        mime: "image/png",
        provenance: "one_time",
      },
      {
        id: ids.crossBrandAvatar,
        assetVersionId: ids.crossBrandAvatarAsset,
        objectHash: "d".repeat(64),
        mime: "image/png",
        provenance: "one_time",
      },
      {
        id: ids.revokedAvatar,
        assetVersionId: ids.revokedAvatarAsset,
        objectHash: "d".repeat(64),
        mime: "image/png",
        provenance: "one_time",
      },
      {
        id: ids.physicallyDeletedAvatar,
        assetVersionId: ids.physicallyDeletedAvatarAsset,
        objectHash: "d".repeat(64),
        mime: "image/png",
        provenance: "one_time",
      },
    ]) {
      const rejectedBrief = oneTimeBrief(candidate);
      const expectedError = (
        candidate.id === ids.revokedAvatar
        || candidate.id === ids.physicallyDeletedAvatar
      )
        ? /one_time_avatar_receipt_revoked/
        : /one_time_avatar_receipt_invalid/;
      await expect(db.query(
        "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)",
        [
          ids.oneTimeGeneration,
          ids.workspace,
          ids.brand,
          JSON.stringify(rejectedBrief),
          JSON.stringify(candidate),
          ids.actor,
        ],
      )).rejects.toThrow(expectedError);
    }

    await insertOneTimeReceipt(db, {
      sessionId: ids.oneTimeAvatar,
      attachmentId: ids.oneTimeAvatarAsset,
      generationId: ids.oneTimeGeneration,
      brandId: ids.brand,
      actorId: ids.actor,
    });
    const avatar = {
      id: ids.oneTimeAvatar,
      assetVersionId: ids.oneTimeAvatarAsset,
      objectHash: "d".repeat(64),
      mime: "image/png",
      provenance: "one_time",
    };
    const brief = oneTimeBrief(avatar);
    await expect(db.query(
      "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)",
      [
        ids.oneTimeGeneration, ids.workspace, ids.brand, JSON.stringify(brief),
        JSON.stringify(avatar), ids.actor,
      ],
    )).resolves.toBeDefined();
    await db.query(
      `update ai_content_generation_attachments
          set deleted_at=now(),deletion_reason='user_removed',physical_delete_status='pending'
        where id=$1`,
      [ids.oneTimeAvatarAsset],
    );
    const revocation = await db.query<{ reason: string }>(
      "select reason from ai_content_one_time_avatar_revocations where receipt_id=$1",
      [ids.oneTimeAvatarAsset],
    );
    expect(revocation.rows).toEqual([{ reason: "attachment_logically_deleted" }]);
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

  it("keeps approved proposals, wiki snapshots, references, patterns, and briefs immutable", async () => {
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
      "update ai_content_wiki_version_snapshots set snapshot_json='{}' where id=$1",
      [ids.wiki],
    )).rejects.toThrow(/wiki_version_snapshot_immutable/);
    await expect(db.query(
      "update ai_content_one_time_avatar_receipts set object_hash=$2 where id=$1",
      [ids.oneTimeAvatarAsset, "9".repeat(64)],
    )).rejects.toThrow(/one_time_avatar_receipt_immutable/);
    await expect(db.query(
      "update ai_content_generation_briefs set approved_proposal_version_id=$2 where generation_id=$1",
      [ids.generation, ids.noAvatarApproved],
    )).rejects.toThrow(/generation_brief_immutable/);
    expect(dismissedProposalId).toBeTruthy();
  });

  it("restricts parent and workspace deletion while immutable lineage exists", async () => {
    const db = database as PGlite;
    await expect(db.query(
      "delete from reference_items where id=$1",
      [ids.referenceItem],
    )).rejects.toThrow();
    await expect(db.query(
      "delete from wiki_versions where id=$1",
      [ids.wiki],
    )).rejects.toThrow();
    await expect(db.query(
      "delete from workspaces where id=$1",
      [ids.workspace],
    )).rejects.toThrow();

    const remaining = await db.query<{ snapshots: number; wiki_snapshots: number; briefs: number }>(
      `select
         (select count(*)::integer from reference_snapshots) snapshots,
         (select count(*)::integer from ai_content_wiki_version_snapshots) wiki_snapshots,
         (select count(*)::integer from ai_content_generation_briefs) briefs`,
    );
    expect(remaining.rows[0]).toMatchObject({
      snapshots: 1,
      wiki_snapshots: 3,
      briefs: 3,
    });
  });
});
