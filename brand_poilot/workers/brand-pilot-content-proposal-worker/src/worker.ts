import { ContentProposalApiError, type ContentProposalModelClient } from "./client.js";
import {
  ContentProposalContractError,
  parseContentProposalResult,
  type ContentProposalJob,
  type ContentProposalV1,
  type ContentProposalWorkerClient,
} from "./contracts.js";
import { buildContentProposalPrompt } from "./promptBuilder.js";

export interface ContentProposalRunner {
  run(job: ContentProposalJob, signal?: AbortSignal): Promise<ContentProposalV1[]>;
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
      const output = await model.generate(buildContentProposalPrompt(job), signal);
      return parseContentProposalResult(output, job);
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
  job,
  leaseSeconds,
  heartbeatMs = 30_000,
  signal,
}: {
  client: ContentProposalWorkerClient;
  runner: ContentProposalRunner;
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
    const proposals = await runner.run(job, controller.signal);
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
  workerId,
  leaseSeconds,
  heartbeatMs,
  pollMs = 5_000,
  wait = abortableWait,
  signal,
}: {
  client: ContentProposalWorkerClient;
  runner: ContentProposalRunner;
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
  return processContentProposalJob({ client, runner, job, leaseSeconds, heartbeatMs, signal });
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
