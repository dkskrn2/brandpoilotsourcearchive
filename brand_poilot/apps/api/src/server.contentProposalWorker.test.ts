import { describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer.js";
import type { ApiRepository } from "./types.js";

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
  const repository = {
    claimContentProposalJob: vi.fn(async (input) => ({
      id: "10000000-0000-4000-8000-000000000001",
      workspaceId: "20000000-0000-4000-8000-000000000002",
      brandId: "30000000-0000-4000-8000-000000000003",
      batchId: "40000000-0000-4000-8000-000000000004",
      status: "processing" as const,
      request: {},
      sourceSnapshots: [],
      attemptCount: 1,
      maxAttempts: 3,
      workerId: input.workerId,
      leaseToken: "50000000-0000-4000-8000-000000000005",
      leaseExpiresAt: "2026-07-28T00:03:00.000Z",
      availableAt: "2026-07-28T00:00:00.000Z",
    })),
    heartbeatContentProposalJob: vi.fn(async () => true),
    completeContentProposalJob: vi.fn(async () => ({
      id: "10000000-0000-4000-8000-000000000001",
      batchId: "40000000-0000-4000-8000-000000000004",
      status: "completed" as const,
    })),
    failContentProposalJob: vi.fn(async () => ({
      id: "10000000-0000-4000-8000-000000000001",
      batchId: "40000000-0000-4000-8000-000000000004",
      status: "queued" as const,
    })),
  } as unknown as ApiRepository;
  return {
    app: createServer({ repository, workerApiToken: "proposal-worker-token", logger: false }),
    repository,
  };
}

describe("content proposal worker routes", () => {
  it("requires the dedicated worker token", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST",
      url: "/worker/content-proposal-jobs/claim",
      payload: { workerId: "proposal-worker-1", leaseSeconds: 180 },
    });
    expect(response.statusCode).toBe(401);
    expect(repository.claimContentProposalJob).not.toHaveBeenCalled();
    await app.close();
  });

  it("claims without accepting client tenant identifiers", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST",
      url: "/worker/content-proposal-jobs/claim",
      headers: { authorization: "Bearer proposal-worker-token" },
      payload: {
        workerId: "proposal-worker-1",
        leaseSeconds: 180,
        workspaceId: "attacker-workspace",
        brandId: "attacker-brand",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(repository.claimContentProposalJob).toHaveBeenCalledWith({
      workerId: "proposal-worker-1",
      leaseSeconds: 180,
    });
    await app.close();
  });

  it("forwards heartbeat, bounded completion, and retryable failure leases", async () => {
    const { app, repository } = setup();
    const headers = { authorization: "Bearer proposal-worker-token" };
    const lease = {
      workerId: "proposal-worker-1",
      leaseToken: "50000000-0000-4000-8000-000000000005",
    };
    const heartbeat = await app.inject({
      method: "POST",
      url: "/worker/content-proposal-jobs/job-1/heartbeat",
      headers,
      payload: { ...lease, leaseSeconds: 180 },
    });
    expect(heartbeat.statusCode).toBe(200);

    const complete = await app.inject({
      method: "POST",
      url: "/worker/content-proposal-jobs/job-1/complete",
      headers,
      payload: {
        ...lease,
        proposals: [proposal("A"), proposal("B")],
      },
    });
    expect(complete.statusCode).toBe(200);
    expect(repository.completeContentProposalJob).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "job-1",
      proposals: expect.any(Array),
    }));

    const failed = await app.inject({
      method: "POST",
      url: "/worker/content-proposal-jobs/job-1/fail",
      headers,
      payload: {
        ...lease,
        errorCode: "proposal_timeout",
        errorMessage: "timeout",
        retryable: true,
      },
    });
    expect(failed.statusCode).toBe(200);
    expect(repository.failContentProposalJob).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "job-1", retryable: true,
    }));
    await app.close();
  });

  it("rejects completion outside the 2-3 proposal bound before repository access", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST",
      url: "/worker/content-proposal-jobs/job-1/complete",
      headers: { authorization: "Bearer proposal-worker-token" },
      payload: {
        workerId: "proposal-worker-1",
        leaseToken: "50000000-0000-4000-8000-000000000005",
        proposals: [{ contractVersion: "content-proposal.v1" }],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(repository.completeContentProposalJob).not.toHaveBeenCalled();
    await app.close();
  });
});
