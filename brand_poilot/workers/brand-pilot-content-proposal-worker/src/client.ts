import {
  parseContentProposalJob,
  parseResearchSeal,
  type ContentProposalWorkerClient,
} from "./contracts.js";

export type { ContentProposalModelClient } from "./codexModel.js";

export class ContentProposalApiError extends Error {
  readonly retryable: boolean;
  readonly leaseLost: boolean;
  readonly status: number;

  constructor(message: string, status: number, options: { retryable?: boolean } = {}) {
    super(message);
    this.name = "ContentProposalApiError";
    this.status = status;
    this.leaseLost = message === "content_proposal_job_lease_invalid";
    this.retryable = options.retryable
      ?? (!this.leaseLost && (status === 0 || status === 408 || status === 429 || status >= 500));
  }
}

const SHA256 = /^[0-9a-f]{64}$/;

function exactResponse(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("content_proposal_invocation_response_invalid");
  }
  const source = value as Record<string, unknown>;
  const actual = Object.keys(source).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error("content_proposal_invocation_response_invalid");
  }
  return source;
}

function responseSha256(value: unknown): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error("content_proposal_invocation_response_invalid");
  }
  return value;
}

function completionResponse(value: unknown, jobId: string, batchId: string) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const expected = [
    "attemptEventSha256", "batchId", "invocationEventSha256", "jobId", "status",
  ];
  const actual = source ? Object.keys(source).sort() : [];
  if (!source || actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
    || source.jobId !== jobId || source.batchId !== batchId || source.status !== "completed"
    || typeof source.invocationEventSha256 !== "string" || !SHA256.test(source.invocationEventSha256)
    || typeof source.attemptEventSha256 !== "string" || !SHA256.test(source.attemptEventSha256)) {
    throw new Error("content_proposal_completion_response_invalid");
  }
  return {
    jobId,
    batchId,
    status: "completed" as const,
    invocationEventSha256: source.invocationEventSha256,
    attemptEventSha256: source.attemptEventSha256,
  };
}

function invocationOrdinal(value: unknown): 1 | 2 {
  if (value !== 1 && value !== 2) throw new Error("content_proposal_invocation_ordinal_invalid");
  return value;
}

function validateInvocationTerminalInput(input: Record<string, unknown>): void {
  const completed = input.eventType === "invocation_completed"
    && typeof input.transcriptSha256 === "string" && SHA256.test(input.transcriptSha256)
    && typeof input.outputSha256 === "string" && SHA256.test(input.outputSha256)
    && typeof input.parserSha256 === "string" && SHA256.test(input.parserSha256)
    && input.parserValid === false;
  const failed = (input.eventType === "invocation_failed" || input.eventType === "invocation_indeterminate")
    && (input.transcriptSha256 === null
      || (typeof input.transcriptSha256 === "string" && SHA256.test(input.transcriptSha256)))
    && input.outputSha256 === null && input.parserSha256 === null && input.parserValid === null;
  if (!completed && !failed) throw new Error("content_proposal_invocation_terminal_invalid");
}

async function errorDetail(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: string | { message?: string } };
    if (typeof body.error === "string" && body.error.trim()) return body.error;
    if (body.error && typeof body.error === "object" && typeof body.error.message === "string") {
      return body.error.message;
    }
  } catch {
    // Preserve the stable fallback when an upstream error is not JSON.
  }
  return fallback;
}

async function timedFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fallbackCode: string,
): Promise<Response> {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => controller.abort();
  if (upstreamSignal?.aborted) controller.abort();
  else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw new ContentProposalApiError(
      error instanceof Error && error.name !== "AbortError" ? error.message : fallbackCode,
      0,
      { retryable: true },
    );
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}

export function createContentProposalApiClient(
  apiUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 300_000,
): ContentProposalWorkerClient {
  const base = apiUrl.replace(/\/+$/, "");

  async function request(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await timedFetch(fetchImpl, `${base}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }, timeoutMs, "content_proposal_api_timeout");
    if (!response.ok) {
      throw new ContentProposalApiError(
        await errorDetail(response, `content_proposal_api_failed:${response.status}`),
        response.status,
      );
    }
    if (response.status === 204) return {};
    return await response.json() as Record<string, unknown>;
  }

  return {
    async heartbeatWorker(workerId) {
      await request("/worker/content-proposal-jobs/heartbeat", { workerId });
    },
    async claim(workerId, leaseSeconds) {
      const payload = await request("/worker/content-proposal-jobs/claim", { workerId, leaseSeconds });
      return payload.job === null || payload.job === undefined
        ? null
        : parseContentProposalJob(payload.job);
    },
    async heartbeat(job, leaseSeconds) {
      await request(`/worker/content-proposal-jobs/${job.id}/heartbeat`, {
        workerId: job.workerId,
        leaseToken: job.leaseToken,
        leaseSeconds,
        stage: job.stage,
        attemptId: job.stage === "research_required" ? job.researchAttemptId : job.modelAttemptId,
      });
    },
    async completeResearch(job, evidence) {
      const payload = await request(`/worker/content-proposal-jobs/${job.id}/research-complete`, {
        workerId: job.workerId,
        leaseToken: job.leaseToken,
        researchAttemptId: job.researchAttemptId,
        evidence,
      });
      return parseResearchSeal(payload, job, evidence);
    },
    async startInvocation(job, ordinal) {
      const validatedOrdinal = invocationOrdinal(ordinal);
      const payload = await request(
        `/worker/content-proposal-jobs/${job.id}/invocations/${validatedOrdinal}/start`,
        { workerId: job.workerId, leaseToken: job.leaseToken, modelAttemptId: job.modelAttemptId },
      );
      const response = exactResponse(payload, ["eventSha256"]);
      return { eventSha256: responseSha256(response.eventSha256) };
    },
    async recordInvocationTerminal(job, ordinal, input) {
      const validatedOrdinal = invocationOrdinal(ordinal);
      validateInvocationTerminalInput(input as unknown as Record<string, unknown>);
      const payload = await request(
        `/worker/content-proposal-jobs/${job.id}/invocations/${validatedOrdinal}/terminal`,
        { workerId: job.workerId, leaseToken: job.leaseToken, modelAttemptId: job.modelAttemptId, ...input },
      );
      const response = exactResponse(payload, ["eventSha256", "status"]);
      if (response.status !== "queued" && response.status !== "processing" && response.status !== "failed"
        && response.status !== "manual_review_required") {
        throw new Error("content_proposal_invocation_response_invalid");
      }
      return { eventSha256: responseSha256(response.eventSha256), status: response.status };
    },
    async complete(job, ordinal, input) {
      const validatedOrdinal = invocationOrdinal(ordinal);
      const payload = await request(`/worker/content-proposal-jobs/${job.id}/complete`, {
        workerId: job.workerId,
        leaseToken: job.leaseToken,
        modelAttemptId: job.modelAttemptId,
        invocationOrdinal: validatedOrdinal,
        transcriptSha256: input.transcriptSha256,
        outputSha256: input.outputSha256,
        parserSha256: input.parserSha256,
        proposalSet: input.proposalSet,
      });
      return completionResponse(payload, job.id, job.batchId);
    },
    async fail(job, input) {
      await request(`/worker/content-proposal-jobs/${job.id}/fail`, {
        workerId: job.workerId,
        leaseToken: job.leaseToken,
        ...input,
      });
    },
  };
}
