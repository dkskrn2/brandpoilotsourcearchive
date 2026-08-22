import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration079Path = resolve(process.cwd(), "../../db/migrations/079_publish_calendar_runtime.sql");
const migration085Path = resolve(process.cwd(), "../../db/migrations/085_publish_calendar_idempotency_expand.sql");

describe("migration 085 publish calendar idempotency expansion", () => {
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
    await database.exec(await readFile(migration079Path, "utf8"));
    await database.exec(await readFile(migration085Path, "utf8"));
  }, 30_000);

  afterAll(async () => database?.close());

  it("adds durable keys without removing the existing unique indexes", async () => {
    const columns = await database.query<{ column_name: string }>(
      `select column_name
         from information_schema.columns
        where table_schema='public' and table_name='publish_calendar_slots'`,
    );
    const indexes = await database.query<{ indexname: string }>(
      `select indexname
         from pg_indexes
        where schemaname='public' and tablename='publish_calendar_slots'`,
    );

    expect(columns.rows.map(({ column_name }) => column_name)).toContain("idempotency_key");
    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual(expect.arrayContaining([
      "publish_calendar_slots_brand_idempotency_unique",
      "publish_calendar_slots_generation_output_unique",
      "publish_calendar_slots_active_brand_time_unique",
      "publish_calendar_slots_generation_unique",
    ]));
  });

  it("rejects duplicate brand keys and duplicate active generation outputs", async () => {
    const workspaceId = "10000000-0000-4000-8000-000000000084";
    const brandId = "20000000-0000-4000-8000-000000000084";
    const generationId = "40000000-0000-4000-8000-000000000084";
    const outputId = "50000000-0000-4000-8000-000000000084";
    await database.query("insert into workspaces(id) values($1)", [workspaceId]);
    await database.query("insert into brands(id,workspace_id) values($1,$2)", [brandId, workspaceId]);
    await database.query(
      "insert into ai_content_generations(id,workspace_id,brand_id) values($1,$2,$3)",
      [generationId, workspaceId, brandId],
    );
    await database.query(
      "insert into ai_content_generation_outputs(id,generation_id,workspace_id,brand_id) values($1,$2,$3,$4)",
      [outputId, generationId, workspaceId, brandId],
    );

    await database.query(
      `insert into publish_calendar_slots(
         workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,idempotency_key
       ) values($1,$2,$3,'manual','open','card_news',$4)`,
      [workspaceId, brandId, "2026-08-21T02:30:00.000Z", "manual:v1:key"],
    );
    await expect(database.query(
      `insert into publish_calendar_slots(
         workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,idempotency_key
       ) values($1,$2,$3,'manual','open','card_news',$4)`,
      [workspaceId, brandId, "2026-08-21T03:30:00.000Z", "manual:v1:key"],
    )).rejects.toThrow();

    await database.query(
      `insert into publish_calendar_slots(
         workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,generation_id,generation_output_id
       ) values($1,$2,$3,'manual','generation_pending','card_news',$4,$5)`,
      [workspaceId, brandId, "2026-08-21T04:30:00.000Z", generationId, outputId],
    );
    await expect(database.query(
      `insert into publish_calendar_slots(
         workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,generation_id,generation_output_id
       ) values($1,$2,$3,'manual','generation_pending','card_news',$4,$5)`,
      [workspaceId, brandId, "2026-08-21T05:30:00.000Z", generationId, outputId],
    )).rejects.toThrow();
  });
});
