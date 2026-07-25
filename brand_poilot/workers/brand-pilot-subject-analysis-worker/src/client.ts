import type { SubjectWorkerClient, SubjectWorkerJob, SubjectWorkerResult } from "./contracts.js";

export class SubjectAnalysisApiError extends Error {
  readonly retryable: boolean;
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "SubjectAnalysisApiError";
    this.status = status;
    this.retryable = status === 408 || status === 429 || status >= 500;
  }
}

function completionMatchesJob(job: SubjectWorkerJob, result: SubjectWorkerResult): boolean {
  if (job.contractVersion === "subject-analysis.v1") {
    return result.contractVersion === "subject-analysis-result.v1";
  }
  if (job.phase === "analysis") {
    return result.contractVersion === "subject-analysis-result.v2" && result.phase === "analysis";
  }
  return result.contractVersion === "subject-appeal-result.v2" && result.phase === "appeal";
}

export function createClient(apiUrl: string, token: string, fetchImpl: typeof fetch = fetch, timeoutMs = 300_000): SubjectWorkerClient {
  const base = apiUrl.replace(/\/+$/, "");
  async function request(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    let response: Response;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetchImpl(`${base}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
    } catch (error) {
      throw new SubjectAnalysisApiError(error instanceof Error ? error.message : "subject_analysis_network_failed", 503);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      let detail = `subject_analysis_api_failed:${response.status}`;
      try { const payload = await response.json() as { error?: string }; if (payload.error) detail = payload.error; } catch { /* retain status */ }
      throw new SubjectAnalysisApiError(detail, response.status);
    }
    if (response.status === 204) return {};
    return await response.json() as Record<string, unknown>;
  }
  return {
    async claim(workerId, leaseSeconds) {
      const payload = await request("/worker/ai-content-subject-analyses/claim", { workerId, leaseSeconds });
      return (payload.job ?? null) as SubjectWorkerJob | null;
    },
    async heartbeat(job, leaseSeconds) {
      await request(`/worker/ai-content-subject-analyses/${job.analysisId}/heartbeat`, { workerId: job.workerId, leaseToken: job.leaseToken, leaseSeconds });
    },
    async complete(job, result, leaseSeconds) {
      if (!completionMatchesJob(job, result)) {
        throw new SubjectAnalysisApiError("subject_analysis_completion_phase_mismatch", 400);
      }
      await request(`/worker/ai-content-subject-analyses/${job.analysisId}/complete`, { workerId: job.workerId, leaseToken: job.leaseToken, leaseSeconds, result });
    },
    async fail(job, input) {
      await request(`/worker/ai-content-subject-analyses/${job.analysisId}/fail`, { workerId: job.workerId, leaseToken: job.leaseToken, ...input });
    },
  };
}
