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
      const payload = await request(
        `/worker/content-proposal-jobs/${job.id}/invocations/${ordinal}/start`,
        { workerId: job.workerId, leaseToken: job.leaseToken, modelAttemptId: job.modelAttemptId },
      );
      return { eventSha256: String(payload.eventSha256) };
    },
    async recordInvocationTerminal(job, ordinal, input) {
      const payload = await request(
        `/worker/content-proposal-jobs/${job.id}/invocations/${ordinal}/terminal`,
        { workerId: job.workerId, leaseToken: job.leaseToken, modelAttemptId: job.modelAttemptId, ...input },
      );
      return { eventSha256: String(payload.eventSha256), status: String(payload.status) };
    },
    async complete(job, proposalSet) {
      await request(`/worker/content-proposal-jobs/${job.id}/complete`, {
        workerId: job.workerId,
        leaseToken: job.leaseToken,
        modelAttemptId: job.modelAttemptId,
        proposalSet,
      });
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
