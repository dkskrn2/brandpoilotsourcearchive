import { describe, expect, it, vi } from "vitest";
import { ContentProposalApiError } from "./client.js";
import type { ContentProposalModelResult } from "./codexModel.js";
import type { ContentProposalWorkerClient } from "./contracts.js";
import {
  createContentProposalRunner,
  processContentProposalJob,
  runContentProposalOnce,
  runContentProposalWatchIteration,
} from "./worker.js";
import { compositionJob, evidence, proposalSet, researchJob } from "./testFixtures.js";

function api(overrides: Partial<ContentProposalWorkerClient> = {}): ContentProposalWorkerClient {
  return {
    heartbeatWorker: vi.fn(async () => undefined),
    claim: vi.fn(async () => null),
    heartbeat: vi.fn(async () => undefined),
    completeResearch: vi.fn(async () => { throw new Error("unexpected_research"); }),
    startInvocation: vi.fn(async () => ({ eventSha256: "a".repeat(64) })),
    recordInvocationTerminal: vi.fn(async () => ({ eventSha256: "a".repeat(64), status: "processing" })),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
    ...overrides,
  };
}

function generated(output: unknown, rawOutput = JSON.stringify(output)): ContentProposalModelResult {
  return {
    output, rawOutput, syntaxValid: true,
    transcriptSha256: "e".repeat(64), outputSha256: "f".repeat(64),
  };
}

describe("Proposal V2 staged worker", () => {
  it("seals research and stops before any model or invocation call", async () => {
    const job = researchJob();
    const client = api({
      completeResearch: vi.fn(async () => ({ status: "queued" } as never)),
    });
    const model = { generate: vi.fn(async () => generated(proposalSet)) };
    await expect(processContentProposalJob({
      client,
      research: { run: vi.fn(async () => evidence) },
      runner: createContentProposalRunner(model),
      job, leaseSeconds: 180, heartbeatMs: 100_000,
    })).resolves.toEqual({ status: "research_completed", jobId: job.id });
    expect(client.completeResearch).toHaveBeenCalledWith(job, evidence);
    expect(client.startInvocation).not.toHaveBeenCalled();
    expect(model.generate).not.toHaveBeenCalled();
    expect(client.complete).not.toHaveBeenCalled();
  });

  it("records start before spawn, terminal after parse, and then completes", async () => {
    const job = compositionJob();
    const order: string[] = [];
    const client = api({
      startInvocation: vi.fn(async () => { order.push("start:1"); return { eventSha256: "a".repeat(64) }; }),
      recordInvocationTerminal: vi.fn(async (_job, ordinal, terminal) => {
        order.push(`terminal:${ordinal}:${terminal.parserValid}`);
        return { eventSha256: "a".repeat(64), status: "processing" };
      }),
      complete: vi.fn(async () => { order.push("complete"); }),
    });
    const model = { generate: vi.fn(async () => { order.push("model:1"); return generated(proposalSet); }) };
    await expect(processContentProposalJob({
      client, runner: createContentProposalRunner(model), job,
      leaseSeconds: 180, heartbeatMs: 100_000,
    })).resolves.toEqual({ status: "completed", jobId: job.id });
    expect(order).toEqual(["start:1", "model:1", "terminal:1:true", "complete"]);
    expect(client.fail).not.toHaveBeenCalled();
  });

  it("allows ordinal 2 only after ordinal 1 completed parser-invalid and never makes a third call", async () => {
    const job = compositionJob();
    const invalid = { contractVersion: "content-proposal.v2", proposals: [] };
    const order: string[] = [];
    const client = api({
      startInvocation: vi.fn(async (_job, ordinal) => {
        order.push(`start:${ordinal}`);
        return { eventSha256: "a".repeat(64) };
      }),
      recordInvocationTerminal: vi.fn(async (_job, ordinal, terminal) => {
        order.push(`terminal:${ordinal}:${terminal.parserValid}`);
        return { eventSha256: "a".repeat(64), status: "processing" };
      }),
      complete: vi.fn(async () => { order.push("complete"); }),
    });
    const model = {
      generate: vi.fn()
        .mockImplementationOnce(async () => { order.push("model:1"); return generated(invalid); })
        .mockImplementationOnce(async () => { order.push("model:2"); return generated(proposalSet); }),
    };
    await processContentProposalJob({
      client, runner: createContentProposalRunner(model), job,
      leaseSeconds: 180, heartbeatMs: 100_000,
    });
    expect(order).toEqual([
      "start:1", "model:1", "terminal:1:false",
      "start:2", "model:2", "terminal:2:true", "complete",
    ]);
    expect(model.generate).toHaveBeenCalledTimes(2);
    expect(model.generate.mock.calls[1]?.[0]).toContain("이번이 유일한 보정 기회다");
    expect(client.fail).not.toHaveBeenCalled();
  });

  it("stops after two parser-invalid completed invocations without fail or padding", async () => {
    const job = compositionJob();
    const model = { generate: vi.fn(async () => generated({ contractVersion: "content-proposal.v2", proposals: [] })) };
    const client = api();
    await expect(processContentProposalJob({
      client, runner: createContentProposalRunner(model), job,
      leaseSeconds: 180, heartbeatMs: 100_000,
    })).resolves.toEqual({ status: "failed", jobId: job.id });
    expect(model.generate).toHaveBeenCalledTimes(2);
    expect(client.recordInvocationTerminal).toHaveBeenCalledTimes(2);
    expect(client.complete).not.toHaveBeenCalled();
    expect(client.fail).not.toHaveBeenCalled();
  });

  it("records indeterminate after a started timeout and never retries or calls fail", async () => {
    const job = compositionJob();
    const error = Object.assign(new Error("content_proposal_model_timeout"), {
      outcome: "indeterminate", transcriptSha256: "a".repeat(64),
    });
    const model = { generate: vi.fn(async () => { throw error; }) };
    const client = api();
    await expect(processContentProposalJob({
      client, runner: createContentProposalRunner(model), job,
      leaseSeconds: 180, heartbeatMs: 100_000,
    })).resolves.toEqual({ status: "failed", jobId: job.id });
    expect(client.recordInvocationTerminal).toHaveBeenCalledWith(job, 1, {
      eventType: "invocation_indeterminate", transcriptSha256: "a".repeat(64),
      outputSha256: null, parserSha256: null, parserValid: null,
    });
    expect(model.generate).toHaveBeenCalledTimes(1);
    expect(client.fail).not.toHaveBeenCalled();
  });

  it("does not spawn or fail when ordinal 2 start has an uncertain transport result", async () => {
    const job = compositionJob();
    const client = api({
      startInvocation: vi.fn()
        .mockResolvedValueOnce({ eventSha256: "a".repeat(64) })
        .mockRejectedValueOnce(new ContentProposalApiError("content_proposal_api_timeout", 0)),
    });
    const model = { generate: vi.fn(async () => generated({ contractVersion: "content-proposal.v2", proposals: [] })) };
    await expect(processContentProposalJob({
      client, runner: createContentProposalRunner(model), job,
      leaseSeconds: 180, heartbeatMs: 100_000,
    })).resolves.toEqual({ status: "failed", jobId: job.id });
    expect(model.generate).toHaveBeenCalledTimes(1);
    expect(client.fail).not.toHaveBeenCalled();
  });

  it("uses fail only for research/pre-invocation failures with explicit identity", async () => {
    const job = researchJob();
    const client = api();
    await processContentProposalJob({
      client,
      research: { run: vi.fn(async () => { throw new Error("research_timeout"); }) },
      runner: createContentProposalRunner({ generate: vi.fn() }),
      job, leaseSeconds: 180, heartbeatMs: 100_000,
    });
    expect(client.fail).toHaveBeenCalledWith(job, expect.objectContaining({
      stage: "research_required", attemptId: job.researchAttemptId,
      errorCode: "research_timeout", retryable: true,
    }));
  });
});

describe("Proposal worker loop", () => {
  it("does not claim after graceful shutdown and keeps transient watch failures alive", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = api({ claim: vi.fn(async () => null) });
    await expect(runContentProposalOnce({
      client, runner: createContentProposalRunner({ generate: vi.fn() }), workerId: "worker",
      leaseSeconds: 180, signal: controller.signal,
    })).resolves.toEqual({ status: "stopped" });
    expect(client.claim).not.toHaveBeenCalled();

    const wait = vi.fn(async () => undefined);
    await expect(runContentProposalWatchIteration({
      runOnce: vi.fn(async () => { throw new ContentProposalApiError("timeout", 0); }),
      pollMs: 1_000, wait,
    })).resolves.toEqual({ status: "retrying" });
    expect(wait).toHaveBeenCalledWith(1_000, undefined);
  });
});
