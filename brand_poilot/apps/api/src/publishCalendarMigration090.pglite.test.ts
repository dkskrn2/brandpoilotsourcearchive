import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationPath = resolve(process.cwd(), "../../db/migrations/090_existing_brand_free_subscriptions.sql");

async function databaseWithSubscriptionTables() {
  const database = await PGlite.create();
  await database.exec(`
    create table brands (
      id uuid primary key,
      deleted_at timestamptz null
    );
    create table billing_plan_catalog (
      code text primary key,
      name text not null,
      weekly_generation_limit integer not null,
      weekly_publish_limit integer not null,
      active boolean not null
    );
    create table brand_subscriptions (
      brand_id uuid primary key references brands(id) on delete cascade,
      plan_code text not null references billing_plan_catalog(code) on delete restrict,
      status text not null,
      started_at timestamptz not null,
      current_period_start timestamptz not null,
      current_period_end timestamptz not null,
      pending_plan_code text null references billing_plan_catalog(code) on delete restrict,
      cancel_at_period_end boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);
  return database;
}

describe("migration 090 existing brand FREE subscriptions", () => {
  const databases: PGlite[] = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.close()));
  });

  it("backfills only active brands without a subscription and replays without resetting their plan start", async () => {
    const database = await databaseWithSubscriptionTables();
    databases.push(database);
    await database.exec(`
      insert into billing_plan_catalog(code,name,weekly_generation_limit,weekly_publish_limit,active)
      values('free','FREE',30,30,true),('pro','PRO',100,100,true);
      insert into brands(id,deleted_at) values
        ('10000000-0000-4000-8000-000000000001',null),
        ('10000000-0000-4000-8000-000000000002',null),
        ('10000000-0000-4000-8000-000000000003','2026-08-01T00:00:00Z');
      insert into brand_subscriptions(
        brand_id,plan_code,status,started_at,current_period_start,current_period_end
      ) values (
        '10000000-0000-4000-8000-000000000002','pro','active',
        '2026-07-31T15:00:00Z','2026-07-31T15:00:00Z','2026-08-31T15:00:00Z'
      );
    `);
    const sql = await readFile(migrationPath, "utf8");

    await database.exec(sql);
    const first = await database.query<{
      brand_id: string;
      plan_code: string;
      status: string;
      one_month_period: boolean;
      same_period_start: boolean;
      started_at: string;
    }>(`
      select brand_id::text,plan_code,status,
             current_period_end=started_at+interval '1 month' as one_month_period,
             current_period_start=started_at as same_period_start,
             started_at::text
        from brand_subscriptions
       order by brand_id
    `);
    await database.exec(sql);
    const replay = await database.query<{ brand_id: string; started_at: string }>(
      "select brand_id::text,started_at::text from brand_subscriptions order by brand_id",
    );

    expect(first.rows).toHaveLength(2);
    expect(first.rows[0]).toMatchObject({
      brand_id: "10000000-0000-4000-8000-000000000001",
      plan_code: "free",
      status: "active",
      one_month_period: true,
      same_period_start: true,
    });
    expect(first.rows[1]).toMatchObject({
      brand_id: "10000000-0000-4000-8000-000000000002",
      plan_code: "pro",
      status: "active",
    });
    expect(replay.rows).toEqual(first.rows.map(({ brand_id, started_at }) => ({ brand_id, started_at })));
  }, 20_000);
});
