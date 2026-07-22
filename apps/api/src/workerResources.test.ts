import { describe, expect, it } from "vitest";
import { canAcquireWorkerResource, resolveWorkerResourceLimits } from "./workerResources.js";

describe("worker resource policy", () => {
  it("reserves one of two Codex slots for DM", () => {
    const limits = resolveWorkerResourceLimits({ total: 2, dmReserved: 1 });

    expect(canAcquireWorkerResource({ workload: "content", activeTotal: 0, activeNonDm: 0, limits })).toBe(true);
    expect(canAcquireWorkerResource({ workload: "wiki", activeTotal: 1, activeNonDm: 1, limits })).toBe(false);
    expect(canAcquireWorkerResource({ workload: "dm", activeTotal: 1, activeNonDm: 1, limits })).toBe(true);
    expect(canAcquireWorkerResource({ workload: "dm", activeTotal: 2, activeNonDm: 1, limits })).toBe(false);
  });

  it("rejects an invalid reservation", () => {
    expect(() => resolveWorkerResourceLimits({ total: 2, dmReserved: 2 })).toThrow("worker_resource_limits_invalid");
  });
});
