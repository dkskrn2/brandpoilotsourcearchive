import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRepository } from "./repository.js";

type QueryResult = { rowCount: number; rows: Record<string, unknown>[] };

function pglitePool(database: PGlite): Pool {
  async function query(sql: string, values: unknown[] = []): Promise<QueryResult> {
    const result = await database.query(sql, values as never[]);
    return {
      rowCount: result.rows.length || Number(result.affectedRows ?? 0),
      rows: result.rows as Record<string, unknown>[],
    };
  }
  return {
    query,
    async connect() {
      return { query, release() {} };
    },
  } as unknown as Pool;
}

const workspaceId = "31000000-0000-4000-8000-000000000001";
const brandId = "32000000-0000-4000-8000-000000000002";
const memberId = "33000000-0000-4000-8000-000000000003";
let database: PGlite;

beforeAll(async () => {
  database = await PGlite.create({ extensions: { pgcrypto } });
  const directory = resolve(process.cwd(), "../../db/migrations");
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    if (file >= "075_") continue;
    const sql = await readFile(resolve(directory, file), "utf8");
    if (sql.startsWith("-- requires: pgvector") || file === "027_wiki_search_v2.sql") continue;
    await database.exec(sql);
  }
  const faqMigration = await readFile(resolve(directory, "078_faq_utterance_matching.sql"), "utf8");
  const ownershipBoundary = faqMigration.lastIndexOf("\ndo $$\ndeclare\n  schema_owner_role_name");
  if (ownershipBoundary < 0) throw new Error("faq_pglite_ownership_boundary_missing");
  await database.exec(`${faqMigration.slice(0, ownershipBoundary)}\ncommit;`);
  await database.exec(`
    insert into app_users(id,email) values ('${memberId}','wiki-member@example.com');
    insert into workspaces(id,name,slug,created_by_user_id)
    values ('${workspaceId}','Wiki','wiki-draft-list','${memberId}');
    insert into workspace_members(workspace_id,user_id,role,status)
    values ('${workspaceId}','${memberId}','member','active');
    insert into brands(id,workspace_id,name) values ('${brandId}','${workspaceId}','Wiki Brand');
  `);
}, 45_000);

afterAll(async () => database.close());

describe("DM Wiki repository PostgreSQL behavior", () => {
  it("enqueues only one immediate request until the first Wiki becomes active", async () => {
    await database.query("delete from wiki_build_requests where brand_id = $1", [brandId]);
    const repository = createRepository(pglitePool(database));

    await expect(repository.ensureInitialWikiBuild!(brandId)).resolves.toEqual({ state: "enqueued" });
    await expect(repository.ensureInitialWikiBuild!(brandId)).resolves.toEqual({ state: "already_pending" });

    const requests = await database.query(
      `select requested_revision, status, quiet_until <= now() as immediate
         from wiki_build_requests
        where workspace_id = $1 and brand_id = $2`,
      [workspaceId, brandId],
    );
    expect(requests.rows).toEqual([{ requested_revision: 1, status: "pending", immediate: true }]);
  });

  it("preserves draft status when a newly created disabled item is listed", async () => {
    const repository = createRepository(pglitePool(database));
    const created = await repository.createWikiItem!(
      { workspaceId, brandId, actorUserId: memberId },
      {
        contractVersion: "wiki-item.v1",
        itemType: "faq",
        title: "배송 안내",
        content: "영업일 기준 이틀 안에 발송합니다.",
        provenance: {},
      },
    );

    expect(created).toMatchObject({ status: "draft", buildStatus: "draft" });
    await expect(repository.listWikiItems!({ workspaceId, brandId }))
      .resolves.toEqual([
        expect.objectContaining({
          id: created.id,
          status: "draft",
          buildStatus: "draft",
        }),
      ]);
  });

  it("maps disabled or archived non-draft items to inactive", async () => {
    const repository = createRepository(pglitePool(database));
    const created = await repository.createWikiItem!(
      { workspaceId, brandId, actorUserId: memberId },
      {
        contractVersion: "wiki-item.v1",
        itemType: "policy",
        title: "교환 정책",
        content: "수령 후 일주일 안에 교환할 수 있습니다.",
        provenance: {},
      },
    );

    await database.query(
      "update knowledge_entries set status = 'approved', enabled = false where id = $1",
      [created.id],
    );
    let listed = await repository.listWikiItems!({ workspaceId, brandId });
    expect(listed.find((entry) => entry.id === created.id))
      .toMatchObject({ status: "inactive", buildStatus: "inactive" });

    await database.query(
      "update knowledge_entries set status = 'archived', enabled = true where id = $1",
      [created.id],
    );
    listed = await repository.listWikiItems!({ workspaceId, brandId });
    expect(listed.find((entry) => entry.id === created.id))
      .toMatchObject({ status: "inactive", buildStatus: "inactive" });
  });

  it("lists and updates FAQ expression examples without changing source aliases", async () => {
    const repository = createRepository(pglitePool(database));
    const created = await repository.createWikiItem!(
      { workspaceId, brandId, actorUserId: memberId },
      {
        contractVersion: "wiki-item.v1",
        itemType: "faq",
        title: "운영시간 안내",
        content: "평일 오전 9시부터 운영합니다.",
        provenance: {},
      },
    );
    await database.query(
      "update knowledge_entries set aliases = $2 where id = $1",
      [created.id, ["몇 시에 열어요?", "영업 시간"]],
    );

    const listed = (await repository.listWikiItems!({ workspaceId, brandId }))
      .find((entry) => entry.id === created.id)!;
    expect(listed).toMatchObject({
      sourceAliases: ["몇 시에 열어요?", "영업 시간"],
      manualAliases: [],
      effectiveAliases: ["몇 시에 열어요?", "영업 시간"],
    });

    const updated = await repository.updateWikiItem!(
      { workspaceId, brandId, actorUserId: memberId, itemId: created.id },
      {
        manualAliases: ["언제 문 열어요?", "영업 시간"],
        expectedUpdatedAt: listed.updatedAt,
      },
    );
    expect(updated).toMatchObject({
      status: "draft",
      sourceAliases: ["몇 시에 열어요?", "영업 시간"],
      manualAliases: ["언제 문 열어요?", "영업 시간"],
      effectiveAliases: ["몇 시에 열어요?", "영업 시간", "언제 문 열어요?"],
    });

    await expect(repository.updateWikiItem!(
      { workspaceId, brandId, actorUserId: memberId, itemId: created.id },
      { manualAliases: ["오래된 수정"], expectedUpdatedAt: listed.updatedAt },
    )).rejects.toThrow("wiki_item_conflict");
  });

  it("preserves an active FAQ status when editing its question, answer, and expressions", async () => {
    const repository = createRepository(pglitePool(database));
    await database.query("delete from wiki_build_requests where brand_id = $1", [brandId]);
    const created = await repository.createWikiItem!(
      { workspaceId, brandId, actorUserId: memberId },
      {
        contractVersion: "wiki-item.v1",
        itemType: "faq",
        title: "반품 안내",
        content: "수령 후 7일 안에 반품할 수 있습니다.",
        provenance: {},
      },
    );
    await database.query(
      `update knowledge_entries
          set status = 'active', enabled = true, approved_by_user_id = $2, approved_at = now()
        where id = $1`,
      [created.id, memberId],
    );
    const active = (await repository.listWikiItems!({ workspaceId, brandId }))
      .find((entry) => entry.id === created.id)!;

    const updated = await repository.updateWikiItem!(
      { workspaceId, brandId, actorUserId: memberId, itemId: created.id },
      {
        title: "교환·반품 안내",
        content: "수령 후 7일 안에 교환 또는 반품할 수 있습니다.",
        manualAliases: ["반품 어떻게 해요?", "교환 가능한가요?"],
        expectedUpdatedAt: active.updatedAt,
      },
    );

    expect(updated).toMatchObject({
      status: "active",
      title: "교환·반품 안내",
      content: "수령 후 7일 안에 교환 또는 반품할 수 있습니다.",
      manualAliases: ["반품 어떻게 해요?", "교환 가능한가요?"],
    });
    const stored = await database.query(
      "select status, enabled, approved_by_user_id is not null as approved from knowledge_entries where id = $1",
      [created.id],
    );
    expect(stored.rows[0]).toEqual({ status: "active", enabled: true, approved: true });
    const rebuild = await database.query(
      "select count(*)::integer as count from wiki_build_requests where brand_id = $1 and status = 'pending'",
      [brandId],
    );
    expect(rebuild.rows[0]).toEqual({ count: 1 });
  });
});
