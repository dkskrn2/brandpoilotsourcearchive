import crypto from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { isFreshInstagramTrendCache, normalizeInstagramHashtag } from "./instagramTrend.js";
import type { FetchInstagramHashtagTopMediaResult, FetchInstagramHashtagTopMediaInput } from "./instagramTrendMeta.js";
import { hashSourceUrl } from "./sourceUrl.js";
import type {
  ContentCategoryDto,
  InstagramTrendFavoriteInput,
  InstagramTrendListInput,
  InstagramTrendMediaDto,
  InstagramTrendPageDto,
  InstagramTrendSaveSourceDto,
  InstagramTrendSearchHistoryDto,
  InstagramTrendSearchInput,
  SourceDto,
} from "./types.js";

type FetchTopMedia = (input: FetchInstagramHashtagTopMediaInput) => Promise<FetchInstagramHashtagTopMediaResult>;
type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;
type Row = Record<string, any>;

const PAGE_SIZE = 20 as const;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const QUOTA_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const QUOTA_LIMIT = 30;
const LOCK_POLL_MS = 250;
const LOCK_POLL_ATTEMPTS = 12;

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function textHash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableRefreshError(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  return [
    "instagram_reconnect_required",
    "instagram_permission_required",
    "instagram_hashtag_not_found",
    "instagram_trend_fetch_failed",
  ].includes(code) ? code : "instagram_trend_fetch_failed";
}

function mapSource(row: Row): SourceDto {
  return {
    id: String(row.id),
    brandId: String(row.brand_id),
    sourceType: row.source_type,
    url: String(row.url),
    title: row.title ?? null,
    status: String(row.status),
    enabled: Boolean(row.enabled),
    lastCrawledAt: iso(row.last_crawled_at),
    lastError: row.last_error ?? null,
  };
}

function mapMedia(row: Row): InstagramTrendMediaDto {
  const raw = row.raw_metadata && typeof row.raw_metadata === "object" ? row.raw_metadata : {};
  return {
    id: String(row.id),
    instagramMediaId: String(row.instagram_media_id),
    username: row.username ?? null,
    caption: row.caption ?? null,
    kind: row.kind ?? raw._trendKind ?? (row.media_type === "IMAGE" ? "image" : row.media_type === "CAROUSEL_ALBUM" ? "carousel" : "video"),
    mediaUrl: row.media_url ?? null,
    previewUrl: row.preview_url ?? raw._previewUrl ?? row.media_url ?? null,
    permalink: String(row.permalink),
    postedAt: iso(row.posted_at),
    likeCount: row.like_count === null || row.like_count === undefined ? null : Number(row.like_count),
    commentsCount: row.comments_count === null || row.comments_count === undefined ? null : Number(row.comments_count),
    metaRank: Number(row.meta_rank),
    refreshedAt: iso(row.refreshed_at ?? row.last_fetched_at)!,
    isSaved: Boolean(row.is_saved),
  };
}

async function loadHashtag(queryable: Queryable, normalizedTag: string): Promise<Row | null> {
  const found = await queryable.query(
    `select id, display_tag, normalized_tag, meta_hashtag_id, last_refreshed_at, last_error_code
     from instagram_trend_hashtags
     where normalized_tag = $1`,
    [normalizedTag],
  );
  return found.rows[0] ?? null;
}

async function ensureHashtag(queryable: Queryable, displayTag: string, normalizedTag: string): Promise<Row> {
  const existing = await loadHashtag(queryable, normalizedTag);
  if (existing) return existing;
  const inserted = await queryable.query(
    `insert into instagram_trend_hashtags (display_tag, normalized_tag)
     values ($1, $2)
     on conflict (normalized_tag) do update set display_tag = excluded.display_tag
     returning id, display_tag, normalized_tag, meta_hashtag_id, last_refreshed_at, last_error_code`,
    [displayTag, normalizedTag],
  );
  return inserted.rows[0];
}

async function recordSearch(queryable: Queryable, workspaceId: string, brandId: string, hashtagId: string, searchedAt: Date) {
  await queryable.query(
    `insert into brand_trend_searches (workspace_id, brand_id, hashtag_id, last_searched_at)
     values ($1, $2, $3, $4)
     on conflict (brand_id, hashtag_id) do update
       set last_searched_at = excluded.last_searched_at,
           search_count = brand_trend_searches.search_count + 1`,
    [workspaceId, brandId, hashtagId, searchedAt],
  );
}

function sortSql(sort: InstagramTrendListInput["sort"]): string {
  if (sort === "likes") return "media.like_count desc nulls last, relation.meta_rank asc";
  if (sort === "comments") return "media.comments_count desc nulls last, relation.meta_rank asc";
  return "relation.meta_rank asc";
}

function typeSql(type: InstagramTrendListInput["type"]): { sql: string; value?: string } {
  if (type === "image") return { sql: "and media.media_type = $4", value: "IMAGE" };
  if (type === "carousel") return { sql: "and media.media_type = $4", value: "CAROUSEL_ALBUM" };
  if (type === "video") return { sql: "and media.media_type = $4 and media.permalink !~ '/reel/[^/]+/?$'", value: "VIDEO" };
  if (type === "reel") return { sql: "and media.media_type = $4 and media.permalink ~ '/reel/[^/]+/?$'", value: "VIDEO" };
  return { sql: "" };
}

export function createInstagramTrendRepository(input: {
  pool: Pool;
  decryptCredential: (encrypted: string) => string;
  fetchTopMedia: FetchTopMedia;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
}) {
  const now = input.now ?? (() => new Date());
  const sleep = input.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  async function resolveConnection(queryable: Queryable, brandId: string): Promise<Row> {
    const connected = await queryable.query(
      `select brand.workspace_id,
              channel.id as brand_channel_id,
              channel.external_account_id as instagram_business_account_id,
              credential.encrypted_payload
       from brands brand
       join brand_channels channel
         on channel.brand_id = brand.id
        and channel.workspace_id = brand.workspace_id
        and channel.channel = 'instagram'
        and channel.status = 'connected'
        and channel.enabled = true
        and channel.deleted_at is null
       join channel_credentials credential
         on credential.brand_channel_id = channel.id
        and credential.brand_id = brand.id
        and credential.workspace_id = brand.workspace_id
        and credential.status = 'active'
        and credential.revoked_at is null
       where brand.id = $1 and brand.deleted_at is null
       order by credential.updated_at desc
       limit 1`,
      [brandId],
    );
    const row = connected.rows[0];
    if (!row || !row.instagram_business_account_id || !row.encrypted_payload) throw new Error("instagram_connection_required");
    return row;
  }

  async function pageFor(
    brandId: string,
    hashtagRow: Row,
    options: InstagramTrendListInput,
    source: "cache" | "meta",
    refreshed: boolean,
    queryable: Queryable = input.pool,
  ): Promise<InstagramTrendPageDto> {
    const page = Number.isInteger(options.page) && options.page > 0 ? options.page : 1;
    const offset = (page - 1) * PAGE_SIZE;
    const filter = typeSql(options.type);
    const values: unknown[] = [brandId, hashtagRow.id, PAGE_SIZE, ...(filter.value ? [filter.value] : []), offset];
    const offsetPlaceholder = filter.value ? "$5" : "$4";
    const refreshedPlaceholder = filter.value ? "$6" : "$5";
    const totalResult = await queryable.query(
      `select count(*)::int as total
       from instagram_trend_hashtag_media relation
       join instagram_trend_media media on media.id = relation.media_id
       where relation.hashtag_id = $1 ${filter.sql.replace("$4", "$2")}`,
      filter.value ? [hashtagRow.id, filter.value] : [hashtagRow.id],
    );
    const rows = await queryable.query(
      `select media.*,
              relation.meta_rank,
              ${refreshedPlaceholder}::timestamptz as refreshed_at,
              media.raw_metadata->>'_previewUrl' as preview_url,
              media.raw_metadata->>'_trendKind' as kind,
              exists (
                select 1 from brand_trend_saved_media saved
                where saved.brand_id = $1 and saved.trend_media_id = media.id
              ) as is_saved
       from instagram_trend_hashtag_media relation
       join instagram_trend_media media on media.id = relation.media_id
       where relation.hashtag_id = $2 ${filter.sql}
       order by ${sortSql(options.sort)}
       limit $3 offset ${offsetPlaceholder}`,
      [...values, hashtagRow.last_refreshed_at ?? now()],
    );
    return {
      hashtag: { id: String(hashtagRow.id), displayTag: String(hashtagRow.display_tag), normalizedTag: String(hashtagRow.normalized_tag) },
      source,
      refreshed,
      refreshedAt: iso(hashtagRow.last_refreshed_at),
      lastErrorCode: hashtagRow.last_error_code ?? null,
      page,
      pageSize: PAGE_SIZE,
      total: Number(totalResult.rows[0]?.total ?? 0),
      items: rows.rows.map(mapMedia),
    };
  }

  async function listContentCategories(): Promise<ContentCategoryDto[]> {
    const rows = await input.pool.query(
      `select category.code,
              category.name,
              coalesce((
                select jsonb_agg(hashtag.display_tag order by hashtag.sort_order)
                from content_category_hashtags hashtag
                where hashtag.category_id = category.id
                  and hashtag.subcategory_id is null
                  and hashtag.active = true
              ), '[]'::jsonb) as recommended_hashtags,
              coalesce((
                select jsonb_agg(jsonb_build_object('code', subcategory.code, 'name', subcategory.name) order by subcategory.sort_order)
                from content_subcategories subcategory
                where subcategory.category_id = category.id
                  and subcategory.active = true
              ), '[]'::jsonb) as subcategories
       from content_categories category
       where category.active = true
       order by category.sort_order`,
    );
    return rows.rows.map((row) => ({
      code: String(row.code),
      name: String(row.name),
      recommendedHashtags: Array.isArray(row.recommended_hashtags) ? row.recommended_hashtags.map(String) : [],
      subcategories: Array.isArray(row.subcategories) ? row.subcategories.map((item: Row) => ({ code: String(item.code), name: String(item.name) })) : [],
    }));
  }

  async function listInstagramTrends(brandId: string, options: InstagramTrendListInput): Promise<InstagramTrendPageDto> {
    const normalized = normalizeInstagramHashtag(options.hashtag);
    const found = await input.pool.query(
      `select hashtag.id, hashtag.display_tag, hashtag.normalized_tag, hashtag.last_refreshed_at, hashtag.last_error_code
       from brand_trend_searches search
       join instagram_trend_hashtags hashtag on hashtag.id = search.hashtag_id
       where search.brand_id = $1 and hashtag.normalized_tag = $2`,
      [brandId, normalized.normalizedTag],
    );
    if (!found.rowCount) throw new Error("instagram_trend_not_found");
    return pageFor(brandId, found.rows[0], options, "cache", false);
  }

  async function searchInstagramTrends(brandId: string, search: InstagramTrendSearchInput): Promise<InstagramTrendPageDto> {
    const normalized = normalizeInstagramHashtag(search.hashtag);
    const searchedAt = now();
    const client = await input.pool.connect();
    let transactionOpen = false;
    let connection: Row;
    let hashtagRow: Row;
    try {
      await client.query("begin");
      transactionOpen = true;
      connection = await resolveConnection(client, brandId);
      hashtagRow = await ensureHashtag(client, normalized.displayTag, normalized.normalizedTag);
      if (isFreshInstagramTrendCache(hashtagRow.last_refreshed_at, searchedAt, CACHE_TTL_MS)) {
        await recordSearch(client, connection.workspace_id, brandId, hashtagRow.id, searchedAt);
        await client.query("commit");
        transactionOpen = false;
        return pageFor(brandId, hashtagRow, { hashtag: search.hashtag, type: "all", sort: "meta", page: 1 }, "cache", false, client);
      }

      const lock = await client.query(
        `select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as locked`,
        [`instagram-trend:${normalized.normalizedTag}`],
      );
      if (!lock.rows[0]?.locked) {
        await client.query("rollback");
        transactionOpen = false;
        for (let attempt = 0; attempt < LOCK_POLL_ATTEMPTS; attempt += 1) {
          await sleep(LOCK_POLL_MS);
          const polled = await loadHashtag(client, normalized.normalizedTag);
          if (polled && isFreshInstagramTrendCache(polled.last_refreshed_at, now(), CACHE_TTL_MS)) {
            await recordSearch(client, connection.workspace_id, brandId, polled.id, searchedAt);
            return pageFor(brandId, polled, { hashtag: search.hashtag, type: "all", sort: "meta", page: 1 }, "cache", false, client);
          }
          if (polled) hashtagRow = polled;
        }
        await recordSearch(client, connection.workspace_id, brandId, hashtagRow.id, searchedAt);
        return pageFor(brandId, hashtagRow, { hashtag: search.hashtag, type: "all", sort: "meta", page: 1 }, "cache", false, client);
      }

      hashtagRow = (await loadHashtag(client, normalized.normalizedTag)) ?? hashtagRow;
      if (isFreshInstagramTrendCache(hashtagRow.last_refreshed_at, searchedAt, CACHE_TTL_MS)) {
        await recordSearch(client, connection.workspace_id, brandId, hashtagRow.id, searchedAt);
        await client.query("commit");
        transactionOpen = false;
        return pageFor(brandId, hashtagRow, { hashtag: search.hashtag, type: "all", sort: "meta", page: 1 }, "cache", false, client);
      }

      const cutoff = new Date(searchedAt.getTime() - QUOTA_WINDOW_MS);
      const quota = await client.query(
        `select
           (select count(*)::int from instagram_trend_account_hashtags quota
            where quota.brand_channel_id = $1 and quota.quota_window_started_at > $3) as quota_count,
           exists (
             select 1 from instagram_trend_account_hashtags current
             where current.brand_channel_id = $1 and current.hashtag_id = $2
               and current.quota_window_started_at > $3
           ) as current_active`,
        [connection.brand_channel_id, hashtagRow.id, cutoff],
      );
      if (Number(quota.rows[0]?.quota_count ?? 0) >= QUOTA_LIMIT && !quota.rows[0]?.current_active) {
        throw new Error("hashtag_search_limit_reached");
      }

      let accessToken: string;
      try {
        accessToken = input.decryptCredential(connection.encrypted_payload);
      } catch {
        throw new Error("instagram_reconnect_required");
      }

      let fetched: FetchInstagramHashtagTopMediaResult;
      try {
        fetched = await input.fetchTopMedia({
          accessToken,
          instagramBusinessAccountId: connection.instagram_business_account_id,
          hashtag: normalized.displayTag,
        });
      } catch (error) {
        const code = stableRefreshError(error);
        await client.query(
          `update instagram_trend_hashtags set last_error_code = $2 where id = $1`,
          [hashtagRow.id, code],
        );
        await client.query("commit");
        transactionOpen = false;
        throw new Error(code);
      }

      const mediaIds = new Map<string, string>();
      for (const item of fetched.media) {
        const metadata = { ...item.rawMetadata, _previewUrl: item.previewUrl, _trendKind: item.kind };
        const mediaResult = await client.query(
          `insert into instagram_trend_media (
             instagram_media_id, username, caption, media_type, media_url, permalink, posted_at,
             like_count, comments_count, last_fetched_at, raw_metadata
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
           on conflict (instagram_media_id) do update set
             username = excluded.username, caption = excluded.caption, media_type = excluded.media_type,
             media_url = excluded.media_url, permalink = excluded.permalink, posted_at = excluded.posted_at,
             like_count = excluded.like_count, comments_count = excluded.comments_count,
             last_fetched_at = excluded.last_fetched_at, raw_metadata = excluded.raw_metadata
           returning id`,
          [item.instagramMediaId, item.username, item.caption, item.mediaType, item.mediaUrl, item.permalink,
            item.postedAt, item.likeCount, item.commentsCount, searchedAt, JSON.stringify(metadata)],
        );
        mediaIds.set(item.instagramMediaId, String(mediaResult.rows[0].id));
      }
      await client.query(`delete from instagram_trend_hashtag_media where hashtag_id = $1`, [hashtagRow.id]);
      for (const item of fetched.media) {
        await client.query(
          `insert into instagram_trend_hashtag_media (hashtag_id, media_id, meta_rank, first_seen_at, last_seen_at)
           values ($1, $2, $3, $4, $4)`,
          [hashtagRow.id, mediaIds.get(item.instagramMediaId), item.metaRank, searchedAt],
        );
      }
      await client.query(
        `update instagram_trend_hashtags
         set meta_hashtag_id = $2, last_refreshed_at = $3, last_error_code = null
         where id = $1`,
        [hashtagRow.id, fetched.metaHashtagId, searchedAt],
      );
      await client.query(
        `insert into instagram_trend_account_hashtags (
           workspace_id, brand_id, brand_channel_id, hashtag_id, quota_window_started_at, last_meta_queried_at
         ) values ($1,$2,$3,$4,$5,$5)
         on conflict (brand_channel_id, hashtag_id) do update set
           quota_window_started_at = case
             when instagram_trend_account_hashtags.quota_window_started_at > $6
             then instagram_trend_account_hashtags.quota_window_started_at else excluded.quota_window_started_at end,
           last_meta_queried_at = excluded.last_meta_queried_at`,
        [connection.workspace_id, brandId, connection.brand_channel_id, hashtagRow.id, searchedAt, cutoff],
      );
      await recordSearch(client, connection.workspace_id, brandId, hashtagRow.id, searchedAt);
      await client.query("commit");
      transactionOpen = false;
      hashtagRow = { ...hashtagRow, meta_hashtag_id: fetched.metaHashtagId, last_refreshed_at: searchedAt, last_error_code: null };
      return pageFor(brandId, hashtagRow, { hashtag: search.hashtag, type: "all", sort: "meta", page: 1 }, "meta", true, client);
    } catch (error) {
      if (transactionOpen) {
        try { await client.query("rollback"); } catch { /* preserve original error */ }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async function listInstagramTrendSearches(brandId: string): Promise<InstagramTrendSearchHistoryDto[]> {
    const rows = await input.pool.query(
      `select search.hashtag_id, hashtag.display_tag, search.is_favorite, search.last_searched_at, search.search_count
       from brand_trend_searches search
       join instagram_trend_hashtags hashtag on hashtag.id = search.hashtag_id
       where search.brand_id = $1
       order by search.is_favorite desc, search.last_searched_at desc`,
      [brandId],
    );
    return rows.rows.map((row) => ({
      hashtagId: String(row.hashtag_id),
      displayTag: String(row.display_tag),
      isFavorite: Boolean(row.is_favorite),
      lastSearchedAt: iso(row.last_searched_at)!,
      searchCount: Number(row.search_count),
    }));
  }

  async function setInstagramTrendFavorite(brandId: string, hashtagId: string, favorite: InstagramTrendFavoriteInput) {
    const updated = await input.pool.query(
      `update brand_trend_searches
       set is_favorite = $3
       where brand_id = $1 and hashtag_id = $2
       returning hashtag_id`,
      [brandId, hashtagId, favorite.isFavorite],
    );
    if (!updated.rowCount) throw new Error("instagram_trend_not_found");
    return { hashtagId, isFavorite: favorite.isFavorite };
  }

  async function saveInstagramTrendSource(brandId: string, mediaId: string): Promise<InstagramTrendSaveSourceDto> {
    const savedAt = now();
    const client = await input.pool.connect();
    try {
      await client.query("begin");
      const brand = await client.query(`select workspace_id from brands where id = $1 and deleted_at is null`, [brandId]);
      if (!brand.rowCount) throw new Error("brand_not_found");
      const workspaceId = brand.rows[0].workspace_id;
      const selected = await client.query(
        `select id, instagram_media_id, username, caption, media_type, media_url, permalink, posted_at,
                like_count, comments_count, raw_metadata
         from instagram_trend_media media
         where media.id = $1
           and exists (
             select 1
             from instagram_trend_hashtag_media relation
             join brand_trend_searches search
               on search.hashtag_id = relation.hashtag_id
              and search.brand_id = $2
             where relation.media_id = media.id
           )
         for update`,
        [mediaId, brandId],
      );
      if (!selected.rowCount) throw new Error("instagram_trend_media_not_found");
      const item = selected.rows[0];
      const hash = hashSourceUrl(item.permalink);
      let sourceResult = await client.query(
        `select id, brand_id, source_type, url, title, status, enabled, last_crawled_at, last_error
         from source_urls
         where brand_id = $1 and source_type = 'reference' and url_hash = $2 and deleted_at is null
         for update`,
        [brandId, hash],
      );
      if (!sourceResult.rowCount) {
        await client.query(
          `insert into source_urls (
             workspace_id, brand_id, source_type, url, url_hash, domain, title, status, enabled, last_crawled_at
           ) values ($1,$2,'reference',$3,$4,'www.instagram.com',$5,'crawled',true,$6)
           on conflict do nothing`,
          [workspaceId, brandId, item.permalink, hash, item.caption?.slice(0, 200) ?? null, savedAt],
        );
        sourceResult = await client.query(
          `select id, brand_id, source_type, url, title, status, enabled, last_crawled_at, last_error
           from source_urls
           where brand_id = $1 and source_type = 'reference' and url_hash = $2 and deleted_at is null
           for update`,
          [brandId, hash],
        );
      }
      const source = sourceResult.rows[0];
      if (!source) throw new Error("instagram_trend_source_save_failed");
      const saved = await client.query(
        `insert into brand_trend_saved_media (workspace_id, brand_id, trend_media_id, source_url_id)
         values ($1,$2,$3,$4)
         on conflict (brand_id, trend_media_id) do nothing
         returning id`,
        [workspaceId, brandId, item.id, source.id],
      );
      const alreadySaved = !saved.rowCount;
      if (!alreadySaved) {
        const caption = item.caption ?? "";
        const hashtags = [...caption.matchAll(/#[\p{L}\p{N}_]+/gu)].map((match: RegExpMatchArray) => match[0]);
        await client.query(
          `insert into source_snapshots (
             workspace_id, brand_id, source_url_id, status, fetched_at, content_hash,
             extracted_title, extracted_text, summary, metadata
           ) values ($1,$2,$3,'succeeded',$4,$5,$6,$7,$8,$9::jsonb)`,
          [workspaceId, brandId, source.id, savedAt, textHash(caption), source.title, caption,
            caption.slice(0, 500) || null, JSON.stringify({
              instagramMediaId: item.instagram_media_id,
              username: item.username,
              mediaType: item.media_type,
              mediaUrl: item.media_url,
              permalink: item.permalink,
              postedAt: iso(item.posted_at),
              likeCount: item.like_count === null ? null : Number(item.like_count),
              commentsCount: item.comments_count === null ? null : Number(item.comments_count),
              hashtags,
            })],
        );
      }
      await client.query("commit");
      return { source: mapSource(source), alreadySaved };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    listContentCategories,
    listInstagramTrends,
    searchInstagramTrends,
    listInstagramTrendSearches,
    setInstagramTrendFavorite,
    saveInstagramTrendSource,
  };
}
