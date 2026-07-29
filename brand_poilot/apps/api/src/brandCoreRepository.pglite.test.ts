import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let database: PGlite | undefined;

beforeAll(async () => {
  database = await PGlite.create({ extensions: { pgcrypto } });
  const migrationDirectory = resolve(process.cwd(), "../../db/migrations");
  const files = (await readdir(migrationDirectory)).filter((file) => file.endsWith(".sql")).sort();

  for (const file of files) {
    const sql = await readFile(resolve(migrationDirectory, file), "utf8");
    if (sql.startsWith("-- requires: pgvector") || file === "027_wiki_search_v2.sql") continue;
    await database.exec(sql);
  }
}, 30_000);

afterAll(async () => {
  await database?.close();
});

describe("brand core PostgreSQL schema contract", () => {
  it("keeps approved versions tenant-safe and only permits one active approval", async () => {
    const db = database as PGlite;
    await db.exec(`
      insert into workspaces (id, name, slug)
        values ('10000000-0000-4000-8000-000000000001', 'Brand Core', 'brand-core');
      insert into brands (id, workspace_id, name)
        values ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'First');
      insert into brand_profiles (workspace_id, brand_id)
        values ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002');
      insert into brand_core_versions (
        id, workspace_id, brand_id, version, status, core_json, evidence_json, review_state_json, created_by, approved_at
      ) values (
        '30000000-0000-4000-8000-000000000003',
        '10000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000002',
        1,
        'approved',
        '{"contractVersion":1,"summary":{"oneLine":"첫 브랜드","description":"설명"}}',
        '[]',
        '{}',
        'migration',
        now()
      );
      update brand_profiles
         set active_brand_core_id = '30000000-0000-4000-8000-000000000003'
       where brand_id = '20000000-0000-4000-8000-000000000002';
    `);

    const profile = await db.query<{ active_brand_core_id: string }>(`
      select active_brand_core_id
      from brand_profiles
      where brand_id = '20000000-0000-4000-8000-000000000002'
    `);
    expect(profile.rows[0]?.active_brand_core_id).toBe("30000000-0000-4000-8000-000000000003");

    await db.exec(`
      insert into brand_core_versions (
        id, workspace_id, brand_id, version, status, core_json, evidence_json, review_state_json, created_by
      ) values (
        '30000000-0000-4000-8000-000000000004',
        '10000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000002',
        2,
        'draft',
        '{"contractVersion":1,"summary":{"oneLine":"수정 초안","description":"설명"}}',
        '[]',
        '{}',
        'migration'
      )
    `);
    const profileAfterDraft = await db.query<{ active_brand_core_id: string }>(`
      select active_brand_core_id
      from brand_profiles
      where brand_id = '20000000-0000-4000-8000-000000000002'
    `);
    expect(profileAfterDraft.rows[0]?.active_brand_core_id)
      .toBe("30000000-0000-4000-8000-000000000003");

    await expect(
      db.exec(`
        insert into brand_core_versions (
          workspace_id, brand_id, version, status, core_json, evidence_json, review_state_json, created_by, approved_at
        ) values (
          '10000000-0000-4000-8000-000000000001',
          '20000000-0000-4000-8000-000000000002',
          2,
          'approved',
          '{"contractVersion":1,"summary":{"oneLine":"중복","description":"설명"}}',
          '[]',
          '{}',
          'migration',
          now()
        )
      `),
    ).rejects.toThrow();
  }, 30_000);

  it("rejects a profile pointer to another tenant's core", async () => {
    const db = database as PGlite;
    await db.exec(`
      insert into workspaces (id, name, slug)
        values ('40000000-0000-4000-8000-000000000004', 'Other', 'other');
      insert into brands (id, workspace_id, name)
        values ('50000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000004', 'Other');
      insert into brand_profiles (workspace_id, brand_id)
        values ('40000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000005');
      insert into brand_core_versions (
        id, workspace_id, brand_id, version, status, core_json, evidence_json, review_state_json, created_by
      ) values (
        '60000000-0000-4000-8000-000000000006',
        '40000000-0000-4000-8000-000000000004',
        '50000000-0000-4000-8000-000000000005',
        1,
        'draft',
        '{"contractVersion":1,"summary":{"oneLine":"다른 브랜드","description":"설명"}}',
        '[]',
        '{}',
        'migration'
      );
    `);

    await expect(
      db.exec(`
        update brand_profiles
           set active_brand_core_id = '60000000-0000-4000-8000-000000000006'
         where brand_id = '20000000-0000-4000-8000-000000000002'
      `),
    ).rejects.toThrow();
  }, 30_000);

  it("allows only one concurrent draft per brand", async () => {
    const db = database as PGlite;
    const workspace = "70000000-0000-4000-8000-000000000007";
    const brand = "80000000-0000-4000-8000-000000000008";
    await db.exec(`
      insert into workspaces (id, name, slug)
        values ('${workspace}', 'Concurrent Core', 'concurrent-core');
      insert into brands (id, workspace_id, name)
        values ('${brand}', '${workspace}', 'Concurrent');
      insert into brand_profiles (workspace_id, brand_id)
        values ('${workspace}', '${brand}');
    `);

    const results = await Promise.allSettled([
      db.exec(`
        insert into brand_core_versions (
          workspace_id, brand_id, version, status, core_json, created_by
        ) values ('${workspace}', '${brand}', 1, 'draft', '{}', 'user')
      `),
      db.exec(`
        insert into brand_core_versions (
          workspace_id, brand_id, version, status, core_json, created_by
        ) values ('${workspace}', '${brand}', 2, 'draft', '{}', 'user')
      `),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const drafts = await db.query<{ count: number }>(`
      select count(*)::int count
        from brand_core_versions
       where workspace_id = '${workspace}' and brand_id = '${brand}' and status = 'draft'
    `);
    expect(drafts.rows[0]?.count).toBe(1);
  }, 30_000);
});
