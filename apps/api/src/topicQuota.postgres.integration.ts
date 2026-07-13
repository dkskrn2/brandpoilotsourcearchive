import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool, type PoolClient } from "pg";
import { createRepository } from "./repository.js";

const sameNow = new Date("2026-07-13T01:00:00.000Z");
const policyDate = "2026-07-13";
const migrationsDirectory = fileURLToPath(new URL("../../../db/migrations/", import.meta.url));

async function applyMigrations001Through017(client: PoolClient) {
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => /^\d{3}_.+\.sql$/.test(file) && file.slice(0, 3) <= "017")
    .sort();
  assert.equal(migrationFiles[0], "001_initial_schema.sql");
  assert.equal(migrationFiles.at(-1), "017_preserve_topic_publish_group_status.sql");
  assert.equal(migrationFiles.length, 17);

  for (const file of migrationFiles) {
    await client.query("begin");
    try {
      await client.query(await readFile(path.join(migrationsDirectory, file), "utf8"));
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
}

async function seedConcurrencyFixture(pool: Pool) {
  const workspace = await pool.query<{ id: string }>(
    "insert into workspaces (name, slug) values ($1, $2) returning id",
    ["Topic quota concurrency", "topic-quota-concurrency"]
  );
  const workspaceId = workspace.rows[0].id;
  const brand = await pool.query<{ id: string }>(
    "insert into brands (workspace_id, name, timezone) values ($1, $2, $3) returning id",
    [workspaceId, "Quota Brand", "Asia/Seoul"]
  );
  const brandId = brand.rows[0].id;
  await pool.query(
    `insert into brand_profiles (
       workspace_id, brand_id, industry, primary_customer, description, tone, auto_approval_enabled
     ) values ($1, $2, $3, $4, $5, $6, false)`,
    [workspaceId, brandId, "travel", "families", "route planning", "clear"]
  );
  await pool.query(
    `insert into brand_channels (workspace_id, brand_id, channel, status, enabled)
     values ($1, $2, 'threads', 'connected', true)`,
    [workspaceId, brandId]
  );
  const upload = await pool.query<{ id: string }>(
    `insert into topic_uploads (workspace_id, brand_id, file_name, status, total_rows, valid_rows)
     values ($1, $2, 'quota.csv', 'applied', 2, 2) returning id`,
    [workspaceId, brandId]
  );

  const topicRowIds: string[] = [];
  for (let index = 1; index <= 2; index += 1) {
    const row = await pool.query<{ id: string }>(
      `insert into topic_rows (
         workspace_id, brand_id, topic_upload_id, row_number, status,
         topic_title, topic_angle, target_customer, topic_key, priority
       ) values ($1, $2, $3, $4, 'uploaded', $5, $6, $7, $8, 10) returning id`,
      [
        workspaceId,
        brandId,
        upload.rows[0].id,
        index,
        `Old selected topic ${index}`,
        `Angle ${index}`,
        "families",
        `old-selected-${index}::angle-${index}`
      ]
    );
    topicRowIds.push(row.rows[0].id);
    await pool.query(
      `insert into content_topics (
         workspace_id, brand_id, topic_row_id, title, angle, status, source_context,
         selected_at, created_at
       ) values ($1, $2, $3, $4, $5, 'selected', $6::jsonb, $7, $7)`,
      [
        workspaceId,
        brandId,
        row.rows[0].id,
        `Old selected topic ${index}`,
        `Angle ${index}`,
        JSON.stringify({ source: "topic_table", topicRowId: row.rows[0].id }),
        new Date(`2026-01-0${index}T00:00:00.000Z`)
      ]
    );
  }

  for (let index = 1; index <= 3; index += 1) {
    await pool.query(
      `insert into content_topics (
         workspace_id, brand_id, title, angle, status, source_context,
         selected_at, generated_at, created_at
       ) values ($1, $2, $3, 'existing', 'generated', '{}'::jsonb, $4, $5, $4)`,
      [
        workspaceId,
        brandId,
        `Generated topic ${index}`,
        new Date("2026-01-01T00:00:00.000Z"),
        new Date(`2026-07-13T00:0${index}:00.000Z`)
      ]
    );
  }

  return { brandId, topicRowIds };
}

function generatedDraft() {
  return {
    draft: {
      title: "Concurrent quota topic",
      contentTheme: "Quota locking",
      coreMessage: "Only one fourth topic may be generated.",
      targetAudience: "families",
      customerProblem: "Concurrent generation can exceed a daily policy limit.",
      keyPoints: ["Serialize quota checks per brand."],
      supportingEvidence: ["Disposable PostgreSQL concurrency fixture."]
    },
    responseId: "test-response",
    usage: { inputTokens: 1, outputTokens: 1 },
    requestMetadata: { source: "topic-quota-postgres-test" },
    responseMetadata: { source: "topic-quota-postgres-test" }
  };
}

async function observeBrandLockWait(pool: Pool, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ waiting: boolean }>(
      `select exists (
         select 1
         from pg_stat_activity
         where datname = current_database()
           and application_name = 'topic-quota-concurrency'
           and wait_event_type = 'Lock'
           and query ilike '%for update of b%'
       ) as waiting`
    );
    if (result.rows[0]?.waiting) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

function repositoryPool(pool: Pool, removeBrandLock: boolean) {
  if (!removeBrandLock) return pool;
  return {
    query: pool.query.bind(pool),
    async connect() {
      const client = await pool.connect();
      return {
        query(sql: string, values?: unknown[]) {
          return client.query(sql.replace(/\s+for update of b\b/i, ""), values);
        },
        release() {
          client.release();
        }
      };
    }
  };
}

async function runConcurrencyAssertions(pool: Pool, removeBrandLock: boolean) {
  const fixture = await seedConcurrencyFixture(pool);
  let draftCallCount = 0;
  let markFirstDraftStarted!: () => void;
  let releaseFirstDraft!: () => void;
  const firstDraftStarted = new Promise<void>((resolve) => {
    markFirstDraftStarted = resolve;
  });
  const firstDraftRelease = new Promise<void>((resolve) => {
    releaseFirstDraft = resolve;
  });
  const repository = createRepository(repositoryPool(pool, removeBrandLock) as Pool, {
    openAi: { enabled: true, apiKey: "test-key", model: "test-model" },
    generateMasterDraft: async () => {
      draftCallCount += 1;
      if (draftCallCount === 1) {
        markFirstDraftStarted();
        await firstDraftRelease;
      }
      return generatedDraft();
    }
  });

  const first = repository.generateContent(fixture.brandId, sameNow);
  await firstDraftStarted;
  const second = repository.generateContent(fixture.brandId, sameNow);
  let lockWaitObserved = false;
  try {
    lockWaitObserved = await observeBrandLockWait(pool);
  } finally {
    releaseFirstDraft();
  }
  const results = await Promise.all([first, second]);
  const generatedToday = await pool.query<{ count: number }>(
    `select count(*)::int as count
     from content_topics
     where brand_id = $1
       and (generated_at at time zone $2)::date = $3::date`,
    [fixture.brandId, "Asia/Seoul", policyDate]
  );
  assert.equal(
    generatedToday.rows[0].count,
    4,
    "without the brand FOR UPDATE lock, both calls pass count 3 and the policy-day count becomes 5"
  );
  assert.deepEqual(results.map((result) => result.processed).sort(), [0, 1]);
  assert.equal(results.find((result) => result.processed === 0)?.reason, "daily_topic_limit");
  assert.equal(draftCallCount, 1, "the capped call must stop before LLM generation");
  assert.equal(lockWaitObserved, true, "second PostgreSQL backend must wait on the brand FOR UPDATE lock");

  const selectedTopics = await pool.query<{ count: number }>(
    "select count(*)::int as count from content_topics where brand_id = $1 and status = 'selected'",
    [fixture.brandId]
  );
  assert.equal(selectedTopics.rows[0].count, 1);

  const topicRows = await pool.query<{ status: string; used_at: Date | null }>(
    "select status, used_at from topic_rows where id = any($1::uuid[]) order by row_number",
    [fixture.topicRowIds]
  );
  assert.deepEqual(topicRows.rows.map((row) => row.status), ["used", "uploaded"]);
  assert.equal(topicRows.rows.filter((row) => row.used_at !== null).length, 1);

  const generatedOutputs = await pool.query<{ count: number }>(
    "select count(*)::int as count from channel_outputs where brand_id = $1",
    [fixture.brandId]
  );
  assert.equal(generatedOutputs.rows[0].count, 1, "the same selected topic must not be consumed twice");

  // Control: removing `FOR UPDATE OF b` lets the second transaction observe count 3,
  // skip the first locked topic, consume the second topic, and finish with count 5.
}

async function main() {
  let container: StartedPostgreSqlContainer | null = null;
  try {
    container = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("brand_pilot_topic_quota")
      .withUsername("brand_pilot")
      .withPassword("brand_pilot")
      .start();
    const pool = new Pool({
      connectionString: container.getConnectionUri(),
      max: 6,
      application_name: "topic-quota-concurrency"
    });
    try {
      const migrationClient = await pool.connect();
      try {
        await applyMigrations001Through017(migrationClient);
      } finally {
        migrationClient.release();
      }
      await runConcurrencyAssertions(pool, process.argv.includes("--mutate-no-brand-lock"));
      console.log("topic_quota_postgres_concurrency: PASS");
    } finally {
      await pool.end();
    }
  } finally {
    await container?.stop();
  }
}

main().catch((error) => {
  console.error("topic_quota_postgres_concurrency: FAIL");
  console.error(error);
  process.exitCode = 1;
});
