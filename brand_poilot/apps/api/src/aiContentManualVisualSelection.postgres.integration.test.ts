import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  freezeManualVisualSelection,
  saveManualVisualSelection,
} from "./aiContentManualVisualSelection.js";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  brand: "10000000-0000-4000-8000-000000000002",
  generation: "10000000-0000-4000-8000-000000000003",
  product: "10000000-0000-4000-8000-000000000004",
  version: "10000000-0000-4000-8000-000000000005",
};

const applicationPassword = "manual-visual-selection-application";

function applicationConnectionString(connectionString: string) {
  const value = new URL(connectionString);
  value.username = "content_application";
  value.password = applicationPassword;
  return value.toString();
}

describe.skipIf(process.env.RUN_POSTGRES_INTEGRATION !== "true")(
  "manual visual selection under the production application ACL",
  () => {
    let container: StartedPostgreSqlContainer | null = null;
    let admin: Pool;
    let application: Pool;

    beforeAll(async () => {
      container = await new PostgreSqlContainer("postgres:16-alpine")
        .withDatabase("manual_visual_selection_acl")
        .withUsername("brand_pilot")
        .withPassword("brand_pilot")
        .start();
      admin = new Pool({ connectionString: container.getConnectionUri(), max: 2 });
      await admin.query(`
        create role content_application login nosuperuser password '${applicationPassword}';
        create table product_services (
          id uuid primary key, workspace_id uuid not null, brand_id uuid not null,
          kind text not null, display_name text not null, status text not null,
          active_version_id uuid null
        );
        create table product_service_versions (
          id uuid primary key, workspace_id uuid not null, brand_id uuid not null,
          product_service_id uuid not null, status text not null, profile_json jsonb not null
        );
        create table product_service_assets (
          id uuid primary key, workspace_id uuid not null, brand_id uuid not null,
          product_service_id uuid not null, product_service_version_id uuid not null,
          role text not null, position integer not null,
          storage_url text null, storage_path text null, mime_type text null, checksum text null
        );
        create table manual_ai_content_visual_selections (
          generation_id uuid primary key, workspace_id uuid not null, brand_id uuid not null,
          contract_version text not null,
          product_service_id uuid null, product_service_version_id uuid null,
          style_preset_id uuid null, style_preset_revision integer null,
          avatar_id uuid null, avatar_revision integer null,
          selection_json jsonb not null, selection_sha256 text not null,
          frozen_json jsonb null, frozen_sha256 text null, frozen_at timestamptz null
        );
        grant usage on schema public to content_application;
        grant select on product_services,product_service_versions,product_service_assets to content_application;
        grant select,insert,update on manual_ai_content_visual_selections to content_application;
      `);
      await admin.query(
        `insert into product_services(id,workspace_id,brand_id,kind,display_name,status,active_version_id)
         values($1,$2,$3,'service','GROWTHLINE','active',$4)`,
        [ids.product, ids.workspace, ids.brand, ids.version],
      );
      await admin.query(
        `insert into product_service_versions(
           id,workspace_id,brand_id,product_service_id,status,profile_json
         ) values($1,$2,$3,$4,'approved',$5::jsonb)`,
        [ids.version, ids.workspace, ids.brand, ids.product, JSON.stringify({
          contractVersion: "product-service.v1",
          name: "GROWTHLINE",
          kind: "service",
          description: "마케팅 서비스",
          features: ["콘텐츠 기획"],
          benefits: ["마케팅 지원"],
          cautions: [],
          audiences: [],
          appealsByTarget: {},
          evergreenPurchaseInfo: "상시 문의",
          sourceUrls: [],
        })],
      );
      application = new Pool({
        connectionString: applicationConnectionString(container.getConnectionUri()),
        max: 2,
        application_name: "manual-visual-selection-acl",
      });
    }, 120_000);

    afterAll(async () => {
      await application?.end();
      await admin?.end();
      await container?.stop();
    }, 120_000);

    it("stores and freezes an approved product with SELECT-only catalog privileges", async () => {
      const privileges = await application.query(
        `select has_table_privilege(current_user,'product_services','SELECT') can_select_product,
                has_table_privilege(current_user,'product_services','UPDATE') can_update_product,
                has_table_privilege(current_user,'product_service_versions','UPDATE') can_update_version`,
      );
      expect(privileges.rows[0]).toEqual({
        can_select_product: true,
        can_update_product: false,
        can_update_version: false,
      });

      const scope = {
        workspaceId: ids.workspace,
        brandId: ids.brand,
        generationId: ids.generation,
      };
      await expect(saveManualVisualSelection(application, scope, {
        contractVersion: "manual-visual-selection.v1",
        product: { productServiceId: ids.product, versionId: ids.version },
        stylePreset: null,
        avatar: null,
      })).resolves.toMatchObject({
        product: { productServiceId: ids.product, versionId: ids.version },
      });
      await expect(freezeManualVisualSelection(application, scope)).resolves.toMatchObject({
        product: { productServiceId: ids.product, versionId: ids.version, name: "GROWTHLINE" },
      });
    });
  },
);
