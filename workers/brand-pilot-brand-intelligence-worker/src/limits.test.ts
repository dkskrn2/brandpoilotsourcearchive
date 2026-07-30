import { describe, expect, it } from "vitest";
import {
  ACTIVE_PIPELINE_MS,
  MAX_LOGICAL_CLI_CALLS,
  MAX_PHYSICAL_CLI_CALLS,
  MAX_RETRY_CLI_CALLS,
  STAGE_BUDGET_SECONDS,
  STAGE_RESERVE_SECONDS,
  stageTimeoutMs,
} from "./limits.js";

describe("brand intelligence pipeline budgets", () => {
  it("fits eight logical calls and two retries into the fixed 20-minute envelope", () => {
    expect(MAX_LOGICAL_CLI_CALLS).toBe(8);
    expect(MAX_RETRY_CLI_CALLS).toBe(2);
    expect(MAX_PHYSICAL_CLI_CALLS).toBe(10);
    expect(STAGE_BUDGET_SECONDS).toEqual([270, 270, 60, 60, 75, 75, 60, 15]);
    expect(STAGE_RESERVE_SECONDS).toEqual([615, 345, 285, 225, 150, 75, 15, 0]);
    expect(ACTIVE_PIPELINE_MS).toBe(1_200_000);
  });

  it("never spends downstream reserve", () => {
    expect(stageTimeoutMs(0, 1_200_000)).toBe(270_000);
    expect(() => stageTimeoutMs(7, 0)).toThrow("analysis_deadline_exceeded");
  });
});
