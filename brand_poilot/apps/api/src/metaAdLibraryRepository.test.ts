import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchMetaAdLibraryResult, MetaAdSearchInput } from "./metaAdLibrary.js";
import { createMetaAdLibraryRepository } from "./metaAdLibraryRepository.js";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const brandId = "20000000-0000-4000-8000-000000000001";
const actorUserId = "30000000-0000-4000-8000-000000000001";
const scope = { workspaceId, brandId, actorUserId };

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
    create table workspace_members(workspace_id uuid not null,user_id uuid not null,primary key(workspace_id,user_id));
    create table brands(id uuid primary key,workspace_id uuid not null,deleted_at timestamptz null,unique(id,workspace_id));
    create table reference_brands(id uuid primary key,workspace_id uuid not null,brand_id uuid not null,unique(id,workspace_id,brand_id));
    create table source_urls(id uuid primary key,workspace_id uuid not null,brand_id uuid not null,unique(id,workspace_id,brand_id));
    create table brand_trend_saved_media(id uuid primary key,workspace_id uuid not null,brand_id uuid not null,unique(id,workspace_id,brand_id));
    create table channel_outputs(id uuid primary key,workspace_id uuid not null,brand_id uuid not null,unique(id,workspace_id,brand_id));
    create table storage_artifacts(id uuid primary key,workspace_id uuid not null,brand_id uuid not null,unique(id,workspace_id,brand_id));
    create table reference_items(
      id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
      kind text not null,content_purpose text not null default 'both',origin text not null default '',
      title text not null default '',preview_url text null,source_url text null,format text null,
      metadata jsonb not null default '{}',is_favorite boolean not null default false,
      archived_at timestamptz null,reference_brand_id uuid null,source_url_id uuid null,saved_trend_id uuid null,
      channel_output_id uuid null,storage_artifact_id uuid null,created_by_user_id uuid null,
      created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
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
      priority int not null default 0,run_at timestamptz not null default now(),
      attempt_count int not null default 0,max_attempts int not null default 3,
      locked_until timestamptz null,locked_by text null,last_error text null,
      started_at timestamptz null,finished_at timestamptz null,
      created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
      constraint jobs_type_check check(job_type in ('source_crawl','reference_brand_refresh')),
      constraint jobs_status_check check(status in ('queued','running','succeeded','failed','dead','cancelled'))
    );
    insert into workspaces values('${workspaceId}');
    insert into workspace_members values('${workspaceId}','${actorUserId}');
    insert into brands values('${brandId}','${workspaceId}',null);
  `);
  const migration = await readFile(resolve(process.cwd(), "../../db/migrations/081_meta_ad_library_references.sql"), "utf8");
  await database.exec(migration);
}, 60_000);

beforeEach(async () => {
  await database.exec(`
    delete from jobs where job_type='meta_ad_page_refresh';
    delete from reference_items;
    delete from brand_meta_ad_saved;
    delete from brand_meta_ad_search_results;
    delete from brand_meta_ad_searches;
    delete from meta_ad_library_ads;
  `);
});

afterAll(async () => database?.close());

function providerAd(id = "provider-ad-1", pageId = "123", creativeBody = "여름 신제품 광고") {
  return {
    providerAdId: id,
    sourcePlatform: "meta_ad_library" as const,
    pageId,
    pageName: "라라스윗",
    creativeBody,
    creativeTitle: "신제품",
    creativeCaption: null,
    creativeDescription: null,
    snapshotUrl: `https://www.facebook.com/ads/archive/render_ad/?id=${id}`,
    publisherPlatforms: ["instagram" as const],
    deliveryStartedAt: "2026-08-01T00:00:00.000Z",
    deliveryStoppedAt: null,
    activeStatus: "ACTIVE" as const,
    reachedCountries: ["KR"],
  };
}

function repository(
  fetchAds: (input: MetaAdSearchInput & { accessToken: string }) => Promise<FetchMetaAdLibraryResult>,
  now = new Date("2026-08-13T00:00:00.000Z"),
) {
  return createMetaAdLibraryRepository({
    pool: database as never,
    accessToken: "secret",
    appId: "app-1",
    fetchAds,
    now: () => now,
    withTransaction: async (operation) => operation(database as never),
  });
}

describe("Meta Ad Library repository", () => {
  it("uses a fresh 24-hour cache without a second provider call", async () => {
    const fetchAds = vi.fn(async () => ({ ads: [providerAd()], nextCursor: null }));
    const service = repository(fetchAds);

    const first = await service.search(scope, { mode: "keyword", query: " 스킨케어 " });
    const second = await service.search(scope, { mode: "keyword", query: "스킨케어" });

    expect(fetchAds).toHaveBeenCalledTimes(1);
    expect(first.searchId).toBe(second.searchId);
    expect(second).toMatchObject({ cacheState: "fresh", items: [{ pageName: "라라스윗", isSaved: false }] });
  });

  it("finds an exact cached search without requiring a provider call", async () => {
    const fetchAds = vi.fn(async () => ({ ads: [providerAd()], nextCursor: null }));
    const service = repository(fetchAds);
    await service.search(scope, { mode: "keyword", query: "여행" });
    fetchAds.mockClear();

    const cached = await service.findCache(scope, { mode: "keyword", query: " 여행 " });
    const missing = await service.findCache(scope, { mode: "keyword", query: "뷰티" });

    expect(cached).toMatchObject({ cacheState: "fresh", items: [{ pageName: "라라스윗" }] });
    expect(missing).toBeNull();
    expect(fetchAds).not.toHaveBeenCalled();
  });

  it("returns stale cached cards when a refresh fails", async () => {
    const initial = vi.fn(async () => ({ ads: [providerAd()], nextCursor: null }));
    await repository(initial, new Date("2026-08-10T00:00:00.000Z")).search(scope, { mode: "keyword", query: "스킨케어" });
    const failing = vi.fn(async () => { throw new Error("meta_ad_library_rate_limited"); });

    const result = await repository(failing, new Date("2026-08-13T00:00:00.000Z")).search(scope, { mode: "keyword", query: "스킨케어" });

    expect(result).toMatchObject({ cacheState: "stale", errorCode: "meta_ad_library_rate_limited", items: [{ providerAdId: "provider-ad-1" }] });
  });

  it("preserves known advertiser and delivery fields when Meta returns a partial refresh", async () => {
    await repository(
      vi.fn(async () => ({ ads: [providerAd()], nextCursor: null })),
      new Date("2026-08-10T00:00:00.000Z"),
    ).search(scope, { mode: "keyword", query: "스킨케어" });
    const partial = {
      ...providerAd(),
      pageId: null,
      pageName: null,
      publisherPlatforms: [],
      deliveryStartedAt: null,
      reachedCountries: [],
    };

    const refreshed = await repository(
      vi.fn(async () => ({ ads: [partial], nextCursor: null })),
      new Date("2026-08-13T00:00:00.000Z"),
    ).search(scope, { mode: "keyword", query: "스킨케어" });

    expect(refreshed.items[0]).toMatchObject({
      pageId: "123",
      pageName: "라라스윗",
      publisherPlatforms: ["instagram"],
      deliveryStartedAt: "2026-08-01T00:00:00.000Z",
      reachedCountries: ["KR"],
    });
  });

  it("allows one concurrent provider refresh for the same search", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const fetchAds = vi.fn(async () => { await pending; return { ads: [providerAd()], nextCursor: null }; });
    const service = repository(fetchAds);

    const first = service.search(scope, { mode: "keyword", query: "스킨케어" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const leasedSearch = await database.query<{ refresh_lease_until: string }>(
      "select refresh_lease_until from brand_meta_ad_searches where query_text='스킨케어'",
    );
    const second = service.search(scope, { mode: "keyword", query: "스킨케어" });
    release();
    await Promise.all([first, second]);

    expect(fetchAds).toHaveBeenCalledTimes(1);
    expect(new Date(leasedSearch.rows[0]!.refresh_lease_until).getTime()
      - new Date("2026-08-13T00:00:00.000Z").getTime()).toBe(60_000);
  });

  it("saves only an exposed ad and creates a dedicated reference item atomically", async () => {
    const service = repository(vi.fn(async () => ({ ads: [providerAd()], nextCursor: null })));
    const search = await service.search(scope, { mode: "keyword", query: "스킨케어" });
    const adId = search.items[0]!.id;

    await expect(service.save(scope, "00000000-0000-4000-8000-000000000099"))
      .rejects.toThrow("meta_ad_library_ad_not_found");
    const saved = await service.save(scope, adId);
    const repeated = await service.save(scope, adId);

    expect(repeated).toEqual(saved);
    const rows = await database.query<{ kind: string; origin: string; snapshot_count: number }>(
      `select item.kind,item.origin,
         (select count(*)::int from information_schema.tables where table_name='reference_snapshots') snapshot_count
       from reference_items item where item.saved_meta_ad_id=$1`,
      [saved.savedId],
    );
    expect(rows.rows[0]).toMatchObject({ kind: "meta_ad", origin: "Meta 광고 라이브러리" });

    await service.remove(scope, adId);
    expect((await database.query("select id from reference_items")).rows).toHaveLength(0);
    expect((await database.query("select id from brand_meta_ad_saved")).rows).toHaveLength(0);
  });

  it("refreshes only saved advertiser Pages once per KST day without auto-saving new ads", async () => {
    const fetchAds = vi.fn(async (request: MetaAdSearchInput & { accessToken: string }) => ({
      ads: request.mode === "page"
        ? [providerAd(request.pageIds[0] === "123" ? "provider-ad-1" : "provider-ad-2", request.pageIds[0], `갱신된 광고 ${request.pageIds[0]}`)]
        : [providerAd("provider-ad-1", "123"), providerAd("provider-ad-2", "456")],
      nextCursor: null,
    }));
    const service = repository(fetchAds, new Date("2026-08-13T18:00:00.000Z"));
    const search = await service.search(scope, { mode: "keyword", query: "스킨케어" });
    await service.save(scope, search.items[0]!.id);
    await service.save(scope, search.items[1]!.id);
    fetchAds.mockClear();

    const first = await service.runSavedPageRefreshes(1);
    const second = await service.runSavedPageRefreshes(1);
    const third = await service.runSavedPageRefreshes(1);

    expect(first).toEqual({ enqueued: 1, processed: 1, succeeded: 1, failed: 0, skipped: 0 });
    expect(second).toEqual({ enqueued: 1, processed: 1, succeeded: 1, failed: 0, skipped: 0 });
    expect(third).toEqual({ enqueued: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0 });
    expect(fetchAds).toHaveBeenCalledTimes(2);
    expect(fetchAds).toHaveBeenNthCalledWith(1, expect.objectContaining({ mode: "page", pageIds: ["123"] }));
    expect(fetchAds).toHaveBeenNthCalledWith(2, expect.objectContaining({ mode: "page", pageIds: ["456"] }));
    expect((await database.query("select id from brand_meta_ad_saved")).rows).toHaveLength(2);
    expect((await database.query("select id from reference_items where kind='meta_ad'")).rows).toHaveLength(2);
    expect((await database.query<{ copy: string }>(
      "select metadata->>'creativeBody' copy from reference_items where metadata->>'pageId'='123'",
    )).rows[0]?.copy).toBe("갱신된 광고 123");
  });

  it("leases each saved Page refresh only when that provider call starts", async () => {
    const runningCounts: number[] = [];
    const leaseDurations: number[] = [];
    const fetchAds = vi.fn(async (request: MetaAdSearchInput & { accessToken: string }) => {
      if (request.mode === "page") {
        const running = await database.query<{ count: number; locked_until: string }>(
          `select count(*)::int count,max(locked_until)::text locked_until
           from jobs where job_type='meta_ad_page_refresh' and status='running'`,
        );
        runningCounts.push(Number(running.rows[0]?.count ?? 0));
        leaseDurations.push(new Date(running.rows[0]!.locked_until).getTime()
          - new Date("2026-08-13T18:00:00.000Z").getTime());
        return { ads: [providerAd(`provider-ad-${request.pageIds[0]}`, request.pageIds[0])], nextCursor: null };
      }
      return {
        ads: [providerAd("provider-ad-1", "123"), providerAd("provider-ad-2", "456")],
        nextCursor: null,
      };
    });
    const service = repository(fetchAds, new Date("2026-08-13T18:00:00.000Z"));
    const search = await service.search(scope, { mode: "keyword", query: "스킨케어" });
    await service.save(scope, search.items[0]!.id);
    await service.save(scope, search.items[1]!.id);

    const refresh = await service.runSavedPageRefreshes(2);

    expect(refresh).toMatchObject({ processed: 2, succeeded: 2 });
    expect(runningCounts).toEqual([1, 1]);
    expect(leaseDurations).toEqual([120_000, 120_000]);
  });

  it("marks a saved ad unavailable when a successful Page refresh no longer returns it", async () => {
    const fetchAds = vi.fn(async (request: MetaAdSearchInput & { accessToken: string }) => ({
      ads: request.mode === "page" ? [] : [providerAd()],
      nextCursor: null,
    }));
    const service = repository(fetchAds, new Date("2026-08-13T18:00:00.000Z"));
    const search = await service.search(scope, { mode: "keyword", query: "스킨케어" });
    await service.save(scope, search.items[0]!.id);

    const refresh = await service.runSavedPageRefreshes(1);
    const cached = await service.getSearch(scope, search.searchId);
    const canonical = await database.query<{ active_status: string }>(
      "select active_status from meta_ad_library_ads where provider_ad_id='provider-ad-1'",
    );

    expect(refresh).toMatchObject({ succeeded: 1 });
    expect(canonical.rows[0]?.active_status).toBe("INACTIVE");
    expect(cached.items[0]?.activeStatus).toBe("INACTIVE");
    expect((await database.query("select id from reference_items where kind='meta_ad'")).rows).toHaveLength(1);
  });
});
