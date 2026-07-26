import { describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer.js";
import type { ApiRepository } from "./types.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const brandId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const auth = { cookie: "bp_session=session-1" };

function core(label = "브랜드") {
  return {
    contractVersion: "brand-core.v1" as const,
    summary: { oneLine: `${label} 한 줄`, description: `${label} 설명` },
    audiences: [{ name: "담당자", problem: "시간 부족", desiredOutcome: "일관된 운영" }],
    valueProposition: {
      primary: "업무 절감",
      differentiators: ["승인 정보"],
      proofPoints: ["검토 흐름"],
    },
    messaging: {
      appeals: ["업무 절감"],
      tone: ["명확함"],
      preferredPhrases: ["근거를 바탕으로"],
      brandDirection: "과장 없는 운영",
      priorityMessages: ["승인 정보 사용"],
    },
  };
}

function version(status: "draft" | "approved" = "draft") {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    workspaceId,
    brandId,
    sourceAnalysisId: null,
    version: 1,
    status,
    core: core(),
    evidence: [],
    reviewState: {},
    createdBy: "user",
    createdByUserId: userId,
    approvedByUserId: status === "approved" ? userId : null,
    approvedAt: status === "approved" ? "2026-07-26T00:00:00.000Z" : null,
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
  } as const;
}

function setup(overrides: Partial<ApiRepository> = {}) {
  const repository = {
    health: vi.fn(async () => ({ database: "ok" as const })),
    getActive: vi.fn(async () => null),
    listVersions: vi.fn(async () => []),
    createDraft: vi.fn(async () => version()),
    updateDraft: vi.fn(async () => version()),
    approve: vi.fn(async () => version("approved")),
    getActiveRules: vi.fn(async () => null),
    listRuleSets: vi.fn(async () => []),
    saveRuleDraft: vi.fn(),
    approveRules: vi.fn(),
    ...overrides,
  } as unknown as ApiRepository;
  const kakaoAuth = {
    getSession: vi.fn(async () => ({
      userId,
      workspaceId,
      workspaceName: "Workspace",
      brandId,
      brandName: "Brand",
      displayName: "Tester",
      email: null,
    })),
    canAccessBrand: vi.fn(async () => true),
  } as never;
  return { app: createServer({ repository, kakaoAuth, logger: false }), repository };
}

describe("brand center customer routes", () => {
  it("returns an empty summary without querying future tables", async () => {
    const { app } = setup();
    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/brand-center`,
      headers: auth,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      source: { state: "empty" },
      analysis: { state: "empty" },
      brandCore: { state: "empty" },
      rules: { state: "empty" },
      products: { state: "unavailable" },
      wiki: { state: "unavailable" },
      avatars: { state: "unavailable" },
    });
    await app.close();
  });

  it("reports the actual compiled Wiki aggregate", async () => {
    const summarizeWiki = vi.fn(async () => ({
      state: "stale" as const,
      activeVersionId: "77777777-7777-4777-8777-777777777777",
      lastBuiltAt: "2026-07-26T02:00:00.000Z",
      buildStatus: "stale" as const,
      itemCount: 4,
      issueCount: 2,
    }));
    const { app } = setup({ summarizeWiki });

    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/brand-center`,
      headers: auth,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().wiki).toEqual({
      state: "stale",
      activeVersionId: "77777777-7777-4777-8777-777777777777",
      lastBuiltAt: "2026-07-26T02:00:00.000Z",
      buildStatus: "stale",
      itemCount: 4,
      issueCount: 2,
    });
    expect(summarizeWiki).toHaveBeenCalledWith({ workspaceId, brandId });
    await app.close();
  });

  it("creates and updates a draft with authenticated actor and concurrency token", async () => {
    const { app, repository } = setup();
    const created = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/brand-core/drafts`,
      headers: auth,
      payload: { core: core(), evidence: [], sourceAnalysisId: null },
    });
    expect(created.statusCode).toBe(200);
    expect(repository.createDraft).toHaveBeenCalledWith(
      { workspaceId, brandId, actorUserId: userId },
      expect.objectContaining({ core: core() }),
    );

    const updated = await app.inject({
      method: "PATCH",
      url: `/brands/${brandId}/brand-core/drafts/${version().id}`,
      headers: { ...auth, "if-match": `"${version().updatedAt}"` },
      payload: { core: core("수정"), evidence: [], reviewState: {} },
    });
    expect(updated.statusCode).toBe(200);
    expect(repository.updateDraft).toHaveBeenCalledWith(
      { workspaceId, brandId, actorUserId: userId, versionId: version().id },
      expect.objectContaining({ expectedUpdatedAt: version().updatedAt }),
    );
    await app.close();
  });

  it("maps stale edits and forbidden approvals to stable HTTP errors", async () => {
    const conflict = setup({
      updateDraft: vi.fn(async () => {
        throw new Error("brand_core_version_conflict");
      }),
      approve: vi.fn(async () => {
        throw new Error("brand_core_approval_forbidden");
      }),
    });
    const stale = await conflict.app.inject({
      method: "PATCH",
      url: `/brands/${brandId}/brand-core/drafts/${version().id}`,
      headers: { ...auth, "if-match": `"${version().updatedAt}"` },
      payload: { core: core(), evidence: [], reviewState: {} },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: "brand_core_version_conflict" });

    const forbidden = await conflict.app.inject({
      method: "POST",
      url: `/brands/${brandId}/brand-core/drafts/${version().id}/approve`,
      headers: auth,
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({ error: "brand_core_approval_forbidden" });
    await conflict.app.close();
  });
});
