import { describe, expect, it, vi } from "vitest";
import {
  createAiContentAttachmentGcRepository,
  redactAiContentAttachmentGcError,
} from "./aiContentAttachmentGcRepository.js";

const BUDGET = { remainingBudgetMs: 5_000, statementTimeoutMs: 2_000 };
const JOB_ID = "10000000-0000-4000-8000-000000000001";
const LEASE = "20000000-0000-4000-8000-000000000002";
const GENERATION_ID = "30000000-0000-4000-8000-000000000003";

type Result = { rows: Record<string, unknown>[]; rowCount: number };

function scriptedPool(
  handler: (sql: string, params: unknown[] | undefined) => Result | Promise<Result>,
) {
  const sql: string[] = [];
  const params: Array<unknown[] | undefined> = [];
  const releases: Array<Error | undefined> = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      sql.push(text);
      params.push(values);
      if (/^(begin|commit|rollback)$/i.test(text)) return { rows: [], rowCount: 0 };
      if (/^set local statement_timeout/i.test(text)) return { rows: [], rowCount: 0 };
      return handler(text, values);
    },
    release(error?: Error) {
      releases.push(error);
    },
  };
  return {
    connect: async () => client,
    query: client.query,
    sql,
    params,
    releases,
  };
}

describe("AiContentAttachmentGcRepository", () => {
  it("prepares bounded expired sessions, logical deletions, terminal retention, and one idempotent job", async () => {
    const pool = scriptedPool((sql) => {
      if (sql.includes("with expired_sessions")) {
        return {
          rows: [{
            sessions_scanned: 4,
            sessions_claimed: 4,
            sessions_confirmed: 1,
            sessions_expired: 3,
            jobs_created: 4,
            leases_reclaimed: 2,
          }],
          rowCount: 1,
        };
      }
      throw new Error(`unexpected:${sql}`);
    });
    const repository = createAiContentAttachmentGcRepository(pool as never);

    await expect(repository.prepareAiContentAttachmentGc({ limit: 25, ...BUDGET }))
      .resolves.toEqual({
        sessionsScanned: 4,
        sessionsClaimed: 4,
        sessionsConfirmed: 1,
        sessionsExpired: 3,
        jobsCreated: 4,
        leasesReclaimed: 2,
      });

    const query = pool.sql.find((sql) => sql.includes("with expired_sessions"))!;
    expect(query).toContain("session.status in ('pending', 'failed', 'cancelled')");
    expect(query).toContain("session.token_expires_at <= now()");
    expect(query).toContain("existing_session_job.upload_session_id = session.id");
    expect(query).toContain("attachment.deleted_at is not null");
    expect(query).toContain("generation.retryable_until <= now()");
    expect(query).toContain("attachment.physical_delete_status in ('none','pending','failed')");
    expect(query).toContain("existing_attachment_job.attachment_id = attachment.id");
    expect(query).toContain("expired_leases as materialized");
    expect(query).toMatch(/expired_leases[\s\S]*limit \$1[\s\S]*for update skip locked/);
    expect(query).toContain("on conflict (workspace_id, storage_path) do nothing");
    expect(query).toContain("greatest(now(), session.token_expires_at)");
    expect(query).not.toMatch(/https?:\/\/|blob\.del|fetch\(/i);
  });

  it("filters every retention, snapshot, completed artifact, linked channel and publish hold before limit and rechecks after locks", async () => {
    const pool = scriptedPool((sql) => {
      if (sql.includes("gc_candidate_jobs")) {
        return { rows: [{ id: JOB_ID, generation_id: null }], rowCount: 1 };
      }
      if (sql.includes("for update skip locked")) return { rows: [], rowCount: 0 };
      throw new Error(`unexpected:${sql}`);
    });
    const repository = createAiContentAttachmentGcRepository(pool as never);

    await expect(repository.claimAiContentAttachmentDeletionJobs({
      workerId: "gc-a",
      batchSize: 10,
      leaseSeconds: 120,
      ...BUDGET,
    })).resolves.toEqual([]);

    const candidate = pool.sql.find((sql) => sql.includes("gc_candidate_jobs"))!;
    const lock = pool.sql.find((sql) => sql.includes("for update skip locked"))!;
    for (const fragment of [
      "retryable_until",
      "ai_content_subject_analyses",
      "ai_content_generation_jobs",
      "manifest_url",
      "artifact_manifest_json",
      "channel_outputs",
      "publish_queue",
      "split_part",
    ]) {
      expect(candidate).toContain(fragment);
      expect(lock).toContain(fragment);
    }
    const candidateWindow = candidate.slice(candidate.indexOf("gc_candidate_jobs as materialized"));
    expect(candidateWindow.indexOf("not exists")).toBeLessThan(candidateWindow.indexOf("order by"));
    expect(candidateWindow.indexOf("order by")).toBeLessThan(candidateWindow.indexOf("limit"));
  });

  it("uses a stable keyset to refill the batch after a concurrent claimant wins the first candidate", async () => {
    const youngerJob = "10000000-0000-4000-8000-000000000002";
    let candidateReads = 0;
    const pool = scriptedPool((sql, params) => {
      if (sql.includes("gc_candidate_jobs")) {
        candidateReads += 1;
        if (candidateReads === 1) {
          return { rows: [{
            id: JOB_ID,
            generation_id: null,
            workspace_id: "40000000-0000-4000-8000-000000000004",
            brand_id: "50000000-0000-4000-8000-000000000005",
            next_attempt_at: "2026-07-28T00:00:00.000Z",
            created_at: "2026-07-28T00:00:00.000Z",
          }], rowCount: 1 };
        }
        expect(params?.slice(1, 4)).toEqual([
          "2026-07-28T00:00:00.000Z",
          "2026-07-28T00:00:00.000Z",
          JOB_ID,
        ]);
        return { rows: [{
          id: youngerJob,
          generation_id: null,
          workspace_id: "40000000-0000-4000-8000-000000000004",
          brand_id: "50000000-0000-4000-8000-000000000005",
          next_attempt_at: "2026-07-28T00:00:01.000Z",
          created_at: "2026-07-28T00:00:01.000Z",
        }], rowCount: 1 };
      }
      if (sql.includes("for update skip locked")) {
        if (params?.[0] === JOB_ID) return { rows: [], rowCount: 0 };
        return { rows: [{
          id: youngerJob,
          workspace_id: "40000000-0000-4000-8000-000000000004",
          brand_id: "50000000-0000-4000-8000-000000000005",
          generation_id: GENERATION_ID,
          attachment_id: null,
          upload_session_id: null,
          storage_path: "attachments/younger.png",
          storage_url: "https://blob.example/attachments/younger.png",
          reason: "user_removed",
          attempt_count: 0,
          max_attempts: 10,
        }], rowCount: 1 };
      }
      if (sql.includes("set status = 'deleting'")) {
        return { rows: [{
          id: youngerJob,
          workspace_id: "40000000-0000-4000-8000-000000000004",
          brand_id: "50000000-0000-4000-8000-000000000005",
          generation_id: GENERATION_ID,
          attachment_id: null,
          upload_session_id: null,
          storage_path: "attachments/younger.png",
          storage_url: "https://blob.example/attachments/younger.png",
          reason: "user_removed",
          attempt_count: 0,
          max_attempts: 10,
          lease_token: LEASE,
          lease_expires_at: "2026-07-28T00:02:00.000Z",
        }], rowCount: 1 };
      }
      throw new Error(`unexpected:${sql}`);
    });
    const repository = createAiContentAttachmentGcRepository(pool as never, { createId: () => LEASE });

    await expect(repository.claimAiContentAttachmentDeletionJobs({
      workerId: "gc-refill",
      batchSize: 1,
      leaseSeconds: 60,
      ...BUDGET,
    })).resolves.toEqual([expect.objectContaining({ jobId: youngerJob })]);
    expect(candidateReads).toBe(2);
    expect(pool.sql.find((sql) => sql.includes("gc_candidate_jobs"))).toMatch(
      /\(job\.next_attempt_at, job\.created_at, job\.id\)\s*>\s*\(\$2::timestamptz/,
    );
  });

  it("dead-letters an expired final-attempt lease and mirrors the attachment summary before scanning", async () => {
    const pool = scriptedPool((sql) => {
      if (sql.includes("gc_candidate_jobs")) return { rows: [], rowCount: 0 };
      throw new Error(`unexpected:${sql}`);
    });
    const repository = createAiContentAttachmentGcRepository(pool as never);

    await expect(repository.claimAiContentAttachmentDeletionJobs({
      workerId: "gc-exhausted",
      batchSize: 10,
      leaseSeconds: 60,
      ...BUDGET,
    })).resolves.toEqual([]);

    const query = pool.sql.find((sql) => sql.includes("gc_candidate_jobs"))!;
    expect(query).toContain("exhausted_leases as materialized");
    expect(query).toContain("attempt_count >= job.max_attempts");
    expect(query).toContain("job.lease_token = exhausted.lease_token");
    expect(query).toContain("status = 'dead_letter'");
    expect(query).toContain("physical_delete_status = 'dead_letter'");
    expect(query).toContain("job.attempt_count < job.max_attempts");
  });

  it("locks a live generation before its deletion job and issues a fresh fenced lease without consuming an attempt", async () => {
    const events: string[] = [];
    const pool = scriptedPool((sql) => {
      if (sql.includes("gc_candidate_jobs")) return { rows: [{
        id: JOB_ID,
        generation_id: "30000000-0000-4000-8000-000000000003",
        workspace_id: "40000000-0000-4000-8000-000000000004",
        brand_id: "50000000-0000-4000-8000-000000000005",
      }], rowCount: 1 };
      if (sql.includes("select id from ai_content_generations") && sql.includes("for update")) {
        events.push("generation");
        return { rows: [{ id: "30000000-0000-4000-8000-000000000003" }], rowCount: 1 };
      }
      if (sql.includes("for update skip locked")) {
        events.push("job");
        return { rows: [{
          id: JOB_ID,
          workspace_id: "40000000-0000-4000-8000-000000000004",
          brand_id: "50000000-0000-4000-8000-000000000005",
          generation_id: "30000000-0000-4000-8000-000000000003",
          storage_path: "attachments/a.png",
          storage_url: "https://blob.example/attachments/a.png",
          reason: "terminal_retention_expired",
          attempt_count: 2,
          max_attempts: 10,
          lease_token: LEASE,
          lease_expires_at: "2026-07-28T01:02:00.000Z",
        }], rowCount: 1 };
      }
      if (sql.includes("set status = 'deleting'")) return { rows: [{
        id: JOB_ID,
        workspace_id: "40000000-0000-4000-8000-000000000004",
        brand_id: "50000000-0000-4000-8000-000000000005",
        generation_id: "30000000-0000-4000-8000-000000000003",
        attachment_id: null,
        upload_session_id: null,
        storage_path: "attachments/a.png",
        storage_url: "https://blob.example/attachments/a.png",
        reason: "terminal_retention_expired",
        attempt_count: 2,
        max_attempts: 10,
        lease_token: LEASE,
        lease_expires_at: "2026-07-28T01:02:00.000Z",
      }], rowCount: 1 };
      if (sql.includes("physical_delete_status = 'deleting'")) return { rows: [], rowCount: 1 };
      throw new Error(`unexpected:${sql}`);
    });
    const repository = createAiContentAttachmentGcRepository(pool as never, { createId: () => LEASE });

    const claims = await repository.claimAiContentAttachmentDeletionJobs({
      workerId: "gc-a",
      batchSize: 1,
      leaseSeconds: 120,
      ...BUDGET,
    });

    expect(events).toEqual(["generation", "job"]);
    const generationLock = pool.sql.find((sql) => sql.includes("select id from ai_content_generations"))!;
    expect(generationLock).toContain("workspace_id = $2 and brand_id = $3");
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ jobId: JOB_ID, leaseToken: LEASE, attemptCount: 2 });
    const update = pool.sql.find((sql) => sql.includes("set status = 'deleting'"))!;
    expect(update).not.toContain("attempt_count = attempt_count + 1");
  });

  it("returns already committed claims when a later per-candidate transaction fails", async () => {
    const secondJob = "10000000-0000-4000-8000-000000000002";
    const pool = scriptedPool((sql, params) => {
      if (sql.includes("gc_candidate_jobs")) {
        return { rows: [
          { id: JOB_ID, generation_id: null },
          { id: secondJob, generation_id: null },
        ], rowCount: 2 };
      }
      if (sql.includes("for update skip locked")) {
        if (params?.[0] === secondJob) throw new Error("candidate_connection_lost");
        return { rows: [{
          id: JOB_ID,
          workspace_id: "40000000-0000-4000-8000-000000000004",
          brand_id: "50000000-0000-4000-8000-000000000005",
          generation_id: GENERATION_ID,
          attachment_id: null,
          upload_session_id: null,
          storage_path: "attachments/first.png",
          storage_url: "https://blob.example/attachments/first.png",
          reason: "user_removed",
          attempt_count: 0,
          max_attempts: 10,
          lease_token: LEASE,
          lease_expires_at: "2026-07-28T01:02:00.000Z",
        }], rowCount: 1 };
      }
      if (sql.includes("set status = 'deleting'")) {
        return { rows: [{
          id: JOB_ID,
          workspace_id: "40000000-0000-4000-8000-000000000004",
          brand_id: "50000000-0000-4000-8000-000000000005",
          generation_id: GENERATION_ID,
          attachment_id: null,
          upload_session_id: null,
          storage_path: "attachments/first.png",
          storage_url: "https://blob.example/attachments/first.png",
          reason: "user_removed",
          attempt_count: 0,
          max_attempts: 10,
          lease_token: LEASE,
          lease_expires_at: "2026-07-28T01:02:00.000Z",
        }], rowCount: 1 };
      }
      throw new Error(`unexpected:${sql}`);
    });
    const ids = [LEASE, "20000000-0000-4000-8000-000000000003"];
    const repository = createAiContentAttachmentGcRepository(pool as never, {
      createId: () => ids.shift()!,
    });

    await expect(repository.claimAiContentAttachmentDeletionJobs({
      workerId: "gc-partial",
      batchSize: 2,
      leaseSeconds: 60,
      ...BUDGET,
    })).resolves.toEqual([expect.objectContaining({ jobId: JOB_ID })]);
    expect(pool.sql).toContain("ROLLBACK");
  });

  it("returns already committed claims when a keyset refill scan fails", async () => {
    let candidateReads = 0;
    const pool = scriptedPool((sql) => {
      if (sql.includes("gc_candidate_jobs")) {
        candidateReads += 1;
        if (candidateReads > 1) throw new Error("refill_scan_failed");
        return { rows: [{
          id: JOB_ID,
          generation_id: null,
          workspace_id: "40000000-0000-4000-8000-000000000004",
          brand_id: "50000000-0000-4000-8000-000000000005",
          next_attempt_at: "2026-07-28T00:00:00.000Z",
          created_at: "2026-07-28T00:00:00.000Z",
        }], rowCount: 1 };
      }
      if (sql.includes("for update skip locked")) {
        return { rows: [{
          id: JOB_ID,
          workspace_id: "40000000-0000-4000-8000-000000000004",
          brand_id: "50000000-0000-4000-8000-000000000005",
          generation_id: GENERATION_ID,
          attachment_id: null,
          upload_session_id: null,
          storage_path: "attachments/first.png",
          storage_url: "https://blob.example/attachments/first.png",
          reason: "user_removed",
          attempt_count: 0,
          max_attempts: 10,
        }], rowCount: 1 };
      }
      if (sql.includes("set status = 'deleting'")) {
        return { rows: [{
          id: JOB_ID,
          workspace_id: "40000000-0000-4000-8000-000000000004",
          brand_id: "50000000-0000-4000-8000-000000000005",
          generation_id: GENERATION_ID,
          attachment_id: null,
          upload_session_id: null,
          storage_path: "attachments/first.png",
          storage_url: "https://blob.example/attachments/first.png",
          reason: "user_removed",
          attempt_count: 0,
          max_attempts: 10,
          lease_token: LEASE,
          lease_expires_at: "2026-07-28T00:02:00.000Z",
        }], rowCount: 1 };
      }
      throw new Error(`unexpected:${sql}`);
    });
    const repository = createAiContentAttachmentGcRepository(pool as never, { createId: () => LEASE });

    await expect(repository.claimAiContentAttachmentDeletionJobs({
      workerId: "gc-refill-failure",
      batchSize: 2,
      leaseSeconds: 60,
      ...BUDGET,
    })).resolves.toEqual([expect.objectContaining({ jobId: JOB_ID })]);
    expect(candidateReads).toBe(2);
  });

  it("begins an attempt with lease CAS and stale/reclaimed tokens cannot finalize", async () => {
    const pool = scriptedPool((sql) => {
      if (sql.includes("attempt_count = attempt_count + 1")) return { rows: [{ attempt_count: 3 }], rowCount: 1 };
      if (sql.includes("set status = 'deleted'")) return { rows: [], rowCount: 0 };
      throw new Error(`unexpected:${sql}`);
    });
    const repository = createAiContentAttachmentGcRepository(pool as never);

    await expect(repository.beginAiContentAttachmentDeletionAttempt({
      jobId: JOB_ID,
      leaseToken: LEASE,
      ...BUDGET,
    })).resolves.toBe(3);
    await expect(repository.completeAiContentAttachmentDeletion({
      jobId: JOB_ID,
      leaseToken: "90000000-0000-4000-8000-000000000009",
      outcome: "not_found",
      ...BUDGET,
    })).resolves.toBe(false);

    expect(pool.sql.join("\n")).toContain("status = 'deleting'");
    expect(pool.sql.join("\n")).toContain("lease_token = $2::uuid");
  });

  it("releases every budget-skipped claim set-wise without consuming attempts", async () => {
    const pool = scriptedPool((sql, params) => {
      if (sql.includes("released as")) {
        expect(params?.[0]).toEqual([JOB_ID]);
        expect(params?.[1]).toEqual([LEASE]);
        return { rows: [{ released_count: 1 }], rowCount: 1 };
      }
      throw new Error(`unexpected:${sql}`);
    });
    const repository = createAiContentAttachmentGcRepository(pool as never);

    await expect(repository.releaseUnstartedAiContentAttachmentDeletions({
      claims: [{ jobId: JOB_ID, leaseToken: LEASE }],
      ...BUDGET,
    })).resolves.toBe(1);
    const query = pool.sql.find((sql) => sql.includes("released as"))!;
    expect(query).toContain("next_attempt_at = now()");
    expect(query).not.toContain("attempt_count");
  });

  it("treats not-found as deleted and mirrors only attachment summary state", async () => {
    const pool = scriptedPool((sql) => {
      if (sql.includes("set status = 'deleted'")) return { rows: [{ attachment_id: "60000000-0000-4000-8000-000000000006" }], rowCount: 1 };
      if (sql.includes("physical_delete_status = 'deleted'")) return { rows: [], rowCount: 1 };
      throw new Error(`unexpected:${sql}`);
    });
    const repository = createAiContentAttachmentGcRepository(pool as never);

    await expect(repository.completeAiContentAttachmentDeletion({
      jobId: JOB_ID,
      leaseToken: LEASE,
      outcome: "not_found",
      ...BUDGET,
    })).resolves.toBe(true);
    const all = pool.sql.join("\n");
    expect(all).toContain("completed_at = now()");
    expect(all).toContain("physically_deleted_at = now()");
    expect(all).not.toMatch(/ai_content_generation_attachments[\s\S]*attempt_count/);
  });

  it("retries transient failures from DB now and dead-letters permanent or exhausted jobs", async () => {
    const responses = [
      { rows: [{ disposition: "retry", attachment_id: null }], rowCount: 1 },
      { rows: [{ disposition: "dead_letter", attachment_id: null }], rowCount: 1 },
    ];
    const pool = scriptedPool((sql) => {
      if (sql.includes("case when")) return responses.shift()!;
      throw new Error(`unexpected:${sql}`);
    });
    const repository = createAiContentAttachmentGcRepository(pool as never);

    await expect(repository.failAiContentAttachmentDeletion({
      jobId: JOB_ID,
      leaseToken: LEASE,
      errorCategory: "transient",
      errorMessage: 'provider timeout {"access_token":"persisted-secret"}',
      retryDelaySeconds: 13,
      ...BUDGET,
    })).resolves.toBe("retry");
    await expect(repository.failAiContentAttachmentDeletion({
      jobId: JOB_ID,
      leaseToken: LEASE,
      errorCategory: "authorization",
      errorMessage: "forbidden",
      retryDelaySeconds: null,
      ...BUDGET,
    })).resolves.toBe("dead_letter");
    const query = pool.sql.find((sql) => sql.includes("case when"))!;
    expect(query).toContain("now() + ($5::text || ' seconds')::interval");
    expect(query).toContain("attempt_count >= max_attempts");
    expect(query).toContain("$3 in ('authorization','authentication','permanent')");
    expect(query).toContain("'dead_letter'");
    const firstFailure = pool.params[pool.sql.findIndex((sql) => sql.includes("case when"))];
    expect(firstFailure?.[3]).toBe('provider timeout {"access_token":"[REDACTED]"}');
  });

  it("reports eligible and held queues separately using the same hold predicate", async () => {
    const pool = scriptedPool((sql) => {
      if (sql.includes("eligible_queue_depth")) {
        return { rows: [{
          eligible_queue_depth: 2,
          oldest_eligible_pending_age_seconds: 90,
          held_job_count: 3,
          oldest_held_age_seconds: 400,
          hold_reason_counts: { retry_retention: 1, artifact_reference: 2 },
          attempt_count_buckets: { "0": 1, "1-3": 2 },
          dead_letter_count: 4,
        }], rowCount: 1 };
      }
      throw new Error(`unexpected:${sql}`);
    });
    const repository = createAiContentAttachmentGcRepository(pool as never);

    await expect(repository.getAiContentAttachmentGcMetrics(BUDGET)).resolves.toEqual({
      eligibleQueueDepth: 2,
      oldestEligiblePendingAgeSeconds: 90,
      heldJobCount: 3,
      oldestHeldAgeSeconds: 400,
      holdReasonCounts: { retry_retention: 1, artifact_reference: 2 },
      attemptCountBuckets: { "0": 1, "1-3": 2 },
      deadLetterCount: 4,
    });
    const query = pool.sql.find((sql) => sql.includes("eligible_queue_depth"))!;
    expect(query).toContain("hold_reason");
    expect(query).toContain("eligible");
    expect(query).toContain("held");
  });

  it("bounds and redacts persisted provider errors", () => {
    const redacted = redactAiContentAttachmentGcError(
      "Authorization: Bearer secret-token nonce=abc123 https://blob.example/a?token=signed&x=1",
      80,
    );
    expect(redacted.length).toBeLessThanOrEqual(80);
    expect(redacted).not.toContain("secret-token");
    expect(redacted).not.toContain("abc123");
    expect(redacted).not.toContain("?token=");
    expect(redacted).not.toContain("&x=1");
    expect(redacted).toContain("[REDACTED]");
  });

  it.each([
    ["access_token=supersecret", "supersecret"],
    ["refresh_token: refreshsecret", "refreshsecret"],
    ["accessToken=camelSecret", "camelSecret"],
    ["auth-token=authSecret", "authSecret"],
    ["client_secret: clientSecretValue", "clientSecretValue"],
    ["clientSecret=camelClientSecret", "camelClientSecret"],
    ["token abc123", "abc123"],
    ["nonce abc123", "abc123"],
    ["x-vercel-signature: signed-payload", "signed-payload"],
    ["xVercelSignature=camel-signature", "camel-signature"],
    ["Authorization: Basic basic-secret", "basic-secret"],
    ["provider rejected Bearer bearer-secret", "bearer-secret"],
    ["GET https://blob.example/a?access_token=query-secret&safe=value", "query-secret"],
    ["request failed?refresh-token=query-secret&attempt=2", "query-secret"],
  ])("redacts provider credential form %s", (message, secret) => {
    const redacted = redactAiContentAttachmentGcError(message);

    expect(redacted).not.toContain(secret);
    expect(redacted).toContain("[REDACTED]");
  });

  it.each([
    ['{"access_token":"supersecret"}', '{"access_token":"[REDACTED]"}'],
    ['{ "refreshToken" : "secret" }', '{ "refreshToken" : "[REDACTED]" }'],
    ['{"authorization":"Bearer secret"}', '{"authorization":"[REDACTED]"}'],
    ['{\n  "access_token" : "secret-value"\n}', '{\n  "access_token" : "[REDACTED]"\n}'],
    ['{"access_token":"secret\\\"escaped-value"}', '{"access_token":"[REDACTED]"}'],
    [
      '{"access_token":"secret","message":"keep this diagnostic"}',
      '{"access_token":"[REDACTED]","message":"keep this diagnostic"}',
    ],
    ["access_token = 'secret value'", "access_token = '[REDACTED]'"],
    ['nonce: "abc 123"', 'nonce: "[REDACTED]"'],
    ["token was abc123", "token was [REDACTED]"],
    ["token rejected: abc123", "token rejected: [REDACTED]"],
  ])("redacts quoted or diagnostic credential value in %s", (message, expected) => {
    expect(redactAiContentAttachmentGcError(message)).toBe(expected);
  });

  it("bounds a long escaped quoted credential without consuming adjacent diagnostics", () => {
    const message = `{"access_token":"${"part\\\"".repeat(2_000)}secret"} status=failed`;
    const redacted = redactAiContentAttachmentGcError(message, 80);

    expect(redacted).toBe('{"access_token":"[REDACTED]"} status=failed');
    expect(redacted.length).toBeLessThanOrEqual(80);
  });

  it.each([
    "upload token expired after provider timeout",
    "token was rejected",
    "token rejected by provider",
    "auth request failed before provider call",
    "client secret rotation failed",
    "authentication request timed out",
    "signature verification failed before upload",
  ])("preserves non-secret diagnostic text: %s", (message) => {
    expect(redactAiContentAttachmentGcError(message)).toBe(message);
  });

  it("rejects invalid budgets before pool acquisition", async () => {
    let connected = false;
    const pool = { connect: async () => { connected = true; throw new Error("must_not_connect"); } };
    const repository = createAiContentAttachmentGcRepository(pool as never);

    await expect(repository.getAiContentAttachmentGcMetrics({
      remainingBudgetMs: 0,
      statementTimeoutMs: 1,
    })).rejects.toThrow("ai_content_gc_budget_exhausted");
    expect(connected).toBe(false);
  });

  it("releases a connection that arrives after the acquisition budget", async () => {
    vi.useFakeTimers();
    const release = vi.fn();
    let resolveConnection!: (client: {
      query: () => Promise<Result>;
      release: typeof release;
    }) => void;
    const pool = {
      connect: () => new Promise((resolve) => {
        resolveConnection = resolve;
      }),
    };
    const repository = createAiContentAttachmentGcRepository(pool as never);
    try {
      const metrics = repository.getAiContentAttachmentGcMetrics({
        remainingBudgetMs: 10,
        statementTimeoutMs: 5,
      });
      const rejected = expect(metrics).rejects.toThrow("ai_content_gc_budget_exhausted");
      await vi.advanceTimersByTimeAsync(10);
      await rejected;
      resolveConnection({
        async query() {
          return { rows: [], rowCount: 0 };
        },
        release,
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(release).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("destroys a connection after an ambiguous commit failure", async () => {
    const commitError = new Error("commit_failed");
    const release = vi.fn();
    const commands: string[] = [];
    const client = {
      async query(sql: string) {
        commands.push(sql);
        if (sql === "COMMIT") throw commitError;
        if (sql.includes("eligible_queue_depth")) {
          return { rows: [{
            eligible_queue_depth: 0,
            held_job_count: 0,
            hold_reason_counts: {},
            attempt_count_buckets: {},
            dead_letter_count: 0,
          }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
      release,
    };
    const repository = createAiContentAttachmentGcRepository({
      connect: async () => client,
    } as never);

    await expect(repository.getAiContentAttachmentGcMetrics(BUDGET)).rejects.toBe(commitError);
    expect(commands.slice(-2)).toEqual(["COMMIT", "ROLLBACK"]);
    expect(release).toHaveBeenCalledWith(commitError);
  });

  it("recomputes an absolute deadline before every statement and starts no query after exhaustion", async () => {
    let nowMs = 0;
    const now = vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    const statements: Array<{ sql: string; at: number }> = [];
    const release = vi.fn();
    const client = {
      async query(sql: string) {
        statements.push({ sql, at: nowMs });
        nowMs += 3;
        if (sql.includes("gc_candidate_jobs")) {
          return { rows: [{
            id: JOB_ID,
            generation_id: null,
            workspace_id: "40000000-0000-4000-8000-000000000004",
            brand_id: "50000000-0000-4000-8000-000000000005",
            next_attempt_at: "2026-07-28T00:00:00.000Z",
            created_at: "2026-07-28T00:00:00.000Z",
          }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
      release,
    };
    const repository = createAiContentAttachmentGcRepository({
      connect: async () => client,
    } as never, { createId: () => LEASE });
    try {
      await expect(repository.claimAiContentAttachmentDeletionJobs({
        workerId: "gc-deadline",
        batchSize: 1,
        leaseSeconds: 60,
        remainingBudgetMs: 20,
        statementTimeoutMs: 20,
      })).rejects.toThrow("ai_content_gc_budget_exhausted");

      expect(statements.some(({ sql }) =>
        sql.includes("select job.*") && sql.includes("for update skip locked"))).toBe(false);
      for (const statement of statements.filter(({ sql }) => sql.startsWith("set local statement_timeout"))) {
        const configured = Number(statement.sql.match(/'(\d+)ms'/)?.[1]);
        expect(configured).toBeLessThanOrEqual(20 - statement.at);
      }
      expect(release).toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });
});
