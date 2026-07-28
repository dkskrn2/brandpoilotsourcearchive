import { setTimeout as delay } from "node:timers/promises";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
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
const USER_ID = "50000000-0000-4000-8000-000000000001";

async function createSchema(pool: Pool) {
  const directory = resolve(process.cwd(), "../../db/migrations");
  const skippedVectorMigrations = new Set([
    "021_dm_wiki_pgvector.sql",
    "027_wiki_search_v2.sql",
    "033_compounding_wiki_pgvector.sql",
  ]);
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    if (skippedVectorMigrations.has(file)) continue;
    await pool.query(await readFile(resolve(directory, file), "utf8"));
  }
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
    await pool.query(
      "insert into app_users (id, email) values ($1, 'subject-repository@example.com')",
      [USER_ID],
    );
    await pool.query(
      `insert into workspaces (id, name, slug, created_by_user_id)
       values ($1, 'Subject Repository', 'subject-repository', $2)`,
      [WORKSPACE_ID, USER_ID],
    );
    await pool.query(
      `insert into brands (id, workspace_id, name, created_by_user_id)
       values ($1, $2, 'Subject Brand', $3)`,
      [BRAND_ID, WORKSPACE_ID, USER_ID],
    );
  }, 120_000);

  beforeEach(async () => {
    await pool.query(
      `truncate table ai_content_subject_images,
                      ai_content_subject_appeal_regeneration_keys,
                      ai_content_subject_analyses,
                      ai_content_generation_attachments,
                      ai_content_attachment_upload_sessions,
                      ai_content_generations cascade`,
    );
    await pool.query(
      `insert into ai_content_generations (
         id, workspace_id, brand_id, type, title, status, analysis_idempotency_key
       ) values
         ($1, $3, $4, 'card_news', 'First subject', 'analysis_ready', 'subject-generation-1'),
         ($2, $3, $4, 'card_news', 'Second subject', 'analysis_ready', 'subject-generation-2')`,
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
    await pool.query("truncate table ai_content_subject_images, ai_content_subject_analyses cascade");
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

  it("serializes concurrent duplicate appeal regeneration keys", async () => {
    await pool.query("truncate table ai_content_subject_images, ai_content_subject_appeal_regeneration_keys, ai_content_subject_analyses cascade");
    const analysisResult = {
      contractVersion: "subject-analysis-result.v2",
      phase: "analysis",
      subjectType: "product",
      summary: "Product analysis",
      verifiedFacts: [],
      voc: [],
      alternatives: [],
      barriers: [],
      productProfile: {
        name: "Product",
        category: "Productivity",
        specifications: [],
        materials: [],
        options: [],
        price: "Not verified",
        discountsAndPromotions: [],
        shipping: [],
        returns: [],
        functions: [],
        useContexts: [],
        purchaseBarriers: [],
        reviewPatterns: { recurringSatisfaction: [], recurringComplaints: [] },
        productImageCandidates: [],
        detailImageCandidates: [],
      },
      serviceProfile: null,
      serviceSubtype: null,
      sourceGaps: [],
    };
    const inserted = await pool.query(
      `insert into ai_content_subject_analyses
         (id, workspace_id, brand_id, generation_id, contract_version,
          subject_type, source_url, normalized_url, input_json,
          analysis_result_json, status, idempotency_key)
       values ($1, $2, $3, $4, 'subject-analysis.v2', 'product',
               'https://example.com/product', 'https://example.com/product',
               $5::jsonb, $6::jsonb, 'ready', 'original-analysis-request')
       returning id`,
      [FIRST_ID, WORKSPACE_ID, BRAND_ID, GENERATION_ID,
        JSON.stringify({
          manualInput: { name: "Product", promotionOrTerms: "", description: "Description" },
          brandContext: { companyOverview: "Acme" },
        }),
        JSON.stringify(analysisResult)],
    );
    const repository = createAiContentSubjectRepository(pool);
    const request = {
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      analysisId: inserted.rows[0].id as string,
      idempotencyKey: "appeal-regeneration-concurrent",
    };

    const [first, duplicate] = await Promise.all([
      repository.regenerateSubjectAppeals(request),
      repository.regenerateSubjectAppeals(request),
    ]);

    expect(first.status).toBe("generating_appeals");
    expect(duplicate.status).toBe("generating_appeals");
    const keys = await pool.query(
      `select idempotency_key
         from ai_content_subject_appeal_regeneration_keys
        where analysis_id = $1`,
      [request.analysisId],
    );
    expect(keys.rows).toEqual([{ idempotency_key: request.idempotencyKey }]);
    const original = await pool.query(
      "select idempotency_key from ai_content_subject_analyses where id = $1",
      [request.analysisId],
    );
    expect(original.rows[0].idempotency_key).toBe("original-analysis-request");
  });
});
