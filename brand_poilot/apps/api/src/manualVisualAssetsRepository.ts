import type { Pool, PoolClient } from "pg";
import type { BrandScope } from "./brandCoreRepository.js";
import {
  parseBrandStylePresetInput,
  type BrandStylePresetInputV1,
} from "./manualVisualAssetsContracts.js";
import type { ConfirmedAssetLibraryUpload } from "./assetLibraryUpload.js";

export interface ProductServiceImageAsset extends BrandScope {
  id: string;
  productServiceId: string;
  versionId: string;
  storageArtifactId: string;
  role: "hero" | "detail";
  position: number;
  storageUrl: string;
  mimeType: string;
  sizeBytes: number;
}

export interface BrandStylePreset extends BrandScope {
  id: string;
  name: string;
  description: string;
  visualTokens: BrandStylePresetInputV1["visualTokens"];
  referenceItemIds: string[];
  isDefault: boolean;
  status: "active" | "archived";
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ManualVisualAssetsRepository {
  listBrandStylePresets(scope: BrandScope, includeArchived?: boolean): Promise<BrandStylePreset[]>;
  getBrandStylePreset(scope: BrandScope & { presetId: string }): Promise<BrandStylePreset | null>;
  createBrandStylePreset(scope: BrandScope & { actorUserId: string }, input: BrandStylePresetInputV1): Promise<BrandStylePreset>;
  updateBrandStylePreset(
    scope: BrandScope & { actorUserId: string; presetId: string; expectedRevision: number },
    input: BrandStylePresetInputV1,
  ): Promise<BrandStylePreset>;
  setDefaultBrandStylePreset(scope: BrandScope & { actorUserId: string; presetId: string }): Promise<BrandStylePreset>;
  archiveBrandStylePreset(scope: BrandScope & { actorUserId: string; presetId: string }): Promise<void>;
  listProductServiceImageAssets(scope: BrandScope & { productServiceId: string; versionId: string }): Promise<ProductServiceImageAsset[]>;
  confirmProductServiceImageAsset(
    scope: BrandScope & {
      actorUserId: string; productServiceId: string; versionId: string; sessionId: string;
      role: "hero" | "detail"; position: number;
    },
    upload: ConfirmedAssetLibraryUpload,
  ): Promise<ProductServiceImageAsset>;
  getProductServiceImageAsset(
    scope: BrandScope & { productServiceId: string; imageId: string },
  ): Promise<(ProductServiceImageAsset & { storagePath: string }) | null>;
  deleteProductServiceImageAsset(
    scope: BrandScope & { actorUserId: string; productServiceId: string; imageId: string },
  ): Promise<void>;
}

function parseJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}
function preset(row: Record<string, unknown>): BrandStylePreset {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), brandId: String(row.brand_id),
    name: String(row.name), description: String(row.description),
    visualTokens: parseJson(row.visual_tokens_json),
    referenceItemIds: parseJson<unknown[]>(row.reference_item_ids ?? []).map(String),
    isDefault: Boolean(row.is_default), status: row.status as BrandStylePreset["status"],
    revision: Number(row.revision), createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}
function productImage(row: Record<string, unknown>): ProductServiceImageAsset {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), brandId: String(row.brand_id),
    productServiceId: String(row.product_service_id), versionId: String(row.product_service_version_id),
    storageArtifactId: String(row.storage_artifact_id), role: row.role as ProductServiceImageAsset["role"],
    position: Number(row.position), storageUrl: String(row.storage_url),
    mimeType: String(row.mime_type), sizeBytes: Number(row.size_bytes),
  };
}

const selectPreset = `select preset.*,
  coalesce(jsonb_agg(reference.reference_item_id order by reference.position)
    filter(where reference.id is not null),'[]'::jsonb) reference_item_ids
from brand_style_presets preset
left join brand_style_preset_references reference
  on reference.preset_id=preset.id and reference.workspace_id=preset.workspace_id
 and reference.brand_id=preset.brand_id`;

async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await action(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }
}

async function member(
  client: Pick<PoolClient, "query">,
  scope: BrandScope & { actorUserId: string },
  admin = false,
): Promise<void> {
  const result = await client.query(
    `select member.role from workspace_members member
      where member.workspace_id=$1 and member.user_id=$2 and member.status='active'
        and exists(select 1 from brands where id=$3 and workspace_id=$1 and deleted_at is null)`,
    [scope.workspaceId, scope.actorUserId, scope.brandId],
  );
  if (!result.rowCount) throw new Error("brand_style_preset_access_forbidden");
  if (admin && !["owner", "admin"].includes(String(result.rows[0].role))) {
    throw new Error("brand_style_preset_admin_required");
  }
}

async function validateReferences(
  client: Pick<PoolClient, "query">,
  scope: BrandScope,
  referenceItemIds: string[],
): Promise<void> {
  const result = await client.query(
    `select item.id from reference_items item
      join storage_artifacts artifact
        on artifact.id=item.storage_artifact_id and artifact.workspace_id=item.workspace_id
       and artifact.brand_id=item.brand_id and artifact.deleted_at is null
       and artifact.public_url is not null and artifact.path is not null
       and artifact.checksum ~ '^[0-9a-f]{64}$'
       and lower(artifact.mime_type) in ('image/png','image/jpeg','image/webp')
      where item.id=any($1::uuid[]) and item.workspace_id=$2 and item.brand_id=$3
        and item.archived_at is null
      for share of item,artifact`,
    [referenceItemIds, scope.workspaceId, scope.brandId],
  );
  if (Number(result.rowCount ?? 0) !== referenceItemIds.length) {
    throw new Error("brand_style_preset_reference_invalid");
  }
}

export function createManualVisualAssetsRepository(pool: Pool): ManualVisualAssetsRepository {
  async function get(
    scope: BrandScope & { presetId: string },
    client: Pick<Pool, "query"> = pool,
  ): Promise<BrandStylePreset | null> {
    const result = await client.query(
      `${selectPreset}
       where preset.id=$1 and preset.workspace_id=$2 and preset.brand_id=$3
       group by preset.id`,
      [scope.presetId, scope.workspaceId, scope.brandId],
    );
    return result.rowCount ? preset(result.rows[0] as Record<string, unknown>) : null;
  }
  async function getProductImage(
    scope: BrandScope & { productServiceId: string; imageId: string },
    client: Pick<Pool, "query"> = pool,
  ): Promise<(ProductServiceImageAsset & { storagePath: string }) | null> {
    const result = await client.query(
      `select asset.* from product_service_assets asset
        where asset.id=$1 and asset.product_service_id=$2
          and asset.workspace_id=$3 and asset.brand_id=$4`,
      [scope.imageId, scope.productServiceId, scope.workspaceId, scope.brandId],
    );
    return result.rowCount
      ? { ...productImage(result.rows[0] as Record<string, unknown>), storagePath: String(result.rows[0].storage_path) }
      : null;
  }
  return {
    async listBrandStylePresets(scope, includeArchived = false) {
      const result = await pool.query(
        `${selectPreset}
         where preset.workspace_id=$1 and preset.brand_id=$2
           ${includeArchived ? "" : "and preset.status='active'"}
         group by preset.id order by preset.is_default desc,preset.updated_at desc`,
        [scope.workspaceId, scope.brandId],
      );
      return result.rows.map((row) => preset(row as Record<string, unknown>));
    },
    getBrandStylePreset: get,
    async createBrandStylePreset(scope, raw) {
      const input = parseBrandStylePresetInput(raw);
      return transaction(pool, async (client) => {
        await member(client, scope);
        await validateReferences(client, scope, input.referenceItemIds);
        if (input.isDefault) {
          await member(client, scope, true);
          await client.query(
            "update brand_style_presets set is_default=false where workspace_id=$1 and brand_id=$2 and is_default=true",
            [scope.workspaceId, scope.brandId],
          );
        }
        const created = await client.query(
          `insert into brand_style_presets(
             workspace_id,brand_id,name,description,visual_tokens_json,is_default,created_by_user_id
           ) values($1,$2,$3,$4,$5::jsonb,$6,$7) returning id`,
          [scope.workspaceId, scope.brandId, input.name, input.description,
            JSON.stringify(input.visualTokens), input.isDefault, scope.actorUserId],
        );
        const presetId = String(created.rows[0].id);
        for (const [index, referenceItemId] of input.referenceItemIds.entries()) {
          await client.query(
            `insert into brand_style_preset_references(
               workspace_id,brand_id,preset_id,reference_item_id,position
             ) values($1,$2,$3,$4,$5)`,
            [scope.workspaceId, scope.brandId, presetId, referenceItemId, index + 1],
          );
        }
        return (await get({ ...scope, presetId }, client))!;
      });
    },
    async updateBrandStylePreset(scope, raw) {
      const input = parseBrandStylePresetInput(raw);
      return transaction(pool, async (client) => {
        await member(client, scope);
        await validateReferences(client, scope, input.referenceItemIds);
        const locked = await client.query(
          `select id,is_default from brand_style_presets preset
            where preset.id=$1 and preset.workspace_id=$2 and preset.brand_id=$3
              and preset.revision=$4 and preset.status='active' for update`,
          [scope.presetId, scope.workspaceId, scope.brandId, scope.expectedRevision],
        );
        if (!locked.rowCount) throw new Error("brand_style_preset_version_conflict");
        if (Boolean(locked.rows[0].is_default) !== input.isDefault) {
          await member(client, scope, true);
        }
        if (input.isDefault) {
          await client.query(
            "update brand_style_presets set is_default=false where workspace_id=$1 and brand_id=$2 and id<>$3 and is_default=true",
            [scope.workspaceId, scope.brandId, scope.presetId],
          );
        }
        await client.query(
          `update brand_style_presets set name=$1,description=$2,visual_tokens_json=$3::jsonb,
             is_default=$4,revision=revision+1,updated_at=now()
            where id=$5 and workspace_id=$6 and brand_id=$7`,
          [input.name, input.description, JSON.stringify(input.visualTokens), input.isDefault,
            scope.presetId, scope.workspaceId, scope.brandId],
        );
        await client.query(
          "delete from brand_style_preset_references where preset_id=$1 and workspace_id=$2 and brand_id=$3",
          [scope.presetId, scope.workspaceId, scope.brandId],
        );
        for (const [index, referenceItemId] of input.referenceItemIds.entries()) {
          await client.query(
            `insert into brand_style_preset_references(workspace_id,brand_id,preset_id,reference_item_id,position)
             values($1,$2,$3,$4,$5)`,
            [scope.workspaceId, scope.brandId, scope.presetId, referenceItemId, index + 1],
          );
        }
        return (await get(scope, client))!;
      });
    },
    async setDefaultBrandStylePreset(scope) {
      return transaction(pool, async (client) => {
        await member(client, scope, true);
        const locked = await client.query(
          "select id from brand_style_presets where id=$1 and workspace_id=$2 and brand_id=$3 and status='active' for update",
          [scope.presetId, scope.workspaceId, scope.brandId],
        );
        if (!locked.rowCount) throw new Error("brand_style_preset_not_found");
        await client.query(
          "update brand_style_presets set is_default=(id=$3),revision=revision+case when is_default<>(id=$3) then 1 else 0 end where workspace_id=$1 and brand_id=$2 and status='active'",
          [scope.workspaceId, scope.brandId, scope.presetId],
        );
        return (await get(scope, client))!;
      });
    },
    async archiveBrandStylePreset(scope) {
      await transaction(pool, async (client) => {
        await member(client, scope, true);
        const updated = await client.query(
          `update brand_style_presets set status='archived',is_default=false,revision=revision+1,updated_at=now()
            where id=$1 and workspace_id=$2 and brand_id=$3 and status='active'`,
          [scope.presetId, scope.workspaceId, scope.brandId],
        );
        if (!updated.rowCount) throw new Error("brand_style_preset_not_found");
      });
    },
    async listProductServiceImageAssets(scope) {
      const result = await pool.query(
        `select asset.* from product_service_assets asset
          where asset.product_service_id=$1 and asset.product_service_version_id=$2
            and asset.workspace_id=$3 and asset.brand_id=$4
          order by asset.position,asset.id`,
        [scope.productServiceId, scope.versionId, scope.workspaceId, scope.brandId],
      );
      return result.rows.map((row) => productImage(row as Record<string, unknown>));
    },
    async confirmProductServiceImageAsset(scope, upload) {
      return transaction(pool, async (client) => {
        await member(client, scope);
        const session = await client.query(
          `select * from reference_upload_sessions
            where id=$1 and workspace_id=$2 and brand_id=$3 for update`,
          [scope.sessionId, scope.workspaceId, scope.brandId],
        );
        if (!session.rowCount || String(session.rows[0].created_by_user_id) !== scope.actorUserId) {
          throw new Error("asset_library_upload_session_not_found");
        }
        const expectedPrefix = `brands/${scope.brandId}/asset-library/products/${scope.productServiceId}/${scope.sessionId}/`;
        if (String(session.rows[0].storage_path_prefix) !== expectedPrefix
          || !upload.storagePath.startsWith(expectedPrefix)
          || session.rows[0].cancelled_at
          || session.rows[0].confirmed_at
          || new Date(session.rows[0].expires_at as string).getTime() <= Date.now()) {
          throw new Error("asset_library_upload_path_mismatch");
        }
        const version = await client.query(
          `select version.id from product_service_versions version
            join product_services product on product.id=version.product_service_id
             and product.workspace_id=version.workspace_id and product.brand_id=version.brand_id
            where product.id=$1 and version.id=$2 and version.workspace_id=$3 and version.brand_id=$4
              and product.status='active' and version.status in ('draft','approved') for update`,
          [scope.productServiceId, scope.versionId, scope.workspaceId, scope.brandId],
        );
        if (!version.rowCount) throw new Error("product_service_version_not_found");
        const existing = await client.query(
          `select role,position from product_service_assets
            where product_service_version_id=$1 and workspace_id=$2 and brand_id=$3 for update`,
          [scope.versionId, scope.workspaceId, scope.brandId],
        );
        if (existing.rows.length >= 5 || existing.rows.some((row) => Number(row.position) === scope.position)
          || (scope.role === "hero" && existing.rows.some((row) => row.role === "hero"))
          || (scope.role === "detail" && !existing.rows.some((row) => row.role === "hero"))) {
          throw new Error("product_service_image_contract_invalid");
        }
        const artifact = await client.query(
          `insert into storage_artifacts(
             workspace_id,brand_id,artifact_type,bucket,path,public_url,mime_type,byte_size,checksum,created_by_user_id
           ) values($1,$2,'brand_asset','vercel-blob',$3,$4,$5,$6,$7,$8) returning id`,
          [scope.workspaceId, scope.brandId, upload.storagePath, upload.storageUrl, upload.mimeType,
            upload.sizeBytes, upload.checksum, scope.actorUserId],
        );
        const inserted = await client.query(
          `insert into product_service_assets(
             workspace_id,brand_id,product_service_id,product_service_version_id,storage_artifact_id,
             storage_url,storage_path,mime_type,size_bytes,checksum,role,position,created_by_user_id
           ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
          [scope.workspaceId, scope.brandId, scope.productServiceId, scope.versionId, artifact.rows[0].id,
            upload.storageUrl, upload.storagePath, upload.mimeType, upload.sizeBytes, upload.checksum,
            scope.role, scope.position, scope.actorUserId],
        );
        await client.query(
          "delete from reference_upload_sessions where id=$1 and workspace_id=$2 and brand_id=$3",
          [scope.sessionId, scope.workspaceId, scope.brandId],
        );
        return productImage(inserted.rows[0] as Record<string, unknown>);
      });
    },
    getProductServiceImageAsset: getProductImage,
    async deleteProductServiceImageAsset(scope) {
      await transaction(pool, async (client) => {
        await member(client, scope);
        const locked = await client.query(
          `select asset.id,asset.storage_artifact_id,asset.product_service_version_id,asset.role,asset.position
             from product_service_assets asset
            where asset.id=$1 and asset.product_service_id=$2
              and asset.workspace_id=$3 and asset.brand_id=$4 for update`,
          [scope.imageId, scope.productServiceId, scope.workspaceId, scope.brandId],
        );
        if (!locked.rowCount) throw new Error("product_service_image_not_found");
        const siblings = await client.query(
          `select asset.id,asset.role,asset.position from product_service_assets asset
            where asset.product_service_version_id=$1 and asset.workspace_id=$2 and asset.brand_id=$3
            order by asset.position,asset.id for update`,
          [locked.rows[0].product_service_version_id, scope.workspaceId, scope.brandId],
        );
        await client.query(
          `delete from product_service_assets where id=$1 and product_service_id=$2
            and workspace_id=$3 and brand_id=$4`,
          [scope.imageId, scope.productServiceId, scope.workspaceId, scope.brandId],
        );
        const remaining = siblings.rows.filter((asset) => String(asset.id) !== scope.imageId);
        for (const [offset, asset] of remaining.entries()) {
          const role = locked.rows[0].role === "hero"
            ? (offset === 0 ? "hero" : "detail")
            : String(asset.role);
          await client.query(
            `update product_service_assets set role=$1,position=$2
              where id=$3 and workspace_id=$4 and brand_id=$5`,
            [role, offset + 1, asset.id, scope.workspaceId, scope.brandId],
          );
        }
        await client.query(
          "update storage_artifacts set deleted_at=now() where id=$1 and workspace_id=$2 and brand_id=$3",
          [locked.rows[0].storage_artifact_id, scope.workspaceId, scope.brandId],
        );
      });
    },
  };
}
