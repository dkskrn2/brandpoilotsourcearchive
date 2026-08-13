import { describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer.js";
import type { ApiRepository } from "./types.js";
import type { BrandAnalysisClaim, BrandIntelligenceRepository } from "./brandIntelligenceRepository.js";

const analysisId = "33333333-3333-4333-8333-333333333333";
const claim = {
  id: analysisId, workspaceId: "workspace-1", brandId: "brand-1", status: "analyzing",
  input: { companyName: null, ownedUrl: "https://example.com", uploadIds: [] }, evidence: [], result: null,
  editedResult: null, effectiveResult: null, idempotencyKey: "analysis-1", isActive: false,
  leasedBy: "worker-1", leaseToken: "44444444-4444-4444-8444-444444444444",
  leaseExpiresAt: "2099-01-01T00:00:00.000Z", attemptCount: 1,
  pipelineVersion: 1, contractVersion: "brand-intelligence-result.v1",
  currentStage: null, selectedPageCount: 0, successfulPageCount: 0,
  failedPageCount: 0, requiredPageCount: 0, completedCliStageCount: 0,
  totalCliStageCount: 0,
  executionContract: null,
  uploads: [], categoryRegistry: [], activeStartedAt: "2026-07-21T00:00:00.000Z",
  deadlineAt: "2099-01-01T00:00:00.000Z",
  availableAt: "2026-07-21T00:00:00.000Z", errorCode: null, errorMessage: null,
  createdAt: "2026-07-21T00:00:00.000Z", updatedAt: "2026-07-21T00:00:00.000Z",
  completedAt: null, confirmedAt: null,
} as BrandAnalysisClaim;

function setup() {
  const repository = { health: vi.fn(async () => ({ database: "ok" as const })) } as unknown as ApiRepository;
  const intelligence = {
    getBrandCompanyName: vi.fn(async () => ({ name: "__provisional__:user", state: "provisional" as const })),
    getOpenBrandAnalysis: vi.fn(async () => claim),
    getBrandAnalysis: vi.fn(async () => claim),
    requestBrandAnalysis: vi.fn(async () => claim),
    cancelBrandAnalysis: vi.fn(async () => ({ ...claim, status: "cancelled" })),
    retryBrandAnalysis: vi.fn(async () => ({ ...claim, status: "waiting_for_resource" })),
    updateBrandAnalysisDraft: vi.fn(async () => ({ ...claim, status: "review_ready" })),
    confirmBrandAnalysis: vi.fn(async () => ({ ...claim, status: "confirmed" })),
    progressBrandAnalysis: vi.fn(async () => claim),
    cleanupBrandAnalysisRuns: vi.fn(async () => ({ attempted: 0, completed: 0 })),
    claimBrandAnalysis: vi.fn(async () => claim),
    listBrandAnalysisUploads: vi.fn(async () => []),
    markBrandEvidenceReady: vi.fn(async () => claim),
    heartbeatBrandAnalysis: vi.fn(async () => ({
      alive: true,
      cancelRequested: false,
      leaseExpiresAt: "2026-07-21T00:02:00.000Z",
      deadlineAt: "2026-07-21T00:10:00.000Z",
    })),
    completeBrandAnalysis: vi.fn(async () => ({ ...claim, status: "review_ready" })),
    failBrandAnalysis: vi.fn(async () => ({ ...claim, status: "failed" })),
  };
  const kakaoAuth = {
    getSession: vi.fn(async () => ({
      userId: "user-1",
      displayName: "사람 이름",
      email: null,
      workspaceId: "workspace-1",
      workspaceName: "워크스페이스",
      brandId: "brand-1",
      brandName: "",
    })),
    canAccessBrand: vi.fn(async () => true),
  };
  return {
    app: createServer({
      repository,
      brandIntelligenceRepository: intelligence as unknown as BrandIntelligenceRepository,
      workerApiToken: "worker-secret",
      kakaoAuth: kakaoAuth as never,
      logger: false,
    }),
    intelligence,
  };
}

const headers = { authorization: "Bearer worker-secret" };
const customerHeaders = { cookie: "bp_session=test-session" };

describe("brand intelligence worker routes", () => {
  it("requires the worker token and exposes claim and heartbeat", async () => {
    const { app, intelligence } = setup();
    expect((await app.inject({ method: "POST", url: "/worker/brand-analyses/claim", payload: { workerId: "worker-1" } })).statusCode).toBe(401);
    const cleanup = await app.inject({
      method: "POST",
      url: "/worker/brand-analyses/cleanup",
      headers,
    });
    expect(cleanup.statusCode).toBe(200);
    expect(intelligence.cleanupBrandAnalysisRuns).toHaveBeenCalledOnce();
    const claimed = await app.inject({ method: "POST", url: "/worker/brand-analyses/claim", headers, payload: { workerId: "worker-1" } });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json()).toMatchObject({ job: { id: analysisId } });
    const heartbeat = await app.inject({ method: "POST", url: `/worker/brand-analyses/${analysisId}/heartbeat`, headers,
      payload: { workerId: "worker-1", leaseToken: claim.leaseToken, leaseSeconds: 120 } });
    expect(heartbeat.statusCode).toBe(200);
    expect(heartbeat.json()).toMatchObject({
      ok: true,
      leaseExpiresAt: "2026-07-21T00:02:00.000Z",
      deadlineAt: "2026-07-21T00:10:00.000Z",
    });
    expect(intelligence.heartbeatBrandAnalysis).toHaveBeenCalledOnce();
    await app.close();
  });

  it("exposes the v2 onboarding control plane without raw evidence", async () => {
    const { app, intelligence } = setup();
    const onboarding = await app.inject({
      method: "GET",
      url: "/brands/brand-1/brand-intelligence/onboarding",
      headers: customerHeaders,
    });
    expect(onboarding.statusCode).toBe(200);
    expect(onboarding.json()).toMatchObject({
      companyName: "",
      companyNameState: "provisional",
      activeAnalysis: { id: analysisId },
    });
    expect(onboarding.json().activeAnalysis).not.toHaveProperty("evidence");
    expect(onboarding.json().activeAnalysis).not.toHaveProperty("leasedBy");
    expect(onboarding.json().activeAnalysis).not.toHaveProperty("leaseToken");
    expect(onboarding.json().activeAnalysis).not.toHaveProperty("idempotencyKey");

    const created = await app.inject({
      method: "POST",
      url: "/brands/brand-1/brand-analyses",
      headers: customerHeaders,
      payload: {
        ownedUrl: "https://example.com",
        uploadIds: [],
        uploads: [],
        idempotencyKey: "create-v2",
      },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).not.toHaveProperty("leasedBy");
    expect(created.json()).not.toHaveProperty("leaseToken");
    expect(created.json()).not.toHaveProperty("idempotencyKey");
    expect(intelligence.requestBrandAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      brandId: "brand-1",
      ownedUrl: "https://example.com",
      idempotencyKey: "create-v2",
    }));
    const requestCalls = intelligence.requestBrandAnalysis.mock.calls as unknown as Array<
      [Record<string, unknown>]
    >;
    expect(requestCalls.at(-1)?.[0]).not.toHaveProperty("companyName");

    intelligence.getBrandAnalysis.mockResolvedValueOnce({
      ...claim,
      status: "failed",
      evidence: [{
        sourceId: "owned-page-1",
        sourceType: "owned_url",
        title: "비공개 원문",
        sourceUrl: "https://example.com",
        textBlocks: [{ heading: null, text: "반환되면 안 되는 원문" }],
        tables: [],
        contentHash: "a".repeat(64),
      }],
      errorCode: "brand_analysis_owned_page_success_threshold_not_met",
      errorMessage: "internal worker detail",
    } as unknown as BrandAnalysisClaim);
    const status = await app.inject({
      method: "GET",
      url: `/brands/brand-1/brand-analyses/${analysisId}`,
      headers: customerHeaders,
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).not.toHaveProperty("evidence");
    expect(status.json()).not.toHaveProperty("leasedBy");
    expect(status.json()).not.toHaveProperty("leaseToken");
    expect(status.json()).not.toHaveProperty("idempotencyKey");
    expect(status.json().errorMessage).toContain("중요 페이지");
    expect(JSON.stringify(status.json())).not.toContain("internal worker detail");
    await app.close();
  });

  it("rejects progress that exceeds the 20-page and 8-stage contract", async () => {
    const { app, intelligence } = setup();
    const response = await app.inject({
      method: "POST",
      url: `/worker/brand-analyses/${analysisId}/progress`,
      headers,
      payload: {
        workerId: "worker-1",
        leaseToken: claim.leaseToken,
        leaseSeconds: 120,
        stage: "crawling_pages",
        inputCount: 21,
        successCount: 11,
        failedCount: 10,
        selectedPageCount: 21,
        successfulPageCount: 11,
        failedPageCount: 10,
        requiredPageCount: 10,
        completedCliStageCount: 0,
        totalCliStageCount: 8,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "brand_analysis_progress_count_invalid" });
    expect(intelligence.progressBrandAnalysis).not.toHaveBeenCalled();
    await app.close();
  });
});
