import { describe, expect, it, vi } from "vitest";
import { withWorkerResourceLease } from "./resourceLease.js";

describe("withWorkerResourceLease", () => {
  it("waits for capacity, keeps the lease alive, and releases it", async () => {
    const client = {
      acquireResource: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "lease-1", leaseToken: "token-1", expiresAt: "2026-07-16T00:01:00.000Z" }),
      heartbeatResource: vi.fn(async () => undefined),
      releaseResource: vi.fn(async () => undefined),
    };
    const onWait = vi.fn(async () => undefined);

    const result = await withWorkerResourceLease({
      client,
      workerId: "dm-1",
      workload: "dm",
      pollIntervalMs: 1,
      heartbeatIntervalMs: 2,
      onWait,
    }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 8));
      return "done";
    });

    expect(result).toBe("done");
    expect(onWait).toHaveBeenCalled();
    expect(client.heartbeatResource).toHaveBeenCalled();
    expect(client.releaseResource).toHaveBeenCalledWith("lease-1", "dm-1", "token-1");
  });

  it("releases a lease when the task fails", async () => {
    const client = {
      acquireResource: vi.fn(async () => ({ id: "lease-1", leaseToken: "token-1", expiresAt: "2026-07-16T00:01:00.000Z" })),
      heartbeatResource: vi.fn(async () => undefined),
      releaseResource: vi.fn(async () => undefined),
    };

    await expect(withWorkerResourceLease({ client, workerId: "wiki-1", workload: "wiki" }, async () => {
      throw new Error("failed");
    })).rejects.toThrow("failed");

    expect(client.releaseResource).toHaveBeenCalledWith("lease-1", "wiki-1", "token-1");
  });
});
