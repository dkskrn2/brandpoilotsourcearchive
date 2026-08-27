import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createProductServiceImageAssetsRepository } from "./productServiceImageAssetsRepository.js";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const brandId = "20000000-0000-4000-8000-000000000001";
const memberId = "30000000-0000-4000-8000-000000000002";
const productId = "40000000-0000-4000-8000-000000000001";
const versionId = "50000000-0000-4000-8000-000000000001";

function pool(database: PGlite): Pool {
  const query = async (sql: string, values: unknown[] = []) => {
    const result = await database.query(sql, values as never[]);
    return { rows: result.rows as Record<string, unknown>[], rowCount: result.rows.length || Number(result.affectedRows ?? 0) };
  };
  return { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
}

describe("product service image assets repository", () => {
  let database: PGlite;
  beforeEach(async () => {
    database = await PGlite.create({ extensions: { pgcrypto } });
    await database.exec(`
      create table brands(id uuid primary key,workspace_id uuid not null,deleted_at timestamptz null);
      create table workspace_members(workspace_id uuid not null,user_id uuid not null,role text not null,status text not null);
      create table storage_artifacts(id uuid primary key,workspace_id uuid not null,brand_id uuid not null,deleted_at timestamptz null);
      create table product_service_assets(
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,product_service_id uuid not null,
        product_service_version_id uuid not null,storage_artifact_id uuid not null,storage_url text not null,
        storage_path text not null,mime_type text not null,size_bytes bigint not null,role text not null,position integer not null,
        unique(product_service_version_id,position)
      );
      insert into brands values('${brandId}','${workspaceId}',null);
      insert into workspace_members values('${workspaceId}','${memberId}','member','active');
      insert into storage_artifacts values
        ('80000000-0000-4000-8000-000000000002','${workspaceId}','${brandId}',null),
        ('80000000-0000-4000-8000-000000000003','${workspaceId}','${brandId}',null),
        ('80000000-0000-4000-8000-000000000004','${workspaceId}','${brandId}',null);
      insert into product_service_assets values
        ('90000000-0000-4000-8000-000000000001','${workspaceId}','${brandId}','${productId}','${versionId}','80000000-0000-4000-8000-000000000002','https://blob/1','1','image/png',1,'hero',1),
        ('90000000-0000-4000-8000-000000000002','${workspaceId}','${brandId}','${productId}','${versionId}','80000000-0000-4000-8000-000000000003','https://blob/2','2','image/png',1,'detail',2),
        ('90000000-0000-4000-8000-000000000003','${workspaceId}','${brandId}','${productId}','${versionId}','80000000-0000-4000-8000-000000000004','https://blob/3','3','image/png',1,'detail',3);
    `);
  });
  afterEach(async () => database.close());

  it("promotes and compacts the remaining images after deleting the hero", async () => {
    const repository = createProductServiceImageAssetsRepository(pool(database));
    await repository.deleteProductServiceImageAsset({
      workspaceId, brandId, actorUserId: memberId, productServiceId: productId,
      imageId: "90000000-0000-4000-8000-000000000001",
    });
    const result = await database.query<{ id: string; role: string; position: number }>(
      "select id,role,position from product_service_assets order by position",
    );
    expect(result.rows).toEqual([
      { id: "90000000-0000-4000-8000-000000000002", role: "hero", position: 1 },
      { id: "90000000-0000-4000-8000-000000000003", role: "detail", position: 2 },
    ]);
  });

  it("keeps a shared storage artifact live when another product version still references it", async () => {
    await database.exec(`insert into product_service_assets values(
      '90000000-0000-4000-8000-000000000004','${workspaceId}','${brandId}','${productId}',
      '50000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000002',
      'https://blob/1','1','image/png',1,'hero',1)`);
    const repository = createProductServiceImageAssetsRepository(pool(database));
    await repository.deleteProductServiceImageAsset({
      workspaceId, brandId, actorUserId: memberId, productServiceId: productId,
      imageId: "90000000-0000-4000-8000-000000000001",
    });
    const artifact = await database.query<{ deleted_at: string | null }>(
      "select deleted_at from storage_artifacts where id='80000000-0000-4000-8000-000000000002'",
    );
    expect(artifact.rows[0]?.deleted_at).toBeNull();
  });
});
