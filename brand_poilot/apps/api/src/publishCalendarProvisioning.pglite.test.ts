import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPublishCalendarRepository } from "./publishCalendarRepository.js";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  brand: "20000000-0000-4000-8000-000000000001",
  generation1: "30000000-0000-4000-8000-000000000001",
  generation2: "30000000-0000-4000-8000-000000000002",
};

describe("publish calendar manual provisioning with postgres semantics", () => {
  let db: PGlite;
  let repository: ReturnType<typeof createPublishCalendarRepository>;

  beforeEach(async () => {
    db = await PGlite.create({ extensions: { pgcrypto } });
    await db.exec(`
      create function assert_ai_content_writable() returns void language sql as $$ select $$;
      create table brands(id uuid primary key, workspace_id uuid not null);
      create table brand_channels(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null, channel text not null, enabled boolean not null, status text not null, deleted_at timestamptz);
      create table billing_plan_catalog(code text primary key, weekly_generation_limit integer not null, weekly_publish_limit integer not null, active boolean not null);
      create table brand_subscriptions(brand_id uuid primary key, plan_code text not null, status text not null, started_at timestamptz not null, current_period_start timestamptz not null, current_period_end timestamptz not null);
      create table ai_content_generations(id uuid primary key, workspace_id uuid not null, brand_id uuid not null, title text not null, output_format text not null, status text not null, created_at timestamptz not null default now());
      create table ai_content_generation_outputs(id uuid primary key, generation_id uuid not null, workspace_id uuid not null, brand_id uuid not null, title text, status text not null, created_at timestamptz not null default now());
      create table ai_content_usage_ledger(generation_id uuid not null, workspace_id uuid not null, brand_id uuid not null, usage_type text not null, quantity integer not null, usage_date date not null);
      create table channel_outputs(id uuid primary key, workspace_id uuid not null, brand_id uuid not null, ai_content_generation_output_id uuid);
      create table publish_queue(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null, channel_output_id uuid, topic_publish_group_id uuid, status text not null, scheduled_for timestamptz, queued_at timestamptz not null default now(), published_at timestamptz);
      create table publish_calendar_slots(
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
        scheduled_for timestamptz not null, assignment_mode text not null, status text not null,
        recommendation_kind text, content_format text not null, channels text[] not null default '{}',
        content_suggestion_id uuid, proposal_id uuid, generation_id uuid, generation_output_id uuid,
        topic_publish_group_id uuid, title text, last_error text, created_by_user_id uuid,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now()
      );
    `);
    await db.query("insert into brands values($1,$2)", [ids.brand, ids.workspace]);
    await db.query("insert into brand_channels(workspace_id,brand_id,channel,enabled,status) values($1,$2,'instagram',true,'connected')", [ids.workspace, ids.brand]);
    await db.query("insert into billing_plan_catalog values('pro',10,10,true)");
    await db.query("insert into brand_subscriptions values($1,'pro','active','2026-08-01','2026-08-01','2100-01-01')", [ids.brand]);
    await db.query("insert into ai_content_generations(id,workspace_id,brand_id,title,output_format,status) values($1,$2,$3,'SNS 마케팅 1','card_news','generating'),($4,$2,$3,'SNS 마케팅 2','reel','generating')", [ids.generation1, ids.workspace, ids.brand, ids.generation2]);
    const query = async (sql: string, values: unknown[] = []) => {
      const result = await db.query(sql, values as never[]);
      return { rows: result.rows, rowCount: result.rows.length || Number(result.affectedRows ?? 0) };
    };
    repository = createPublishCalendarRepository({ query, connect: async () => ({ query, release() {} }) } as never);
  }, 30_000);

  afterEach(async () => db?.close(), 30_000);

  it("atomically creates content-backed rows exactly 30 minutes apart", async () => {
    const slots = await repository.provisionManualSlotsBatch({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      idempotencyKey: "batch-pglite",
      rows: [
        { clientRowId: "row-1", scheduledFor: new Date("2099-08-15T02:30:00Z"), channel: "instagram", contentFormat: "card_news", source: { kind: "existing_generation", generationId: ids.generation1 } },
        { clientRowId: "row-2", scheduledFor: new Date("2099-08-15T03:00:00Z"), channel: "instagram", contentFormat: "reel", source: { kind: "existing_generation", generationId: ids.generation2 } },
      ],
    });
    expect(slots.map((slot) => slot.status)).toEqual(["generation_pending", "generation_pending"]);
    const stored = await db.query<{ count: number; open_count: number }>("select count(*)::integer count,count(*) filter(where status='open')::integer open_count from publish_calendar_slots");
    expect(stored.rows[0]).toEqual({ count: 2, open_count: 0 });
  });

  it("rolls the whole batch back when two rows are less than 30 minutes apart", async () => {
    await expect(repository.provisionManualSlotsBatch({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      idempotencyKey: "batch-spacing",
      rows: [
        { clientRowId: "row-1", scheduledFor: new Date("2099-08-15T02:30:00Z"), channel: "instagram", contentFormat: "card_news", source: { kind: "existing_generation", generationId: ids.generation1 } },
        { clientRowId: "row-2", scheduledFor: new Date("2099-08-15T02:59:00Z"), channel: "instagram", contentFormat: "reel", source: { kind: "existing_generation", generationId: ids.generation2 } },
      ],
    })).rejects.toThrow("publish_calendar_spacing_conflict");
    const stored = await db.query<{ count: number }>("select count(*)::integer count from publish_calendar_slots");
    expect(stored.rows[0]?.count).toBe(0);
  });

  it("rolls the whole batch back when unstarted generations exceed the plan generation availability", async () => {
    await db.query("update billing_plan_catalog set weekly_generation_limit=1 where code='pro'");
    await db.query("update ai_content_generations set status='draft'");

    await expect(repository.provisionManualSlotsBatch({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      idempotencyKey: "batch-generation-quota",
      rows: [
        { clientRowId: "row-1", scheduledFor: new Date("2099-08-15T02:30:00Z"), channel: "instagram", contentFormat: "card_news", source: { kind: "existing_generation", generationId: ids.generation1 } },
        { clientRowId: "row-2", scheduledFor: new Date("2099-08-15T03:00:00Z"), channel: "instagram", contentFormat: "reel", source: { kind: "existing_generation", generationId: ids.generation2 } },
      ],
    })).rejects.toThrow("publish_calendar_generation_quota_exceeded");

    const stored = await db.query<{ count: number }>("select count(*)::integer count from publish_calendar_slots");
    expect(stored.rows[0]?.count).toBe(0);
  });
});
