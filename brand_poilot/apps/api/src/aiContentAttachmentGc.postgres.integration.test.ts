import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAiContentAttachmentGcRepository } from "./aiContentAttachmentGcRepository.js";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const WORKSPACE_ID = "20000000-0000-4000-8000-000000000002";
const BRAND_ID = "30000000-0000-4000-8000-000000000003";
const GENERATION_ID = "40000000-0000-4000-8000-000000000004";
const OTHER_GENERATION_ID = "40000000-0000-4000-8000-000000000005";
const BUDGET = { remainingBudgetMs: 10_000, statementTimeoutMs: 5_000 };

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

async function insertJob(pool: Pool, input: {
  id: string;
  generationId?: string;
  path: string;
  url?: string;
  createdOffset?: string;
  status?: "pending" | "failed" | "deleting";
  leaseToken?: string;
  leaseOffset?: string;
  nextOffset?: string;
}) {
  await pool.query(
    `insert into ai_content_attachment_deletion_jobs (
       id, workspace_id, brand_id, generation_id, storage_url, storage_path,
       reason, status, lease_token, lease_expires_at, next_attempt_at, created_at
     ) values (
       $1, $2, $3, $4, $5, $6, 'integration_test', $7,
       $8::uuid, case when $8::uuid is null then null else now() + $9::interval end,
       now() + $10::interval, now() + $11::interval
     )`,
    [
      input.id,
      WORKSPACE_ID,
      BRAND_ID,
      input.generationId ?? GENERATION_ID,
      input.url ?? `https://blob.example/${input.path}`,
      input.path,
      input.status ?? "pending",
      input.leaseToken ?? null,
      input.leaseOffset ?? "-1 second",
      input.nextOffset ?? "-1 second",
      input.createdOffset ?? "-1 minute",
    ],
  );
}

async function insertLiveUploadSession(pool: Pool, input: {
  id: string;
  generationId: string;
  workspaceId: string;
  brandId: string;
  userId: string;
  nonce: string;
  path: string;
  expiresInSeconds: number;
}) {
  const result = await pool.query(
    `with boundary as (
       select clock_timestamp() + ($8::text || ' seconds')::interval as token_expires_at
     )
     insert into ai_content_attachment_upload_sessions (
       id, generation_id, workspace_id, brand_id, created_by_user_id, nonce,
       role, file_name, expected_mime_type, expected_size_bytes, expected_checksum,
       storage_path, status, created_at, token_expires_at
     )
     select $1, $2, $3, $4, $5, $6, 'product', 'racing.png', 'image/png', 10, $7,
            $9, 'pending', token_expires_at - interval '10 minutes', token_expires_at
       from boundary
     returning token_expires_at`,
    [
      input.id,
      input.generationId,
      input.workspaceId,
      input.brandId,
      input.userId,
      input.nonce,
      "b".repeat(64),
      input.expiresInSeconds,
      input.path,
    ],
  );
  return {
    token: input.nonce,
    storagePath: input.path,
    tokenExpiresAt: new Date(result.rows[0].token_expires_at as string | Date).toISOString(),
  };
}

function providerUploadWithIssuedGrant(
  grant: { token: string; storagePath: string; tokenExpiresAt: string },
  request: { token: string; path: string },
  providerObjects: Set<string>,
) {
  if (
    grant.token !== request.token
    || grant.storagePath !== request.path
    || Date.now() >= Date.parse(grant.tokenExpiresAt)
  ) {
    throw new Error("provider_upload_token_not_live");
  }
  providerObjects.add(request.path);
}

async function waitUntilDatabaseTime(pool: Pool, timestamp: string) {
  await pool.query(
    `select pg_sleep(
       greatest(0, extract(epoch from ($1::timestamptz - clock_timestamp()))) + 0.05
     )`,
    [timestamp],
  );
}

function twoPartyBarrier() {
  let arrivals = 0;
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrivals += 1;
    if (arrivals === 2) release();
    await opened;
  };
}

function poolWithFirstCandidateBarrier(pool: Pool, barrier: () => Promise<void>): Pool {
  return {
    query: pool.query.bind(pool),
    async connect() {
      const client = await pool.connect();
      let intercepted = false;
      return {
        async query(sql: string, values?: unknown[]) {
          const result = await client.query(sql, values);
          if (!intercepted && sql.includes("gc_candidate_jobs")) {
            intercepted = true;
            await barrier();
          }
          return result;
        },
        release(error?: Error) {
          client.release(error);
        },
      };
    },
  } as unknown as Pool;
}

function poolWithBusinessQueryDelay(pool: Pool, delaySeconds: number): Pool {
  return {
    query: pool.query.bind(pool),
    async connect() {
      const client = await pool.connect();
      return {
        async query(sql: string, values?: unknown[]) {
          if (
            !/^(begin|commit|rollback)$/i.test(sql)
            && !sql.startsWith("set local statement_timeout")
          ) {
            await client.query("select pg_sleep($1)", [delaySeconds]);
          }
          return client.query(sql, values);
        },
        release(error?: Error) {
          client.release(error);
        },
      };
    },
  } as unknown as Pool;
}

describe.skipIf(process.env.RUN_POSTGRES_INTEGRATION !== "true")(
  "AiContentAttachmentGcRepository PostgreSQL",
  () => {
    let container: StartedPostgreSqlContainer | null = null;
    let pool: Pool;

    beforeAll(async () => {
      container = await new PostgreSqlContainer("postgres:16-alpine")
        .withDatabase("brand_pilot_attachment_gc")
        .withUsername("brand_pilot")
        .withPassword("brand_pilot")
        .start();
      pool = new Pool({ connectionString: container.getConnectionUri(), max: 8 });
      await createSchema(pool);
      await pool.query("insert into app_users (id, email) values ($1, 'attachment-gc@example.com')", [USER_ID]);
      await pool.query(
        `insert into workspaces (id, name, slug, created_by_user_id)
         values ($1, 'Attachment GC', 'attachment-gc', $2)`,
        [WORKSPACE_ID, USER_ID],
      );
      await pool.query(
        `insert into workspace_members (workspace_id, user_id, role)
         values ($1, $2, 'owner')`,
        [WORKSPACE_ID, USER_ID],
      );
      await pool.query(
        `insert into brands (id, workspace_id, name, created_by_user_id)
         values ($1, $2, 'Attachment GC Brand', $3)`,
        [BRAND_ID, WORKSPACE_ID, USER_ID],
      );
    }, 120_000);

    beforeEach(async () => {
      await pool.query(
        `truncate table ai_content_attachment_deletion_jobs,
                        ai_content_generation_jobs,
                        ai_content_subject_analyses,
                        ai_content_generation_attachments,
                        ai_content_attachment_upload_sessions,
                        ai_content_generation_outputs,
                        ai_content_generations cascade`,
      );
      await pool.query(
        `insert into ai_content_generations (
           id, workspace_id, brand_id, type, title, status, analysis_idempotency_key
         ) values
           ($1, $3, $4, 'card_news', 'First', 'draft', 'gc-first'),
           ($2, $3, $4, 'card_news', 'Second', 'draft', 'gc-second')`,
        [GENERATION_ID, OTHER_GENERATION_ID, WORKSPACE_ID, BRAND_ID],
      );
    });

    afterAll(async () => {
      try {
        await pool?.end();
      } finally {
        await container?.stop();
      }
    }, 120_000);

    it("prepares expired sessions and logical or terminal attachment obligations idempotently", async () => {
      const sessionId = "50000000-0000-4000-8000-000000000005";
      await pool.query(
        `insert into ai_content_attachment_upload_sessions (
           id, generation_id, workspace_id, brand_id, created_by_user_id, nonce,
           role, file_name, expected_mime_type, expected_size_bytes, expected_checksum,
           storage_path, status, created_at, token_expires_at
         ) values (
           $1, $2, $3, $4, $5, $6, 'product', 'late.png', 'image/png', 10, $7,
           'gc/expired.png', 'pending', now() - interval '20 minutes', now() - interval '10 minutes'
         )`,
        [
          sessionId,
          GENERATION_ID,
          WORKSPACE_ID,
          BRAND_ID,
          USER_ID,
          "60000000-0000-4000-8000-000000000006",
          "a".repeat(64),
        ],
      );
      const repository = createAiContentAttachmentGcRepository(pool);

      const first = await repository.prepareAiContentAttachmentGc({ limit: 20, ...BUDGET });
      const duplicate = await repository.prepareAiContentAttachmentGc({ limit: 20, ...BUDGET });

      expect(first.sessionsExpired).toBe(1);
      expect(first.jobsCreated).toBe(1);
      expect(duplicate.jobsCreated).toBe(0);
      const jobs = await pool.query(
        "select status, next_attempt_at <= now() as due from ai_content_attachment_deletion_jobs where upload_session_id = $1",
        [sessionId],
      );
      expect(jobs.rows).toEqual([{ status: "pending", due: true }]);
    });

    it("refills both concurrent batches after both callers read the same first candidate", async () => {
      await insertJob(pool, { id: "70000000-0000-4000-8000-000000000007", path: "gc/first.png", createdOffset: "-2 minutes" });
      await insertJob(pool, { id: "70000000-0000-4000-8000-000000000008", path: "gc/second.png", createdOffset: "-1 minute" });
      const barrier = twoPartyBarrier();
      const firstRepository = createAiContentAttachmentGcRepository(
        poolWithFirstCandidateBarrier(pool, barrier),
      );
      const secondRepository = createAiContentAttachmentGcRepository(
        poolWithFirstCandidateBarrier(pool, barrier),
      );

      const [first, second] = await Promise.all([
        firstRepository.claimAiContentAttachmentDeletionJobs({ workerId: "gc-1", batchSize: 1, leaseSeconds: 60, ...BUDGET }),
        secondRepository.claimAiContentAttachmentDeletionJobs({ workerId: "gc-2", batchSize: 1, leaseSeconds: 60, ...BUDGET }),
      ]);

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(first[0]?.jobId).not.toBe(second[0]?.jobId);
    });

    it("dead-letters a final provider attempt that crashes until its lease expires", async () => {
      const attachmentId = "65000000-0000-4000-8000-000000000065";
      const sessionId = "55000000-0000-4000-8000-000000000055";
      const jobId = "75000000-0000-4000-8000-000000000075";
      const path = "gc/final-attempt.png";
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(
          `insert into ai_content_attachment_upload_sessions (
             id, generation_id, workspace_id, brand_id, created_by_user_id, nonce,
             role, file_name, expected_mime_type, expected_size_bytes, expected_checksum,
             storage_url, storage_path, status, created_at, token_expires_at,
             confirmed_at, confirmed_attachment_id, is_legacy_backfill
           ) values (
             $1, $2, $3, $4, null, $5, 'product', 'final.png', 'image/png', 10, $6,
             'https://blob.example/gc/final-attempt.png', $7, 'confirmed',
             now() - interval '20 minutes', now() - interval '10 minutes',
             now() - interval '20 minutes', $8, true
           )`,
          [
            sessionId,
            GENERATION_ID,
            WORKSPACE_ID,
            BRAND_ID,
            "56000000-0000-4000-8000-000000000056",
            "c".repeat(64),
            path,
            attachmentId,
          ],
        );
        await client.query(
          `insert into ai_content_generation_attachments (
             id, generation_id, workspace_id, brand_id, upload_session_id,
             role, file_name, mime_type, size_bytes, checksum, storage_url, storage_path,
             deleted_at, deletion_reason, physical_delete_status
           ) values (
             $1, $2, $3, $4, $5, 'product', 'final.png', 'image/png', 10, $6,
             'https://blob.example/gc/final-attempt.png', $7, now(), 'final_attempt_crash', 'pending'
           )`,
          [attachmentId, GENERATION_ID, WORKSPACE_ID, BRAND_ID, sessionId, "c".repeat(64), path],
        );
        await client.query(
          `insert into ai_content_attachment_deletion_jobs (
             id, workspace_id, brand_id, generation_id, attachment_id, upload_session_id,
             storage_url, storage_path, reason, status, attempt_count, max_attempts,
             next_attempt_at
           ) values (
             $1, $2, $3, $4, $5, $6, 'https://blob.example/gc/final-attempt.png',
             $7, 'final_attempt_crash', 'pending', 9, 10, now()
           )`,
          [jobId, WORKSPACE_ID, BRAND_ID, GENERATION_ID, attachmentId, sessionId, path],
        );
        await client.query("commit");
      } finally {
        client.release();
      }
      const repository = createAiContentAttachmentGcRepository(pool);
      const [claim] = await repository.claimAiContentAttachmentDeletionJobs({
        workerId: "gc-final-attempt",
        batchSize: 1,
        leaseSeconds: 60,
        ...BUDGET,
      });
      await expect(repository.beginAiContentAttachmentDeletionAttempt({
        jobId,
        leaseToken: claim!.leaseToken,
        ...BUDGET,
      })).resolves.toBe(10);

      // Simulate provider I/O completing neither finalize nor fail before crash.
      await pool.query(
        "update ai_content_attachment_deletion_jobs set lease_expires_at = now() - interval '1 second' where id = $1",
        [jobId],
      );
      await expect(repository.claimAiContentAttachmentDeletionJobs({
        workerId: "gc-after-final-crash",
        batchSize: 1,
        leaseSeconds: 60,
        ...BUDGET,
      })).resolves.toEqual([]);
      expect((await pool.query(
        `select job.status, job.lease_token, attachment.physical_delete_status
           from ai_content_attachment_deletion_jobs job
           join ai_content_generation_attachments attachment on attachment.id = job.attachment_id
          where job.id = $1`,
        [jobId],
      )).rows[0]).toEqual({
        status: "dead_letter",
        lease_token: null,
        physical_delete_status: "dead_letter",
      });
    });

    it("enforces one cumulative database deadline across candidate and claim statements", async () => {
      const jobId = "70000000-0000-4000-8000-000000000099";
      await insertJob(pool, { id: jobId, path: "gc/deadline.png" });
      const repository = createAiContentAttachmentGcRepository(
        poolWithBusinessQueryDelay(pool, 0.04),
      );
      const startedAt = Date.now();

      await expect(repository.claimAiContentAttachmentDeletionJobs({
        workerId: "gc-cumulative-deadline",
        batchSize: 1,
        leaseSeconds: 60,
        remainingBudgetMs: 100,
        statementTimeoutMs: 100,
      })).rejects.toThrow("ai_content_gc_budget_exhausted");

      expect(Date.now() - startedAt).toBeLessThan(300);
      expect((await pool.query(
        "select status, attempt_count from ai_content_attachment_deletion_jobs where id = $1",
        [jobId],
      )).rows[0]).toEqual({ status: "pending", attempt_count: 0 });
    });

    it("reclaims expired leases with a fresh token and fences the stale owner", async () => {
      const jobId = "70000000-0000-4000-8000-000000000009";
      const staleToken = "80000000-0000-4000-8000-000000000008";
      await insertJob(pool, {
        id: jobId,
        path: "gc/reclaimed.png",
        status: "deleting",
        leaseToken: staleToken,
        leaseOffset: "-1 second",
      });
      const repository = createAiContentAttachmentGcRepository(pool);

      const [claim] = await repository.claimAiContentAttachmentDeletionJobs({
        workerId: "gc-reclaimer",
        batchSize: 1,
        leaseSeconds: 60,
        ...BUDGET,
      });

      expect(claim?.leaseToken).not.toBe(staleToken);
      await expect(repository.completeAiContentAttachmentDeletion({
        jobId,
        leaseToken: staleToken,
        outcome: "deleted",
        ...BUDGET,
      })).resolves.toBe(false);
      await expect(repository.beginAiContentAttachmentDeletionAttempt({
        jobId,
        leaseToken: claim!.leaseToken,
        ...BUDGET,
      })).resolves.toBe(1);
      await expect(repository.completeAiContentAttachmentDeletion({
        jobId,
        leaseToken: claim!.leaseToken,
        outcome: "not_found",
        ...BUDGET,
      })).resolves.toBe(true);
    });

    it("releases unstarted claims without attempts and retries failures from database time", async () => {
      const jobId = "70000000-0000-4000-8000-000000000010";
      await insertJob(pool, { id: jobId, path: "gc/budget.png" });
      const repository = createAiContentAttachmentGcRepository(pool);
      const [claim] = await repository.claimAiContentAttachmentDeletionJobs({
        workerId: "gc-budget",
        batchSize: 1,
        leaseSeconds: 60,
        ...BUDGET,
      });

      await expect(repository.releaseUnstartedAiContentAttachmentDeletions({
        claims: [{ jobId, leaseToken: claim!.leaseToken }],
        ...BUDGET,
      })).resolves.toBe(1);
      expect((await pool.query(
        "select status, attempt_count from ai_content_attachment_deletion_jobs where id = $1",
        [jobId],
      )).rows[0]).toEqual({ status: "pending", attempt_count: 0 });

      const [retryClaim] = await repository.claimAiContentAttachmentDeletionJobs({
        workerId: "gc-retry",
        batchSize: 1,
        leaseSeconds: 60,
        ...BUDGET,
      });
      await repository.beginAiContentAttachmentDeletionAttempt({
        jobId,
        leaseToken: retryClaim!.leaseToken,
        ...BUDGET,
      });
      await expect(repository.failAiContentAttachmentDeletion({
        jobId,
        leaseToken: retryClaim!.leaseToken,
        errorCategory: "transient",
        errorMessage: "provider timeout Authorization: Bearer hidden",
        retryDelaySeconds: 30,
        ...BUDGET,
      })).resolves.toBe("retry");
      const failed = (await pool.query(
        `select status, attempt_count,
                next_attempt_at between now() + interval '25 seconds' and now() + interval '35 seconds' as db_scheduled,
                last_error_message
           from ai_content_attachment_deletion_jobs where id = $1`,
        [jobId],
      )).rows[0];
      expect(failed).toMatchObject({ status: "failed", attempt_count: 1, db_scheduled: true });
      expect(failed.last_error_message).not.toContain("hidden");
    });

    it("filters an older completed-artifact hold before LIMIT while exposing held metrics", async () => {
      const heldUrl = "https://blob.example/gc/held.png?token=old";
      await pool.query(
        `insert into ai_content_generation_outputs (
           id, generation_id, workspace_id, brand_id, output_index, status,
           artifact_manifest_json, manifest_url
         ) values (
           $1, $2, $3, $4, 1, 'completed',
           jsonb_build_object('assets', jsonb_build_array(jsonb_build_object('url', $5))),
           $5
         )`,
        [
          "90000000-0000-4000-8000-000000000009",
          GENERATION_ID,
          WORKSPACE_ID,
          BRAND_ID,
          heldUrl,
        ],
      );
      await insertJob(pool, {
        id: "70000000-0000-4000-8000-000000000011",
        path: "gc/held.png",
        url: "https://blob.example/gc/held.png?token=new",
        createdOffset: "-10 minutes",
      });
      await insertJob(pool, {
        id: "70000000-0000-4000-8000-000000000012",
        generationId: OTHER_GENERATION_ID,
        path: "gc/eligible.png",
        createdOffset: "-1 minute",
      });
      const repository = createAiContentAttachmentGcRepository(pool);

      const [claim] = await repository.claimAiContentAttachmentDeletionJobs({
        workerId: "gc-fair",
        batchSize: 1,
        leaseSeconds: 60,
        ...BUDGET,
      });
      expect(claim?.storagePath).toBe("gc/eligible.png");
      const metrics = await repository.getAiContentAttachmentGcMetrics(BUDGET);
      expect(metrics.heldJobCount).toBe(1);
      expect(metrics.holdReasonCounts.artifact_reference).toBe(1);

      await pool.query(
        `update ai_content_generation_outputs
            set manifest_url = 'https://generated.example/manifest.json',
                artifact_manifest_json = '{"assets":[]}'::jsonb
          where generation_id = $1`,
        [GENERATION_ID],
      );
      const [released] = await repository.claimAiContentAttachmentDeletionJobs({
        workerId: "gc-after-promotion",
        batchSize: 1,
        leaseSeconds: 60,
        ...BUDGET,
      });
      expect(released?.storagePath).toBe("gc/held.png");
    });

    it("uses the generation cascade trigger and fences a provider object until token expiry", async () => {
      const sessionId = "50000000-0000-4000-8000-000000000015";
      const issuedToken = "60000000-0000-4000-8000-000000000016";
      const path = "gc/racing.png";
      const providerObjects = new Set<string>();
      const uploadGrant = await insertLiveUploadSession(pool, {
        id: sessionId,
        generationId: GENERATION_ID,
        workspaceId: WORKSPACE_ID,
        brandId: BRAND_ID,
        userId: USER_ID,
        nonce: issuedToken,
        path,
        expiresInSeconds: 3,
      });

      await pool.query("delete from ai_content_generations where id = $1", [GENERATION_ID]);
      const triggered = await pool.query(
        `select id, storage_path, reason, next_attempt_at, next_attempt_at >= $2::timestamptz as due_not_early
          from ai_content_attachment_deletion_jobs
          where workspace_id = $1 and storage_path = $3`,
        [WORKSPACE_ID, uploadGrant.tokenExpiresAt, path],
      );
      expect(triggered.rows).toEqual([expect.objectContaining({
        storage_path: path,
        reason: "upload_session_pending",
        due_not_early: true,
      })]);
      const jobId = String(triggered.rows[0].id);
      expect(jobId).toBe("58318d28-2cc5-a6dd-3ff2-ed0904ea0264");

      const repository = createAiContentAttachmentGcRepository(pool);
      await expect(repository.claimAiContentAttachmentDeletionJobs({
        workerId: "gc-before-expiry",
        batchSize: 1,
        leaseSeconds: 60,
        ...BUDGET,
      })).resolves.toEqual([]);

      expect((await pool.query(
        "select count(*)::integer as count from ai_content_attachment_upload_sessions where id = $1",
        [sessionId],
      )).rows[0].count).toBe(0);
      providerUploadWithIssuedGrant(uploadGrant, { token: issuedToken, path }, providerObjects);
      expect(providerObjects.has(path)).toBe(true);

      await waitUntilDatabaseTime(pool, uploadGrant.tokenExpiresAt);

      const [claim] = await repository.claimAiContentAttachmentDeletionJobs({
        workerId: "gc-after-expiry",
        batchSize: 1,
        leaseSeconds: 60,
        ...BUDGET,
      });
      expect(claim?.jobId).toBe(jobId);
      expect(claim?.storagePath).toBe(path);
      await expect(repository.beginAiContentAttachmentDeletionAttempt({
        jobId,
        leaseToken: claim!.leaseToken,
        ...BUDGET,
      })).resolves.toBe(1);
      expect(providerObjects.delete(claim!.storagePath)).toBe(true);
      await expect(repository.completeAiContentAttachmentDeletion({
        jobId,
        leaseToken: claim!.leaseToken,
        outcome: "deleted",
        ...BUDGET,
      })).resolves.toBe(true);
      expect(providerObjects.has(path)).toBe(false);
    });

    it("uses the workspace cascade trigger and preserves the live-token due boundary", async () => {
      const workspaceId = "21000000-0000-4000-8000-000000000021";
      const brandId = "31000000-0000-4000-8000-000000000031";
      const generationId = "41000000-0000-4000-8000-000000000041";
      const sessionId = "51000000-0000-4000-8000-000000000051";
      const path = "gc/workspace-cascade.png";
      await pool.query(
        `insert into workspaces (id, name, slug, created_by_user_id)
         values ($1, 'Disposable GC Workspace', 'disposable-gc-workspace', $2)`,
        [workspaceId, USER_ID],
      );
      await pool.query(
        `insert into workspace_members (workspace_id, user_id, role)
         values ($1, $2, 'owner')`,
        [workspaceId, USER_ID],
      );
      await pool.query(
        `insert into brands (id, workspace_id, name, created_by_user_id)
         values ($1, $2, 'Disposable GC Brand', $3)`,
        [brandId, workspaceId, USER_ID],
      );
      await pool.query(
        `insert into ai_content_generations (
           id, workspace_id, brand_id, type, title, status, analysis_idempotency_key
         ) values ($1, $2, $3, 'card_news', 'Workspace cascade', 'draft', 'workspace-cascade')`,
        [generationId, workspaceId, brandId],
      );
      const uploadGrant = await insertLiveUploadSession(pool, {
        id: sessionId,
        generationId,
        workspaceId,
        brandId,
        userId: USER_ID,
        nonce: "61000000-0000-4000-8000-000000000061",
        path,
        expiresInSeconds: 300,
      });

      await pool.query("delete from workspaces where id = $1", [workspaceId]);

      const triggered = await pool.query(
        `select storage_path, reason, next_attempt_at,
                next_attempt_at >= $2::timestamptz as due_not_early
          from ai_content_attachment_deletion_jobs
          where workspace_id = $1 and storage_path = $3`,
        [workspaceId, uploadGrant.tokenExpiresAt, path],
      );
      expect(triggered.rows).toEqual([{
        storage_path: path,
        reason: "upload_session_pending",
        next_attempt_at: expect.any(Date),
        due_not_early: true,
      }]);
      const repository = createAiContentAttachmentGcRepository(pool);
      await expect(repository.claimAiContentAttachmentDeletionJobs({
        workerId: "gc-workspace-before-expiry",
        batchSize: 1,
        leaseSeconds: 60,
        ...BUDGET,
      })).resolves.toEqual([]);
    });
  },
);
