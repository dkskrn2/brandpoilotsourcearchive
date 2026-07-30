import { describe, expect, it } from "vitest";
import { buildEvidenceBatches } from "./documentPipeline.js";

describe("evidence batching", () => {
  it("creates stable <=20k segments and four <=100k batches under 400k", () => {
    const documents = Array.from({ length: 20 }, (_, index) => ({
      sourceId: `source-${index}`,
      sourceType: "owned_url" as const,
      title: `문서 ${index}`,
      sourceUrl: `https://example.com/${index}`,
      textBlocks: [{ heading: "소개", text: `문장 ${"가".repeat(24_000)}` }],
      tables: [],
      contentHash: `${index}`.padStart(64, "0"),
    }));
    const result = buildEvidenceBatches(documents);
    expect(result.batches).toHaveLength(4);
    expect(result.segments.every(({ text }) => text.length <= 20_000)).toBe(true);
    expect(result.batches.every((batch) => batch.characterCount <= 100_000)).toBe(true);
    expect(result.characterCount).toBeLessThanOrEqual(400_000);
    expect(buildEvidenceBatches(documents).segments.map(({ id }) => id))
      .toEqual(result.segments.map(({ id }) => id));
  });
});
