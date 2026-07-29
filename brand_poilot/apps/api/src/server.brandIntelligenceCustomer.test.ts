import { describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer.js";
import type { ApiRepository } from "./types.js";
import type { BrandIntelligenceRepository } from "./brandIntelligenceRepository.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const brandId = "22222222-2222-4222-8222-222222222222";
const otherBrandId = "44444444-4444-4444-8444-444444444444";
const analysisId = "33333333-3333-4333-8333-333333333333";

function record(status = "queued") {
  return {
    id: analysisId, workspaceId, brandId, status, input: { ownedUrl: "https://example.com", uploadIds: [] },
    evidence: [], result: null, editedResult: null, effectiveResult: null, idempotencyKey: "analysis-1",
    isActive: false, leasedBy: null, leaseToken: null, leaseExpiresAt: null, attemptCount: 0,
    availableAt: "2026-07-21T00:00:00.000Z", errorCode: null, errorMessage: null,
    createdAt: "2026-07-21T00:00:00.000Z", updatedAt: "2026-07-21T00:00:00.000Z",
    completedAt: null, confirmedAt: null,
  } as never;
}

function setup() {
  const repository = { health: vi.fn(async () => ({ database: "ok" as const })) } as unknown as ApiRepository;
  const intelligence = {
    requestBrandAnalysis: vi.fn(async () => record()),
    getBrandAnalysis: vi.fn(async () => record("review_ready")),
    getOpenBrandAnalysis: vi.fn(async () => record("review_ready")),
    getCurrentBrandIntelligence: vi.fn(async () => null),
    updateBrandAnalysisDraft: vi.fn(async () => record("review_ready")),
    confirmBrandAnalysis: vi.fn(async () => record("confirmed")),
    registerBrandAnalysisUpload: vi.fn(async () => ({ id: "upload-1" })),
  } as unknown as BrandIntelligenceRepository;
  const kakaoAuth = {
    getSession: vi.fn(async () => ({ userId: "user-1", workspaceId, workspaceName: "Workspace", brandId, brandName: "Brand", displayName: "Tester", email: null })),
    canAccessBrand: vi.fn(async (_userId: string, requestedBrandId: string) => requestedBrandId === brandId),
  } as never;
  const app = createServer({ repository, kakaoAuth, brandIntelligenceRepository: intelligence, logger: false });
  return { app, intelligence };
}

const auth = { cookie: "bp_session=session-1" };

describe("brand intelligence customer routes", () => {
  it("creates, reads, edits, and confirms in the authenticated brand scope", async () => {
    const { app, intelligence } = setup();
    const created = await app.inject({
      method: "POST", url: `/brands/${brandId}/brand-intelligence/analyses`, headers: auth,
      payload: { ownedUrl: "https://example.com", uploadIds: [], idempotencyKey: "analysis-1" },
    });
    expect(created.statusCode).toBe(200);
    expect(intelligence.requestBrandAnalysis).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, brandId }));

    expect((await app.inject({ method: "GET", url: `/brands/${brandId}/brand-intelligence/analyses/${analysisId}`, headers: auth })).statusCode).toBe(200);
    expect((await app.inject({ method: "PATCH", url: `/brands/${brandId}/brand-intelligence/analyses/${analysisId}`, headers: auth,
      payload: { editedResult: {
        contractVersion: "brand-intelligence-result.v1", companyOverview: "개요", businessDescription: "사업",
        primaryCategory: { code: null, name: "마케팅" }, subcategories: [], primaryTarget: "고객",
        differentiators: "차별점", coreAppeal: "소구점", competitors: [], evidence: [], sourceGaps: [],
      } } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/brands/${brandId}/brand-intelligence/analyses/${analysisId}/confirm`, headers: auth })).statusCode).toBe(200);
    await app.close();
  });

  it("returns null when the brand has no confirmed intelligence", async () => {
    const { app } = setup();
    const response = await app.inject({ method: "GET", url: `/brands/${brandId}/brand-intelligence`, headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ intelligence: null });
    await app.close();
  });

  it("returns the scoped open workflow without changing the confirmed endpoint", async () => {
    const { app, intelligence } = setup();

    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/brand-intelligence/workflow`,
      headers: auth,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      workflow: expect.objectContaining({ id: analysisId, status: "review_ready" }),
    });
    expect(intelligence.getOpenBrandAnalysis).toHaveBeenCalledWith({ workspaceId, brandId });
    expect(intelligence.getCurrentBrandIntelligence).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns null when the scoped brand has no open workflow", async () => {
    const { app, intelligence } = setup();
    vi.mocked(intelligence.getOpenBrandAnalysis).mockResolvedValueOnce(null);

    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/brand-intelligence/workflow`,
      headers: auth,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ workflow: null });
    expect(intelligence.getOpenBrandAnalysis).toHaveBeenCalledWith({ workspaceId, brandId });
    await app.close();
  });

  it("does not disclose an open workflow from another brand", async () => {
    const { app, intelligence } = setup();

    const response = await app.inject({
      method: "GET",
      url: `/brands/${otherBrandId}/brand-intelligence/workflow`,
      headers: auth,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "workspace_access_denied" });
    expect(intelligence.getOpenBrandAnalysis).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns a scoped 404 when a resumed analysis no longer exists", async () => {
    const { app, intelligence } = setup();
    vi.mocked(intelligence.getBrandAnalysis).mockResolvedValueOnce(null);

    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/brand-intelligence/analyses/${analysisId}`,
      headers: auth,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "brand_analysis_not_found" });
    await app.close();
  });
});
