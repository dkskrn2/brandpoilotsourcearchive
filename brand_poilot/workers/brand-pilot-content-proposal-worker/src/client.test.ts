import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { ContentProposalApiError, createContentProposalApiClient } from "./client.js";
import { compositionJob, evidence, proposalSet, researchJob } from "./testFixtures.js";

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

  it("sends exact invocation start, parser-invalid terminal, and atomic V2 completion bodies", async () => {
    const job = compositionJob();
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(
      url.endsWith("/start")
        ? { eventSha256: "a".repeat(64) }
        : url.endsWith("/terminal")
          ? { eventSha256: "a".repeat(64), status: "queued" }
          : {
              jobId: job.id, batchId: job.batchId, status: "completed",
              invocationEventSha256: "b".repeat(64), attemptEventSha256: "c".repeat(64),
            },
    ), { status: 200 }));
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
    await client.complete(job, 2, {
      transcriptSha256: "b".repeat(64), outputSha256: "c".repeat(64),
      parserSha256: "d".repeat(64),
      proposalSet: { contractVersion: "content-proposal.v2", proposals: [] } as never,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      workerId: job.workerId, leaseToken: job.leaseToken, modelAttemptId: job.modelAttemptId,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      workerId: job.workerId, leaseToken: job.leaseToken, modelAttemptId: job.modelAttemptId, ...terminal,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      workerId: job.workerId, leaseToken: job.leaseToken, modelAttemptId: job.modelAttemptId,
      invocationOrdinal: 2,
      transcriptSha256: "b".repeat(64), outputSha256: "c".repeat(64),
      parserSha256: "d".repeat(64),
      proposalSet: { contractVersion: "content-proposal.v2", proposals: [] },
    });
  });

  it.each([
    ["extra key", { extra: true }],
    ["wrong status", { status: "processing" }],
    ["uppercase invocation hash", { invocationEventSha256: "B".repeat(64) }],
    ["short attempt hash", { attemptEventSha256: "c".repeat(63) }],
  ])("rejects atomic completion responses with %s", async (_name, override) => {
    const job = compositionJob();
    const client = createContentProposalApiClient(
      "https://api.example", "token",
      vi.fn(async () => new Response(JSON.stringify({
        jobId: job.id, batchId: job.batchId, status: "completed",
        invocationEventSha256: "b".repeat(64), attemptEventSha256: "c".repeat(64),
        ...override,
      }), { status: 200 })) as unknown as typeof fetch,
    );
    await expect(client.complete(job, 1, {
      transcriptSha256: "b".repeat(64), outputSha256: "c".repeat(64),
      parserSha256: "d".repeat(64), proposalSet,
    })).rejects.toThrow("content_proposal_completion_response_invalid");
  });

  it("rejects malformed invocation responses and invalid ordinals before model work", async () => {
    const job = compositionJob();
    const malformed = createContentProposalApiClient(
      "https://api.example", "token",
      vi.fn(async () => new Response(JSON.stringify({ eventSha256: "not-a-sha", extra: true }), { status: 200 })) as unknown as typeof fetch,
    );
    await expect(malformed.startInvocation(job, 1)).rejects.toThrow("content_proposal_invocation_response_invalid");

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ eventSha256: "a".repeat(64) }), { status: 200 }));
    const ordinalClient = createContentProposalApiClient(
      "https://api.example", "token", fetchMock as unknown as typeof fetch,
    );
    await expect(ordinalClient.startInvocation(job, 3 as never))
      .rejects.toThrow("content_proposal_invocation_ordinal_invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects parser-valid terminal requests before transport", async () => {
    const job = compositionJob();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      eventSha256: "a".repeat(64), status: "processing",
    }), { status: 200 }));
    const client = createContentProposalApiClient(
      "https://api.example", "token", fetchMock as unknown as typeof fetch,
    );
    await expect(client.recordInvocationTerminal(job, 1, {
      eventType: "invocation_completed", transcriptSha256: "b".repeat(64),
      outputSha256: "c".repeat(64), parserSha256: "d".repeat(64), parserValid: true,
    } as never)).rejects.toThrow("content_proposal_invocation_terminal_invalid");
    expect(fetchMock).not.toHaveBeenCalled();
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
    expect(mainSource).toContain('boundedNumber("CONTENT_PROPOSAL_LEASE_SECONDS", 180, 30, 300)');
  });
});
