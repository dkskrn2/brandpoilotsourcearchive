import { describe, expect, it } from "vitest";
import { parseResearchSourceAcquisitionV1 } from "./researchSourceAcquisition.js";

const base = {
  contractVersion: "research-source-acquisition.v1",
  status: "partial_body",
  requestedUrl: "https://publisher.example/article",
  canonicalUrl: "https://publisher.example/article",
  contentHash: "a".repeat(64),
  capturedAt: "2026-08-18T00:00:00.000Z",
} as const;

describe("research source acquisition v1", () => {
  it.each([
    "complete_body",
    "partial_body",
    "metadata_only",
    "access_failed",
    "indeterminate",
  ] as const)("accepts the exact URL acquisition status %s", (status) => {
    expect(parseResearchSourceAcquisitionV1({ ...base, status })).toEqual({ ...base, status });
  });

  it("accepts an exact non-URL acquisition marker", () => {
    expect(parseResearchSourceAcquisitionV1({
      contractVersion: "research-source-acquisition.v1",
      status: "not_applicable",
      requestedUrl: null,
      canonicalUrl: null,
      contentHash: null,
      capturedAt: "2026-08-18T00:00:00.000Z",
    })).toEqual({
      contractVersion: "research-source-acquisition.v1",
      status: "not_applicable",
      requestedUrl: null,
      canonicalUrl: null,
      contentHash: null,
      capturedAt: "2026-08-18T00:00:00.000Z",
    });
  });

  it("rejects unknown keys, mixed URL/null fields, credentials and invalid hashes", () => {
    expect(() => parseResearchSourceAcquisitionV1({ ...base, fallback: true })).toThrow(
      "research_source_acquisition_invalid",
    );
    expect(() => parseResearchSourceAcquisitionV1({ ...base, canonicalUrl: null })).toThrow(
      "research_source_acquisition_invalid",
    );
    expect(() => parseResearchSourceAcquisitionV1({
      ...base,
      requestedUrl: "https://user:secret@publisher.example/article",
    })).toThrow("research_source_acquisition_invalid");
    expect(() => parseResearchSourceAcquisitionV1({ ...base, contentHash: "not-a-hash" })).toThrow(
      "research_source_acquisition_invalid",
    );
  });

  it("returns a clone rather than the caller-owned object", () => {
    const source = { ...base };
    const parsed = parseResearchSourceAcquisitionV1(source);
    expect(parsed).not.toBe(source);
  });
});
