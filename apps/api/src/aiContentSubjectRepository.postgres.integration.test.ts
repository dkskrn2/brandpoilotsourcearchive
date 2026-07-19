import { setTimeout as delay } from "node:timers/promises";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAiContentSubjectRepository } from "./aiContentSubjectRepository.js";

const FIRST_ID = "10000000-0000-4000-8000-000000000001";
const SECOND_ID = "10000000-0000-4000-8000-000000000002";
const WORKSPACE_ID = "20000000-0000-4000-8000-000000000001";
const BRAND_ID = "30000000-0000-4000-8000-000000000001";

async function createSchema(pool: Pool) {
  await pool.query(`
    create table ai_content_subject_analyses (
      id uuid primary key,
      workspace_id uuid not null,
      brand_id uuid not null,
      subject_type text not null,
      source_url text not null,
      normalized_url text not null,
      input_json jsonb not null default '{}'::jsonb,
      status text not null default 'queued',
      facts_json jsonb not null default '[]'::jsonb,
      structured_data_json jsonb not null default '{}'::jsonb,
      research_json jsonb not null default '{}'::jsonb,
      targets_json jsonb not null default '[]'::jsonb,
      appeals_json jsonb not null default '{}'::jsonb,
      selected_image_id uuid null,
      analysis_version integer not null default 1,
      idempotency_key text not null,
      leased_by text null,
      lease_token uuid null,
      lease_expires_at timestamptz null,
      attempt_count integer not null default 0,
      available_at timestamptz not null default now(),
      error_code text null,
      error_message text null,
      superseded_at timestamptz null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      completed_at timestamptz null,
      unique (brand_id, idempotency_key),
      unique (brand_id, subject_type, normalized_url, analysis_version)
    );
    create unique index ai_content_subject_active_cache_uq
      on ai_content_subject_analyses (brand_id, subject_type, normalized_url)
      where superseded_at is null;
    create table ai_content_subject_images (
      id uuid primary key,
      analysis_id uuid not null,
      workspace_id uuid not null,
      brand_id uuid not null,
      source_url text not null,
      storage_url text not null,
      storage_path text not null,
      width integer null,
      height integer null,
      mime_type text not null,
      alt_text text null,
      role text not null,
      selection_score numeric not null default 0,
      created_at timestamptz not null default now(),
      deleted_at timestamptz null,
      unique (analysis_id, source_url)
    );
  `);
}

async function seedClaimableRows(pool: Pool) {
  await pool.query(
    `insert into ai_content_subject_analyses
       (id, workspace_id, brand_id, subject_type, source_url, normalized_url,
        analysis_version, idempotency_key, created_at)
     values
       ($1, $3, $4, 'product', 'https://example.com/first', 'https://example.com/first', 1, 'first', now() - interval '2 seconds'),
       ($2, $3, $4, 'product', 'https://example.com/second', 'https://example.com/second', 1, 'second', now() - interval '1 second')`,
    [FIRST_ID, SECOND_ID, WORKSPACE_ID, BRAND_ID],
  );
}

function poolBackedByClient(client: PoolClient): Pool {
  return {
    query: client.query.bind(client),
    async connect() {
      return {
        query: client.query.bind(client),
        release() {},
      };
    },
  } as unknown as Pool;
}

async function claimPromptly(client: PoolClient) {
  const repository = createAiContentSubjectRepository(poolBackedByClient(client));
  const timeout = delay(2_000).then(() => {
    throw new Error("subject_analysis_skip_locked_timeout");
  });
  return Promise.race([
    repository.claimSubjectAnalysis({ workerId: "skip-locked-worker", leaseSeconds: 60 }),
    timeout,
  ]);
}

describe.skipIf(process.env.RUN_POSTGRES_INTEGRATION !== "true")("AiContentSubjectRepository PostgreSQL concurrency", () => {
  let container: StartedPostgreSqlContainer | null = null;
  let pool: Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("brand_pilot_subject_analysis")
      .withUsername("brand_pilot")
      .withPassword("brand_pilot")
      .start();
    pool = new Pool({
      connectionString: container.getConnectionUri(),
      max: 6,
      application_name: "subject-analysis-concurrency",
    });
    await createSchema(pool);
  }, 120_000);

  beforeEach(async () => {
    await pool.query("truncate table ai_content_subject_images, ai_content_subject_analyses");
    await seedClaimableRows(pool);
  });

  afterAll(async () => {
    try {
      await pool?.end();
    } finally {
      await container?.stop();
    }
  }, 120_000);

  it("skips a first row locked by another PostgreSQL client", async () => {
    const lockClient = await pool.connect();
    const claimClient = await pool.connect();
    let lockTransactionOpen = false;
    try {
      await lockClient.query("begin");
      lockTransactionOpen = true;
      await lockClient.query("select id from ai_content_subject_analyses where id = $1 for update", [FIRST_ID]);

      const startedAt = Date.now();
      const claim = await claimPromptly(claimClient);
      expect(claim?.id).toBe(SECOND_ID);
      expect(Date.now() - startedAt).toBeLessThan(2_000);
      await lockClient.query("commit");
      lockTransactionOpen = false;
    } finally {
      if (lockTransactionOpen) await lockClient.query("rollback").catch(() => undefined);
      lockClient.release();
      claimClient.release();
    }
  });

  it("returns distinct analyses to simultaneous claim calls", async () => {
    const repository = createAiContentSubjectRepository(pool);
    const [firstClaim, secondClaim] = await Promise.all([
      repository.claimSubjectAnalysis({ workerId: "concurrent-worker-1", leaseSeconds: 60 }),
      repository.claimSubjectAnalysis({ workerId: "concurrent-worker-2", leaseSeconds: 60 }),
    ]);

    expect(firstClaim).not.toBeNull();
    expect(secondClaim).not.toBeNull();
    expect(firstClaim?.id).not.toBe(secondClaim?.id);
    expect(new Set([firstClaim?.id, secondClaim?.id])).toEqual(new Set([FIRST_ID, SECOND_ID]));
  });
});
