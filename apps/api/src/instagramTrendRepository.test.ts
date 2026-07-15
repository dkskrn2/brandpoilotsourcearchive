import { describe, expect, it, vi } from "vitest";
import { createInstagramTrendRepository } from "./instagramTrendRepository";
import { hashSourceUrl } from "./sourceUrl";

type Result = { rowCount: number; rows: Array<Record<string, any>> };

function result(rows: Array<Record<string, any>> = []): Result {
  return { rowCount: rows.length, rows };
}

function poolWith(handler: (sql: string, values: unknown[]) => Promise<Result> | Result) {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    statements.push({ sql, values });
    if (["begin", "commit", "rollback"].includes(sql.trim().toLowerCase())) return result();
    return handler(sql, values);
  });
  return {
    pool: { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as any,
    statements,
  };
}

const now = new Date("2026-07-15T03:00:00.000Z");
const connected = {
  workspace_id: "workspace-1",
  brand_channel_id: "channel-1",
  instagram_business_account_id: "ig-1",
  encrypted_payload: "encrypted-token",
};
const hashtag = {
  id: "hashtag-1",
  display_tag: "마케팅",
  normalized_tag: "마케팅",
  meta_hashtag_id: "meta-tag-1",
  last_refreshed_at: new Date(now.getTime() - 60_000),
  last_error_code: null,
};
const media = {
  id: "media-1",
  instagram_media_id: "ig-media-1",
  username: "creator",
  caption: "caption",
  media_type: "IMAGE",
  media_url: "https://cdn.example/image.jpg",
  preview_url: "https://cdn.example/image.jpg",
  permalink: "https://www.instagram.com/p/post-1/",
  posted_at: now,
  like_count: 10,
  comments_count: 2,
  meta_rank: 1,
  last_fetched_at: now,
  refreshed_at: now,
  is_saved: false,
};

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe("createInstagramTrendRepository", () => {
  it("uses the canonical source URL hash contract", () => {
    expect(hashSourceUrl("  HTTPS://EXAMPLE.COM/path  ")).toBe("5faa4bf4918ff56562141cc328545ec8f7b6dd27470cbdf4a7487593b3e83738");
  });

  it("lists active categories in configured order with active children only", async () => {
    const fixture = poolWith((sql) => {
      expect(sql).toContain("where category.active = true");
      expect(sql).toContain("subcategory.active = true");
      expect(sql).toContain("hashtag.active = true");
      expect(sql).toContain("order by category.sort_order");
      return result([{ code: "travel", name: "여행", recommended_hashtags: ["여행"], subcategories: [{ code: "domestic", name: "국내여행" }] }]);
    });
    const repository = createInstagramTrendRepository({ pool: fixture.pool, decryptCredential: String, fetchTopMedia: vi.fn() as any });
    await expect(repository.listContentCategories()).resolves.toEqual([{ code: "travel", name: "여행", recommendedHashtags: ["여행"], subcategories: [{ code: "domestic", name: "국내여행" }] }]);
  });

  it("uses a fresh global cache for two brands without a Meta call", async () => {
    const fetchTopMedia = vi.fn();
    const fixture = poolWith((sql) => {
      if (sql.includes("join brand_channels channel")) return result([connected]);
      if (sql.includes("from instagram_trend_hashtags") && sql.includes("normalized_tag")) return result([hashtag]);
      if (sql.includes("insert into brand_trend_searches")) return result();
      if (sql.includes("count(*)::int as total")) return result([{ total: 1 }]);
      if (sql.includes("from instagram_trend_hashtag_media relation")) return result([media]);
      throw new Error(`unexpected query: ${sql}`);
    });
    const repository = createInstagramTrendRepository({ pool: fixture.pool, decryptCredential: String, fetchTopMedia: fetchTopMedia as any, now: () => now });
    await repository.searchInstagramTrends("brand-1", { hashtag: "#마케팅" });
    await repository.searchInstagramTrends("brand-2", { hashtag: "마케팅" });
    expect(fetchTopMedia).not.toHaveBeenCalled();
  });

  it("requires a connected Instagram channel and active credential", async () => {
    const fixture = poolWith((sql) => sql.includes("from brand_channels channel") ? result() : result());
    const repository = createInstagramTrendRepository({ pool: fixture.pool, decryptCredential: String, fetchTopMedia: vi.fn() as any, now: () => now });
    await expect(repository.searchInstagramTrends("brand-1", { hashtag: "마케팅" })).rejects.toThrow("instagram_connection_required");
  });

  it("rejects the 31st unique hashtag in the rolling seven-day window", async () => {
    const stale = { ...hashtag, last_refreshed_at: new Date(now.getTime() - 25 * 60 * 60 * 1000) };
    const fixture = poolWith((sql) => {
      if (sql.includes("join brand_channels channel")) return result([connected]);
      if (sql.includes("from instagram_trend_hashtags") && sql.includes("normalized_tag")) return result([stale]);
      if (sql.includes("insert into instagram_trend_hashtags")) return result([stale]);
      if (sql.includes("pg_try_advisory_xact_lock")) return result([{ locked: true }]);
      if (sql.includes("as quota_count")) return result([{ quota_count: 30, current_active: false }]);
      throw new Error(`unexpected query: ${sql}`);
    });
    const fetchTopMedia = vi.fn();
    const repository = createInstagramTrendRepository({ pool: fixture.pool, decryptCredential: () => "token", fetchTopMedia: fetchTopMedia as any, now: () => now });
    await expect(repository.searchInstagramTrends("brand-1", { hashtag: "마케팅" })).rejects.toThrow("hashtag_search_limit_reached");
    expect(fetchTopMedia).not.toHaveBeenCalled();
  });

  it("does not make a second Meta call when the advisory lock is unavailable", async () => {
    const stale = { ...hashtag, last_refreshed_at: new Date(now.getTime() - 25 * 60 * 60 * 1000) };
    let cacheReads = 0;
    const fixture = poolWith((sql) => {
      if (sql.includes("join brand_channels channel")) return result([connected]);
      if (sql.includes("insert into instagram_trend_hashtags")) return result([stale]);
      if (sql.includes("pg_try_advisory_xact_lock")) return result([{ locked: false }]);
      if (sql.includes("from instagram_trend_hashtags") && sql.includes("normalized_tag")) {
        cacheReads += 1;
        return result([{ ...stale, last_refreshed_at: cacheReads > 1 ? now : stale.last_refreshed_at }]);
      }
      if (sql.includes("insert into brand_trend_searches")) return result();
      if (sql.includes("count(*)::int as total")) return result([{ total: 1 }]);
      if (sql.includes("from instagram_trend_hashtag_media relation")) return result([media]);
      throw new Error(`unexpected query: ${sql}`);
    });
    const fetchTopMedia = vi.fn();
    const repository = createInstagramTrendRepository({ pool: fixture.pool, decryptCredential: () => "token", fetchTopMedia: fetchTopMedia as any, now: () => now, sleep: async () => undefined });
    const page = await repository.searchInstagramTrends("brand-1", { hashtag: "마케팅" });
    expect(fetchTopMedia).not.toHaveBeenCalled();
    expect(page.refreshed).toBe(false);
  });

  it("coordinates two overlapping stale searches so exactly one calls Meta", async () => {
    const fetchStarted = deferred();
    const allowFetch = deferred();
    const refreshCommitted = deferred();
    let lockOwner: number | null = null;
    let refreshedAt: Date | null = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    let nextClientId = 0;

    function createClient() {
      const clientId = ++nextClientId;
      let refreshPending = false;
      return {
        release: vi.fn(),
        query: vi.fn(async (sql: string) => {
          const normalizedSql = sql.trim().toLowerCase();
          if (normalizedSql === "begin") return result();
          if (normalizedSql === "rollback") return result();
          if (normalizedSql === "commit") {
            if (refreshPending) {
              refreshedAt = now;
              lockOwner = null;
              refreshCommitted.resolve();
            }
            return result();
          }
          if (sql.includes("join brand_channels channel")) return result([connected]);
          if (sql.includes("from instagram_trend_hashtags") && sql.includes("normalized_tag")) {
            return result([{ ...hashtag, last_refreshed_at: refreshedAt }]);
          }
          if (sql.includes("pg_try_advisory_xact_lock")) {
            if (lockOwner === null) {
              lockOwner = clientId;
              return result([{ locked: true }]);
            }
            return result([{ locked: lockOwner === clientId }]);
          }
          if (sql.includes("as quota_count")) return result([{ quota_count: 0, current_active: false }]);
          if (sql.includes("insert into instagram_trend_media")) return result([{ id: "media-1" }]);
          if (sql.includes("delete from instagram_trend_hashtag_media")) return result();
          if (sql.includes("insert into instagram_trend_hashtag_media")) return result();
          if (sql.includes("update instagram_trend_hashtags")) { refreshPending = true; return result(); }
          if (sql.includes("insert into instagram_trend_account_hashtags")) return result();
          if (sql.includes("insert into brand_trend_searches")) return result();
          if (sql.includes("count(*)::int as total")) return result([{ total: 1 }]);
          if (sql.includes("from instagram_trend_hashtag_media relation")) return result([media]);
          throw new Error(`unexpected query: ${sql}`);
        }),
      };
    }

    const pool = { connect: vi.fn(async () => createClient()), query: vi.fn() } as any;
    const fetchTopMedia = vi.fn(async () => {
      fetchStarted.resolve();
      await allowFetch.promise;
      return {
        metaHashtagId: "meta-tag-1",
        media: [{
          instagramMediaId: "ig-media-1", username: "creator", caption: "caption", mediaType: "IMAGE" as const,
          mediaUrl: media.media_url, previewUrl: media.preview_url, permalink: media.permalink,
          postedAt: now.toISOString(), likeCount: 10, commentsCount: 2, kind: "image" as const,
          metaRank: 1, rawMetadata: {},
        }],
      };
    });
    const repository = createInstagramTrendRepository({
      pool,
      decryptCredential: () => "token",
      fetchTopMedia,
      now: () => now,
      sleep: async () => {
        allowFetch.resolve();
        await refreshCommitted.promise;
      },
    });

    const first = repository.searchInstagramTrends("brand-1", { hashtag: "마케팅" });
    await fetchStarted.promise;
    const second = repository.searchInstagramTrends("brand-2", { hashtag: "마케팅" });
    const [firstPage, secondPage] = await Promise.all([first, second]);

    expect(fetchTopMedia).toHaveBeenCalledTimes(1);
    expect(firstPage.source).toBe("meta");
    expect(secondPage.source).toBe("cache");
  });

  it("replaces current ranks transactionally after a successful Meta refresh", async () => {
    const stale = { ...hashtag, last_refreshed_at: null };
    const fixture = poolWith((sql) => {
      if (sql.includes("join brand_channels channel")) return result([connected]);
      if (sql.includes("from instagram_trend_hashtags") && sql.includes("normalized_tag")) return result([stale]);
      if (sql.includes("insert into instagram_trend_hashtags")) return result([stale]);
      if (sql.includes("pg_try_advisory_xact_lock")) return result([{ locked: true }]);
      if (sql.includes("as quota_count")) return result([{ quota_count: 0, current_active: false }]);
      if (sql.includes("insert into instagram_trend_media")) return result([{ id: "media-1" }]);
      if (sql.includes("delete from instagram_trend_hashtag_media")) return result();
      if (sql.includes("insert into instagram_trend_hashtag_media")) return result();
      if (sql.includes("update instagram_trend_hashtags")) return result();
      if (sql.includes("insert into instagram_trend_account_hashtags")) return result();
      if (sql.includes("insert into brand_trend_searches")) return result();
      if (sql.includes("count(*)::int as total")) return result([{ total: 1 }]);
      if (sql.includes("from instagram_trend_hashtag_media relation")) return result([media]);
      throw new Error(`unexpected query: ${sql}`);
    });
    const fetchTopMedia = vi.fn(async () => ({ metaHashtagId: "meta-tag-1", media: [{
      instagramMediaId: "ig-media-1", username: "creator", caption: "caption", mediaType: "IMAGE", mediaUrl: media.media_url,
      previewUrl: media.preview_url, permalink: media.permalink, postedAt: now.toISOString(), likeCount: 10, commentsCount: 2,
      kind: "image", metaRank: 1, rawMetadata: {},
    }] }));
    const repository = createInstagramTrendRepository({ pool: fixture.pool, decryptCredential: () => "token", fetchTopMedia: fetchTopMedia as any, now: () => now });
    await repository.searchInstagramTrends("brand-1", { hashtag: "마케팅" });
    const sql = fixture.statements.map((entry) => entry.sql);
    expect(sql.findIndex((value) => value.includes("delete from instagram_trend_hashtag_media"))).toBeLessThan(sql.findIndex((value) => value.includes("insert into instagram_trend_hashtag_media")));
    expect(sql.some((value) => value.includes("insert into instagram_trend_account_hashtags"))).toBe(true);
  });

  it("records only a stable error when Meta refresh fails", async () => {
    const stale = { ...hashtag, last_refreshed_at: new Date(now.getTime() - 25 * 60 * 60 * 1000) };
    const fixture = poolWith((sql) => {
      if (sql.includes("join brand_channels channel")) return result([connected]);
      if (sql.includes("from instagram_trend_hashtags") && sql.includes("normalized_tag")) return result([stale]);
      if (sql.includes("insert into instagram_trend_hashtags")) return result([stale]);
      if (sql.includes("pg_try_advisory_xact_lock")) return result([{ locked: true }]);
      if (sql.includes("as quota_count")) return result([{ quota_count: 0, current_active: false }]);
      if (sql.includes("set last_error_code")) return result();
      throw new Error(`unexpected query: ${sql}`);
    });
    const repository = createInstagramTrendRepository({ pool: fixture.pool, decryptCredential: () => "token", fetchTopMedia: vi.fn(async () => { throw new Error("instagram_trend_fetch_failed"); }) as any, now: () => now });
    await expect(repository.searchInstagramTrends("brand-1", { hashtag: "마케팅" })).rejects.toThrow("instagram_trend_fetch_failed");
    const failureSql = fixture.statements.find(({ sql }) => sql.includes("set last_error_code"))?.sql ?? "";
    expect(failureSql).not.toContain("last_refreshed_at");
    expect(fixture.statements.some(({ sql }) => sql.includes("delete from instagram_trend_hashtag_media"))).toBe(false);
    expect(fixture.statements.some(({ sql }) => sql.includes("insert into instagram_trend_account_hashtags"))).toBe(false);
  });

  it("scopes history and favorites to the supplied brand", async () => {
    const fixture = poolWith((sql, values) => {
      expect(sql).toContain("brand_id = $1");
      expect(values[0]).toBe("brand-2");
      if (sql.includes("select search.hashtag_id")) return result([]);
      if (sql.includes("update brand_trend_searches")) return result([{ hashtag_id: "hashtag-1" }]);
      return result();
    });
    const repository = createInstagramTrendRepository({ pool: fixture.pool, decryptCredential: String, fetchTopMedia: vi.fn() as any });
    await repository.listInstagramTrendSearches("brand-2");
    await repository.setInstagramTrendFavorite("brand-2", "hashtag-1", { isFavorite: true });
  });

  it("creates one reference source and snapshot and returns it on duplicate save", async () => {
    let saved = false;
    let sourceCreated = false;
    const fixture = poolWith((sql) => {
      if (sql.includes("select workspace_id from brands")) return result([{ workspace_id: "workspace-1" }]);
      if (sql.includes("from instagram_trend_media") && sql.includes("for update")) return result([{ ...media, id: "media-1" }]);
      if (sql.includes("from source_urls") && sql.includes("url_hash")) return result(sourceCreated ? [{ id: "source-1", brand_id: "brand-1", source_type: "reference", url: media.permalink, title: media.caption, status: "crawled", enabled: true, last_crawled_at: now, last_error: null }] : []);
      if (sql.includes("insert into source_urls")) { sourceCreated = true; return result([{ id: "source-1" }]); }
      if (sql.includes("insert into brand_trend_saved_media")) {
        if (saved) return result();
        saved = true;
        return result([{ id: "saved-1" }]);
      }
      if (sql.includes("insert into source_snapshots")) return result([{ id: "snapshot-1" }]);
      if (sql.includes("select id, brand_id, source_type")) return result([{ id: "source-1", brand_id: "brand-1", source_type: "reference", url: media.permalink, title: media.caption, status: "crawled", enabled: true, last_crawled_at: now, last_error: null }]);
      throw new Error(`unexpected query: ${sql}`);
    });
    const repository = createInstagramTrendRepository({ pool: fixture.pool, decryptCredential: String, fetchTopMedia: vi.fn() as any, now: () => now });
    const first = await repository.saveInstagramTrendSource("brand-1", "media-1");
    const second = await repository.saveInstagramTrendSource("brand-1", "media-1");
    expect(first.alreadySaved).toBe(false);
    expect(second.alreadySaved).toBe(true);
    expect(fixture.statements.filter(({ sql }) => sql.includes("insert into source_snapshots"))).toHaveLength(1);
  });
});
