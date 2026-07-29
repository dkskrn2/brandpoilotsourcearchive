import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { loadMigrations } from "./migrationRunner.mjs";

test("067 adds a tenant-scoped observable Wiki refresh outbox without backfill", async () => {
  const migrations = await loadMigrations();
  const migration = migrations.find((entry) => entry.id === "067_wiki_refresh_outbox.sql");
  assert.ok(migration, "067 Wiki refresh outbox migration must exist");

  const database = await PGlite.create({ extensions: { pgcrypto } });
  try {
    for (const entry of migrations) {
      if (entry.id > migration.id) break;
      if (entry.sql.startsWith("-- requires: pgvector") || entry.id === "027_wiki_search_v2.sql") continue;
      await database.exec(entry.sql);
    }

    const columns = await database.query(`
      select column_name, is_nullable
        from information_schema.columns
       where table_schema = 'public' and table_name = 'wiki_refresh_outbox'
       order by ordinal_position
    `);
    assert.deepEqual(columns.rows.map((row) => row.column_name), [
      "id", "workspace_id", "brand_id", "source_kind", "source_id", "event_type",
      "mutation_key", "status", "attempt_count", "next_attempt_at", "lease_owner",
      "lease_token", "lease_expires_at", "last_error", "succeeded_at", "created_at", "updated_at",
    ]);
    assert.equal(columns.rows.find((row) => row.column_name === "last_error")?.is_nullable, "YES");

    const indexes = await database.query(`
      select indexname, indexdef
        from pg_indexes
       where schemaname = 'public' and tablename = 'wiki_refresh_outbox'
    `);
    assert.ok(indexes.rows.some((row) =>
      row.indexdef.includes("(workspace_id, brand_id, source_kind, source_id, mutation_key)")));
    assert.ok(indexes.rows.some((row) =>
      row.indexdef.includes("(status, next_attempt_at, created_at)")));
    assert.equal((await database.query("select count(*)::int as count from wiki_refresh_outbox")).rows[0].count, 0);
  } finally {
    await database.close();
  }
});
