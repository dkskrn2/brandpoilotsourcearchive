import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manualSlotKey } from "./publishCalendarIdempotency.js";
import { createPublishCalendarRepository } from "./publishCalendarRepository.js";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  brand: "20000000-0000-4000-8000-000000000001",
  otherBrand: "20000000-0000-4000-8000-000000000002",
  generation1: "30000000-0000-4000-8000-000000000001",
  generation2: "30000000-0000-4000-8000-000000000002",
  output: "40000000-0000-4000-8000-000000000001",
  channelOutput: "50000000-0000-4000-8000-000000000001",
  topic: "60000000-0000-4000-8000-000000000001",
  otherTopic: "60000000-0000-4000-8000-000000000002",
};

describe("publish calendar manual provisioning with postgres semantics", () => {
  let db: PGlite;
  let repository: ReturnType<typeof createPublishCalendarRepository>;
  let pool: Parameters<typeof createPublishCalendarRepository>[0];

  beforeEach(async () => {
    db = await PGlite.create({ extensions: { pgcrypto } });
    await db.exec(`
      create function assert_ai_content_writable() returns void language sql as $$ select $$;
      create table brands(id uuid primary key, workspace_id uuid not null);
      create table brand_channels(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null, channel text not null, enabled boolean not null, status text not null, deleted_at timestamptz);
      create table billing_plan_catalog(code text primary key, weekly_generation_limit integer not null, weekly_publish_limit integer not null, active boolean not null);
      create table brand_subscriptions(brand_id uuid primary key, plan_code text not null, status text not null, started_at timestamptz not null, current_period_start timestamptz not null, current_period_end timestamptz not null);
      create table publish_calendar_settings(
        brand_id uuid primary key, workspace_id uuid not null, enabled boolean not null default false,
        channels text[] not null default '{}', informational_format text not null default 'card_news',
        trend_format text not null default 'reel', slot_times time[] not null default array['11:30'::time],
        updated_at timestamptz not null default now()
      );
      create table publish_calendar_weekly_schedule_entries(
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
        day_of_week smallint not null check(day_of_week between 1 and 7), slot_time time not null,
        sort_order integer not null check(sort_order >= 0), created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(), unique(brand_id,day_of_week,sort_order)
      );
      create table ai_content_generations(id uuid primary key, workspace_id uuid not null, brand_id uuid not null, title text not null, output_format text not null, status text not null, created_at timestamptz not null default now());
      create table ai_content_generation_outputs(id uuid primary key, generation_id uuid not null, workspace_id uuid not null, brand_id uuid not null, title text, status text not null, created_at timestamptz not null default now());
      create table content_topics(
        id uuid primary key, workspace_id uuid not null, brand_id uuid not null,
        title text not null, status text not null, selected_instagram_format text,
        created_at timestamptz not null default now()
      );
      create table topic_publish_groups(
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
        content_topic_id uuid not null unique, status text not null, slot_date date, slot_number integer,
        scheduled_for timestamptz,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now()
      );
      create table ai_content_usage_ledger(generation_id uuid not null, workspace_id uuid not null, brand_id uuid not null, usage_type text not null, quantity integer not null, usage_date date not null);
      create table channel_outputs(
        id uuid primary key, workspace_id uuid not null, brand_id uuid not null,
        ai_content_generation_output_id uuid, content_topic_id uuid
      );
      create table publish_queue(id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null, channel_output_id uuid, topic_publish_group_id uuid, status text not null, slot_date date, slot_number integer, scheduled_for timestamptz, queued_at timestamptz not null default now(), published_at timestamptz, updated_at timestamptz not null default now());
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
      create unique index publish_calendar_slots_publish_group_unique
        on publish_calendar_slots(brand_id,topic_publish_group_id)
        where topic_publish_group_id is not null and status<>'cancelled';
    `);
    await db.query("insert into brands values($1,$2),($3,$2)", [ids.brand, ids.workspace, ids.otherBrand]);
    await db.query("insert into brand_channels(workspace_id,brand_id,channel,enabled,status) values($1,$2,'instagram',true,'connected')", [ids.workspace, ids.brand]);
    await db.query("insert into billing_plan_catalog values('pro',10,10,true)");
    await db.query("insert into brand_subscriptions values($1,'pro','active','2026-08-01','2026-08-01','2100-01-01')", [ids.brand]);
    await db.query("insert into ai_content_generations(id,workspace_id,brand_id,title,output_format,status) values($1,$2,$3,'SNS 마케팅 1','card_news','generating'),($4,$2,$3,'SNS 마케팅 2','reel','generating')", [ids.generation1, ids.workspace, ids.brand, ids.generation2]);
    const query = async (sql: string, values: unknown[] = []) => {
      const result = await db.query(sql, values as never[]);
      return { rows: result.rows, rowCount: result.rows.length || Number(result.affectedRows ?? 0) };
    };
    pool = { query, connect: async () => ({ query, release() {} }) } as never;
    repository = createPublishCalendarRepository(pool);
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

  it("atomically inserts, updates, and deletes normalized weekly rows while preserving stable ids", async () => {
    const created = await repository.saveWeeklySettings({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      enabled: true,
      channels: ["instagram"],
      informationalFormat: "card_news",
      trendFormat: "reel",
      weeklySchedule: [
        { id: null, dayOfWeek: 1, time: "11:30", sortOrder: 0 },
        { id: null, dayOfWeek: 1, time: "11:30", sortOrder: 1 },
        { id: null, dayOfWeek: 7, time: "09:05", sortOrder: 0 },
      ],
    });
    expect(created.weeklySchedule).toHaveLength(3);
    expect(created.weeklySchedule[0]).toMatchObject({ dayOfWeek: 1, time: "11:30", sortOrder: 0 });
    expect(created.weeklySchedule[1]).toMatchObject({ dayOfWeek: 1, time: "11:30", sortOrder: 1 });
    expect(new Set(created.weeklySchedule.map(({ id }) => id)).size).toBe(3);

    const retainedId = created.weeklySchedule[1]!.id;
    const omittedIds = [created.weeklySchedule[0]!.id, created.weeklySchedule[2]!.id];
    const saved = await repository.saveWeeklySettings({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      enabled: false,
      channels: ["instagram"],
      informationalFormat: "reel",
      trendFormat: "card_news",
      weeklySchedule: [
        { id: retainedId, dayOfWeek: 2, time: "08:15", sortOrder: 0 },
        { id: null, dayOfWeek: 2, time: "08:15", sortOrder: 1 },
      ],
    });
    expect(saved).toMatchObject({ enabled: false, informationalFormat: "reel", trendFormat: "card_news" });
    expect(saved.weeklySchedule).toEqual([
      { id: retainedId, dayOfWeek: 2, time: "08:15", sortOrder: 0 },
      expect.objectContaining({ dayOfWeek: 2, time: "08:15", sortOrder: 1 }),
    ]);
    expect(saved.weeklySchedule[1]!.id).not.toBe(retainedId);
    const rows = await db.query<{ id: string }>(
      "select id from publish_calendar_weekly_schedule_entries where brand_id=$1 order by id",
      [ids.brand],
    );
    expect(rows.rows.map(({ id }) => id)).not.toEqual(expect.arrayContaining(omittedIds));
  });

  it("changes only enabled and prevents a later configuration save from restoring a stale toggle", async () => {
    const created = await repository.saveWeeklySettings({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      enabled: true,
      channels: ["instagram"],
      informationalFormat: "card_news",
      trendFormat: "reel",
      weeklySchedule: [{ id: null, dayOfWeek: 1, time: "11:30", sortOrder: 0 }],
    });
    const scheduleId = created.weeklySchedule[0]!.id;
    const beforeSettings = await db.query<{
      channels: string[];
      informational_format: string;
      trend_format: string;
    }>(
      "select channels,informational_format,trend_format from publish_calendar_settings where brand_id=$1",
      [ids.brand],
    );
    const beforeSchedule = await db.query<{
      id: string;
      day_of_week: number;
      slot_time: string;
      sort_order: number;
      created_at: string;
      updated_at: string;
    }>(
      `select id,day_of_week,slot_time::text,sort_order,created_at::text,updated_at::text
         from publish_calendar_weekly_schedule_entries where brand_id=$1`,
      [ids.brand],
    );

    await db.query("delete from brand_subscriptions where brand_id=$1", [ids.brand]);
    await db.query("update brand_channels set enabled=false,status='not_connected' where brand_id=$1", [ids.brand]);
    await expect(repository.setWeeklyEnabled({ workspaceId: ids.workspace, brandId: ids.brand, enabled: false }))
      .resolves.toMatchObject({ enabled: false });
    await expect(repository.setWeeklyEnabled({ workspaceId: ids.workspace, brandId: ids.otherBrand, enabled: false }))
      .resolves.toMatchObject({ enabled: false, channels: [], weeklySchedule: [] });

    await expect(db.query(
      "select channels,informational_format,trend_format from publish_calendar_settings where brand_id=$1",
      [ids.brand],
    )).resolves.toEqual(beforeSettings);
    await expect(db.query(
      `select id,day_of_week,slot_time::text,sort_order,created_at::text,updated_at::text
         from publish_calendar_weekly_schedule_entries where brand_id=$1`,
      [ids.brand],
    )).resolves.toEqual(beforeSchedule);
    await expect(repository.setWeeklyEnabled({ workspaceId: ids.workspace, brandId: ids.brand, enabled: true }))
      .rejects.toThrowError("publish_calendar_settings_incomplete");

    await db.query("update brand_channels set enabled=true,status='connected' where brand_id=$1", [ids.brand]);
    await expect(repository.setWeeklyEnabled({ workspaceId: ids.workspace, brandId: ids.brand, enabled: true }))
      .resolves.toMatchObject({ enabled: true });
    await repository.setWeeklyEnabled({ workspaceId: ids.workspace, brandId: ids.brand, enabled: false });
    await db.query(
      "insert into brand_subscriptions values($1,'pro','active','2026-08-01','2026-08-01','2100-01-01')",
      [ids.brand],
    );
    const saved = await repository.saveWeeklyConfiguration({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      channels: ["instagram"],
      informationalFormat: "reel",
      trendFormat: "card_news",
      weeklySchedule: [{ id: scheduleId, dayOfWeek: 2, time: "12:30", sortOrder: 0 }],
    });
    expect(saved).toMatchObject({
      enabled: false,
      informationalFormat: "reel",
      trendFormat: "card_news",
      weeklySchedule: [{ id: scheduleId, dayOfWeek: 2, time: "12:30", sortOrder: 0 }],
    });
  });

  it("rejects a foreign weekly id and rolls the complete settings transaction back", async () => {
    const existing = await repository.saveWeeklySettings({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      enabled: false,
      channels: [],
      informationalFormat: "card_news",
      trendFormat: "reel",
      weeklySchedule: [{ id: null, dayOfWeek: 1, time: "11:30", sortOrder: 0 }],
    });
    const foreign = await db.query<{ id: string }>(
      `insert into publish_calendar_weekly_schedule_entries(workspace_id,brand_id,day_of_week,slot_time,sort_order)
       values($1,$2,3,'20:00',0) returning id`,
      [ids.workspace, ids.otherBrand],
    );

    await expect(repository.saveWeeklySettings({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      enabled: false,
      channels: [],
      informationalFormat: "reel",
      trendFormat: "card_news",
      weeklySchedule: [
        { id: existing.weeklySchedule[0]!.id, dayOfWeek: 1, time: "12:30", sortOrder: 0 },
        { id: foreign.rows[0]!.id, dayOfWeek: 2, time: "13:30", sortOrder: 0 },
      ],
    })).rejects.toThrowError("publish_calendar_weekly_schedule_id_invalid");

    await expect(repository.getWeeklySettings({ workspaceId: ids.workspace, brandId: ids.brand }))
      .resolves.toMatchObject({
        informationalFormat: "card_news",
        trendFormat: "reel",
        weeklySchedule: [{ id: existing.weeklySchedule[0]!.id, dayOfWeek: 1, time: "11:30", sortOrder: 0 }],
      });
  });

  it("stages around an incoming sort order that collides with the old offset", async () => {
    const existing = await repository.saveWeeklySettings({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      enabled: false,
      channels: [],
      informationalFormat: "card_news",
      trendFormat: "reel",
      weeklySchedule: [{ id: null, dayOfWeek: 1, time: "10:00", sortOrder: 0 }],
    });
    const retainedId = existing.weeklySchedule[0]!.id;

    const saved = await repository.saveWeeklySettings({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      enabled: false,
      channels: [],
      informationalFormat: "card_news",
      trendFormat: "reel",
      weeklySchedule: [
        { id: null, dayOfWeek: 1, time: "11:30", sortOrder: 169 },
        { id: retainedId, dayOfWeek: 1, time: "10:00", sortOrder: 0 },
      ],
    });

    expect(saved.weeklySchedule).toEqual([
      { id: retainedId, dayOfWeek: 1, time: "10:00", sortOrder: 0 },
      expect.objectContaining({ dayOfWeek: 1, time: "11:30", sortOrder: 169 }),
    ]);
  });

  it("updates and deletes max-int rows without overflow while accepting arbitrary int32 sort orders", async () => {
    const existing = await repository.saveWeeklySettings({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      enabled: false,
      channels: [],
      informationalFormat: "card_news",
      trendFormat: "reel",
      weeklySchedule: [
        { id: null, dayOfWeek: 1, time: "10:00", sortOrder: 2_147_483_647 },
        { id: null, dayOfWeek: 2, time: "12:00", sortOrder: 2_147_483_647 },
      ],
    });
    const retainedId = existing.weeklySchedule[0]!.id;
    const omittedId = existing.weeklySchedule[1]!.id;
    const before = await db.query<{ created_at: string }>(
      "select created_at from publish_calendar_weekly_schedule_entries where id=$1",
      [retainedId],
    );

    const saved = await repository.saveWeeklySettings({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      enabled: false,
      channels: [],
      informationalFormat: "card_news",
      trendFormat: "reel",
      weeklySchedule: [
        { id: null, dayOfWeek: 1, time: "09:00", sortOrder: 1_500_000_000 },
        { id: retainedId, dayOfWeek: 3, time: "10:30", sortOrder: 2_147_483_647 },
      ],
    });

    expect(saved.weeklySchedule).toEqual([
      expect.objectContaining({ dayOfWeek: 1, time: "09:00", sortOrder: 1_500_000_000 }),
      { id: retainedId, dayOfWeek: 3, time: "10:30", sortOrder: 2_147_483_647 },
    ]);
    await expect(db.query("select id from publish_calendar_weekly_schedule_entries where id=$1", [omittedId]))
      .resolves.toMatchObject({ rows: [] });
    await expect(db.query("select created_at from publish_calendar_weekly_schedule_entries where id=$1", [retainedId]))
      .resolves.toMatchObject({ rows: [{ created_at: before.rows[0]!.created_at }] });
  });

  it("reserves a selected content topic without starting generation or provider publication", async () => {
    await db.query(
      `insert into content_topics(id,workspace_id,brand_id,title,status,selected_instagram_format)
       values($1,$2,$3,'SNS 마케팅 사장님 콘텐츠','selected','instagram_feed_carousel')`,
      [ids.topic, ids.workspace, ids.brand],
    );
    const afterManualSlotProvisioned = vi.fn(async () => undefined);
    const topicRepository = createPublishCalendarRepository(pool, { afterManualSlotProvisioned });
    const input = {
      workspaceId: ids.workspace,
      brandId: ids.brand,
      scheduledFor: new Date("2099-08-15T02:30:00Z"),
      channel: "instagram" as const,
      contentFormat: "card_news" as const,
      idempotencyKey: "manual-selected-topic",
      source: { kind: "existing_content_topic", contentTopicId: ids.topic } as never,
    };

    const before = await topicRepository.getWeeklyUsage({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      at: input.scheduledFor,
    });
    const first = await topicRepository.provisionManualSlot(input);
    await db.query(
      "insert into ai_content_generation_outputs(id,generation_id,workspace_id,brand_id,title,status) values($1,$2,$3,$4,'생성 완료 콘텐츠','completed')",
      [ids.output, ids.generation1, ids.workspace, ids.brand],
    );
    await db.query(
      "update publish_calendar_slots set generation_id=$2,generation_output_id=$3,status='content_assigned' where id=$1",
      [first.id, ids.generation1, ids.output],
    );
    const replay = await topicRepository.provisionManualSlot(input);
    await db.query(
      `insert into content_topics(id,workspace_id,brand_id,title,status,selected_instagram_format)
       values($1,$2,$3,'다른 주제','selected','instagram_feed_carousel')`,
      [ids.otherTopic, ids.workspace, ids.brand],
    );
    await expect(topicRepository.provisionManualSlot({
      ...input,
      source: { kind: "existing_content_topic", contentTopicId: ids.otherTopic } as never,
    })).rejects.toThrow("publish_calendar_idempotency_conflict");
    const after = await topicRepository.getWeeklyUsage({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      at: input.scheduledFor,
    });

    expect(replay.id).toBe(first.id);
    expect(first).toMatchObject({
      status: "generation_pending",
      generationId: null,
      generationOutputId: null,
    });
    expect(first.topicPublishGroupId).not.toBeNull();
    expect(afterManualSlotProvisioned).not.toHaveBeenCalled();
    expect(after.generation).toEqual(before.generation);
    expect(after.publishing.reserved).toBe(before.publishing.reserved + 1);
    const stored = await db.query<{
      topic_status: string;
      group_status: string;
      group_count: number;
      slot_count: number;
    }>(
      `select topic.status topic_status,publish_group.status group_status,
              count(distinct publish_group.id)::integer group_count,
              count(distinct slot.id)::integer slot_count
         from content_topics topic
         join topic_publish_groups publish_group on publish_group.content_topic_id=topic.id
         join publish_calendar_slots slot on slot.topic_publish_group_id=publish_group.id
        where topic.id=$1
        group by topic.status,publish_group.status`,
      [ids.topic],
    );
    expect(stored.rows[0]).toEqual({
      topic_status: "selected",
      group_status: "waiting",
      group_count: 1,
      slot_count: 1,
    });
  });

  it("reuses the selected content topic's existing waiting publish group", async () => {
    const groupId = "70000000-0000-4000-8000-000000000001";
    await db.query(
      `insert into content_topics(id,workspace_id,brand_id,title,status,selected_instagram_format)
       values($1,$2,$3,'기존 그룹 주제','selected','instagram_reel')`,
      [ids.topic, ids.workspace, ids.brand],
    );
    await db.query(
      `insert into topic_publish_groups(id,workspace_id,brand_id,content_topic_id,status)
       values($1,$2,$3,$4,'waiting')`,
      [groupId, ids.workspace, ids.brand, ids.topic],
    );

    const slot = await repository.provisionManualSlot({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      scheduledFor: new Date("2099-08-16T02:30:00Z"),
      channel: "instagram",
      contentFormat: "reel",
      idempotencyKey: "manual-existing-topic-group",
      source: { kind: "existing_content_topic", contentTopicId: ids.topic },
    });

    expect(slot).toMatchObject({
      topicPublishGroupId: groupId,
      status: "generation_pending",
    });
    await expect(db.query("select count(*)::integer count from topic_publish_groups"))
      .resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it("replays an existing-generation key after output and topic lineage are linked", async () => {
    const input = manualGenerationInput({ idempotencyKey: "manual-generation-after-lineage" });
    const original = await repository.provisionManualSlot(input);
    await db.query(
      `insert into content_topics(id,workspace_id,brand_id,title,status,selected_instagram_format)
       values($1,$2,$3,'생성 연결 주제','generated','instagram_feed_carousel')`,
      [ids.topic, ids.workspace, ids.brand],
    );
    const group = await db.query<{ id: string }>(
      `insert into topic_publish_groups(workspace_id,brand_id,content_topic_id,status)
       values($1,$2,$3,'waiting') returning id`,
      [ids.workspace, ids.brand, ids.topic],
    );
    await db.query(
      "insert into ai_content_generation_outputs(id,generation_id,workspace_id,brand_id,title,status) values($1,$2,$3,$4,'생성 완료 콘텐츠','completed')",
      [ids.output, ids.generation1, ids.workspace, ids.brand],
    );
    await db.query(
      `update publish_calendar_slots
          set generation_output_id=$2,topic_publish_group_id=$3,status='content_assigned'
        where id=$1`,
      [original.id, ids.output, group.rows[0]?.id],
    );

    await expect(repository.provisionManualSlot(input)).resolves.toMatchObject({
      id: original.id,
      generationId: ids.generation1,
      generationOutputId: ids.output,
      topicPublishGroupId: group.rows[0]?.id,
    });
  });

  it("replays a Release A v1 manual key through lineage compatibility", async () => {
    const input = manualGenerationInput({ idempotencyKey: "release-a-manual-replay" });
    const inserted = await db.query<{ id: string }>(
      `insert into publish_calendar_slots(
         workspace_id,brand_id,scheduled_for,assignment_mode,status,recommendation_kind,
         content_format,channels,generation_id,title,idempotency_key
       ) values($1,$2,$3,'manual','generation_pending',null,'card_news',array['instagram'],$4,'기존 예약',$5)
       returning id`,
      [ids.workspace, ids.brand, input.scheduledFor, ids.generation1, manualSlotKey(input.idempotencyKey)],
    );

    await expect(repository.provisionManualSlot(input)).resolves.toMatchObject({
      id: inserted.rows[0]?.id,
      generationId: ids.generation1,
    });
  });

  it("rejects changing a manual request source kind after lifecycle enrichment", async () => {
    const input = manualGenerationInput({ idempotencyKey: "manual-source-kind-after-lineage" });
    const original = await repository.provisionManualSlot(input);
    await db.query(
      "insert into ai_content_generation_outputs(id,generation_id,workspace_id,brand_id,title,status) values($1,$2,$3,$4,'생성 완료 콘텐츠','completed')",
      [ids.output, ids.generation1, ids.workspace, ids.brand],
    );
    await db.query(
      "update publish_calendar_slots set generation_output_id=$2,status='content_assigned' where id=$1",
      [original.id, ids.output],
    );

    await expect(repository.provisionManualSlot({
      ...input,
      source: { kind: "existing_output", generationOutputId: ids.output },
    })).rejects.toThrow("publish_calendar_idempotency_conflict");
  });

  it.each([
    ["another workspace", ids.topic, "90000000-0000-4000-8000-000000000001", ids.brand, "selected", "instagram_feed_carousel", "card_news"],
    ["another brand", ids.topic, ids.workspace, "90000000-0000-4000-8000-000000000002", "selected", "instagram_feed_carousel", "card_news"],
    ["non-selected status", ids.topic, ids.workspace, ids.brand, "generating", "instagram_feed_carousel", "card_news"],
    ["format mismatch", ids.topic, ids.workspace, ids.brand, "selected", "instagram_reel", "card_news"],
  ])("rejects a content topic from %s", async (_label, topicId, workspaceId, brandId, status, selectedFormat, contentFormat) => {
    await db.query(
      `insert into content_topics(id,workspace_id,brand_id,title,status,selected_instagram_format)
       values($1,$2,$3,'차단 대상',$4,$5)`,
      [topicId, workspaceId, brandId, status, selectedFormat],
    );

    await expect(repository.provisionManualSlot({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      scheduledFor: new Date("2099-08-15T02:30:00Z"),
      channel: "instagram",
      contentFormat: contentFormat as "card_news",
      idempotencyKey: `topic-rejected-${_label}`,
      source: { kind: "existing_content_topic", contentTopicId: topicId } as never,
    })).rejects.toThrow("publish_calendar_content_not_assignable");
    await expect(db.query("select count(*)::integer count from topic_publish_groups"))
      .resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  it("atomically creates same-time batch rows for distinct publication sources", async () => {
    const slots = await repository.provisionManualSlotsBatch({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      idempotencyKey: "batch-pglite",
      rows: [
        { clientRowId: "row-1", scheduledFor: new Date("2099-08-15T02:30:00Z"), channel: "instagram", contentFormat: "card_news", source: { kind: "existing_generation", generationId: ids.generation1 } },
        { clientRowId: "row-2", scheduledFor: new Date("2099-08-15T02:30:00Z"), channel: "instagram", contentFormat: "reel", source: { kind: "existing_generation", generationId: ids.generation2 } },
      ],
    });
    expect(slots.map((slot) => slot.status)).toEqual(["generation_pending", "generation_pending"]);
    const stored = await db.query<{ count: number; open_count: number; key_count: number }>(
      "select count(*)::integer count,count(*) filter(where status='open')::integer open_count,count(distinct idempotency_key)::integer key_count from publish_calendar_slots",
    );
    expect(stored.rows[0]).toEqual({ count: 2, open_count: 0, key_count: 2 });
  });

  it("rejects changing a batch row source kind after lifecycle enrichment", async () => {
    const input = {
      workspaceId: ids.workspace,
      brandId: ids.brand,
      idempotencyKey: "batch-source-kind-after-lineage",
      rows: [{
        clientRowId: "row-1",
        scheduledFor: new Date("2099-08-15T02:30:00Z"),
        channel: "instagram" as const,
        contentFormat: "card_news" as const,
        source: { kind: "existing_generation" as const, generationId: ids.generation1 },
      }],
    };
    const [original] = await repository.provisionManualSlotsBatch(input);
    await db.query(
      "insert into ai_content_generation_outputs(id,generation_id,workspace_id,brand_id,title,status) values($1,$2,$3,$4,'생성 완료 콘텐츠','completed')",
      [ids.output, ids.generation1, ids.workspace, ids.brand],
    );
    await db.query(
      "update publish_calendar_slots set generation_output_id=$2,status='content_assigned' where id=$1",
      [original.id, ids.output],
    );

    await expect(repository.provisionManualSlotsBatch({
      ...input,
      rows: [{ ...input.rows[0], source: { kind: "existing_output", generationOutputId: ids.output } }],
    })).rejects.toThrow("publish_calendar_idempotency_conflict");
  });

  it("creates two same-time manual reservations, counts two units, and does not recount replay", async () => {
    const firstInput = manualGenerationInput({ idempotencyKey: "same-time-manual-1" });
    const secondInput = manualGenerationInput({
      idempotencyKey: "same-time-manual-2",
      generationId: ids.generation2,
      contentFormat: "reel",
    });

    const first = await repository.provisionManualSlot(firstInput);
    const second = await repository.provisionManualSlot(secondInput);
    const replay = await repository.provisionManualSlot(firstInput);
    const usage = await repository.getWeeklyUsage({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      at: firstInput.scheduledFor,
    });

    expect(first.id).not.toBe(second.id);
    expect(first.scheduledFor).toBe(second.scheduledFor);
    expect(replay.id).toBe(first.id);
    expect(usage.publishing.reserved).toBe(2);
  });

  it("reschedules one durable slot, group, and queue atomically without creating another reservation", async () => {
    const original = await repository.provisionManualSlot(manualGenerationInput({ idempotencyKey: "reschedule-pglite" }));
    await db.query(
      `insert into content_topics(id,workspace_id,brand_id,title,status,selected_instagram_format)
       values($1,$2,$3,'예약 변경 검증','selected','instagram_feed_carousel')`,
      [ids.topic, ids.workspace, ids.brand],
    );
    const group = await db.query<{ id: string }>(
      `insert into topic_publish_groups(workspace_id,brand_id,content_topic_id,status,slot_date,scheduled_for)
       values($1,$2,$3,'scheduled','2099-08-15',$4) returning id`,
      [ids.workspace, ids.brand, ids.topic, original.scheduledFor],
    );
    await db.query(
      `insert into publish_queue(workspace_id,brand_id,topic_publish_group_id,status,slot_date,scheduled_for)
       values($1,$2,$3,'scheduled','2099-08-15',$4)`,
      [ids.workspace, ids.brand, group.rows[0]?.id, original.scheduledFor],
    );
    await db.query(
      `update publish_calendar_slots
          set topic_publish_group_id=$2,status='scheduled',assignment_mode='automatic',
              recommendation_kind='informational'
        where id=$1`,
      [original.id, group.rows[0]?.id],
    );
    const target = new Date("2099-08-22T18:40:00.000Z");

    await expect(repository.rescheduleSlot({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      slotId: original.id,
      scheduledFor: target,
    })).resolves.toMatchObject({
      id: original.id,
      scheduledFor: target.toISOString(),
      assignmentMode: "manual",
    });

    const slot = await db.query<{ scheduled_for: string; assignment_mode: string; recommendation_kind: string | null }>(
      "select scheduled_for,assignment_mode,recommendation_kind from publish_calendar_slots where id=$1",
      [original.id],
    );
    const storedGroup = await db.query<{ scheduled_for: string; slot_date: string }>(
      "select scheduled_for,slot_date::text from topic_publish_groups where id=$1",
      [group.rows[0]?.id],
    );
    const queue = await db.query<{ scheduled_for: string; slot_date: string }>(
      "select scheduled_for,slot_date::text from publish_queue where topic_publish_group_id=$1",
      [group.rows[0]?.id],
    );
    const count = await db.query<{ count: number }>("select count(*)::integer count from publish_calendar_slots");
    expect(new Date(slot.rows[0]!.scheduled_for).toISOString()).toBe(target.toISOString());
    expect(slot.rows[0]?.assignment_mode).toBe("manual");
    expect(slot.rows[0]?.recommendation_kind).toBeNull();
    expect(new Date(storedGroup.rows[0]!.scheduled_for).toISOString()).toBe(target.toISOString());
    expect(new Date(queue.rows[0]!.scheduled_for).toISOString()).toBe(target.toISOString());
    expect(storedGroup.rows[0]?.slot_date).toBe("2099-08-23");
    expect(queue.rows[0]?.slot_date).toBe("2099-08-23");
    expect(count.rows[0]?.count).toBe(1);
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
       set generation_id=null,generation_output_id='40000000-0000-4000-8000-000000000099' where id=$1`],
    ["source id", `update publish_calendar_slots
       set generation_id='30000000-0000-4000-8000-000000000002' where id=$1`],
  ])("rejects a keyed replay whose %s differs", async (_label, mutation) => {
    const input = manualGenerationInput({ idempotencyKey: `manual-conflict-${_label}` });
    const original = await repository.provisionManualSlot(input);
    await db.query(mutation, [original.id]);

    await expect(repository.provisionManualSlot(input))
      .rejects.toThrow("publish_calendar_idempotency_conflict");
  });

  it("allows nearby times inside one batch", async () => {
    const slots = await repository.provisionManualSlotsBatch({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      idempotencyKey: "batch-spacing",
      rows: [
        { clientRowId: "row-1", scheduledFor: new Date("2099-08-15T02:30:00Z"), channel: "instagram", contentFormat: "card_news", source: { kind: "existing_generation", generationId: ids.generation1 } },
        { clientRowId: "row-2", scheduledFor: new Date("2099-08-15T02:59:00Z"), channel: "instagram", contentFormat: "reel", source: { kind: "existing_generation", generationId: ids.generation2 } },
      ],
    });
    const stored = await db.query<{ count: number }>("select count(*)::integer count from publish_calendar_slots");
    expect(slots).toHaveLength(2);
    expect(stored.rows[0]?.count).toBe(2);
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

});
