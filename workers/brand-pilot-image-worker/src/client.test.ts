import { describe, expect, it, vi } from "vitest";
import { createTextWorkerClient } from "./client.js";

describe("Threads worker API client", () => {
  it("uses the fixed text claim endpoint and treats 204 as idle", async () => {
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) => new Response(null, { status: 204 }));
    const client = createTextWorkerClient({
      apiUrl: "https://api.example.com/",
      token: "secret",
      fetchImpl
    });

    await expect(client.claim("worker-1")).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledWith("https://api.example.com/worker/text-jobs/claim", expect.objectContaining({
      method: "POST",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      body: JSON.stringify({ workerId: "worker-1" })
    }));
  });

  it("sends heartbeat, complete, and fail bodies to their fixed text endpoints", async () => {
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) => new Response(null, { status: 204 }));
    const client = createTextWorkerClient({ apiUrl: "https://api.example.com", token: "secret", fetchImpl });
    const lease = { workerId: "worker-1", leaseToken: "lease-1" };
    const result = {
      deliveryFormat: "threads_text" as const,
      promptVersion: "worker-threads.v1" as const,
      title: "title",
      text: "text",
      sourceMode: "topic_only" as const,
      fetchStatus: "no_source_url" as const,
      model: "codex-cli"
    };

    await client.heartbeat("job-1", lease);
    await client.complete("job-1", { ...lease, result });
    await client.fail("job-1", { ...lease, error: "failed", retryable: true, retryAfterMs: 1000 });

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "https://api.example.com/worker/text-jobs/job-1/heartbeat",
      "https://api.example.com/worker/text-jobs/job-1/complete",
      "https://api.example.com/worker/text-jobs/job-1/fail"
    ]);
    expect(fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      lease,
      { ...lease, result },
      { ...lease, error: "failed", retryable: true, retryAfterMs: 1000 }
    ]);
  });
});
