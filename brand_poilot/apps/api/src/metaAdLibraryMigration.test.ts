import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const workspaceA = "10000000-0000-4000-8000-000000000001";
const workspaceB = "10000000-0000-4000-8000-000000000002";
const brandA = "20000000-0000-4000-8000-000000000001";
const brandB = "20000000-0000-4000-8000-000000000002";
const userA = "30000000-0000-4000-8000-000000000001";

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
    create table users(id uuid primary key);
    create table workspaces(id uuid primary key);
    create table workspace_members(workspace_id uuid not null,user_id uuid not null,primary key(workspace_id,user_id));
    create table brands(id uuid primary key,workspace_id uuid not null,unique(id,workspace_id));
    create table reference_brands(id uuid primary key,workspace_id uuid not null,brand_id uuid not null,unique(id,workspace_id,brand_id));
    create table source_urls(id uuid primary key,workspace_id uuid not null,brand_id uuid not null,unique(id,workspace_id,brand_id));
    create table brand_trend_saved_media(id uuid primary key,workspace_id uuid not null,brand_id uuid not null,unique(id,workspace_id,brand_id));
    create table channel_outputs(id uuid primary key,workspace_id uuid not null,brand_id uuid not null,unique(id,workspace_id,brand_id));
    create table storage_artifacts(id uuid primary key,workspace_id uuid not null,brand_id uuid not null,unique(id,workspace_id,brand_id));
    create table reference_items(
      id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
      kind text not null,reference_brand_id uuid null,source_url_id uuid null,saved_trend_id uuid null,
      channel_output_id uuid null,storage_artifact_id uuid null,created_by_user_id uuid null,
      constraint reference_items_kind_check check(kind in ('saved_brand','saved_content','trend','external_url','upload','owned_performance')),
      constraint reference_items_exactly_one_origin_check check(num_nonnulls(reference_brand_id,source_url_id,saved_trend_id,channel_output_id,storage_artifact_id)=1),
      constraint reference_items_kind_origin_check check(
        (kind='saved_brand' and reference_brand_id is not null)
        or (kind in ('saved_content','external_url') and source_url_id is not null)
        or (kind='trend' and saved_trend_id is not null)
        or (kind='upload' and storage_artifact_id is not null)
        or (kind='owned_performance' and channel_output_id is not null)
      )
    );
    create table jobs(
      id uuid primary key default gen_random_uuid(),workspace_id uuid null,brand_id uuid null,
      job_type text not null,status text not null,payload_json jsonb not null default '{}',dedupe_key text null,
      constraint jobs_type_check check(job_type in ('source_crawl','reference_brand_refresh')),
      constraint jobs_status_check check(status in ('queued','running','succeeded','failed','dead','cancelled'))
    );
    insert into users values('${userA}');
    insert into workspaces values('${workspaceA}'),('${workspaceB}');
    insert into workspace_members values('${workspaceA}','${userA}');
    insert into brands values('${brandA}','${workspaceA}'),('${brandB}','${workspaceB}');
  `);
  const migration = await readFile(resolve(process.cwd(), "../../db/migrations/081_meta_ad_library_references.sql"), "utf8");
  await database.exec(migration);
}, 60_000);

afterAll(async () => database?.close());

describe("Meta Ad Library migration", () => {
  it("fails fast instead of waiting on live table locks", async () => {
    const migration = await readFile(
      resolve(process.cwd(), "../../db/migrations/081_meta_ad_library_references.sql"),
      "utf8",
    );
    expect(migration).toMatch(/begin;\s*set local lock_timeout = '5s';\s*set local statement_timeout = '60s';/i);
  });

  it("assigns new tables to the schema owner and grants the application role CRUD access", async () => {
    const migration = await readFile(
      resolve(process.cwd(), "../../db/migrations/081_meta_ad_library_references.sql"),
      "utf8",
    );
    for (const table of [
      "meta_ad_library_ads",
      "brand_meta_ad_searches",
      "brand_meta_ad_search_results",
      "brand_meta_ad_saved",
    ]) {
      expect(migration).toMatch(new RegExp(`alter table public\\.${table} owner to`, "i"));
      expect(migration).toMatch(new RegExp(`grant select, insert, update, delete on table public\\.${table}`, "i"));
    }
  });

  it("deduplicates the same tenant search contract", async () => {
    await database.query(
      `insert into brand_meta_ad_searches(workspace_id,brand_id,mode,query_text,page_ids,query_hash)
       values($1,$2,'keyword','스킨케어','{}',$3)`,
      [workspaceA, brandA, "hash-1"],
    );
    await expect(database.query(
      `insert into brand_meta_ad_searches(workspace_id,brand_id,mode,query_text,page_ids,query_hash)
       values($1,$2,'keyword','스킨케어','{}',$3)`,
      [workspaceA, brandA, "hash-1"],
    )).rejects.toThrow();
  });

  it("blocks cross-tenant saved ads and supports a dedicated meta_ad reference origin", async () => {
    const ad = await database.query<{ id: string }>(
      `insert into meta_ad_library_ads(provider_ad_id,page_id,page_name)
       values('provider-ad-1','123','광고주') returning id`,
    );
    const adId = ad.rows[0]!.id;
    await expect(database.query(
      `insert into brand_meta_ad_saved(workspace_id,brand_id,meta_ad_id,created_by_user_id)
       values($1,$2,$3,$4)`,
      [workspaceB, brandB, adId, userA],
    )).rejects.toThrow();
    const saved = await database.query<{ id: string }>(
      `insert into brand_meta_ad_saved(workspace_id,brand_id,meta_ad_id,created_by_user_id)
       values($1,$2,$3,$4) returning id`,
      [workspaceA, brandA, adId, userA],
    );
    await database.query(
      `insert into reference_items(workspace_id,brand_id,kind,saved_meta_ad_id,created_by_user_id)
       values($1,$2,'meta_ad',$3,$4)`,
      [workspaceA, brandA, saved.rows[0]!.id, userA],
    );
    const item = await database.query<{ kind: string }>("select kind from reference_items where saved_meta_ad_id=$1", [saved.rows[0]!.id]);
    expect(item.rows).toEqual([{ kind: "meta_ad" }]);
  });

  it("deduplicates daily refreshes and active Page jobs across midnight", async () => {
    const payload = JSON.stringify({ pageId: "123" });
    await database.query(
      `insert into jobs(workspace_id,brand_id,job_type,status,dedupe_key,payload_json)
       values($1,$2,'meta_ad_page_refresh','succeeded',$3,$4::jsonb)`,
      [workspaceA, brandA, `meta-ad-page-refresh:${brandA}:123:2026-08-13`, payload],
    );
    await expect(database.query(
      `insert into jobs(workspace_id,brand_id,job_type,status,dedupe_key,payload_json)
       values($1,$2,'meta_ad_page_refresh','queued',$3,$4::jsonb)`,
      [workspaceA, brandA, `meta-ad-page-refresh:${brandA}:123:2026-08-13`, payload],
    )).rejects.toThrow();

    await database.query(
      `insert into jobs(workspace_id,brand_id,job_type,status,dedupe_key,payload_json)
       values($1,$2,'meta_ad_page_refresh','queued',$3,$4::jsonb)`,
      [workspaceA, brandA, `meta-ad-page-refresh:${brandA}:123:2026-08-14`, payload],
    );
    await expect(database.query(
      `insert into jobs(workspace_id,brand_id,job_type,status,dedupe_key,payload_json)
       values($1,$2,'meta_ad_page_refresh','running',$3,$4::jsonb)`,
      [workspaceA, brandA, `meta-ad-page-refresh:${brandA}:123:2026-08-15`, payload],
    )).rejects.toThrow();
  });
});
