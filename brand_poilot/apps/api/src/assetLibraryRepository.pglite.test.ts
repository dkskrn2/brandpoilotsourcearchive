import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createAssetLibraryRepository } from "./assetLibraryRepository.js";

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

const repositoryPool = (db: PGlite) => {
  const query = async (sql: string, values: unknown[] = []) => {
    const result = await db.query(sql, values);
    return {
      ...result,
      rowCount: result.rows.length || result.affectedRows,
    };
  };
  return {
    query,
    connect: async () => ({ query, release() {} }),
  } as unknown as Pool;
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

  it("frees active URL quota on archive and restores one canonical item", async () => {
    const db = database as PGlite;
    const repository = createAssetLibraryRepository(repositoryPool(db));
    const scope = { workspaceId, brandId, actorUserId: actorId };
    const url = "https://example.com/archive-and-restore";
    const created = await repository.addReferenceUrl(scope, {
      url,
      title: "Archive and restore",
      contentPurpose: "both",
    });

    await repository.archiveReference({ ...scope, referenceId: created.id });
    const archived = await db.query<{ enabled: boolean; status: string }>(
      `select source.enabled,source.status
         from reference_items item join source_urls source on source.id=item.source_url_id
        where item.id=$1`,
      [created.id],
    );
    expect(archived.rows[0]).toEqual({ enabled: false, status: "disabled" });

    const restored = await repository.addReferenceUrl(scope, {
      url,
      title: "Archive and restore",
      contentPurpose: "both",
    });
    expect(restored.id).toBe(created.id);
    const canonical = await db.query<{ item_count: number; active_count: number }>(
      `select
         (select count(*)::int from reference_items where source_url_id=source.id) item_count,
         (select count(*)::int from source_urls active
           where active.workspace_id=$1 and active.brand_id=$2 and active.source_type='reference'
             and active.enabled and active.status<>'disabled' and active.deleted_at is null) active_count
       from source_urls source where source.id=(
         select source_url_id from reference_items where id=$3
       )`,
      [workspaceId, brandId, created.id],
    );
    expect(canonical.rows[0]?.item_count).toBe(1);
    expect(canonical.rows[0]?.active_count).toBeGreaterThanOrEqual(1);
  });

  it("keeps list rows lightweight and lazy-loads the latest successful real snapshot", async () => {
    const db = database as PGlite;
    const repository = createAssetLibraryRepository(repositoryPool(db));
    const source = await db.query<{ id: string }>(
      `insert into source_urls (
         workspace_id,brand_id,source_type,url,url_hash,domain,title,meta_description,status,
         enabled,content_purpose
       ) values($1,$2,'reference',$3,$4,'snapshot.example','Stored source title',
         'Stored source description','crawl_failed',false,'both') returning id`,
      [workspaceId, brandId, "https://snapshot.example/article", `snapshot-${Date.now()}`],
    );
    const inserted = await db.query<{ id: string }>(
      `insert into reference_items (
         workspace_id,brand_id,kind,content_purpose,origin,title,source_url,format,metadata,
         source_url_id,created_by_user_id
       ) values($1,$2,'external_url','both','snapshot.example','Stored title',$3,'url',
         $4::jsonb,$5,$6) returning id`,
      [
        workspaceId,
        brandId,
        "https://snapshot.example/article",
        JSON.stringify({ description: "Legacy retained description", caption: "must not be listed" }),
        source.rows[0].id,
        actorId,
      ],
    );
    await db.query(
      `insert into source_snapshots (
         workspace_id,brand_id,source_url_id,status,fetched_at,extracted_title,
         extracted_text,summary,metadata
       ) values
       ($1,$2,$3,'succeeded',now()-interval '2 hours','Old title','Old body','Old summary','{}'),
       ($1,$2,$3,'succeeded',now()-interval '1 hour','Latest real title','Latest body',
         'Latest summary',$4::jsonb),
       ($1,$2,$3,'failed',now(),'Failed title',null,null,'{}')`,
      [
        workspaceId,
        brandId,
        source.rows[0].id,
        JSON.stringify({ ogImage: "https://cdn.example.com/latest-og.webp", crawler: "brand-pilot-api" }),
      ],
    );

    const listed = await repository.listReferences({ workspaceId, brandId }, { origin: "snapshot.example" });
    const summary = listed.find((item) => item.id === inserted.rows[0].id);
    expect(summary).toMatchObject({
      title: "Latest real title",
      previewUrl: "https://cdn.example.com/latest-og.webp",
      metadata: { patternAvailable: false },
    });
    expect(summary?.metadata).not.toHaveProperty("caption");
    expect(summary?.metadata).not.toHaveProperty("description");

    const detail = await repository.getReference({
      workspaceId,
      brandId,
      referenceId: inserted.rows[0].id,
    });
    expect(detail).toMatchObject({
      title: "Latest real title",
      sourceUrl: "https://snapshot.example/article",
      previewUrl: "https://cdn.example.com/latest-og.webp",
      description: "Latest summary",
      body: "Latest body",
      snapshot: {
        metadata: { ogImage: "https://cdn.example.com/latest-og.webp", crawler: "brand-pilot-api" },
      },
    });
  });
});
