import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  SubjectAnalysisJob,
  SubjectAnalysisJobV2,
  SubjectAnalysisResult,
  SubjectAppealJobV2,
  SubjectAppealResultV2,
  SubjectWorkerClient,
} from "./contracts.js";
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
const attachmentId = "123e4567-e89b-42d3-a456-426614174000";
const foreignAttachmentId = "123e4567-e89b-42d3-a456-426614174001";
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

function analysisJobV2(type: "product" | "service" = "product"): SubjectAnalysisJobV2 {
  return {
    analysisId: "analysis-v2",
    workerId: "worker-1",
    leaseToken: "lease-v2",
    leaseExpiresAt: "2026-07-22T00:03:00.000Z",
    contractVersion: "subject-analysis.v2",
    phase: "analysis",
    brandContext: { name: "브랜드" },
    subject: {
      type,
      sourceUrl: `https://example.com/${type}`,
      attachmentIds: [attachmentId],
      manualInput: { name: "대상", promotionOrTerms: "", description: "설명" },
    },
    extracted: { documents: [], images: [], sourcePage: null, sourceGaps: [] },
    sourcePriority: ["manual_input", "attachments", "source_url", "brand_context", "public_research"],
  };
}

function validAnalysisResultV2(sourceAttachmentId = attachmentId) {
  return {
    contractVersion: "subject-analysis-result.v2" as const,
    phase: "analysis" as const,
    subjectType: "product" as const,
    summary: "제품 분석",
    verifiedFacts: [{ claim: "소재", support: "첨부 확인", sourceUrl: `attachment://${sourceAttachmentId}` }],
    voc: [],
    alternatives: [],
    barriers: [],
    productProfile: {
      name: "정리함",
      category: "생활용품",
      specifications: ["중형"],
      materials: ["재생 플라스틱"],
      options: ["파란색"],
      price: "직접 입력 가격",
      discountsAndPromotions: [],
      shipping: [],
      returns: [],
      functions: [{ function: "분리 수납", benefit: "정리 편의", purchaseReason: "반복 정리" }],
      useContexts: ["책상"],
      purchaseBarriers: ["크기"],
      reviewPatterns: { recurringSatisfaction: [], recurringComplaints: [] },
      productImageCandidates: [],
      detailImageCandidates: [],
    },
    serviceProfile: null,
    serviceSubtype: null,
    sourceGaps: [],
  };
}

function appealJobV2(): SubjectAppealJobV2 {
  const analysisJob = analysisJobV2();
  return {
    analysisId: analysisJob.analysisId,
    workerId: analysisJob.workerId,
    leaseToken: analysisJob.leaseToken,
    leaseExpiresAt: analysisJob.leaseExpiresAt,
    contractVersion: "subject-analysis.v2",
    phase: "appeal",
    brandContext: analysisJob.brandContext,
    subject: analysisJob.subject,
    analysisResult: validAnalysisResultV2(),
    sourcePriority: analysisJob.sourcePriority,
  };
}

function validAppealResultV2(): SubjectAppealResultV2 {
  const target = (id: string) => ({ id, name: id, traits: ["특성"], painPoints: ["문제"], purchaseMotivations: ["동기"], uspEvidence: [{ claim: "근거", support: "설명", sourceUrl: "https://example.com/evidence" }] });
  const appeal = (id: string, targetId: string) => ({ id, targetId, title: id, description: "설명", evidenceType: "product_fact" as const, connectionReason: "연결", sources: [{ title: "근거", url: "https://example.com/evidence" }] });
  return {
    contractVersion: "subject-appeal-result.v2",
    phase: "appeal",
    targets: [target("t1"), target("t2"), target("t3")],
    appealsByTarget: {
      t1: [appeal("a1", "t1"), appeal("a2", "t1")],
      t2: [appeal("a3", "t2"), appeal("a4", "t2")],
      t3: [appeal("a5", "t3"), appeal("a6", "t3")],
    },
  };
}

async function runnerWithOutput(output: unknown) {
  const root = await mkdtemp(path.join(os.tmpdir(), "subject-analysis-worker-v2-"));
  temporaryDirectories.push(root);
  const skillPath = path.join(root, "SKILL.md");
  await writeFile(skillPath, "# subject-analysis runtime skill\n", "utf8");
  const spawnProcess = vi.fn(async (_command: string, args: string[]) => {
    const outputFile = args.find((arg) => arg.startsWith("--output-file="))!.slice("--output-file=".length);
    await writeFile(outputFile, JSON.stringify(output), "utf8");
  });
  return createCodexRunner({ runtimeRoot: path.join(root, "runtime"), skillPath, spawnProcess });
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

  it("parses v2 analysis output with the job subject type", async () => {
    const runner = await runnerWithOutput({
      ...validAnalysisResultV2(),
      subjectType: "service",
      productProfile: null,
      serviceProfile: {},
      serviceSubtype: "other_service",
    });

    await expect(runner.run(analysisJobV2("product"))).rejects.toThrow("subject_analysis_subject_type_mismatch");
  });

  it("allows only job attachment IDs in v2 analysis output", async () => {
    const runner = await runnerWithOutput(validAnalysisResultV2(foreignAttachmentId));

    await expect(runner.run(analysisJobV2())).rejects.toThrow("subject_analysis_attachment_not_allowed");
  });

  it("uses the strict appeal result parser for appeal jobs", async () => {
    const output = validAppealResultV2();
    output.appealsByTarget.t3[0].id = "a1";
    const runner = await runnerWithOutput(output);

    await expect(runner.run(appealJobV2())).rejects.toThrow("subject_analysis_appeal_id_duplicate");
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
