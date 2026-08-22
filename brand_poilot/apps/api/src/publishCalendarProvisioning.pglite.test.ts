import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPublishCalendarRepository } from "./publishCalendarRepository.js";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  brand: "20000000-0000-4000-8000-000000000001",
  generation1: "30000000-0000-4000-8000-000000000001",
  generation2: "30000000-0000-4000-8000-000000000002",
  output: "40000000-0000-4000-8000-000000000001",
  channelOutput: "50000000-0000-4000-8000-000000000001",
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
      create table channel_outputs(
        id uuid primary key, workspace_id uuid not null, brand_id uuid not null,
        ai_content_generation_output_id uuid, content_topic_id uuid
      );
      create table publish_queue(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null, channel_output_id uuid, topic_publish_group_id uuid, status text not null, scheduled_for timestamptz, queued_at timestamptz not null default now(), published_at timestamptz);
      create table publish_calendar_slots(
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
        scheduled_for timestamptz not null, assignment_mode text not null, status text not null,
        recommendation_kind text, content_format text not null, channels text[] not null default '{}',
        content_suggestion_id uuid, proposal_id uuid, generation_id uuid, generation_output_id uuid,
        topic_publish_group_id uuid, title text, last_error text, created_by_user_id uuid,
        idempotency_key text,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now()
      );
      create unique index publish_calendar_slots_brand_idempotency_unique
        on publish_calendar_slots(brand_id,idempotency_key) where idempotency_key is not null;
      create unique index publish_calendar_slots_generation_output_unique
        on publish_calendar_slots(brand_id,generation_output_id)
        where generation_output_id is not null and status<>'cancelled';
      create unique index publish_calendar_slots_generation_unique
        on publish_calendar_slots(brand_id,generation_id)
        where generation_id is not null and status<>'cancelled';
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
  }, 60_000);

  afterEach(async () => db?.close(), 30_000);

  const manualGenerationInput = (overrides: Partial<{
    scheduledFor: Date;
    contentFormat: "card_news" | "reel";
    idempotencyKey: string;
    generationId: string;
  }> = {}) => ({
    workspaceId: ids.workspace,
    brandId: ids.brand,
    scheduledFor: overrides.scheduledFor ?? new Date("2099-08-15T02:30:00Z"),
    channel: "instagram" as const,
    contentFormat: overrides.contentFormat ?? "card_news" as const,
    idempotencyKey: overrides.idempotencyKey ?? "manual-replay",
    source: {
      kind: "existing_generation" as const,
      generationId: overrides.generationId ?? ids.generation1,
    },
  });

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
    const stored = await db.query<{ count: number; open_count: number; key_count: number }>(
      "select count(*)::integer count,count(*) filter(where status='open')::integer open_count,count(distinct idempotency_key)::integer key_count from publish_calendar_slots",
    );
    expect(stored.rows[0]).toEqual({ count: 2, open_count: 0, key_count: 2 });
  });

  it("replays a keyed slot after its scheduled time has passed", async () => {
    const original = await repository.provisionManualSlot(manualGenerationInput());
    await db.query("update publish_calendar_slots set scheduled_for='2000-01-01T00:00:00Z' where id=$1", [original.id]);

    await expect(repository.provisionManualSlot(manualGenerationInput({
      scheduledFor: new Date("2000-01-01T00:00:00Z"),
    }))).resolves.toMatchObject({ id: original.id, scheduledFor: "2000-01-01T00:00:00.000Z" });
  });

  it("replays a keyed slot after its channel is disabled", async () => {
    const input = manualGenerationInput({ idempotencyKey: "manual-channel-replay" });
    const original = await repository.provisionManualSlot(input);
    await db.query("update brand_channels set enabled=false where brand_id=$1", [ids.brand]);

    await expect(repository.provisionManualSlot(input)).resolves.toMatchObject({ id: original.id });
  });

  it("replays a keyed slot after available publish quota becomes zero", async () => {
    const input = manualGenerationInput({ idempotencyKey: "manual-quota-replay" });
    const original = await repository.provisionManualSlot(input);
    await db.query("update publish_calendar_slots set status='cancelled' where id=$1", [original.id]);
    await db.query("update billing_plan_catalog set weekly_publish_limit=0 where code='pro'");

    await expect(repository.provisionManualSlot(input)).resolves.toMatchObject({ id: original.id, status: "cancelled" });
  });

  it("compares normalized channels when replaying a keyed slot", async () => {
    const input = manualGenerationInput({ idempotencyKey: "manual-normalized-channel" });
    const original = await repository.provisionManualSlot(input);
    await db.query("update publish_calendar_slots set channels=array['instagram','instagram'] where id=$1", [original.id]);

    await expect(repository.provisionManualSlot(input)).resolves.toMatchObject({ id: original.id });
  });

  it.each([
    ["assignment mode", "update publish_calendar_slots set assignment_mode='automatic' where id=$1"],
    ["recommendation kind", "update publish_calendar_slots set recommendation_kind='trend' where id=$1"],
    ["normalized channels", "update publish_calendar_slots set channels='{}'::text[] where id=$1"],
    ["format", "update publish_calendar_slots set content_format='reel' where id=$1"],
    ["timestamp", "update publish_calendar_slots set scheduled_for='2099-08-15T03:30:00Z' where id=$1"],
    ["source kind", `update publish_calendar_slots
       set generation_output_id='40000000-0000-4000-8000-000000000099' where id=$1`],
    ["source id", `update publish_calendar_slots
       set generation_id='30000000-0000-4000-8000-000000000002' where id=$1`],
  ])("rejects a keyed replay whose %s differs", async (_label, mutation) => {
    const input = manualGenerationInput({ idempotencyKey: `manual-conflict-${_label}` });
    const original = await repository.provisionManualSlot(input);
    await db.query(mutation, [original.id]);

    await expect(repository.provisionManualSlot(input))
      .rejects.toThrow("publish_calendar_idempotency_conflict");
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

  it("rejects client row ids that collide after durable-key normalization", async () => {
    await expect(repository.provisionManualSlotsBatch({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      idempotencyKey: "batch-row-id-normalization",
      rows: [
        { clientRowId: "row", scheduledFor: new Date("2099-08-15T02:30:00Z"), channel: "instagram", contentFormat: "card_news", source: { kind: "existing_generation", generationId: ids.generation1 } },
        { clientRowId: " row ", scheduledFor: new Date("2099-08-15T03:00:00Z"), channel: "instagram", contentFormat: "reel", source: { kind: "existing_generation", generationId: ids.generation2 } },
      ],
    })).rejects.toThrow("publish_calendar_batch_invalid");

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

  it("does not reschedule a completed output that already owns a failed publish queue", async () => {
    await db.query("update ai_content_generations set status='completed' where id=$1", [ids.generation1]);
    await db.query(
      "insert into ai_content_generation_outputs(id,generation_id,workspace_id,brand_id,title,status) values($1,$2,$3,$4,'완료 콘텐츠','completed')",
      [ids.output, ids.generation1, ids.workspace, ids.brand],
    );
    await db.query(
      "insert into channel_outputs(id,workspace_id,brand_id,ai_content_generation_output_id) values($1,$2,$3,$4)",
      [ids.channelOutput, ids.workspace, ids.brand, ids.output],
    );
    await db.query(
      "insert into publish_queue(workspace_id,brand_id,channel_output_id,status) values($1,$2,$3,'failed')",
      [ids.workspace, ids.brand, ids.channelOutput],
    );

    await expect(repository.provisionManualSlot({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      scheduledFor: new Date("2099-08-15T02:30:00Z"),
      channel: "instagram",
      contentFormat: "card_news",
      idempotencyKey: "failed-output",
      source: { kind: "existing_output", generationOutputId: ids.output },
    })).rejects.toThrow("publish_calendar_content_not_assignable");

    const stored = await db.query<{ count: number }>("select count(*)::integer count from publish_calendar_slots");
    expect(stored.rows[0]?.count).toBe(0);
  });

  it("translates the preserved 079 generation constraint when a second output is scheduled", async () => {
    const outputOne = "40000000-0000-4000-8000-000000000011";
    const outputTwo = "40000000-0000-4000-8000-000000000012";
    await db.query("update ai_content_generations set status='completed' where id=$1", [ids.generation1]);
    await db.query(
      `insert into ai_content_generation_outputs(id,generation_id,workspace_id,brand_id,title,status)
       values($1,$3,$4,$5,'완료 콘텐츠 1','completed'),($2,$3,$4,$5,'완료 콘텐츠 2','completed')`,
      [outputOne, outputTwo, ids.generation1, ids.workspace, ids.brand],
    );

    const first = await repository.provisionManualSlot({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      scheduledFor: new Date("2099-08-20T02:30:00Z"),
      channel: "instagram",
      contentFormat: "card_news",
      idempotencyKey: "same-generation-output-1",
      source: { kind: "existing_output", generationOutputId: outputOne },
    });
    await expect(repository.provisionManualSlot({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      scheduledFor: new Date("2099-08-20T03:00:00Z"),
      channel: "instagram",
      contentFormat: "card_news",
      idempotencyKey: "same-generation-output-2",
      source: { kind: "existing_output", generationOutputId: outputTwo },
    })).rejects.toThrow("publish_calendar_content_already_scheduled");

    expect(first.generationOutputId).toBe(outputOne);
  });

  it("does not let one completed output own two active slots", async () => {
    await db.query("update ai_content_generations set status='completed' where id=$1", [ids.generation1]);
    await db.query(
      "insert into ai_content_generation_outputs(id,generation_id,workspace_id,brand_id,title,status) values($1,$2,$3,$4,'완료 콘텐츠','completed')",
      [ids.output, ids.generation1, ids.workspace, ids.brand],
    );
    const base = {
      workspaceId: ids.workspace,
      brandId: ids.brand,
      channel: "instagram" as const,
      contentFormat: "card_news" as const,
      source: { kind: "existing_output" as const, generationOutputId: ids.output },
    };
    await repository.provisionManualSlot({
      ...base,
      scheduledFor: new Date("2099-08-21T02:30:00Z"),
      idempotencyKey: "same-output-1",
    });

    await expect(repository.provisionManualSlot({
      ...base,
      scheduledFor: new Date("2099-08-21T03:00:00Z"),
      idempotencyKey: "same-output-2",
    })).rejects.toThrow("publish_calendar_content_already_scheduled");
  });

  it("keeps a generation-level reservation exclusive against its later output", async () => {
    await repository.provisionManualSlot({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      scheduledFor: new Date("2099-08-22T02:30:00Z"),
      channel: "instagram",
      contentFormat: "card_news",
      idempotencyKey: "generation-level-first",
      source: { kind: "existing_generation", generationId: ids.generation1 },
    });
    await db.query("update ai_content_generations set status='completed' where id=$1", [ids.generation1]);
    await db.query(
      "insert into ai_content_generation_outputs(id,generation_id,workspace_id,brand_id,title,status) values($1,$2,$3,$4,'완료 콘텐츠','completed')",
      [ids.output, ids.generation1, ids.workspace, ids.brand],
    );

    await expect(repository.provisionManualSlot({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      scheduledFor: new Date("2099-08-22T03:00:00Z"),
      channel: "instagram",
      contentFormat: "card_news",
      idempotencyKey: "generation-level-output-second",
      source: { kind: "existing_output", generationOutputId: ids.output },
    })).rejects.toThrow("publish_calendar_content_already_scheduled");
  });

  it("counts null-group queues for distinct content topics as two publication units", async () => {
    const topicOne = "70000000-0000-4000-8000-000000000011";
    const topicTwo = "70000000-0000-4000-8000-000000000012";
    await db.query(
      `insert into channel_outputs(id,workspace_id,brand_id,content_topic_id)
       values('50000000-0000-4000-8000-000000000011',$1,$2,$3),
             ('50000000-0000-4000-8000-000000000012',$1,$2,$4)`,
      [ids.workspace, ids.brand, topicOne, topicTwo],
    );
    await db.query(
      `insert into publish_queue(workspace_id,brand_id,channel_output_id,status)
       values($1,$2,'50000000-0000-4000-8000-000000000011','queued'),
             ($1,$2,'50000000-0000-4000-8000-000000000012','queued')`,
      [ids.workspace, ids.brand],
    );

    await expect(repository.getWeeklyUsage({ workspaceId: ids.workspace, brandId: ids.brand, at: new Date() }))
      .resolves.toMatchObject({ publishing: { reserved: 2 } });
  });

  it("counts two channel targets for one content topic as one publication unit", async () => {
    const topicId = "70000000-0000-4000-8000-000000000021";
    await db.query(
      `insert into channel_outputs(id,workspace_id,brand_id,content_topic_id)
       values('50000000-0000-4000-8000-000000000021',$1,$2,$3),
             ('50000000-0000-4000-8000-000000000022',$1,$2,$3)`,
      [ids.workspace, ids.brand, topicId],
    );
    await db.query(
      `insert into publish_queue(workspace_id,brand_id,channel_output_id,status)
       values($1,$2,'50000000-0000-4000-8000-000000000021','queued'),
             ($1,$2,'50000000-0000-4000-8000-000000000022','queued')`,
      [ids.workspace, ids.brand],
    );

    await expect(repository.getWeeklyUsage({ workspaceId: ids.workspace, brandId: ids.brand, at: new Date() }))
      .resolves.toMatchObject({ publishing: { reserved: 1 } });
  });

  it("uses the AI output as the publication unit before a synthetic content topic", async () => {
    const syntheticOne = "70000000-0000-4000-8000-000000000031";
    const syntheticTwo = "70000000-0000-4000-8000-000000000032";
    await db.query(
      `insert into channel_outputs(id,workspace_id,brand_id,ai_content_generation_output_id,content_topic_id)
       values('50000000-0000-4000-8000-000000000031',$1,$2,$3,$4),
             ('50000000-0000-4000-8000-000000000032',$1,$2,$3,$5)`,
      [ids.workspace, ids.brand, ids.output, syntheticOne, syntheticTwo],
    );
    await db.query(
      `insert into publish_queue(workspace_id,brand_id,channel_output_id,status)
       values($1,$2,'50000000-0000-4000-8000-000000000031','queued'),
             ($1,$2,'50000000-0000-4000-8000-000000000032','queued')`,
      [ids.workspace, ids.brand],
    );

    await expect(repository.getWeeklyUsage({ workspaceId: ids.workspace, brandId: ids.brand, at: new Date() }))
      .resolves.toMatchObject({ publishing: { reserved: 1 } });
  });

  it("returns the matching legacy no-key row when multiple active rows share one time", async () => {
    const scheduledFor = "2099-09-01T02:30:00Z";
    const first = await db.query<{ id: string }>(
      `insert into publish_calendar_slots(
         workspace_id,brand_id,scheduled_for,assignment_mode,status,recommendation_kind,content_format,channels
       ) values($1,$2,$3,'automatic','open','trend','reel',array['instagram']) returning id`,
      [ids.workspace, ids.brand, scheduledFor],
    );
    const matching = await db.query<{ id: string }>(
      `insert into publish_calendar_slots(
         workspace_id,brand_id,scheduled_for,assignment_mode,status,recommendation_kind,content_format,channels
       ) values($1,$2,$3,'manual','open',null,'card_news',array['instagram']) returning id`,
      [ids.workspace, ids.brand, scheduledFor],
    );

    await expect(repository.createSlot({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      scheduledFor: new Date(scheduledFor),
      assignmentMode: "manual",
      recommendationKind: null,
      contentFormat: "card_news",
      channels: ["instagram"],
    })).resolves.toMatchObject({ id: matching.rows[0]?.id });
    expect(first.rows[0]?.id).not.toBe(matching.rows[0]?.id);
  });

  it("creates a new legacy no-key row after the prior matching row is cancelled", async () => {
    const scheduledFor = "2099-09-02T02:30:00Z";
    const original = await db.query<{ id: string }>(
      `insert into publish_calendar_slots(
         workspace_id,brand_id,scheduled_for,assignment_mode,status,recommendation_kind,content_format,channels
       ) values($1,$2,$3,'manual','open',null,'card_news',array['instagram']) returning id`,
      [ids.workspace, ids.brand, scheduledFor],
    );
    await db.query("update publish_calendar_slots set status='cancelled' where id=$1", [original.rows[0]?.id]);

    const recreated = await repository.createSlot({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      scheduledFor: new Date(scheduledFor),
      assignmentMode: "manual",
      recommendationKind: null,
      contentFormat: "card_news",
      channels: ["instagram"],
    });

    expect(recreated.id).not.toBe(original.rows[0]?.id);
    expect(recreated.idempotencyKey).toBeNull();
  });
});
