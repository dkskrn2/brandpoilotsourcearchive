import { describe, expect, it, vi } from "vitest";
import { resolveWorkerMode, selectWorkerLane, usesDmWorkerHeartbeat } from "./workerMode.js";

describe("resolveWorkerMode", () => {
  it("defaults to the DM-only lane", () => {
    expect(resolveWorkerMode(undefined, undefined)).toBe("dm");
  });

  it("lets the command line select the dedicated Wiki lane", () => {
    expect(resolveWorkerMode("wiki", "dm")).toBe("wiki");
  });

  it("selects FAQ without invoking DM or Wiki", async () => {
    const lanes = {
      dm: vi.fn(async () => ({ status: "dm" })),
      wiki: vi.fn(async () => ({ status: "wiki" })),
      faq: vi.fn(async () => ({ status: "faq" })),
    };
    await selectWorkerLane("faq", lanes)();
    expect(lanes.faq).toHaveBeenCalledTimes(1);
    expect(lanes.dm).not.toHaveBeenCalled();
    expect(lanes.wiki).not.toHaveBeenCalled();
  });

  it("keeps FAQ off the DM worker heartbeat endpoint", () => {
    expect(usesDmWorkerHeartbeat("faq")).toBe(false);
    expect(usesDmWorkerHeartbeat("dm")).toBe(true);
    expect(usesDmWorkerHeartbeat("wiki")).toBe(true);
  });

  it("rejects a combined lane so DM and Wiki cannot compete in one process", () => {
    expect(() => resolveWorkerMode("all", undefined)).toThrow("worker_mode_invalid");
  });
});
