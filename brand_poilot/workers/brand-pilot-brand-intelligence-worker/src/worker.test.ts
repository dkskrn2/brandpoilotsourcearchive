import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BrandAnalysisJob, BrandIntelligenceResult, BrandIntelligenceWorkerClient } from "./contracts.js";
import { BrandIntelligenceApiError } from "./client.js";
import { BrandIntelligenceContractError } from "./result.js";
import {
  buildBrandIntelligenceChildEnv,
  createCodexRunner,
  processBrandIntelligenceJob,
  runBrandIntelligenceOnce,
  runBrandIntelligenceWatchIteration,
  type BrandIntelligenceRunner,
} from "./worker.js";

const job: BrandAnalysisJob = {
  id: "analysis-1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  status: "analyzing",
  input: { ownedUrl: "https://example.com", uploadIds: [] },
  evidence: [{
    sourceId: "owned-url",
    sourceType: "owned_url",
    title: "회사 소개",
    sourceUrl: "https://example.com",
    textBlocks: [{ heading: "사업", text: "콘텐츠 운영 서비스" }],
    tables: [],
    contentHash: "a".repeat(64),
  }],
  result: null,
  editedResult: null,
  effectiveResult: null,
  idempotencyKey: "request-1",
  isActive: false,
  leasedBy: "worker-1",
  leaseToken: "lease-1",
  leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  attemptCount: 1,
  availableAt: "2026-07-21T00:00:00.000Z",
  errorCode: null,
  errorMessage: null,
  createdAt: "2026-07-21T00:00:00.000Z",
  updatedAt: "2026-07-21T00:00:00.000Z",
  completedAt: null,
  confirmedAt: null,
};

const result = {
  contractVersion: "brand-intelligence-result.v1",
  companyOverview: "회사 개요",
  businessDescription: "사업 소개",
  primaryCategory: { code: null, name: "마케팅" },
  subcategories: [{ code: null, name: "콘텐츠 운영" }],
  primaryTarget: "중소 브랜드 담당자",
  differentiators: "브랜드 자료 기반 자동화",
  coreAppeal: "반복 운영 시간 절감",
  competitors: [{ name: "경쟁사", description: "설명", sourceUrls: ["https://competitor.example.com"] }],
  evidence: [{ field: "businessDescription", claim: "콘텐츠 운영 서비스", sourceId: "owned-url", sourceUrl: "https://example.com" }],
  sourceGaps: [],
} satisfies BrandIntelligenceResult;

function client(overrides: Partial<BrandIntelligenceWorkerClient> = {}): BrandIntelligenceWorkerClient {
  return {
    cleanup: vi.fn(async () => undefined),
    acquireResource: vi.fn(async () => ({
      id: "resource-1",
      leaseToken: "resource-token-1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })),
    heartbeatResource: vi.fn(async () => undefined),
    releaseResource: vi.fn(async () => undefined),
    claim: vi.fn(async () => job),
    heartbeat: vi.fn(async () => undefined),
    progress: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
    cancelled: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("brand intelligence worker", () => {
  it("completes one leased analysis", async () => {
    const api = client();
    const runner: BrandIntelligenceRunner = { run: vi.fn(async () => result) };
    await expect(processBrandIntelligenceJob({ client: api, runner, job, leaseSeconds: 900 }))
      .resolves.toEqual({ status: "completed", analysisId: "analysis-1" });
    expect(api.complete).toHaveBeenCalledWith(job, result, job.evidence, 900, undefined);
  });

  it("does not retry invalid model output", async () => {
    const api = client();
    const runner: BrandIntelligenceRunner = {
      run: vi.fn(async () => { throw new BrandIntelligenceContractError("brand_intelligence_result_invalid"); }),
    };
    await processBrandIntelligenceJob({ client: api, runner, job, leaseSeconds: 900 });
    expect(api.fail).toHaveBeenCalledWith(job, expect.objectContaining({ retryable: false }));
  });

  it("preserves a terminal semantic validation error across the child boundary", async () => {
    const runtimeRoot = await mkdtemp(path.join(tmpdir(), "brand-intelligence-terminal-error-"));
    const runner = createCodexRunner({
      runtimeRoot,
      spawnProcess: async (_command, args) => {
        const errorArgument = args.find((arg) => arg.startsWith("--error-file="));
        if (!errorArgument) throw new Error("missing_error_file_argument");
        await writeFile(errorArgument.slice("--error-file=".length), JSON.stringify({
          kind: "contract",
          errorCode: "brand_intelligence_evidence_quote_mismatch",
        }), "utf8");
        throw new Error("brand_intelligence_codex_process_failed:1");
      },
    });

    try {
      await expect(runner.run(job)).rejects.toMatchObject({
        name: "BrandIntelligenceContractError",
        message: "brand_intelligence_evidence_quote_mismatch",
      });
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  it("honors retryable API failures", async () => {
    const api = client();
    const runner: BrandIntelligenceRunner = {
      run: vi.fn(async () => { throw new BrandIntelligenceApiError("timeout", 503); }),
    };
    await processBrandIntelligenceJob({ client: api, runner, job, leaseSeconds: 900 });
    expect(api.fail).toHaveBeenCalledWith(job, expect.objectContaining({ retryable: true }));
  });

  it("fails closed and aborts active work when the lease heartbeat is lost", async () => {
    const api = client({
      heartbeat: vi.fn(async () => {
        throw new BrandIntelligenceApiError("brand_analysis_cancelled", 409);
      }),
    });
    const runner: BrandIntelligenceRunner = {
      run: vi.fn(async (_job, signal) => new Promise<BrandIntelligenceResult>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      })),
    };

    await expect(processBrandIntelligenceJob({
      client: api,
      runner,
      job,
      leaseSeconds: 900,
      heartbeatMs: 1,
    })).resolves.toEqual({ status: "failed", analysisId: "analysis-1" });
    expect(runner.run).toHaveBeenCalledWith(
      job,
      expect.any(AbortSignal),
      expect.any(Function),
    );
  });

  it("never invokes the runner for an already expired job lease", async () => {
    const expiredJob = { ...job, leaseExpiresAt: new Date(Date.now() - 1).toISOString() };
    const api = client();
    const runner: BrandIntelligenceRunner = { run: vi.fn(async () => result) };

    await expect(processBrandIntelligenceJob({
      client: api,
      runner,
      job: expiredJob,
      leaseSeconds: 900,
    })).resolves.toEqual({ status: "failed", analysisId: "analysis-1" });

    expect(runner.run).not.toHaveBeenCalled();
    expect(api.complete).not.toHaveBeenCalled();
  });

  it("stops an in-flight heartbeat retry when the job completes", async () => {
    vi.useFakeTimers();
    const leasedJob = { ...job, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() };
    const heartbeat = vi.fn(async () => {
      throw new BrandIntelligenceApiError("brand_intelligence_api_failed:503", 503);
    });
    const api = client({ heartbeat });
    const runner: BrandIntelligenceRunner = {
      run: vi.fn(async () => new Promise<BrandIntelligenceResult>((resolve) => {
        setTimeout(() => resolve(result), 1_500);
      })),
    };

    const outcome = processBrandIntelligenceJob({
      client: api,
      runner,
      job: leasedJob,
      leaseSeconds: 900,
      heartbeatMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(1_500);
    await expect(outcome).resolves.toEqual({ status: "completed", analysisId: "analysis-1" });
    const callsAtCompletion = heartbeat.mock.calls.length;

    await vi.advanceTimersByTimeAsync(3_000);

    expect(heartbeat).toHaveBeenCalledTimes(callsAtCompletion);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("continues the same runner after a transient job heartbeat 503 recovers", async () => {
    vi.useFakeTimers();
    const leasedJob = { ...job, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() };
    const heartbeat = vi.fn()
      .mockRejectedValueOnce(new BrandIntelligenceApiError("brand_intelligence_api_failed:503", 503))
      .mockResolvedValue(undefined);
    const api = client({ heartbeat });
    const runner: BrandIntelligenceRunner = {
      run: vi.fn(async (_job, signal) => new Promise<BrandIntelligenceResult>((resolve, reject) => {
        const timer = setTimeout(() => resolve(result), 3_000);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(signal.reason);
        }, { once: true });
      })),
    };

    const outcome = processBrandIntelligenceJob({
      client: api,
      runner,
      job: leasedJob,
      leaseSeconds: 900,
      heartbeatMs: 1_000,
    });
    void outcome.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(outcome).resolves.toEqual({ status: "completed", analysisId: "analysis-1" });
    expect(runner.run).toHaveBeenCalledOnce();
    expect(heartbeat.mock.calls.length).toBeGreaterThan(1);
    expect(api.complete).toHaveBeenCalledOnce();
    expect(api.fail).not.toHaveBeenCalled();
  });

  it("uses the API's exact renewed job lease expiry", async () => {
    vi.useFakeTimers();
    const exactExpiry = new Date(Date.now() + 6_000).toISOString();
    const leasedJob = { ...job, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() };
    const heartbeat = vi.fn()
      .mockResolvedValueOnce({ leaseExpiresAt: exactExpiry, deadlineAt: null })
      .mockRejectedValue(new BrandIntelligenceApiError("brand_intelligence_api_failed:503", 503));
    const api = client({
      heartbeat: heartbeat as unknown as BrandIntelligenceWorkerClient["heartbeat"],
    });
    const runner: BrandIntelligenceRunner = {
      run: vi.fn(async (_job, signal) => new Promise<BrandIntelligenceResult>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      })),
    };

    let settled = false;
    const outcome = processBrandIntelligenceJob({
      client: api,
      runner,
      job: leasedJob,
      leaseSeconds: 900,
      heartbeatMs: 1_000,
      activeTimeoutMs: 8_000,
    });
    void outcome.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(7_000);
    const settledBeforeFallbackDeadline = settled;
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(outcome).resolves.toEqual({ status: "failed", analysisId: "analysis-1" });
    expect(settledBeforeFallbackDeadline).toBe(true);
  });

  it("retries an idempotent progress write without rerunning the CLI", async () => {
    vi.useFakeTimers();
    const leasedJob = { ...job, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() };
    const progress = vi.fn()
      .mockRejectedValueOnce(new BrandIntelligenceApiError("brand_intelligence_api_failed:503", 503))
      .mockResolvedValue(undefined);
    const api = client({ progress });
    const runner: BrandIntelligenceRunner = {
      run: vi.fn(async (_job, _signal, onProgress) => {
        await onProgress?.({
          stage: "owned_facts_1",
          status: "succeeded",
          logicalIndex: 1,
          physicalAttempt: 1,
          inputCount: 1,
          successCount: 1,
          failedCount: 0,
        });
        return result;
      }),
    };

    const outcome = processBrandIntelligenceJob({
      client: api,
      runner,
      job: leasedJob,
      leaseSeconds: 900,
      heartbeatMs: 60_000,
    });
    void outcome.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(outcome).resolves.toEqual({ status: "completed", analysisId: "analysis-1" });
    expect(runner.run).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenCalledTimes(2);
    expect(api.complete).toHaveBeenCalledOnce();
    expect(api.fail).not.toHaveBeenCalled();
  });

  it("does not invoke the CLI when no job exists", async () => {
    const api = client({ claim: vi.fn(async () => null) });
    const runner = { run: vi.fn() };
    await expect(runBrandIntelligenceOnce({
      client: api, runner, workerId: "worker-1", leaseSeconds: 900,
      pollMs: 1, wait: vi.fn(async () => undefined),
    })).resolves.toEqual({ status: "idle" });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("keeps watch mode alive after a transient API failure", async () => {
    const wait = vi.fn(async () => undefined);
    const onError = vi.fn();
    const runOnce = vi.fn(async () => {
      throw new BrandIntelligenceApiError("fetch failed", 503);
    });

    await expect(runBrandIntelligenceWatchIteration({
      runOnce,
      pollMs: 1_000,
      wait,
      onError,
    })).resolves.toEqual({ status: "retrying" });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "fetch failed" }));
    expect(wait).toHaveBeenCalledWith(1_000);
  });

  it("passes only allowlisted values to Codex", () => {
    expect(buildBrandIntelligenceChildEnv({
      PATH: "bin", CODEX_HOME: "codex", DATABASE_URL: "secret", WORKER_API_TOKEN: "secret",
      HTTP_PROXY: "http://proxy.invalid", HTTPS_PROXY: "http://proxy.invalid",
      NO_PROXY: "*",
    })).toEqual({ PATH: "bin", CODEX_HOME: "codex" });
  });

  it("keeps external research fail-closed and isolates every Codex stage", async () => {
    const script = await readFile(new URL("../scripts/run-codex-brand-intelligence.mjs", import.meta.url), "utf8");
    const entrypoint = await readFile(new URL("./index.ts", import.meta.url), "utf8");
    const localEnv = await readFile(new URL("../.env.example", import.meta.url), "utf8");
    const deployEnv = await readFile(new URL("../../../deploy/env/brand-intelligence-worker.env.example", import.meta.url), "utf8");
    expect(script).toContain("ACTIVE_PIPELINE_MS,");
    expect(script).toContain("MAX_PHYSICAL_CLI_CALLS,");
    expect(script).toContain("MAX_RETRY_CLI_CALLS,");
    expect(script).toContain('stageTimeoutMs } from "../dist/limits.js";');
    expect(script).not.toContain("const STAGE_BUDGET_SECONDS =");
    expect(script).not.toContain("const STAGE_RESERVE_SECONDS =");
    expect(script).not.toContain("const MAX_RETRIES =");
    expect(script).toContain("return stageTimeoutMs(stageIndex, remaining);");
    expect(script).toContain("physicalCalls > MAX_PHYSICAL_CLI_CALLS");
    expect(script).toContain("retriesUsed >= MAX_RETRY_CLI_CALLS");
    expect(entrypoint).toContain("codexProcessTimeoutMs(process.env.BRAND_INTELLIGENCE_CODEX_TIMEOUT_MS)");
    expect(entrypoint).not.toContain("?? 900_000");
    expect(localEnv).toContain("BRAND_INTELLIGENCE_CODEX_TIMEOUT_MS=1200000");
    expect(deployEnv).toContain("BRAND_INTELLIGENCE_CODEX_TIMEOUT_MS=1200000");
    expect(script).toContain("External research is fail-closed");
    expect(script).not.toContain("실제로 확인한 HTTPS 페이지만");
    expect(script).toContain('"--disable", "shell_tool"');
    expect(script).toContain('"--disable", "apps"');
    expect(script).toContain('"--ignore-rules"');
    expect(script).not.toContain('"--output-schema"');
    expect(script).not.toContain("outputSchemaFile");
    expect(script).not.toContain("additionalProperties: true");
    expect(script).toContain("codexFailureDiagnostic(stderr, stdout)");
    expect(script).not.toContain("minProperties");
    expect(script).toContain("brand_intelligence_forbidden_tool_event");
    expect(script).toContain('{ quoteMismatch: "drop-fact" }');
    expect(script).toContain("parseOfferingSuggestions");
    expect(script).toContain("companyNameSuggestion");
    expect(script).toContain("faqSuggestions");
    expect(script.match(/invokeStage\(4,/g)).toHaveLength(1);
    expect(script).not.toContain("invokeStage(8,");
    expect(script).toMatch(/const keys = \[\s*"APPDATA", "CODEX_HOME", "COMSPEC", "HOME"/);
  });

  it("counts semantic validation failures inside the bounded Codex retry loop", async () => {
    const script = await readFile(new URL("../scripts/run-codex-brand-intelligence.mjs", import.meta.url), "utf8");
    const validationIndex = script.indexOf("validated = await validate(result);");
    const successIndex = script.indexOf('status: "succeeded"', validationIndex);

    expect(validationIndex).toBeGreaterThan(-1);
    expect(successIndex).toBeGreaterThan(validationIndex);
    expect(script).toContain("const validateOwnedFacts = (response) => {");
    expect(script).toContain("parseOfferingSuggestions, parseOwnedFactEnvelope");
    expect(script).toContain(
      'parseOwnedFactEnvelope(response, registeredSegments, { quoteMismatch: "drop-fact" }).output',
    );
    expect(script).toContain("validate: validateOwnedFacts");
    expect(script).toContain(
      'parseOfferingSuggestions(response, factIds, { registryMismatch: "drop-item" })',
    );
    expect(script).not.toContain("const validateOfferings");
    expect(script).not.toContain("const registeredFactIds");
    expect(script).toContain("id: `owned-${batchIndex + 1}-${ordinal + 1}`");
    expect(script).toContain("allowedFactIds:");
    expect(script).toContain("sourceFactIds는 allowedFactIds의 ID만 정확히 복사");
    expect(script).toContain("근거 ID가 일치하지 않은 회사명 ");
    expect(script).toContain("상품·서비스 ");
    expect(script).toContain("FAQ ");
    expect(script).toContain("trustedSourceGaps");
    expect(script).toContain("validate: validateFinalAudit");
    expect(script).toContain("validateFinalAuditResult(audited");
    expect(script).toContain('kind: "contract"');
    expect(script).toContain("이전 응답 검증 오류");
    expect(script).toContain("sourceUrl이 null인 segment에만 null을 반환하라");
    expect(script).toContain("segment.text의 연속된 부분 문자열을 그대로 복사");
    expect(script).toContain(
      "구두점 변경·생략·재서술하지 말고, 정확히 복사할 수 없으면 fact 전체를 생략",
    );
    expect(script).toContain(
      "supported와 conflicting은 quotes를 1개 이상 넣고 missing은 quotes를 빈 배열",
    );
    expect(script).toContain("droppedOwnedFactCount += parsedFactBatch.droppedCount");
    expect(script).toContain("supportedFacts.length === 0 ? {} : coreResponse");
    expect(script).toContain(
      "JSON.stringify({ companyName: effectiveCompanyName, facts: supportedFacts })",
    );
    expect(script).not.toContain(
      "JSON.stringify({ companyName: effectiveCompanyName, facts })",
    );
    expect(script).toContain("ownedFactSourceGaps");
    expect(script).toContain("scrubbed.sourceGaps");
    expect(script).toContain("oneLineDefinition: null");
    expect(script).toContain("observedTone: null");
    expect(script).toContain(
      "subcategories의 각 항목은 {code:string|null,name:string}, valueProposition은 string|null",
    );
  });

  it("ships the Codex output helper in the runtime image", async () => {
    const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
    expect(dockerfile).toContain(
      "scripts/codex-output.mjs ./workers/brand-pilot-brand-intelligence-worker/scripts/codex-output.mjs",
    );
  });
});
