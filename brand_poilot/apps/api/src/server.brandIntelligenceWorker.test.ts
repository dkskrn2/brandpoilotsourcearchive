import { describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer.js";
import type { ApiRepository } from "./types.js";
import type { BrandAnalysisClaim, BrandIntelligenceRepository } from "./brandIntelligenceRepository.js";

const analysisId = "33333333-3333-4333-8333-333333333333";
const claim = {
  id: analysisId, workspaceId: "workspace-1", brandId: "brand-1", status: "analyzing",
  input: { ownedUrl: "https://example.com", uploadIds: [] }, evidence: [], result: null,
  editedResult: null, effectiveResult: null, idempotencyKey: "analysis-1", isActive: false,
  leasedBy: "worker-1", leaseToken: "44444444-4444-4444-8444-444444444444",
  leaseExpiresAt: "2099-01-01T00:00:00.000Z", attemptCount: 1,
  availableAt: "2026-07-21T00:00:00.000Z", errorCode: null, errorMessage: null,
  createdAt: "2026-07-21T00:00:00.000Z", updatedAt: "2026-07-21T00:00:00.000Z",
  completedAt: null, confirmedAt: null,
} as BrandAnalysisClaim;

function setup() {
  const repository = { health: vi.fn(async () => ({ database: "ok" as const })) } as unknown as ApiRepository;
  const intelligence = {
    claimBrandAnalysis: vi.fn(async () => claim),
    listBrandAnalysisUploads: vi.fn(async () => []),
    markBrandEvidenceReady: vi.fn(async () => claim),
    heartbeatBrandAnalysis: vi.fn(async () => true),
    completeBrandAnalysis: vi.fn(async () => ({ ...claim, status: "review_ready" })),
    failBrandAnalysis: vi.fn(async () => ({ ...claim, status: "failed" })),
  } as unknown as BrandIntelligenceRepository;
  return {
    app: createServer({ repository, brandIntelligenceRepository: intelligence, workerApiToken: "worker-secret", logger: false }),
    intelligence,
  };
}

const headers = { authorization: "Bearer worker-secret" };

describe("brand intelligence worker routes", () => {
  it("requires the worker token and exposes claim and heartbeat", async () => {
    const { app, intelligence } = setup();
    expect((await app.inject({ method: "POST", url: "/worker/brand-analyses/claim", payload: { workerId: "worker-1" } })).statusCode).toBe(401);
    const claimed = await app.inject({ method: "POST", url: "/worker/brand-analyses/claim", headers, payload: { workerId: "worker-1" } });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json()).toMatchObject({ job: { id: analysisId } });
    const heartbeat = await app.inject({ method: "POST", url: `/worker/brand-analyses/${analysisId}/heartbeat`, headers,
      payload: { workerId: "worker-1", leaseToken: claim.leaseToken, leaseSeconds: 120 } });
    expect(heartbeat.statusCode).toBe(200);
    expect(intelligence.heartbeatBrandAnalysis).toHaveBeenCalledOnce();
    await app.close();
  });
});
