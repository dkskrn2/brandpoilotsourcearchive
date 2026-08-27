import type {
  BrandAnalysisJob,
  BrandIntelligenceResult,
  BrandIntelligenceWorkerClient,
} from "./contracts.js";
import { parseStyleAnalysisJob, type StyleAnalysisClient } from "./styleAnalysisContracts.js";

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

// Lease-aware orchestration owns retries. Bound each individual request so its
// watchdog can still stop work before the authoritative lease expires.
const LEASE_BOUND_REQUEST_TIMEOUT_MS = 2_000;

export function createClient(
  apiUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 300_000,
): BrandIntelligenceWorkerClient & StyleAnalysisClient {
  const base = apiUrl.replace(/\/+$/, "");

  async function request(
    path: string,
    body: Record<string, unknown>,
    requestTimeoutMs = timeoutMs,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetchImpl(`${base}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
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
    } catch (error) {
      if (error instanceof BrandIntelligenceApiError) throw error;
      throw new BrandIntelligenceApiError(
        error instanceof Error ? error.message : "brand_intelligence_network_failed",
        503,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async cleanup() {
      await request("/worker/brand-analyses/cleanup", {});
    },
    async acquireResource(workerId, workload) {
      const payload = await request("/worker/resources/codex-cli/acquire", {
        workerId,
        workload,
      });
      return payload.id ? payload as unknown as {
        id: string;
        leaseToken: string;
        expiresAt: string;
      } : null;
    },
    heartbeatResource(id, workerId, leaseToken) {
      return request(`/worker/resources/codex-cli/${id}/heartbeat`, {
        workerId,
        leaseToken,
      }, Math.min(timeoutMs, LEASE_BOUND_REQUEST_TIMEOUT_MS));
    },
    releaseResource(id, workerId, leaseToken) {
      return request(`/worker/resources/codex-cli/${id}/release`, {
        workerId,
        leaseToken,
      });
    },
    async claim(workerId, leaseSeconds) {
      const payload = await request("/worker/brand-analyses/claim", {
        workerId,
        leaseSeconds,
        supportedPipelineVersions: [2],
      });
      const job = (payload.job ?? null) as BrandAnalysisJob | null;
      if (job && (
        job.pipelineVersion !== 2
        || job.contractVersion !== "brand-intelligence-result.v2"
        || job.executionContract?.ownedPageLimit !== 20
        || job.executionContract?.externalPageLimit !== 10
        || job.executionContract?.offeringLimit !== 5
        || job.executionContract?.pipelineVersion !== 2
        || job.executionContract?.promptVersion !== "brand-intelligence-v2.1"
        || job.executionContract?.resultContractVersion !== "brand-intelligence-result.v2"
        || !Array.isArray(job.categoryRegistry)
      )) {
        throw new BrandIntelligenceApiError("brand_intelligence_execution_contract_mismatch", 409);
      }
      return job;
    },
    async heartbeat(job, leaseSeconds) {
      const payload = await request(`/worker/brand-analyses/${job.id}/heartbeat`, {
        workerId: job.leasedBy, leaseToken: job.leaseToken, leaseSeconds,
      }, Math.min(timeoutMs, LEASE_BOUND_REQUEST_TIMEOUT_MS));
      return {
        leaseExpiresAt: typeof payload.leaseExpiresAt === "string" ? payload.leaseExpiresAt : null,
        deadlineAt: typeof payload.deadlineAt === "string" ? payload.deadlineAt : null,
      };
    },
    async progress(job, input, leaseSeconds) {
      await request(`/worker/brand-analyses/${job.id}/progress`, {
        workerId: job.leasedBy, leaseToken: job.leaseToken, leaseSeconds, ...input,
      }, Math.min(timeoutMs, LEASE_BOUND_REQUEST_TIMEOUT_MS));
    },
    async complete(job, result: BrandIntelligenceResult, evidence, leaseSeconds, registry) {
      await request(`/worker/brand-analyses/${job.id}/complete`, {
        workerId: job.leasedBy, leaseToken: job.leaseToken, leaseSeconds,
        result, evidence, registry,
      });
    },
    async cancelled(job, leaseSeconds) {
      await request(`/worker/brand-analyses/${job.id}/cancelled`, {
        workerId: job.leasedBy,
        leaseToken: job.leaseToken,
        leaseSeconds,
      });
    },
    async fail(job, input) {
      await request(`/worker/brand-analyses/${job.id}/fail`, {
        workerId: job.leasedBy, leaseToken: job.leaseToken, ...input,
      });
    },
    async claimStyleAnalysis(workerId, leaseSeconds) {
      const payload = await request("/worker/design-style-analyses/claim", { workerId, leaseSeconds });
      return payload.job === null ? null : parseStyleAnalysisJob(payload.job);
    },
    async heartbeatStyleAnalysis(job, workerId, leaseSeconds) {
      await request(`/worker/design-style-analyses/${job.jobId}/heartbeat`, {
        workerId, leaseToken: job.leaseToken, leaseSeconds,
      }, Math.min(timeoutMs, LEASE_BOUND_REQUEST_TIMEOUT_MS));
    },
    async completeStyleAnalysis(job, workerId, analysis, analysisSha256) {
      await request(`/worker/design-style-analyses/${job.jobId}/complete`, {
        workerId, leaseToken: job.leaseToken, designStyleId: job.designStyleId,
        styleRevision: job.styleRevision, analysis, analysisSha256,
      });
    },
    async failStyleAnalysis(job, workerId, errorCode, retryable) {
      await request(`/worker/design-style-analyses/${job.jobId}/fail`, {
        workerId, leaseToken: job.leaseToken, errorCode, retryable,
      });
    },
  };
}
