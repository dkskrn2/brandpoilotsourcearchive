import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
const brandId = "20000000-0000-4000-8000-000000000002";
const otherBrandId = "20000000-0000-4000-8000-000000000003";
const ownerId = "30000000-0000-4000-8000-000000000003";
const memberId = "30000000-0000-4000-8000-000000000004";

let database: PGlite;

beforeAll(async () => {
  database = await PGlite.create({ extensions: { pgcrypto } });
  const migrationDirectory = resolve(process.cwd(), "../../db/migrations");
  const files = (await readdir(migrationDirectory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(resolve(migrationDirectory, file), "utf8");
    if (sql.startsWith("-- requires: pgvector") || file === "027_wiki_search_v2.sql") continue;
    await database.exec(sql);
  }
  await database.exec(`
    insert into app_users (id, email) values
      ('${ownerId}', 'owner@example.com'),
      ('${memberId}', 'member@example.com');
    insert into workspaces (id, name, slug, created_by_user_id)
      values ('${workspaceId}', 'Brand Core Repository', 'brand-core-repository', '${ownerId}');
    insert into workspace_members (workspace_id, user_id, role, status) values
      ('${workspaceId}', '${ownerId}', 'owner', 'active'),
      ('${workspaceId}', '${memberId}', 'member', 'active');
    insert into brands (id, workspace_id, name) values
      ('${brandId}', '${workspaceId}', 'First'),
      ('${otherBrandId}', '${workspaceId}', 'Other');
    insert into brand_profiles (workspace_id, brand_id) values
      ('${workspaceId}', '${brandId}'),
      ('${workspaceId}', '${otherBrandId}');
  `);
}, 30_000);

afterAll(async () => {
  await database.close();
});

describe("brand core repository", () => {
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

    await expect(repository.approve({
      workspaceId,
      brandId,
      actorUserId: memberId,
      versionId: draft.id,
    })).rejects.toThrow("brand_core_approval_forbidden");

    const approved = await repository.approve({
      workspaceId,
      brandId,
      actorUserId: ownerId,
      versionId: draft.id,
    });
    expect(approved.status).toBe("approved");
    expect((await repository.getActive({ workspaceId, brandId }))?.id).toBe(draft.id);
    expect(Object.values(approved.reviewState).every((review) => review?.decision === "approved")).toBe(true);
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
  }, 30_000);

  it("versions rules and keeps auto-approval as review configuration", async () => {
    const repository = createBrandCoreRepository(pglitePool(database));
    const draft = await repository.saveRuleDraft(
      { workspaceId, brandId: otherBrandId, actorUserId: memberId },
      {
        contractVersion: "brand-rules.v1",
        requiredPhrases: [],
        forbiddenPhrases: ["무조건"],
        exaggerationRules: [],
        ctaRules: { defaultCta: "자세히 확인하기", allowed: [] },
        channelRules: {},
        designRules: { colors: [], fonts: [], notes: [] },
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
});
