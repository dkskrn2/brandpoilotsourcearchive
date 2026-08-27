import { describe, expect, it } from "vitest";
import { parseStyleAnalysisJob } from "./styleAnalysisContracts.js";

const id = (tail: string) => `10000000-0000-4000-8000-${tail.padStart(12, "0")}`;
const job = { jobId: id("1"), workspaceId: id("2"), brandId: id("3"), designStyleId: id("4"), styleRevision: 1, leaseToken: id("5"), leaseExpiresAt: "2026-08-27T12:00:00.000Z", images: [{ referenceItemId: id("6"), storageUrl: "https://blob.example/style.png", storagePath: "style.png", mimeType: "image/png", sizeBytes: 4, checksum: "a".repeat(64) }] };

describe("style analysis contracts", () => {
  it("accepts a closed, bounded image claim", () => expect(parseStyleAnalysisJob(job)).toMatchObject({ styleRevision: 1 }));
  it("rejects oversized and non-image claims", () => {
    expect(() => parseStyleAnalysisJob({ ...job, images: [{ ...job.images[0], sizeBytes: 6 * 1024 * 1024 }] })).toThrow("design_style_analysis_claim_invalid");
    expect(() => parseStyleAnalysisJob({ ...job, images: [{ ...job.images[0], mimeType: "application/pdf" }] })).toThrow("design_style_analysis_claim_invalid");
  });
});
