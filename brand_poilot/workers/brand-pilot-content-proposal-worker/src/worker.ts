import type { ContentProposalModelClient } from "./codexModel.js";
import { ContentProposalApiError } from "./client.js";
import {
  ContentProposalContractError,
  isContentProposalJobV2,
  parseContentProposalResult,
  parseContentProposalSetV2,
  type ContentProposalJob,
  type ContentProposalJobV2,
  type ContentProposalSetV2,
  type ContentProposalV1,
  type ContentProposalWorkerClient,
} from "./contracts.js";
import {
  buildContentProposalPrompt,
  buildContentProposalRepairPrompt,
} from "./promptBuilder.js";
import type { ContentProposalResearch } from "./research.js";

export interface ContentProposalRunner {
  run(
    job: ContentProposalJob,
    signal?: AbortSignal,
  ): Promise<ContentProposalV1[] | ContentProposalSetV2>;
}

export type ContentProposalJobResult = {
  status: "completed" | "failed" | "lease_lost" | "stopped";
  jobId: string;
};
export type ContentProposalRunResult =
  | ContentProposalJobResult
  | { status: "idle" | "stopped" };
export type ContentProposalIterationResult =
  | ContentProposalRunResult
  | { status: "retrying" };

export function createContentProposalRunner(model: ContentProposalModelClient): ContentProposalRunner {
  return {
    async run(job, signal) {
      const prompt = buildContentProposalPrompt(job);
      if (!isContentProposalJobV2(job)) {
        const output = await model.generate(prompt, signal);
        return parseContentProposalResult(output, job);
      }
      if (job.inputSnapshot.contractVersion !== "proposal-input.v2") {
        throw new ContentProposalContractError("content_proposal_research_required");
      }
      let firstOutput: unknown;
      let firstError: unknown;
      try {
        firstOutput = await model.generate(prompt, signal);
        return parseContentProposalSetV2(firstOutput, job);
      } catch (error) {
        if (!(error instanceof ContentProposalContractError) && !(error instanceof SyntaxError)) throw error;
        firstError = error;
      }
      const rawOutput = firstOutput === undefined
        ? String((firstError as SyntaxError & { rawOutput?: string }).rawOutput ?? "")
        : JSON.stringify(firstOutput);
      const errorCode = firstError instanceof Error
        ? firstError.message.split(":")[0]
        : "content_proposal_result_invalid";
      let repaired: unknown;
      try {
        repaired = await model.generate(
          buildContentProposalRepairPrompt(prompt, errorCode, rawOutput),
          signal,
        );
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new ContentProposalContractError(error.message);
        }
        throw error;
      }
      try {
        return parseContentProposalSetV2(repaired, job);
      } catch (error) {
        if (error instanceof ContentProposalContractError) throw error;
        throw new ContentProposalContractError("content_proposal_result_invalid");
      }
    },
  };
}

function errorDetails(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: message.split(":")[0].slice(0, 120) || "content_proposal_worker_failed",
    message: message.slice(0, 2_000),
  };
}

function retryable(error: unknown, job: ContentProposalJob): boolean {
  if (job.attemptCount >= job.maxAttempts) return false;
  if (error instanceof ContentProposalContractError || error instanceof SyntaxError) return false;
  if (error instanceof ContentProposalApiError) return error.retryable;
  return true;
}

function isLeaseLost(error: unknown): boolean {
  return error instanceof ContentProposalApiError && error.leaseLost;
}

export async function processContentProposalJob({
  client,
  runner,
  research,
  job,
  leaseSeconds,
  heartbeatMs = 30_000,
  signal,
}: {
  client: ContentProposalWorkerClient;
  runner: ContentProposalRunner;
  research?: ContentProposalResearch;
  job: ContentProposalJob;
  leaseSeconds: number;
  heartbeatMs?: number;
  signal?: AbortSignal;
}): Promise<ContentProposalJobResult> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  if (signal?.aborted) stop();
  else signal?.addEventListener("abort", stop, { once: true });
  let heartbeatInFlight = false;
  let heartbeatLeaseLost = false;
  const heartbeat = setInterval(() => {
    if (heartbeatInFlight || controller.signal.aborted) return;
    heartbeatInFlight = true;
    void client.heartbeat(job, leaseSeconds)
      .catch((error) => {
        if (isLeaseLost(error)) {
          heartbeatLeaseLost = true;
          controller.abort();
        }
      })
      .finally(() => {
        heartbeatInFlight = false;
      });
  }, heartbeatMs);

  try {
    let runnableJob = job;
    if (isContentProposalJobV2(job)
      && job.inputSnapshot.contractVersion === "proposal-base-input.v2") {
      if (!research) {
        throw new ContentProposalContractError("content_proposal_research_runner_required");
      }
      const evidence = await research.run(job, controller.signal);
      const inputSnapshot = await client.completeResearch(job, evidence);
      runnableJob = {
        ...job,
        inputSnapshot,
        researchEvidence: inputSnapshot.researchEvidence,
      } as ContentProposalJobV2;
    }
    const proposals = await runner.run(runnableJob, controller.signal);
    if (heartbeatLeaseLost) return { status: "lease_lost", jobId: job.id };
    if (signal?.aborted) return { status: "stopped", jobId: job.id };
    await client.complete(job, proposals);
    return { status: "completed", jobId: job.id };
  } catch (error) {
    if (heartbeatLeaseLost || isLeaseLost(error)) {
      return { status: "lease_lost", jobId: job.id };
    }
    if (signal?.aborted) return { status: "stopped", jobId: job.id };
    const details = errorDetails(error);
    try {
      await client.fail(job, {
        errorCode: details.code,
        errorMessage: details.message,
        retryable: retryable(error, job),
      });
    } catch (failError) {
      if (isLeaseLost(failError)) return { status: "lease_lost", jobId: job.id };
      throw failError;
    }
    return { status: "failed", jobId: job.id };
  } finally {
    clearInterval(heartbeat);
    controller.abort();
    signal?.removeEventListener("abort", stop);
  }
}

const abortableWait = async (ms: number, signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
};

export async function runContentProposalOnce({
  client,
  runner,
  research,
  workerId,
  leaseSeconds,
  heartbeatMs,
  pollMs = 5_000,
  wait = abortableWait,
  signal,
}: {
  client: ContentProposalWorkerClient;
  runner: ContentProposalRunner;
  research?: ContentProposalResearch;
  workerId: string;
  leaseSeconds: number;
  heartbeatMs?: number;
  pollMs?: number;
  wait?: (ms: number, signal?: AbortSignal) => Promise<unknown>;
  signal?: AbortSignal;
}): Promise<ContentProposalRunResult> {
  if (signal?.aborted) return { status: "stopped" };
  const job = await client.claim(workerId, leaseSeconds);
  if (signal?.aborted) return { status: "stopped" };
  if (!job) {
    await wait(pollMs, signal);
    return signal?.aborted ? { status: "stopped" } : { status: "idle" };
  }
  return processContentProposalJob({ client, runner, research, job, leaseSeconds, heartbeatMs, signal });
}

export async function runContentProposalWatchIteration({
  runOnce,
  pollMs,
  wait = abortableWait,
  onError = () => undefined,
  signal,
}: {
  runOnce: () => Promise<ContentProposalRunResult>;
  pollMs: number;
  wait?: (ms: number, signal?: AbortSignal) => Promise<unknown>;
  onError?: (error: Error) => void;
  signal?: AbortSignal;
}): Promise<ContentProposalIterationResult> {
  if (signal?.aborted) return { status: "stopped" as const };
  try {
    return await runOnce();
  } catch (error) {
    if (signal?.aborted) return { status: "stopped" as const };
    if (error instanceof ContentProposalApiError && !error.retryable) throw error;
    const normalized = error instanceof Error ? error : new Error(String(error));
    onError(normalized);
    await wait(pollMs, signal);
    return signal?.aborted
      ? { status: "stopped" as const }
      : { status: "retrying" as const };
  }
}
