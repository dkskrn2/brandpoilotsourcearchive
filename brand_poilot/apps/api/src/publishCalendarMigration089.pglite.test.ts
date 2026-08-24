import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationPath = resolve(process.cwd(), "../../db/migrations/089_free_subscription_plan.sql");

async function databaseWithPlanTable() {
  const database = await PGlite.create();
  await database.exec(`
    create table billing_plan_catalog (
      code text primary key,
      name text not null,
      weekly_generation_limit integer not null,
      weekly_publish_limit integer not null,
      active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);
  return database;
}

describe("migration 089 canonical FREE subscription plan", () => {
  const databases: PGlite[] = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.close()));
  });

  it("installs exact weekly 30 generation and publication limits and replays safely", async () => {
    const database = await databaseWithPlanTable();
    databases.push(database);
    const sql = await readFile(migrationPath, "utf8");

    await database.exec(sql);
    await database.exec(sql);

    const plan = await database.query<{
      code: string;
      name: string;
      weekly_generation_limit: number;
      weekly_publish_limit: number;
      active: boolean;
    }>(`select code,name,weekly_generation_limit,weekly_publish_limit,active
          from billing_plan_catalog where code='free'`);

    expect(plan.rows).toEqual([{
      code: "free",
      name: "FREE",
      weekly_generation_limit: 30,
      weekly_publish_limit: 30,
      active: true,
    }]);
  }, 20_000);

  it("aborts instead of overwriting a conflicting operator-owned free plan", async () => {
    const database = await databaseWithPlanTable();
    databases.push(database);
    await database.query(
      `insert into billing_plan_catalog(code,name,weekly_generation_limit,weekly_publish_limit,active)
       values('free','Operator plan',99,99,true)`,
    );

    await expect(database.exec(await readFile(migrationPath, "utf8")))
      .rejects.toThrow(/free_subscription_plan_conflict/);
    await database.exec("rollback");

    const plan = await database.query<{ name: string; weekly_generation_limit: number }>(
      "select name,weekly_generation_limit from billing_plan_catalog where code='free'",
    );
    expect(plan.rows).toEqual([{ name: "Operator plan", weekly_generation_limit: 99 }]);
  }, 20_000);
});
