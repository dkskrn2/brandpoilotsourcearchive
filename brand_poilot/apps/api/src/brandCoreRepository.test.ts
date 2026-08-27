import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAssetLibraryRepository } from "./assetLibraryRepository.js";
import { createBrandCoreRepository } from "./brandCoreRepository.js";

type QueryResult = { rowCount: number; rows: Record<string, unknown>[] };

function pglitePool(database: PGlite): Pool {
  async function execute(sql: string, values: unknown[] = []): Promise<QueryResult> {
    const result = await database.query(sql, values as never[]);
    return {
      rowCount: result.rows.length || Number(result.affectedRows ?? 0),
      rows: result.rows as Record<string, unknown>[],
    };
  }
  return {
    query: execute,
    async connect() {
      return { query: execute, release() {} };
    },
  } as unknown as Pool;
}

function validCore(label: string) {
  return {
    contractVersion: "brand-core.v1" as const,
    summary: { oneLine: `${label} 한 줄`, description: `${label} 설명` },
    audiences: [{ name: "담당자", problem: "시간 부족", desiredOutcome: "일관된 운영" }],
    valueProposition: {
      primary: "반복 업무 절감",
      differentiators: ["승인 정보 사용"],
      proofPoints: ["검토 흐름 제공"],
    },
    messaging: {
      appeals: ["업무 절감"],
      tone: ["명확함"],
      preferredPhrases: ["근거를 바탕으로"],
      brandDirection: "과장 없는 운영",
      priorityMessages: ["승인된 정보 사용"],
    },
  };
}

const workspaceId = "10000000-0000-4000-8000-000000000001";
const foreignWorkspaceId = "10000000-0000-4000-8000-000000000002";
const brandId = "20000000-0000-4000-8000-000000000002";
const otherBrandId = "20000000-0000-4000-8000-000000000003";
const concurrencyBrandId = "20000000-0000-4000-8000-000000000004";
const provenanceBrandId = "20000000-0000-4000-8000-000000000005";
const precisionBrandId = "20000000-0000-4000-8000-000000000006";
const foreignWorkspaceBrandId = "20000000-0000-4000-8000-000000000007";
const missingRulesBrandId = "20000000-0000-4000-8000-000000000008";
const invalidRulesBrandId = "20000000-0000-4000-8000-000000000009";
const validRulesBrandId = "20000000-0000-4000-8000-000000000010";
const missingReferenceImagesBrandId = "20000000-0000-4000-8000-000000000011";
const v6ReferenceRulesBrandId = "20000000-0000-4000-8000-000000000012";
const ownerId = "30000000-0000-4000-8000-000000000003";
const memberId = "30000000-0000-4000-8000-000000000004";

let database: PGlite;

beforeAll(async () => {
  database = await PGlite.create({ extensions: { pgcrypto } });
  const migrationDirectory = resolve(process.cwd(), "../../db/migrations");
  const files = (await readdir(migrationDirectory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(resolve(migrationDirectory, file), "utf8");
    if (
      sql.startsWith("-- requires: pgvector")
      || file === "027_wiki_search_v2.sql"
      || file.startsWith("075_")
      || file >= "077_"
    ) continue;
    await database.exec(sql);
  }
  await database.exec(`
    insert into app_users (id, email) values
      ('${ownerId}', 'owner@example.com'),
      ('${memberId}', 'member@example.com');
    insert into workspaces (id, name, slug, created_by_user_id) values
      ('${workspaceId}', 'Brand Core Repository', 'brand-core-repository', '${ownerId}'),
      ('${foreignWorkspaceId}', 'Foreign Workspace', 'brand-core-foreign', '${ownerId}');
    insert into workspace_members (workspace_id, user_id, role, status) values
      ('${workspaceId}', '${ownerId}', 'owner', 'active'),
      ('${workspaceId}', '${memberId}', 'member', 'active'),
      ('${foreignWorkspaceId}', '${ownerId}', 'owner', 'active');
    insert into brands (id, workspace_id, name) values
      ('${brandId}', '${workspaceId}', 'First'),
      ('${otherBrandId}', '${workspaceId}', 'Other'),
      ('${concurrencyBrandId}', '${workspaceId}', 'Concurrent'),
      ('${provenanceBrandId}', '${workspaceId}', 'Provenance'),
      ('${precisionBrandId}', '${workspaceId}', 'Precision'),
      ('${missingRulesBrandId}', '${workspaceId}', 'Missing Rules'),
      ('${invalidRulesBrandId}', '${workspaceId}', 'Invalid Rules'),
      ('${validRulesBrandId}', '${workspaceId}', 'Valid Rules'),
      ('${missingReferenceImagesBrandId}', '${workspaceId}', 'Missing Reference Images'),
      ('${v6ReferenceRulesBrandId}', '${workspaceId}', 'V6 Reference Rules'),
      ('${foreignWorkspaceBrandId}', '${foreignWorkspaceId}', 'Foreign');
    insert into brand_profiles (workspace_id, brand_id) values
      ('${workspaceId}', '${brandId}'),
      ('${workspaceId}', '${otherBrandId}'),
      ('${workspaceId}', '${concurrencyBrandId}'),
      ('${workspaceId}', '${provenanceBrandId}'),
      ('${workspaceId}', '${precisionBrandId}'),
      ('${workspaceId}', '${missingRulesBrandId}'),
      ('${workspaceId}', '${invalidRulesBrandId}'),
      ('${workspaceId}', '${validRulesBrandId}'),
      ('${workspaceId}', '${missingReferenceImagesBrandId}'),
      ('${workspaceId}', '${v6ReferenceRulesBrandId}');
  `);
}, 60_000);

afterAll(async () => {
  await database.close();
});

describe("brand core repository", () => {
  async function approveCore(brand: string, label: string) {
    const repository = createBrandCoreRepository(pglitePool(database));
    const draft = await repository.createDraft(
      { workspaceId, brandId: brand, actorUserId: ownerId },
      { core: validCore(label), evidence: [], sourceAnalysisId: null },
    );
    await repository.approve(
      { workspaceId, brandId: brand, actorUserId: ownerId, versionId: draft.id },
      { expectedUpdatedAt: draft.updatedAt },
    );
    return repository;
  }

  it("creates canonical approved rules in the same operation when core approval has no rules", async () => {
    await database.query(
      `update brand_profiles
          set forbidden_terms = '["무조건"]'::jsonb,
              default_cta = null,
              auto_approval_enabled = true
        where workspace_id = $1 and brand_id = $2`,
      [workspaceId, missingRulesBrandId],
    );

    const repository = await approveCore(missingRulesBrandId, "규칙 누락");
    const activeRules = await repository.getActiveRules({ workspaceId, brandId: missingRulesBrandId });

    expect(activeRules).toMatchObject({
      version: 1,
      status: "approved",
      rules: {
        contractVersion: "brand-rules.v2",
        forbiddenPhrases: ["무조건"],
        ctaRules: { defaultCta: "", allowed: [] },
        autoApprovalRules: { enabled: true, conditions: [] },
      },
    });
  }, 30_000);

  it("preserves an active canonical user rule set when a core is approved", async () => {
    const repository = createBrandCoreRepository(pglitePool(database));
    const ruleDraft = await repository.saveRuleDraft(
      { workspaceId, brandId: validRulesBrandId, actorUserId: ownerId },
      {
        contractVersion: "brand-rules.v2",
        requiredPhrases: ["근거 중심"],
        forbiddenPhrases: [],
        exaggerationRules: [],
        ctaRules: { defaultCta: "상담하기", allowed: ["문의하기"] },
        channelRules: { instagram: ["짧고 명확하게"] },
        autoApprovalRules: { enabled: false, conditions: [] },
      },
    );
    const approvedRules = await repository.approveRules({
      workspaceId,
      brandId: validRulesBrandId,
      actorUserId: ownerId,
      ruleSetId: ruleDraft.id,
    });

    await approveCore(validRulesBrandId, "유효 규칙 보존");

    expect((await repository.getActiveRules({ workspaceId, brandId: validRulesBrandId }))?.id)
      .toBe(approvedRules.id);
    expect(await repository.listRuleSets({ workspaceId, brandId: validRulesBrandId }))
      .toHaveLength(1);
  }, 30_000);

  it("supersedes an invalid active legacy rule set and approves a canonical next version", async () => {
    const inserted = await database.query<{ id: string }>(
      `insert into brand_rule_sets (
         workspace_id, brand_id, version, status, rules_json, created_by, approved_at
       ) values (
         $1, $2, 3, 'approved',
         '{
           "contractVersion":"brand-rules.v1",
           "requiredPhrases":["기존 필수 문구"],
           "forbiddenPhrases":[],
           "exaggerationRules":[],
           "ctaRules":{"defaultCta":null,"allowed":[]},
           "channelRules":{},
           "designRules":{"colors":[],"fonts":[],"notes":[]},
           "autoApprovalRules":{"enabled":false,"conditions":[]}
         }'::jsonb,
         'migration', now()
       ) returning id`,
      [workspaceId, invalidRulesBrandId],
    );
    await database.query(
      `update brand_profiles
          set active_brand_rule_set_id = $3, default_cta = '문의하기'
        where workspace_id = $1 and brand_id = $2`,
      [workspaceId, invalidRulesBrandId, inserted.rows[0]!.id],
    );

    const repository = await approveCore(invalidRulesBrandId, "레거시 규칙 교체");
    const activeRules = await repository.getActiveRules({ workspaceId, brandId: invalidRulesBrandId });
    const versions = await repository.listRuleSets({ workspaceId, brandId: invalidRulesBrandId });

    expect(activeRules).toMatchObject({
      version: 4,
      status: "approved",
      rules: {
        requiredPhrases: ["기존 필수 문구"],
        ctaRules: { defaultCta: "문의하기", allowed: [] },
      },
    });
    expect(versions.map((version) => ({ version: version.version, status: version.status })))
      .toEqual([
        { version: 4, status: "approved" },
        { version: 3, status: "superseded" },
      ]);
  }, 30_000);

  it("persists a canonical successor when only referenceImages is missing", async () => {
    const inserted = await database.query<{ id: string }>(
      `insert into brand_rule_sets (
         workspace_id, brand_id, version, status, rules_json, created_by, approved_at
       ) values ($1, $2, 1, 'approved', '{
         "contractVersion":"brand-rules.v1",
         "requiredPhrases":[],"forbiddenPhrases":[],"exaggerationRules":[],
         "ctaRules":{"defaultCta":"문의하기","allowed":[]},
         "channelRules":{},
         "designRules":{"colors":[],"fonts":[],"notes":[]},
         "autoApprovalRules":{"enabled":false,"conditions":[]}
       }'::jsonb, 'migration', now()) returning id`,
      [workspaceId, missingReferenceImagesBrandId],
    );
    await database.query(
      `update brand_profiles set active_brand_rule_set_id=$3
        where workspace_id=$1 and brand_id=$2`,
      [workspaceId, missingReferenceImagesBrandId, inserted.rows[0]!.id],
    );

    const repository = await approveCore(missingReferenceImagesBrandId, "참조 배열 복구");
    const active = await repository.getActiveRules({ workspaceId, brandId: missingReferenceImagesBrandId });
    const versions = await repository.listRuleSets({ workspaceId, brandId: missingReferenceImagesBrandId });
    expect(active).toMatchObject({ version: 2, rules: { contractVersion: "brand-rules.v2" } });
    expect(versions.map(({ version, status }) => ({ version, status }))).toEqual([
      { version: 2, status: "approved" },
      { version: 1, status: "superseded" },
    ]);
  }, 30_000);

  it("does not preserve a version-6 style reference rejected by the writer contract", async () => {
    const inserted = await database.query<{ id: string }>(
      `insert into brand_rule_sets (
         workspace_id, brand_id, version, status, rules_json, created_by, approved_at
       ) values ($1, $2, 1, 'approved', '{
         "contractVersion":"brand-rules.v1",
         "requiredPhrases":[],"forbiddenPhrases":[],"exaggerationRules":[],
         "ctaRules":{"defaultCta":"","allowed":[]},"channelRules":{},
         "designRules":{"colors":[],"fonts":[],"notes":[],"referenceImages":[{
           "referenceItemId":"71000000-0000-6000-8000-000000000001",
           "description":"","tags":[]
         }]},
         "autoApprovalRules":{"enabled":false,"conditions":[]}
       }'::jsonb, 'migration', now()) returning id`,
      [workspaceId, v6ReferenceRulesBrandId],
    );
    await database.query(
      `update brand_profiles set active_brand_rule_set_id=$3
        where workspace_id=$1 and brand_id=$2`,
      [workspaceId, v6ReferenceRulesBrandId, inserted.rows[0]!.id],
    );

    const repository = await approveCore(v6ReferenceRulesBrandId, "UUID 계약 복구");
    const active = await repository.getActiveRules({ workspaceId, brandId: v6ReferenceRulesBrandId });
    expect(active).toMatchObject({ version: 2, rules: { contractVersion: "brand-rules.v2" } });
  }, 30_000);

  it("lets a member edit a draft but only an owner approve it", async () => {
    const repository = createBrandCoreRepository(pglitePool(database));
    const draft = await repository.createDraft(
      { workspaceId, brandId, actorUserId: memberId },
      { core: validCore("초안"), evidence: [], sourceAnalysisId: null },
    );
    const updated = await repository.updateDraft(
      { workspaceId, brandId, actorUserId: memberId, versionId: draft.id },
      {
        core: validCore("수정"),
        evidence: [],
        reviewState: draft.reviewState,
        expectedUpdatedAt: draft.updatedAt,
      },
    );
    expect(updated.core.summary.oneLine).toContain("수정");

    await expect(repository.approve(
      {
        workspaceId,
        brandId,
        actorUserId: memberId,
        versionId: draft.id,
      },
      { expectedUpdatedAt: updated.updatedAt },
    )).rejects.toThrow("brand_core_approval_forbidden");

    const approved = await repository.approve(
      {
        workspaceId,
        brandId,
        actorUserId: ownerId,
        versionId: draft.id,
      },
      { expectedUpdatedAt: updated.updatedAt },
    );
    expect(approved.status).toBe("approved");
    expect((await repository.getActive({ workspaceId, brandId }))?.id).toBe(draft.id);
    expect(Object.values(approved.reviewState).every((review) => review?.decision === "approved")).toBe(true);

    const nextDraft = await repository.createDraft(
      { workspaceId, brandId, actorUserId: memberId },
      {
        core: validCore("다음 초안"),
        evidence: [],
        reviewState: approved.reviewState,
        sourceAnalysisId: null,
      },
    );
    expect((await repository.getActive({ workspaceId, brandId }))?.id).toBe(approved.id);
    const versions = await repository.listVersions({ workspaceId, brandId });
    expect(versions.map((item) => item.version)).toEqual(
      [...versions.map((item) => item.version)].sort((left, right) => right - left),
    );
    expect(versions[0]?.id).toBe(nextDraft.id);
  }, 30_000);

  it("rejects cross-brand resources and stale browser updates", async () => {
    const repository = createBrandCoreRepository(pglitePool(database));
    const draft = await repository.createDraft(
      { workspaceId, brandId: otherBrandId, actorUserId: ownerId },
      { core: validCore("다른 브랜드"), evidence: [], sourceAnalysisId: null },
    );

    await expect(repository.updateDraft(
      { workspaceId, brandId, actorUserId: ownerId, versionId: draft.id },
      {
        core: validCore("잘못된 접근"),
        evidence: [],
        reviewState: draft.reviewState,
        expectedUpdatedAt: draft.updatedAt,
      },
    )).rejects.toThrow("brand_core_not_found");

    await repository.updateDraft(
      { workspaceId, brandId: otherBrandId, actorUserId: ownerId, versionId: draft.id },
      {
        core: validCore("정상 수정"),
        evidence: [],
        reviewState: draft.reviewState,
        expectedUpdatedAt: draft.updatedAt,
      },
    );
    await expect(repository.updateDraft(
      { workspaceId, brandId: otherBrandId, actorUserId: ownerId, versionId: draft.id },
      {
        core: validCore("오래된 수정"),
        evidence: [],
        reviewState: draft.reviewState,
        expectedUpdatedAt: draft.updatedAt,
      },
    )).rejects.toThrow("brand_core_version_conflict");

    await expect(repository.approve(
      { workspaceId, brandId: otherBrandId, actorUserId: ownerId, versionId: draft.id },
      { expectedUpdatedAt: draft.updatedAt },
    )).rejects.toThrow("brand_core_version_conflict");
  }, 30_000);

  it("versions rules and keeps auto-approval as review configuration", async () => {
    const repository = createBrandCoreRepository(pglitePool(database));
    const draft = await repository.saveRuleDraft(
      { workspaceId, brandId: otherBrandId, actorUserId: memberId },
      {
        contractVersion: "brand-rules.v2",
        requiredPhrases: [],
        forbiddenPhrases: ["무조건"],
        exaggerationRules: [],
        ctaRules: { defaultCta: "자세히 확인하기", allowed: [] },
        channelRules: {},
        autoApprovalRules: { enabled: true, conditions: ["금지 문구 없음"] },
      },
    );
    await expect(repository.approveRules({
      workspaceId,
      brandId: otherBrandId,
      actorUserId: memberId,
      ruleSetId: draft.id,
    })).rejects.toThrow("brand_core_approval_forbidden");

    const approved = await repository.approveRules({
      workspaceId,
      brandId: otherBrandId,
      actorUserId: ownerId,
      ruleSetId: draft.id,
    });
    expect(approved.status).toBe("approved");
    expect((await repository.getActiveRules({ workspaceId, brandId: otherBrandId }))
      ?.rules.autoApprovalRules.enabled).toBe(true);
  }, 30_000);

  it("marks only changed core fields user-edited and preserves unchanged review provenance", async () => {
    const repository = createBrandCoreRepository(pglitePool(database));
    const initial = await repository.createDraft(
      { workspaceId, brandId: provenanceBrandId, actorUserId: ownerId },
      { core: validCore("승인 원본"), evidence: [], sourceAnalysisId: null },
    );
    const approved = await repository.approve(
      { workspaceId, brandId: provenanceBrandId, actorUserId: ownerId, versionId: initial.id },
      { expectedUpdatedAt: initial.updatedAt },
    );
    const changedAtCreate = validCore("승인 원본");
    changedAtCreate.summary.oneLine = "사용자가 바꾼 한 줄";
    const draft = await repository.createDraft(
      { workspaceId, brandId: provenanceBrandId, actorUserId: memberId },
      {
        core: changedAtCreate,
        evidence: approved.evidence,
        reviewState: approved.reviewState,
        sourceAnalysisId: null,
      },
    );

    expect(draft.reviewState["summary.oneLine"]).toMatchObject({
      decision: "user_edited",
      reviewerUserId: memberId,
    });
    expect(draft.reviewState["summary.description"]).toEqual(
      approved.reviewState["summary.description"],
    );

    const changedAtUpdate = structuredClone(draft.core);
    changedAtUpdate.messaging.tone = ["따뜻함"];
    const updated = await repository.updateDraft(
      {
        workspaceId,
        brandId: provenanceBrandId,
        actorUserId: ownerId,
        versionId: draft.id,
      },
      {
        core: changedAtUpdate,
        evidence: draft.evidence,
        reviewState: draft.reviewState,
        expectedUpdatedAt: draft.updatedAt,
      },
    );

    expect(updated.reviewState["messaging.tone"]).toMatchObject({
      decision: "user_edited",
      reviewerUserId: ownerId,
    });
    expect(updated.reviewState["summary.oneLine"]).toEqual(
      draft.reviewState["summary.oneLine"],
    );
    expect(updated.reviewState["summary.description"]).toEqual(
      approved.reviewState["summary.description"],
    );
  }, 30_000);

  it("returns the same draft when create requests race for one brand", async () => {
    const repository = createBrandCoreRepository(pglitePool(database));
    const input = { core: validCore("동시 초안"), evidence: [], sourceAnalysisId: null };

    const [first, second] = await Promise.all([
      repository.createDraft(
        { workspaceId, brandId: concurrencyBrandId, actorUserId: ownerId },
        input,
      ),
      repository.createDraft(
        { workspaceId, brandId: concurrencyBrandId, actorUserId: memberId },
        input,
      ),
    ]);

    expect(first.id).toBe(second.id);
    const versions = await repository.listVersions({ workspaceId, brandId: concurrencyBrandId });
    expect(versions.filter((version) => version.status === "draft")).toHaveLength(1);
  }, 30_000);

  it("preserves microsecond concurrency tokens returned by PostgreSQL", async () => {
    const repository = createBrandCoreRepository(pglitePool(database));
    const draft = await repository.createDraft(
      { workspaceId, brandId: precisionBrandId, actorUserId: ownerId },
      { core: validCore("정밀 토큰"), evidence: [], sourceAnalysisId: null },
    );
    await database.exec("alter table brand_core_versions disable trigger brand_core_versions_set_updated_at");
    try {
      await database.query(
        `update brand_core_versions
            set updated_at = '2026-07-29T03:04:05.123456Z'::timestamptz
          where id = $1`,
        [draft.id],
      );
    } finally {
      await database.exec("alter table brand_core_versions enable trigger brand_core_versions_set_updated_at");
    }

    const preciseDraft = (await repository.listVersions({
      workspaceId,
      brandId: precisionBrandId,
    }))[0];
    expect(preciseDraft.updatedAt).toBe("2026-07-29T03:04:05.123456Z");
    await expect(repository.approve(
      {
        workspaceId,
        brandId: precisionBrandId,
        actorUserId: ownerId,
        versionId: draft.id,
      },
      { expectedUpdatedAt: preciseDraft.updatedAt },
    )).resolves.toMatchObject({ status: "approved" });
  }, 30_000);
});
