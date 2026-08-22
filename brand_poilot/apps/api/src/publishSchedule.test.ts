import { describe, expect, it } from "vitest";
import { isDailyGenerationMinute, nextPolicySlots } from "./publishSchedule.js";

describe("publish schedule", () => {
  it("runs daily generation only at 10:00 KST", () => {
    expect(isDailyGenerationMinute(new Date("2026-07-13T01:00:00.000Z"))).toBe(true);
    expect(isDailyGenerationMinute(new Date("2026-07-13T01:01:00.000Z"))).toBe(false);
  });

  it("uses the remaining policy slots on the current KST date", () => {
    expect(nextPolicySlots(new Date("2026-07-13T01:00:00.000Z"), 2).map((slot) => slot.toISOString()))
      .toEqual(["2026-07-13T02:30:00.000Z", "2026-07-13T05:30:00.000Z"]);
  });

  it("moves queued items after the last slot to the following KST date", () => {
    expect(nextPolicySlots(new Date("2026-07-13T12:00:00.000Z"), 1).map((slot) => slot.toISOString()))
      .toEqual(["2026-07-14T02:30:00.000Z"]);
  });
});
