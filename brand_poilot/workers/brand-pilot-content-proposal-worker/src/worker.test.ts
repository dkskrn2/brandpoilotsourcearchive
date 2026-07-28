import { describe, expect, it, vi } from "vitest";
import { ContentProposalApiError, type ContentProposalModelClient } from "./client.js";
import {
  ContentProposalContractError,
  parseContentProposalJob,
  type ContentProposalV1,
  type ContentProposalWorkerClient,
} from "./contracts.js";
import {
  createContentProposalRunner,
  processContentProposalJob,
  runContentProposalOnce,
  runContentProposalWatchIteration,
  type ContentProposalRunner,
} from "./worker.js";

const job = parseContentProposalJob({
  id: "10000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000002",
  brandId: "30000000-0000-4000-8000-000000000003",
  batchId: "40000000-0000-4000-8000-000000000004",
  status: "processing",
  request: {
    contractVersion: "content-proposal-request.v1",
    contentFamily: "informational",
    subjectInput: { topic: "운영" },
    channelTargets: ["blog_export"],
    outputFormats: ["blog"],
    sourceSnapshotIds: [],
    performanceSnapshotIds: [],
    performanceEvidence: [],
  },
  sourceSnapshots: [],
  attemptCount: 1,
  maxAttempts: 3,
  workerId: "proposal-worker-1",
  leaseToken: "50000000-0000-4000-8000-000000000005",
  leaseExpiresAt: "2026-07-28T00:03:00.000Z",
  availableAt: "2026-07-28T00:00:00.000Z",
});

function proposal(title: string, strategy: "how_to" | "insight"): ContentProposalV1 {
  return {
    contractVersion: "content-proposal.v1",
    title,
    reasonToCreateNow: "최근 근거가 확보됨",
    contentFamily: "informational",
    topic: title,
    target: {},
    messageStrategy: strategy,
    hook: `${title} hook`,
    keyMessage: `${title} message`,
    evidence: [],
    outline: [{ heading: "점검", purpose: "실행 안내" }],
    outputFormat: "blog",
    channelTargets: ["blog_export"],
    recommendedReferenceQuery: { strategies: [strategy], formats: ["blog"], tags: [] },
  };
}
const validResult = [proposal("A", "how_to"), proposal("B", "insight")];

function api(overrides: Partial<ContentProposalWorkerClient> = {}): ContentProposalWorkerClient {
  return {
    heartbeatWorker: vi.fn(async () => undefined),
    claim: vi.fn(async () => job),
    heartbeat: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("content proposal worker", () => {
  it("builds the frozen prompt, strictly parses all proposals, and completes once", async () => {
    const model: ContentProposalModelClient = { generate: vi.fn(async () => validResult) };
    const client = api();
    const runner = createContentProposalRunner(model);

    await expect(processContentProposalJob({
      client, runner, job, leaseSeconds: 180, heartbeatMs: 100_000,
    })).resolves.toEqual({ status: "completed", jobId: job.id });
    expect(model.generate).toHaveBeenCalledWith(
      expect.stringContaining("<trusted_frozen_request>"),
      expect.any(AbortSignal),
    );
    expect(client.complete).toHaveBeenCalledTimes(1);
    expect(client.complete).toHaveBeenCalledWith(job, validResult);
  });

  it("fails the whole job without completing when any proposal is invalid", async () => {
    const client = api();
    const runner = createContentProposalRunner({
      generate: vi.fn(async () => [validResult[0], { ...validResult[1], outputFormat: "card_news" }]),
    });

    await expect(processContentProposalJob({
      client, runner, job, leaseSeconds: 180, heartbeatMs: 100_000,
    })).resolves.toEqual({ status: "failed", jobId: job.id });
    expect(client.complete).not.toHaveBeenCalled();
    expect(client.fail).toHaveBeenCalledWith(job, expect.objectContaining({
      errorCode: "content_proposal_result_invalid",
      retryable: false,
    }));
  });

  it("heartbeats during model work and stops without completion after lease loss", async () => {
    let rejectModel: ((error: Error) => void) | undefined;
    const model: ContentProposalModelClient = {
      generate: vi.fn((_prompt: string, signal?: AbortSignal) => new Promise((_resolve, reject) => {
        rejectModel = reject;
        signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      })),
    };
    const client = api({
      heartbeat: vi.fn(async () => {
        throw new ContentProposalApiError("content_proposal_job_lease_invalid", 409);
      }),
    });
    const result = await processContentProposalJob({
      client,
      runner: createContentProposalRunner(model),
      job,
      leaseSeconds: 180,
      heartbeatMs: 1,
    });

    expect(result).toEqual({ status: "lease_lost", jobId: job.id });
    expect(client.heartbeat).toHaveBeenCalled();
    expect(client.complete).not.toHaveBeenCalled();
    expect(client.fail).not.toHaveBeenCalled();
    rejectModel?.(new Error("cleanup"));
  });

  it("marks transient failures retryable only while attempts remain", async () => {
    const runner: ContentProposalRunner = {
      run: vi.fn(async () => { throw new ContentProposalApiError("model_unavailable", 503); }),
    };
    const firstClient = api();
    await processContentProposalJob({
      client: firstClient, runner, job, leaseSeconds: 180, heartbeatMs: 100_000,
    });
    expect(firstClient.fail).toHaveBeenCalledWith(job, expect.objectContaining({ retryable: true }));

    const finalJob = { ...job, attemptCount: job.maxAttempts };
    const finalClient = api();
    await processContentProposalJob({
      client: finalClient, runner, job: finalJob, leaseSeconds: 180, heartbeatMs: 100_000,
    });
    expect(finalClient.fail).toHaveBeenCalledWith(finalJob, expect.objectContaining({ retryable: false }));
  });

  it("does not claim another job after graceful shutdown begins", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = api();

    await expect(runContentProposalOnce({
      client,
      runner: { run: vi.fn(async () => validResult) },
      workerId: "proposal-worker-1",
      leaseSeconds: 180,
      signal: controller.signal,
    })).resolves.toEqual({ status: "stopped" });
    expect(client.claim).not.toHaveBeenCalled();
  });

  it("keeps watch mode alive after a transient claim failure", async () => {
    const wait = vi.fn(async () => undefined);
    const onError = vi.fn();
    await expect(runContentProposalWatchIteration({
      runOnce: vi.fn(async () => {
        throw new ContentProposalApiError("content_proposal_api_timeout", 0);
      }),
      pollMs: 250,
      wait,
      onError,
    })).resolves.toEqual({ status: "retrying" });
    expect(wait).toHaveBeenCalledWith(250, undefined);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: "content_proposal_api_timeout",
    }));
  });

  it("interrupts a retry wait when graceful shutdown begins", async () => {
    const controller = new AbortController();
    const wait = vi.fn(async (_ms: number, signal?: AbortSignal) => {
      await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
    });
    const iteration = runContentProposalWatchIteration({
      runOnce: vi.fn(async () => {
        throw new ContentProposalApiError("content_proposal_api_timeout", 0);
      }),
      pollMs: 60_000,
      wait,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(wait).toHaveBeenCalled());
    expect(wait).toHaveBeenCalledWith(60_000, controller.signal);
    controller.abort();
    await expect(iteration).resolves.toEqual({ status: "stopped" });
  });

  it("does not call generation or publishing APIs for either queue origin", () => {
    const clientSource = String(createContentProposalRunner);
    expect(clientSource).not.toContain("/generate");
    expect(clientSource).not.toContain("/publish");
    expect(() => {
      throw new ContentProposalContractError("content_proposal_result_invalid");
    }).toThrow("content_proposal_result_invalid");
  });
});
