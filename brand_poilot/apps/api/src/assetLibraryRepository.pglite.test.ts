import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let database: PGlite | undefined;

const workspaceId = "21000000-0000-4000-8000-000000000001";
const brandId = "22000000-0000-4000-8000-000000000002";
const actorId = "23000000-0000-4000-8000-000000000003";

beforeAll(async () => {
  database = await PGlite.create({ extensions: { pgcrypto } });
  const directory = resolve(process.cwd(), "../../db/migrations");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(resolve(directory, file), "utf8");
    if (sql.startsWith("-- requires: pgvector") || file === "027_wiki_search_v2.sql") continue;
    await database.exec(sql);
  }
  await database.exec(`
    insert into app_users (id, email)
    values ('${actorId}', 'asset-library@example.com');
    insert into workspaces (id, name, slug)
    values ('${workspaceId}', 'Asset Libraries', 'asset-libraries');
    insert into workspace_members (workspace_id, user_id, role)
    values ('${workspaceId}', '${actorId}', 'owner');
    insert into brands (id, workspace_id, name)
    values ('${brandId}', '${workspaceId}', 'Asset Library Brand');
  `);
}, 45_000);

afterAll(async () => {
  await database?.close();
});

describe("avatar and reference library PostgreSQL contract", () => {
  it("serializes competing active defaults and caps image positions at five", async () => {
    const db = database as PGlite;
    const defaults = await Promise.allSettled([
      db.query(
        `insert into brand_avatars (
           workspace_id, brand_id, name, is_default, created_by_user_id
         ) values ($1, $2, 'Primary', true, $3) returning id`,
        [workspaceId, brandId, actorId],
      ),
      db.query(
        `insert into brand_avatars (
           workspace_id, brand_id, name, is_default, created_by_user_id
         ) values ($1, $2, 'Competing', true, $3) returning id`,
        [workspaceId, brandId, actorId],
      ),
    ]);
    expect(defaults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(defaults.filter((result) => result.status === "rejected")).toHaveLength(1);

    const avatar = await db.query<{ id: string }>(
      "select id from brand_avatars where workspace_id = $1 and brand_id = $2",
      [workspaceId, brandId],
    );
    for (let position = 1; position <= 5; position += 1) {
      await db.query(
        `insert into brand_avatar_images (
           workspace_id, brand_id, avatar_id, position, is_representative,
           storage_url, storage_path, mime_type, size_bytes, checksum, created_by_user_id
         ) values ($1, $2, $3, $4, $5, $6, $7, 'image/webp', 1024, $8, $9)`,
        [
          workspaceId,
          brandId,
          avatar.rows[0].id,
          position,
          position === 1,
          `https://cdn.example.com/avatar-${position}.webp`,
          `avatars/avatar-${position}.webp`,
          String(position).repeat(64),
          actorId,
        ],
      );
    }
    await expect(db.query(
      `insert into brand_avatar_images (
         workspace_id, brand_id, avatar_id, position, is_representative,
         storage_url, storage_path, mime_type, size_bytes, checksum, created_by_user_id
       ) values ($1, $2, $3, 6, false, 'https://cdn.example.com/avatar-6.webp',
         'avatars/avatar-6.webp', 'image/webp', 1024, $4, $5)`,
      [workspaceId, brandId, avatar.rows[0].id, "6".repeat(64), actorId],
    )).rejects.toThrow();
  });

  it("deduplicates typed origins and rejects invalid image metadata", async () => {
    const db = database as PGlite;
    const source = await db.query<{ id: string }>(
      `insert into source_urls (
         workspace_id, brand_id, source_type, url, url_hash, status
       ) values ($1, $2, 'reference', 'https://example.com/reference', 'asset-ref', 'active')
       returning id`,
      [workspaceId, brandId],
    );
    await db.query(
      `insert into reference_items (
         workspace_id, brand_id, kind, source_url_id, created_by_user_id
       ) values ($1, $2, 'external_url', $3, $4)`,
      [workspaceId, brandId, source.rows[0].id, actorId],
    );
    await expect(db.query(
      `insert into reference_items (
         workspace_id, brand_id, kind, source_url_id, created_by_user_id
       ) values ($1, $2, 'saved_content', $3, $4)`,
      [workspaceId, brandId, source.rows[0].id, actorId],
    )).rejects.toThrow();
    await expect(db.query(
      `insert into reference_items (
         workspace_id, brand_id, kind, created_by_user_id
       ) values ($1, $2, 'external_url', $3)`,
      [workspaceId, brandId, actorId],
    )).rejects.toThrow();
  });
});
