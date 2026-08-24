import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProductImageImportRepository } from "./productImageImportRepository.js";

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

const workspaceId = "10000000-0000-4000-8000-000000000001";
const brandId = "20000000-0000-4000-8000-000000000001";
const productId = "30000000-0000-4000-8000-000000000001";
const versionId = "40000000-0000-4000-8000-000000000001";
const draftVersionId = "40000000-0000-4000-8000-000000000002";
const jobId = "50000000-0000-4000-8000-000000000001";

describe("product image import repository", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = await PGlite.create({ extensions: { pgcrypto } });
    await database.exec(`
      create table product_services(
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,kind text not null,status text not null
      );
      create table product_service_versions(
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,product_service_id uuid not null,
        version integer not null,status text not null
      );
      create table product_service_image_import_jobs(
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,product_service_id uuid not null,
        product_service_version_id uuid not null,requested_by_user_id uuid null,source_urls_json jsonb not null,
        status text not null,attempt_count integer not null default 0,available_at timestamptz not null default now(),
        lease_owner text null,lease_token uuid null,lease_expires_at timestamptz null,
        selection_audit_json jsonb null,error_code text null,created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),completed_at timestamptz null
      );
      create table storage_artifacts(
        id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
        artifact_type text not null,bucket text not null,path text not null,public_url text not null,
        mime_type text not null,byte_size bigint not null,checksum text not null,created_by_user_id uuid null,
        deleted_at timestamptz null,unique(workspace_id,brand_id,path)
      );
      create table product_service_assets(
        id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
        product_service_id uuid not null,product_service_version_id uuid not null,storage_artifact_id uuid not null,
        storage_url text not null,storage_path text not null,mime_type text not null,size_bytes bigint not null,
        checksum text not null,role text not null,position integer not null,created_by_user_id uuid null,
        unique(product_service_version_id,position)
      );
      insert into product_services values ('${productId}','${workspaceId}','${brandId}','product','active');
      insert into product_service_versions values ('${versionId}','${workspaceId}','${brandId}','${productId}',1,'approved');
      insert into product_service_image_import_jobs(
        id,workspace_id,brand_id,product_service_id,product_service_version_id,source_urls_json,status
      ) values (
        '${jobId}','${workspaceId}','${brandId}','${productId}','${versionId}',
        '["https://shop.example/product"]','pending'
      );
    `);
  });

  afterEach(async () => database.close());

  it("claims a product job once with a bounded lease and exact frozen URLs", async () => {
    const repository = createProductImageImportRepository(pool(database));
    const claim = await repository.claimProductImageImportJob({ workerId: "image-worker-1", leaseSeconds: 180 });
    expect(claim).toMatchObject({
      id: jobId,
      workspaceId,
      brandId,
      productServiceId: productId,
      versionId,
      sourceUrls: ["https://shop.example/product"],
      attemptCount: 1,
      remainingSlots: 5,
    });
    expect(claim?.leaseToken).toMatch(/^[0-9a-f-]{36}$/);
    await expect(repository.claimProductImageImportJob({ workerId: "image-worker-2", leaseSeconds: 180 })).resolves.toBeNull();
  });

  it("returns scoped import status and explicitly retries a failed onboarding import", async () => {
    const repository = createProductImageImportRepository(pool(database));
    await expect(repository.getProductImageImportStatus({ workspaceId, brandId, productServiceId: productId, versionId }))
      .resolves.toMatchObject({ status: "pending", attemptCount: 0 });
    await database.query(
      "update product_service_image_import_jobs set status='failed',attempt_count=3,error_code='fetch_failed',completed_at=now() where id=$1",
      [jobId],
    );
    await expect(repository.retryProductImageImportJob({ workspaceId, brandId, productServiceId: productId, versionId }))
      .resolves.toMatchObject({ status: "pending", attemptCount: 0, errorCode: null });
  });

  it("does not claim a job if the bound item is a service", async () => {
    await database.query("update product_services set kind='service' where id=$1", [productId]);
    const repository = createProductImageImportRepository(pool(database));
    await expect(repository.claimProductImageImportJob({ workerId: "image-worker-1", leaseSeconds: 180 })).resolves.toBeNull();
    await expect(repository.getProductImageImportStatus({ workspaceId, brandId, productServiceId: productId, versionId }))
      .resolves.toBeNull();
    await database.query(
      "update product_service_image_import_jobs set status='failed',attempt_count=3,error_code='fetch_failed',completed_at=now() where id=$1",
      [jobId],
    );
    await expect(repository.retryProductImageImportJob({ workspaceId, brandId, productServiceId: productId, versionId }))
      .rejects.toThrow("product_image_import_not_retryable");
  });

  it("heartbeats and completes only with the current lease", async () => {
    const repository = createProductImageImportRepository(pool(database));
    const claim = await repository.claimProductImageImportJob({ workerId: "image-worker-1", leaseSeconds: 180 });
    await expect(repository.heartbeatProductImageImportJob({
      jobId, workerId: "other", leaseToken: claim!.leaseToken, leaseSeconds: 180,
    })).resolves.toBe(false);
    await expect(repository.heartbeatProductImageImportJob({
      jobId, workerId: "image-worker-1", leaseToken: claim!.leaseToken, leaseSeconds: 180,
    })).resolves.toBe(true);
    await expect(repository.completeProductImageImportJob({
      jobId, workerId: "image-worker-1", leaseToken: claim!.leaseToken,
      selectionAudit: { candidates: [], selected: [], excluded: [] },
      images: [],
    })).resolves.toEqual({ completed: true, retainedStoragePaths: [] });
    const state = await database.query<{ status: string }>("select status from product_service_image_import_jobs where id=$1", [jobId]);
    expect(state.rows[0]?.status).toBe("succeeded");
  });

  it("atomically registers selected URL images without replacing an existing hero", async () => {
    await database.exec(`
      insert into storage_artifacts(
        workspace_id,brand_id,artifact_type,bucket,path,public_url,mime_type,byte_size,checksum
      ) values(
        '${workspaceId}','${brandId}','brand_asset','vercel-blob','brands/existing.jpg',
        'https://blob.example/existing.jpg','image/jpeg',1234,'${"a".repeat(64)}'
      );
      insert into product_service_assets(
        workspace_id,brand_id,product_service_id,product_service_version_id,storage_artifact_id,
        storage_url,storage_path,mime_type,size_bytes,checksum,role,position
      ) select '${workspaceId}','${brandId}','${productId}','${versionId}',id,
        public_url,path,mime_type,byte_size,checksum,'hero',1 from storage_artifacts;
    `);
    const repository = createProductImageImportRepository(pool(database));
    const claimed = await repository.claimProductImageImportJob({ workerId: "image-worker-1", leaseSeconds: 180 });
    await expect(repository.completeProductImageImportJob({
      jobId, workerId: "image-worker-1", leaseToken: claimed!.leaseToken,
      selectionAudit: { selected: 2 },
      images: [
        {
          storageUrl: `https://test.public.blob.vercel-storage.com/brands/${brandId}/asset-library/products/${productId}/imports/${jobId}/b.jpg`, storagePath: `brands/${brandId}/asset-library/products/${productId}/imports/${jobId}/b.jpg`,
          mimeType: "image/jpeg", sizeBytes: 2048, checksum: "b".repeat(64), sourceUrl: "https://shop.example/image-1.jpg",
        },
        {
          storageUrl: `https://test.public.blob.vercel-storage.com/brands/${brandId}/asset-library/products/${productId}/imports/${jobId}/c.webp`, storagePath: `brands/${brandId}/asset-library/products/${productId}/imports/${jobId}/c.webp`,
          mimeType: "image/webp", sizeBytes: 4096, checksum: "c".repeat(64), sourceUrl: "https://shop.example/image-2.webp",
        },
      ],
    })).resolves.toEqual({
      completed: true,
      retainedStoragePaths: [
        `brands/${brandId}/asset-library/products/${productId}/imports/${jobId}/b.jpg`,
        `brands/${brandId}/asset-library/products/${productId}/imports/${jobId}/c.webp`,
      ],
    });
    const assets = await database.query<{ role: string; position: number; checksum: string }>(
      "select role,position,checksum from product_service_assets order by position",
    );
    expect(assets.rows).toEqual([
      { role: "hero", position: 1, checksum: "a".repeat(64) },
      { role: "detail", position: 2, checksum: "b".repeat(64) },
      { role: "detail", position: 3, checksum: "c".repeat(64) },
    ]);
    const audit = await database.query<{ selection_audit_json: { existingCount: number; registeredCount: number; finalCount: number } }>(
      "select selection_audit_json from product_service_image_import_jobs where id=$1",
      [jobId],
    );
    expect(audit.rows[0]?.selection_audit_json).toMatchObject({ existingCount: 1, registeredCount: 2, finalCount: 3 });
  });

  it("also links newly imported assets into an already-open draft without duplicating blob storage", async () => {
    await database.query(
      "insert into product_service_versions values($1,$2,$3,$4,2,'draft')",
      [draftVersionId, workspaceId, brandId, productId],
    );
    const repository = createProductImageImportRepository(pool(database));
    const claimed = await repository.claimProductImageImportJob({ workerId: "image-worker-1", leaseSeconds: 180 });
    const storagePath = `brands/${brandId}/asset-library/products/${productId}/imports/${jobId}/draft-safe.jpg`;
    await expect(repository.completeProductImageImportJob({
      jobId, workerId: "image-worker-1", leaseToken: claimed!.leaseToken,
      selectionAudit: { selected: 1 },
      images: [{
        storageUrl: `https://test.public.blob.vercel-storage.com/${storagePath}`,
        storagePath,
        mimeType: "image/jpeg",
        sizeBytes: 2048,
        checksum: "d".repeat(64),
        sourceUrl: "https://shop.example/image.jpg",
      }],
    })).resolves.toEqual({ completed: true, retainedStoragePaths: [storagePath] });

    const links = await database.query<{ product_service_version_id: string; storage_artifact_id: string }>(
      "select product_service_version_id,storage_artifact_id from product_service_assets order by product_service_version_id",
    );
    expect(links.rows).toHaveLength(2);
    expect(new Set(links.rows.map((row) => row.product_service_version_id))).toEqual(new Set([versionId, draftVersionId]));
    expect(new Set(links.rows.map((row) => row.storage_artifact_id)).size).toBe(1);
    const audit = await database.query<{ selection_audit_json: { draftRegisteredCount: number } }>(
      "select selection_audit_json from product_service_image_import_jobs where id=$1",
      [jobId],
    );
    expect(audit.rows[0]?.selection_audit_json).toMatchObject({ draftRegisteredCount: 1 });
  });
});
