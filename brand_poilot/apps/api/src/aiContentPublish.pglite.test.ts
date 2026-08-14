import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAiContentPublishRepository } from "./aiContentPublish.js";

const ids = {
  workspace: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  brand: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  generation: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  output: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  output2: "dddddddd-dddd-4ddd-8ddd-ddddddddddde",
  channel: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  credential: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  artifact: "11111111-1111-4111-8111-111111111111",
  slot: "12111111-1111-4111-8111-111111111111",
  slot2: "13111111-1111-4111-8111-111111111111",
  foreignWorkspace: "22222222-2222-4222-8222-222222222222",
  foreignBrand: "33333333-3333-4333-8333-333333333333",
};

const manifestPath = `ai-content/${ids.brand}/${ids.generation}/${ids.output}/manifest.json`;
const manifestUrl = `https://assets.public.blob.vercel-storage.com/${manifestPath}`;
const manifest = {
  version: "ai-content.v3",
  outputFormat: "card_news",
  purpose: "informational",
  title: "Tea",
  assets: [{
    role: "slide", index: 1,
    url: "https://assets.public.blob.vercel-storage.com/slide.png",
    fileName: "slide.png", mimeType: "image/png", width: 1080, height: 1080,
  }],
  content: { caption: "Tea", hashtags: [], cta: "Save" },
};

const reelManifest = {
  version: "ai-content.v3",
  outputFormat: "reel",
  purpose: "informational",
  title: "Tea Reel",
  assets: [
    {
      role: "scene", index: 1,
      url: "https://assets.public.blob.vercel-storage.com/scene.png",
      fileName: "scene.png", mimeType: "image/png", width: 1080, height: 1920,
    },
    {
      role: "video", index: 1,
      url: "https://assets.public.blob.vercel-storage.com/reel.mp4",
      fileName: "reel.mp4", mimeType: "video/mp4", width: 1080, height: 1920,
      durationSeconds: 4, videoCodec: "h264", fps: 30, audioCodec: null,
    },
  ],
  content: { caption: "Tea Reel", hashtags: ["#tea"], cta: "Watch" },
};

describe("AI content publish artifact ownership with postgres semantics", () => {
  let db: PGlite;
  let repository: ReturnType<typeof createAiContentPublishRepository>;

  beforeEach(async () => {
    db = await PGlite.create({ extensions: { pgcrypto } });
    await db.exec(`
      create table ai_content_generations (
        id uuid primary key, output_format text not null, purpose text not null, title text not null, draft_json jsonb not null default '{}'
      );
      create table ai_content_generation_outputs (
        id uuid primary key, generation_id uuid not null, workspace_id uuid not null, brand_id uuid not null,
        output_index integer not null, status text not null, artifact_manifest_json jsonb not null, manifest_url text not null,
        unique (generation_id, output_index)
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
        queued_at timestamptz not null default now(), publishing_started_at timestamptz, published_at timestamptz,
        failed_at timestamptz, deferred_until timestamptz, created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table publish_attempts (
        id uuid primary key default gen_random_uuid(), publish_queue_id uuid not null, status text not null,
        external_url text, finished_at timestamptz, created_at timestamptz not null default now()
      );
      create table publish_calendar_slots (
        id uuid primary key, workspace_id uuid not null, brand_id uuid not null,
        scheduled_for timestamptz not null, assignment_mode text not null, status text not null,
        content_format text not null, channels text[] not null,
        generation_id uuid, generation_output_id uuid, topic_publish_group_id uuid,
        last_error text, updated_at timestamptz not null default now()
      );
    `);
    await db.query(
      "insert into ai_content_generations(id,output_format,purpose,title) values($1,'card_news','informational','Tea')",
      [ids.generation],
    );
    await db.query(
      "insert into ai_content_generation_outputs(id,generation_id,workspace_id,brand_id,output_index,status,artifact_manifest_json,manifest_url) values($1,$2,$3,$4,1,'completed',$5::jsonb,$6)",
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

  it("stores one direct Reel publish queue from the completed canonical MP4", async () => {
    await db.query("update ai_content_generations set output_format='reel', title='Tea Reel' where id=$1", [ids.generation]);
    await db.query(
      "update ai_content_generation_outputs set artifact_manifest_json=$2::jsonb where id=$1",
      [ids.output, JSON.stringify(reelManifest)],
    );

    const result = await repository.prepareAiContentPublish({
      ...input(),
      targets: [{ channel: "instagram", deliveryFormat: "instagram_reel" }],
    });

    expect(result.targets).toEqual([
      expect.objectContaining({
        deliveryFormat: "instagram_reel",
        status: "scheduled",
        dispatchAllowed: true,
        queueId: expect.any(String),
      }),
    ]);
    const outputs = await db.query<{ delivery_format: string; output_json: Record<string, unknown> }>(
      "select delivery_format, output_json from channel_outputs",
    );
    expect(outputs.rows).toEqual([{
      delivery_format: "instagram_reel",
      output_json: expect.objectContaining({
        caption: "Tea Reel",
        hashtags: ["#tea"],
        video: expect.objectContaining({ mimeType: "video/mp4", url: "https://assets.public.blob.vercel-storage.com/reel.mp4" }),
      }),
    }]);
    const queued = await db.query<{ count: number }>("select count(*)::integer as count from publish_queue");
    expect(Number(queued.rows[0]?.count)).toBe(1);
  });

  it("prepares an active automatic calendar card as queued and links the reservation atomically", async () => {
    const scheduledFor = "2026-08-17T02:30:00.000Z";
    await db.query(
      `insert into publish_calendar_slots(
         id,workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,channels,generation_id,generation_output_id
       ) values($1,$2,$3,$4,'automatic','generation_pending','card_news',array['instagram'],$5,$6)`,
      [ids.slot, ids.workspace, ids.brand, scheduledFor, ids.generation, ids.output],
    );

    const calendarInput = {
      ...input(),
      targets: [{ channel: "instagram", deliveryFormat: "instagram_feed_carousel" }] as const,
    };
    const first = await repository.prepareAiContentPublish(calendarInput);
    const repeated = await repository.prepareAiContentPublish(calendarInput);

    expect(repeated).toEqual(first);
    const groups = await db.query<{ id: string; status: string; scheduled_for: string | null }>(
      "select id,status,scheduled_for from topic_publish_groups",
    );
    expect(groups.rows).toEqual([{ id: first.publishGroupId, status: "waiting", scheduled_for: null }]);
    const queues = await db.query<{ id: string; status: string; approval_type: string; scheduled_for: string | null }>(
      "select id,status,approval_type,scheduled_for from publish_queue",
    );
    expect(queues.rows).toEqual([{
      id: first.targets[0].queueId!,
      status: "queued",
      approval_type: "auto",
      scheduled_for: null,
    }]);
    const slots = await db.query<{
      status: string; scheduled_for: Date | string; content_format: string; channels: string[];
      generation_id: string; generation_output_id: string; topic_publish_group_id: string;
    }>(
      `select status,scheduled_for,content_format,channels,generation_id,generation_output_id,topic_publish_group_id
         from publish_calendar_slots where id=$1`,
      [ids.slot],
    );
    expect(slots.rows).toEqual([{
      status: "content_assigned",
      scheduled_for: new Date(scheduledFor),
      content_format: "card_news",
      channels: ["instagram"],
      generation_id: ids.generation,
      generation_output_id: ids.output,
      topic_publish_group_id: first.publishGroupId,
    }]);
  });

  it("converts an unattempted direct scheduled queue to calendar queued state instead of leaving it dispatchable", async () => {
    const direct = await repository.prepareAiContentPublish(input());
    await db.query(
      `insert into publish_calendar_slots(
         id,workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,channels,generation_id,generation_output_id
       ) values($1,$2,$3,'2026-08-17T02:30:00.000Z','manual','generation_pending','card_news',array['instagram'],$4,$5)`,
      [ids.slot, ids.workspace, ids.brand, ids.generation, ids.output],
    );

    const linked = await repository.prepareAiContentPublish({
      ...input(),
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
      targets: [{ channel: "instagram", deliveryFormat: "instagram_feed_carousel" }],
    });

    expect(linked.targets[0].queueId).toBe(direct.targets[0].queueId);
    const queue = await db.query<{ status: string; approval_type: string; scheduled_for: Date | null }>(
      "select status,approval_type,scheduled_for from publish_queue",
    );
    expect(queue.rows).toEqual([{ status: "queued", approval_type: "manual", scheduled_for: null }]);
  });

  it("keeps a completed output and reservation when automatic calendar preparation is unavailable", async () => {
    await db.query(
      `insert into publish_calendar_slots(
         id,workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,channels,generation_id,generation_output_id
       ) values($1,$2,$3,'2026-08-17T02:30:00.000Z','automatic','generation_pending','card_news',array['instagram'],$4,$5)`,
      [ids.slot, ids.workspace, ids.brand, ids.generation, ids.output],
    );
    await db.query("delete from channel_credentials");

    await expect(repository.prepareCompletedCalendarPublish({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      outputId: ids.output,
    })).resolves.toBeNull();

    const output = await db.query<{ status: string }>("select status from ai_content_generation_outputs where id=$1", [ids.output]);
    expect(output.rows).toEqual([{ status: "completed" }]);
    const slot = await db.query<{ status: string; last_error: string }>(
      "select status,last_error from publish_calendar_slots where id=$1",
      [ids.slot],
    );
    expect(slot.rows).toEqual([{
      status: "publish_delayed",
      last_error: "calendar_publish_prepare_failed:channel_oauth_not_connected",
    }]);
  });

  it("records the stable publishing-disabled policy code without attempting calendar queue creation", async () => {
    await db.query(
      `insert into publish_calendar_slots(
         id,workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,channels,generation_id,generation_output_id
       ) values($1,$2,$3,'2026-08-17T02:30:00.000Z','automatic','generation_pending','card_news',array['instagram'],$4,$5)`,
      [ids.slot, ids.workspace, ids.brand, ids.generation, ids.output],
    );

    await expect(repository.prepareCompletedCalendarPublish({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      outputId: ids.output,
      preparationEnabled: false,
    })).resolves.toBeNull();

    expect((await db.query<{ status: string; last_error: string }>(
      "select status,last_error from publish_calendar_slots where id=$1",
      [ids.slot],
    )).rows).toEqual([{
      status: "publish_delayed",
      last_error: "calendar_publish_prepare_failed:publishing_disabled",
    }]);
    expect((await db.query<{ count: number }>("select count(*)::integer as count from publish_queue")).rows[0]?.count).toBe(0);
  });

  it("automatically prepares one deterministic Reel queue and reuses it on completion replay", async () => {
    await db.query("update ai_content_generations set output_format='reel',title='Tea Reel' where id=$1", [ids.generation]);
    await db.query(
      "update ai_content_generation_outputs set artifact_manifest_json=$2::jsonb where id=$1",
      [ids.output, JSON.stringify(reelManifest)],
    );
    await db.query(
      `insert into publish_calendar_slots(
         id,workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,channels,generation_id,generation_output_id
       ) values($1,$2,$3,'2026-08-17T02:30:00.000Z','automatic','generation_pending','reel',array['instagram'],$4,$5)`,
      [ids.slot, ids.workspace, ids.brand, ids.generation, ids.output],
    );

    const first = await repository.prepareCompletedCalendarPublish({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      outputId: ids.output,
    });
    const replay = await repository.prepareCompletedCalendarPublish({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      outputId: ids.output,
    });

    expect(replay).toEqual(first);
    expect(first?.targets).toEqual([
      expect.objectContaining({ deliveryFormat: "instagram_reel", status: "queued" }),
    ]);
    const queues = await db.query<{ idempotency_key: string; scheduled_for: Date | null }>(
      "select idempotency_key,scheduled_for from publish_queue",
    );
    expect(queues.rows).toEqual([{
      idempotency_key: `ai-content:${ids.output}:instagram:instagram_reel:calendar-ai-content:${ids.slot}:${ids.output}`,
      scheduled_for: null,
    }]);
  });

  it("does not rebind a slot already assigned to another output from the same generation", async () => {
    await db.query(
      `insert into ai_content_generation_outputs(
         id,generation_id,workspace_id,brand_id,output_index,status,artifact_manifest_json,manifest_url
       ) values($1,$2,$3,$4,2,'completed',$5::jsonb,$6)`,
      [ids.output2, ids.generation, ids.workspace, ids.brand, JSON.stringify(manifest), manifestUrl.replace(ids.output, ids.output2)],
    );
    await db.query(
      `insert into publish_calendar_slots(
         id,workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,channels,generation_id
       ) values($1,$2,$3,'2026-08-17T02:30:00.000Z','automatic','generation_pending','card_news',array['instagram'],$4)`,
      [ids.slot, ids.workspace, ids.brand, ids.generation],
    );

    const assigned = await repository.prepareCompletedCalendarPublish({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      outputId: ids.output,
    });
    const slotBefore = (await db.query<{
      status: string; generation_output_id: string; topic_publish_group_id: string;
    }>("select status,generation_output_id,topic_publish_group_id from publish_calendar_slots where id=$1", [ids.slot])).rows[0];

    await expect(repository.prepareCompletedCalendarPublish({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      outputId: ids.output2,
    })).resolves.toBeNull();

    expect((await db.query(
      "select status,generation_output_id,topic_publish_group_id from publish_calendar_slots where id=$1",
      [ids.slot],
    )).rows[0]).toEqual(slotBefore);
    expect(slotBefore).toEqual({
      status: "content_assigned",
      generation_output_id: ids.output,
      topic_publish_group_id: assigned?.publishGroupId,
    });
    expect((await db.query<{ output_id: string }>(
      "select ai_content_generation_output_id as output_id from channel_outputs order by output_id",
    )).rows).toEqual([{ output_id: ids.output }]);
    expect((await db.query<{ count: number }>("select count(*)::integer as count from publish_queue")).rows[0]?.count).toBe(1);
  });

  it("does not mark output A's assigned slot delayed when output B preparation fails", async () => {
    await db.query(
      `insert into ai_content_generation_outputs(
         id,generation_id,workspace_id,brand_id,output_index,status,artifact_manifest_json,manifest_url
       ) values($1,$2,$3,$4,2,'completed',$5::jsonb,$6)`,
      [ids.output2, ids.generation, ids.workspace, ids.brand, JSON.stringify(manifest), manifestUrl.replace(ids.output, ids.output2)],
    );
    await db.query(
      `insert into publish_calendar_slots(
         id,workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,channels,generation_id
       ) values($1,$2,$3,'2026-08-17T02:30:00.000Z','automatic','generation_pending','card_news',array['instagram'],$4)`,
      [ids.slot, ids.workspace, ids.brand, ids.generation],
    );
    await repository.prepareCompletedCalendarPublish({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      outputId: ids.output,
    });

    await expect(repository.prepareCompletedCalendarPublish({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      outputId: ids.output2,
      preparationEnabled: false,
    })).resolves.toBeNull();

    expect((await db.query<{ status: string; generation_output_id: string; last_error: string | null }>(
      "select status,generation_output_id,last_error from publish_calendar_slots where id=$1",
      [ids.slot],
    )).rows).toEqual([{
      status: "content_assigned",
      generation_output_id: ids.output,
      last_error: null,
    }]);
  });

  it("does not let a stale preparation failure overwrite a successfully queued slot", async () => {
    await db.query(
      `insert into publish_calendar_slots(
         id,workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,channels,generation_id,generation_output_id
       ) values($1,$2,$3,'2026-08-17T02:30:00.000Z','automatic','generation_pending','card_news',array['instagram'],$4,$5)`,
      [ids.slot, ids.workspace, ids.brand, ids.generation, ids.output],
    );
    const prepared = await repository.prepareCompletedCalendarPublish({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      outputId: ids.output,
    });

    await expect(repository.prepareCompletedCalendarPublish({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      outputId: ids.output,
      preparationEnabled: false,
    })).resolves.toBeNull();

    expect((await db.query<{ status: string; last_error: string | null }>(
      "select status,last_error from publish_calendar_slots where id=$1",
      [ids.slot],
    )).rows).toEqual([{ status: "content_assigned", last_error: null }]);
    expect((await db.query<{ status: string; topic_publish_group_id: string }>(
      "select status,topic_publish_group_id from publish_queue where id=$1",
      [prepared?.targets[0].queueId],
    )).rows).toEqual([{
      status: "queued",
      topic_publish_group_id: prepared?.publishGroupId,
    }]);
  });

  it("lets only the minimum output index claim an unbound generation slot", async () => {
    await db.query(
      `insert into ai_content_generation_outputs(
         id,generation_id,workspace_id,brand_id,output_index,status,artifact_manifest_json,manifest_url
       ) values($1,$2,$3,$4,2,'completed',$5::jsonb,$6)`,
      [ids.output2, ids.generation, ids.workspace, ids.brand, JSON.stringify(manifest), manifestUrl.replace(ids.output, ids.output2)],
    );
    await db.query(
      `insert into publish_calendar_slots(
         id,workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,channels,generation_id
       ) values($1,$2,$3,'2026-08-17T02:30:00.000Z','automatic','generation_pending','card_news',array['instagram'],$4)`,
      [ids.slot, ids.workspace, ids.brand, ids.generation],
    );

    await expect(repository.prepareCompletedCalendarPublish({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      outputId: ids.output2,
    })).resolves.toBeNull();
    expect((await db.query<{ generation_output_id: string | null }>(
      "select generation_output_id from publish_calendar_slots where id=$1",
      [ids.slot],
    )).rows).toEqual([{ generation_output_id: null }]);
    expect((await db.query<{ count: number }>("select count(*)::integer as count from publish_queue")).rows[0]?.count).toBe(0);

    const assigned = await repository.prepareCompletedCalendarPublish({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      outputId: ids.output,
    });
    expect(assigned?.targets).toHaveLength(1);
    expect((await db.query<{ generation_output_id: string }>(
      "select generation_output_id from publish_calendar_slots where id=$1",
      [ids.slot],
    )).rows).toEqual([{ generation_output_id: ids.output }]);
  });

  it("reads an advanced scheduled calendar result without credentials or artifact writes", async () => {
    await db.query(
      `insert into publish_calendar_slots(
         id,workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,channels,generation_id,generation_output_id
       ) values($1,$2,$3,'2026-08-17T02:30:00.000Z','automatic','generation_pending','card_news',array['instagram'],$4,$5)`,
      [ids.slot, ids.workspace, ids.brand, ids.generation, ids.output],
    );
    const prepared = await repository.prepareCompletedCalendarPublish({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      outputId: ids.output,
    });
    await db.query("update publish_calendar_slots set status='scheduled' where id=$1", [ids.slot]);
    await db.query("update publish_queue set status='scheduled' where id=$1", [prepared?.targets[0].queueId]);
    await db.query("delete from channel_credentials");
    await db.query("delete from storage_artifacts");

    const replay = await repository.prepareAiContentPublish({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      outputId: ids.output,
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
      targets: [{ channel: "instagram", deliveryFormat: "instagram_feed_carousel" }],
    });

    expect(replay).toEqual({
      publishGroupId: prepared?.publishGroupId,
      targets: [expect.objectContaining({
        queueId: prepared?.targets[0].queueId,
        status: "scheduled",
        dispatchAllowed: false,
      })],
    });
    expect((await db.query<{ count: number }>("select count(*)::integer as count from storage_artifacts")).rows[0]?.count).toBe(0);
    expect((await db.query<{ status: string }>("select status from publish_calendar_slots where id=$1", [ids.slot])).rows)
      .toEqual([{ status: "scheduled" }]);
  });

  it("ignores a cancelled former reservation and preserves direct publish scheduling", async () => {
    await db.query(
      `insert into publish_calendar_slots(
         id,workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,channels,generation_id,generation_output_id
       ) values($1,$2,$3,'2026-08-17T02:30:00.000Z','automatic','cancelled','card_news',array['instagram'],$4,$5)`,
      [ids.slot, ids.workspace, ids.brand, ids.generation, ids.output],
    );

    await expect(repository.prepareCompletedCalendarPublish({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      outputId: ids.output,
    })).resolves.toBeNull();
    const direct = await repository.prepareAiContentPublish(input());

    expect(direct.targets[0]).toMatchObject({ status: "scheduled" });
    const queue = await db.query<{ status: string; scheduled_for: Date | null }>("select status,scheduled_for from publish_queue");
    expect(queue.rows[0]?.status).toBe("scheduled");
    expect(queue.rows[0]?.scheduled_for).toBeInstanceOf(Date);
    const slot = await db.query<{ status: string; topic_publish_group_id: string | null }>(
      "select status,topic_publish_group_id from publish_calendar_slots where id=$1",
      [ids.slot],
    );
    expect(slot.rows).toEqual([{ status: "cancelled", topic_publish_group_id: null }]);
  });

  it("rejects active calendar format, channel, and delivery mismatches without mutating the reservation", async () => {
    await db.query(
      `insert into publish_calendar_slots(
         id,workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,channels,generation_id,generation_output_id
       ) values($1,$2,$3,'2026-08-17T02:30:00.000Z','manual','generation_pending','reel',array['instagram'],$4,$5)`,
      [ids.slot, ids.workspace, ids.brand, ids.generation, ids.output],
    );

    await expect(repository.prepareAiContentPublish({
      ...input(),
      targets: [{ channel: "instagram", deliveryFormat: "instagram_feed_carousel" }],
    })).rejects.toThrow("publish_calendar_content_format_mismatch");
    await db.query("update publish_calendar_slots set content_format='card_news' where id=$1", [ids.slot]);
    await expect(repository.prepareAiContentPublish({
      ...input(),
      targets: [{ channel: "instagram", deliveryFormat: "instagram_story" }],
    })).rejects.toThrow("publish_calendar_targets_mismatch");
    await expect(repository.prepareAiContentPublish({
      ...input(),
      targets: [{ channel: "threads", deliveryFormat: "threads_text" }],
    })).rejects.toThrow("publish_calendar_targets_mismatch");

    expect((await db.query<{ status: string }>("select status from publish_calendar_slots where id=$1", [ids.slot])).rows)
      .toEqual([{ status: "generation_pending" }]);
    expect((await db.query<{ count: number }>("select count(*)::integer as count from publish_queue")).rows[0]?.count).toBe(0);
  });

  it("rejects ambiguous multiple active calendar matches before creating publish rows", async () => {
    for (const slotId of [ids.slot, ids.slot2]) {
      await db.query(
        `insert into publish_calendar_slots(
           id,workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,channels,generation_id,generation_output_id
         ) values($1,$2,$3,now()+($4::text||' hours')::interval,'manual','generation_pending','card_news',array['instagram'],$5,$6)`,
        [slotId, ids.workspace, ids.brand, slotId === ids.slot ? 1 : 2, ids.generation, ids.output],
      );
    }

    await expect(repository.prepareAiContentPublish({
      ...input(),
      targets: [{ channel: "instagram", deliveryFormat: "instagram_feed_carousel" }],
    })).rejects.toThrow("publish_calendar_slot_ambiguous");
    expect((await db.query<{ count: number }>("select count(*)::integer as count from publish_queue")).rows[0]?.count).toBe(0);
  });

  it("finds and completes a reservation linked only through its existing topic publish group", async () => {
    const topic = await db.query<{ id: string }>(
      `insert into content_topics(workspace_id,brand_id,title,angle,status,source_context)
       values($1,$2,'Tea','Tea','generated',$3::jsonb) returning id`,
      [ids.workspace, ids.brand, JSON.stringify({ source: "ai_content_studio", aiContentOutputId: ids.output })],
    );
    await db.query(
      `insert into master_drafts(workspace_id,brand_id,content_topic_id,status,prompt_version,draft_json,source_snapshot_refs)
       values($1,$2,$3,'generated','ai-content.v3','{}','[]')`,
      [ids.workspace, ids.brand, topic.rows[0].id],
    );
    const group = await db.query<{ id: string }>(
      `insert into topic_publish_groups(workspace_id,brand_id,content_topic_id,status,scheduled_for)
       values($1,$2,$3,'waiting',null) returning id`,
      [ids.workspace, ids.brand, topic.rows[0].id],
    );
    await db.query(
      `insert into publish_calendar_slots(
         id,workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,channels,topic_publish_group_id
       ) values($1,$2,$3,'2026-08-17T02:30:00.000Z','manual','generation_pending','card_news',array['instagram'],$4)`,
      [ids.slot, ids.workspace, ids.brand, group.rows[0].id],
    );

    const prepared = await repository.prepareCompletedCalendarPublish({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      outputId: ids.output,
    });

    expect(prepared?.publishGroupId).toBe(group.rows[0].id);
    expect((await db.query<{ generation_id: string; generation_output_id: string }>(
      "select generation_id,generation_output_id from publish_calendar_slots where id=$1",
      [ids.slot],
    )).rows).toEqual([{ generation_id: ids.generation, generation_output_id: ids.output }]);
  });
});
