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
    if (sql.includes("pg_advisory_unlock")) return result([{ unlocked: true }]);
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
  status: "connected",
  expires_at: null,
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

  it("requires a separate Facebook Login connection for hashtag trends", async () => {
    const fixture = poolWith((sql) => {
      if (sql.includes("join brand_channels channel")) return result([{ ...connected, encrypted_payload: null, instagram_business_account_id: null }]);
      throw new Error(`unexpected query: ${sql}`);
    });
    const repository = createInstagramTrendRepository({ pool: fixture.pool, decryptCredential: String, fetchTopMedia: vi.fn() as any, now: () => now });
    await expect(repository.searchInstagramTrends("brand-1", { hashtag: "마케팅" })).rejects.toThrow("instagram_trend_connection_required");
    expect(fixture.statements[1]?.sql).toContain("instagram_trend_connections");
  });

  it("stores trend credentials without replacing the publishing credential", async () => {
    const fixture = poolWith((sql, values) => {
      expect(sql).toContain("insert into instagram_trend_connections");
      expect(sql).not.toContain("channel_credentials");
      expect(values[1]).toBe("encrypted:facebook-token");
      return result([{
        status: "connected",
        account_label: "@brand",
        instagram_business_account_id: "ig-1",
        scopes: ["instagram_basic"],
        expires_at: null,
        last_error_code: null,
      }]);
    });
    const repository = createInstagramTrendRepository({
      pool: fixture.pool,
      decryptCredential: String,
      encryptCredential: (value) => `encrypted:${value}`,
      fetchTopMedia: vi.fn() as any,
      now: () => now,
    });
    await expect(repository.saveInstagramTrendCredentials("brand-1", {
      accountLabel: "@brand",
      accessToken: "facebook-token",
      expiresAt: null,
      facebookPageId: "page-1",
      instagramBusinessAccountId: "ig-1",
      maskedDisplay: "face...oken",
      scopes: ["instagram_basic"],
    })).resolves.toMatchObject({ status: "connected", accountLabel: "@brand" });
  });

  it("rejects the 31st unique hashtag in the rolling seven-day window", async () => {
    const stale = { ...hashtag, last_refreshed_at: new Date(now.getTime() - 25 * 60 * 60 * 1000) };
    const fixture = poolWith((sql) => {
      if (sql.includes("join brand_channels channel")) return result([connected]);
      if (sql.includes("from instagram_trend_hashtags") && sql.includes("normalized_tag")) return result([stale]);
      if (sql.includes("insert into instagram_trend_hashtags")) return result([stale]);
      if (sql.includes("pg_try_advisory_lock")) return result([{ locked: true }]);
      if (sql.includes("pg_advisory_xact_lock")) return result([{ locked: true }]);
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
      if (sql.includes("pg_try_advisory_lock")) return result([{ locked: false }]);
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
          if (sql.includes("pg_try_advisory_lock")) {
            if (lockOwner === null) {
              lockOwner = clientId;
              return result([{ locked: true }]);
            }
            return result([{ locked: lockOwner === clientId }]);
          }
          if (sql.includes("pg_advisory_unlock")) { lockOwner = null; return result([{ unlocked: true }]); }
          if (sql.includes("pg_advisory_xact_lock")) return result([{ locked: true }]);
          if (sql.includes("as quota_count")) return result([{ quota_count: 0, current_active: false }]);
          if (sql.includes("trend_category_terms")) return result([{ category_terms: [] }]);
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

  it("serializes quota checks for distinct hashtags at the 30th-slot boundary", async () => {
    const firstFetchStarted = deferred();
    const secondFetchStarted = deferred();
    const allowFirstFetch = deferred();
    const quotaWaiters: Array<{ clientId: number; resolve: () => void }> = [];
    const activeHashtags = new Set(Array.from({ length: 29 }, (_, index) => `existing-${index}`));
    let quotaLockOwner: number | null = null;
    let nextClientId = 0;

    function releaseQuotaLock(clientId: number) {
      if (quotaLockOwner !== clientId) return;
      const next = quotaWaiters.shift();
      quotaLockOwner = next?.clientId ?? null;
      next?.resolve();
    }

    function createClient() {
      const clientId = ++nextClientId;
      let pendingQuotaHashtag: string | null = null;
      return {
        release: vi.fn(),
        query: vi.fn(async (sql: string, values: unknown[] = []) => {
          const normalizedSql = sql.trim().toLowerCase();
          if (normalizedSql === "begin") return result();
          if (normalizedSql === "commit") {
            if (pendingQuotaHashtag) activeHashtags.add(pendingQuotaHashtag);
            releaseQuotaLock(clientId);
            return result();
          }
          if (normalizedSql === "rollback") {
            releaseQuotaLock(clientId);
            return result();
          }
          if (sql.includes("join brand_channels channel")) return result([connected]);
          if (sql.includes("from instagram_trend_hashtags") && sql.includes("normalized_tag")) {
            const tag = String(values[0]);
            return result([{ ...hashtag, id: `hashtag-${tag}`, display_tag: tag, normalized_tag: tag, last_refreshed_at: null }]);
          }
          if (sql.includes("pg_try_advisory_lock")) return result([{ locked: true }]);
          if (sql.includes("pg_advisory_unlock")) return result([{ unlocked: true }]);
          if (sql.includes("pg_advisory_xact_lock") && !sql.includes("pg_try")) {
            if (quotaLockOwner === null || quotaLockOwner === clientId) {
              quotaLockOwner = clientId;
              return result([{ locked: true }]);
            }
            await new Promise<void>((resolve) => quotaWaiters.push({ clientId, resolve }));
            return result([{ locked: true }]);
          }
          if (sql.includes("as quota_count")) return result([{ quota_count: activeHashtags.size, current_active: false }]);
          if (sql.includes("trend_category_terms")) return result([{ category_terms: [] }]);
          if (sql.includes("delete from instagram_trend_hashtag_media")) return result();
          if (sql.includes("update instagram_trend_hashtags")) return result();
          if (sql.includes("insert into instagram_trend_account_hashtags")) {
            pendingQuotaHashtag = String(values[3]);
            return result();
          }
          if (sql.includes("insert into brand_trend_searches")) return result();
          if (sql.includes("count(*)::int as total")) return result([{ total: 0 }]);
          if (sql.includes("from instagram_trend_hashtag_media relation")) return result();
          throw new Error(`unexpected query: ${sql}`);
        }),
      };
    }

    let fetchCount = 0;
    const fetchTopMedia = vi.fn(async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        firstFetchStarted.resolve();
        await allowFirstFetch.promise;
      } else {
        secondFetchStarted.resolve();
      }
      return { metaHashtagId: `meta-${fetchCount}`, media: [] };
    });
    const repository = createInstagramTrendRepository({
      pool: { connect: vi.fn(async () => createClient()), query: vi.fn() } as any,
      decryptCredential: () => "token",
      fetchTopMedia,
      now: () => now,
    });

    const first = repository.searchInstagramTrends("brand-1", { hashtag: "마케팅" });
    await firstFetchStarted.promise;
    const second = repository.searchInstagramTrends("brand-1", { hashtag: "브랜딩" });
    const settledPromise = Promise.allSettled([first, second]);
    const earlySecondFetch = await Promise.race([
      secondFetchStarted.promise.then(() => "called" as const),
      new Promise<"blocked">((resolve) => setImmediate(() => resolve("blocked"))),
    ]);
    allowFirstFetch.resolve();
    const settled = await settledPromise;

    expect(earlySecondFetch).toBe("blocked");
    expect(fetchTopMedia).toHaveBeenCalledTimes(1);
    expect(settled[0].status).toBe("fulfilled");
    expect(settled[1]).toMatchObject({ status: "rejected", reason: new Error("hashtag_search_limit_reached") });
    expect(activeHashtags.size).toBe(30);
  });

  it("replaces current ranks transactionally after a successful Meta refresh", async () => {
    const stale = { ...hashtag, last_refreshed_at: null };
    const fixture = poolWith((sql) => {
      if (sql.includes("join brand_channels channel")) return result([connected]);
      if (sql.includes("from instagram_trend_hashtags") && sql.includes("normalized_tag")) return result([stale]);
      if (sql.includes("insert into instagram_trend_hashtags")) return result([stale]);
      if (sql.includes("pg_try_advisory_lock")) return result([{ locked: true }]);
      if (sql.includes("pg_advisory_xact_lock")) return result([{ locked: true }]);
      if (sql.includes("as quota_count")) return result([{ quota_count: 0, current_active: false }]);
      if (sql.includes("trend_category_terms")) return result([{ category_terms: ["마케팅", "브랜딩"] }]);
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
      instagramMediaId: "ig-media-1", username: "creator", caption: "#마케팅 콘텐츠 전략", mediaType: "IMAGE", mediaUrl: media.media_url,
      previewUrl: media.preview_url, permalink: media.permalink, postedAt: now.toISOString(), likeCount: 10, commentsCount: 2,
      kind: "image", metaRank: 1, rawMetadata: {},
    }] }));
    const repository = createInstagramTrendRepository({ pool: fixture.pool, decryptCredential: () => "token", fetchTopMedia: fetchTopMedia as any, now: () => now });
    await repository.searchInstagramTrends("brand-1", { hashtag: "마케팅" });
    const sql = fixture.statements.map((entry) => entry.sql);
    expect(sql.findIndex((value) => value.includes("delete from instagram_trend_hashtag_media"))).toBeLessThan(sql.findIndex((value) => value.includes("insert into instagram_trend_hashtag_media")));
    expect(sql.some((value) => value.includes("insert into instagram_trend_account_hashtags"))).toBe(true);
  });

  it("commits quota reservation before waiting for Meta", async () => {
    const stale = { ...hashtag, last_refreshed_at: null };
    const fixture = poolWith((sql) => {
      if (sql.includes("join brand_channels channel")) return result([connected]);
      if (sql.includes("from instagram_trend_hashtags") && sql.includes("normalized_tag")) return result([stale]);
      if (sql.includes("insert into instagram_trend_hashtags")) return result([stale]);
      if (sql.includes("pg_try_advisory")) return result([{ locked: true }]);
      if (sql.includes("pg_advisory_xact_lock")) return result([{ locked: true }]);
      if (sql.includes("as quota_count")) return result([{ quota_count: 0, current_active: false }]);
      if (sql.includes("insert into instagram_trend_account_hashtags")) return result();
      if (sql.includes("trend_category_terms")) return result([{ category_terms: [] }]);
      if (sql.includes("insert into instagram_trend_media")) return result([{ id: "media-1", instagram_media_id: "ig-media-1" }]);
      if (sql.includes("delete from instagram_trend_hashtag_media")) return result();
      if (sql.includes("insert into instagram_trend_hashtag_media")) return result();
      if (sql.includes("update instagram_trend_hashtags")) return result();
      if (sql.includes("insert into brand_trend_searches")) return result();
      if (sql.includes("pg_advisory_unlock")) return result([{ unlocked: true }]);
      if (sql.includes("count(*)::int as total")) return result([{ total: 0 }]);
      if (sql.includes("from instagram_trend_hashtag_media relation")) return result();
      throw new Error(`unexpected query: ${sql}`);
    });
    const fetchTopMedia = vi.fn(async () => {
      fixture.statements.push({ sql: "__fetch_top_media__", values: [] });
      return { metaHashtagId: "meta-tag-1", media: [] };
    });
    const repository = createInstagramTrendRepository({ pool: fixture.pool, decryptCredential: () => "token", fetchTopMedia: fetchTopMedia as any, now: () => now });

    await repository.searchInstagramTrends("brand-1", { hashtag: "마케팅" });

    const sql = fixture.statements.map((entry) => entry.sql.trim().toLowerCase());
    expect(sql.indexOf("commit")).toBeLessThan(sql.indexOf("__fetch_top_media__"));
  });

  it("stores only trend relations that are semantically relevant to an ambiguous hashtag", async () => {
    const stale = { ...hashtag, display_tag: "IT", normalized_tag: "it", last_refreshed_at: null };
    const fixture = poolWith((sql) => {
      if (sql.includes("join brand_channels channel")) return result([connected]);
      if (sql.includes("trend_category_terms")) return result([{ category_terms: ["IT 소프트웨어", "개발", "데이터", "보안"] }]);
      if (sql.includes("from instagram_trend_hashtags") && sql.includes("normalized_tag")) return result([stale]);
      if (sql.includes("insert into instagram_trend_hashtags")) return result([stale]);
      if (sql.includes("pg_try_advisory_lock")) return result([{ locked: true }]);
      if (sql.includes("pg_advisory_xact_lock")) return result([{ locked: true }]);
      if (sql.includes("as quota_count")) return result([{ quota_count: 0, current_active: false }]);
      if (sql.includes("insert into instagram_trend_media")) return result([{ id: `media-${fixture.statements.filter((item) => item.sql.includes("insert into instagram_trend_media")).length}` }]);
      if (sql.includes("delete from instagram_trend_hashtag_media")) return result();
      if (sql.includes("insert into instagram_trend_hashtag_media")) return result();
      if (sql.includes("update instagram_trend_hashtags")) return result();
      if (sql.includes("insert into instagram_trend_account_hashtags")) return result();
      if (sql.includes("insert into brand_trend_searches")) return result();
      if (sql.includes("count(*)::int as total")) return result([{ total: 1 }]);
      if (sql.includes("from instagram_trend_hashtag_media relation")) return result([media]);
      throw new Error(`unexpected query: ${sql}`);
    });
    const repository = createInstagramTrendRepository({
      pool: fixture.pool,
      decryptCredential: () => "token",
      fetchTopMedia: vi.fn(async () => ({
        metaHashtagId: "meta-it",
        media: [
          { instagramMediaId: "relevant", username: "dev", caption: "#IT 개발과 데이터 보안 실무", mediaType: "IMAGE", mediaUrl: media.media_url, previewUrl: media.preview_url, permalink: `${media.permalink}relevant`, postedAt: now.toISOString(), likeCount: 10, commentsCount: 2, kind: "image", metaRank: 1, rawMetadata: {} },
          { instagramMediaId: "irrelevant", username: "family", caption: "I finally made it! #it #happy #family", mediaType: "IMAGE", mediaUrl: media.media_url, previewUrl: media.preview_url, permalink: `${media.permalink}irrelevant`, postedAt: now.toISOString(), likeCount: 100, commentsCount: 20, kind: "image", metaRank: 2, rawMetadata: {} },
        ],
      })) as any,
      now: () => now,
    });

    await repository.searchInstagramTrends("brand-1", { hashtag: "IT" });

    const relationWrites = fixture.statements.filter(({ sql }) => sql.includes("insert into instagram_trend_hashtag_media"));
    expect(relationWrites).toHaveLength(1);
    expect(JSON.parse(String(relationWrites[0]?.values[1]))).toEqual([
      expect.objectContaining({ instagram_media_id: "relevant", meta_rank: 1 }),
    ]);
  });

  it("records only a stable error when Meta refresh fails", async () => {
    const stale = { ...hashtag, last_refreshed_at: new Date(now.getTime() - 25 * 60 * 60 * 1000) };
    const fixture = poolWith((sql) => {
      if (sql.includes("join brand_channels channel")) return result([connected]);
      if (sql.includes("from instagram_trend_hashtags") && sql.includes("normalized_tag")) return result([stale]);
      if (sql.includes("insert into instagram_trend_hashtags")) return result([stale]);
      if (sql.includes("pg_try_advisory_lock")) return result([{ locked: true }]);
      if (sql.includes("pg_advisory_xact_lock")) return result([{ locked: true }]);
      if (sql.includes("as quota_count")) return result([{ quota_count: 0, current_active: false }]);
      if (sql.includes("insert into instagram_trend_account_hashtags")) return result();
      if (sql.includes("set last_error_code")) return result();
      throw new Error(`unexpected query: ${sql}`);
    });
    const repository = createInstagramTrendRepository({ pool: fixture.pool, decryptCredential: () => "token", fetchTopMedia: vi.fn(async () => { throw new Error("instagram_trend_fetch_failed"); }) as any, now: () => now });
    await expect(repository.searchInstagramTrends("brand-1", { hashtag: "마케팅" })).rejects.toThrow("instagram_trend_fetch_failed");
    const failureSql = fixture.statements.find(({ sql }) => sql.includes("set last_error_code"))?.sql ?? "";
    expect(failureSql).not.toContain("last_refreshed_at");
    expect(fixture.statements.some(({ sql }) => sql.includes("delete from instagram_trend_hashtag_media"))).toBe(false);
    expect(fixture.statements.some(({ sql }) => sql.includes("insert into instagram_trend_account_hashtags"))).toBe(true);
  });

  it("scopes history and favorites to the supplied brand", async () => {
    const fixture = poolWith((sql, values) => {
      expect(sql).toContain("brand_id = $1");
      expect(values[0]).toBe("brand-2");
      if (sql.includes("select search.hashtag_id")) return result([]);
      if (sql.includes("update brand_trend_searches")) return result([{
        hashtag_id: "hashtag-1",
        display_tag: "마케팅",
        is_favorite: true,
        last_searched_at: now,
        search_count: 3,
      }]);
      return result();
    });
    const repository = createInstagramTrendRepository({ pool: fixture.pool, decryptCredential: String, fetchTopMedia: vi.fn() as any });
    await repository.listInstagramTrendSearches("brand-2");
    await expect(repository.setInstagramTrendFavorite("brand-2", "hashtag-1", { isFavorite: true })).resolves.toEqual({
      hashtagId: "hashtag-1",
      displayTag: "마케팅",
      isFavorite: true,
      lastSearchedAt: now.toISOString(),
      searchCount: 3,
    });
  });

  it("deletes only one brand-scoped search history row", async () => {
    const fixture = poolWith((sql, values) => {
      expect(sql).toContain("delete from brand_trend_searches");
      expect(sql).toContain("brand_id = $1");
      expect(sql).toContain("hashtag_id = $2");
      expect(sql).not.toContain("instagram_trend_hashtags");
      expect(sql).not.toContain("instagram_trend_media");
      expect(sql).not.toContain("brand_trend_saved_media");
      expect(values).toEqual(["brand-2", "hashtag-1"]);
      return result([{ hashtag_id: "hashtag-1" }]);
    });
    const repository = createInstagramTrendRepository({ pool: fixture.pool, decryptCredential: String, fetchTopMedia: vi.fn() as any });

    await expect(repository.deleteInstagramTrendSearch("brand-2", "hashtag-1")).resolves.toEqual({ hashtagId: "hashtag-1" });
    expect(fixture.statements).toHaveLength(1);
  });

  it("removes only the brand-scoped saved-media relation and is idempotent", async () => {
    let removed = false;
    const fixture = poolWith((sql, values) => {
      expect(sql).toContain("delete from brand_trend_saved_media");
      expect(sql).toContain("brand_id = $1");
      expect(sql).toContain("trend_media_id = $2");
      expect(sql).not.toContain("source_urls");
      expect(sql).not.toContain("source_snapshots");
      expect(values).toEqual(["brand-2", "media-1"]);
      if (removed) return result();
      removed = true;
      return result([{ trend_media_id: "media-1" }]);
    });
    const repository = createInstagramTrendRepository({ pool: fixture.pool, decryptCredential: String, fetchTopMedia: vi.fn() as any });

    await expect(repository.removeInstagramTrendSource("brand-2", "media-1")).resolves.toEqual({ mediaId: "media-1", removed: true });
    await expect(repository.removeInstagramTrendSource("brand-2", "media-1")).resolves.toEqual({ mediaId: "media-1", removed: false });
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

  it("lists a brand archive newest-first from saved media and source infrastructure", async () => {
    const fixture = poolWith((sql, values) => {
      expect(sql).toContain("brand_id = $1");
      expect(values[0]).toBe("brand-2");
      if (sql.includes("count(*)::int as total")) {
        expect(sql).toContain("brand_trend_saved_media");
        return result([{ total: 12 }]);
      }
      expect(sql).toContain("from brand_trend_saved_media saved");
      expect(sql).toContain("join instagram_trend_media media");
      expect(sql).toContain("join source_urls source");
      expect(sql).toContain("order by saved.created_at desc");
      expect(values).toEqual(["brand-2", 30, 30]);
      return result([{ ...media, is_saved: true, saved_at: now }]);
    });
    const repository = createInstagramTrendRepository({ pool: fixture.pool, decryptCredential: String, fetchTopMedia: vi.fn() as any });

    await expect(repository.listInstagramTrendArchive("brand-2", { page: 2, limit: 30 })).resolves.toEqual({
      items: [expect.objectContaining({ id: "media-1", isSaved: true, savedAt: now.toISOString() })],
      page: 2,
      limit: 30,
      total: 12,
    });
  });
});
