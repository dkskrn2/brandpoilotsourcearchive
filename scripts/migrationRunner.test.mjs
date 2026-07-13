import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as migrationRunner from "./migrationRunner.mjs";

const { buildMigrationPlan } = migrationRunner;

const migrations = [
  { id: "001_initial.sql", checksum: "first", sql: "create table first_table();" },
  { id: "002_second.sql", checksum: "second", sql: "create table second_table();" },
];

const legacyInstagramDeliveryChecksum =
  "7e45bc297cf35128368700b49f34974690d699198e465ecfb608ac9922cb1882";
const currentInstagramDeliveryChecksum =
  "db4ef9edcccd8f882ade789b1a2b0bc595c7f5c101fb3c9337b02576928e4a05";

const loadInstagramDeliveryMigrations = async () => {
  const loaded = await migrationRunner.loadMigrations();
  const instagramMigrations = loaded.filter((migration) =>
    [
      "014_instagram_delivery_formats.sql",
      "015_delivery_format_legacy_channels.sql",
    ].includes(migration.id),
  );
  assert.equal(instagramMigrations[0]?.checksum, currentInstagramDeliveryChecksum);
  return instagramMigrations;
};

const createRecordingClient = ({ failMigration = false } = {}) => {
  const calls = [];
  return {
    calls,
    async query(sql, parameters = []) {
      const normalizedSql = sql.replace(/\s+/g, " ").trim();
      calls.push({ sql: normalizedSql, parameters });

      if (normalizedSql === "select id, checksum from schema_migrations order by id asc") {
        return { rows: [] };
      }
      if (normalizedSql.includes("to_regclass('public.workspaces')")) {
        return { rows: [{ relation: null }] };
      }
      if (normalizedSql === "select migration_body" && failMigration) {
        throw new Error("migration_execution_failed");
      }
      return { rows: [], rowCount: 0 };
    },
  };
};

test("legacy 014 fixture has the exact allowlisted checksum", async () => {
  const fixture = await readFile(
    "scripts/fixtures/014_instagram_delivery_formats.legacy.sql",
  );
  assert.equal(
    createHash("sha256").update(fixture).digest("hex"),
    legacyInstagramDeliveryChecksum,
  );
});

test("migration runner applies only migrations absent from history", () => {
  const plan = buildMigrationPlan(migrations, [{ id: "001_initial.sql", checksum: "first" }]);
  assert.deepEqual(plan.pending.map((migration) => migration.id), ["002_second.sql"]);
});

test("migration runner rejects history whose checksum differs from disk", () => {
  assert.throws(
    () => buildMigrationPlan(migrations, [{ id: "001_initial.sql", checksum: "changed" }]),
    /migration_checksum_mismatch:001_initial\.sql/,
  );
});

test("migration runner rejects an applied migration with an empty checksum", () => {
  assert.throws(
    () => buildMigrationPlan(migrations, [{ id: "001_initial.sql", checksum: "" }]),
    /migration_checksum_mismatch:001_initial\.sql/,
  );
});

test("migration runner accepts the exact legacy 014 checksum without rewriting history", async () => {
  const instagramDeliveryMigrations = await loadInstagramDeliveryMigrations();
  const applied = [
    {
      id: "014_instagram_delivery_formats.sql",
      checksum: legacyInstagramDeliveryChecksum,
    },
  ];

  const plan = buildMigrationPlan(instagramDeliveryMigrations, applied);

  assert.deepEqual(plan.pending.map((migration) => migration.id), [
    "015_delivery_format_legacy_channels.sql",
  ]);
  assert.equal(applied[0].checksum, legacyInstagramDeliveryChecksum);
});

test("migration runner rejects an unknown checksum mismatch for 014", async () => {
  const instagramDeliveryMigrations = await loadInstagramDeliveryMigrations();
  assert.throws(
    () =>
      buildMigrationPlan(instagramDeliveryMigrations, [
        {
          id: "014_instagram_delivery_formats.sql",
          checksum: "unknown-014-checksum",
        },
      ]),
    /migration_checksum_mismatch:014_instagram_delivery_formats\.sql/,
  );
});

test("migration runner accepts the exact current checksum for 014", async () => {
  const instagramDeliveryMigrations = await loadInstagramDeliveryMigrations();
  const plan = buildMigrationPlan(instagramDeliveryMigrations, [
    {
      id: "014_instagram_delivery_formats.sql",
      checksum: instagramDeliveryMigrations[0].checksum,
    },
  ]);

  assert.deepEqual(plan.pending.map((migration) => migration.id), [
    "015_delivery_format_legacy_channels.sql",
  ]);
});

test("legacy 014 compatibility does not permit a different current file checksum", async () => {
  const instagramDeliveryMigrations = await loadInstagramDeliveryMigrations();
  assert.throws(
    () =>
      buildMigrationPlan(
        [
          {
            ...instagramDeliveryMigrations[0],
            checksum: "unexpected-new-014-checksum",
          },
          instagramDeliveryMigrations[1],
        ],
        [
          {
            id: "014_instagram_delivery_formats.sql",
            checksum: legacyInstagramDeliveryChecksum,
          },
        ],
      ),
    /migration_checksum_mismatch:014_instagram_delivery_formats\.sql/,
  );
});

test("migration runner holds one advisory lock before history read and migration application", async () => {
  const client = createRecordingClient();

  await migrationRunner.runMigrationsWithClient({
    client,
    migrations: [
      {
        id: "001_lock_test.sql",
        checksum: "lock-test",
        sql: "select migration_body",
      },
    ],
  });

  const lockIndex = client.calls.findIndex((call) => call.sql.includes("pg_advisory_lock"));
  const historyIndex = client.calls.findIndex((call) =>
    call.sql.startsWith("select id, checksum from schema_migrations"),
  );
  const migrationIndex = client.calls.findIndex((call) => call.sql === "select migration_body");
  const unlockIndex = client.calls.findIndex((call) => call.sql.includes("pg_advisory_unlock"));

  assert.ok(lockIndex >= 0 && lockIndex < historyIndex);
  assert.ok(lockIndex < migrationIndex);
  assert.equal(unlockIndex, client.calls.length - 1);
  assert.deepEqual(client.calls[lockIndex].parameters, ["brand-pilot:schema-migrations:v1"]);
  assert.deepEqual(client.calls[unlockIndex].parameters, ["brand-pilot:schema-migrations:v1"]);
});

test("migration runner unlocks its advisory lock in finally when migration application fails", async () => {
  const client = createRecordingClient({ failMigration: true });

  await assert.rejects(
    () =>
      migrationRunner.runMigrationsWithClient({
        client,
        migrations: [
          {
            id: "001_lock_error.sql",
            checksum: "lock-error",
            sql: "select migration_body",
          },
        ],
      }),
    /migration_execution_failed/,
  );

  const rollbackIndex = client.calls.findIndex((call) => call.sql === "rollback");
  const unlockIndex = client.calls.findIndex((call) => call.sql.includes("pg_advisory_unlock"));
  assert.ok(rollbackIndex >= 0 && rollbackIndex < unlockIndex);
  assert.equal(unlockIndex, client.calls.length - 1);
});
