import { describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer.js";
import type { ApiRepository } from "./types.js";

const jobId = "10000000-0000-4000-8000-000000000001";
const leaseToken = "50000000-0000-4000-8000-000000000005";
const researchAttemptId = "60000000-0000-4000-8000-000000000006";
const modelAttemptId = "80000000-0000-4000-8000-000000000008";
const sha = "a".repeat(64);

function workerEvidence() {
  return {
    contractVersion: "research-evidence.v1",
    decision: "searched",
    reason: "최신 근거 필요",
    queries: ["브랜드 운영"],
    capturedAt: "2026-08-01T04:00:00.000Z",
    items: [{
      id: "70000000-0000-4000-8000-000000000007",
      title: "검증 자료", url: "https://source.example/article", publisher: "Source",
      publishedAt: null, capturedAt: "2026-08-01T04:00:00.000Z",
      claimSummary: "실무 적용 근거", contentHash: sha,
    }],
  };
}

function workerProposal(conceptKey: string) {
  const suffix = conceptKey.at(-1)!;
  return {
    conceptKey, title: `구성안 ${suffix}`, informationalType: "how_to",
    oneLineIntent: `의도 ${suffix}`, differentiator: `차별점 ${suffix}`,
    differentiationAxes: ["narrative"], target: "창업자", customerContext: "운영 시작",
    keyMessage: `메시지 ${suffix}`, hook: `훅 ${suffix}`, selectionReason: `이유 ${suffix}`,
    evidenceIds: ["70000000-0000-4000-8000-000000000007"], referenceIds: [],
    outputFormat: "card_news", channelTargets: ["instagram"], assetCount: 1,
    outline: [{ index: 1, role: "hook", headline: `제목 ${suffix}`, purpose: `목적 ${suffix}` }],
    purposeDetails: {
      kind: "informational", question: `질문 ${suffix}`, value: `가치 ${suffix}`,
      whyNow: `시점 ${suffix}`, learningPoints: [`학습 ${suffix}`],
    },
  };
}

function workerProposalSet() {
  return {
    contractVersion: "content-proposal.v2",
    proposals: [workerProposal("concept-a"), workerProposal("concept-b"), workerProposal("concept-c")],
  };
}

function setup() {
  const repository = {
    claimContentProposalJob: vi.fn(async () => null),
    heartbeatContentProposalJob: vi.fn(async () => true),
    completeContentProposalResearch: vi.fn(async () => ({
      jobId, batchId: "40000000-0000-4000-8000-000000000004", status: "queued" as const,
      compositionId: "90000000-0000-4000-8000-000000000009",
      composedInput: { contractVersion: "proposal-input.v2" },
      evidenceSetSha256: sha, composedInputSha256: sha, finalInvocationAggregateSha256: sha,
    })),
    startContentProposalInvocation: vi.fn(async () => ({ eventSha256: sha })),
    recordContentProposalInvocationTerminal: vi.fn(async () => ({ eventSha256: sha, status: "processing" as const })),
    completeContentProposalJob: vi.fn(async () => ({
      jobId, batchId: "40000000-0000-4000-8000-000000000004", status: "completed" as const,
      invocationEventSha256: sha, attemptEventSha256: sha,
    })),
    failContentProposalJob: vi.fn(async () => ({
      id: jobId, batchId: "40000000-0000-4000-8000-000000000004", status: "queued" as const,
    })),
    heartbeatContentProposalWorker: vi.fn(async (workerId) => ({ workerId })),
  };
  return {
    app: createServer({
      repository: repository as unknown as ApiRepository,
      workerApiToken: "generic-worker-token",
      contentProposalWorkerApiToken: "proposal-worker-token",
      logger: false,
    }),
    repository,
  };
}

const headers = { authorization: "Bearer proposal-worker-token" };
const lease = { workerId: "proposal-worker-1", leaseToken };

describe("content proposal worker V2-only routes", () => {
  it("rejects the generic worker token when the dedicated proposal token is absent", async () => {
    const { repository } = setup();
    const app = createServer({
      repository: repository as unknown as ApiRepository,
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
    await app.close();
  });

  it("requires the dedicated worker token", async () => {
    const { app, repository } = setup();
    const response = await app.inject({ method: "POST", url: "/worker/content-proposal-jobs/claim", payload: { workerId: "proposal-worker-1" } });
    expect(response.statusCode).toBe(401);
    expect(repository.claimContentProposalJob).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects client tenant identifiers on the exact claim body", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST", url: "/worker/content-proposal-jobs/claim", headers,
      payload: { workerId: "proposal-worker-1", leaseSeconds: 180, workspaceId: "attacker" },
    });
    expect(response.statusCode).toBe(400);
    expect(repository.claimContentProposalJob).not.toHaveBeenCalled();
    await app.close();
  });

  it("requires both exact claim fields", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST", url: "/worker/content-proposal-jobs/claim", headers,
      payload: { workerId: "proposal-worker-1" },
    });
    expect(response.statusCode).toBe(400);
    expect(repository.claimContentProposalJob).not.toHaveBeenCalled();
    await app.close();
  });

  it("records an authenticated idle-worker heartbeat", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST",
      url: "/worker/content-proposal-jobs/heartbeat",
      headers,
      payload: { workerId: "proposal-worker-1" },
    });
    expect(response.statusCode).toBe(200);
    expect(repository.heartbeatContentProposalWorker).toHaveBeenCalledWith("proposal-worker-1");
    await app.close();
  });

  it("rejects proposal leases longer than the five-minute protocol maximum", async () => {
    const { app, repository } = setup();
    const claim = await app.inject({
      method: "POST",
      url: "/worker/content-proposal-jobs/claim",
      headers,
      payload: { workerId: "proposal-worker-1", leaseSeconds: 301 },
    });
    const heartbeat = await app.inject({
      method: "POST",
      url: `/worker/content-proposal-jobs/${jobId}/heartbeat`,
      headers,
      payload: {
        ...lease,
        leaseSeconds: 301,
        stage: "research_required",
        attemptId: researchAttemptId,
      },
    });
    expect(claim.statusCode).toBe(400);
    expect(heartbeat.statusCode).toBe(400);
    expect(repository.claimContentProposalJob).not.toHaveBeenCalled();
    expect(repository.heartbeatContentProposalJob).not.toHaveBeenCalled();
    await app.close();
  });

  it("accepts the one-second proposal lease protocol minimum", async () => {
    const { app, repository } = setup();
    const claim = await app.inject({
      method: "POST",
      url: "/worker/content-proposal-jobs/claim",
      headers,
      payload: { workerId: "proposal-worker-1", leaseSeconds: 1 },
    });
    const heartbeat = await app.inject({
      method: "POST",
      url: `/worker/content-proposal-jobs/${jobId}/heartbeat`,
      headers,
      payload: {
        ...lease,
        leaseSeconds: 1,
        stage: "research_required",
        attemptId: researchAttemptId,
      },
    });
    expect(claim.statusCode).toBe(200);
    expect(heartbeat.statusCode).toBe(200);
    expect(repository.claimContentProposalJob).toHaveBeenCalledWith({
      workerId: "proposal-worker-1",
      leaseSeconds: 1,
    });
    expect(repository.heartbeatContentProposalJob).toHaveBeenCalledWith(expect.objectContaining({ leaseSeconds: 1 }));
    await app.close();
  });

  it.each([
    ["claim", "/worker/content-proposal-jobs/claim", { workerId: "proposal-worker-1", leaseSeconds: "180" }],
    ["claim", "/worker/content-proposal-jobs/claim", { workerId: "proposal-worker-1", leaseSeconds: true }],
    ["heartbeat", `/worker/content-proposal-jobs/${jobId}/heartbeat`, {
      ...lease, leaseSeconds: "180", stage: "research_required", attemptId: researchAttemptId,
    }],
    ["heartbeat", `/worker/content-proposal-jobs/${jobId}/heartbeat`, {
      ...lease, leaseSeconds: true, stage: "research_required", attemptId: researchAttemptId,
    }],
  ])("rejects non-number leaseSeconds on %s", async (_route, url, payload) => {
    const { app, repository } = setup();
    const response = await app.inject({ method: "POST", url, headers, payload });
    expect(response.statusCode).toBe(400);
    expect(repository.claimContentProposalJob).not.toHaveBeenCalled();
    expect(repository.heartbeatContentProposalJob).not.toHaveBeenCalled();
    await app.close();
  });

  it("requires stage and attempt identity on a lease heartbeat", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST", url: `/worker/content-proposal-jobs/${jobId}/heartbeat`, headers,
      payload: { ...lease, leaseSeconds: 180, stage: "research_required", attemptId: researchAttemptId },
    });
    expect(response.statusCode).toBe(200);
    expect(repository.heartbeatContentProposalJob).toHaveBeenCalledWith({
      jobId, ...lease, leaseSeconds: 180, stage: "research_required", attemptId: researchAttemptId,
    });
    await app.close();
  });

  it("seals research using the exact research-attempt identity", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST", url: `/worker/content-proposal-jobs/${jobId}/research-complete`, headers,
      payload: { ...lease, researchAttemptId, evidence: workerEvidence() },
    });
    expect(response.statusCode).toBe(200);
    expect(repository.completeContentProposalResearch).toHaveBeenCalledWith({
      jobId, ...lease, researchAttemptId, evidence: workerEvidence(),
    });
    await app.close();
  });

  it("records invocation start and terminal events with exact closed bodies", async () => {
    const { app, repository } = setup();
    const started = await app.inject({
      method: "POST", url: `/worker/content-proposal-jobs/${jobId}/invocations/1/start`, headers,
      payload: { ...lease, modelAttemptId },
    });
    expect(started.statusCode).toBe(200);
    expect(repository.startContentProposalInvocation).toHaveBeenCalledWith({
      jobId, ...lease, modelAttemptId, invocationOrdinal: 1,
    });

    const terminal = await app.inject({
      method: "POST", url: `/worker/content-proposal-jobs/${jobId}/invocations/1/terminal`, headers,
      payload: {
        ...lease, modelAttemptId, eventType: "invocation_completed",
        transcriptSha256: sha, outputSha256: sha, parserSha256: sha, parserValid: false,
      },
    });
    expect(terminal.statusCode).toBe(200);
    expect(repository.recordContentProposalInvocationTerminal).toHaveBeenCalledWith({
      jobId, ...lease, modelAttemptId, invocationOrdinal: 1,
      eventType: "invocation_completed", transcriptSha256: sha,
      outputSha256: sha, parserSha256: sha, parserValid: false,
    });
    await app.close();
  });

  it("returns conflict when an invocation may already have started", async () => {
    const { app, repository } = setup();
    repository.startContentProposalInvocation.mockRejectedValueOnce(
      new Error("content_proposal_invocation_already_started"),
    );
    const response = await app.inject({
      method: "POST",
      url: `/worker/content-proposal-jobs/${jobId}/invocations/1/start`,
      headers,
      payload: { ...lease, modelAttemptId },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "content_proposal_invocation_already_started" });
    await app.close();
  });

  it("accepts only Proposal V2 completion with model-attempt identity", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST", url: `/worker/content-proposal-jobs/${jobId}/complete`, headers,
      payload: {
        ...lease, modelAttemptId, invocationOrdinal: 1,
        transcriptSha256: sha, outputSha256: sha, parserSha256: sha,
        proposalSet: workerProposalSet(),
      },
    });
    expect(response.statusCode).toBe(200);
    expect(repository.completeContentProposalJob).toHaveBeenCalledWith({
      jobId, ...lease, modelAttemptId, invocationOrdinal: 1,
      transcriptSha256: sha, outputSha256: sha, parserSha256: sha,
      proposalSet: workerProposalSet(),
    });

    const v1 = await app.inject({
      method: "POST", url: `/worker/content-proposal-jobs/${jobId}/complete`, headers,
      payload: { ...lease, proposals: [{ contractVersion: "content-proposal.v1" }] },
    });
    expect(v1.statusCode).toBe(400);
    expect(repository.completeContentProposalJob).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it.each(["1", true])("rejects non-number completion invocationOrdinal %j", async (invocationOrdinal) => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST", url: `/worker/content-proposal-jobs/${jobId}/complete`, headers,
      payload: {
        ...lease, modelAttemptId, invocationOrdinal,
        transcriptSha256: sha, outputSha256: sha, parserSha256: sha,
        proposalSet: workerProposalSet(),
      },
    });
    expect(response.statusCode).toBe(400);
    expect(repository.completeContentProposalJob).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects the legacy split success terminal before repository access", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST",
      url: `/worker/content-proposal-jobs/${jobId}/invocations/1/terminal`,
      headers,
      payload: {
        ...lease, modelAttemptId, eventType: "invocation_completed",
        transcriptSha256: sha, outputSha256: sha, parserSha256: sha, parserValid: true,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(repository.recordContentProposalInvocationTerminal).not.toHaveBeenCalled();
    await app.close();
  });

  it("allows fail only with an explicit stage and attempt identity", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST", url: `/worker/content-proposal-jobs/${jobId}/fail`, headers,
      payload: {
        ...lease, stage: "research_required", attemptId: researchAttemptId,
        errorCode: "research_timeout", errorMessage: "timeout", retryable: true,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(repository.failContentProposalJob).toHaveBeenCalledWith({
      jobId, ...lease, stage: "research_required", attemptId: researchAttemptId,
      errorCode: "research_timeout", errorMessage: "timeout", retryable: true,
    });
    await app.close();
  });

  it.each([
    ["research-complete", { ...lease, researchAttemptId, evidence: workerEvidence(), extra: true }],
    ["complete", {
      ...lease, modelAttemptId, invocationOrdinal: 1,
      transcriptSha256: sha, outputSha256: sha, parserSha256: sha,
      proposalSet: workerProposalSet(), extra: true,
    }],
    ["invocations/1/start", { ...lease, modelAttemptId, extra: true }],
  ])("rejects inexact %s bodies before repository access", async (route, payload) => {
    const { app } = setup();
    const response = await app.inject({ method: "POST", url: `/worker/content-proposal-jobs/${jobId}/${route}`, headers, payload });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("rejects a missing invocation body as a closed-contract client error", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST",
      url: `/worker/content-proposal-jobs/${jobId}/invocations/1/start`,
      headers,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "content_proposal_invocation_start_invalid" });
    expect(repository.startContentProposalInvocation).not.toHaveBeenCalled();
    await app.close();
  });

  const routeCases = [
    ["heartbeat", {
      ...lease, leaseSeconds: 180, stage: "research_required", attemptId: researchAttemptId,
    }],
    ["research-complete", { ...lease, researchAttemptId, evidence: workerEvidence() }],
    ["invocations/1/start", { ...lease, modelAttemptId }],
    ["invocations/1/terminal", {
      ...lease, modelAttemptId, eventType: "invocation_completed",
      transcriptSha256: sha, outputSha256: sha, parserSha256: sha, parserValid: false,
    }],
    ["complete", {
      ...lease, modelAttemptId, invocationOrdinal: 1,
      transcriptSha256: sha, outputSha256: sha, parserSha256: sha,
      proposalSet: workerProposalSet(),
    }],
    ["fail", {
      ...lease, stage: "research_required", attemptId: researchAttemptId,
      errorCode: "research_timeout", errorMessage: "timeout", retryable: true,
    }],
  ] as const;

  it.each(routeCases)("rejects a malformed job UUID on %s before repository access", async (route, payload) => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST",
      url: `/worker/content-proposal-jobs/not-a-uuid/${route}`,
      headers,
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "content_proposal_job_id_invalid" });
    expect(repository.claimContentProposalJob).not.toHaveBeenCalled();
    expect(repository.heartbeatContentProposalJob).not.toHaveBeenCalled();
    expect(repository.completeContentProposalResearch).not.toHaveBeenCalled();
    expect(repository.startContentProposalInvocation).not.toHaveBeenCalled();
    expect(repository.recordContentProposalInvocationTerminal).not.toHaveBeenCalled();
    expect(repository.completeContentProposalJob).not.toHaveBeenCalled();
    expect(repository.failContentProposalJob).not.toHaveBeenCalled();
    await app.close();
  });

  it.each(routeCases)("rejects a malformed lease UUID on %s before repository access", async (route, payload) => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST",
      url: `/worker/content-proposal-jobs/${jobId}/${route}`,
      headers,
      payload: { ...payload, leaseToken: "not-a-uuid" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "content_proposal_lease_token_invalid" });
    expect(repository.heartbeatContentProposalJob).not.toHaveBeenCalled();
    expect(repository.completeContentProposalResearch).not.toHaveBeenCalled();
    expect(repository.startContentProposalInvocation).not.toHaveBeenCalled();
    expect(repository.recordContentProposalInvocationTerminal).not.toHaveBeenCalled();
    expect(repository.completeContentProposalJob).not.toHaveBeenCalled();
    expect(repository.failContentProposalJob).not.toHaveBeenCalled();
    await app.close();
  });
});
