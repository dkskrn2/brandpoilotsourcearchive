import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import type { BrandAnalysisJob, BrandIntelligenceResult, BrandIntelligenceWorkerClient } from "./contracts.js";
import { BrandIntelligenceApiError } from "./client.js";
import { buildBrandIntelligencePrompt } from "./promptBuilder.js";
import { BrandIntelligenceContractError } from "./result.js";
import {
  buildBrandIntelligenceChildEnv,
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
  leaseExpiresAt: "2026-07-21T00:00:00.000Z",
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
    claim: vi.fn(async () => job),
    heartbeat: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("brand intelligence worker", () => {
  it("builds a Korean evidence-grounded public research prompt", () => {
    const prompt = buildBrandIntelligencePrompt(job);
    expect(prompt).toContain("기업 개요");
    expect(prompt).toContain("공개 웹검색");
    expect(prompt).toContain("근거 URL");
    expect(prompt).toContain("brand-intelligence-result.v1");
  });

  it("completes one leased analysis", async () => {
    const api = client();
    const runner: BrandIntelligenceRunner = { run: vi.fn(async () => result) };
    await expect(processBrandIntelligenceJob({ client: api, runner, job, leaseSeconds: 900 }))
      .resolves.toEqual({ status: "completed", analysisId: "analysis-1" });
    expect(api.complete).toHaveBeenCalledWith(job, result, 900);
  });

  it("does not retry invalid model output", async () => {
    const api = client();
    const runner: BrandIntelligenceRunner = {
      run: vi.fn(async () => { throw new BrandIntelligenceContractError("brand_intelligence_result_invalid"); }),
    };
    await processBrandIntelligenceJob({ client: api, runner, job, leaseSeconds: 900 });
    expect(api.fail).toHaveBeenCalledWith(job, expect.objectContaining({ retryable: false }));
  });

  it("honors retryable API failures", async () => {
    const api = client();
    const runner: BrandIntelligenceRunner = {
      run: vi.fn(async () => { throw new BrandIntelligenceApiError("timeout", 503); }),
    };
    await processBrandIntelligenceJob({ client: api, runner, job, leaseSeconds: 900 });
    expect(api.fail).toHaveBeenCalledWith(job, expect.objectContaining({ retryable: true }));
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
    })).toEqual({ PATH: "bin", CODEX_HOME: "codex" });
  });

  it("enables live web search as a top-level Codex option", async () => {
    const script = await readFile(new URL("../scripts/run-codex-brand-intelligence.mjs", import.meta.url), "utf8");
    expect(script).toContain('"--search",\n  "exec"');
  });
});
