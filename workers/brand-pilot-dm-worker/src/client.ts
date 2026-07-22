import type { DmWorkerResult } from "./worker.js";
import type { WorkerResourceLease, WorkerResourceWorkload } from "./resourceLease.js";

export interface ClaimedDmJob {
  id: string;
  workspaceId: string;
  brandId: string;
  leaseToken: string;
  payload: {
    conversationId: string;
    senderId: string;
    messageId: string;
    question: string;
    route: "fixed_fallback" | "knowledge" | "ignore";
    policyReasonCode:
      | "direct_faq"
      | "wiki_answer"
      | "restricted_action"
      | "complaint"
      | "knowledge_gap"
      | "low_confidence"
      | "processing_error"
      | "system_event";
    exactFaqId?: string | null;
    forceAttentionType:
      | "restricted_action"
      | "complaint"
      | "knowledge_gap"
      | "delivery_unknown"
      | "processing_error"
      | null;
  };
  attemptCount: number;
}

export interface ClaimedDmProfileJob {
  id: string;
  workspaceId: string;
  brandId: string;
  leaseToken: string;
  payload: { conversationId: string; senderId: string };
  attemptCount: number;
}

export function createDmWorkerClient({ apiUrl, token, fetchImpl = fetch }: {
  apiUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}) {
  const baseUrl = apiUrl.replace(/\/+$/, "");
  async function request(path: string, body: Record<string, unknown>) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok && response.status !== 204) throw new Error(`worker_api_failed:${response.status}`);
    return response;
  }
  return {
    async claim(workerId: string) {
      const response = await request("/worker/dm-jobs/claim", { workerId });
      return response.status === 204 ? null : await response.json() as ClaimedDmJob;
    },
    heartbeat(jobId: string, workerId: string, leaseToken: string) {
      return request(`/worker/dm-jobs/${jobId}/heartbeat`, { workerId, leaseToken });
    },
    complete(jobId: string, workerId: string, leaseToken: string, result: DmWorkerResult) {
      return request(`/worker/dm-jobs/${jobId}/complete`, { workerId, leaseToken, result });
    },
    fail(jobId: string, workerId: string, leaseToken: string, error: string, retryable: boolean, retryAfterMs: number) {
      return request(`/worker/dm-jobs/${jobId}/fail`, { workerId, leaseToken, error, retryable, retryAfterMs });
    },
    heartbeatWorker(workerId: string) {
      return request("/worker/dm-jobs/heartbeat", { workerId });
    },
    async claimProfile(workerId: string) {
      const response = await request("/workers/dm/profile-jobs/claim", { workerId });
      return response.status === 204 ? null : await response.json() as ClaimedDmProfileJob;
    },
    runProfile(jobId: string, workerId: string, leaseToken: string) {
      return request(`/workers/dm/profile-jobs/${jobId}/run`, { workerId, leaseToken });
    },
    failProfile(jobId: string, workerId: string, leaseToken: string, error: string, retryable: boolean, retryAfterMs: number) {
      return request(`/workers/dm/profile-jobs/${jobId}/fail`, { workerId, leaseToken, error, retryable, retryAfterMs });
    },
    async acquireResource(workerId: string, workload: WorkerResourceWorkload) {
      const response = await request("/worker/resources/codex-cli/acquire", { workerId, workload });
      return response.status === 204 ? null : await response.json() as WorkerResourceLease;
    },
    heartbeatResource(id: string, workerId: string, leaseToken: string) {
      return request(`/worker/resources/codex-cli/${id}/heartbeat`, { workerId, leaseToken });
    },
    releaseResource(id: string, workerId: string, leaseToken: string) {
      return request(`/worker/resources/codex-cli/${id}/release`, { workerId, leaseToken });
    },
  };
}
