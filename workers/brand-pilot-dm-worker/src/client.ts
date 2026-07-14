import type { DmWorkerResult } from "./worker.js";

export interface ClaimedDmJob {
  id: string;
  workspaceId: string;
  brandId: string;
  leaseToken: string;
  payload: { conversationId: string; senderId: string; messageId: string; question: string };
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
  };
}
