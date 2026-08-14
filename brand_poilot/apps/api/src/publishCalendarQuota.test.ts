import { describe, expect, it } from "vitest";
import { subscriptionWeekWindow, usageAvailability } from "./publishCalendarQuota.js";

describe("subscriptionWeekWindow", () => {
  it("anchors repeated seven-day windows to midnight KST on the subscription start date", () => {
    expect(subscriptionWeekWindow({
      subscriptionStartedAt: new Date("2026-08-02T09:37:00+09:00"),
      now: new Date("2026-08-13T10:00:00+09:00"),
    })).toEqual({
      startsAt: new Date("2026-08-09T00:00:00+09:00"),
      endsAt: new Date("2026-08-16T00:00:00+09:00"),
    });
  });

  it("moves an exact boundary into the next subscription week", () => {
    expect(subscriptionWeekWindow({
      subscriptionStartedAt: new Date("2026-08-02T23:59:00+09:00"),
      now: new Date("2026-08-09T00:00:00+09:00"),
    })).toEqual({
      startsAt: new Date("2026-08-09T00:00:00+09:00"),
      endsAt: new Date("2026-08-16T00:00:00+09:00"),
    });
  });

  it("rejects invalid dates and clocks before the subscription instant", () => {
    expect(() => subscriptionWeekWindow({
      subscriptionStartedAt: new Date(Number.NaN),
      now: new Date("2026-08-13T10:00:00+09:00"),
    })).toThrowError("subscription_week_date_invalid");
    expect(() => subscriptionWeekWindow({
      subscriptionStartedAt: new Date("2026-08-02T10:00:00+09:00"),
      now: new Date("2026-08-02T09:59:59+09:00"),
    })).toThrowError("subscription_week_before_start");
  });
});

describe("usageAvailability", () => {
  it("subtracts successes from remaining and successes plus reservations from additional capacity", () => {
    expect(usageAvailability({ limit: 10, succeeded: 4, reserved: 3 })).toEqual({
      limit: 10,
      succeeded: 4,
      reserved: 3,
      remaining: 6,
      additionalAvailable: 3,
    });
  });

  it("clamps exhausted counters and rejects invalid counters", () => {
    expect(usageAvailability({ limit: 3, succeeded: 5, reserved: 2 })).toMatchObject({
      remaining: 0,
      additionalAvailable: 0,
    });
    expect(() => usageAvailability({ limit: 1.5, succeeded: 0, reserved: 0 }))
      .toThrowError("usage_counter_invalid");
    expect(() => usageAvailability({ limit: 1, succeeded: -1, reserved: 0 }))
      .toThrowError("usage_counter_invalid");
  });
});
