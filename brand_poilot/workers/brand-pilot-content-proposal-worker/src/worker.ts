import type { ContentProposalModelClient, ContentProposalModelResult } from "./codexModel.js";
import { ContentProposalModelInvocationError } from "./codexModel.js";
import { ContentProposalApiError } from "./client.js";
import {
  ContentProposalContractError,
  isContentProposalCompositionJob,
  parseContentProposalSetV2,
  proposalSha256,
  type ContentProposalCompositionJob,
  type ContentProposalJob,
  type ContentProposalSetV2,
  type ContentProposalWorkerClient,
  type InvocationOrdinal,
  type InvocationTerminalInput,
} from "./contracts.js";
import { buildContentProposalPrompt, buildContentProposalRepairPrompt } from "./promptBuilder.js";
import type { ContentProposalResearch } from "./research.js";

export interface ContentProposalRunner {
  generate(prompt: string, signal?: AbortSignal): Promise<ContentProposalModelResult>;
}

export type ContentProposalJobResult = {
  status: "completed" | "research_completed" | "failed" | "lease_lost" | "stopped";
  jobId: string;
};
export type ContentProposalRunResult = ContentProposalJobResult | { status: "idle" | "stopped" };
export type ContentProposalIterationResult = ContentProposalRunResult | { status: "retrying" };

export function createContentProposalRunner(model: ContentProposalModelClient): ContentProposalRunner {
  return { generate: (prompt, signal) => model.generate(prompt, signal) };
}

function errorDetails(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: message.split(":")[0].slice(0, 120) || "content_proposal_worker_failed",
    message: message.slice(0, 2_000),
  };
}

function isLeaseLost(error: unknown): boolean {
  return error instanceof ContentProposalApiError && error.leaseLost;
}

function attemptId(job: ContentProposalJob): string {
  return job.stage === "research_required" ? job.researchAttemptId : job.modelAttemptId;
}

function attemptNumber(job: ContentProposalJob): number {
  return job.stage === "research_required" ? job.researchAttemptNumber : job.modelAttemptNumber;
}

function retryableBeforeStart(error: unknown, job: ContentProposalJob): boolean {
  if (attemptNumber(job) >= job.maxAttempts) return false;
  if (error instanceof ContentProposalContractError || error instanceof SyntaxError) return false;
  if (error instanceof ContentProposalApiError) return error.retryable;
  return true;
}

function parserDecision(result: ContentProposalModelResult, job: ContentProposalCompositionJob): {
  proposalSet: ContentProposalSetV2 | null;
  parserSha256: string;
  parserValid: boolean;
  errorCode: string | null;
} {
  let proposalSet: ContentProposalSetV2 | null = null;
  let errorCode: string | null = null;
  if (!result.syntaxValid) {
    errorCode = "content_proposal_model_output_invalid";
  } else {
    try { proposalSet = parseContentProposalSetV2(result.output, job); }
    catch (error) { errorCode = errorDetails(error).code; }
  }
  const parserValid = proposalSet !== null;
  return {
    proposalSet,
    parserValid,
    errorCode,
    parserSha256: proposalSha256({
      parserVersion: "content-proposal.v2",
      outputSha256: result.outputSha256,
      valid: parserValid,
      errorCode,
    }),
  };
}

function modelFailureTerminal(error: unknown): InvocationTerminalInput {
  const outcome = error instanceof ContentProposalModelInvocationError
    ? error.outcome
    : recordOutcome(error);
  const transcriptSha256 = error instanceof ContentProposalModelInvocationError
    ? error.transcriptSha256
    : recordTranscriptSha256(error);
  return {
    eventType: outcome === "indeterminate" ? "invocation_indeterminate" : "invocation_failed",
    transcriptSha256,
    outputSha256: null,
    parserSha256: null,
    parserValid: null,
  };
}

function recordOutcome(error: unknown): "definite_failure" | "indeterminate" {
  if (error && typeof error === "object" && (error as { outcome?: unknown }).outcome === "indeterminate") {
    return "indeterminate";
  }
  return "definite_failure";
}

function recordTranscriptSha256(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const value = (error as { transcriptSha256?: unknown }).transcriptSha256;
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

async function runComposition(
  client: ContentProposalWorkerClient,
  runner: ContentProposalRunner,
  job: ContentProposalCompositionJob,
  signal: AbortSignal,
): Promise<ContentProposalJobResult> {
  const originalPrompt = buildContentProposalPrompt(job);
  let prompt = originalPrompt;
  for (const ordinal of [1, 2] as const) {
    try { await client.startInvocation(job, ordinal); }
    catch (error) {
      if (isLeaseLost(error)) return { status: "lease_lost", jobId: job.id };
      return { status: "failed", jobId: job.id };
    }
    let result: ContentProposalModelResult;
    try {
      result = await runner.generate(prompt, signal);
    } catch (error) {
      try { await client.recordInvocationTerminal(job, ordinal, modelFailureTerminal(error)); }
      catch (terminalError) {
        if (isLeaseLost(terminalError)) return { status: "lease_lost", jobId: job.id };
        throw terminalError;
      }
      return { status: signal.aborted ? "stopped" : "failed", jobId: job.id };
    }
    const decision = parserDecision(result, job);
    await client.recordInvocationTerminal(job, ordinal, {
      eventType: "invocation_completed",
      transcriptSha256: result.transcriptSha256,
      outputSha256: result.outputSha256,
      parserSha256: decision.parserSha256,
      parserValid: decision.parserValid,
    });
    if (decision.proposalSet) {
      await client.complete(job, decision.proposalSet);
      return { status: "completed", jobId: job.id };
    }
    if (ordinal === 1) {
      prompt = buildContentProposalRepairPrompt(
        originalPrompt,
        decision.errorCode ?? "content_proposal_result_invalid",
        result.rawOutput,
      );
    }
  }
  return { status: "failed", jobId: job.id };
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
      .finally(() => { heartbeatInFlight = false; });
  }, heartbeatMs);

  let invocationStarted = false;
  try {
    if (!isContentProposalCompositionJob(job)) {
      if (!research) throw new ContentProposalContractError("content_proposal_research_runner_required");
      const evidence = await research.run(job, controller.signal);
      if (heartbeatLeaseLost) return { status: "lease_lost", jobId: job.id };
      if (signal?.aborted) return { status: "stopped", jobId: job.id };
      await client.completeResearch(job, evidence);
      return { status: "research_completed", jobId: job.id };
    }
    const trackedClient: ContentProposalWorkerClient = {
      ...client,
      async startInvocation(activeJob, ordinal) {
        const result = await client.startInvocation(activeJob, ordinal);
        invocationStarted = true;
        return result;
      },
    };
    return await runComposition(trackedClient, runner, job, controller.signal);
  } catch (error) {
    if (heartbeatLeaseLost || isLeaseLost(error)) return { status: "lease_lost", jobId: job.id };
    if (signal?.aborted) return { status: "stopped", jobId: job.id };
    if (invocationStarted) throw error;
    const details = errorDetails(error);
    try {
      await client.fail(job, {
        stage: job.stage,
        attemptId: attemptId(job),
        errorCode: details.code,
        errorMessage: details.message,
        retryable: retryableBeforeStart(error, job),
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
  client, runner, research, workerId, leaseSeconds, heartbeatMs, pollMs = 5_000,
  wait = abortableWait, signal,
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
  runOnce, pollMs, wait = abortableWait, onError = () => undefined, signal,
}: {
  runOnce: () => Promise<ContentProposalRunResult>;
  pollMs: number;
  wait?: (ms: number, signal?: AbortSignal) => Promise<unknown>;
  onError?: (error: Error) => void;
  signal?: AbortSignal;
}): Promise<ContentProposalIterationResult> {
  if (signal?.aborted) return { status: "stopped" };
  try { return await runOnce(); }
  catch (error) {
    if (signal?.aborted) return { status: "stopped" };
    if (error instanceof ContentProposalApiError && !error.retryable) throw error;
    onError(error instanceof Error ? error : new Error(String(error)));
    await wait(pollMs, signal);
    return signal?.aborted ? { status: "stopped" } : { status: "retrying" };
  }
}
