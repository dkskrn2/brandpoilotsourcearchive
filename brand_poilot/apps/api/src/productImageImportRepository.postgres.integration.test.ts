import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProductImageImportRepository } from "./productImageImportRepository.js";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  brand: "20000000-0000-4000-8000-000000000001",
  product: "30000000-0000-4000-8000-000000000001",
  version: "40000000-0000-4000-8000-000000000001",
  job: "50000000-0000-4000-8000-000000000001",
};
const applicationPassword = "product-image-import-application";

function applicationConnectionString(connectionString: string) {
  const value = new URL(connectionString);
  value.username = "content_application";
  value.password = applicationPassword;
  return value.toString();
}

describe.skipIf(process.env.RUN_POSTGRES_INTEGRATION !== "true")(
  "product image import under the production application ACL",
  () => {
    let container: StartedPostgreSqlContainer | null = null;
    let admin: Pool;
    let application: Pool;

    beforeAll(async () => {
      container = await new PostgreSqlContainer("postgres:16-alpine")
        .withDatabase("product_image_import_acl")
        .withUsername("brand_pilot")
        .withPassword("brand_pilot")
        .start();
      admin = new Pool({ connectionString: container.getConnectionUri(), max: 2 });
      await admin.query(`
        create extension if not exists pgcrypto;
        create role content_application login nosuperuser password '${applicationPassword}';
        create table product_services(
          id uuid primary key,workspace_id uuid not null,brand_id uuid not null,
          kind text not null,status text not null
        );
        create table product_service_versions(
          id uuid primary key,workspace_id uuid not null,brand_id uuid not null,
          product_service_id uuid not null,version integer not null,status text not null
        );
        create table product_service_image_import_jobs(
          id uuid primary key,workspace_id uuid not null,brand_id uuid not null,
          product_service_id uuid not null,product_service_version_id uuid not null,
          requested_by_user_id uuid null,source_urls_json jsonb not null,status text not null,
          attempt_count integer not null default 0,available_at timestamptz not null default now(),
          lease_owner text null,lease_token uuid null,lease_expires_at timestamptz null,
          selection_audit_json jsonb null,error_code text null,created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),completed_at timestamptz null
        );
        create table storage_artifacts(
          id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
          artifact_type text not null,bucket text not null,path text not null,public_url text not null,
          mime_type text not null,byte_size bigint not null,checksum text not null,
          created_by_user_id uuid null,deleted_at timestamptz null
        );
        create table product_service_assets(
          id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
          product_service_id uuid not null,product_service_version_id uuid not null,
          storage_artifact_id uuid not null,storage_url text not null,storage_path text not null,
          mime_type text not null,size_bytes bigint not null,checksum text not null,
          role text not null,position integer not null,created_by_user_id uuid null
        );
        grant usage on schema public to content_application;
        grant select on product_services,product_service_versions to content_application;
        grant select,insert on storage_artifacts,product_service_assets to content_application;
        grant select,insert,update on product_service_image_import_jobs to content_application;
        insert into product_services values('${ids.product}','${ids.workspace}','${ids.brand}','product','active');
        insert into product_service_versions values('${ids.version}','${ids.workspace}','${ids.brand}','${ids.product}',1,'approved');
        insert into product_service_image_import_jobs(
          id,workspace_id,brand_id,product_service_id,product_service_version_id,source_urls_json,status
        ) values('${ids.job}','${ids.workspace}','${ids.brand}','${ids.product}','${ids.version}',
          '["https://shop.example/product"]','pending');
      `);
      application = new Pool({
        connectionString: applicationConnectionString(container.getConnectionUri()),
        max: 2,
        application_name: "product-image-import-acl",
      });
    }, 120_000);

    afterAll(async () => {
      await application?.end();
      await admin?.end();
      await container?.stop();
    }, 120_000);

    it("claims and completes without UPDATE on product catalog rows", async () => {
      const privileges = await application.query(
        `select has_table_privilege(current_user,'product_services','UPDATE') can_update_product,
                has_table_privilege(current_user,'product_service_versions','UPDATE') can_update_version`,
      );
      expect(privileges.rows[0]).toEqual({ can_update_product: false, can_update_version: false });

      const repository = createProductImageImportRepository(application);
      const claim = await repository.claimProductImageImportJob({ workerId: "image-worker-1", leaseSeconds: 180 });
      expect(claim?.id).toBe(ids.job);
      const storagePath = `brands/${ids.brand}/asset-library/products/${ids.product}/imports/${ids.job}/${"a".repeat(64)}.jpg`;
      await expect(repository.completeProductImageImportJob({
        jobId: ids.job,
        workerId: "image-worker-1",
        leaseToken: claim!.leaseToken,
        selectionAudit: { selected: 1 },
        images: [{
          storageUrl: `https://test.public.blob.vercel-storage.com/${storagePath}`,
          storagePath,
          mimeType: "image/jpeg",
          sizeBytes: 1024,
          checksum: "a".repeat(64),
          sourceUrl: "https://shop.example/product.jpg",
        }],
      })).resolves.toEqual({ completed: true, retainedStoragePaths: [storagePath] });
      await expect(application.query("select count(*)::integer count from product_service_assets"))
        .resolves.toMatchObject({ rows: [{ count: 1 }] });
    });
  },
);
