import { describe, expect, it, vi } from "vitest";
import { processStyleAnalysisJob } from "./styleAnalysisWorker.js";
import type { StyleAnalysisJob } from "./styleAnalysisContracts.js";

const id = (tail: string) => `10000000-0000-4000-8000-${tail.padStart(12, "0")}`;
const job: StyleAnalysisJob = { jobId: id("1"), workspaceId: id("2"), brandId: id("3"), designStyleId: id("4"), styleRevision: 1, leaseToken: id("5"), leaseExpiresAt: "2026-08-27T12:00:00.000Z", images: [{ referenceItemId: id("6"), storageUrl: "https://blob.example/style.png", storagePath: "style.png", mimeType: "image/png", sizeBytes: 4, checksum: "a".repeat(64) }] };
const analysis = { contractVersion: "design-style-analysis.v1" as const, layout: { composition: [], hierarchy: [], spacing: [], alignment: [], recurringModules: [] }, typography: { families: [], weightHierarchy: [], scale: [], placement: [] }, color: { palette: [], contrast: [], background: [], accentUsage: [] }, graphics: { media: [], shapes: [], icons: [], texture: [] }, visualCues: { comparison: [], humor: [], practicality: [], empathy: [] }, promptGuidance: { use: [], avoid: [] } };

describe("style analysis worker", () => {
  it("completes one model analysis with its bound style revision", async () => {
    const client = { heartbeatStyleAnalysis: vi.fn(), completeStyleAnalysis: vi.fn(), failStyleAnalysis: vi.fn() };
    await expect(processStyleAnalysisJob({ client: client as never, runner: { run: vi.fn(async () => analysis) }, job, workerId: "worker", leaseSeconds: 60, heartbeatMs: 60_000 })).resolves.toEqual({ status: "completed", designStyleId: job.designStyleId });
    expect(client.completeStyleAnalysis).toHaveBeenCalledWith(job, "worker", analysis, expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(client.failStyleAnalysis).not.toHaveBeenCalled();
  });

  it("requeues a transient model failure", async () => {
    const client = {
      heartbeatStyleAnalysis: vi.fn(), completeStyleAnalysis: vi.fn(),
      failStyleAnalysis: vi.fn(async () => true),
    };
    await expect(processStyleAnalysisJob({
      client: client as never,
      runner: { run: vi.fn(async () => { throw new Error("design_style_analysis_timeout"); }) },
      job, workerId: "worker", leaseSeconds: 60, heartbeatMs: 60_000,
    })).resolves.toEqual({ status: "failed", designStyleId: job.designStyleId });
    expect(client.failStyleAnalysis).toHaveBeenCalledWith(
      job, "worker", "design_style_analysis_timeout", true,
    );
  });

  it("terminalizes an invalid analysis contract", async () => {
    const client = {
      heartbeatStyleAnalysis: vi.fn(), completeStyleAnalysis: vi.fn(),
      failStyleAnalysis: vi.fn(async () => true),
    };
    await processStyleAnalysisJob({
      client: client as never,
      runner: { run: vi.fn(async () => { throw new Error("design_style_analysis_v1_invalid"); }) },
      job, workerId: "worker", leaseSeconds: 60, heartbeatMs: 60_000,
    });
    expect(client.failStyleAnalysis).toHaveBeenCalledWith(
      job, "worker", "design_style_analysis_v1_invalid", false,
    );
  });
});
