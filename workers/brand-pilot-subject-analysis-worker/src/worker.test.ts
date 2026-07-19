import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SubjectAnalysisJob, SubjectAnalysisResult, SubjectWorkerClient } from "./contracts.js";
import { SubjectAnalysisApiError } from "./client.js";
import { buildSubjectAnalysisChildEnv, createCodexRunner, processSubjectAnalysisJob, runSubjectAnalysisOnce, terminateProcessTree, type SubjectAnalysisRunner } from "./worker.js";
import { SubjectAnalysisContractError } from "./result.js";

const job: SubjectAnalysisJob = {
  analysisId: "analysis-1", workerId: "worker-1", leaseToken: "lease-1", leaseExpiresAt: "2026-07-20T00:00:00Z", contractVersion: "subject-analysis.v1",
  brand: { name: "브랜드", primaryCategory: "생활", subcategories: [], brandColor: "파란색" },
  subject: { type: "service", sourceUrl: "https://example.com/service", manualInput: { name: "서비스", promotion: "", description: "설명" } },
  extracted: { facts: [], structuredData: {}, imageCandidates: [] },
  researchPolicy: { publicWebSearch: true, allowedPurposes: ["voc", "alternatives", "market_context"], requireSourceUrl: true },
};
const result = { contractVersion: "subject-analysis-result.v1" } as SubjectAnalysisResult;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  vi.useRealTimers();
});

function validResult() {
  const target = (id: string) => ({ id, name: id, traits: ["특성"], painPoints: ["문제"], purchaseMotivations: ["동기"], uspEvidence: [{ claim: "근거", support: "설명", sourceUrl: "https://example.com/product" }] });
  const appeal = (id: string, targetId: string) => ({ id, targetId, title: id, description: "설명", evidenceType: "product_fact", connectionReason: "연결", sources: [{ title: "상품 페이지", url: "https://example.com/product" }] });
  return { contractVersion: "subject-analysis-result.v1", summary: "요약", needs: [{ text: "필요", sourceUrl: "https://example.com/voc" }], alternatives: [{ name: "대안", strengths: ["장점"], limitations: ["한계"], sourceUrls: ["https://example.com/alternative"] }], voc: [{ quoteSummary: "표현", context: "맥락", sourceUrl: "https://example.com/voc" }], usps: [{ claim: "주장", support: "근거", sourceUrl: "https://example.com/product" }], targets: [target("t1"), target("t2"), target("t3")], appealsByTarget: { t1: [appeal("a1", "t1"), appeal("a2", "t1")], t2: [appeal("a3", "t2"), appeal("a4", "t2")], t3: [appeal("a5", "t3"), appeal("a6", "t3")] }, recommendedImageId: null, sourceGaps: [] };
}

function client(overrides: Partial<SubjectWorkerClient> = {}): SubjectWorkerClient {
  return { claim: vi.fn(async () => job), heartbeat: vi.fn(async () => undefined), complete: vi.fn(async () => undefined), fail: vi.fn(async () => undefined), ...overrides };
}

describe("subject analysis worker", () => {
  it("processes one leased job and heartbeats only during execution", async () => {
    const api = client();
    const runner: SubjectAnalysisRunner = { run: vi.fn(async () => result) };
    const output = await processSubjectAnalysisJob({ client: api, runner, job, leaseSeconds: 900, heartbeatMs: 60_000 });
    expect(output).toEqual({ status: "completed", analysisId: "analysis-1" });
    expect(api.complete).toHaveBeenCalledWith(job, result, 900);
    expect(api.fail).not.toHaveBeenCalled();
  });

  it("marks contract failures non-retryable", async () => {
    const api = client();
    const runner: SubjectAnalysisRunner = { run: vi.fn(async () => { throw new SubjectAnalysisContractError("subject_analysis_contract_invalid"); }) };
    await processSubjectAnalysisJob({ client: api, runner, job, leaseSeconds: 900 });
    expect(api.fail).toHaveBeenCalledWith(job, expect.objectContaining({ retryable: false }));
  });

  it("marks explicit API non-retryable errors non-retryable", async () => {
    const api = client();
    const runner: SubjectAnalysisRunner = { run: vi.fn(async () => { throw new SubjectAnalysisApiError("bad request", 400); }) };
    await processSubjectAnalysisJob({ client: api, runner, job, leaseSeconds: 900 });
    expect(api.fail).toHaveBeenCalledWith(job, expect.objectContaining({ retryable: false }));
  });

  it("does not run a CLI when the queue is empty", async () => {
    const api = client({ claim: vi.fn(async () => null) });
    const runner = { run: vi.fn() };
    const output = await runSubjectAnalysisOnce({ client: api, runner, workerId: "worker-1", leaseSeconds: 900, pollMs: 1, wait: vi.fn(async () => undefined) });
    expect(output.status).toBe("idle");
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("copies the subject analysis skill into the actual Codex runtime", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "subject-analysis-worker-"));
    temporaryDirectories.push(root);
    const skillPath = path.join(root, "SKILL.md");
    await writeFile(skillPath, "# subject-analysis runtime skill\n", "utf8");
    const spawnProcess = vi.fn(async (_command: string, args: string[], _timeoutMs: number, env?: NodeJS.ProcessEnv) => {
      const runtimeDirectory = args.find((arg) => arg.startsWith("--runtime-dir="))!.slice("--runtime-dir=".length);
      const outputFile = args.find((arg) => arg.startsWith("--output-file="))!.slice("--output-file=".length);
      expect(await readFile(path.join(runtimeDirectory, ".agents", "skills", "subject-analysis", "SKILL.md"), "utf8")).toContain("runtime skill");
      expect(env).not.toHaveProperty("DATABASE_URL");
      await writeFile(outputFile, JSON.stringify(validResult()), "utf8");
    });
    const runner = createCodexRunner({ runtimeRoot: path.join(root, "runtime"), skillPath, spawnProcess });
    await expect(runner.run(job)).resolves.toMatchObject({ contractVersion: "subject-analysis-result.v1" });
  });

  it("does not overlap heartbeat requests", async () => {
    vi.useFakeTimers();
    let releaseHeartbeat!: () => void;
    const heartbeat = vi.fn(() => new Promise<void>((resolve) => { releaseHeartbeat = resolve; }));
    let releaseRun!: (value: SubjectAnalysisResult) => void;
    const runner = { run: vi.fn(() => new Promise<SubjectAnalysisResult>((resolve) => { releaseRun = resolve; })) };
    const processing = processSubjectAnalysisJob({ client: client({ heartbeat }), runner, job, leaseSeconds: 900, heartbeatMs: 10 });
    await vi.advanceTimersByTimeAsync(30);
    expect(heartbeat).toHaveBeenCalledTimes(1);
    releaseHeartbeat();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10);
    expect(heartbeat).toHaveBeenCalledTimes(2);
    releaseRun(result);
    await processing;
  });

  it("terminates the entire process tree on Windows and POSIX", async () => {
    const windowsExec = vi.fn((...args: unknown[]) => {
      (args[3] as (error: null, stdout: string, stderr: string) => void)(null, "", "");
      return {} as never;
    });
    await terminateProcessTree({ pid: 123, kill: vi.fn() }, { platform: "win32", execFileImpl: windowsExec as never });
    expect(windowsExec).toHaveBeenCalledWith("taskkill", ["/PID", "123", "/T", "/F"], { windowsHide: true }, expect.any(Function));
    const killImpl = vi.fn();
    await terminateProcessTree({ pid: 456, kill: vi.fn() }, { platform: "linux", killImpl: killImpl as never });
    expect(killImpl).toHaveBeenCalledWith(-456, "SIGKILL");
  });

  it("passes only allowlisted environment variables to Codex", () => {
    expect(buildSubjectAnalysisChildEnv({ PATH: "bin", CODEX_HOME: "codex", DATABASE_URL: "secret", WORKER_API_TOKEN: "secret" })).toEqual({ PATH: "bin", CODEX_HOME: "codex" });
  });
});
