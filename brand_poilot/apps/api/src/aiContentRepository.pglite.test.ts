import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAiContentRepository } from "./aiContentRepository.js";

function pglitePool(database: PGlite): Pool {
  async function query(sql: string, values: unknown[] = []) {
    const result = await database.query(sql, values as never[]);
    return {
      rows: result.rows as Record<string, unknown>[],
      rowCount: result.rows.length || Number(result.affectedRows ?? 0),
    };
  }
  return {
    query,
    async connect() {
      return { query, release() {} };
    },
  } as unknown as Pool;
}

const ids = {
  workspace: "10000000-0000-4000-8000-000000000011",
  brand: "20000000-0000-4000-8000-000000000021",
  media: [
    "30000000-0000-4000-8000-000000000031",
    "30000000-0000-4000-8000-000000000032",
    "30000000-0000-4000-8000-000000000033",
    "30000000-0000-4000-8000-000000000034",
  ],
  saved: [
    "40000000-0000-4000-8000-000000000041",
    "40000000-0000-4000-8000-000000000042",
    "40000000-0000-4000-8000-000000000043",
    "40000000-0000-4000-8000-000000000044",
  ],
  source: [
    "50000000-0000-4000-8000-000000000051",
    "50000000-0000-4000-8000-000000000052",
    "50000000-0000-4000-8000-000000000053",
    "50000000-0000-4000-8000-000000000054",
  ],
  snapshot: [
    "70000000-0000-4000-8000-000000000071",
    "70000000-0000-4000-8000-000000000072",
    "70000000-0000-4000-8000-000000000073",
    "70000000-0000-4000-8000-000000000074",
  ],
} as const;

describe("AI content reference seed query in PostgreSQL", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = await PGlite.create({ extensions: { pgcrypto } });
    const directory = resolve(process.cwd(), "../../db/migrations");
    for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
      const sql = await readFile(resolve(directory, file), "utf8");
      if (sql.startsWith("-- requires: pgvector") || file === "027_wiki_search_v2.sql") continue;
      await database.exec(sql);
    }

    await database.exec(`
      insert into workspaces (id, name, slug)
      values ('${ids.workspace}', 'Reference Seeds', 'reference-seeds');
      insert into brands (id, workspace_id, name)
      values ('${ids.brand}', '${ids.workspace}', 'Reference Seed Brand');
    `);
  }, 45_000);

  afterAll(async () => {
    await database?.close();
  });

  it("uses exact item metadata category when no pattern version exists", async () => {
    const categories = ["beauty_fashion", "beauty_fashion", null, "finance_insurance"] as const;
    const likes = [90, 40, 900, 800] as const;
    const canonicalItemIds: string[] = [];

    for (let index = 0; index < ids.saved.length; index += 1) {
      await database.query(
        `insert into source_urls (
           id, workspace_id, brand_id, source_type, url, url_hash, title, content_purpose
         ) values ($1, $2, $3, 'reference', $4, $5, $6, 'both')`,
        [
          ids.source[index],
          ids.workspace,
          ids.brand,
          `https://source.example/reference-${index}`,
          `reference-seed-${index}`,
          `Reference ${index}`,
        ],
      );
      await database.query(
        `insert into instagram_trend_media (
           id, instagram_media_id, username, caption, media_type, permalink,
           like_count, comments_count, last_fetched_at
         ) values ($1, $2, 'creator', $3, 'CAROUSEL_ALBUM', $4, $5, $6, $7)`,
        [
          ids.media[index],
          `reference-seed-media-${index}`,
          `Reference ${index}`,
          `https://instagram.example/p/${index}`,
          likes[index],
          index,
          `2026-07-31T0${index}:00:00.000Z`,
        ],
      );
      await database.query(
        `insert into brand_trend_saved_media (
           id, workspace_id, brand_id, trend_media_id, source_url_id
         ) values ($1, $2, $3, $4, $5)`,
        [ids.saved[index], ids.workspace, ids.brand, ids.media[index], ids.source[index]],
      );
      await database.query(
        `update reference_items
            set title = $4,
                format = 'card_news',
                metadata = $5::jsonb
          where workspace_id = $1
            and brand_id = $2
            and saved_trend_id = $3`,
        [
          ids.workspace,
          ids.brand,
          ids.saved[index],
          `Reference ${index}`,
          JSON.stringify({
            ...(categories[index] ? { primaryCategory: categories[index] } : {}),
            outputFormat: "card_news",
          }),
        ],
      );
      const canonicalItem = await database.query<{ id: string }>(
        `select id::text as id
           from reference_items
          where workspace_id = $1
            and brand_id = $2
            and saved_trend_id = $3`,
        [ids.workspace, ids.brand, ids.saved[index]],
      );
      const canonicalItemId = canonicalItem.rows[0]?.id;
      expect(canonicalItemId).toBeTruthy();
      canonicalItemIds.push(canonicalItemId!);
      await database.query(
        `with payload as (
           select jsonb_build_object('caption', $6::text, 'text', $6::text) as content
         )
         insert into reference_snapshots (
           id, workspace_id, brand_id, reference_item_id, version,
           content_hash, captured_at, snapshot_json
         )
         select $1::uuid, $2::uuid, $3::uuid, $4::uuid, 1,
                encode(digest(payload.content::text, 'sha256'), 'hex'), $5::timestamptz,
                jsonb_build_object(
                  'snapshotId', $1::uuid::text,
                  'itemId', $4::uuid::text,
                  'version', 1,
                  'sourceUrl', $7::text,
                  'capturedAt', $8::text,
                  'contentHash', encode(digest(payload.content::text, 'sha256'), 'hex'),
                  'content', payload.content,
                  'media', '{}'::jsonb,
                  'sourceAvailability', 'available',
                  'provenance', jsonb_build_object('kind', 'fixture'),
                  'permittedUse', jsonb_build_object(
                    'displayPreview', true,
                    'archiveBytes', true,
                    'modelInput', true,
                    'derivativeInspiration', true
                  )
                )
           from payload`,
        [
          ids.snapshot[index],
          ids.workspace,
          ids.brand,
          canonicalItemId,
          `2026-07-31T0${index}:00:00.000Z`,
          `Reference body ${index}`,
          `https://source.example/reference-${index}`,
          `2026-07-31T0${index}:00:00.000Z`,
        ],
      );
    }

    const patternCount = await database.query<{ count: string }>(
      `select count(*)::text as count
         from reference_pattern_versions
        where reference_item_id = any($1::uuid[])`,
      [canonicalItemIds],
    );
    expect(patternCount.rows[0]?.count).toBe("0");

    const repository = createAiContentRepository(pglitePool(database));
    const result = await repository.listAiContentReferenceSeeds({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      primaryCategory: "beauty_fashion",
      format: "card_news",
      limit: 10,
    });

    expect(result.map((seed) => seed.id)).toEqual([canonicalItemIds[0], canonicalItemIds[1]]);
    expect(result.map((seed) => seed.metrics.likeCount)).toEqual([90, 40]);
    expect(result.every((seed) => seed.source === "saved_trend")).toBe(true);
  });
});
