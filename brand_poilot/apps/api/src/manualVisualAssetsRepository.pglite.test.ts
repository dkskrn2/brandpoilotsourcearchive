import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createManualVisualAssetsRepository } from "./manualVisualAssetsRepository.js";
import { saveManualVisualSelection } from "./aiContentManualVisualSelection.js";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const brandId = "20000000-0000-4000-8000-000000000001";
const ownerId = "30000000-0000-4000-8000-000000000001";
const memberId = "30000000-0000-4000-8000-000000000002";
const productId = "40000000-0000-4000-8000-000000000001";
const versionId = "50000000-0000-4000-8000-000000000001";
const presetId = "60000000-0000-4000-8000-000000000001";
const referenceId = "70000000-0000-4000-8000-000000000001";

function pool(database: PGlite): Pool {
  const query = async (sql: string, values: unknown[] = []) => {
    const result = await database.query(sql, values as never[]);
    return { rows: result.rows as Record<string, unknown>[], rowCount: result.rows.length || Number(result.affectedRows ?? 0) };
  };
  return { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
}

describe("manual visual assets repository PostgreSQL behavior", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = await PGlite.create({ extensions: { pgcrypto } });
    await database.exec(`
      create table workspaces(id uuid primary key);
      create table brands(id uuid primary key,workspace_id uuid not null,deleted_at timestamptz null);
      create table workspace_members(workspace_id uuid not null,user_id uuid not null,role text not null,status text not null);
      create table storage_artifacts(
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,deleted_at timestamptz null,
        public_url text,path text,checksum text,mime_type text
      );
      create table reference_items(
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,storage_artifact_id uuid,archived_at timestamptz null
      );
      create table brand_style_presets(
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,name text not null,description text not null,
        visual_tokens_json jsonb not null,is_default boolean not null,status text not null,revision integer not null,
        created_at timestamptz not null default now(),updated_at timestamptz not null default now()
      );
      create table brand_style_preset_references(
        id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
        preset_id uuid not null,reference_item_id uuid not null,position integer not null
      );
      create table product_service_assets(
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,product_service_id uuid not null,
        product_service_version_id uuid not null,storage_artifact_id uuid not null,storage_url text not null,
        storage_path text not null,mime_type text not null,size_bytes bigint not null,role text not null,position integer not null,
        unique(product_service_version_id,position)
      );
      create table manual_ai_content_visual_selections(
        generation_id uuid primary key,workspace_id uuid not null,brand_id uuid not null,contract_version text not null,
        product_service_id uuid,product_service_version_id uuid,style_preset_id uuid,style_preset_revision integer,
        avatar_id uuid,avatar_revision integer,selection_json jsonb not null,selection_sha256 text not null,
        frozen_json jsonb,frozen_sha256 text,frozen_at timestamptz
      );
      insert into workspaces values ('${workspaceId}');
      insert into brands values ('${brandId}','${workspaceId}',null);
      insert into workspace_members values
        ('${workspaceId}','${ownerId}','owner','active'),
        ('${workspaceId}','${memberId}','member','active');
      insert into storage_artifacts values
        ('80000000-0000-4000-8000-000000000001','${workspaceId}','${brandId}',null,'https://blob/ref','ref','${"a".repeat(64)}','image/png'),
        ('80000000-0000-4000-8000-000000000002','${workspaceId}','${brandId}',null,'https://blob/1','1','${"b".repeat(64)}','image/png'),
        ('80000000-0000-4000-8000-000000000003','${workspaceId}','${brandId}',null,'https://blob/2','2','${"c".repeat(64)}','image/png'),
        ('80000000-0000-4000-8000-000000000004','${workspaceId}','${brandId}',null,'https://blob/3','3','${"d".repeat(64)}','image/png');
      insert into reference_items values ('${referenceId}','${workspaceId}','${brandId}','80000000-0000-4000-8000-000000000001',null);
      insert into brand_style_presets values (
        '${presetId}','${workspaceId}','${brandId}','Default','',
        '{"colors":[],"fonts":[],"notes":[]}',true,'active',1,now(),now()
      );
      insert into brand_style_preset_references(workspace_id,brand_id,preset_id,reference_item_id,position)
        values ('${workspaceId}','${brandId}','${presetId}','${referenceId}',1);
      insert into product_service_assets values
        ('90000000-0000-4000-8000-000000000001','${workspaceId}','${brandId}','${productId}','${versionId}','80000000-0000-4000-8000-000000000002','https://blob/1','1','image/png',1,'hero',1),
        ('90000000-0000-4000-8000-000000000002','${workspaceId}','${brandId}','${productId}','${versionId}','80000000-0000-4000-8000-000000000003','https://blob/2','2','image/png',1,'detail',2),
        ('90000000-0000-4000-8000-000000000003','${workspaceId}','${brandId}','${productId}','${versionId}','80000000-0000-4000-8000-000000000004','https://blob/3','3','image/png',1,'detail',3);
    `);
  });

  afterEach(async () => database.close());

  it("prevents a member from clearing the current default preset", async () => {
    const repository = createManualVisualAssetsRepository(pool(database));
    await expect(repository.updateBrandStylePreset({
      workspaceId, brandId, actorUserId: memberId, presetId, expectedRevision: 1,
    }, {
      contractVersion: "brand-style-preset.v1", name: "Default", description: "",
      visualTokens: { colors: [], fonts: [], notes: [] }, referenceItemIds: [referenceId], isDefault: false,
    })).rejects.toThrow("brand_style_preset_admin_required");
    const result = await database.query<{ is_default: boolean }>("select is_default from brand_style_presets where id=$1", [presetId]);
    expect(result.rows[0]?.is_default).toBe(true);
  });

  it("promotes and compacts the remaining images after deleting the hero", async () => {
    const repository = createManualVisualAssetsRepository(pool(database));
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
    await database.exec(`
      insert into product_service_assets values
        ('90000000-0000-4000-8000-000000000004','${workspaceId}','${brandId}','${productId}',
         '50000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000002',
         'https://blob/1','1','image/png',1,'hero',1);
    `);
    const repository = createManualVisualAssetsRepository(pool(database));
    await repository.deleteProductServiceImageAsset({
      workspaceId, brandId, actorUserId: memberId, productServiceId: productId,
      imageId: "90000000-0000-4000-8000-000000000001",
    });

    const artifact = await database.query<{ deleted_at: string | null }>(
      "select deleted_at from storage_artifacts where id='80000000-0000-4000-8000-000000000002'",
    );
    expect(artifact.rows[0]?.deleted_at).toBeNull();
  });

  it("uses revision CAS for owner preset updates", async () => {
    const repository = createManualVisualAssetsRepository(pool(database));
    const input = {
      contractVersion: "brand-style-preset.v1" as const, name: "Updated", description: "",
      visualTokens: { colors: [], fonts: [], notes: [] }, referenceItemIds: [referenceId], isDefault: true,
    };
    await expect(repository.updateBrandStylePreset({
      workspaceId, brandId, actorUserId: ownerId, presetId, expectedRevision: 1,
    }, input)).resolves.toMatchObject({ name: "Updated", revision: 2, isDefault: true });
    await expect(repository.updateBrandStylePreset({
      workspaceId, brandId, actorUserId: ownerId, presetId, expectedRevision: 1,
    }, input)).rejects.toThrow("brand_style_preset_version_conflict");
  });

  it("rejects freezing a preset revision when one linked reference is archived", async () => {
    const archivedReferenceId = "70000000-0000-4000-8000-000000000002";
    await database.exec(`
      insert into storage_artifacts values
        ('80000000-0000-4000-8000-000000000005','${workspaceId}','${brandId}',null,'https://blob/archived','archived','${"e".repeat(64)}','image/png');
      insert into reference_items values
        ('${archivedReferenceId}','${workspaceId}','${brandId}','80000000-0000-4000-8000-000000000005',now());
      insert into brand_style_preset_references(workspace_id,brand_id,preset_id,reference_item_id,position)
        values ('${workspaceId}','${brandId}','${presetId}','${archivedReferenceId}',2);
    `);
    await expect(saveManualVisualSelection(pool(database), {
      generationId: "a0000000-0000-4000-8000-000000000001", workspaceId, brandId,
    }, {
      contractVersion: "manual-visual-selection.v1", product: null,
      stylePreset: { presetId, revision: 1 }, avatar: null,
    })).rejects.toThrow("manual_visual_selection_unavailable");
  });
});
