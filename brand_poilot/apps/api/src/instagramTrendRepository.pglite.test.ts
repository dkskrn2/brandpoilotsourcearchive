import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInstagramTrendRepository } from "./instagramTrendRepository.js";
import { hashSourceUrl } from "./sourceUrl.js";

type QueryResult = { rowCount: number; rows: Record<string, unknown>[] };

function pglitePool(database: PGlite): Pool {
  async function query(sql: string, values: unknown[] = []): Promise<QueryResult> {
    const result = await database.query(sql, values as never[]);
    return {
      rowCount: result.rows.length || Number(result.affectedRows ?? 0),
      rows: result.rows as Record<string, unknown>[],
    };
  }
  return {
    query,
    async connect() {
      return { query, release() {} };
    },
  } as unknown as Pool;
}

const workspaceId = "41000000-0000-4000-8000-000000000001";
const brandId = "42000000-0000-4000-8000-000000000002";
const actorId = "43000000-0000-4000-8000-000000000003";
const invalidActorId = "44000000-0000-4000-8000-000000000004";
const hashtagId = "45000000-0000-4000-8000-000000000005";
const mediaIds = [
  "46000000-0000-4000-8000-000000000006",
  "47000000-0000-4000-8000-000000000007",
  "48000000-0000-4000-8000-000000000008",
] as const;
let database: PGlite;
let repository: ReturnType<typeof createInstagramTrendRepository>;

beforeAll(async () => {
  database = await PGlite.create({ extensions: { pgcrypto } });
  const directory = resolve(process.cwd(), "../../db/migrations");
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = await readFile(resolve(directory, file), "utf8");
    if (sql.startsWith("-- requires: pgvector") || file === "027_wiki_search_v2.sql") continue;
    await database.exec(sql);
  }
  await database.exec(`
    insert into app_users (id, email)
    values ('${actorId}', 'trend-library@example.com');
    insert into workspaces (id, name, slug, created_by_user_id)
    values ('${workspaceId}', 'Trend Library', 'trend-library', '${actorId}');
    insert into workspace_members (workspace_id, user_id, role, status)
    values ('${workspaceId}', '${actorId}', 'owner', 'active');
    insert into brands (id, workspace_id, name, created_by_user_id)
    values ('${brandId}', '${workspaceId}', 'Trend Brand', '${actorId}');
    insert into instagram_trend_hashtags (
      id, normalized_tag, display_tag, last_refreshed_at
    ) values ('${hashtagId}', '브랜드', '브랜드', now());
  `);
  for (const [index, mediaId] of mediaIds.entries()) {
    await database.query(
      `insert into instagram_trend_media (
         id, instagram_media_id, username, caption, media_type, media_url,
         permalink, posted_at, last_fetched_at
       ) values ($1, $2, 'real_creator', $3, 'IMAGE', $4, $5, now(), now())`,
      [
        mediaId,
        `ig-media-${index + 1}`,
        `Trend caption ${index + 1} #브랜드`,
        `https://cdn.example.com/trend-${index + 1}.webp`,
        `https://www.instagram.com/p/trend-${index + 1}/`,
      ],
    );
    await database.query(
      `insert into instagram_trend_hashtag_media (
         hashtag_id, media_id, meta_rank, first_seen_at, last_seen_at
       ) values ($1, $2, $3, now(), now())`,
      [hashtagId, mediaId, index + 1],
    );
  }
  await database.query(
    `insert into brand_trend_searches (
       workspace_id, brand_id, hashtag_id, last_searched_at
     ) values ($1, $2, $3, now())`,
    [workspaceId, brandId, hashtagId],
  );
  repository = createInstagramTrendRepository({
    pool: pglitePool(database),
    decryptCredential: String,
    fetchTopMedia: async () => ({ items: [] }) as never,
  });
}, 45_000);

afterAll(async () => {
  await database?.close();
});

describe("Instagram trend canonical reference compatibility", () => {
  it("dual-writes one canonical item, archives it on remove, and reactivates it idempotently", async () => {
    const first = await repository.saveInstagramTrendSource(brandId, mediaIds[0], actorId);
    const repeated = await repository.saveInstagramTrendSource(brandId, mediaIds[0], actorId);
    expect(first.alreadySaved).toBe(false);
    expect(repeated.alreadySaved).toBe(true);

    const active = await database.query<{
      id: string;
      kind: string;
      saved_trend_id: string | null;
      source_url_id: string | null;
      created_by_user_id: string | null;
      archived_at: Date | null;
      provenance_count: number;
    }>(
      `select item.id, item.kind, item.saved_trend_id, item.source_url_id,
              item.created_by_user_id, item.archived_at,
              count(provenance.source_url_id)::int as provenance_count
         from reference_items item
         left join reference_item_source_url_provenance provenance
           on provenance.reference_item_id = item.id
        where item.brand_id = $1
        group by item.id`,
      [brandId],
    );
    expect(active.rows).toHaveLength(1);
    expect(active.rows[0]).toMatchObject({
      kind: "trend",
      source_url_id: null,
      created_by_user_id: actorId,
      archived_at: null,
      provenance_count: 1,
    });
    expect(active.rows[0].saved_trend_id).not.toBeNull();

    await expect(
      repository.removeInstagramTrendSource(brandId, mediaIds[0], actorId),
    ).resolves.toEqual({ mediaId: mediaIds[0], removed: true });
    await expect(
      repository.removeInstagramTrendSource(brandId, mediaIds[0], actorId),
    ).resolves.toEqual({ mediaId: mediaIds[0], removed: false });

    const archived = await database.query<{
      id: string;
      kind: string;
      saved_trend_id: string | null;
      source_url_id: string | null;
      archived_at: Date | null;
      enabled: boolean;
      status: string;
      saved_count: number;
    }>(
      `select item.id, item.kind, item.saved_trend_id, item.source_url_id,
              item.archived_at, source.enabled, source.status,
              (select count(*)::int from brand_trend_saved_media
                where brand_id = $1 and trend_media_id = $2) as saved_count
         from reference_items item
         join source_urls source on source.id = item.source_url_id
        where item.brand_id = $1`,
      [brandId, mediaIds[0]],
    );
    expect(archived.rows).toHaveLength(1);
    expect(archived.rows[0]).toMatchObject({
      id: active.rows[0].id,
      kind: "external_url",
      saved_trend_id: null,
      archived_at: expect.anything(),
      enabled: false,
      status: "disabled",
      saved_count: 0,
    });

    await database.query(
      "update source_urls set content_purpose = 'marketing' where id = $1",
      [archived.rows[0].source_url_id],
    );
    const resaved = await repository.saveInstagramTrendSource(brandId, mediaIds[0], actorId);
    expect(resaved.alreadySaved).toBe(false);
    const reactivated = await database.query<{
      id: string;
      kind: string;
      saved_trend_id: string | null;
      source_url_id: string | null;
      archived_at: Date | null;
      enabled: boolean;
      status: string;
      item_purpose: string;
      source_purpose: string;
    }>(
      `select item.id, item.kind, item.saved_trend_id, item.source_url_id,
              item.archived_at, source.enabled, source.status,
              item.content_purpose as item_purpose,
              source.content_purpose as source_purpose
         from reference_items item
         join reference_item_source_url_provenance provenance
           on provenance.reference_item_id = item.id
         join source_urls source on source.id = provenance.source_url_id
        where item.brand_id = $1`,
      [brandId],
    );
    expect(reactivated.rows).toEqual([
      expect.objectContaining({
        id: active.rows[0].id,
        kind: "trend",
        source_url_id: null,
        archived_at: null,
        enabled: true,
        status: "crawled",
        item_purpose: "marketing",
        source_purpose: "marketing",
      }),
    ]);
    expect(reactivated.rows[0].saved_trend_id).not.toBeNull();
  });

  it("rolls back every legacy and canonical write when the actor is invalid", async () => {
    await expect(
      repository.saveInstagramTrendSource(brandId, mediaIds[1], invalidActorId),
    ).rejects.toThrow();
    const counts = await database.query<{ sources: number; saved: number; canonical: number }>(
      `select
         (select count(*)::int from source_urls where url_hash = $1) as sources,
         (select count(*)::int from brand_trend_saved_media
           where brand_id = $2 and trend_media_id = $3) as saved,
         (select count(*)::int from reference_items item
           where item.brand_id = $2
             and item.metadata->>'instagramMediaId' = 'ig-media-2') as canonical`,
      [hashSourceUrl("https://www.instagram.com/p/trend-2/"), brandId, mediaIds[1]],
    );
    expect(counts.rows[0]).toEqual({ sources: 0, saved: 0, canonical: 0 });
  });

  it("covers old binaries during rolling deploy with migration-level save and remove synchronization", async () => {
    const source = await database.query<{ id: string }>(
      `insert into source_urls (
         workspace_id, brand_id, source_type, url, url_hash, domain, title,
         status, enabled, last_crawled_at
       ) values ($1, $2, 'reference', $3, $4, 'www.instagram.com',
         'Rolling save', 'crawled', true, now())
       returning id`,
      [
        workspaceId,
        brandId,
        "https://www.instagram.com/p/trend-3/",
        hashSourceUrl("https://www.instagram.com/p/trend-3/"),
      ],
    );
    await database.query(
      `insert into brand_trend_saved_media (
         workspace_id, brand_id, trend_media_id, source_url_id
       ) values ($1, $2, $3, $4)`,
      [workspaceId, brandId, mediaIds[2], source.rows[0].id],
    );
    const canonical = await database.query<{ count: number; provenance_count: number }>(
      `select count(*)::int as count,
              count(provenance.source_url_id)::int as provenance_count
         from reference_items item
         left join reference_item_source_url_provenance provenance
           on provenance.reference_item_id = item.id
        where item.brand_id = $1
          and item.metadata->>'instagramMediaId' = 'ig-media-3'`,
      [brandId],
    );
    expect(canonical.rows[0]).toEqual({ count: 1, provenance_count: 1 });

    const removed = await database.query(
      `delete from brand_trend_saved_media
        where brand_id = $1 and trend_media_id = $2
        returning trend_media_id`,
      [brandId, mediaIds[2]],
    );
    expect(removed.rows).toHaveLength(1);
    const archived = await database.query<{ archived: boolean; enabled: boolean }>(
      `select item.archived_at is not null as archived, source.enabled
         from reference_items item
         join source_urls source on source.id = item.source_url_id
        where item.brand_id = $1
          and item.metadata->>'instagramMediaId' = 'ig-media-3'`,
      [brandId],
    );
    expect(archived.rows).toEqual([{ archived: true, enabled: false }]);
  });
});
