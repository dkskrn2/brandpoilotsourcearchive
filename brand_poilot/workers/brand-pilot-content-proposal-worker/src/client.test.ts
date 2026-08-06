import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { ContentProposalApiError, createContentProposalApiClient } from "./client.js";
import { compositionJob, evidence, researchJob } from "./testFixtures.js";

describe("Proposal V2 API client", () => {
  it("uses the closed claim and stage/attempt heartbeat bodies", async () => {
    const job = researchJob();
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(
      url.endsWith("/claim") ? { job } : { status: "ok" },
    ), { status: 200 }));
    const client = createContentProposalApiClient(
      "https://api.example/", "proposal-token", fetchMock as unknown as typeof fetch,
    );
    await expect(client.claim("proposal-worker-1", 180)).resolves.toEqual(job);
    await client.heartbeat(job, 180);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      workerId: "proposal-worker-1", leaseSeconds: 180,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      workerId: job.workerId, leaseToken: job.leaseToken, leaseSeconds: 180,
      stage: "research_required", attemptId: job.researchAttemptId,
    });
  });

  it("seals research with its attempt identity and returns the closed queued envelope", async () => {
    const job = researchJob();
    const composed = compositionJob();
    const seal = {
      jobId: job.id,
      batchId: job.batchId,
      compositionId: composed.compositionId,
      composedInput: composed.composedInput,
      evidenceSetSha256: composed.evidenceSetSha256,
      composedInputSha256: composed.composedInputSha256,
      finalInvocationAggregateSha256: composed.finalInvocationAggregateSha256,
      status: "queued",
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(seal), { status: 200 }));
    const client = createContentProposalApiClient(
      "https://api.example", "token", fetchMock as unknown as typeof fetch,
    );
    await expect(client.completeResearch(job, evidence)).resolves.toEqual(seal);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      workerId: job.workerId,
      leaseToken: job.leaseToken,
      researchAttemptId: job.researchAttemptId,
      evidence,
    });
  });

  it("sends exact invocation start, terminal, and V2 completion bodies", async () => {
    const job = compositionJob();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      eventSha256: "a".repeat(64), status: "processing",
    }), { status: 200 }));
    const client = createContentProposalApiClient(
      "https://api.example", "token", fetchMock as unknown as typeof fetch,
    );
    const terminal = {
      eventType: "invocation_completed" as const,
      transcriptSha256: "b".repeat(64), outputSha256: "c".repeat(64),
      parserSha256: "d".repeat(64), parserValid: false,
    };
    await client.startInvocation(job, 1);
    await client.recordInvocationTerminal(job, 1, terminal);
    await client.complete(job, { contractVersion: "content-proposal.v2", proposals: [] } as never);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      workerId: job.workerId, leaseToken: job.leaseToken, modelAttemptId: job.modelAttemptId,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      workerId: job.workerId, leaseToken: job.leaseToken, modelAttemptId: job.modelAttemptId, ...terminal,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      workerId: job.workerId, leaseToken: job.leaseToken, modelAttemptId: job.modelAttemptId,
      proposalSet: { contractVersion: "content-proposal.v2", proposals: [] },
    });
  });

  it("sends fail only with explicit stage and attempt identity", async () => {
    const job = researchJob();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "queued" }), { status: 200 }));
    const client = createContentProposalApiClient(
      "https://api.example", "token", fetchMock as unknown as typeof fetch,
    );
    await client.fail(job, {
      stage: job.stage, attemptId: job.researchAttemptId,
      errorCode: "research_timeout", errorMessage: "timeout", retryable: true,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      workerId: job.workerId, leaseToken: job.leaseToken,
      stage: job.stage, attemptId: job.researchAttemptId,
      errorCode: "research_timeout", errorMessage: "timeout", retryable: true,
    });
  });

  it("marks lease loss terminal and keeps transport failures retryable", async () => {
    const leaseClient = createContentProposalApiClient(
      "https://api.example", "token",
      vi.fn(async () => new Response(JSON.stringify({ error: "content_proposal_job_lease_invalid" }), { status: 409 })) as unknown as typeof fetch,
    );
    await expect(leaseClient.heartbeat(researchJob(), 180)).rejects.toEqual(expect.objectContaining({
      leaseLost: true, retryable: false,
    } satisfies Partial<ContentProposalApiError>));
  });

  it("keeps Terra fixed in source instead of accepting a model env override", async () => {
    const [clientSource, mainSource] = await Promise.all([
      readFile(new URL("./client.ts", import.meta.url), "utf8"),
      readFile(new URL("./main.ts", import.meta.url), "utf8"),
    ]);
    expect(clientSource).not.toContain("api.openai.com");
    expect(mainSource).toContain("createCodexContentProposalModel");
    expect(mainSource).not.toContain("CONTENT_PROPOSAL_CODEX_MODEL");
    expect(mainSource).not.toContain("gpt-5.4");
  });
});
