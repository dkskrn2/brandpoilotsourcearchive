import { describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer.js";
import type { ApiRepository } from "./types.js";

const jobId = "10000000-0000-4000-8000-000000000001";

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
    heartbeatContentProposalWorker: vi.fn(async (workerId) => ({ workerId })),
  } as unknown as ApiRepository;
  return {
    app: createServer({
      repository,
      workerApiToken: "generic-worker-token",
      contentProposalWorkerApiToken: "proposal-worker-token",
      logger: false,
    }),
    repository,
  };
}

describe("content proposal worker routes", () => {
  it("rejects the generic worker token when no dedicated proposal-worker token is configured", async () => {
    const { repository } = setup();
    const app = createServer({
      repository,
      workerApiToken: "generic-worker-token",
      logger: false,
    });

    const response = await app.inject({
      method: "POST",
      url: "/worker/content-proposal-jobs/claim",
      headers: { authorization: "Bearer generic-worker-token" },
      payload: { workerId: "proposal-worker-1", leaseSeconds: 180 },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "worker_api_not_configured" });
    expect(repository.claimContentProposalJob).not.toHaveBeenCalled();
  });

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

  it("records an authenticated idle-worker heartbeat with a stable identity", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST",
      url: "/worker/content-proposal-jobs/heartbeat",
      headers: { authorization: "Bearer proposal-worker-token" },
      payload: { workerId: "content-proposal-worker-1" },
    });

    expect(response.statusCode).toBe(200);
    expect(repository.heartbeatContentProposalWorker).toHaveBeenCalledWith(
      "content-proposal-worker-1",
    );
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
      url: `/worker/content-proposal-jobs/${jobId}/heartbeat`,
      headers,
      payload: { ...lease, leaseSeconds: 180 },
    });
    expect(heartbeat.statusCode).toBe(200);

    const complete = await app.inject({
      method: "POST",
      url: `/worker/content-proposal-jobs/${jobId}/complete`,
      headers,
      payload: {
        ...lease,
        proposals: [proposal("A"), proposal("B")],
      },
    });
    expect(complete.statusCode).toBe(200);
    expect(repository.completeContentProposalJob).toHaveBeenCalledWith(expect.objectContaining({
      jobId,
      proposals: expect.any(Array),
    }));

    const failed = await app.inject({
      method: "POST",
      url: `/worker/content-proposal-jobs/${jobId}/fail`,
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
      jobId, retryable: true,
    }));
    await app.close();
  });

  it.each(["heartbeat", "complete", "fail"] as const)(
    "rejects a malformed job UUID on %s before repository access",
    async (route) => {
      const { app, repository } = setup();
      const payload = route === "heartbeat"
        ? {
            workerId: "proposal-worker-1",
            leaseToken: "50000000-0000-4000-8000-000000000005",
            leaseSeconds: 180,
          }
        : route === "complete"
          ? {
              workerId: "proposal-worker-1",
              leaseToken: "50000000-0000-4000-8000-000000000005",
              proposals: [proposal("A"), proposal("B")],
            }
          : {
              workerId: "proposal-worker-1",
              leaseToken: "50000000-0000-4000-8000-000000000005",
              errorCode: "proposal_timeout",
              errorMessage: "timeout",
              retryable: true,
            };
      const response = await app.inject({
        method: "POST",
        url: `/worker/content-proposal-jobs/not-a-uuid/${route}`,
        headers: { authorization: "Bearer proposal-worker-token" },
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "content_proposal_job_id_invalid" });
      expect(repository.heartbeatContentProposalJob).not.toHaveBeenCalled();
      expect(repository.completeContentProposalJob).not.toHaveBeenCalled();
      expect(repository.failContentProposalJob).not.toHaveBeenCalled();
      await app.close();
    },
  );

  it.each(["heartbeat", "complete", "fail"] as const)(
    "rejects a malformed lease-token UUID on %s before repository access",
    async (route) => {
      const { app, repository } = setup();
      const payload = route === "heartbeat"
        ? { workerId: "proposal-worker-1", leaseToken: "not-a-uuid", leaseSeconds: 180 }
        : route === "complete"
          ? {
              workerId: "proposal-worker-1",
              leaseToken: "not-a-uuid",
              proposals: [proposal("A"), proposal("B")],
            }
          : {
              workerId: "proposal-worker-1",
              leaseToken: "not-a-uuid",
              errorCode: "proposal_timeout",
              errorMessage: "timeout",
              retryable: true,
            };
      const response = await app.inject({
        method: "POST",
        url: `/worker/content-proposal-jobs/${jobId}/${route}`,
        headers: { authorization: "Bearer proposal-worker-token" },
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "content_proposal_lease_token_invalid" });
      expect(repository.heartbeatContentProposalJob).not.toHaveBeenCalled();
      expect(repository.completeContentProposalJob).not.toHaveBeenCalled();
      expect(repository.failContentProposalJob).not.toHaveBeenCalled();
      await app.close();
    },
  );

  it("rejects completion outside the 2-3 proposal bound before repository access", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST",
      url: `/worker/content-proposal-jobs/${jobId}/complete`,
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
