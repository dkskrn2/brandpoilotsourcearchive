import { describe, expect, it, vi } from "vitest";
import type { BrandCoreVersion } from "./brandCoreRepository.js";
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

function version(status: "draft" | "approved" = "draft"): BrandCoreVersion {
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
  };
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

  it("reports the actual avatar library aggregate", async () => {
    const summarizeAvatars = vi.fn(async () => ({
      active: 3,
      defaultAvatarId: "88888888-8888-4888-8888-888888888888",
    }));
    const { app } = setup({ summarizeAvatars });
    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/brand-center`,
      headers: auth,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().avatars).toEqual({
      state: "ready",
      activeCount: 3,
      defaultAvatarId: "88888888-8888-4888-8888-888888888888",
    });
    expect(summarizeAvatars).toHaveBeenCalledWith({ workspaceId, brandId });
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

  it("creates a revision from the active core without changing the active lookup", async () => {
    const approved = version("approved");
    const createDraft = vi.fn(async () => ({ ...version(), version: 2 }));
    const getActive = vi.fn(async () => approved);
    const { app } = setup({ createDraft, getActive });

    const created = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/brand-core/drafts`,
      headers: auth,
      payload: {},
    });

    expect(created.statusCode).toBe(200);
    expect(getActive).toHaveBeenCalledWith({ workspaceId, brandId });
    expect(createDraft).toHaveBeenCalledWith(
      { workspaceId, brandId, actorUserId: userId },
      {
        core: approved.core,
        evidence: approved.evidence,
        reviewState: approved.reviewState,
        sourceAnalysisId: null,
      },
    );
    await app.close();
  });

  it("returns repository revision order and identifies the editable draft", async () => {
    const draft = { ...version(), id: "55555555-5555-4555-8555-555555555555", version: 3 };
    const approved = { ...version("approved"), version: 2 };
    const old = {
      ...version("approved"),
      id: "66666666-6666-4666-8666-666666666666",
      version: 1,
      status: "superseded" as const,
    };
    const { app } = setup({
      getActive: vi.fn(async () => approved),
      listVersions: vi.fn(async () => [draft, approved, old]),
    });

    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/brand-core`,
      headers: auth,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      active: approved,
      draft,
      versions: [draft, approved, old],
    });
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
      payload: { expectedUpdatedAt: version().updatedAt },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({ error: "brand_core_approval_forbidden" });
    await conflict.app.close();
  });

  it("rejects legacy design rules before saving a new rules draft", async () => {
    const saveRuleDraft = vi.fn();
    const { app } = setup({ saveRuleDraft });

    const response = await app.inject({
      method: "PUT",
      url: `/brands/${brandId}/brand-rules/draft`,
      headers: auth,
      payload: {
        contractVersion: "brand-rules.v1",
        requiredPhrases: [],
        forbiddenPhrases: [],
        exaggerationRules: [],
        ctaRules: { defaultCta: "", allowed: [] },
        channelRules: {},
        designRules: {
          colors: [],
          fonts: [],
          notes: [],
          referenceImages: [{
            referenceItemId: "44444444-4444-4444-8444-444444444444",
            description: "",
            tags: [],
          }],
        },
        autoApprovalRules: { enabled: false, conditions: [] },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "brand_core_validation_failed", field: "rules" });
    expect(saveRuleDraft).not.toHaveBeenCalled();
    await app.close();
  });

  it("requires and forwards the displayed concurrency token for approval", async () => {
    const approve = vi.fn(async () => version("approved"));
    const { app } = setup({ approve });

    const missing = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/brand-core/drafts/${version().id}/approve`,
      headers: auth,
      payload: {},
    });
    expect(missing.statusCode).toBe(409);
    expect(approve).not.toHaveBeenCalled();

    const approved = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/brand-core/drafts/${version().id}/approve`,
      headers: auth,
      payload: { expectedUpdatedAt: version().updatedAt },
    });
    expect(approved.statusCode).toBe(200);
    expect(approve).toHaveBeenCalledWith(
      { workspaceId, brandId, actorUserId: userId, versionId: version().id },
      { expectedUpdatedAt: version().updatedAt },
    );
    await app.close();
  });

  it("exposes analyzed design styles and combined presets", async () => {
    const styleId = "55555555-5555-4555-8555-555555555555";
    const presetId = "66666666-6666-4666-8666-666666666666";
    const listDesignStyles = vi.fn(async () => []);
    const createVisualPreset = vi.fn(async () => ({
      id: presetId, workspaceId, brandId, name: "비교형", designStyleId: styleId,
      avatarId: null, revision: 1, isDefault: false,
      usability: { usable: false as const, reason: "style_analyzing" as const },
      createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z",
    }));
    const { app } = setup({ listDesignStyles, createVisualPreset });

    const styles = await app.inject({
      method: "GET", url: `/brands/${brandId}/design-styles`, headers: auth,
    });
    expect(styles.statusCode).toBe(200);
    expect(listDesignStyles).toHaveBeenCalledWith({ workspaceId, brandId });

    const created = await app.inject({
      method: "POST", url: `/brands/${brandId}/visual-presets`, headers: auth,
      payload: {
        contractVersion: "visual-preset-input.v1", name: "비교형",
        designStyleId: styleId, avatarId: null, isDefault: false,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().usability).toEqual({ usable: false, reason: "style_analyzing" });
    expect(createVisualPreset).toHaveBeenCalledWith(
      { workspaceId, brandId, actorUserId: userId },
      expect.objectContaining({ designStyleId: styleId, avatarId: null, isDefault: false }),
    );

    await app.close();
  });
});
