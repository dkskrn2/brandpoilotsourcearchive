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
    const sql = await readFile(resolve(directory, file), "utf8");
    if (sql.startsWith("-- requires: pgvector") || file === "027_wiki_search_v2.sql") continue;
    await database.exec(sql);
  }
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
});
