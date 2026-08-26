import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration079Path = resolve(process.cwd(), "../../db/migrations/079_publish_calendar_runtime.sql");
const migration085Path = resolve(process.cwd(), "../../db/migrations/085_publish_calendar_idempotency_expand.sql");
const migration086Path = resolve(process.cwd(), "../../db/migrations/086_publish_calendar_same_time_contract.sql");
const migration092Path = resolve(process.cwd(), "../../db/migrations/092_publish_calendar_weekly_schedule.sql");

async function bootstrap(database: PGlite) {
  await database.exec(`
    create function set_updated_at() returns trigger language plpgsql as $$
    begin new.updated_at=now(); return new; end; $$;

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
    create table ai_content_write_fence_catalog(
      relation_name text primary key,
      relation_class text not null,
      row_classifier text not null,
      reviewed_at timestamptz not null default now()
    );
    create function enforce_ai_content_write_fence() returns trigger language plpgsql as $$
    begin return case when tg_op='DELETE' then old else new end; end; $$;
  `);
}

describe("migration 092 publish calendar weekly schedule", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = await PGlite.create({ extensions: { pgcrypto } });
    await bootstrap(database);
    for (const migrationPath of [migration079Path, migration085Path, migration086Path, migration092Path]) {
      await database.exec(await readFile(migrationPath, "utf8"));
    }
  }, 30_000);

  afterAll(async () => database?.close());

  it("creates the weekly schedule table without altering settings slot_times or reservations", async () => {
    const columns = await database.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `select column_name,data_type,is_nullable
         from information_schema.columns
        where table_schema='public' and table_name='publish_calendar_weekly_schedule_entries'
        order by ordinal_position`,
    );
    expect(columns.rows).toEqual([
      { column_name: "id", data_type: "uuid", is_nullable: "NO" },
      { column_name: "workspace_id", data_type: "uuid", is_nullable: "NO" },
      { column_name: "brand_id", data_type: "uuid", is_nullable: "NO" },
      { column_name: "day_of_week", data_type: "smallint", is_nullable: "NO" },
      { column_name: "slot_time", data_type: "time without time zone", is_nullable: "NO" },
      { column_name: "sort_order", data_type: "integer", is_nullable: "NO" },
      { column_name: "created_at", data_type: "timestamp with time zone", is_nullable: "NO" },
      { column_name: "updated_at", data_type: "timestamp with time zone", is_nullable: "NO" },
    ]);

    const preserved = await database.query<{ settings_slot_times: boolean; reservations: boolean }>(
      `select
         exists(select 1 from information_schema.columns
                 where table_schema='public' and table_name='publish_calendar_settings'
                   and column_name='slot_times') settings_slot_times,
         to_regclass('public.publish_calendar_slots') is not null reservations`,
    );
    expect(preserved.rows[0]).toEqual({ settings_slot_times: true, reservations: true });
  });

  it("enforces workspace and brand scope with the existing publish-calendar function", async () => {
    const workspaceA = "10000000-0000-4000-8000-000000000091";
    const workspaceB = "10000000-0000-4000-8000-000000000092";
    const brandId = "20000000-0000-4000-8000-000000000091";
    await database.query("insert into workspaces(id) values($1),($2)", [workspaceA, workspaceB]);
    await database.query("insert into brands(id,workspace_id) values($1,$2)", [brandId, workspaceA]);

    await expect(database.query(
      `insert into publish_calendar_weekly_schedule_entries(
         workspace_id,brand_id,day_of_week,slot_time,sort_order
       ) values($1,$2,1,'11:30',0)`,
      [workspaceA, brandId],
    )).resolves.toBeTruthy();
    await expect(database.query(
      `insert into publish_calendar_weekly_schedule_entries(
         workspace_id,brand_id,day_of_week,slot_time,sort_order
       ) values($1,$2,1,'12:30',1)`,
      [workspaceB, brandId],
    )).rejects.toThrow("publish_calendar_brand_scope_invalid");

    const trigger = await database.query<{ definition: string }>(
      `select pg_get_triggerdef(trigger_row.oid,true) definition
         from pg_trigger trigger_row
         join pg_class relation on relation.oid=trigger_row.tgrelid
        where relation.relname='publish_calendar_weekly_schedule_entries'
          and trigger_row.tgname='publish_calendar_weekly_schedule_entries_brand_scope'`,
    );
    expect(trigger.rows[0]?.definition).toMatch(
      /before insert or update of workspace_id, brand_id.*enforce_publish_calendar_brand_scope\(\)/i,
    );
  });

  it("enforces day and sort order while allowing duplicate times", async () => {
    const workspaceId = "10000000-0000-4000-8000-000000000093";
    const brandId = "20000000-0000-4000-8000-000000000093";
    await database.query("insert into workspaces(id) values($1)", [workspaceId]);
    await database.query("insert into brands(id,workspace_id) values($1,$2)", [brandId, workspaceId]);
    const insert = (day: number, time: string, sortOrder: number) => database.query(
      `insert into publish_calendar_weekly_schedule_entries(
         workspace_id,brand_id,day_of_week,slot_time,sort_order
       ) values($1,$2,$3,$4,$5)`,
      [workspaceId, brandId, day, time, sortOrder],
    );

    await expect(insert(0, "11:30", 0)).rejects.toThrow();
    await expect(insert(8, "11:30", 0)).rejects.toThrow();
    await expect(insert(1, "11:30", -1)).rejects.toThrow();
    await expect(insert(1, "11:30", 0)).resolves.toBeTruthy();
    await expect(insert(1, "11:30", 1)).resolves.toBeTruthy();
    await expect(insert(1, "12:30", 1)).rejects.toThrow();

    const stored = await database.query<{ slot_time: string; sort_order: number }>(
      `select slot_time::text,sort_order
         from publish_calendar_weekly_schedule_entries
        where brand_id=$1 order by sort_order`,
      [brandId],
    );
    expect(stored.rows).toEqual([
      { slot_time: "11:30:00", sort_order: 0 },
      { slot_time: "11:30:00", sort_order: 1 },
    ]);
  });

  it("registers the whole relation in the AI-content write fence and covers every write operation", async () => {
    const fence = await database.query<{
      relation_name: string;
      relation_class: string;
      row_classifier: string;
    }>(
      `select relation_name,relation_class,row_classifier
         from ai_content_write_fence_catalog
        where relation_name='publish_calendar_weekly_schedule_entries'`,
    );
    expect(fence.rows).toEqual([{
      relation_name: "publish_calendar_weekly_schedule_entries",
      relation_class: "customer_execution",
      row_classifier: "whole_relation",
    }]);

    const trigger = await database.query<{ definition: string }>(
      `select pg_get_triggerdef(trigger_row.oid,true) definition
         from pg_trigger trigger_row
         join pg_class relation on relation.oid=trigger_row.tgrelid
        where relation.relname='publish_calendar_weekly_schedule_entries'
          and trigger_row.tgname='publish_calendar_weekly_schedule_entries_write_fence'`,
    );
    expect(trigger.rows[0]?.definition).toMatch(
      /before insert or delete or update.*enforce_ai_content_write_fence\(\)/i,
    );
  });
});
