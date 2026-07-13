import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const defaultMigrationDirectory = path.resolve(scriptDirectory, "../db/migrations");

const compatibleMigrationChecksums = Object.freeze({
  "014_instagram_delivery_formats.sql": Object.freeze({
    "7e45bc297cf35128368700b49f34974690d699198e465ecfb608ac9922cb1882":
      "db4ef9edcccd8f882ade789b1a2b0bc595c7f5c101fb3c9337b02576928e4a05",
  }),
});
const migrationAdvisoryLockName = "brand-pilot:schema-migrations:v1";

function checksum(sql) {
  return createHash("sha256").update(sql).digest("hex");
}

function clientConfig(connectionString) {
  const url = new URL(connectionString);
  if (url.hostname.endsWith(".supabase.com")) {
    url.searchParams.delete("sslmode");
    return { connectionString: url.toString(), ssl: { rejectUnauthorized: false } };
  }
  return { connectionString };
}

function isCompatibleMigrationChecksum(id, storedChecksum, currentChecksum) {
  return compatibleMigrationChecksums[id]?.[storedChecksum] === currentChecksum;
}

export function buildMigrationPlan(migrations, applied) {
  const appliedById = new Map(applied.map((migration) => [migration.id, migration.checksum]));
  for (const migration of migrations) {
    const storedChecksum = appliedById.get(migration.id);
    if (
      appliedById.has(migration.id)
      && storedChecksum !== migration.checksum
      && !isCompatibleMigrationChecksum(migration.id, storedChecksum, migration.checksum)
    ) {
      throw new Error(`migration_checksum_mismatch:${migration.id}`);
    }
  }
  return { pending: migrations.filter((migration) => !appliedById.has(migration.id)) };
}

export async function loadMigrations(directory = defaultMigrationDirectory) {
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  return Promise.all(files.map(async (id) => {
    const sql = await readFile(path.join(directory, id), "utf8");
    return { id, sql, checksum: checksum(sql) };
  }));
}

async function hasExistingApplicationSchema(client) {
  const result = await client.query("select to_regclass('public.workspaces') as relation");
  return Boolean(result.rows[0]?.relation);
}

async function ensureMigrationHistory(client) {
  await client.query(
    `create table if not exists schema_migrations (
       id text primary key,
       checksum text not null,
       applied_at timestamptz not null default now()
     )`
  );
}

async function readHistory(client) {
  const result = await client.query("select id, checksum from schema_migrations order by id asc");
  return result.rows;
}

async function baselineExistingSchema(client, migrations, baselineUpTo) {
  if (!baselineUpTo) throw new Error("migration_history_missing_baseline_required");
  const baselineIndex = migrations.findIndex((migration) => migration.id === baselineUpTo);
  if (baselineIndex < 0) throw new Error(`migration_baseline_not_found:${baselineUpTo}`);
  for (const migration of migrations.slice(0, baselineIndex + 1)) {
    await client.query(
      "insert into schema_migrations (id, checksum) values ($1, $2) on conflict (id) do nothing",
      [migration.id, migration.checksum]
    );
  }
}

export async function runMigrationsWithClient({
  client,
  migrations,
  baselineUpTo,
  dryRun = false,
}) {
  await client.query("select pg_advisory_lock(hashtext($1))", [migrationAdvisoryLockName]);
  try {
    if (dryRun) {
      const historyTable = await client.query("select to_regclass('public.schema_migrations') as relation");
      if (!historyTable.rows[0]?.relation) {
        return { migrations, pending: migrations.map((migration) => migration.id), baselineRequired: await hasExistingApplicationSchema(client) };
      }
      const plan = buildMigrationPlan(migrations, await readHistory(client));
      return { migrations, pending: plan.pending.map((migration) => migration.id), baselineRequired: false };
    }
    await ensureMigrationHistory(client);
    let history = await readHistory(client);
    if (history.length === 0 && await hasExistingApplicationSchema(client)) {
      await baselineExistingSchema(client, migrations, baselineUpTo);
      history = await readHistory(client);
    }
    const plan = buildMigrationPlan(migrations, history);
    for (const migration of plan.pending) {
      await client.query("begin");
      try {
        await client.query(migration.sql);
        await client.query("insert into schema_migrations (id, checksum) values ($1, $2)", [migration.id, migration.checksum]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
    return { migrations, pending: plan.pending.map((migration) => migration.id), baselineRequired: false };
  } finally {
    await client.query("select pg_advisory_unlock(hashtext($1))", [migrationAdvisoryLockName]);
  }
}

export async function runMigrations({ connectionString, migrationsDirectory = defaultMigrationDirectory, baselineUpTo, dryRun = false }) {
  if (!connectionString) throw new Error("database_url_required");
  const migrations = await loadMigrations(migrationsDirectory);
  const client = new Client(clientConfig(connectionString));
  await client.connect();
  try {
    return await runMigrationsWithClient({
      client,
      migrations,
      baselineUpTo,
      dryRun,
    });
  } finally {
    await client.end();
  }
}
