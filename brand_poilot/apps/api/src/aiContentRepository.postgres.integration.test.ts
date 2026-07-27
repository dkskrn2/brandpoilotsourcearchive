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

    it("accepts before expiry, preserves semantic payload equality, and rejects equal/after DB-time boundaries", async () => {
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
        "statement_timestamp()",
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
                and query like '%retryable_until > statement_timestamp()%'`,
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
  },
);
