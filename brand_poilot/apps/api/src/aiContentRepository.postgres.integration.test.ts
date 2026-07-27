import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAiContentAttachmentRepository } from "./aiContentAttachmentRepository.js";
import { createAiContentRepository } from "./aiContentRepository.js";

const WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const BRAND_ID = "20000000-0000-4000-8000-000000000001";
const GENERATION_ID = "30000000-0000-4000-8000-000000000001";
const USER_ID = "40000000-0000-4000-8000-000000000001";
const OUTPUT_ID = "50000000-0000-4000-8000-000000000001";
const DELETION_JOB_ID = "60000000-0000-4000-8000-000000000001";
const LEASE_TOKEN = "70000000-0000-4000-8000-000000000001";
const OUTPUT_ID_2 = "50000000-0000-4000-8000-000000000002";
const JOB_ID_1 = "a0000000-0000-4000-8000-000000000001";
const JOB_ID_2 = "a0000000-0000-4000-8000-000000000002";

const RETRY_PAYLOAD = {
  generationId: GENERATION_ID,
  outputId: OUTPUT_ID,
  contentGenerationInput: {
    contractVersion: "content-generation-input.v2",
    contentType: "card_news",
    brandContext: {},
    subject: {
      analysisId: "80000000-0000-4000-8000-000000000001",
      analysisVersion: 1,
      analysisContractVersion: "subject-analysis.v1",
      analysisResult: null,
      type: "product",
      sourceUrl: "",
      facts: [],
      research: {},
      selectedImages: [],
    },
    message: {
      target: { id: "target-1", name: "target" },
      appeal: { id: "appeal-1", targetId: "target-1", title: "appeal" },
      qualityBrief: { hook: "frozen" },
    },
    creativeDirection: {
      prompts: [],
      brandColor: "",
      selectedColor: "#0057B8",
      aspectRatio: "1:1",
      outputCount: 1,
    },
    references: [],
    attachments: [{
      id: "90000000-0000-4000-8000-000000000001",
      role: "product",
      fileName: "retained.png",
      mimeType: "image/png",
      sizeBytes: 100,
      checksum: "a".repeat(64),
      storageUrl: "https://test.public.blob.vercel-storage.com/retained.png",
      storagePath: "retained/path.png",
      createdAt: "2026-07-18T00:00:00.000Z",
    }],
  },
};

function cardManifest(index: number) {
  return {
    version: "ai-content.v1" as const,
    type: "card_news" as const,
    title: `완료 ${index}`,
    assets: [{
      role: "slide" as const,
      url: `https://test.public.blob.vercel-storage.com/slide-${index}.png`,
      fileName: `slide-${index}.png`,
      mimeType: "image/png" as const,
      width: 1080,
      height: 1080,
      index: 1,
    }],
    content: { caption: "내용", hashtags: ["완료"], cta: "저장하세요" },
  };
}

function poolWithinExistingTransaction(client: {
  query: Pool["query"];
}) {
  const transactionClient = {
    query: (sql: string, params?: unknown[]) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return client.query(sql, params);
    },
    release: () => undefined,
  };
  return {
    connect: async () => transactionClient,
    query: transactionClient.query,
  };
}

async function applyRealMigrations(pool: Pool) {
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

function upload(fileName: string) {
  return {
    workspaceId: WORKSPACE_ID,
    brandId: BRAND_ID,
    generationId: GENERATION_ID,
    createdByUserId: USER_ID,
    attachment: {
      role: "product" as const,
      fileName,
      mimeType: "image/png",
      sizeBytes: 100,
      checksum: "a".repeat(64),
    },
  };
}

describe.skipIf(process.env.RUN_POSTGRES_INTEGRATION !== "true")(
  "AI content attachment lifecycle on PostgreSQL 16 real migrations",
  () => {
    let container: StartedPostgreSqlContainer | null = null;
    let pool: Pool;

    beforeAll(async () => {
      container = await new PostgreSqlContainer("postgres:16-alpine")
        .withDatabase("brand_pilot_ai_content")
        .withUsername("brand_pilot")
        .withPassword("brand_pilot")
        .start();
      pool = new Pool({
        connectionString: container.getConnectionUri(),
        max: 8,
        application_name: "ai-content-attachment-lifecycle",
      });
      await applyRealMigrations(pool);
      await pool.query(
        "insert into app_users (id, email) values ($1, 'attachment-member@example.com')",
        [USER_ID],
      );
      await pool.query(
        `insert into workspaces (id, name, slug, created_by_user_id)
         values ($1, 'Attachment Workspace', 'attachment-workspace', $2)`,
        [WORKSPACE_ID, USER_ID],
      );
      await pool.query(
        `insert into workspace_members (workspace_id, user_id, role, status)
         values ($1, $2, 'owner', 'active')`,
        [WORKSPACE_ID, USER_ID],
      );
      await pool.query(
        `insert into brands (id, workspace_id, name, created_by_user_id)
         values ($1, $2, 'Attachment Brand', $3)`,
        [BRAND_ID, WORKSPACE_ID, USER_ID],
      );
    }, 120_000);

    beforeEach(async () => {
      await pool.query(
        `truncate table ai_content_attachment_deletion_jobs,
                        ai_content_generation_attachments,
                        ai_content_attachment_upload_sessions,
                        ai_content_attachment_storage_path_guards,
                        ai_content_generations cascade`,
      );
      await pool.query(
        `insert into ai_content_generations (
           id, workspace_id, brand_id, type, title, status, analysis_idempotency_key
         ) values ($1, $2, $3, 'card_news', 'Attachment concurrency',
                   'analysis_ready', 'attachment-concurrency')`,
        [GENERATION_ID, WORKSPACE_ID, BRAND_ID],
      );
    });

    afterAll(async () => {
      try {
        await pool?.end();
      } finally {
        await container?.stop();
      }
    }, 120_000);

    it("allows exactly one of two concurrent reservations when four slots are occupied", async () => {
      const repository = createAiContentAttachmentRepository(pool);
      for (let index = 1; index <= 4; index += 1) {
        await repository.createAiContentUploadSession(upload(`occupied-${index}.png`));
      }

      const results = await Promise.allSettled([
        repository.createAiContentUploadSession(upload("concurrent-a.png")),
        repository.createAiContentUploadSession(upload("concurrent-b.png")),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      expect(rejected?.reason).toMatchObject({ message: "ai_content_attachment_limit_exceeded" });
      const count = await pool.query(
        `select count(*)::integer as count
           from ai_content_attachment_upload_sessions
          where generation_id = $1 and status = 'pending'
            and token_expires_at > statement_timestamp()`,
        [GENERATION_ID],
      );
      expect(count.rows[0]?.count).toBe(5);
    });

    it("serializes concurrent confirms into one transition and one replay", async () => {
      const repository = createAiContentAttachmentRepository(pool);
      const session = await repository.createAiContentUploadSession(upload("confirm-once.png"));
      const verify = vi.fn(async (stored: { storagePath: string }) => ({
        storagePath: stored.storagePath,
        storageUrl: `https://test.public.blob.vercel-storage.com/${stored.storagePath}`,
        mimeType: "image/png",
        sizeBytes: 100,
      }));
      const confirmation = {
        workspaceId: WORKSPACE_ID,
        brandId: BRAND_ID,
        generationId: GENERATION_ID,
        createdByUserId: USER_ID,
        sessionId: session.id,
        nonce: session.nonce,
      };

      const [first, replay] = await Promise.all([
        repository.confirmAiContentUploadSession(confirmation, verify),
        repository.confirmAiContentUploadSession(confirmation, verify),
      ]);

      expect(replay).toEqual(first);
      expect(verify).toHaveBeenCalledOnce();
      const transitions = await pool.query(
        `select count(*)::integer as count
           from ai_content_generation_attachments
          where upload_session_id = $1`,
        [session.id],
      );
      expect(transitions.rows[0]?.count).toBe(1);
    });

    it("accepts before expiry, preserves semantic payload equality, and rejects an after-expiry DB boundary", async () => {
      const repository = createAiContentRepository(pool);
      const seedFailedOutput = async (retryableUntilSql: string) => {
        await pool.query(
          `update ai_content_generations
              set status = 'failed',
                  terminal_at = statement_timestamp() - interval '15 days',
                  retryable_until = ${retryableUntilSql}
            where id = $1`,
          [GENERATION_ID],
        );
        await pool.query(
          `insert into ai_content_generation_outputs (
             id, generation_id, workspace_id, brand_id, output_index, status,
             failure_code, failure_message
           ) values ($1, $2, $3, $4, 1, 'failed', 'render_failed', 'failed')`,
          [OUTPUT_ID, GENERATION_ID, WORKSPACE_ID, BRAND_ID],
        );
        await pool.query(
          `insert into ai_content_generation_jobs (
             generation_id, output_id, workspace_id, brand_id, job_type,
             content_type, status, payload_json, completed_at
           ) values ($1, $2, $3, $4, 'generate', 'card_news', 'failed', $5::jsonb, now())`,
          [GENERATION_ID, OUTPUT_ID, WORKSPACE_ID, BRAND_ID, JSON.stringify(RETRY_PAYLOAD)],
        );
      };

      await seedFailedOutput("statement_timestamp() + interval '1 hour'");
      await expect(repository.retryAiContentOutput({
        workspaceId: WORKSPACE_ID,
        brandId: BRAND_ID,
        outputId: OUTPUT_ID,
      })).resolves.toMatchObject({
        id: GENERATION_ID,
        status: "queued",
      });
      const queued = await pool.query(
        `select payload_json
           from ai_content_generation_jobs
          where output_id = $1 and status = 'queued'
          order by created_at desc, id desc
          limit 1`,
        [OUTPUT_ID],
      );
      expect(queued.rows[0]?.payload_json).toEqual(RETRY_PAYLOAD);
      const retainedWindow = await pool.query(
        `select terminal_at, retryable_until
           from ai_content_generations
          where id = $1`,
        [GENERATION_ID],
      );
      const retainedTerminalAt = new Date(retainedWindow.rows[0]?.terminal_at).getTime();
      const claimed = await repository.claimAiContentJob({
        contentType: "card_news",
        workerId: "retention-worker",
        leaseSeconds: 180,
      });
      expect(claimed).not.toBeNull();
      await repository.failAiContentJob({
        jobId: claimed!.id,
        workerId: "retention-worker",
        leaseToken: claimed!.leaseToken!,
        errorCode: "render_failed_again",
        errorMessage: "failed again",
        retryable: false,
      });
      const renewedWindow = await pool.query(
        `select terminal_at, retryable_until
           from ai_content_generations
          where id = $1`,
        [GENERATION_ID],
      );
      const renewedTerminalAt = new Date(renewedWindow.rows[0]?.terminal_at).getTime();
      const renewedRetryableUntil = new Date(renewedWindow.rows[0]?.retryable_until).getTime();
      expect(renewedTerminalAt).toBeGreaterThan(retainedTerminalAt);
      expect(renewedRetryableUntil - renewedTerminalAt).toBe(15 * 24 * 60 * 60 * 1_000);

      for (const retryableUntilSql of [
        "statement_timestamp() - interval '1 microsecond'",
      ]) {
        await pool.query(
          `truncate table ai_content_attachment_deletion_jobs,
                          ai_content_generation_outputs,
                          ai_content_generation_jobs`,
        );
        await seedFailedOutput(retryableUntilSql);
        await expect(repository.retryAiContentOutput({
          workspaceId: WORKSPACE_ID,
          brandId: BRAND_ID,
          outputId: OUTPUT_ID,
        })).rejects.toThrow("ai_content_attachment_retention_expired");
      }
    });

    it("rejects exact retry equality against one shared database transaction timestamp", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `update ai_content_generations
              set status = 'failed',
                  terminal_at = transaction_timestamp() - interval '15 days',
                  retryable_until = transaction_timestamp()
            where id = $1`,
          [GENERATION_ID],
        );
        await client.query(
          `insert into ai_content_generation_outputs (
             id, generation_id, workspace_id, brand_id, output_index, status
           ) values ($1, $2, $3, $4, 1, 'failed')`,
          [OUTPUT_ID, GENERATION_ID, WORKSPACE_ID, BRAND_ID],
        );
        await client.query(
          `insert into ai_content_generation_jobs (
             generation_id, output_id, workspace_id, brand_id, job_type,
             content_type, status, payload_json, completed_at
           ) values ($1, $2, $3, $4, 'generate', 'card_news', 'failed', $5::jsonb, now())`,
          [GENERATION_ID, OUTPUT_ID, WORKSPACE_ID, BRAND_ID, JSON.stringify(RETRY_PAYLOAD)],
        );
        const equality = await client.query(
          `select retryable_until = transaction_timestamp() as equal
             from ai_content_generations
            where id = $1`,
          [GENERATION_ID],
        );
        expect(equality.rows[0]?.equal).toBe(true);
        const repository = createAiContentRepository(
          poolWithinExistingTransaction(client) as never,
        );

        await expect(repository.retryAiContentOutput({
          workspaceId: WORKSPACE_ID,
          brandId: BRAND_ID,
          outputId: OUTPUT_ID,
        })).rejects.toThrow("ai_content_attachment_retention_expired");
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });

    it("rejects retry after a deleting claim commits without consuming the failed payload", async () => {
      const repository = createAiContentRepository(pool);
      await pool.query(
        `update ai_content_generations
            set status = 'failed',
                terminal_at = statement_timestamp(),
                retryable_until = statement_timestamp() + interval '15 days'
          where id = $1`,
        [GENERATION_ID],
      );
      await pool.query(
        `insert into ai_content_generation_outputs (
           id, generation_id, workspace_id, brand_id, output_index, status
         ) values ($1, $2, $3, $4, 1, 'failed')`,
        [OUTPUT_ID, GENERATION_ID, WORKSPACE_ID, BRAND_ID],
      );
      await pool.query(
        `insert into ai_content_generation_jobs (
           generation_id, output_id, workspace_id, brand_id, job_type,
           content_type, status, payload_json, completed_at
         ) values ($1, $2, $3, $4, 'generate', 'card_news', 'failed', $5::jsonb, now())`,
        [GENERATION_ID, OUTPUT_ID, WORKSPACE_ID, BRAND_ID, JSON.stringify(RETRY_PAYLOAD)],
      );
      await pool.query(
        `insert into ai_content_attachment_deletion_jobs (
           id, workspace_id, brand_id, generation_id, attachment_id,
           storage_url, storage_path, reason, status, lease_token, lease_expires_at
         ) values (
           $1, $2, $3, $4, null,
           'https://test.public.blob.vercel-storage.com/retained.png',
           'retained/path.png', 'retention_expired', 'deleting', $5,
           statement_timestamp() + interval '90 seconds'
         )`,
        [DELETION_JOB_ID, WORKSPACE_ID, BRAND_ID, GENERATION_ID, LEASE_TOKEN],
      );

      await expect(repository.retryAiContentOutput({
        workspaceId: WORKSPACE_ID,
        brandId: BRAND_ID,
        outputId: OUTPUT_ID,
      })).rejects.toThrow("ai_content_attachment_retention_expired");
      const queued = await pool.query(
        `select count(*)::integer as count
           from ai_content_generation_jobs
          where output_id = $1 and status = 'queued'`,
        [OUTPUT_ID],
      );
      expect(queued.rows[0]?.count).toBe(0);
    });

    it("makes retry wait for a GC generation lock and lose after deleting commits", async () => {
      const repository = createAiContentRepository(pool);
      await pool.query(
        `update ai_content_generations
            set status = 'failed',
                terminal_at = statement_timestamp(),
                retryable_until = statement_timestamp() + interval '15 days'
          where id = $1`,
        [GENERATION_ID],
      );
      await pool.query(
        `insert into ai_content_generation_outputs (
           id, generation_id, workspace_id, brand_id, output_index, status
         ) values ($1, $2, $3, $4, 1, 'failed')`,
        [OUTPUT_ID, GENERATION_ID, WORKSPACE_ID, BRAND_ID],
      );
      await pool.query(
        `insert into ai_content_generation_jobs (
           generation_id, output_id, workspace_id, brand_id, job_type,
           content_type, status, payload_json, completed_at
         ) values ($1, $2, $3, $4, 'generate', 'card_news', 'failed', $5::jsonb, now())`,
        [GENERATION_ID, OUTPUT_ID, WORKSPACE_ID, BRAND_ID, JSON.stringify(RETRY_PAYLOAD)],
      );

      const gcClient = await pool.connect();
      let gcTransactionOpen = false;
      let retry: Promise<unknown> | null = null;
      try {
        await gcClient.query("BEGIN");
        gcTransactionOpen = true;
        await gcClient.query(
          "select id from ai_content_generations where id = $1 for update",
          [GENERATION_ID],
        );

        retry = repository.retryAiContentOutput({
          workspaceId: WORKSPACE_ID,
          brandId: BRAND_ID,
          outputId: OUTPUT_ID,
        });
        const retryState = retry.then(
          () => "completed" as const,
          () => "rejected" as const,
        );
        let observedGenerationLockWait = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const waiting = await gcClient.query(
            `select count(*)::integer as count
               from pg_stat_activity
              where datname = current_database()
                and pid <> pg_backend_pid()
                and wait_event_type = 'Lock'
                and query like '%retryable_until > transaction_timestamp()%'`,
          );
          if (Number(waiting.rows[0]?.count ?? 0) > 0) {
            observedGenerationLockWait = true;
            break;
          }
          if (await Promise.race([
            retryState,
            new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), 20)),
          ]) !== "waiting") {
            break;
          }
        }
        expect(observedGenerationLockWait).toBe(true);

        await gcClient.query(
          `insert into ai_content_attachment_deletion_jobs (
             id, workspace_id, brand_id, generation_id, attachment_id,
             storage_url, storage_path, reason, status, lease_token, lease_expires_at
           ) values (
             $1, $2, $3, $4, null,
             'https://test.public.blob.vercel-storage.com/retained.png',
             'retained/path.png', 'retention_expired', 'deleting', $5,
             statement_timestamp() + interval '90 seconds'
           )`,
          [DELETION_JOB_ID, WORKSPACE_ID, BRAND_ID, GENERATION_ID, LEASE_TOKEN],
        );
        await gcClient.query("COMMIT");
        gcTransactionOpen = false;

        await expect(retry).rejects.toThrow("ai_content_attachment_retention_expired");
        const queued = await pool.query(
          `select count(*)::integer as count
             from ai_content_generation_jobs
            where output_id = $1 and status = 'queued'`,
          [OUTPUT_ID],
        );
        expect(queued.rows[0]?.count).toBe(0);
      } finally {
        if (gcTransactionOpen) await gcClient.query("ROLLBACK");
        gcClient.release();
        if (retry) await retry.catch(() => undefined);
      }
    });

    it("serializes two distinct output completions before terminal lifecycle calculation", async () => {
      const repository = createAiContentRepository(pool);
      await pool.query(
        `update ai_content_generations
            set status = 'generating', terminal_at = null, retryable_until = null
          where id = $1`,
        [GENERATION_ID],
      );
      await pool.query(
        `insert into ai_content_generation_outputs (
           id, generation_id, workspace_id, brand_id, output_index, status
         ) values
           ($1, $3, $4, $5, 1, 'generating'),
           ($2, $3, $4, $5, 2, 'generating')`,
        [OUTPUT_ID, OUTPUT_ID_2, GENERATION_ID, WORKSPACE_ID, BRAND_ID],
      );
      await pool.query(
        `insert into ai_content_generation_jobs (
           id, generation_id, output_id, workspace_id, brand_id, job_type,
           content_type, status, payload_json, attempt_count, worker_id,
           lease_token, lease_expires_at
         ) values
           ($1, $3, $4, $5, $6, 'generate', 'card_news', 'processing',
            $7::jsonb, 1, 'worker-1', $8, now() + interval '3 minutes'),
           ($2, $3, $9, $5, $6, 'generate', 'card_news', 'processing',
            $10::jsonb, 1, 'worker-2', $11, now() + interval '3 minutes')`,
        [
          JOB_ID_1,
          JOB_ID_2,
          GENERATION_ID,
          OUTPUT_ID,
          WORKSPACE_ID,
          BRAND_ID,
          JSON.stringify(RETRY_PAYLOAD),
          "b0000000-0000-4000-8000-000000000001",
          OUTPUT_ID_2,
          JSON.stringify({ ...RETRY_PAYLOAD, outputId: OUTPUT_ID_2 }),
          "b0000000-0000-4000-8000-000000000002",
        ],
      );

      const completions = await Promise.all([
        repository.completeAiContentJob({
          jobId: JOB_ID_1,
          workerId: "worker-1",
          leaseToken: "b0000000-0000-4000-8000-000000000001",
          skillVersion: "card-news-skill.v5",
          jobType: "generate",
          manifestUrl: "https://test.public.blob.vercel-storage.com/manifest-1.json",
          manifest: cardManifest(1),
        }),
        repository.completeAiContentJob({
          jobId: JOB_ID_2,
          workerId: "worker-2",
          leaseToken: "b0000000-0000-4000-8000-000000000002",
          skillVersion: "card-news-skill.v5",
          jobType: "generate",
          manifestUrl: "https://test.public.blob.vercel-storage.com/manifest-2.json",
          manifest: cardManifest(2),
        }),
      ]);

      expect(completions.some((generation) => generation.status === "completed")).toBe(true);
      const terminal = await pool.query(
        `select status, terminal_at, retryable_until
           from ai_content_generations
          where id = $1`,
        [GENERATION_ID],
      );
      expect(terminal.rows[0]?.status).toBe("completed");
      const terminalAt = new Date(terminal.rows[0]?.terminal_at).getTime();
      const retryableUntil = new Date(terminal.rows[0]?.retryable_until).getTime();
      expect(retryableUntil - terminalAt).toBe(15 * 24 * 60 * 60 * 1_000);
    });

    it("keeps retry versus worker failure deadlock-free with one valid arbitration outcome", async () => {
      const repository = createAiContentRepository(pool);
      await pool.query(
        `update ai_content_generations
            set status = 'generating',
                terminal_at = statement_timestamp(),
                retryable_until = statement_timestamp() + interval '15 days'
          where id = $1`,
        [GENERATION_ID],
      );
      await pool.query(
        `insert into ai_content_generation_outputs (
           id, generation_id, workspace_id, brand_id, output_index, status
         ) values ($1, $2, $3, $4, 1, 'generating')`,
        [OUTPUT_ID, GENERATION_ID, WORKSPACE_ID, BRAND_ID],
      );
      await pool.query(
        `insert into ai_content_generation_jobs (
           id, generation_id, output_id, workspace_id, brand_id, job_type,
           content_type, status, payload_json, attempt_count, worker_id,
           lease_token, lease_expires_at
         ) values (
           $1, $2, $3, $4, $5, 'generate', 'card_news', 'processing',
           $6::jsonb, 1, 'worker-1', $7, now() + interval '3 minutes'
         )`,
        [
          JOB_ID_1,
          GENERATION_ID,
          OUTPUT_ID,
          WORKSPACE_ID,
          BRAND_ID,
          JSON.stringify(RETRY_PAYLOAD),
          LEASE_TOKEN,
        ],
      );

      const settled = await Promise.race([
        Promise.allSettled([
          repository.failAiContentJob({
            jobId: JOB_ID_1,
            workerId: "worker-1",
            leaseToken: LEASE_TOKEN,
            errorCode: "render_failed",
            errorMessage: "failed",
            retryable: false,
          }),
          repository.retryAiContentOutput({
            workspaceId: WORKSPACE_ID,
            brandId: BRAND_ID,
            outputId: OUTPUT_ID,
          }),
        ]),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 5_000)),
      ]);
      expect(settled).not.toBe("timeout");
      expect((settled as PromiseSettledResult<unknown>[]).some(
        (result) => result.status === "fulfilled",
      )).toBe(true);
      const output = await pool.query(
        "select status from ai_content_generation_outputs where id = $1",
        [OUTPUT_ID],
      );
      expect(["failed", "queued"]).toContain(output.rows[0]?.status);
    });

    it("keeps retry versus lease exhaustion deadlock-free with one valid arbitration outcome", async () => {
      const repository = createAiContentRepository(pool);
      await pool.query(
        `update ai_content_generations
            set status = 'generating',
                terminal_at = statement_timestamp(),
                retryable_until = statement_timestamp() + interval '15 days'
          where id = $1`,
        [GENERATION_ID],
      );
      await pool.query(
        `insert into ai_content_generation_outputs (
           id, generation_id, workspace_id, brand_id, output_index, status
         ) values ($1, $2, $3, $4, 1, 'generating')`,
        [OUTPUT_ID, GENERATION_ID, WORKSPACE_ID, BRAND_ID],
      );
      await pool.query(
        `insert into ai_content_generation_jobs (
           id, generation_id, output_id, workspace_id, brand_id, job_type,
           content_type, status, payload_json, attempt_count, max_attempts,
           worker_id, lease_token, lease_expires_at
         ) values (
           $1, $2, $3, $4, $5, 'generate', 'card_news', 'processing',
           $6::jsonb, 3, 3, 'expired-worker', $7, now() - interval '1 second'
         )`,
        [
          JOB_ID_1,
          GENERATION_ID,
          OUTPUT_ID,
          WORKSPACE_ID,
          BRAND_ID,
          JSON.stringify(RETRY_PAYLOAD),
          LEASE_TOKEN,
        ],
      );

      const settled = await Promise.race([
        Promise.allSettled([
          repository.claimAiContentJob({
            contentType: "card_news",
            workerId: "next-worker",
            leaseSeconds: 180,
          }),
          repository.retryAiContentOutput({
            workspaceId: WORKSPACE_ID,
            brandId: BRAND_ID,
            outputId: OUTPUT_ID,
          }),
        ]),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 5_000)),
      ]);
      expect(settled).not.toBe("timeout");
      const output = await pool.query(
        "select status from ai_content_generation_outputs where id = $1",
        [OUTPUT_ID],
      );
      expect(["failed", "queued"]).toContain(output.rows[0]?.status);
      const exhausted = await pool.query(
        "select status, error_code from ai_content_generation_jobs where id = $1",
        [JOB_ID_1],
      );
      expect(exhausted.rows[0]).toMatchObject({
        status: "failed",
        error_code: "ai_content_job_lease_exhausted",
      });
    });

    it.each(["complete", "fail"] as const)(
      "keeps stale %s versus a normal queued claim deadlock-free and lease-fenced",
      async (operation) => {
        const repository = createAiContentRepository(pool);
        await pool.query(
          "update ai_content_generations set status = 'queued' where id = $1",
          [GENERATION_ID],
        );
        await pool.query(
          `insert into ai_content_generation_outputs (
             id, generation_id, workspace_id, brand_id, output_index, status
           ) values ($1, $2, $3, $4, 1, 'queued')`,
          [OUTPUT_ID, GENERATION_ID, WORKSPACE_ID, BRAND_ID],
        );
        await pool.query(
          `insert into ai_content_generation_jobs (
             id, generation_id, output_id, workspace_id, brand_id, job_type,
             content_type, status, payload_json, attempt_count, available_at
           ) values (
             $1, $2, $3, $4, $5, 'generate', 'card_news', 'queued',
             $6::jsonb, 0, clock_timestamp()
           )`,
          [
            JOB_ID_1,
            GENERATION_ID,
            OUTPUT_ID,
            WORKSPACE_ID,
            BRAND_ID,
            JSON.stringify(RETRY_PAYLOAD),
          ],
        );

        const stale = operation === "complete"
          ? repository.completeAiContentJob({
              jobId: JOB_ID_1,
              workerId: "stale-worker",
              leaseToken: LEASE_TOKEN,
              skillVersion: "card-news-skill.v5",
              jobType: "generate",
              manifestUrl: "https://test.public.blob.vercel-storage.com/stale-manifest.json",
              manifest: cardManifest(1),
            })
          : repository.failAiContentJob({
              jobId: JOB_ID_1,
              workerId: "stale-worker",
              leaseToken: LEASE_TOKEN,
              errorCode: "stale_failure",
              errorMessage: "stale",
              retryable: false,
            });
        const settled = await Promise.race([
          Promise.allSettled([
            repository.claimAiContentJob({
              contentType: "card_news",
              workerId: "fresh-worker",
              leaseSeconds: 180,
            }),
            stale,
          ]),
          new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 5_000)),
        ]);

        expect(settled).not.toBe("timeout");
        const results = settled as PromiseSettledResult<unknown>[];
        expect(results[0]).toMatchObject({ status: "fulfilled" });
        expect(results[1]).toMatchObject({
          status: "rejected",
          reason: expect.objectContaining({ message: "ai_content_job_lease_invalid" }),
        });
        const claimed = await pool.query(
          `select status, worker_id, attempt_count
             from ai_content_generation_jobs
            where id = $1`,
          [JOB_ID_1],
        );
        expect(claimed.rows[0]).toMatchObject({
          status: "processing",
          worker_id: "fresh-worker",
          attempt_count: 1,
        });
      },
    );

    it.each(["complete", "fail"] as const)(
      "rejects %s when its lease expires while waiting for the generation lock",
      async (operation) => {
      const repository = createAiContentRepository(pool);
      await pool.query(
        "update ai_content_generations set status = 'generating' where id = $1",
        [GENERATION_ID],
      );
      await pool.query(
        `insert into ai_content_generation_outputs (
           id, generation_id, workspace_id, brand_id, output_index, status
         ) values ($1, $2, $3, $4, 1, 'generating')`,
        [OUTPUT_ID, GENERATION_ID, WORKSPACE_ID, BRAND_ID],
      );
      const inserted = await pool.query(
        `insert into ai_content_generation_jobs (
           id, generation_id, output_id, workspace_id, brand_id, job_type,
           content_type, status, payload_json, attempt_count, worker_id,
           lease_token, lease_expires_at
         ) values (
           $1, $2, $3, $4, $5, 'generate', 'card_news', 'processing',
           $6::jsonb, 1, 'worker-1', $7, clock_timestamp() + interval '300 milliseconds'
         )
         returning lease_expires_at`,
        [
          JOB_ID_1,
          GENERATION_ID,
          OUTPUT_ID,
          WORKSPACE_ID,
          BRAND_ID,
          JSON.stringify(RETRY_PAYLOAD),
          LEASE_TOKEN,
        ],
      );
      const leaseExpiresAt = inserted.rows[0]?.lease_expires_at;
      const gate = await pool.connect();
      let gateOpen = false;
      let completion: Promise<unknown> | null = null;
      try {
        await gate.query("BEGIN");
        gateOpen = true;
        await gate.query(
          "select id from ai_content_generations where id = $1 for update",
          [GENERATION_ID],
        );
        completion = operation === "complete"
          ? repository.completeAiContentJob({
              jobId: JOB_ID_1,
              workerId: "worker-1",
              leaseToken: LEASE_TOKEN,
              skillVersion: "card-news-skill.v5",
              jobType: "generate",
              manifestUrl: "https://test.public.blob.vercel-storage.com/late-manifest.json",
              manifest: cardManifest(1),
            })
          : repository.failAiContentJob({
              jobId: JOB_ID_1,
              workerId: "worker-1",
              leaseToken: LEASE_TOKEN,
              errorCode: "late_failure",
              errorMessage: "late",
              retryable: false,
            });
        const completionState = completion.then(
          () => "completed" as const,
          () => "rejected" as const,
        );
        let observedLockWait = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const waiting = await gate.query(
            `select count(*)::integer as count
               from pg_stat_activity
              where datname = current_database()
                and pid <> pg_backend_pid()
                and wait_event_type = 'Lock'
                and query like '%from ai_content_generations%for update%'`,
          );
          if (Number(waiting.rows[0]?.count ?? 0) > 0) {
            observedLockWait = true;
            break;
          }
          if (await Promise.race([
            completionState,
            new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), 20)),
          ]) !== "waiting") {
            break;
          }
        }
        expect(observedLockWait).toBe(true);
        for (;;) {
          const expired = await gate.query(
            "select clock_timestamp() >= $1::timestamptz as expired",
            [leaseExpiresAt],
          );
          if (expired.rows[0]?.expired === true) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        await gate.query("COMMIT");
        gateOpen = false;

        await expect(completion).rejects.toThrow("ai_content_job_lease_invalid");
        const unchanged = await pool.query(
          `select job.status as job_status, output.status as output_status
             from ai_content_generation_jobs job
             join ai_content_generation_outputs output on output.id = job.output_id
            where job.id = $1`,
          [JOB_ID_1],
        );
        expect(unchanged.rows[0]).toMatchObject({
          job_status: "processing",
          output_status: "generating",
        });
      } finally {
        if (gateOpen) await gate.query("ROLLBACK");
        gate.release();
        if (completion) await completion.catch(() => undefined);
      }
      },
    );
  },
);
