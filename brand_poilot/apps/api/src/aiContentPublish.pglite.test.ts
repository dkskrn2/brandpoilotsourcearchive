import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAiContentPublishRepository } from "./aiContentPublish.js";

const ids = {
  workspace: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  brand: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  generation: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  output: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  channel: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  credential: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  artifact: "11111111-1111-4111-8111-111111111111",
  foreignWorkspace: "22222222-2222-4222-8222-222222222222",
  foreignBrand: "33333333-3333-4333-8333-333333333333",
};

const manifestPath = `ai-content/${ids.brand}/${ids.generation}/${ids.output}/manifest.json`;
const manifestUrl = `https://assets.public.blob.vercel-storage.com/${manifestPath}`;
const manifest = {
  version: "ai-content.v1",
  type: "card_news",
  title: "Tea",
  assets: [{
    role: "slide", index: 1,
    url: "https://assets.public.blob.vercel-storage.com/slide.png",
    fileName: "slide.png", mimeType: "image/png", width: 1080, height: 1080,
  }],
  content: { caption: "Tea", hashtags: [], cta: "Save" },
};

describe("AI content publish artifact ownership with postgres semantics", () => {
  let db: PGlite;
  let repository: ReturnType<typeof createAiContentPublishRepository>;

  beforeEach(async () => {
    db = await PGlite.create({ extensions: { pgcrypto } });
    await db.exec(`
      create table ai_content_generations (
        id uuid primary key, type text not null, title text not null, draft_json jsonb not null default '{}'
      );
      create table ai_content_generation_outputs (
        id uuid primary key, generation_id uuid not null, workspace_id uuid not null, brand_id uuid not null,
        status text not null, artifact_manifest_json jsonb not null, manifest_url text not null
      );
      create table brand_channels (
        id uuid primary key, workspace_id uuid not null, brand_id uuid not null, channel text not null,
        status text not null, enabled boolean not null, deleted_at timestamptz
      );
      create table channel_credentials (
        id uuid primary key, brand_channel_id uuid not null, status text not null,
        revoked_at timestamptz, expires_at timestamptz
      );
      create table content_topics (
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
        title text not null, angle text not null, status text not null, source_context jsonb not null,
        generated_at timestamptz
      );
      create table master_drafts (
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
        content_topic_id uuid not null, status text not null, prompt_version text not null,
        draft_json jsonb not null, source_snapshot_refs jsonb not null
      );
      create table topic_publish_groups (
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
        content_topic_id uuid not null, status text not null, scheduled_for timestamptz
      );
      create table storage_artifacts (
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
        artifact_type text not null, bucket text not null, path text not null, public_url text not null,
        mime_type text not null, byte_size bigint not null,
        unique (bucket, path)
      );
      create table channel_outputs (
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
        content_topic_id uuid not null, master_draft_id uuid not null, channel text not null,
        delivery_format text not null, status text not null, title text not null, preview_title text not null,
        preview_body text not null, output_json jsonb not null, rendered_artifact_id uuid not null,
        source_summary text not null, block_reasons jsonb not null,
        ai_content_generation_output_id uuid not null, approved_at timestamptz
      );
      create table publish_queue (
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
        channel_output_id uuid not null, brand_channel_id uuid not null, channel text not null,
        topic_publish_group_id uuid not null, status text not null, approval_type text not null,
        scheduled_for timestamptz, idempotency_key text not null, last_error text,
        queued_at timestamptz, publishing_started_at timestamptz, published_at timestamptz,
        failed_at timestamptz, deferred_until timestamptz, created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table publish_attempts (
        id uuid primary key default gen_random_uuid(), publish_queue_id uuid not null, status text not null,
        external_url text, finished_at timestamptz, created_at timestamptz not null default now()
      );
    `);
    await db.query(
      "insert into ai_content_generations(id,type,title) values($1,'card_news','Tea')",
      [ids.generation],
    );
    await db.query(
      "insert into ai_content_generation_outputs(id,generation_id,workspace_id,brand_id,status,artifact_manifest_json,manifest_url) values($1,$2,$3,$4,'completed',$5::jsonb,$6)",
      [ids.output, ids.generation, ids.workspace, ids.brand, JSON.stringify(manifest), manifestUrl],
    );
    await db.query(
      "insert into brand_channels(id,workspace_id,brand_id,channel,status,enabled) values($1,$2,$3,'instagram','connected',true)",
      [ids.channel, ids.workspace, ids.brand],
    );
    await db.query(
      "insert into channel_credentials(id,brand_channel_id,status) values($1,$2,'active')",
      [ids.credential, ids.channel],
    );
    const query = async (sql: string, values: unknown[] = []) => {
      const result = await db.query(sql, values as never[]);
      return {
        rows: result.rows,
        rowCount: result.rows.length || Number(result.affectedRows ?? 0),
      };
    };
    const pool = {
      query,
      connect: async () => ({ query, release() {} }),
    };
    repository = createAiContentPublishRepository(pool as never);
  }, 30_000);

  afterEach(async () => db?.close(), 30_000);

  const input = () => ({
    workspaceId: ids.workspace.toUpperCase(),
    brandId: ids.brand.toUpperCase(),
    outputId: ids.output.toUpperCase(),
    idempotencyKey: "44444444-4444-4444-8444-444444444444",
    targets: [{ channel: "instagram", deliveryFormat: "instagram_feed_single" }] as const,
  });

  it("rejects a foreign artifact path collision without mutating or attaching it", async () => {
    const foreignUrl = "https://assets.public.blob.vercel-storage.com/foreign/manifest.json";
    await db.query(
      "insert into storage_artifacts(id,workspace_id,brand_id,artifact_type,bucket,path,public_url,mime_type,byte_size) values($1,$2,$3,'generated_manifest','vercel-blob',$4,$5,'application/json',0)",
      [ids.artifact, ids.foreignWorkspace, ids.foreignBrand, manifestPath, foreignUrl],
    );

    await expect(repository.prepareAiContentPublish(input()))
      .rejects.toThrow("ai_content_manifest_artifact_ownership_conflict");

    const artifacts = await db.query<{ id: string; workspace_id: string; brand_id: string; public_url: string }>(
      "select id,workspace_id,brand_id,public_url from storage_artifacts where bucket='vercel-blob' and path=$1",
      [manifestPath],
    );
    expect(artifacts.rows).toEqual([{
      id: ids.artifact,
      workspace_id: ids.foreignWorkspace,
      brand_id: ids.foreignBrand,
      public_url: foreignUrl,
    }]);
    for (const table of [
      "content_topics",
      "master_drafts",
      "topic_publish_groups",
      "channel_outputs",
      "publish_queue",
    ]) {
      const count = await db.query<{ count: number }>(`select count(*)::integer as count from ${table}`);
      expect(Number(count.rows[0]?.count), table).toBe(0);
    }
  });

  it("reuses the same-tenant artifact ID idempotently when request UUIDs are uppercase", async () => {
    await db.query(
      "insert into storage_artifacts(id,workspace_id,brand_id,artifact_type,bucket,path,public_url,mime_type,byte_size) values($1,$2,$3,'generated_manifest','vercel-blob',$4,$5,'application/json',0)",
      [ids.artifact, ids.workspace, ids.brand, manifestPath, manifestUrl],
    );

    const first = await repository.prepareAiContentPublish(input());
    const repeated = await repository.prepareAiContentPublish(input());

    expect(repeated.targets[0].channelOutputId).toBe(first.targets[0].channelOutputId);
    const artifacts = await db.query<{ id: string }>("select id from storage_artifacts where bucket='vercel-blob' and path=$1", [manifestPath]);
    expect(artifacts.rows).toEqual([{ id: ids.artifact }]);
    const outputs = await db.query<{ rendered_artifact_id: string }>("select rendered_artifact_id from channel_outputs");
    expect(outputs.rows).toEqual([{ rendered_artifact_id: ids.artifact }]);
  });
});
