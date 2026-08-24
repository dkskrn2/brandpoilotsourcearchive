import type { Pool, PoolClient } from "pg";
import { lockProductServiceAssetVersion } from "./productServiceAssetLock.js";

export interface ProductImageImportClaim {
  id: string;
  workspaceId: string;
  brandId: string;
  productServiceId: string;
  versionId: string;
  requestedByUserId: string | null;
  sourceUrls: string[];
  attemptCount: number;
  remainingSlots: number;
  leaseToken: string;
}

export interface ProductImageImportAsset {
  storageUrl: string;
  storagePath: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  sizeBytes: number;
  checksum: string;
  sourceUrl: string;
}

export interface ProductImageImportRepository {
  getProductImageImportStatus(input: {
    workspaceId: string; brandId: string; productServiceId: string; versionId: string;
  }): Promise<ProductImageImportStatus | null>;
  retryProductImageImportJob(input: {
    workspaceId: string; brandId: string; productServiceId: string; versionId: string;
  }): Promise<ProductImageImportStatus>;
  claimProductImageImportJob(input: { workerId: string; leaseSeconds: number }): Promise<ProductImageImportClaim | null>;
  heartbeatProductImageImportJob(input: {
    jobId: string; workerId: string; leaseToken: string; leaseSeconds: number;
  }): Promise<boolean>;
  completeProductImageImportJob(input: {
    jobId: string; workerId: string; leaseToken: string; selectionAudit: Record<string, unknown>;
    images: ProductImageImportAsset[];
  }): Promise<{ completed: boolean; retainedStoragePaths: string[] }>;
  failProductImageImportJob(input: {
    jobId: string; workerId: string; leaseToken: string; errorCode: string;
  }): Promise<"retry" | "failed" | "lease_lost">;
}

export interface ProductImageImportStatus {
  status: "pending" | "processing" | "succeeded" | "failed";
  attemptCount: number;
  errorCode: string | null;
  updatedAt: string;
}

function leaseSeconds(value: number): number {
  return Number.isFinite(value) ? Math.max(30, Math.min(600, Math.floor(value))) : 180;
}

function parseSourceUrls(value: unknown): string[] {
  const source = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(source) || source.length < 1 || source.length > 5) {
    throw new Error("product_image_import_sources_invalid");
  }
  return source.map((entry) => {
    if (typeof entry !== "string") throw new Error("product_image_import_sources_invalid");
    const url = new URL(entry);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("product_image_import_sources_invalid");
    }
    url.hash = "";
    return url.toString();
  });
}

function claim(row: Record<string, unknown>): ProductImageImportClaim {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    brandId: String(row.brand_id),
    productServiceId: String(row.product_service_id),
    versionId: String(row.product_service_version_id),
    requestedByUserId: row.requested_by_user_id ? String(row.requested_by_user_id) : null,
    sourceUrls: parseSourceUrls(row.source_urls_json),
    attemptCount: Number(row.attempt_count),
    remainingSlots: Number(row.remaining_slots),
    leaseToken: String(row.lease_token),
  };
}

function status(row: Record<string, unknown>): ProductImageImportStatus {
  return {
    status: String(row.status) as ProductImageImportStatus["status"],
    attemptCount: Number(row.attempt_count),
    errorCode: row.error_code ? String(row.error_code) : null,
    updatedAt: new Date(row.updated_at as string | Date).toISOString(),
  };
}

const imageMimeTypes = new Set<ProductImageImportAsset["mimeType"]>(["image/png", "image/jpeg", "image/webp"]);

function importedImage(value: ProductImageImportAsset, prefix: string): ProductImageImportAsset {
  if (!value || typeof value !== "object") throw new Error("product_image_import_asset_invalid");
  const keys = ["storageUrl", "storagePath", "mimeType", "sizeBytes", "checksum", "sourceUrl"];
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error("product_image_import_asset_invalid");
  }
  let storageUrl: URL;
  let sourceUrl: URL;
  try {
    storageUrl = new URL(value.storageUrl);
    sourceUrl = new URL(value.sourceUrl);
  } catch {
    throw new Error("product_image_import_asset_invalid");
  }
  let storageUrlPath: string;
  try { storageUrlPath = decodeURIComponent(storageUrl.pathname).replace(/^\/+/, ""); }
  catch { throw new Error("product_image_import_asset_invalid"); }
  if (storageUrl.protocol !== "https:" || storageUrl.username || storageUrl.password
    || !(storageUrl.hostname === "blob.vercel-storage.com" || storageUrl.hostname.endsWith(".blob.vercel-storage.com"))
    || storageUrl.port || storageUrl.search || storageUrl.hash || storageUrlPath !== value.storagePath
    || sourceUrl.protocol !== "https:" || sourceUrl.username || sourceUrl.password
    || !value.storagePath.startsWith(prefix)
    || value.storagePath.includes("\\") || value.storagePath.split("/").some((part) => !part || part === "." || part === "..")
    || !imageMimeTypes.has(value.mimeType)
    || !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 1 || value.sizeBytes > 5 * 1024 * 1024
    || !/^[0-9a-f]{64}$/.test(value.checksum)) {
    throw new Error("product_image_import_asset_invalid");
  }
  storageUrl.hash = "";
  sourceUrl.hash = "";
  return { ...value, storageUrl: storageUrl.toString(), sourceUrl: sourceUrl.toString() };
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
  } finally {
    client.release();
  }
}

export function createProductImageImportRepository(pool: Pool): ProductImageImportRepository {
  return {
    async getProductImageImportStatus(input) {
      const result = await pool.query(
        `select job.status,job.attempt_count,job.error_code,job.updated_at
           from product_service_image_import_jobs job
           join product_services item on item.id=job.product_service_id
            and item.workspace_id=job.workspace_id and item.brand_id=job.brand_id
           join product_service_versions version on version.id=job.product_service_version_id
            and version.product_service_id=item.id and version.workspace_id=item.workspace_id
            and version.brand_id=item.brand_id
          where job.workspace_id=$1 and job.brand_id=$2 and job.product_service_id=$3
            and job.product_service_version_id=$4 and item.kind='product' and item.status='active'
            and version.status in ('approved','draft')`,
        [input.workspaceId, input.brandId, input.productServiceId, input.versionId],
      );
      return result.rowCount ? status(result.rows[0] as Record<string, unknown>) : null;
    },
    async retryProductImageImportJob(input) {
      const result = await pool.query(
        `update product_service_image_import_jobs job
            set status='pending',attempt_count=0,available_at=now(),error_code=null,
                lease_owner=null,lease_token=null,lease_expires_at=null,completed_at=null,updated_at=now()
           from product_services item,product_service_versions version
          where job.workspace_id=$1 and job.brand_id=$2 and job.product_service_id=$3
            and job.product_service_version_id=$4 and job.status='failed'
            and item.id=job.product_service_id and item.workspace_id=job.workspace_id
            and item.brand_id=job.brand_id and item.kind='product' and item.status='active'
            and version.id=job.product_service_version_id and version.product_service_id=item.id
            and version.workspace_id=item.workspace_id and version.brand_id=item.brand_id
            and version.status in ('approved','draft')
        returning job.status,job.attempt_count,job.error_code,job.updated_at`,
        [input.workspaceId, input.brandId, input.productServiceId, input.versionId],
      );
      if (!result.rowCount) throw new Error("product_image_import_not_retryable");
      return status(result.rows[0] as Record<string, unknown>);
    },
    async claimProductImageImportJob(input) {
      return transaction(pool, async (client) => {
        await client.query(
          `update product_service_image_import_jobs
              set status=case when attempt_count>=3 then 'failed' else 'pending' end,
                  available_at=case when attempt_count>=3 then available_at else now() end,
                  completed_at=case when attempt_count>=3 then now() else null end,
                  error_code=coalesce(error_code,'product_image_import_lease_expired'),
                  lease_owner=null,lease_token=null,lease_expires_at=null,updated_at=now()
            where status='processing' and lease_expires_at<=now()`,
        );
        const result = await client.query(
          `with candidate as (
             select job.id
               from product_service_image_import_jobs job
               join product_services item
                 on item.id=job.product_service_id and item.workspace_id=job.workspace_id
                and item.brand_id=job.brand_id and item.kind='product' and item.status='active'
               join product_service_versions version
                 on version.id=job.product_service_version_id
                and version.product_service_id=item.id and version.workspace_id=item.workspace_id
                and version.brand_id=item.brand_id and version.status in ('approved','draft')
              where job.status='pending' and job.attempt_count<3 and job.available_at<=now()
              order by job.available_at,job.created_at,job.id
              for update of job skip locked
              limit 1
           )
           update product_service_image_import_jobs job
              set status='processing',attempt_count=job.attempt_count+1,
                  lease_owner=$1,lease_token=gen_random_uuid(),
                  lease_expires_at=now()+($2::integer*interval '1 second'),
                  error_code=null,updated_at=now()
             from candidate where job.id=candidate.id
           returning job.*,
             greatest(0,5-(select count(*)::integer from product_service_assets asset
               where asset.product_service_version_id=job.product_service_version_id
                 and asset.workspace_id=job.workspace_id and asset.brand_id=job.brand_id)) as remaining_slots`,
          [input.workerId, leaseSeconds(input.leaseSeconds)],
        );
        return result.rowCount ? claim(result.rows[0] as Record<string, unknown>) : null;
      });
    },
    async heartbeatProductImageImportJob(input) {
      const result = await pool.query(
        `update product_service_image_import_jobs
            set lease_expires_at=now()+($4::integer*interval '1 second'),updated_at=now()
          where id=$1 and status='processing' and lease_owner=$2 and lease_token=$3::uuid
            and lease_expires_at>now()`,
        [input.jobId, input.workerId, input.leaseToken, leaseSeconds(input.leaseSeconds)],
      );
      return Number(result.rowCount ?? 0) === 1;
    },
    async completeProductImageImportJob(input) {
      if (!Array.isArray(input.images) || input.images.length > 5) {
        throw new Error("product_image_import_asset_invalid");
      }
      return transaction(pool, async (client) => {
        const job = await client.query(
          `select * from product_service_image_import_jobs
            where id=$1 and status='processing' and lease_owner=$2 and lease_token=$3::uuid
              and lease_expires_at>now() for update`,
          [input.jobId, input.workerId, input.leaseToken],
        );
        if (!job.rowCount) return { completed: false, retainedStoragePaths: [] };
        const row = job.rows[0] as Record<string, unknown>;
        const workspaceId = String(row.workspace_id);
        const brandId = String(row.brand_id);
        const productServiceId = String(row.product_service_id);
        const versionId = String(row.product_service_version_id);
        await lockProductServiceAssetVersion(client, versionId);
        const prefix = `brands/${brandId}/asset-library/products/${productServiceId}/imports/${input.jobId}/`;
        const images = input.images.map((image) => importedImage(image, prefix));

        const version = await client.query(
          `select version.id
             from product_service_versions version
             join product_services item on item.id=version.product_service_id
              and item.workspace_id=version.workspace_id and item.brand_id=version.brand_id
            where version.id=$1 and version.product_service_id=$2 and version.workspace_id=$3 and version.brand_id=$4
              and version.status in ('approved','draft') and item.kind='product' and item.status='active'
            `,
          [versionId, productServiceId, workspaceId, brandId],
        );
        if (!version.rowCount) throw new Error("product_image_import_target_invalid");
        const existing = await client.query(
          `select checksum,storage_path,role,position from product_service_assets
            where product_service_version_id=$1 and workspace_id=$2 and brand_id=$3
            order by position,id`,
          [versionId, workspaceId, brandId],
        );
        const existingCount = existing.rows.length;
        let nextPosition = existing.rows.reduce((max, asset) => Math.max(max, Number(asset.position)), 0) + 1;
        let hasHero = existing.rows.some((asset) => asset.role === "hero");
        const knownChecksums = new Set(existing.rows.map((asset) => String(asset.checksum)));
        const knownPaths = new Set(existing.rows.map((asset) => String(asset.storage_path)));
        const retainedStoragePaths: string[] = [];
        const registeredAssets: Array<ProductImageImportAsset & { storageArtifactId: string }> = [];
        let count = existing.rows.length;
        for (const image of images) {
          if (count >= 5) break;
          if (knownChecksums.has(image.checksum) || knownPaths.has(image.storagePath)) continue;
          const artifact = await client.query(
            `insert into storage_artifacts(
               workspace_id,brand_id,artifact_type,bucket,path,public_url,mime_type,byte_size,checksum,created_by_user_id
             ) values($1,$2,'brand_asset','vercel-blob',$3,$4,$5,$6,$7,$8) returning id`,
            [workspaceId, brandId, image.storagePath, image.storageUrl, image.mimeType, image.sizeBytes,
              image.checksum, row.requested_by_user_id ?? null],
          );
          const role = hasHero ? "detail" : "hero";
          await client.query(
            `insert into product_service_assets(
               workspace_id,brand_id,product_service_id,product_service_version_id,storage_artifact_id,
               storage_url,storage_path,mime_type,size_bytes,checksum,role,position,created_by_user_id
             ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [workspaceId, brandId, productServiceId, versionId, artifact.rows[0].id,
              image.storageUrl, image.storagePath, image.mimeType, image.sizeBytes, image.checksum,
              role, nextPosition, row.requested_by_user_id ?? null],
          );
          knownChecksums.add(image.checksum);
          knownPaths.add(image.storagePath);
          retainedStoragePaths.push(image.storagePath);
          registeredAssets.push({ ...image, storageArtifactId: String(artifact.rows[0].id) });
          hasHero = true;
          nextPosition += 1;
          count += 1;
        }
        let draftRegisteredCount = 0;
        const draft = await client.query(
          `select version.id
             from product_service_versions version
            where version.product_service_id=$1 and version.workspace_id=$2 and version.brand_id=$3
              and version.status='draft' and version.id<>$4
            order by version.version desc limit 1`,
          [productServiceId, workspaceId, brandId, versionId],
        );
        if (draft.rowCount && registeredAssets.length) {
          const draftVersionId = String(draft.rows[0].id);
          await lockProductServiceAssetVersion(client, draftVersionId);
          const draftAssets = await client.query(
            `select checksum,storage_path,role,position from product_service_assets
              where product_service_version_id=$1 and workspace_id=$2 and brand_id=$3
              order by position,id`,
            [draftVersionId, workspaceId, brandId],
          );
          const draftChecksums = new Set(draftAssets.rows.map((asset) => String(asset.checksum)));
          const draftPaths = new Set(draftAssets.rows.map((asset) => String(asset.storage_path)));
          let draftPosition = draftAssets.rows.reduce((max, asset) => Math.max(max, Number(asset.position)), 0) + 1;
          let draftHasHero = draftAssets.rows.some((asset) => asset.role === "hero");
          let draftCount = draftAssets.rows.length;
          for (const image of registeredAssets) {
            if (draftCount >= 5) break;
            if (draftChecksums.has(image.checksum) || draftPaths.has(image.storagePath)) continue;
            const role = draftHasHero ? "detail" : "hero";
            await client.query(
              `insert into product_service_assets(
                 workspace_id,brand_id,product_service_id,product_service_version_id,storage_artifact_id,
                 storage_url,storage_path,mime_type,size_bytes,checksum,role,position,created_by_user_id
               ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
              [workspaceId, brandId, productServiceId, draftVersionId, image.storageArtifactId,
                image.storageUrl, image.storagePath, image.mimeType, image.sizeBytes, image.checksum,
                role, draftPosition, row.requested_by_user_id ?? null],
            );
            draftChecksums.add(image.checksum);
            draftPaths.add(image.storagePath);
            draftHasHero = true;
            draftPosition += 1;
            draftCount += 1;
            draftRegisteredCount += 1;
          }
        }
        await client.query(
          `update product_service_image_import_jobs
              set status='succeeded',selection_audit_json=$2::jsonb,error_code=null,
                  lease_owner=null,lease_token=null,lease_expires_at=null,
                  completed_at=now(),updated_at=now()
            where id=$1`,
          [input.jobId, JSON.stringify({
            ...input.selectionAudit,
            existingCount,
            registeredCount: count - existingCount,
            draftRegisteredCount,
            finalCount: count,
          })],
        );
        return { completed: true, retainedStoragePaths };
      });
    },
    async failProductImageImportJob(input) {
      return transaction(pool, async (client) => {
        const locked = await client.query(
          `select attempt_count from product_service_image_import_jobs
            where id=$1 and status='processing' and lease_owner=$2 and lease_token=$3::uuid
              and lease_expires_at>now() for update`,
          [input.jobId, input.workerId, input.leaseToken],
        );
        if (!locked.rowCount) return "lease_lost" as const;
        const terminal = Number(locked.rows[0].attempt_count) >= 3;
        await client.query(
          `update product_service_image_import_jobs
              set status=$4,available_at=case when $4='pending' then now()+interval '1 minute' else available_at end,
                  error_code=$5,lease_owner=null,lease_token=null,lease_expires_at=null,
                  completed_at=case when $4='failed' then now() else null end,updated_at=now()
            where id=$1 and lease_owner=$2 and lease_token=$3::uuid`,
          [input.jobId, input.workerId, input.leaseToken, terminal ? "failed" : "pending", input.errorCode.slice(0, 200)],
        );
        return terminal ? "failed" as const : "retry" as const;
      });
    },
  };
}
