import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProductLibraryRepository } from "./productLibraryRepository.js";

type QueryResult = { rowCount: number; rows: Record<string, unknown>[] };
function pool(database: PGlite): Pool {
  async function query(sql: string, values: unknown[] = []): Promise<QueryResult> {
    const result = await database.query(sql, values as never[]);
    return { rowCount: result.rows.length || Number(result.affectedRows ?? 0), rows: result.rows as Record<string, unknown>[] };
  }
  return { query, async connect() { return { query, release() {} }; } } as unknown as Pool;
}

const workspaceId = "21000000-0000-4000-8000-000000000001";
const brandId = "22000000-0000-4000-8000-000000000002";
const ownerId = "23000000-0000-4000-8000-000000000003";
const memberId = "24000000-0000-4000-8000-000000000004";
const analysisId = "25000000-0000-4000-8000-000000000005";
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
    insert into app_users(id,email) values ('${ownerId}','owner-products@example.com'),('${memberId}','member-products@example.com');
    insert into workspaces(id,name,slug,created_by_user_id) values ('${workspaceId}','Products','products-repository','${ownerId}');
    insert into workspace_members(workspace_id,user_id,role,status) values
      ('${workspaceId}','${ownerId}','owner','active'),('${workspaceId}','${memberId}','member','active');
    insert into brands(id,workspace_id,name) values ('${brandId}','${workspaceId}','Product Brand');
    insert into ai_content_subject_analyses(
      id,workspace_id,brand_id,subject_type,source_url,normalized_url,status,
      facts_json,structured_data_json,targets_json,appeals_json,idempotency_key
    ) values (
      '${analysisId}','${workspaceId}','${brandId}','service','https://example.com/service','https://example.com/service','ready',
      '[{"claim":"운영 자동화"}]','{"name":"모종 애드","description":"SNS 운영","features":["생성"],"benefits":["시간 절감"]}',
      '[{"id":"owner","name":"운영자"}]','{"owner":[{"id":"time","text":"시간 절감"}]}','analysis-1'
    );
  `);
}, 45_000);

afterAll(async () => database.close());

describe("product library repository", () => {
  it("promotes one analysis idempotently and restricts approval/archive to owner or admin", async () => {
    const repository = createProductLibraryRepository(pool(database));
    const first = await repository.createProductServiceFromAnalysis({ workspaceId, brandId, actorUserId: memberId, analysisId });
    const second = await repository.createProductServiceFromAnalysis({ workspaceId, brandId, actorUserId: memberId, analysisId });
    expect(second.id).toBe(first.id);
    expect(first.draft?.profile.name).toBe("모종 애드");

    await expect(repository.approveProductService({ workspaceId, brandId, actorUserId: memberId, itemId: first.id }))
      .rejects.toThrow("product_service_approval_forbidden");
    const approved = await repository.approveProductService({ workspaceId, brandId, actorUserId: ownerId, itemId: first.id });
    expect(approved.activeVersion?.status).toBe("approved");
    expect((await repository.listProductServices({ workspaceId, brandId })).map((item) => item.id)).toContain(first.id);

    await repository.archiveProductService({ workspaceId, brandId, actorUserId: ownerId, itemId: first.id });
    expect(await repository.listProductServices({ workspaceId, brandId })).toEqual([]);
    expect((await repository.listProductServices({ workspaceId, brandId }, ["archived"]))[0]?.status).toBe("archived");
  });
});
