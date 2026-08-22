import { describe, expect, it } from "vitest";
import {
  automaticSlotKey,
  batchSlotKey,
  manualSlotKey,
  normalizeCalendarChannels,
} from "./publishCalendarIdempotency.js";

describe("publish calendar idempotency keys", () => {
  it("normalizes a manual request into a deterministic namespaced digest", () => {
    expect(manualSlotKey(" request-1 ")).toMatch(/^manual:v1:[0-9a-f]{64}$/);
    expect(manualSlotKey(" request-1 ")).toBe(manualSlotKey("request-1"));
  });

  it("keeps structured batch key components unambiguous", () => {
    expect(batchSlotKey("a:b", "c")).not.toBe(batchSlotKey("a", "b:c"));
  });

  it("distinguishes repeated automatic occurrences at the same time", () => {
    expect(automaticSlotKey({ kstDate: "2026-08-21", time: "11:30", occurrence: 0 }))
      .not.toBe(automaticSlotKey({ kstDate: "2026-08-21", time: "11:30", occurrence: 1 }));
  });

  it("deduplicates and sorts calendar channels", () => {
    expect(normalizeCalendarChannels(["instagram", "instagram"])).toEqual(["instagram"]);
  });

  it("rejects blank or oversized manual request keys", () => {
    expect(() => manualSlotKey("   ")).toThrow("publish_calendar_idempotency_key_invalid");
    expect(() => manualSlotKey("x".repeat(201))).toThrow("publish_calendar_idempotency_key_invalid");
  });
});
