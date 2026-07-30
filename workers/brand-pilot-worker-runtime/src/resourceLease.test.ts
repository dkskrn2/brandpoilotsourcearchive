import { describe, expect, it, vi } from "vitest";
import { withFailClosedResourceLease } from "./resourceLease.js";

describe("shared Codex resource lease", () => {
  it("aborts work on heartbeat loss and always releases", async () => {
    const client = {
      acquireResource: vi.fn(async () => ({
        id: "lease-1",
        leaseToken: "token-1",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })),
      heartbeatResource: vi.fn(async () => {
        throw new Error("resource_lease_lost");
      }),
      releaseResource: vi.fn(async () => undefined),
    };
    await expect(withFailClosedResourceLease({
      client,
      workerId: "onboarding-1",
      workload: "onboarding",
      heartbeatIntervalMs: 1,
      maximumWaitMs: 50,
    }, async (signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }))).rejects.toThrow("resource_lease_lost");
    expect(client.releaseResource).toHaveBeenCalledWith(
      "lease-1",
      "onboarding-1",
      "token-1",
    );
  });
});
