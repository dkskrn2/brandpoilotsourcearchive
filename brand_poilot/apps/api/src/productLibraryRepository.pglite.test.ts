import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let database: PGlite | undefined;

beforeAll(async () => {
  database = await PGlite.create({ extensions: { pgcrypto } });
  const directory = resolve(process.cwd(), "../../db/migrations");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(resolve(directory, file), "utf8");
    if (sql.startsWith("-- requires: pgvector") || file === "027_wiki_search_v2.sql") continue;
    await database.exec(sql);
  }
}, 45_000);

afterAll(async () => {
  await database?.close();
});

describe("product service library PostgreSQL contract", () => {
  it("keeps an approved version behind a stable tenant-owned item", async () => {
    const db = database as PGlite;
    await db.exec(`
      insert into workspaces (id, name, slug)
      values ('11000000-0000-4000-8000-000000000001', 'Products', 'products');
      insert into brands (id, workspace_id, name)
      values ('12000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000001', 'First');
      insert into product_services (id, workspace_id, brand_id, kind, display_name)
      values (
        '13000000-0000-4000-8000-000000000003',
        '11000000-0000-4000-8000-000000000001',
        '12000000-0000-4000-8000-000000000002',
        'service',
        '브랜드 운영'
      );
      insert into product_service_versions (
        id, workspace_id, brand_id, product_service_id, version, status,
        profile_json, evidence_json, approved_at
      ) values (
        '14000000-0000-4000-8000-000000000004',
        '11000000-0000-4000-8000-000000000001',
        '12000000-0000-4000-8000-000000000002',
        '13000000-0000-4000-8000-000000000003',
        1,
        'approved',
        '{"contractVersion":"product-service.v1","name":"브랜드 운영","kind":"service"}',
        '[]',
        now()
      );
      update product_services
      set active_version_id = '14000000-0000-4000-8000-000000000004'
      where id = '13000000-0000-4000-8000-000000000003';
    `);
    const result = await db.query<{ active_version_id: string }>(
      "select active_version_id from product_services where id = '13000000-0000-4000-8000-000000000003'",
    );
    expect(result.rows[0]?.active_version_id).toBe("14000000-0000-4000-8000-000000000004");
  });

  it("rejects cross-brand versions and duplicate approved versions", async () => {
    const db = database as PGlite;
    await db.exec(`
      insert into brands (id, workspace_id, name)
      values ('15000000-0000-4000-8000-000000000005', '11000000-0000-4000-8000-000000000001', 'Second');
    `);
    await expect(db.exec(`
      insert into product_service_versions (
        workspace_id, brand_id, product_service_id, version, status, profile_json, approved_at
      ) values (
        '11000000-0000-4000-8000-000000000001',
        '15000000-0000-4000-8000-000000000005',
        '13000000-0000-4000-8000-000000000003',
        1, 'approved', '{}', now()
      )
    `)).rejects.toThrow();
    await expect(db.exec(`
      insert into product_service_versions (
        workspace_id, brand_id, product_service_id, version, status, profile_json, approved_at
      ) values (
        '11000000-0000-4000-8000-000000000001',
        '12000000-0000-4000-8000-000000000002',
        '13000000-0000-4000-8000-000000000003',
        2, 'approved', '{}', now()
      )
    `)).rejects.toThrow();
  });
});
