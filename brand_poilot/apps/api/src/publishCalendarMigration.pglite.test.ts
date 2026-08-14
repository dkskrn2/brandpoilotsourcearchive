import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationPath = resolve(process.cwd(), "../../db/migrations/079_publish_calendar_runtime.sql");

async function columns(database: PGlite, relation: string) {
  const result = await database.query<{ column_name: string }>(
    `select column_name
       from information_schema.columns
      where table_schema='public' and table_name=$1
      order by ordinal_position`,
    [relation],
  );
  return result.rows.map(({ column_name }) => column_name);
}

describe("migration 079 publish calendar runtime", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = await PGlite.create({ extensions: { pgcrypto } });
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
      begin return new; end; $$;
    `);
    await database.exec(await readFile(migrationPath, "utf8"));
  }, 30_000);

  afterAll(async () => database?.close());

  it("creates subscription, settings, and slot relations with runtime columns", async () => {
    expect(await columns(database, "billing_plan_catalog")).toEqual(expect.arrayContaining([
      "code", "name", "weekly_generation_limit", "weekly_publish_limit", "active",
    ]));
    expect(await columns(database, "brand_subscriptions")).toEqual(expect.arrayContaining([
      "brand_id", "plan_code", "status", "started_at", "current_period_start", "current_period_end", "pending_plan_code",
    ]));
    expect(await columns(database, "publish_calendar_settings")).toEqual(expect.arrayContaining([
      "enabled", "channels", "informational_format", "trend_format", "slot_times",
    ]));
    expect(await columns(database, "publish_calendar_slots")).toEqual(expect.arrayContaining([
      "scheduled_for", "assignment_mode", "status", "content_suggestion_id", "proposal_id", "generation_id", "generation_output_id", "topic_publish_group_id",
    ]));
  });

  it("keeps automatic settings off and does not invent plan limits", async () => {
    const settingsDefault = await database.query<{ column_default: string }>(
      `select column_default from information_schema.columns
        where table_schema='public' and table_name='publish_calendar_settings' and column_name='enabled'`,
    );
    const plans = await database.query<{ count: number }>("select count(*)::integer as count from billing_plan_catalog");
    expect(settingsDefault.rows[0]?.column_default).toBe("false");
    expect(plans.rows[0]?.count).toBe(0);
  });

  it("enforces one slot per brand and scheduled instant", async () => {
    const workspaceId = "10000000-0000-4000-8000-000000000079";
    const brandId = "20000000-0000-4000-8000-000000000079";
    await database.query("insert into workspaces(id) values($1)", [workspaceId]);
    await database.query("insert into brands(id,workspace_id) values($1,$2)", [brandId, workspaceId]);
    const values = [workspaceId, brandId, "2026-08-14T02:30:00.000Z"];
    await database.query(
      `insert into publish_calendar_slots(workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format)
       values($1,$2,$3,'automatic','open','card_news')`,
      values,
    );
    await expect(database.query(
      `insert into publish_calendar_slots(workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format)
       values($1,$2,$3,'manual','content_assigned','card_news')`,
      values,
    )).rejects.toThrow();
    await database.query(
      "update publish_calendar_slots set status='cancelled' where brand_id=$1 and scheduled_for=$2",
      [brandId, values[2]],
    );
    await expect(database.query(
      `insert into publish_calendar_slots(workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format)
       values($1,$2,$3,'manual','open','card_news')`,
      values,
    )).resolves.toBeTruthy();
  });

  it("rejects every cross-tenant slot binding and requires outputs to match the bound generation", async () => {
    const workspaceA = "10000000-0000-4000-8000-000000000101";
    const workspaceB = "10000000-0000-4000-8000-000000000102";
    const brandA = "20000000-0000-4000-8000-000000000101";
    const brandB = "20000000-0000-4000-8000-000000000102";
    const proposalA = "30000000-0000-4000-8000-000000000101";
    const proposalB = "30000000-0000-4000-8000-000000000102";
    const generationA = "40000000-0000-4000-8000-000000000101";
    const generationB = "40000000-0000-4000-8000-000000000102";
    const outputA = "50000000-0000-4000-8000-000000000101";
    const outputB = "50000000-0000-4000-8000-000000000102";
    const groupA = "60000000-0000-4000-8000-000000000101";
    const groupB = "60000000-0000-4000-8000-000000000102";
    await database.query("insert into workspaces(id) values($1),($2)", [workspaceA, workspaceB]);
    await database.query("insert into brands(id,workspace_id) values($1,$2),($3,$4)", [brandA, workspaceA, brandB, workspaceB]);
    await database.query(
      "insert into ai_content_proposals(id,workspace_id,brand_id) values($1,$2,$3),($4,$5,$6)",
      [proposalA, workspaceA, brandA, proposalB, workspaceB, brandB],
    );
    await database.query(
      "insert into ai_content_generations(id,workspace_id,brand_id) values($1,$2,$3),($4,$5,$6)",
      [generationA, workspaceA, brandA, generationB, workspaceB, brandB],
    );
    await database.query(
      "insert into ai_content_generation_outputs(id,generation_id,workspace_id,brand_id) values($1,$2,$3,$4),($5,$6,$7,$8)",
      [outputA, generationA, workspaceA, brandA, outputB, generationB, workspaceB, brandB],
    );
    await database.query(
      "insert into topic_publish_groups(id,workspace_id,brand_id) values($1,$2,$3),($4,$5,$6)",
      [groupA, workspaceA, brandA, groupB, workspaceB, brandB],
    );
    const invalidBindings = [
      { proposal: proposalB, generation: null, output: null, group: null },
      { proposal: null, generation: generationB, output: null, group: null },
      { proposal: null, generation: generationA, output: outputB, group: null },
      { proposal: null, generation: null, output: outputA, group: null },
    ];
    for (const [index, binding] of invalidBindings.entries()) {
      await expect(database.query(
        `insert into publish_calendar_slots(
           workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,
           proposal_id,generation_id,generation_output_id,topic_publish_group_id
         ) values($1,$2,$3,'manual','content_assigned','card_news',$4,$5,$6,$7)`,
        [workspaceA, brandA, `2026-09-${String(index + 1).padStart(2, "0")}T02:30:00.000Z`,
          binding.proposal, binding.generation, binding.output, binding.group],
      )).rejects.toThrow(/publish_calendar_slot_scope_invalid/);
    }
    await expect(database.query(
      `insert into publish_calendar_slots(
         workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,topic_publish_group_id
       ) values($1,$2,$3,'manual','content_assigned','card_news',$4)`,
      [workspaceA, brandA, "2026-09-10T02:30:00.000Z", groupB],
    )).rejects.toThrow();
    await expect(database.query(
      `insert into publish_calendar_slots(
         workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,
         proposal_id,generation_id,generation_output_id,topic_publish_group_id
       ) values($1,$2,$3,'manual','content_assigned','card_news',$4,$5,$6,$7)`,
      [workspaceA, brandA, "2026-09-20T02:30:00.000Z", proposalA, generationA, outputA, groupA],
    )).resolves.toBeTruthy();
    await expect(database.query(
      "update topic_publish_groups set workspace_id=$1,brand_id=$2 where id=$3",
      [workspaceB, brandB, groupA],
    )).rejects.toThrow();
  });

  it("registers every writable runtime relation with the maintenance fence", async () => {
    const result = await database.query<{ relation_name: string }>(
      `select relation_name from ai_content_write_fence_catalog
        where relation_name in ('billing_plan_catalog','brand_subscriptions','publish_calendar_settings','publish_calendar_slots')
        order by relation_name`,
    );
    expect(result.rows.map(({ relation_name }) => relation_name)).toEqual([
      "billing_plan_catalog",
      "brand_subscriptions",
      "publish_calendar_settings",
      "publish_calendar_slots",
    ]);

    const triggers = await database.query<{ event_object_table: string }>(
      `select distinct event_object_table
         from information_schema.triggers
        where trigger_name like 'publish_calendar_%_write_fence'
        order by event_object_table`,
    );
    expect(triggers.rows.map(({ event_object_table }) => event_object_table)).toEqual([
      "billing_plan_catalog",
      "brand_subscriptions",
      "publish_calendar_settings",
      "publish_calendar_slots",
    ]);
  });
});
