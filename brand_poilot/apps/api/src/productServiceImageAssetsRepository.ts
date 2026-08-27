import type { Pool, PoolClient } from "pg";
import { lockProductServiceAssetVersion } from "./productServiceAssetLock.js";
import type { BrandScope } from "./brandCoreRepository.js";
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

export interface ProductServiceImageAssetsRepository {
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
  ): Promise<{ deleteBlob: boolean }>;
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
  if (!result.rowCount) throw new Error("asset_library_access_forbidden");
  if (admin && !["owner", "admin"].includes(String(result.rows[0].role))) {
    throw new Error("asset_library_admin_required");
  }
}

export function createProductServiceImageAssetsRepository(pool: Pool): ProductServiceImageAssetsRepository {
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
        await lockProductServiceAssetVersion(client, scope.versionId);
        const version = await client.query(
          `select version.id from product_service_versions version
            join product_services product on product.id=version.product_service_id
             and product.workspace_id=version.workspace_id and product.brand_id=version.brand_id
            where product.id=$1 and version.id=$2 and version.workspace_id=$3 and version.brand_id=$4
              and product.status='active' and version.status in ('draft','approved')`,
          [scope.productServiceId, scope.versionId, scope.workspaceId, scope.brandId],
        );
        if (!version.rowCount) throw new Error("product_service_version_not_found");
        const existing = await client.query(
          `select role,position from product_service_assets
            where product_service_version_id=$1 and workspace_id=$2 and brand_id=$3`,
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
      return transaction(pool, async (client) => {
        await member(client, scope);
        const target = await client.query(
          `select asset.product_service_version_id
             from product_service_assets asset
            where asset.id=$1 and asset.product_service_id=$2
              and asset.workspace_id=$3 and asset.brand_id=$4`,
          [scope.imageId, scope.productServiceId, scope.workspaceId, scope.brandId],
        );
        if (!target.rowCount) throw new Error("product_service_image_not_found");
        await lockProductServiceAssetVersion(client, String(target.rows[0].product_service_version_id));
        const locked = await client.query(
          `select asset.id,asset.storage_artifact_id,asset.product_service_version_id,asset.role,asset.position
             from product_service_assets asset
            where asset.id=$1 and asset.product_service_id=$2
              and asset.workspace_id=$3 and asset.brand_id=$4`,
          [scope.imageId, scope.productServiceId, scope.workspaceId, scope.brandId],
        );
        if (!locked.rowCount) throw new Error("product_service_image_not_found");
        const siblings = await client.query(
          `select asset.id,asset.role,asset.position from product_service_assets asset
            where asset.product_service_version_id=$1 and asset.workspace_id=$2 and asset.brand_id=$3
            order by asset.position,asset.id`,
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
        const retired = await client.query(
          `update storage_artifacts artifact set deleted_at=now()
            where artifact.id=$1 and artifact.workspace_id=$2 and artifact.brand_id=$3
              and not exists(
                select 1 from product_service_assets remaining
                 where remaining.storage_artifact_id=artifact.id
                   and remaining.workspace_id=artifact.workspace_id
                   and remaining.brand_id=artifact.brand_id
              )`,
          [locked.rows[0].storage_artifact_id, scope.workspaceId, scope.brandId],
        );
        return { deleteBlob: Number(retired.rowCount ?? 0) === 1 };
      });
    },
  };
}
