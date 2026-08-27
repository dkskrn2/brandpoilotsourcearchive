import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createCodexStyleAnalysisRunner, processStyleAnalysisJob } from "./styleAnalysisWorker.js";
import type { StyleAnalysisJob } from "./styleAnalysisContracts.js";

const id = (tail: string) => `10000000-0000-4000-8000-${tail.padStart(12, "0")}`;
const job: StyleAnalysisJob = { jobId: id("1"), workspaceId: id("2"), brandId: id("3"), designStyleId: id("4"), styleRevision: 1, leaseToken: id("5"), leaseExpiresAt: "2026-08-27T12:00:00.000Z", images: [{ referenceItemId: id("6"), storageUrl: "https://blob.example/style.png", storagePath: "style.png", mimeType: "image/png", sizeBytes: 4, checksum: "a".repeat(64) }] };
const analysis = { contractVersion: "design-style-analysis.v1" as const, layout: { composition: [], hierarchy: [], spacing: [], alignment: [], recurringModules: [] }, typography: { families: [], weightHierarchy: [], scale: [], placement: [] }, color: { palette: [], contrast: [], background: [], accentUsage: [] }, graphics: { media: [], shapes: [], icons: [], texture: [] }, visualCues: { comparison: [], humor: [], practicality: [], empathy: [] }, promptGuidance: { use: [], avoid: [] } };

describe("style analysis worker", () => {
  it("aborts a stalled style image download within its configured timeout", async () => {
    const runtimeRoot = await mkdtemp(path.join(tmpdir(), "style-download-timeout-"));
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal;
      if (!signal) throw new Error("missing_abort_signal");
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    try {
      const runner = createCodexStyleAnalysisRunner({
        runtimeRoot,
        downloadTimeoutMs: 10,
        fetchImpl: fetchImpl as typeof fetch,
      });
      await expect(runner.run(job)).rejects.toThrow("design_style_image_download_timeout");
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  it("does not overlap style-analysis heartbeat requests", async () => {
    vi.useFakeTimers();
    let releaseHeartbeat!: () => void;
    let finishRunner!: (value: typeof analysis) => void;
    const heartbeatStyleAnalysis = vi.fn(() => new Promise<void>((resolve) => {
      releaseHeartbeat = resolve;
    }));
    const runnerResult = new Promise<typeof analysis>((resolve) => { finishRunner = resolve; });
    const client = {
      heartbeatStyleAnalysis,
      completeStyleAnalysis: vi.fn(),
      failStyleAnalysis: vi.fn(),
    };
    const outcome = processStyleAnalysisJob({
      client: client as never,
      runner: { run: vi.fn(() => runnerResult) },
      job,
      workerId: "worker",
      leaseSeconds: 60,
      heartbeatMs: 5,
    });
    await vi.advanceTimersByTimeAsync(20);
    const heartbeatCountWhilePending = heartbeatStyleAnalysis.mock.calls.length;
    releaseHeartbeat();
    finishRunner(analysis);
    await outcome;
    vi.useRealTimers();
    expect(heartbeatCountWhilePending).toBe(1);
  });

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
