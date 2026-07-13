import type { ClaimedImageJob, WorkerClient } from "./worker.js";

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
