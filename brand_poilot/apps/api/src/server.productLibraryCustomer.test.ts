import { describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer.js";
import type { ApiRepository } from "./types.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const brandId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const itemId = "44444444-4444-4444-8444-444444444444";
const auth = { cookie: "bp_session=session-1" };
const profile = {
  contractVersion: "product-service.v1" as const,
  name: "모종 애드",
  kind: "service" as const,
  description: "SNS 운영",
  features: ["콘텐츠 생성"],
  benefits: ["시간 절감"],
  cautions: [],
  audiences: [],
  appealsByTarget: {},
  evergreenPurchaseInfo: "상담 후 이용",
  sourceUrls: ["https://example.com"],
};
const item = {
  id: itemId, workspaceId, brandId, kind: "service" as const, displayName: profile.name,
  status: "active" as const, activeVersionId: null, activeVersion: null,
  draft: { id: "55555555-5555-4555-8555-555555555555", productServiceId: itemId, workspaceId, brandId, sourceAnalysisId: null, version: 1, status: "draft" as const, profile, evidence: [], approvedAt: null, updatedAt: "2026-07-26T00:00:00.000Z" },
};

function setup(overrides: Partial<ApiRepository> = {}) {
  const repository = {
    health: vi.fn(async () => ({ database: "ok" as const })),
    getActive: vi.fn(async () => null), listVersions: vi.fn(async () => []),
    getActiveRules: vi.fn(async () => null), listRuleSets: vi.fn(async () => []),
    listProductServices: vi.fn(async () => [item]),
    getProductService: vi.fn(async () => item),
    createProductService: vi.fn(async () => item),
    createProductServiceFromAnalysis: vi.fn(async () => item),
    updateProductServiceDraft: vi.fn(async () => item),
    approveProductService: vi.fn(async () => ({ ...item, activeVersionId: item.draft.id, activeVersion: { ...item.draft, status: "approved" as const }, draft: null })),
    archiveProductService: vi.fn(async () => undefined),
    summarizeProductServices: vi.fn(async () => ({ active: 1, drafts: 0 })),
    ...overrides,
  } as unknown as ApiRepository;
  const kakaoAuth = {
    getSession: vi.fn(async () => ({ userId, workspaceId, workspaceName: "Workspace", brandId, brandName: "Brand", displayName: "Tester", email: null })),
    canAccessBrand: vi.fn(async () => true),
  } as never;
  return { app: createServer({ repository, kakaoAuth, logger: false }), repository };
}

describe("product library customer routes", () => {
  it("creates, lists, and approves reusable products with the authenticated actor", async () => {
    const { app, repository } = setup();
    const created = await app.inject({ method: "POST", url: `/brands/${brandId}/product-services`, headers: auth, payload: profile });
    expect(created.statusCode).toBe(201);
    expect(repository.createProductService).toHaveBeenCalledWith({ workspaceId, brandId, actorUserId: userId }, profile);

    const listed = await app.inject({ method: "GET", url: `/brands/${brandId}/product-services?include=draft`, headers: auth });
    expect(listed.statusCode).toBe(200);
    expect(repository.listProductServices).toHaveBeenCalledWith({ workspaceId, brandId }, ["draft"]);

    const approved = await app.inject({ method: "POST", url: `/brands/${brandId}/product-services/${itemId}/approve`, headers: auth });
    expect(approved.statusCode).toBe(200);
    expect(repository.approveProductService).toHaveBeenCalledWith({ workspaceId, brandId, actorUserId: userId, itemId });
    await app.close();
  });

  it("reports the real product library state in brand center", async () => {
    const { app } = setup();
    const response = await app.inject({ method: "GET", url: `/brands/${brandId}/brand-center`, headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.json().products).toEqual({ state: "approved", activeCount: 1, draftCount: 0 });
    await app.close();
  });

  it("maps member approval rejection without leaking another tenant", async () => {
    const { app } = setup({ approveProductService: vi.fn(async () => { throw new Error("product_service_approval_forbidden"); }) });
    const response = await app.inject({ method: "POST", url: `/brands/${brandId}/product-services/${itemId}/approve`, headers: auth });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "product_service_approval_forbidden" });
    await app.close();
  });
});
