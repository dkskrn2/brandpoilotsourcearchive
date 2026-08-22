import { describe, expect, it } from "vitest";
import {
  automaticSlotKey,
  batchSlotIdentity,
  batchSlotKey,
  manualSlotIdentity,
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

  it("persists manual request identity separately from the immutable source identity", () => {
    const generation = manualSlotIdentity(" request-1 ", {
      kind: "existing_generation",
      generationId: "generation-1",
    });
    const output = manualSlotIdentity("request-1", {
      kind: "existing_output",
      generationOutputId: "output-1",
    });

    expect(generation.key).toMatch(/^manual:v2:[0-9a-f]{64}:[0-9a-f]{64}$/);
    expect(generation.key.length).toBeLessThanOrEqual(200);
    expect(generation.prefix).toBe(output.prefix);
    expect(generation.key).not.toBe(output.key);
    expect(generation.legacyKey).toBe(manualSlotKey("request-1"));
  });

  it("scopes batch row identity by batch key and row id before adding source identity", () => {
    const first = batchSlotIdentity("batch-1", " row-1 ", {
      kind: "existing_generation",
      generationId: "generation-1",
    });
    const changedSource = batchSlotIdentity("batch-1", "row-1", {
      kind: "existing_generation",
      generationId: "generation-2",
    });
    const otherRow = batchSlotIdentity("batch-1", "row-2", {
      kind: "existing_generation",
      generationId: "generation-1",
    });

    expect(first.prefix).toBe(changedSource.prefix);
    expect(first.key.length).toBeLessThanOrEqual(200);
    expect(first.key).not.toBe(changedSource.key);
    expect(first.prefix).not.toBe(otherRow.prefix);
    expect(first.legacyKey).toBe(batchSlotKey("batch-1", "row-1"));
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
