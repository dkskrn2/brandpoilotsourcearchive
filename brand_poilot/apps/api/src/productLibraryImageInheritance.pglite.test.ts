import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProductLibraryRepository } from "./productLibraryRepository.js";

const workspaceId = "11000000-0000-4000-8000-000000000001";
const brandId = "12000000-0000-4000-8000-000000000001";
const actorUserId = "13000000-0000-4000-8000-000000000001";
const productId = "14000000-0000-4000-8000-000000000001";
const approvedVersionId = "15000000-0000-4000-8000-000000000001";

function pool(database: PGlite): Pool {
  const query = async (sql: string, values: unknown[] = []) => {
    const result = await database.query(sql, values as never[]);
    return {
      rows: result.rows as Record<string, unknown>[],
      rowCount: result.rows.length || Number(result.affectedRows ?? 0),
    };
  };
  return { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
}

const profile = {
  contractVersion: "product-service.v1" as const,
  name: "온보딩 제품",
  kind: "product" as const,
  description: "설명",
  features: [],
  benefits: [],
  cautions: [],
  audiences: [],
  appealsByTarget: {},
  evergreenPurchaseInfo: "",
  sourceUrls: ["https://shop.example/products/one"],
};

describe("product version image inheritance", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = await PGlite.create({ extensions: { pgcrypto } });
    await database.exec(`
      create table workspaces(id uuid primary key);
      create table brands(id uuid primary key,workspace_id uuid not null,deleted_at timestamptz null);
      create table workspace_members(
        workspace_id uuid not null,user_id uuid not null,role text not null,status text not null
      );
      create table product_services(
        id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
        kind text not null,display_name text not null,status text not null default 'active',
        active_version_id uuid null,updated_at timestamptz not null default now()
      );
      create table product_service_versions(
        id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
        product_service_id uuid not null,source_analysis_id uuid null,version integer not null,status text not null,
        profile_json jsonb not null,evidence_json jsonb not null default '[]',approved_at timestamptz null,
        created_by_user_id uuid null,updated_at timestamptz not null default now()
      );
      create table product_service_assets(
        id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
        product_service_id uuid not null,product_service_version_id uuid not null,
        source_image_id uuid null,storage_artifact_id uuid null,storage_url text not null,storage_path text null,
        mime_type text not null,size_bytes bigint not null,checksum text null,role text not null,position integer not null,
        created_by_user_id uuid null,created_at timestamptz not null default now(),
        unique(product_service_version_id,position)
      );

      insert into workspaces values ('${workspaceId}');
      insert into brands values ('${brandId}','${workspaceId}',null);
      insert into workspace_members values ('${workspaceId}','${actorUserId}','owner','active');
      insert into product_services(id,workspace_id,brand_id,kind,display_name,status,active_version_id)
      values ('${productId}','${workspaceId}','${brandId}','product','온보딩 제품','active','${approvedVersionId}');
      insert into product_service_versions(
        id,workspace_id,brand_id,product_service_id,version,status,profile_json,approved_at,created_by_user_id
      ) values (
        '${approvedVersionId}','${workspaceId}','${brandId}','${productId}',1,'approved',
        '${JSON.stringify(profile)}',now(),'${actorUserId}'
      );
      insert into product_service_assets(
        workspace_id,brand_id,product_service_id,product_service_version_id,storage_artifact_id,
        storage_url,storage_path,mime_type,size_bytes,checksum,role,position,created_by_user_id
      ) values
        ('${workspaceId}','${brandId}','${productId}','${approvedVersionId}',
         '16000000-0000-4000-8000-000000000001','https://blob.example/hero.png','products/hero.png',
         'image/png',100,'${"a".repeat(64)}','hero',1,'${actorUserId}'),
        ('${workspaceId}','${brandId}','${productId}','${approvedVersionId}',
         '16000000-0000-4000-8000-000000000002','https://blob.example/detail.webp','products/detail.webp',
         'image/webp',200,'${"b".repeat(64)}','detail',2,'${actorUserId}');
    `);
  });

  afterEach(async () => database.close());

  it("copies approved image links when an edit creates a new draft version", async () => {
    const repository = createProductLibraryRepository(pool(database));
    const updated = await repository.updateProductServiceDraft(
      { workspaceId, brandId, actorUserId, itemId: productId },
      { ...profile, description: "수정 설명" },
    );

    expect(updated.draft?.id).toBeTruthy();
    const assets = await database.query<{
      storage_artifact_id: string; storage_url: string; role: string; position: number;
    }>(
      `select storage_artifact_id,storage_url,role,position
         from product_service_assets
        where product_service_version_id=$1
        order by position`,
      [updated.draft!.id],
    );
    expect(assets.rows).toEqual([
      {
        storage_artifact_id: "16000000-0000-4000-8000-000000000001",
        storage_url: "https://blob.example/hero.png",
        role: "hero",
        position: 1,
      },
      {
        storage_artifact_id: "16000000-0000-4000-8000-000000000002",
        storage_url: "https://blob.example/detail.webp",
        role: "detail",
        position: 2,
      },
    ]);
  });
});
