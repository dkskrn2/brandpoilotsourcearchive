import { createHash } from "node:crypto";
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

  it("hashes only the stable weekly entry id and KST occurrence date", () => {
    const scheduleEntryId = "30000000-0000-4000-8000-000000000001";
    const expected = createHash("sha256")
      .update(JSON.stringify(["weekly-auto", scheduleEntryId, "2026-08-21"]))
      .digest("hex");

    expect(automaticSlotKey({ scheduleEntryId, kstDate: "2026-08-21" })).toBe(expected);
    expect(automaticSlotKey({
      scheduleEntryId: "30000000-0000-4000-8000-000000000002",
      kstDate: "2026-08-21",
    })).not.toBe(expected);
  });

  it("deduplicates and sorts calendar channels", () => {
    expect(normalizeCalendarChannels(["instagram", "instagram"])).toEqual(["instagram"]);
  });

  it("rejects blank or oversized manual request keys", () => {
    expect(() => manualSlotKey("   ")).toThrow("publish_calendar_idempotency_key_invalid");
    expect(() => manualSlotKey("x".repeat(201))).toThrow("publish_calendar_idempotency_key_invalid");
  });
});
