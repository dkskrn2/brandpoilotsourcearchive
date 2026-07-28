import { describe, expect, it, vi } from "vitest";
import { createContentProposalJobsRepository } from "./contentProposalJobs.js";

function proposal(title: string) {
  return {
    contractVersion: "content-proposal.v1",
    title,
    reasonToCreateNow: "최근 근거가 확보됨",
    contentFamily: "informational",
    topic: "운영 체크리스트",
    target: {},
    messageStrategy: "how_to",
    hook: "먼저 확인할 것",
    keyMessage: "순서대로 점검하세요",
    evidence: [],
    outline: [{ heading: "점검", purpose: "실행 안내" }],
    outputFormat: "blog",
    channelTargets: ["blog_export"],
    recommendedReferenceQuery: { strategies: ["how_to"], formats: ["blog"], tags: [] },
  };
}

function setup() {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const job = {
    id: "10000000-0000-4000-8000-000000000001",
    workspace_id: "20000000-0000-4000-8000-000000000002",
    brand_id: "30000000-0000-4000-8000-000000000003",
    batch_id: "40000000-0000-4000-8000-000000000004",
    status: "queued",
    attempt_count: 0,
    max_attempts: 3,
    lease_owner: null as string | null,
    lease_token: null as string | null,
    lease_expires_at: null as Date | null,
    available_at: new Date("2026-07-28T00:00:00Z"),
    request_json: { contractVersion: "content-proposal-request.v1" },
    source_snapshot_json: [{ sourceId: "source-1" }],
    completion_lease_owner: null as string | null,
    completion_lease_token: null as string | null,
  };
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
      if (sql.includes("attempt_count >= max_attempts")) return { rows: [], rowCount: 0 };
      if (sql.includes("select job.id") && sql.includes("skip locked")) {
        return job.status === "queued" ? { rows: [{ id: job.id }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.includes("set status = 'processing'") && sql.includes("returning")) {
        Object.assign(job, {
          status: "processing",
          attempt_count: Number(job.attempt_count) + 1,
          lease_owner: params[1],
          lease_token: params[2],
          lease_expires_at: new Date("2026-07-28T00:03:00Z"),
        });
        return { rows: [{ ...job }], rowCount: 1 };
      }
      if (sql.includes("set (lease_expires_at, updated_at)")) {
        const valid = job.status === "processing" && job.lease_owner === params[1] && job.lease_token === params[2];
        return { rows: valid ? [{ id: job.id }] : [], rowCount: valid ? 1 : 0 };
      }
      if (sql.includes("from ai_content_proposal_jobs job") && sql.includes("for update")) {
        return { rows: [{ ...job, lease_expired: false }], rowCount: 1 };
      }
      if (sql.includes("insert into ai_content_proposals")) return { rows: [], rowCount: 2 };
      if (sql.includes("update ai_content_proposal_batches")) return { rows: [], rowCount: 1 };
      if (sql.includes("set status = 'completed'")) {
        job.status = "completed";
        Object.assign(job, {
          lease_owner: null,
          lease_token: null,
          lease_expires_at: null,
          completion_lease_owner: params[1],
          completion_lease_token: params[2],
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("set status = $2")) {
        job.status = String(params[1]);
        Object.assign(job, { lease_owner: null, lease_token: null, lease_expires_at: null });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(async () => client), query: client.query };
  return { repository: createContentProposalJobsRepository(pool as never), statements, job };
}

describe("content proposal jobs", () => {
  it("claims a queued job with a bounded lease and server-owned tenant context", async () => {
    const { repository, statements } = setup();

    const claimed = await repository.claimContentProposalJob({
      workerId: "proposal-worker-1",
      leaseSeconds: 180,
    });

    expect(claimed).toMatchObject({
      workspaceId: "20000000-0000-4000-8000-000000000002",
      brandId: "30000000-0000-4000-8000-000000000003",
      attemptCount: 1,
      workerId: "proposal-worker-1",
    });
    expect(statements.some(({ sql }) => sql.includes("skip locked"))).toBe(true);
    expect(statements.some(({ sql }) => sql.includes("least($4::integer, 900)"))).toBe(true);
  });

  it("heartbeats only the matching unexpired lease", async () => {
    const { repository } = setup();
    const claimed = await repository.claimContentProposalJob({ workerId: "proposal-worker-1", leaseSeconds: 180 });

    await expect(repository.heartbeatContentProposalJob({
      jobId: claimed!.id,
      workerId: "proposal-worker-1",
      leaseToken: claimed!.leaseToken!,
      leaseSeconds: 180,
    })).resolves.toBe(true);
    await expect(repository.heartbeatContentProposalJob({
      jobId: claimed!.id,
      workerId: "other-worker",
      leaseToken: claimed!.leaseToken!,
      leaseSeconds: 180,
    })).resolves.toBe(false);
  });

  it("completes idempotently and persists only validated 2-3 proposals", async () => {
    const { repository, statements } = setup();
    const claimed = await repository.claimContentProposalJob({ workerId: "proposal-worker-1", leaseSeconds: 180 });
    const proposals = [proposal("A"), proposal("B")];

    await repository.completeContentProposalJob({
      jobId: claimed!.id,
      workerId: "proposal-worker-1",
      leaseToken: claimed!.leaseToken!,
      proposals,
    });
    await expect(repository.completeContentProposalJob({
      jobId: claimed!.id,
      workerId: "proposal-worker-1",
      leaseToken: claimed!.leaseToken!,
      proposals,
    })).resolves.toMatchObject({ status: "completed" });
    await expect(repository.completeContentProposalJob({
      jobId: claimed!.id,
      workerId: "other-worker",
      leaseToken: "60000000-0000-4000-8000-000000000006",
      proposals,
    })).rejects.toThrow("content_proposal_job_lease_invalid");

    const insert = statements.find(({ sql }) => sql.includes("insert into ai_content_proposals"));
    expect(insert?.sql).toContain("job.workspace_id");
    expect(insert?.sql).toContain("job.brand_id");
    expect(insert?.params).toEqual(expect.arrayContaining([JSON.stringify(proposals)]));
  });

  it("rejects completion payloads outside the 2-3 proposal bound", async () => {
    const { repository } = setup();
    await expect(repository.completeContentProposalJob({
      jobId: "10000000-0000-4000-8000-000000000001",
      workerId: "proposal-worker-1",
      leaseToken: "50000000-0000-4000-8000-000000000005",
      proposals: [{ contractVersion: "content-proposal.v1" }],
    })).rejects.toThrow("content_proposal_result_invalid");
  });

  it("rejects structurally incomplete worker proposals", async () => {
    const { repository } = setup();
    const claimed = await repository.claimContentProposalJob({
      workerId: "proposal-worker-1",
      leaseSeconds: 180,
    });
    await expect(repository.completeContentProposalJob({
      jobId: claimed!.id,
      workerId: "proposal-worker-1",
      leaseToken: claimed!.leaseToken!,
      proposals: [
        { contractVersion: "content-proposal.v1", title: "A" },
        { contractVersion: "content-proposal.v1", title: "B" },
      ],
    })).rejects.toThrow("content_proposal_result_invalid");
  });

  it("requeues retryable failures only while attempts remain", async () => {
    const { repository, statements } = setup();
    const claimed = await repository.claimContentProposalJob({ workerId: "proposal-worker-1", leaseSeconds: 180 });

    const failed = await repository.failContentProposalJob({
      jobId: claimed!.id,
      workerId: "proposal-worker-1",
      leaseToken: claimed!.leaseToken!,
      errorCode: "proposal_generation_timeout",
      errorMessage: "timeout",
      retryable: true,
    });

    expect(failed.status).toBe("queued");
    expect(statements.some(({ sql }) => sql.includes("attempt_count < max_attempts"))).toBe(true);
  });
});
