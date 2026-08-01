import { afterEach, describe, expect, it, vi } from "vitest";
import { BrandIntelligenceApiError } from "./client.js";
import { withFailClosedResourceLease, type WorkerResourceClient } from "./resourceLease.js";

const START = new Date("2026-08-01T08:00:00.000Z");

afterEach(() => {
  vi.useRealTimers();
});

function abortableTask(signal: AbortSignal, resolveAfterMs?: number) {
  return new Promise<string>((resolve, reject) => {
    const timer = resolveAfterMs === undefined
      ? undefined
      : setTimeout(() => resolve("done"), resolveAfterMs);
    signal.addEventListener("abort", () => {
      if (timer) clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

describe("fail-closed worker resource lease", () => {
  it("never starts a task with an already expired resource lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const client: WorkerResourceClient = {
      acquireResource: vi.fn(async () => ({
        id: "resource-1",
        leaseToken: "token-1",
        expiresAt: new Date(START.getTime() - 1).toISOString(),
      })),
      heartbeatResource: vi.fn(async () => undefined),
      releaseResource: vi.fn(async () => undefined),
    };
    const task = vi.fn(async () => "should-not-run");

    await expect(withFailClosedResourceLease({
      client,
      workerId: "worker-1",
      workload: "onboarding",
    }, task)).rejects.toThrow("worker_resource_lease_expired");

    expect(task).not.toHaveBeenCalled();
    expect(client.releaseResource).toHaveBeenCalledOnce();
  });

  it("survives retryable heartbeat 503s that recover before the known lease expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const heartbeatResource = vi.fn(async () => {
      if (Date.now() < START.getTime() + 31_000) {
        throw new BrandIntelligenceApiError("brand_intelligence_api_failed:503", 503);
      }
      return { expiresAt: new Date(Date.now() + 45_000).toISOString() };
    });
    const client: WorkerResourceClient = {
      acquireResource: vi.fn(async () => ({
        id: "resource-1",
        leaseToken: "token-1",
        expiresAt: new Date(START.getTime() + 45_000).toISOString(),
      })),
      heartbeatResource,
      releaseResource: vi.fn(async () => undefined),
    };

    const outcome = withFailClosedResourceLease({
      client,
      workerId: "worker-1",
      workload: "onboarding",
      heartbeatIntervalMs: 15_000,
    }, (signal) => abortableTask(signal, 32_000));
    void outcome.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(32_000);
    await expect(outcome).resolves.toBe("done");
    expect(heartbeatResource.mock.calls.length).toBeGreaterThan(1);
    expect(client.releaseResource).toHaveBeenCalledOnce();
  });

  it("aborts immediately when the heartbeat reports a non-retryable lost lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const heartbeatResource = vi.fn(async () => {
      throw new BrandIntelligenceApiError("worker_resource_lease_invalid", 409);
    });
    const client: WorkerResourceClient = {
      acquireResource: vi.fn(async () => ({
        id: "resource-1",
        leaseToken: "token-1",
        expiresAt: new Date(START.getTime() + 45_000).toISOString(),
      })),
      heartbeatResource,
      releaseResource: vi.fn(async () => undefined),
    };

    const outcome = withFailClosedResourceLease({
      client,
      workerId: "worker-1",
      workload: "onboarding",
      heartbeatIntervalMs: 15_000,
    }, (signal) => abortableTask(signal));
    void outcome.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(15_000);
    await expect(outcome).rejects.toMatchObject({ status: 409 });
    expect(heartbeatResource).toHaveBeenCalledOnce();
    expect(client.releaseResource).toHaveBeenCalledOnce();
  });

  it("fails closed at the known expiry when retryable heartbeat failures persist", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const heartbeatResource = vi.fn(async () => {
      throw new BrandIntelligenceApiError("brand_intelligence_api_failed:503", 503);
    });
    const expiresAt = new Date(START.getTime() + 20_000).toISOString();
    const client: WorkerResourceClient = {
      acquireResource: vi.fn(async () => ({ id: "resource-1", leaseToken: "token-1", expiresAt })),
      heartbeatResource,
      releaseResource: vi.fn(async () => undefined),
    };

    const outcome = withFailClosedResourceLease({
      client,
      workerId: "worker-1",
      workload: "onboarding",
      heartbeatIntervalMs: 5_000,
    }, (signal) => abortableTask(signal));
    void outcome.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(20_000);
    await expect(outcome).rejects.toThrow("worker_resource_lease_expired");
    expect(heartbeatResource.mock.calls.length).toBeGreaterThan(1);
    expect(client.releaseResource).toHaveBeenCalledOnce();
  });

  it("uses a successful heartbeat's refreshed expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const heartbeatResource = vi.fn(async () => ({
      expiresAt: new Date(START.getTime() + 40_000).toISOString(),
    }));
    const client: WorkerResourceClient = {
      acquireResource: vi.fn(async () => ({
        id: "resource-1",
        leaseToken: "token-1",
        expiresAt: new Date(START.getTime() + 20_000).toISOString(),
      })),
      heartbeatResource,
      releaseResource: vi.fn(async () => undefined),
    };

    const outcome = withFailClosedResourceLease({
      client,
      workerId: "worker-1",
      workload: "onboarding",
      heartbeatIntervalMs: 5_000,
    }, (signal) => abortableTask(signal, 25_000));
    void outcome.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(25_000);
    await expect(outcome).resolves.toBe("done");
    expect(heartbeatResource).toHaveBeenCalled();
    expect(client.releaseResource).toHaveBeenCalledOnce();
  });

  it("does not refresh timers from a heartbeat that finishes after release", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    let resolveHeartbeat: ((value: { expiresAt: string }) => void) | undefined;
    const heartbeatResource = vi.fn(() => new Promise<{ expiresAt: string }>((resolve) => {
      resolveHeartbeat = resolve;
    }));
    const client: WorkerResourceClient = {
      acquireResource: vi.fn(async () => ({
        id: "resource-1",
        leaseToken: "token-1",
        expiresAt: new Date(START.getTime() + 45_000).toISOString(),
      })),
      heartbeatResource,
      releaseResource: vi.fn(async () => undefined),
    };

    const outcome = withFailClosedResourceLease({
      client,
      workerId: "worker-1",
      workload: "onboarding",
      heartbeatIntervalMs: 5_000,
    }, (signal) => abortableTask(signal, 6_000));

    await vi.advanceTimersByTimeAsync(6_000);
    await expect(outcome).resolves.toBe("done");
    resolveHeartbeat?.({ expiresAt: new Date(START.getTime() + 60_000).toISOString() });
    await vi.advanceTimersByTimeAsync(0);

    expect(vi.getTimerCount()).toBe(0);
  });
});
