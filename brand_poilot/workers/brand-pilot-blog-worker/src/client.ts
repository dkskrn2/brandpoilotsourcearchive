import type { BlogClient, BlogJob } from "./contracts.js";
export function createClient(apiUrl: string, token: string, fetchImpl: typeof fetch = fetch): BlogClient {
  const base = apiUrl.replace(/\/+$/, "");
  const leaseSeconds = Math.max(30, Math.min(900, Number(process.env.AI_CONTENT_JOB_LEASE_SECONDS ?? 180)));
  async function request(path: string, body: Record<string, unknown>) { const response = await fetchImpl(`${base}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }); if (!response.ok) throw new Error(`worker_api_failed:${response.status}`); return response; }
  return {
    async claim(workerId) { return (await (await request("/worker/ai-content-jobs/blog/claim", { workerId, leaseSeconds })).json() as { job: BlogJob | null }).job; },
    async heartbeat(jobId, workerId, leaseToken) { await request(`/worker/ai-content-jobs/${jobId}/heartbeat`, { workerId, leaseToken, leaseSeconds }); },
    async complete(jobId, body) { await request(`/worker/ai-content-jobs/${jobId}/complete`, body); }, async fail(jobId, body) { await request(`/worker/ai-content-jobs/${jobId}/fail`, body); },
    async acquire(workerId) { const response = await request("/worker/resources/codex-cli/acquire", { workerId, workload: "content" }); return response.status === 204 ? null : await response.json() as { id: string; leaseToken: string }; },
    async heartbeatResource(id, workerId, leaseToken) { await request(`/worker/resources/codex-cli/${id}/heartbeat`, { workerId, leaseToken }); }, async releaseResource(id, workerId, leaseToken) { await request(`/worker/resources/codex-cli/${id}/release`, { workerId, leaseToken }); },
  };
}
