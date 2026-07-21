import { setTimeout as delay } from "node:timers/promises";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAiContentSubjectRepository } from "./aiContentSubjectRepository.js";

const FIRST_ID = "10000000-0000-4000-8000-000000000001";
const SECOND_ID = "10000000-0000-4000-8000-000000000002";
const WORKSPACE_ID = "20000000-0000-4000-8000-000000000001";
const BRAND_ID = "30000000-0000-4000-8000-000000000001";
const GENERATION_ID = "40000000-0000-4000-8000-000000000001";
const OTHER_GENERATION_ID = "40000000-0000-4000-8000-000000000002";

async function createSchema(pool: Pool) {
  await pool.query(`
    create table brands (
      id uuid primary key,
      workspace_id uuid not null,
      unique (id, workspace_id)
    );
    create table ai_content_generations (
      id uuid primary key,
      workspace_id uuid not null,
      brand_id uuid not null,
      unique (id, workspace_id, brand_id)
    );
    create table ai_content_subject_analyses (
      id uuid primary key,
      workspace_id uuid not null,
      brand_id uuid not null,
      subject_type text not null,
      source_url text null,
      normalized_url text null,
      generation_id uuid null,
      contract_version text not null default 'subject-analysis.v1',
      attachment_ids_json jsonb not null default '[]'::jsonb,
      analysis_result_json jsonb not null default '{}'::jsonb,
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
      unique (brand_id, idempotency_key)
    );
    create unique index ai_content_subject_legacy_active_cache_uq
      on ai_content_subject_analyses (brand_id, subject_type, normalized_url)
      where generation_id is null and superseded_at is null;
    create unique index ai_content_subject_legacy_version_uq
      on ai_content_subject_analyses (brand_id, subject_type, normalized_url, analysis_version)
      where generation_id is null;
    create unique index ai_content_subject_generation_active_uq
      on ai_content_subject_analyses (generation_id)
      where generation_id is not null and superseded_at is null;
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
    await pool.query("truncate table ai_content_subject_images, ai_content_subject_analyses, ai_content_generations, brands");
    await pool.query("insert into brands (id, workspace_id) values ($1, $2)", [BRAND_ID, WORKSPACE_ID]);
    await pool.query(
      `insert into ai_content_generations (id, workspace_id, brand_id)
       values ($1, $3, $4), ($2, $3, $4)`,
      [GENERATION_ID, OTHER_GENERATION_ID, WORKSPACE_ID, BRAND_ID],
    );
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

  it("stores the same URL independently for concurrent generation-scoped requests", async () => {
    await pool.query("truncate table ai_content_subject_images, ai_content_subject_analyses");
    const repository = createAiContentSubjectRepository(pool);
    const input = {
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      subjectType: "product" as const,
      sourceUrl: "https://example.com/product",
      attachmentIds: [],
      manualInput: { name: "Product", promotionOrTerms: "", description: "Description" },
      brandContext: { companyOverview: "Acme" },
    };

    const [first, second] = await Promise.all([
      repository.requestSubjectAnalysis({ ...input, generationId: GENERATION_ID, idempotencyKey: "generation-1" }),
      repository.requestSubjectAnalysis({ ...input, generationId: OTHER_GENERATION_ID, idempotencyKey: "generation-2" }),
    ]);

    expect(first.id).not.toBe(second.id);
    expect(new Set([first.generationId, second.generationId]))
      .toEqual(new Set([GENERATION_ID, OTHER_GENERATION_ID]));
  });
});
