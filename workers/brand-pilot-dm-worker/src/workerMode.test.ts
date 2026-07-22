import { describe, expect, it } from "vitest";
import { resolveWorkerMode } from "./workerMode.js";

describe("resolveWorkerMode", () => {
  it("defaults to the DM-only lane", () => {
    expect(resolveWorkerMode(undefined, undefined)).toBe("dm");
  });

  it("lets the command line select the dedicated Wiki lane", () => {
    expect(resolveWorkerMode("wiki", "dm")).toBe("wiki");
  });

  it("rejects a combined lane so DM and Wiki cannot compete in one process", () => {
    expect(() => resolveWorkerMode("all", undefined)).toThrow("worker_mode_invalid");
  });
});
