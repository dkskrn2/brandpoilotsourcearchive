import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Client } from "pg";
import {
  loadMigrations,
  resolveMigrationClientConfig,
  runMigrationsWithClient,
} from "./migrationRunner.mjs";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
const connectionString = process.env.POSTGRES_INTEGRATION_DATABASE_URL;
const pgvectorMigrationIds = new Set([
  "021_dm_wiki_pgvector.sql",
  "027_wiki_search_v2.sql",
  "033_compounding_wiki_pgvector.sql",
]);

const connectToSchema = async (schemaName) => {
  const client = new Client(resolveMigrationClientConfig(connectionString));
  await client.connect();
  await client.query(`set search_path to "${schemaName}", public`);
  return client;
};

const waitForLockWait = async (observer, backendPid) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const activity = await observer.query(
      "select wait_event_type from pg_stat_activity where pid=$1",
      [backendPid],
    );
    if (activity.rows[0]?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`backend ${backendPid} did not enter a lock wait`);
};

const insertNonlegacySession = (
  client,
  { generationId, workspaceId, brandId, actorId, storagePath },
) => client.query(
  `insert into ai_content_attachment_upload_sessions(
     generation_id,workspace_id,brand_id,created_by_user_id,nonce,role,file_name,
     expected_mime_type,expected_size_bytes,expected_checksum,storage_path,
     token_expires_at,created_at
   ) values($1,$2,$3,$4,$5,'document','concurrent.pdf','application/pdf',100,$6,$7,
     now()+interval '10 minutes',now()) returning id`,
  [
    generationId,
    workspaceId,
    brandId,
    actorId,
    randomUUID(),
    "7".repeat(64),
    storagePath,
  ],
);

test(
  "065 serializes real PostgreSQL attachment path reservations across connections",
  {
    skip: enabled
      ? false
      : "set RUN_POSTGRES_INTEGRATION=1 with POSTGRES_INTEGRATION_DATABASE_URL",
    timeout: 180_000,
  },
  async () => {
    assert.ok(
      connectionString,
      "POSTGRES_INTEGRATION_DATABASE_URL is required for the opt-in PostgreSQL test",
    );
    const schemaName = `attachment_lifecycle_${randomUUID().replaceAll("-", "")}`;
    const admin = new Client(resolveMigrationClientConfig(connectionString));
    let first;
    let second;
    await admin.connect();
    try {
      const version = await admin.query("show server_version_num");
      const versionNumber = Number(version.rows[0].server_version_num);
      assert.ok(
        versionNumber >= 160000 && versionNumber < 170000,
        `PostgreSQL 16 required, received ${versionNumber}`,
      );
      const existingApplicationSchema = await admin.query(
        "select to_regclass('public.workspaces') as relation",
      );
      assert.equal(
        existingApplicationSchema.rows[0].relation,
        null,
        "POSTGRES_INTEGRATION_DATABASE_URL must target a dedicated database",
      );
      await admin.query(`create schema "${schemaName}"`);
      await admin.query(`set search_path to "${schemaName}", public`);
      const migrations = (await loadMigrations()).filter(
        (migration) => !pgvectorMigrationIds.has(migration.id),
      );
      assert.ok(
        migrations.some(
          (migration) =>
            migration.id === "065_ai_content_attachment_upload_sessions.sql",
        ),
      );
      await runMigrationsWithClient({ client: admin, migrations });

      const actor = await admin.query(
        "insert into app_users(email) values($1) returning id",
        [`real-pg-${randomUUID()}@example.com`],
      );
      const workspace = await admin.query(
        "insert into workspaces(name,slug) values('Real PG lifecycle',$1) returning id",
        [`real-pg-lifecycle-${randomUUID()}`],
      );
      await admin.query(
        "insert into workspace_members(workspace_id,user_id,role) values($1,$2,'owner')",
        [workspace.rows[0].id, actor.rows[0].id],
      );
      const brand = await admin.query(
        "insert into brands(workspace_id,name) values($1,'Real PG lifecycle') returning id",
        [workspace.rows[0].id],
      );
      const generation = await admin.query(
        `insert into ai_content_generations(
           workspace_id,brand_id,type,title,status,analysis_idempotency_key
         ) values($1,$2,'blog','Real PG lifecycle','queued',$3) returning id`,
        [workspace.rows[0].id, brand.rows[0].id, randomUUID()],
      );
      const identity = {
        actorId: actor.rows[0].id,
        workspaceId: workspace.rows[0].id,
        brandId: brand.rows[0].id,
        generationId: generation.rows[0].id,
      };
      first = await connectToSchema(schemaName);
      second = await connectToSchema(schemaName);
      const secondBackend = await second.query(
        "select pg_backend_pid()::integer as pid",
      );
      const secondBackendPid = secondBackend.rows[0].pid;

      const legacyPath = `generation/${randomUUID()}/legacy-concurrent.pdf`;
      const legacyAttachment = await admin.query(
        `insert into ai_content_generation_attachments(
           generation_id,workspace_id,brand_id,role,file_name,mime_type,size_bytes,
           checksum,storage_url,storage_path
         ) values($1,$2,$3,'document','legacy.pdf','application/pdf',100,$4,
           'https://cdn.example.com/legacy.pdf',$5) returning id`,
        [
          identity.generationId,
          identity.workspaceId,
          identity.brandId,
          "8".repeat(64),
          legacyPath,
        ],
      );
      const legacySessionId = randomUUID();
      await first.query("begin");
      await first.query(
        `insert into ai_content_attachment_upload_sessions(
           id,generation_id,workspace_id,brand_id,created_by_user_id,nonce,role,file_name,
           expected_mime_type,expected_size_bytes,expected_checksum,storage_url,storage_path,
           status,token_expires_at,confirmed_at,confirmed_attachment_id,is_legacy_backfill,
           created_at,updated_at
         ) values($1,$2,$3,$4,null,$5,'document','legacy.pdf','application/pdf',100,$6,
           'https://cdn.example.com/legacy.pdf',$7,'confirmed',
           now()+interval '10 minutes',now(),$8,true,now(),now())`,
        [
          legacySessionId,
          identity.generationId,
          identity.workspaceId,
          identity.brandId,
          randomUUID(),
          "8".repeat(64),
          legacyPath,
          legacyAttachment.rows[0].id,
        ],
      );
      await first.query(
        "update ai_content_generation_attachments set upload_session_id=$2 where id=$1",
        [legacyAttachment.rows[0].id, legacySessionId],
      );
      const legacyLoser = insertNonlegacySession(second, {
        ...identity,
        storagePath: legacyPath,
      }).then(
        () => ({ inserted: true }),
        (error) => ({ inserted: false, error }),
      );
      await waitForLockWait(admin, secondBackendPid);
      await first.query("commit");
      const legacyOutcome = await legacyLoser;
      assert.equal(legacyOutcome.inserted, false);
      assert.equal(legacyOutcome.error.code, "23505");

      const nonlegacyPath = `generation/${randomUUID()}/new-concurrent.pdf`;
      await first.query("begin");
      const winningNonlegacy = await insertNonlegacySession(first, {
        ...identity,
        storagePath: nonlegacyPath,
      });
      const nonlegacyLoser = insertNonlegacySession(second, {
        ...identity,
        storagePath: nonlegacyPath,
      }).then(
        () => ({ inserted: true }),
        (error) => ({ inserted: false, error }),
      );
      await waitForLockWait(admin, secondBackendPid);
      await first.query("commit");
      const nonlegacyOutcome = await nonlegacyLoser;
      assert.equal(nonlegacyOutcome.inserted, false);
      assert.equal(nonlegacyOutcome.error.code, "23505");

      const guards = await admin.query(
        `select storage_path,legacy_session_count,nonlegacy_session_count
           from ai_content_attachment_storage_path_guards
          where storage_path in ($1,$2) order by storage_path`,
        [legacyPath, nonlegacyPath],
      );
      assert.deepEqual(
        new Map(guards.rows.map((row) => [row.storage_path, row])),
        new Map([
          [legacyPath, {
            storage_path: legacyPath,
            legacy_session_count: "1",
            nonlegacy_session_count: 0,
          }],
          [nonlegacyPath, {
            storage_path: nonlegacyPath,
            legacy_session_count: "0",
            nonlegacy_session_count: 1,
          }],
        ]),
      );

      await first.query(
        "delete from ai_content_attachment_upload_sessions where id=$1",
        [winningNonlegacy.rows[0].id],
      );
      const replacement = await insertNonlegacySession(second, {
        ...identity,
        storagePath: nonlegacyPath,
      });
      assert.equal(replacement.rows.length, 1);
      const replacementGuard = await admin.query(
        `select legacy_session_count,nonlegacy_session_count
           from ai_content_attachment_storage_path_guards where storage_path=$1`,
        [nonlegacyPath],
      );
      assert.deepEqual(replacementGuard.rows, [{
        legacy_session_count: "0",
        nonlegacy_session_count: 1,
      }]);
    } finally {
      if (first) {
        await first.query("rollback").catch(() => {});
        await first.end();
      }
      if (second) {
        await second.query("rollback").catch(() => {});
        await second.end();
      }
      await admin.query("set search_path to public");
      await admin.query(`drop schema if exists "${schemaName}" cascade`);
      await admin.end();
    }
  },
);
