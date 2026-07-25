import type { ClaimedImageJob, WorkerClient } from "./worker.js";
import type { ClaimedTextJob, TextWorkerClient } from "./textWorker.js";
import type { WorkerResourceClient, WorkerResourceLease, WorkerResourceWorkload } from "./resourceLease.js";

export function createWorkerResourceClient({
  apiUrl,
  token,
  fetchImpl = fetch,
}: {
  apiUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}): WorkerResourceClient {
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
    async acquireResource(workerId: string, workload: WorkerResourceWorkload) {
      const response = await request("/worker/resources/codex-cli/acquire", { workerId, workload });
      return response.status === 204 ? null : await response.json() as WorkerResourceLease;
    },
    heartbeatResource(id, workerId, leaseToken) {
      return request(`/worker/resources/codex-cli/${id}/heartbeat`, { workerId, leaseToken });
    },
    releaseResource(id, workerId, leaseToken) {
      return request(`/worker/resources/codex-cli/${id}/release`, { workerId, leaseToken });
    },
  };
}

export function createWorkerClient({ apiUrl, token }: { apiUrl: string; token: string }): WorkerClient {
  const baseUrl = apiUrl.replace(/\/+$/, "");
  async function request(path: string, body: Record<string, unknown>) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok && response.status !== 204) throw new Error(`worker_api_failed:${response.status}`);
    return response;
  }
  return {
    async claim(workerId) {
      const response = await request("/worker/image-jobs/claim", { workerId });
      return response.status === 204 ? null : await response.json() as ClaimedImageJob;
    },
    async heartbeat(jobId, input) {
      await request(`/worker/image-jobs/${jobId}/heartbeat`, input);
    },
    async complete(jobId, input) {
      await request(`/worker/image-jobs/${jobId}/complete`, input);
    },
    async fail(jobId, input) {
      await request(`/worker/image-jobs/${jobId}/fail`, input);
    }
  };
}

export function createTextWorkerClient({
  apiUrl,
  token,
  fetchImpl = fetch
}: {
  apiUrl: string;
  token: string;
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
}): TextWorkerClient {
  const baseUrl = apiUrl.replace(/\/+$/, "");
  async function request(path: string, body: Record<string, unknown>) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok && response.status !== 204) throw new Error(`worker_api_failed:${response.status}`);
    return response;
  }
  return {
    async claim(workerId) {
      const response = await request("/worker/text-jobs/claim", { workerId });
      return response.status === 204 ? null : await response.json() as ClaimedTextJob;
    },
    async heartbeat(jobId, input) {
      await request(`/worker/text-jobs/${jobId}/heartbeat`, input);
    },
    async complete(jobId, input) {
      await request(`/worker/text-jobs/${jobId}/complete`, input);
    },
    async fail(jobId, input) {
      await request(`/worker/text-jobs/${jobId}/fail`, input);
    }
  };
}
