import type {
  BrandAnalysisJob,
  BrandIntelligenceResult,
  BrandIntelligenceWorkerClient,
} from "./contracts.js";

export class BrandIntelligenceApiError extends Error {
  readonly retryable: boolean;
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "BrandIntelligenceApiError";
    this.status = status;
    this.retryable = status === 408 || status === 429 || status >= 500;
  }
}

export function createClient(
  apiUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 300_000,
): BrandIntelligenceWorkerClient {
  const base = apiUrl.replace(/\/+$/, "");

  async function request(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new BrandIntelligenceApiError(
        error instanceof Error ? error.message : "brand_intelligence_network_failed",
        503,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      let detail = `brand_intelligence_api_failed:${response.status}`;
      try {
        const payload = await response.json() as { error?: string };
        if (payload.error) detail = payload.error;
      } catch { /* Keep the status-derived message. */ }
      throw new BrandIntelligenceApiError(detail, response.status);
    }
    if (response.status === 204) return {};
    return await response.json() as Record<string, unknown>;
  }

  return {
    async claim(workerId, leaseSeconds) {
      const payload = await request("/worker/brand-analyses/claim", { workerId, leaseSeconds });
      return (payload.job ?? null) as BrandAnalysisJob | null;
    },
    async heartbeat(job, leaseSeconds) {
      await request(`/worker/brand-analyses/${job.id}/heartbeat`, {
        workerId: job.leasedBy, leaseToken: job.leaseToken, leaseSeconds,
      });
    },
    async complete(job, result: BrandIntelligenceResult, leaseSeconds) {
      await request(`/worker/brand-analyses/${job.id}/complete`, {
        workerId: job.leasedBy, leaseToken: job.leaseToken, leaseSeconds, result,
      });
    },
    async fail(job, input) {
      await request(`/worker/brand-analyses/${job.id}/fail`, {
        workerId: job.leasedBy, leaseToken: job.leaseToken, ...input,
      });
    },
  };
}
