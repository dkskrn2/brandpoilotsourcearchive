import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrandAnalysisJob, BrandIntelligenceResult } from "./contracts.js";
import { createClient } from "./client.js";

const unavailable = () => new Response("", { status: 503 });

const leasedJob = {
  id: "analysis-1",
  leasedBy: "worker-1",
  leaseToken: "lease-1",
} as BrandAnalysisJob;

afterEach(() => {
  vi.useRealTimers();
});

describe("brand intelligence API client transient retries", () => {
  it("rejects a v2 claim without a category registry", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      job: {
        pipelineVersion: 2,
        contractVersion: "brand-intelligence-result.v2",
        executionContract: {
          ownedPageLimit: 20,
          externalPageLimit: 10,
          offeringLimit: 5,
          pipelineVersion: 2,
          promptVersion: "brand-intelligence-v2.1",
          resultContractVersion: "brand-intelligence-result.v2",
        },
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const api = createClient("https://api.example.com", "token", fetchImpl);

    await expect(api.claim("worker-1", 900)).rejects.toMatchObject({
      status: 409,
      message: "brand_intelligence_execution_contract_mismatch",
    });
  });

  it("leaves resource heartbeat retry ownership to the lease manager", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(unavailable());
    const api = createClient("https://api.example.com", "token", fetchImpl);

    const outcome = api.heartbeatResource("resource-1", "worker-1", "resource-token-1");
    void outcome.catch(() => undefined);
    await vi.runAllTimersAsync();

    await expect(outcome).rejects.toMatchObject({ status: 503, retryable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves progress retry ownership to the job lease manager", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(unavailable());
    const api = createClient("https://api.example.com", "token", fetchImpl);

    const outcome = api.progress(leasedJob, {
      stage: "owned_facts_1",
      status: "succeeded",
      logicalIndex: 1,
      physicalAttempt: 1,
      inputCount: 1,
      successCount: 1,
      failedCount: 0,
    }, 900);
    void outcome.catch(() => undefined);
    await vi.runAllTimersAsync();

    await expect(outcome).rejects.toMatchObject({ status: 503, retryable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not retry a non-idempotent claim after a 503", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(unavailable());
    const api = createClient("https://api.example.com", "token", fetchImpl);

    await expect(api.claim("worker-1", 900)).rejects.toMatchObject({
      status: 503,
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-idempotent completion after a 503", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(unavailable());
    const api = createClient("https://api.example.com", "token", fetchImpl);

    await expect(api.complete(
      leasedJob,
      {} as BrandIntelligenceResult,
      [],
      900,
    )).rejects.toMatchObject({ status: 503, retryable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps the lease-bound timeout active while reading the response body", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const signal = init?.signal as AbortSignal;
      return {
        ok: true,
        status: 200,
        json: () => new Promise<Record<string, unknown>>((resolve, reject) => {
          const bodyTimer = setTimeout(() => resolve({ ok: true }), 10_000);
          signal.addEventListener("abort", () => {
            clearTimeout(bodyTimer);
            reject(new DOMException("aborted", "AbortError"));
          }, { once: true });
        }),
      } as Response;
    });
    const api = createClient("https://api.example.com", "token", fetchImpl, 5_000);
    const outcome = api.heartbeat(leasedJob, 900);
    let settled = false;
    void outcome.finally(() => { settled = true; }).catch(() => undefined);

    await vi.advanceTimersByTimeAsync(2_001);

    expect(settled).toBe(true);
    await expect(outcome).rejects.toMatchObject({ status: 503, retryable: true });
    expect(vi.getTimerCount()).toBe(0);
  });
});
