import { describe, expect, it } from "vitest";
import {
  ACTIVE_PIPELINE_MS,
  MAX_LOGICAL_CLI_CALLS,
  MAX_PHYSICAL_CLI_CALLS,
  MAX_RETRY_CLI_CALLS,
  STAGE_BUDGET_SECONDS,
  STAGE_RESERVE_SECONDS,
  codexProcessTimeoutMs,
  stageTimeoutMs,
} from "./limits.js";

describe("brand intelligence pipeline budgets", () => {
  it("defines eight logical calls and at most two retries within the fixed 20-minute envelope", () => {
    expect(MAX_LOGICAL_CLI_CALLS).toBe(8);
    expect(MAX_RETRY_CLI_CALLS).toBe(2);
    expect(MAX_PHYSICAL_CLI_CALLS).toBe(10);
    expect(STAGE_BUDGET_SECONDS).toEqual([270, 270, 60, 60, 75, 75, 60, 60]);
    expect(STAGE_RESERVE_SECONDS).toEqual([660, 390, 330, 270, 195, 120, 60, 0]);
    expect(ACTIVE_PIPELINE_MS).toBe(1_200_000);
    expect(STAGE_BUDGET_SECONDS.reduce((total, seconds) => total + seconds, 0)).toBe(930);
    expect(ACTIVE_PIPELINE_MS / 1_000 - 930).toBe(270);
  });

  it("never spends downstream reserve", () => {
    const downstreamBudgets = STAGE_BUDGET_SECONDS.map((_, index) =>
      STAGE_BUDGET_SECONDS.slice(index + 1).reduce((total, seconds) => total + seconds, 0),
    );

    expect(STAGE_RESERVE_SECONDS).toEqual(downstreamBudgets);
    expect(stageTimeoutMs(0, 1_200_000)).toBe(270_000);
    expect(stageTimeoutMs(6, 120_000)).toBe(60_000);
    expect(() => stageTimeoutMs(6, 60_000)).toThrow("analysis_deadline_exceeded");
    expect(stageTimeoutMs(7, 1_200_000)).toBe(60_000);
    expect(stageTimeoutMs(7, 59_999)).toBe(59_999);
    expect(() => stageTimeoutMs(7, 0)).toThrow("analysis_deadline_exceeded");
  });

  it("never lets the process watchdog expire before the active pipeline deadline", () => {
    expect(codexProcessTimeoutMs(undefined)).toBe(ACTIVE_PIPELINE_MS);
    expect(codexProcessTimeoutMs("900000")).toBe(ACTIVE_PIPELINE_MS);
    expect(codexProcessTimeoutMs("1200000")).toBe(ACTIVE_PIPELINE_MS);
    expect(codexProcessTimeoutMs("1800000")).toBe(1_800_000);
    expect(codexProcessTimeoutMs("invalid")).toBe(ACTIVE_PIPELINE_MS);
  });
});
