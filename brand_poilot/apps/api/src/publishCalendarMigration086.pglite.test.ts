import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublishCalendarAllocator } from "./publishCalendarAllocator.js";
import { createPublishCalendarRepository } from "./publishCalendarRepository.js";

const migration079Path = resolve(process.cwd(), "../../db/migrations/079_publish_calendar_runtime.sql");
const migration085Path = resolve(process.cwd(), "../../db/migrations/085_publish_calendar_idempotency_expand.sql");
const migration086Path = resolve(process.cwd(), "../../db/migrations/086_publish_calendar_same_time_contract.sql");

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

async function bootstrap(database: PGlite) {
  await database.exec(`
    create function set_updated_at() returns trigger language plpgsql as $$
    begin new.updated_at=now(); return new; end; $$;
    create function assert_ai_content_writable() returns void language sql as $$ select $$;

    create table workspaces(id uuid primary key default gen_random_uuid());
    create table brands(
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references workspaces(id) on delete cascade
    );
    create table app_users(id uuid primary key default gen_random_uuid());
    create table ai_content_proposals(
      id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null
    );
    create table content_suggestions(id uuid primary key default gen_random_uuid());
    create table ai_content_generations(
      id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null
    );
    create table ai_content_generation_outputs(
      id uuid primary key default gen_random_uuid(), generation_id uuid not null,
      workspace_id uuid not null, brand_id uuid not null
    );
    create table topic_publish_groups(
      id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null
    );
    create table brand_channels(
      id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
      channel text not null, enabled boolean not null, status text not null, deleted_at timestamptz null
    );
    create table channel_outputs(
      id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
      ai_content_generation_output_id uuid null, content_topic_id uuid null
    );
    create table publish_queue(
      id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
      channel_output_id uuid null, topic_publish_group_id uuid null, status text not null,
      scheduled_for timestamptz null, queued_at timestamptz not null default now(), published_at timestamptz null
    );
    create table ai_content_write_fence_catalog(
      relation_name text primary key,
      relation_class text not null,
      row_classifier text not null,
      reviewed_at timestamptz not null default now()
    );
    create function enforce_ai_content_write_fence() returns trigger language plpgsql as $$
    begin return new; end; $$;
  `);
}

async function loadThrough086(database: PGlite) {
  await database.exec(await readFile(migration079Path, "utf8"));
  await database.exec(await readFile(migration085Path, "utf8"));
  await database.exec(await readFile(migration086Path, "utf8"));
}

describe("migration 086 publish calendar same-time contract", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = await PGlite.create({ extensions: { pgcrypto } });
    await bootstrap(database);
    await loadThrough086(database);
  }, 30_000);

  afterAll(async () => database?.close());

  it("allows two active slots for one brand at the same scheduled instant", async () => {
    const workspaceId = "10000000-0000-4000-8000-000000000086";
    const brandId = "20000000-0000-4000-8000-000000000086";
    const scheduledFor = "2026-08-22T02:30:00.000Z";
    await database.query("insert into workspaces(id) values($1)", [workspaceId]);
    await database.query("insert into brands(id,workspace_id) values($1,$2)", [brandId, workspaceId]);

    await expect(database.query(
      `insert into publish_calendar_slots(
         workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,idempotency_key
       ) values($1,$2,$3,'automatic','open','card_news','automatic:informational')`,
      [workspaceId, brandId, scheduledFor],
    )).resolves.toBeTruthy();
    await expect(database.query(
      `insert into publish_calendar_slots(
         workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,idempotency_key
       ) values($1,$2,$3,'automatic','open','reel','automatic:trend')`,
      [workspaceId, brandId, scheduledFor],
    )).resolves.toBeTruthy();
  });

  it("allows distinct outputs from one generation but rejects the same output twice", async () => {
    const workspaceId = "10000000-0000-4000-8000-000000000087";
    const brandId = "20000000-0000-4000-8000-000000000087";
    const generationId = "40000000-0000-4000-8000-000000000087";
    const outputA = "50000000-0000-4000-8000-000000000087";
    const outputB = "50000000-0000-4000-8000-000000000088";
    await database.query("insert into workspaces(id) values($1)", [workspaceId]);
    await database.query("insert into brands(id,workspace_id) values($1,$2)", [brandId, workspaceId]);
    await database.query(
      "insert into ai_content_generations(id,workspace_id,brand_id) values($1,$2,$3)",
      [generationId, workspaceId, brandId],
    );
    await database.query(
      `insert into ai_content_generation_outputs(id,generation_id,workspace_id,brand_id)
       values($1,$2,$3,$4),($5,$2,$3,$4)`,
      [outputA, generationId, workspaceId, brandId, outputB],
    );

    const insertOutput = (outputId: string, scheduledFor: string) => database.query(
      `insert into publish_calendar_slots(
         workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,generation_id,generation_output_id
       ) values($1,$2,$3,'manual','content_assigned','card_news',$4,$5)`,
      [workspaceId, brandId, scheduledFor, generationId, outputId],
    );
    await expect(insertOutput(outputA, "2026-08-22T03:30:00.000Z")).resolves.toBeTruthy();
    await expect(insertOutput(outputB, "2026-08-22T04:30:00.000Z")).resolves.toBeTruthy();
    await expect(insertOutput(outputA, "2026-08-22T05:30:00.000Z")).rejects.toThrow();
  });

  it("keeps generation-level slots unique when generation_output_id is null", async () => {
    const workspaceId = "10000000-0000-4000-8000-000000000089";
    const brandId = "20000000-0000-4000-8000-000000000089";
    const generationId = "40000000-0000-4000-8000-000000000089";
    await database.query("insert into workspaces(id) values($1)", [workspaceId]);
    await database.query("insert into brands(id,workspace_id) values($1,$2)", [brandId, workspaceId]);
    await database.query(
      "insert into ai_content_generations(id,workspace_id,brand_id) values($1,$2,$3)",
      [generationId, workspaceId, brandId],
    );

    const insertGeneration = (scheduledFor: string) => database.query(
      `insert into publish_calendar_slots(
         workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,generation_id
       ) values($1,$2,$3,'manual','generation_pending','card_news',$4)`,
      [workspaceId, brandId, scheduledFor, generationId],
    );
    await expect(insertGeneration("2026-08-22T06:30:00.000Z")).resolves.toBeTruthy();
    await expect(insertGeneration("2026-08-22T07:30:00.000Z")).rejects.toThrow();
  });

  it("removes the brand-time index and narrows only the generation index", async () => {
    const indexes = await database.query<{ indexname: string; indexdef: string }>(
      `select indexname,indexdef
         from pg_indexes
        where schemaname='public' and tablename='publish_calendar_slots'`,
    );
    const byName = new Map(indexes.rows.map(({ indexname, indexdef }) => [indexname, indexdef]));

    expect(byName.has("publish_calendar_slots_active_brand_time_unique")).toBe(false);
    expect(byName.get("publish_calendar_slots_generation_unique")).toMatch(
      /where .*generation_id is not null.*generation_output_id is null.*status <> 'cancelled'/i,
    );
    expect(byName.get("publish_calendar_slots_generation_output_unique")).toMatch(
      /where .*generation_output_id is not null.*status <> 'cancelled'/i,
    );
  });

  it("keeps allocator persistence idempotent for duplicate and near-time weekly rows", async () => {
    const workspaceId = "10000000-0000-4000-8000-000000000090";
    const brandId = "20000000-0000-4000-8000-000000000090";
    await database.query("insert into workspaces(id) values($1)", [workspaceId]);
    await database.query("insert into brands(id,workspace_id) values($1,$2)", [brandId, workspaceId]);
    await database.query(
      `insert into brand_channels(workspace_id,brand_id,channel,enabled,status)
       values($1,$2,'instagram',true,'connected')`,
      [workspaceId, brandId],
    );
    await database.query(
      `insert into billing_plan_catalog(code,name,weekly_generation_limit,weekly_publish_limit)
       values('rollback_fixture','Rollback fixture',100,100)`,
    );
    await database.query(
      `insert into brand_subscriptions(
         brand_id,plan_code,status,started_at,current_period_start,current_period_end
       ) values($1,'rollback_fixture','active','2026-01-01','2026-01-01','2100-01-01')`,
      [brandId],
    );

    const repository = createPublishCalendarRepository(pool(database));
    const automaticBrand = {
      workspaceId,
      brandId,
      subscriptionPlan: {
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        weeklyGenerationLimit: 100,
        weeklyPublishLimit: 100,
      },
      settings: {
        brandId,
        enabled: true,
        channels: ["instagram" as const],
        informationalFormat: "card_news" as const,
        trendFormat: "reel" as const,
        weeklySchedule: [
          { id: "30000000-0000-4000-8000-000000000086", dayOfWeek: 4 as const, time: "11:30", sortOrder: 0 },
          { id: "30000000-0000-4000-8000-000000000087", dayOfWeek: 4 as const, time: "11:30", sortOrder: 1 },
          { id: "30000000-0000-4000-8000-000000000088", dayOfWeek: 4 as const, time: "11:31", sortOrder: 2 },
        ],
        updatedAt: "2099-08-12T00:00:00.000Z",
      },
    };
    const allocator = createPublishCalendarAllocator({
      ...repository,
      listEnabledBrands: async () => [automaticBrand],
      listUnassignedRecommendations: async () => [],
    });

    const first = await allocator.allocateBrand(automaticBrand, new Date("2099-08-12T19:00:00.000Z"));
    const second = await allocator.allocateBrand(automaticBrand, new Date("2099-08-13T19:00:00.000Z"));
    const stored = await database.query<{
      id: string;
      publish_item_key: string;
      scheduled_for: Date;
    }>(
      `select id,idempotency_key as publish_item_key,scheduled_for
         from publish_calendar_slots
        where workspace_id=$1 and brand_id=$2
        order by scheduled_for,publish_item_key`,
      [workspaceId, brandId],
    );
    const publishItemKeys = stored.rows.map(({ publish_item_key }) => publish_item_key);
    const slotIds = stored.rows.map(({ id }) => id);
    const nextHorizon = stored.rows.filter(({ scheduled_for }) => (
      new Date(scheduled_for).toISOString() >= "2099-08-20T00:00:00.000Z"
    ));

    expect(first.openSlotsCreated).toBe(3);
    expect(second.openSlotsCreated).toBe(3);
    expect(stored.rows).toHaveLength(6);
    expect(new Set(publishItemKeys).size).toBe(6);
    expect(new Set(slotIds).size).toBe(6);
    expect(nextHorizon.map(({ scheduled_for }) => new Date(scheduled_for).toISOString())).toEqual([
      "2099-08-20T02:30:00.000Z",
      "2099-08-20T02:30:00.000Z",
      "2099-08-20T02:31:00.000Z",
    ]);
    expect(new Set(nextHorizon.map(({ publish_item_key }) => publish_item_key)).size).toBe(3);
  });
});
