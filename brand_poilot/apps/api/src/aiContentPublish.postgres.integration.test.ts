import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { storeManifestArtifact } from "./aiContentPublish.js";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  brand: "20000000-0000-4000-8000-000000000002",
  output: "50000000-0000-4000-8000-000000000005",
  foreignWorkspace: "30000000-0000-4000-8000-000000000003",
  foreignBrand: "40000000-0000-4000-8000-000000000004",
};

const applicationPassword = "content-application-publish-test";

function connectionStringForApplication(connectionString: string) {
  const value = new URL(connectionString);
  value.username = "content_application";
  value.password = applicationPassword;
  return value.toString();
}

describe.skipIf(process.env.RUN_POSTGRES_INTEGRATION !== "true")(
  "AI content manifest artifact publishing under the production application ACL",
  () => {
    let container: StartedPostgreSqlContainer | null = null;
    let admin: Pool;
    let application: Pool;

    beforeAll(async () => {
      container = await new PostgreSqlContainer("postgres:16-alpine")
        .withDatabase("ai_content_publish_acl")
        .withUsername("brand_pilot")
        .withPassword("brand_pilot")
        .start();
      admin = new Pool({ connectionString: container.getConnectionUri(), max: 4 });
      await admin.query("create extension if not exists pgcrypto");
      await admin.query(`
        create role content_application login nosuperuser password '${applicationPassword}';
        create table public.storage_artifacts (
          id uuid primary key default gen_random_uuid(),
          workspace_id uuid not null,
          brand_id uuid not null,
          artifact_type text not null,
          bucket text not null,
          path text not null,
          public_url text not null,
          mime_type text not null,
          byte_size bigint not null,
          unique (bucket, path)
        );
        revoke all on table public.storage_artifacts from public, content_application;
        grant usage on schema public to content_application;
        grant insert, select on table public.storage_artifacts to content_application;
      `);
      application = new Pool({
        connectionString: connectionStringForApplication(container.getConnectionUri()),
        max: 4,
        application_name: "ai-content-publish-acl",
      });
    }, 120_000);

    afterAll(async () => {
      await application?.end();
      await admin?.end();
      await container?.stop();
    }, 120_000);

    it("reuses a same-tenant artifact without UPDATE privilege", async () => {
      const privileges = await application.query(
        `select has_table_privilege(current_user,'public.storage_artifacts','SELECT') as can_select,
                has_table_privilege(current_user,'public.storage_artifacts','INSERT') as can_insert,
                has_table_privilege(current_user,'public.storage_artifacts','UPDATE') as can_update`,
      );
      expect(privileges.rows[0]).toEqual({ can_select: true, can_insert: true, can_update: false });

      const client = await application.connect();
      try {
        await client.query("BEGIN");
        const first = await storeManifestArtifact(client, {
          workspaceId: ids.workspace,
          brandId: ids.brand,
          outputId: ids.output,
        }, "https://assets.public.blob.vercel-storage.com/same/manifest.json");
        const repeated = await storeManifestArtifact(client, {
          workspaceId: ids.workspace,
          brandId: ids.brand,
          outputId: ids.output,
        }, "https://assets.public.blob.vercel-storage.com/same/manifest.json");
        await client.query("COMMIT");
        expect(repeated).toBe(first);
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
    });

    it("rejects a foreign path collision without changing its owner or URL", async () => {
      const foreign = await admin.query(
        `insert into storage_artifacts(
           workspace_id,brand_id,artifact_type,bucket,path,public_url,mime_type,byte_size
         ) values($1,$2,'generated_manifest','vercel-blob','foreign/manifest.json',$3,'application/json',0)
         returning id`,
        [ids.foreignWorkspace, ids.foreignBrand, "https://assets.public.blob.vercel-storage.com/foreign/original.json"],
      );
      const client = await application.connect();
      try {
        await client.query("BEGIN");
        await expect(storeManifestArtifact(client, {
          workspaceId: ids.workspace,
          brandId: ids.brand,
          outputId: ids.output,
        }, "https://assets.public.blob.vercel-storage.com/foreign/manifest.json"))
          .rejects.toThrow("ai_content_manifest_artifact_ownership_conflict");
        await client.query("ROLLBACK");
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
      const stored = await admin.query(
        "select id,workspace_id,brand_id,public_url from storage_artifacts where bucket='vercel-blob' and path='foreign/manifest.json'",
      );
      expect(stored.rows).toEqual([{
        id: foreign.rows[0]?.id,
        workspace_id: ids.foreignWorkspace,
        brand_id: ids.foreignBrand,
        public_url: "https://assets.public.blob.vercel-storage.com/foreign/original.json",
      }]);
    });

    it("observes the winning row after a concurrent unique-key conflict commits", async () => {
      const gate = await admin.connect();
      const client = await application.connect();
      try {
        await gate.query("BEGIN");
        const winner = await gate.query(
          `insert into storage_artifacts(
             workspace_id,brand_id,artifact_type,bucket,path,public_url,mime_type,byte_size
           ) values($1,$2,'generated_manifest','vercel-blob','concurrent/manifest.json',$3,'application/json',0)
           returning id`,
          [ids.workspace, ids.brand, "https://assets.public.blob.vercel-storage.com/concurrent/manifest.json"],
        );

        const pending = storeManifestArtifact(client, {
          workspaceId: ids.workspace,
          brandId: ids.brand,
          outputId: ids.output,
        }, "https://assets.public.blob.vercel-storage.com/concurrent/manifest.json");
        const settledBeforeCommit = await Promise.race([
          pending.then(() => true, () => true),
          new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
        ]);
        expect(settledBeforeCommit).toBe(false);

        await gate.query("COMMIT");
        await expect(pending).resolves.toBe(String(winner.rows[0]?.id));
      } finally {
        await gate.query("ROLLBACK").catch(() => undefined);
        gate.release();
        client.release();
      }
    });
  },
);
