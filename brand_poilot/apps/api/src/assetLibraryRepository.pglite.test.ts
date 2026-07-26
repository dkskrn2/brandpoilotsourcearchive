import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let database: PGlite | undefined;

const workspaceId = "21000000-0000-4000-8000-000000000001";
const brandId = "22000000-0000-4000-8000-000000000002";
const actorId = "23000000-0000-4000-8000-000000000003";

const transactionCommits = async (
  db: PGlite,
  operation: () => Promise<void>,
): Promise<boolean> => {
  await db.exec("begin");
  try {
    await operation();
    await db.exec("commit");
    return true;
  } catch {
    await db.exec("rollback").catch(() => undefined);
    return false;
  }
};

const stageAvatar = async (
  db: PGlite,
  input: {
    id: string;
    name: string;
    imageCount: number;
    representativePosition: number | null;
    isDefault?: boolean;
    avatarCreator?: string | null;
    imageCreator?: string | null;
  },
) => {
  await db.query(
    `insert into brand_avatars (
       id, workspace_id, brand_id, name, is_default, created_by_user_id
     ) values ($1, $2, $3, $4, $5, $6)`,
    [
      input.id,
      workspaceId,
      brandId,
      input.name,
      input.isDefault ?? false,
      input.avatarCreator === undefined ? actorId : input.avatarCreator,
    ],
  );
  for (let position = 1; position <= input.imageCount; position += 1) {
    await db.query(
      `insert into brand_avatar_images (
         workspace_id, brand_id, avatar_id, position, is_representative,
         storage_url, storage_path, mime_type, size_bytes, checksum, created_by_user_id
       ) values ($1, $2, $3, $4, $5, $6, $7, 'image/webp', 1024, $8, $9)`,
      [
        workspaceId,
        brandId,
        input.id,
        position,
        position === input.representativePosition,
        `https://cdn.example.com/${input.id}-${position}.webp`,
        `avatars/${input.id}-${position}.webp`,
        String(position).repeat(64),
        input.imageCreator === undefined ? actorId : input.imageCreator,
      ],
    );
  }
};

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
  it("requires a valid workspace actor for avatars and avatar images", async () => {
    const db = database as PGlite;
    const columns = await db.query<{ table_name: string; is_nullable: string }>(
      `select table_name, is_nullable
         from information_schema.columns
        where table_schema = 'public'
          and table_name in ('brand_avatars', 'brand_avatar_images')
          and column_name = 'created_by_user_id'
        order by table_name`,
    );
    expect(columns.rows).toEqual([
      { table_name: "brand_avatar_images", is_nullable: "NO" },
      { table_name: "brand_avatars", is_nullable: "NO" },
    ]);

    const nullAvatarId = "24000000-0000-4000-8000-000000000004";
    const nullAvatarCommitted = await transactionCommits(db, async () => {
      await stageAvatar(db, {
        id: nullAvatarId,
        name: "Missing avatar actor",
        imageCount: 1,
        representativePosition: 1,
        avatarCreator: null,
      });
    });
    if (nullAvatarCommitted) {
      await db.query("delete from brand_avatars where id = $1", [nullAvatarId]);
    }
    expect(nullAvatarCommitted).toBe(false);

    const nullImageId = "25000000-0000-4000-8000-000000000005";
    const nullImageCommitted = await transactionCommits(db, async () => {
      await stageAvatar(db, {
        id: nullImageId,
        name: "Missing image actor",
        imageCount: 1,
        representativePosition: 1,
        imageCreator: null,
      });
    });
    if (nullImageCommitted) {
      await db.query("delete from brand_avatars where id = $1", [nullImageId]);
    }
    expect(nullImageCommitted).toBe(false);
  });

  it("validates one-to-five images and exactly one representative at transaction commit", async () => {
    const db = database as PGlite;
    const zeroImageId = "26000000-0000-4000-8000-000000000006";
    const zeroImagesCommitted = await transactionCommits(db, async () => {
      await stageAvatar(db, {
        id: zeroImageId,
        name: "No images",
        imageCount: 0,
        representativePosition: null,
      });
    });
    if (zeroImagesCommitted) {
      await db.query("delete from brand_avatars where id = $1", [zeroImageId]);
    }
    expect(zeroImagesCommitted).toBe(false);

    const noRepresentativeId = "27000000-0000-4000-8000-000000000007";
    const noRepresentativeCommitted = await transactionCommits(db, async () => {
      await stageAvatar(db, {
        id: noRepresentativeId,
        name: "No representative",
        imageCount: 2,
        representativePosition: null,
      });
    });
    if (noRepresentativeCommitted) {
      await db.query("delete from brand_avatars where id = $1", [noRepresentativeId]);
    }
    expect(noRepresentativeCommitted).toBe(false);

    const tooManyId = "28000000-0000-4000-8000-000000000008";
    const tooManyCommitted = await transactionCommits(db, async () => {
      await stageAvatar(db, {
        id: tooManyId,
        name: "Too many images",
        imageCount: 6,
        representativePosition: 1,
      });
    });
    expect(tooManyCommitted).toBe(false);

    const validId = "29000000-0000-4000-8000-000000000009";
    const validCommitted = await transactionCommits(db, async () => {
      await stageAvatar(db, {
        id: validId,
        name: "Valid avatar",
        imageCount: 5,
        representativePosition: 1,
      });
    });
    expect(validCommitted).toBe(true);

    const representativeDeleteCommitted = await transactionCommits(db, async () => {
      await db.query(
        "delete from brand_avatar_images where avatar_id = $1 and is_representative",
        [validId],
      );
    });
    expect(representativeDeleteCommitted).toBe(false);
    const retainedRepresentative = await db.query<{ count: number }>(
      `select count(*)::int as count
         from brand_avatar_images
        where avatar_id = $1 and is_representative`,
      [validId],
    );
    expect(retainedRepresentative.rows[0]?.count).toBe(1);

    const cascadeDeleteCommitted = await transactionCommits(db, async () => {
      await db.query("delete from brand_avatars where id = $1", [validId]);
    });
    expect(cascadeDeleteCommitted).toBe(true);
  });

  it("keeps the active default unique across valid avatar transactions", async () => {
    const db = database as PGlite;
    const primaryCommitted = await transactionCommits(db, async () => {
      await stageAvatar(db, {
        id: "2a000000-0000-4000-8000-00000000000a",
        name: "Primary",
        imageCount: 1,
        representativePosition: 1,
        isDefault: true,
      });
    });
    expect(primaryCommitted).toBe(true);

    const competingCommitted = await transactionCommits(db, async () => {
      await stageAvatar(db, {
        id: "2b000000-0000-4000-8000-00000000000b",
        name: "Competing",
        imageCount: 1,
        representativePosition: 1,
        isDefault: true,
      });
    });
    expect(competingCommitted).toBe(false);
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
