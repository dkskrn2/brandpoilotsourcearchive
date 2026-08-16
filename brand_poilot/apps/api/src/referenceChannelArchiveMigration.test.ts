import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const workspaceA = "10000000-0000-4000-8000-000000000001";
const workspaceB = "10000000-0000-4000-8000-000000000002";
const brandA = "20000000-0000-4000-8000-000000000001";
const brandB = "20000000-0000-4000-8000-000000000002";
const channelA = "30000000-0000-4000-8000-000000000001";
const channelA2 = "30000000-0000-4000-8000-000000000002";
const media = "40000000-0000-4000-8000-000000000001";

let database: PGlite;

beforeAll(async () => {
  database = await PGlite.create({ extensions: { pgcrypto } });
  await database.exec(`
    create table ai_content_bootstrap_state(
      singleton boolean primary key,
      schema_owner_role_name name not null,
      application_role_name name not null
    );
    insert into ai_content_bootstrap_state values(true,current_user,current_user);
    create table workspaces(id uuid primary key);
    create table brands(
      id uuid primary key,workspace_id uuid not null references workspaces(id),
      unique(id,workspace_id)
    );
    create table content_categories(id uuid primary key);
    create table instagram_trend_hashtags(id uuid primary key);
    create table instagram_trend_media(id uuid primary key);
    create table reference_brands(
      id uuid primary key,workspace_id uuid not null,brand_id uuid not null,
      platform text not null,handle text not null,profile_snapshot jsonb not null default '{}',
      refreshed_at timestamptz null,
      unique(id,workspace_id,brand_id),
      foreign key(brand_id,workspace_id) references brands(id,workspace_id)
    );
    create table brand_trend_saved_media(
      id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
      trend_media_id uuid not null references instagram_trend_media(id)
    );
    create table jobs(
      id uuid primary key default gen_random_uuid(),workspace_id uuid null,brand_id uuid null,
      job_type text not null,status text not null,payload_json jsonb not null default '{}',
      dedupe_key text null,
      constraint jobs_type_check check(job_type in ('source_crawl')),
      constraint jobs_status_check check(status in ('queued','running','succeeded','failed','dead','cancelled'))
    );
    insert into workspaces values('${workspaceA}'),('${workspaceB}');
    insert into brands values('${brandA}','${workspaceA}'),('${brandB}','${workspaceB}');
    insert into instagram_trend_media values('${media}');
    insert into reference_brands(id,workspace_id,brand_id,platform,handle) values
      ('${channelA}','${workspaceA}','${brandA}','instagram','channel_a'),
      ('${channelA2}','${workspaceA}','${brandA}','instagram','channel_a_2');
  `);
  const migration = await readFile(
    resolve(process.cwd(), "../../db/migrations/080_reference_channel_archive.sql"),
    "utf8",
  );
  await database.exec(migration);
}, 60_000);

afterAll(async () => {
  await database?.close();
});

describe("reference channel archive migration", () => {
  it("fails fast instead of waiting on live table locks", async () => {
    const migration = await readFile(
      resolve(process.cwd(), "../../db/migrations/080_reference_channel_archive.sql"),
      "utf8",
    );
    expect(migration).toMatch(/begin;\s*set local lock_timeout = '5s';\s*set local statement_timeout = '60s';/i);
  });

  it("assigns new tables to the schema owner and grants the application role CRUD access", async () => {
    const migration = await readFile(
      resolve(process.cwd(), "../../db/migrations/080_reference_channel_archive.sql"),
      "utf8",
    );
    for (const table of [
      "reference_brand_media",
      "reference_brand_metric_observations",
      "reference_media_metric_observations",
      "reference_save_events",
      "meta_api_usage_state",
    ]) {
      expect(migration).toMatch(new RegExp(`alter table public\\.${table} owner to`, "i"));
      expect(migration).toMatch(new RegExp(`grant select, insert, update, delete on table public\\.${table}`, "i"));
    }
  });

  it("blocks cross-tenant channel-media relations", async () => {
    await expect(database.query(
      `insert into reference_brand_media(workspace_id,brand_id,reference_brand_id,trend_media_id)
       values($1,$2,$3,$4)`,
      [workspaceB, brandB, channelA, media],
    )).rejects.toThrow();
  });

  it("allows only one current identified channel for a tenant media", async () => {
    await database.query(
      `insert into reference_brand_media(workspace_id,brand_id,reference_brand_id,trend_media_id)
       values($1,$2,$3,$4)`,
      [workspaceA, brandA, channelA, media],
    );
    await expect(database.query(
      `insert into reference_brand_media(workspace_id,brand_id,reference_brand_id,trend_media_id)
       values($1,$2,$3,$4)`,
      [workspaceA, brandA, channelA2, media],
    )).rejects.toThrow();
  });

  it("keeps daily account and media observations idempotent", async () => {
    await database.query(
      `insert into reference_brand_metric_observations(
         workspace_id,brand_id,reference_brand_id,observed_date,followers_count,media_count
       ) values($1,$2,$3,'2026-08-12',100,10)`,
      [workspaceA, brandA, channelA],
    );
    await expect(database.query(
      `insert into reference_brand_metric_observations(
         workspace_id,brand_id,reference_brand_id,observed_date,followers_count,media_count
       ) values($1,$2,$3,'2026-08-12',101,11)`,
      [workspaceA, brandA, channelA],
    )).rejects.toThrow();

    await database.query(
      `insert into reference_media_metric_observations(
         workspace_id,brand_id,reference_brand_id,trend_media_id,observed_date,like_count
       ) values($1,$2,$3,$4,'2026-08-12',5)`,
      [workspaceA, brandA, channelA, media],
    );
    await expect(database.query(
      `insert into reference_media_metric_observations(
         workspace_id,brand_id,reference_brand_id,trend_media_id,observed_date,like_count
       ) values($1,$2,$3,$4,'2026-08-12',6)`,
      [workspaceA, brandA, channelA, media],
    )).rejects.toThrow();
  });

  it("deduplicates daily refresh after success and active refreshes across midnight", async () => {
    const payload = JSON.stringify({ referenceBrandId: channelA });
    await database.query(
      `insert into jobs(workspace_id,brand_id,job_type,status,dedupe_key,payload_json)
       values($1,$2,'reference_brand_refresh','succeeded',$3,$4::jsonb)`,
      [workspaceA, brandA, `reference-brand-refresh:${channelA}:2026-08-12`, payload],
    );
    await expect(database.query(
      `insert into jobs(workspace_id,brand_id,job_type,status,dedupe_key,payload_json)
       values($1,$2,'reference_brand_refresh','queued',$3,$4::jsonb)`,
      [workspaceA, brandA, `reference-brand-refresh:${channelA}:2026-08-12`, payload],
    )).rejects.toThrow();

    await database.query(
      `insert into jobs(workspace_id,brand_id,job_type,status,dedupe_key,payload_json)
       values($1,$2,'reference_brand_refresh','queued',$3,$4::jsonb)`,
      [workspaceA, brandA, `reference-brand-refresh:${channelA}:2026-08-13`, payload],
    );
    await expect(database.query(
      `insert into jobs(workspace_id,brand_id,job_type,status,dedupe_key,payload_json)
       values($1,$2,'reference_brand_refresh','running',$3,$4::jsonb)`,
      [workspaceA, brandA, `reference-brand-refresh:${channelA}:2026-08-14`, payload],
    )).rejects.toThrow();
  });

  it("keeps tenant save history when an archived channel is deleted", async () => {
    await database.query(
      `insert into reference_save_events(
         workspace_id,brand_id,trend_media_id,reference_brand_id,event_type
       ) values($1,$2,$3,$4,'saved')`,
      [workspaceA, brandA, media, channelA],
    );

    await database.query("delete from reference_brands where id=$1", [channelA]);

    const result = await database.query<{
      workspace_id: string;
      brand_id: string;
      reference_brand_id: string | null;
    }>(
      `select workspace_id,brand_id,reference_brand_id
       from reference_save_events
       where trend_media_id=$1`,
      [media],
    );
    expect(result.rows).toEqual([{
      workspace_id: workspaceA,
      brand_id: brandA,
      reference_brand_id: null,
    }]);
  });
});
