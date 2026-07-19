import { describe, expect, it, vi } from "vitest";
import { createClient, SubjectAnalysisApiError } from "./client.js";

describe("subject analysis API client", () => {
  it("adds a timeout signal to every worker request", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify({ job: null }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = createClient("https://api.example.com", "token", fetchImpl as typeof fetch);
    await client.claim("worker-1", 900);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("aborts a stalled API request and marks it retryable", async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }));
    const client = createClient("https://api.example.com", "token", fetchImpl as typeof fetch, 5);
    await expect(client.claim("worker-1", 900)).rejects.toMatchObject({ retryable: true, status: 503 } satisfies Partial<SubjectAnalysisApiError>);
  });
});
