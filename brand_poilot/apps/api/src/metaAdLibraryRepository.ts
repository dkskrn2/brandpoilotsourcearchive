import crypto from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { BrandScope } from "./brandCoreRepository.js";
import {
  normalizeMetaAdSearchInput,
  type FetchMetaAdLibraryResult,
  type MetaAdSearchInput,
  type NormalizedMetaAd,
  type NormalizedMetaAdSearchInput,
} from "./metaAdLibrary.js";

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;
type Transaction = <T>(operation: (client: Queryable) => Promise<T>) => Promise<T>;

export interface MetaAdLibraryItemDto extends NormalizedMetaAd {
  id: string;
  isSaved: boolean;
}

export interface MetaAdLibrarySearchPageDto {
  searchId: string;
  cacheState: "pending" | "fresh" | "stale";
  errorCode: string | null;
  refreshedAt: string | null;
  items: MetaAdLibraryItemDto[];
  nextCursor: string | null;
}

export interface MetaAdLibrarySavedDto {
  savedId: string;
  adId: string;
  isSaved: true;
}

interface MetaAdLibraryRepositoryInput {
  pool: Pool;
  accessToken?: string | null;
  appId?: string | null;
  fetchAds: (input: MetaAdSearchInput & { accessToken: string }) => Promise<FetchMetaAdLibraryResult>;
  now?: () => Date;
  withTransaction?: Transaction;
}

const INTERACTIVE_REFRESH_LEASE_MS = 60_000;
const SAVED_PAGE_REFRESH_LEASE_MS = 2 * 60_000;

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function array(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function queryHash(input: NormalizedMetaAdSearchInput): string {
  return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function stableError(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  return [
    "meta_ad_library_rate_limited",
    "meta_ad_library_reconnect_required",
    "meta_ad_library_permission_required",
    "meta_ad_library_fetch_failed",
  ].includes(code) ? code : "meta_ad_library_fetch_failed";
}

function kstDate(value: Date): string {
  return new Date(value.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function mapItem(row: Record<string, unknown>): MetaAdLibraryItemDto {
  return {
    id: String(row.id),
    providerAdId: String(row.provider_ad_id),
    sourcePlatform: "meta_ad_library",
    pageId: nullableText(row.page_id),
    pageName: nullableText(row.page_name),
    creativeBody: nullableText(row.creative_body),
    creativeTitle: nullableText(row.creative_title),
    creativeCaption: nullableText(row.creative_caption),
    creativeDescription: nullableText(row.creative_description),
    snapshotUrl: nullableText(row.snapshot_url),
    publisherPlatforms: array(row.publisher_platforms) as MetaAdLibraryItemDto["publisherPlatforms"],
    deliveryStartedAt: iso(row.delivery_started_at),
    deliveryStoppedAt: iso(row.delivery_stopped_at),
    activeStatus: row.active_status === "INACTIVE"
      ? "INACTIVE"
      : row.active_status === "UNKNOWN" ? "UNKNOWN" : "ACTIVE",
    reachedCountries: array(row.reached_countries),
    isSaved: Boolean(row.is_saved),
  };
}

async function defaultTransaction<T>(pool: Pool, operation: (client: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export function createMetaAdLibraryRepository(input: MetaAdLibraryRepositoryInput) {
  const now = input.now ?? (() => new Date());
  const transaction: Transaction = input.withTransaction
    ?? ((operation) => defaultTransaction(input.pool, operation));

  async function requireScope(queryable: Queryable, scope: BrandScope & { actorUserId?: string }) {
    const values: unknown[] = [scope.workspaceId, scope.brandId];
    let membership = "";
    if (scope.actorUserId) {
      values.push(scope.actorUserId);
      membership = `and exists(
        select 1 from workspace_members member
        where member.workspace_id=brand.workspace_id and member.user_id=$3
      )`;
    }
    const result = await queryable.query(
      `select brand.id from brands brand
       where brand.workspace_id=$1 and brand.id=$2 and brand.deleted_at is null ${membership}`,
      values,
    );
    if (result.rows.length === 0) throw new Error("brand_not_found");
  }

  async function loadSearch(
    scope: BrandScope,
    searchId: string,
    queryable: Queryable = input.pool,
    cursor?: string | null,
  ): Promise<MetaAdLibrarySearchPageDto> {
    const rank = cursor && /^\d+$/.test(cursor) ? Number(cursor) : -1;
    const search = await queryable.query(
      `select id,status,last_error_code,refreshed_at
       from brand_meta_ad_searches
       where id=$1 and workspace_id=$2 and brand_id=$3`,
      [searchId, scope.workspaceId, scope.brandId],
    );
    if (search.rows.length === 0) throw new Error("meta_ad_library_search_not_found");
    const result = await queryable.query(
      `select ad.*,result.provider_rank,(saved.id is not null) is_saved
       from brand_meta_ad_search_results result
       join meta_ad_library_ads ad on ad.id=result.meta_ad_id
       left join brand_meta_ad_saved saved
         on saved.workspace_id=result.workspace_id
        and saved.brand_id=result.brand_id
        and saved.meta_ad_id=ad.id
       where result.search_id=$1 and result.workspace_id=$2 and result.brand_id=$3
         and result.provider_rank>$4
       order by result.provider_rank,ad.id
       limit 31`,
      [searchId, scope.workspaceId, scope.brandId, rank],
    );
    const visible = result.rows.slice(0, 30);
    const last = visible.at(-1) as Record<string, unknown> | undefined;
    const row = search.rows[0] as Record<string, unknown>;
    return {
      searchId,
      cacheState: row.status === "fresh" ? "fresh" : row.status === "stale" ? "stale" : "pending",
      errorCode: nullableText(row.last_error_code),
      refreshedAt: iso(row.refreshed_at),
      items: visible.map((item) => mapItem(item as Record<string, unknown>)),
      nextCursor: result.rows.length > 30 && last ? String(last.provider_rank) : null,
    };
  }

  async function upsertProviderResults(
    scope: BrandScope,
    searchId: string,
    ads: NormalizedMetaAd[],
    refreshedAt: Date,
    fence?: {
      searchLeaseOwner?: string;
      jobId?: string;
      workerId?: string;
      pageId?: string;
      providerComplete?: boolean;
    },
  ) {
    return transaction(async (client) => {
      if (fence?.searchLeaseOwner) {
        const owned = await client.query(
          `select 1 from brand_meta_ad_searches
           where id=$1 and workspace_id=$2 and brand_id=$3 and refresh_lease_owner=$4
           for update`,
          [searchId, scope.workspaceId, scope.brandId, fence.searchLeaseOwner],
        );
        if (owned.rows.length === 0) return false;
      }
      if (fence?.jobId && fence.workerId) {
        const owned = await client.query(
          `select 1 from jobs where id=$1 and job_type='meta_ad_page_refresh'
             and status='running' and locked_by=$2 for update`,
          [fence.jobId, fence.workerId],
        );
        if (owned.rows.length === 0) return false;
      }
      await client.query(
        `delete from brand_meta_ad_search_results
         where search_id=$1 and workspace_id=$2 and brand_id=$3`,
        [searchId, scope.workspaceId, scope.brandId],
      );
      for (const [rank, ad] of ads.entries()) {
        const upserted = await client.query(
          `insert into meta_ad_library_ads(
             provider_ad_id,page_id,page_name,creative_body,creative_title,creative_caption,
             creative_description,snapshot_url,publisher_platforms,delivery_started_at,
             delivery_stopped_at,active_status,reached_countries,last_fetched_at,updated_at
           ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
           on conflict(provider_ad_id) do update set
              page_id=coalesce(excluded.page_id,meta_ad_library_ads.page_id),
              page_name=coalesce(excluded.page_name,meta_ad_library_ads.page_name),
             creative_body=coalesce(excluded.creative_body,meta_ad_library_ads.creative_body),
             creative_title=coalesce(excluded.creative_title,meta_ad_library_ads.creative_title),
             creative_caption=coalesce(excluded.creative_caption,meta_ad_library_ads.creative_caption),
             creative_description=coalesce(excluded.creative_description,meta_ad_library_ads.creative_description),
             snapshot_url=coalesce(excluded.snapshot_url,meta_ad_library_ads.snapshot_url),
              publisher_platforms=case when cardinality(excluded.publisher_platforms)>0
                then excluded.publisher_platforms else meta_ad_library_ads.publisher_platforms end,
              delivery_started_at=coalesce(excluded.delivery_started_at,meta_ad_library_ads.delivery_started_at),
              delivery_stopped_at=coalesce(excluded.delivery_stopped_at,meta_ad_library_ads.delivery_stopped_at),
              active_status=excluded.active_status,
              reached_countries=case when cardinality(excluded.reached_countries)>0
                then excluded.reached_countries else meta_ad_library_ads.reached_countries end,
             last_fetched_at=excluded.last_fetched_at,updated_at=excluded.updated_at
           returning id`,
          [
            ad.providerAdId, ad.pageId, ad.pageName, ad.creativeBody, ad.creativeTitle,
            ad.creativeCaption, ad.creativeDescription, ad.snapshotUrl, ad.publisherPlatforms,
            ad.deliveryStartedAt, ad.deliveryStoppedAt, ad.activeStatus, ad.reachedCountries, refreshedAt,
          ],
        );
        await client.query(
          `insert into brand_meta_ad_search_results(
             workspace_id,brand_id,search_id,meta_ad_id,provider_rank,last_seen_at
           ) values($1,$2,$3,$4,$5,$6)`,
          [scope.workspaceId, scope.brandId, searchId, upserted.rows[0].id, rank, refreshedAt],
        );
        await client.query(
          `update reference_items item set
             title=coalesce($4,$5,$6,item.title),source_url=coalesce($7,item.source_url),
             metadata=item.metadata || jsonb_strip_nulls(jsonb_build_object(
               'pageId',$8::text,'pageName',$5::text,'creativeBody',$6::text
             )),updated_at=$9
           from brand_meta_ad_saved saved
           where item.workspace_id=$1 and item.brand_id=$2 and item.kind='meta_ad'
             and item.saved_meta_ad_id=saved.id and saved.meta_ad_id=$3`,
          [scope.workspaceId, scope.brandId, upserted.rows[0].id, ad.creativeTitle,
            ad.pageName, ad.creativeBody, ad.snapshotUrl, ad.pageId, refreshedAt],
        );
      }
      if (fence?.pageId && fence.providerComplete) {
        await client.query(
          `update meta_ad_library_ads ad set active_status='INACTIVE',updated_at=$4
           where ad.page_id=$3 and ad.provider_ad_id<>all($5::text[])
             and exists(
               select 1 from brand_meta_ad_saved saved
               where saved.workspace_id=$1 and saved.brand_id=$2 and saved.meta_ad_id=ad.id
             )`,
          [scope.workspaceId, scope.brandId, fence.pageId, refreshedAt,
            ads.map((ad) => ad.providerAdId)],
        );
      }
      await client.query(
        `update brand_meta_ad_searches set
           status='fresh',last_error_code=null,refreshed_at=$4,
           refresh_lease_until=null,refresh_lease_owner=null,updated_at=$4
         where id=$1 and workspace_id=$2 and brand_id=$3
           and ($5::text is null or refresh_lease_owner=$5)`,
        [searchId, scope.workspaceId, scope.brandId, refreshedAt, fence?.searchLeaseOwner ?? null],
      );
      return true;
    });
  }

  async function search(
    scope: BrandScope & { actorUserId?: string },
    raw: MetaAdSearchInput,
  ): Promise<MetaAdLibrarySearchPageDto> {
    if (!input.accessToken || !input.appId) throw new Error("meta_ad_library_not_configured");
    const normalized = normalizeMetaAdSearchInput(raw);
    const hash = queryHash(normalized);
    const leaseOwner = crypto.randomUUID();
    const current = now();
    const leaseUntil = new Date(current.getTime() + INTERACTIVE_REFRESH_LEASE_MS);
    let searchId = "";
    let shouldFetch = false;

    await transaction(async (client) => {
      await requireScope(client, scope);
      const inserted = await client.query(
        `insert into brand_meta_ad_searches(
           workspace_id,brand_id,mode,query_text,page_ids,country,query_hash,updated_at
         ) values($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict(workspace_id,brand_id,query_hash) do update set updated_at=excluded.updated_at
         returning id`,
        [
          scope.workspaceId, scope.brandId, normalized.mode,
          normalized.mode === "keyword" ? normalized.query : null,
          normalized.mode === "page" ? normalized.pageIds : [],
          normalized.country, hash, current,
        ],
      );
      searchId = String(inserted.rows[0].id);
      const locked = await client.query(
        `select status,refreshed_at,refresh_lease_until
         from brand_meta_ad_searches where id=$1 for update`,
        [searchId],
      );
      const row = locked.rows[0] as Record<string, unknown>;
      const refreshedAt = row.refreshed_at ? new Date(row.refreshed_at as string).getTime() : 0;
      if (row.status === "fresh" && current.getTime() - refreshedAt < 24 * 60 * 60 * 1000) return;
      const activeLease = row.refresh_lease_until && new Date(row.refresh_lease_until as string).getTime() > current.getTime();
      if (activeLease) return;
      await client.query(
        `update brand_meta_ad_searches set
           status=case when refreshed_at is null then 'pending' else 'stale' end,
           refresh_lease_until=$2,refresh_lease_owner=$3,updated_at=$4
         where id=$1`,
        [searchId, leaseUntil, leaseOwner, current],
      );
      shouldFetch = true;
    });

    if (!shouldFetch) return loadSearch(scope, searchId);

    try {
      const result = await input.fetchAds({ ...normalized, accessToken: input.accessToken });
      const applied = await upsertProviderResults(scope, searchId, result.ads, current, { searchLeaseOwner: leaseOwner });
      if (!applied) return loadSearch(scope, searchId);
      return loadSearch(scope, searchId);
    } catch (error) {
      const errorCode = stableError(error);
      await input.pool.query(
        `update brand_meta_ad_searches set
           status=case when refreshed_at is null then 'failed' else 'stale' end,
           last_error_code=$4,refresh_lease_until=null,refresh_lease_owner=null,updated_at=$5
         where id=$1 and workspace_id=$2 and brand_id=$3 and refresh_lease_owner=$6`,
        [searchId, scope.workspaceId, scope.brandId, errorCode, current, leaseOwner],
      );
      const cached = await loadSearch(scope, searchId);
      if (cached.items.length > 0) return cached;
      throw new Error(errorCode);
    }
  }

  async function save(
    scope: BrandScope & { actorUserId: string },
    adId: string,
  ): Promise<MetaAdLibrarySavedDto> {
    return transaction(async (client) => {
      await requireScope(client, scope);
      const found = await client.query(
        `select ad.* from meta_ad_library_ads ad
         where ad.id=$3 and exists(
           select 1 from brand_meta_ad_search_results result
           where result.workspace_id=$1 and result.brand_id=$2 and result.meta_ad_id=ad.id
         )`,
        [scope.workspaceId, scope.brandId, adId],
      );
      if (found.rows.length === 0) throw new Error("meta_ad_library_ad_not_found");
      const ad = found.rows[0] as Record<string, unknown>;
      const saved = await client.query(
        `insert into brand_meta_ad_saved(workspace_id,brand_id,meta_ad_id,created_by_user_id)
         values($1,$2,$3,$4)
         on conflict(workspace_id,brand_id,meta_ad_id) do update set saved_at=brand_meta_ad_saved.saved_at
         returning id`,
        [scope.workspaceId, scope.brandId, adId, scope.actorUserId],
      );
      const savedId = String(saved.rows[0].id);
      await client.query(
        `insert into reference_items(
           workspace_id,brand_id,kind,content_purpose,origin,title,source_url,format,metadata,
           saved_meta_ad_id,created_by_user_id
         ) values($1,$2,'meta_ad','both','Meta 광고 라이브러리',$3,$4,'META_AD',$5::jsonb,$6,$7)
         on conflict do nothing`,
        [
          scope.workspaceId, scope.brandId,
          ad.creative_title ?? ad.page_name ?? ad.creative_body ?? "Meta 광고",
          ad.snapshot_url ?? null,
          JSON.stringify({
            pageId: ad.page_id ?? null,
            pageName: ad.page_name ?? null,
            creativeBody: ad.creative_body ?? null,
            sourcePlatform: "meta_ad_library",
          }),
          savedId, scope.actorUserId,
        ],
      );
      return { savedId, adId, isSaved: true };
    });
  }

  async function remove(scope: BrandScope, adId: string): Promise<void> {
    await transaction(async (client) => {
      await requireScope(client, scope);
      const saved = await client.query(
        `select id from brand_meta_ad_saved
         where workspace_id=$1 and brand_id=$2 and meta_ad_id=$3 for update`,
        [scope.workspaceId, scope.brandId, adId],
      );
      if (saved.rows.length === 0) return;
      const savedId = saved.rows[0].id;
      await client.query(
        `delete from reference_items
         where workspace_id=$1 and brand_id=$2 and saved_meta_ad_id=$3`,
        [scope.workspaceId, scope.brandId, savedId],
      );
      await client.query(
        `delete from brand_meta_ad_saved
         where id=$1 and workspace_id=$2 and brand_id=$3`,
        [savedId, scope.workspaceId, scope.brandId],
      );
    });
  }

  async function getSearch(scope: BrandScope, searchId: string, cursor?: string | null) {
    return loadSearch(scope, searchId, input.pool, cursor);
  }

  async function findCache(scope: BrandScope, raw: MetaAdSearchInput) {
    const normalized = normalizeMetaAdSearchInput(raw);
    const result = await input.pool.query(
      `select id from brand_meta_ad_searches
       where workspace_id=$1 and brand_id=$2 and query_hash=$3`,
      [scope.workspaceId, scope.brandId, queryHash(normalized)],
    );
    if (result.rows.length === 0) return null;
    return loadSearch(scope, String(result.rows[0].id));
  }

  async function runSavedPageRefreshes(limit = 20) {
    if (!input.accessToken || !input.appId) throw new Error("meta_ad_library_not_configured");
    const current = now();
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const currentKstDate = kstDate(current);
    const pages = await input.pool.query(
      `select distinct saved.workspace_id,saved.brand_id,ad.page_id
       from brand_meta_ad_saved saved
       join meta_ad_library_ads ad on ad.id=saved.meta_ad_id
       where ad.page_id is not null and ad.page_id<>''
         and not exists(
           select 1 from jobs daily
           where daily.job_type='meta_ad_page_refresh'
             and daily.dedupe_key='meta-ad-page-refresh:' || saved.brand_id::text || ':' || ad.page_id || ':' || $2
         )
         and not exists(
           select 1 from jobs active
           where active.job_type='meta_ad_page_refresh'
             and active.brand_id=saved.brand_id
             and active.payload_json->>'pageId'=ad.page_id
             and active.status in ('queued','running')
         )
       order by saved.workspace_id,saved.brand_id,ad.page_id
       limit $1`,
      [boundedLimit, currentKstDate],
    );
    let enqueued = 0;
    for (const row of pages.rows as Array<Record<string, unknown>>) {
      const pageId = String(row.page_id);
      const dedupeKey = `meta-ad-page-refresh:${row.brand_id}:${pageId}:${currentKstDate}`;
      const inserted = await input.pool.query(
        `insert into jobs(
           workspace_id,brand_id,job_type,status,payload_json,dedupe_key,run_at,max_attempts
         ) values($1,$2,'meta_ad_page_refresh','queued',$3::jsonb,$4,$5,3)
         on conflict do nothing returning id`,
        [row.workspace_id, row.brand_id, JSON.stringify({ pageId }), dedupeKey, current],
      );
      enqueued += inserted.rows.length;
    }

    await input.pool.query(
      `update jobs set status='queued',locked_until=null,locked_by=null,updated_at=$1
       where job_type='meta_ad_page_refresh' and status='running' and locked_until<$1`,
      [current],
    );
    const workerId = `meta-ad-page-refresh:${crypto.randomUUID()}`;
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    let processed = 0;
    for (let claimIndex = 0; claimIndex < boundedLimit; claimIndex += 1) {
      const claimTime = now();
      const leaseUntil = new Date(claimTime.getTime() + SAVED_PAGE_REFRESH_LEASE_MS);
      const claimed = await input.pool.query(
        `update jobs set status='running',locked_until=$2,locked_by=$3,
           started_at=coalesce(started_at,$1),updated_at=$1
         where id in (
           select id from jobs
           where job_type='meta_ad_page_refresh' and status='queued' and run_at<=$1
           order by priority desc,run_at,created_at,id
           for update skip locked limit 1
         ) returning id,workspace_id,brand_id,payload_json,attempt_count,max_attempts`,
        [claimTime, leaseUntil, workerId],
      );
      if (claimed.rows.length === 0) break;
      processed += 1;
      const job = claimed.rows[0] as Record<string, unknown>;
      const payload = jsonRecord(job.payload_json);
      const pageId = typeof payload.pageId === "string" ? payload.pageId : "";
      let activeSearchId = "";
      let activeSearchLeaseOwner = "";
      try {
        if (!pageId) throw new Error("meta_ad_library_page_id_invalid");
        const stillSaved = await input.pool.query(
          `select 1 from brand_meta_ad_saved saved
           join meta_ad_library_ads ad on ad.id=saved.meta_ad_id
           where saved.workspace_id=$1 and saved.brand_id=$2 and ad.page_id=$3
           limit 1`,
          [job.workspace_id, job.brand_id, pageId],
        );
        if (stillSaved.rows.length === 0) {
          await input.pool.query(
            `update jobs set status='cancelled',finished_at=$2,locked_until=null,locked_by=null,
               last_error=null,updated_at=$2 where id=$1 and locked_by=$3`,
            [job.id, claimTime, workerId],
          );
          skipped += 1;
          continue;
        }
        const normalized = normalizeMetaAdSearchInput({ mode: "page", pageIds: [pageId] });
        if (normalized.mode !== "page") throw new Error("meta_ad_library_page_id_invalid");
        const scope = { workspaceId: String(job.workspace_id), brandId: String(job.brand_id) };
        const hash = queryHash(normalized);
        const inserted = await input.pool.query(
          `insert into brand_meta_ad_searches(
             workspace_id,brand_id,mode,query_text,page_ids,country,query_hash,status,updated_at
           ) values($1,$2,'page',null,$3,$4,$5,'pending',$6)
           on conflict(workspace_id,brand_id,query_hash) do update set updated_at=excluded.updated_at
           returning id`,
          [scope.workspaceId, scope.brandId, normalized.pageIds, normalized.country, hash, claimTime],
        );
        const searchId = String(inserted.rows[0].id);
        const searchLeaseOwner = `cron:${workerId}:${job.id}`;
        activeSearchId = searchId;
        activeSearchLeaseOwner = searchLeaseOwner;
        const acquired = await input.pool.query(
          `update brand_meta_ad_searches set
             status=case when refreshed_at is null then 'pending' else 'stale' end,
             refresh_lease_until=$5,refresh_lease_owner=$4,updated_at=$6
           where id=$1 and workspace_id=$2 and brand_id=$3
             and (refresh_lease_until is null or refresh_lease_until<$6 or refresh_lease_owner=$4)
           returning id`,
          [searchId, scope.workspaceId, scope.brandId, searchLeaseOwner, leaseUntil, claimTime],
        );
        if (acquired.rows.length === 0) {
          await input.pool.query(
            `update jobs set status='queued',run_at=$2,locked_until=null,locked_by=null,updated_at=$3
             where id=$1 and locked_by=$4`,
            [job.id, new Date(claimTime.getTime() + 60_000), claimTime, workerId],
          );
          skipped += 1;
          continue;
        }
        const provider = await input.fetchAds({ ...normalized, accessToken: input.accessToken });
        const applied = await upsertProviderResults(
          scope, searchId, provider.ads, claimTime,
          {
            searchLeaseOwner,
            jobId: String(job.id),
            workerId,
            pageId,
            providerComplete: provider.nextCursor === null,
          },
        );
        if (!applied) {
          await input.pool.query(
            `update jobs set status='queued',run_at=$2,locked_until=null,locked_by=null,updated_at=$3
             where id=$1 and locked_by=$4`,
            [job.id, new Date(claimTime.getTime() + 60_000), claimTime, workerId],
          );
          skipped += 1;
          continue;
        }
        const completionTime = now();
        const todayKey = `meta-ad-page-refresh:${scope.brandId}:${pageId}:${kstDate(completionTime)}`;
        const completed = await transaction(async (client) => {
          const owned = await client.query(
            `select dedupe_key from jobs where id=$1 and job_type='meta_ad_page_refresh'
               and status='running' and locked_by=$2 for update`,
            [job.id, workerId],
          );
          if (owned.rows.length === 0) return false;
          if (String(owned.rows[0].dedupe_key) !== todayKey) {
            await client.query(
              `insert into jobs(
                 workspace_id,brand_id,job_type,status,payload_json,dedupe_key,run_at,
                 attempt_count,max_attempts,started_at,finished_at,created_at,updated_at
               ) values($1,$2,'meta_ad_page_refresh','succeeded',$3::jsonb,$4,$5,0,3,$5,$5,$5,$5)
               on conflict do nothing`,
              [scope.workspaceId, scope.brandId, JSON.stringify({ pageId }), todayKey, completionTime],
            );
          }
          await client.query(
            `update jobs set status='succeeded',finished_at=$2,locked_until=null,locked_by=null,
               last_error=null,updated_at=$2 where id=$1 and locked_by=$3`,
            [job.id, completionTime, workerId],
          );
          return true;
        });
        if (!completed) { skipped += 1; continue; }
        succeeded += 1;
      } catch (error) {
        const failureTime = now();
        if (activeSearchId && activeSearchLeaseOwner) {
          await input.pool.query(
            `update brand_meta_ad_searches set refresh_lease_until=null,refresh_lease_owner=null,updated_at=$4
             where id=$1 and workspace_id=$2 and brand_id=$3 and refresh_lease_owner=$5`,
            [activeSearchId, job.workspace_id, job.brand_id, failureTime, activeSearchLeaseOwner],
          );
        }
        const attempts = Number(job.attempt_count ?? 0) + 1;
        const maxAttempts = Number(job.max_attempts ?? 3);
        const errorCode = stableError(error);
        const transient = errorCode === "meta_ad_library_rate_limited" || errorCode === "meta_ad_library_fetch_failed";
        const terminal = !transient || attempts >= maxAttempts;
        await input.pool.query(
          `update jobs set status=$2,attempt_count=$3,last_error=$4,
             run_at=case when $2='queued' then $5 else run_at end,
             finished_at=case when $2='failed' then $6 else null end,
             locked_until=null,locked_by=null,updated_at=$6
           where id=$1 and locked_by=$7`,
          [job.id, terminal ? "failed" : "queued", attempts, errorCode,
            new Date(failureTime.getTime() + attempts * 5 * 60 * 1000), failureTime, workerId],
        );
        failed += 1;
      }
    }
    return { enqueued, processed, succeeded, failed, skipped };
  }

  return { search, findCache, getSearch, save, remove, runSavedPageRefreshes };
}
