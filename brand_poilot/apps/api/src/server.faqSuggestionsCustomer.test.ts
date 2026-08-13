import { describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer.js";
import type { ApiRepository } from "./types.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const brandId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";
const itemId = "55555555-5555-4555-8555-555555555555";
const updatedAt = "2026-08-02T00:00:00.000Z";
const auth = { cookie: "bp_session=session-1" };

const item = {
  id: itemId,
  workspaceId,
  brandId,
  runId,
  position: 0,
  category: "shipping" as const,
  question: "배송은 언제 시작하나요?",
  answer: "결제 후 안내된 일정에 발송합니다.",
  exampleUtterances: ["배송 언제 와요?", "언제 발송해요?", "발송 일정 알려줘"],
  evidence: [{
    sourceType: "brand_core" as const,
    sourceId: "66666666-6666-4666-8666-666666666666",
    label: "브랜드 코어",
  }],
  confidence: 0.92,
  status: "review" as const,
  duplicateOfKnowledgeEntryId: null,
  approvedKnowledgeEntryId: null,
  reviewedByUserId: null,
  reviewedAt: null,
  createdAt: updatedAt,
  updatedAt,
};

const run = {
  id: runId,
  workspaceId,
  brandId,
  status: "review_ready" as const,
  errorCode: null,
  createdByUserId: userId,
  startedAt: updatedAt,
  completedAt: updatedAt,
  createdAt: updatedAt,
  updatedAt,
  items: [item],
};

const aliasRun = {
  id: "77777777-7777-4777-8777-777777777777",
  workspaceId,
  brandId,
  status: "completed" as const,
  errorCode: null,
  targetKnowledgeEntryId: itemId,
  targetKnowledgeEntryUpdatedAt: updatedAt,
  exampleUtterances: ["배송 언제 와요?", "발송 일정 알려줘"],
  createdAt: updatedAt,
  updatedAt,
  completedAt: updatedAt,
};

function setup(options: {
  repository?: Partial<ApiRepository>;
  canAccessBrand?: boolean;
} = {}) {
  const repository = {
    health: vi.fn(async () => ({ database: "ok" as const })),
    getFaqCapabilities: vi.fn(async () => ({
      suggestions: true,
      expandedExact: false,
      shadowMatching: false,
      clarification: false,
      clarifyThreshold: 0.78,
    })),
    createFaqSuggestionRun: vi.fn(async () => ({ run, created: true })),
    getLatestFaqSuggestionRun: vi.fn(async () => run),
    getFaqSuggestionRun: vi.fn(async () => run),
    updateFaqSuggestionItem: vi.fn(async () => item),
    approveFaqSuggestionItem: vi.fn(async () => ({ item: { ...item, status: "approved" }, wikiItem: null })),
    dismissFaqSuggestionItem: vi.fn(async () => ({ ...item, status: "dismissed" })),
    createFaqAliasSuggestionRun: vi.fn(async () => ({ run: aliasRun, created: true })),
    getLatestFaqAliasSuggestionRun: vi.fn(async () => aliasRun),
    applyFaqAliasSuggestionRun: vi.fn(async () => ({ id: itemId })),
    ...options.repository,
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
    canAccessBrand: vi.fn(async () => options.canAccessBrand ?? true),
  } as never;
  return {
    app: createServer({ repository, kakaoAuth, logger: false }),
    repository: repository as ApiRepository & Record<string, ReturnType<typeof vi.fn>>,
  };
}

describe("FAQ suggestion customer routes", () => {
  it("creates a new run with 202 and reuses an active run with 200", async () => {
    const { app, repository } = setup();
    const created = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/faq-suggestions`,
      headers: auth,
    });
    expect(created.statusCode).toBe(202);
    expect(created.json()).toEqual({ run });
    expect(repository.createFaqSuggestionRun).toHaveBeenCalledWith({
      workspaceId,
      brandId,
      actorUserId: userId,
    });
    await app.close();

    const reusedSetup = setup({
      repository: {
        createFaqSuggestionRun: vi.fn(async () => ({ run, created: false })),
      },
    });
    const reused = await reusedSetup.app.inject({
      method: "POST",
      url: `/brands/${brandId}/faq-suggestions`,
      headers: auth,
    });
    expect(reused.statusCode).toBe(200);
    expect(reused.json()).toEqual({ run });
    await reusedSetup.app.close();
  });

  it("keeps the existing full FAQ suggestion flow available when utterance rollout is off", async () => {
    const { app, repository } = setup({
      repository: {
        getFaqCapabilities: vi.fn(async () => ({
          suggestions: false,
          expandedExact: false,
          shadowMatching: false,
          clarification: false,
          clarifyThreshold: 0.78,
        })),
      },
    });
    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/faq-suggestions`,
      headers: auth,
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ run });
    expect(repository.createFaqSuggestionRun).toHaveBeenCalledWith({
      workspaceId,
      brandId,
      actorUserId: userId,
    });
    await app.close();
  });

  it("returns latest and specific run envelopes, including a null latest run", async () => {
    const { app, repository } = setup();
    const latest = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/faq-suggestions/latest`,
      headers: auth,
    });
    expect(latest.statusCode).toBe(200);
    expect(latest.json()).toEqual({ run });
    expect(repository.getLatestFaqSuggestionRun).toHaveBeenCalledWith({ workspaceId, brandId });

    const selected = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/faq-suggestions/${runId}`,
      headers: auth,
    });
    expect(selected.statusCode).toBe(200);
    expect(selected.json()).toEqual({ run });
    expect(repository.getFaqSuggestionRun).toHaveBeenCalledWith({ workspaceId, brandId, runId });
    await app.close();

    const emptySetup = setup({
      repository: { getLatestFaqSuggestionRun: vi.fn(async () => null) },
    });
    const empty = await emptySetup.app.inject({
      method: "GET",
      url: `/brands/${brandId}/faq-suggestions/latest`,
      headers: auth,
    });
    expect(empty.json()).toEqual({ run: null });
    await emptySetup.app.close();
  });

  it("edits, approves, and dismisses through the authenticated actor", async () => {
    const { app, repository } = setup();
    const payload = {
      category: "shipping",
      question: item.question,
      answer: item.answer,
      exampleUtterances: item.exampleUtterances,
      expectedUpdatedAt: updatedAt,
    };
    const edited = await app.inject({
      method: "PATCH",
      url: `/brands/${brandId}/faq-suggestions/${runId}/items/${itemId}`,
      headers: auth,
      payload,
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toEqual({ item });
    expect(repository.updateFaqSuggestionItem).toHaveBeenCalledWith({
      workspaceId,
      brandId,
      actorUserId: userId,
      runId,
      itemId,
      ...payload,
    });

    const approved = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/faq-suggestions/${runId}/items/${itemId}/approve`,
      headers: auth,
      payload: { expectedUpdatedAt: updatedAt },
    });
    expect(approved.statusCode).toBe(200);
    expect(repository.approveFaqSuggestionItem).toHaveBeenCalledWith({
      workspaceId, brandId, actorUserId: userId, runId, itemId, expectedUpdatedAt: updatedAt,
    });

    const dismissed = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/faq-suggestions/${runId}/items/${itemId}/dismiss`,
      headers: auth,
      payload: { expectedUpdatedAt: updatedAt },
    });
    expect(dismissed.statusCode).toBe(200);
    expect(dismissed.json()).toMatchObject({ item: { status: "dismissed" } });
    await app.close();
  });

  it("rejects invalid mutation fields before calling the repository", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/faq-suggestions/${runId}/items/${itemId}/approve`,
      headers: auth,
      payload: { expectedUpdatedAt: updatedAt, force: true },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "faq_suggestion_validation_failed",
      field: "force",
    });
    expect(repository.approveFaqSuggestionItem).not.toHaveBeenCalled();
    await app.close();
  });

  it("creates, reads, and applies expression suggestions for one existing FAQ", async () => {
    const { app, repository } = setup();
    const created = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/wiki/items/${itemId}/alias-suggestions`,
      headers: auth,
    });
    expect(created.statusCode).toBe(202);
    expect(created.json()).toEqual({ run: aliasRun });

    const latest = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/wiki/items/${itemId}/alias-suggestions/latest`,
      headers: auth,
    });
    expect(latest.json()).toEqual({ run: aliasRun });

    const applied = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/wiki/items/${itemId}/alias-suggestions/${aliasRun.id}/apply`,
      headers: auth,
      payload: {
        expectedUpdatedAt: updatedAt,
        exampleUtterances: ["배송 며칠 걸려요?", "택배 언제 와요?", "발송일 알려줘"],
      },
    });
    expect(applied.statusCode).toBe(200);
    expect(repository.applyFaqAliasSuggestionRun).toHaveBeenCalledWith({
      workspaceId,
      brandId,
      actorUserId: userId,
      itemId,
      runId: aliasRun.id,
      expectedUpdatedAt: updatedAt,
      exampleUtterances: ["배송 며칠 걸려요?", "택배 언제 와요?", "발송일 알려줘"],
    });
    await app.close();
  });

  it("keeps a completed expression suggestion readable but blocks applying it after rollback", async () => {
    const { app, repository } = setup({
      repository: {
        getFaqCapabilities: vi.fn(async () => ({
          suggestions: false,
          expandedExact: false,
          shadowMatching: false,
          clarification: false,
          clarifyThreshold: 0.78,
        })),
      },
    });
    const latest = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/wiki/items/${itemId}/alias-suggestions/latest`,
      headers: auth,
    });
    expect(latest.statusCode).toBe(200);

    const applied = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/wiki/items/${itemId}/alias-suggestions/${aliasRun.id}/apply`,
      headers: auth,
      payload: { expectedUpdatedAt: updatedAt },
    });
    expect(applied.statusCode).toBe(409);
    expect(applied.json()).toEqual({ error: "faq_utterance_suggestions_disabled" });
    expect(repository.applyFaqAliasSuggestionRun).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    ["faq_suggestion_sources_missing", 409],
    ["faq_suggestion_item_conflict", 409],
    ["faq_suggestion_access_forbidden", 403],
    ["faq_suggestion_approval_forbidden", 403],
    ["faq_suggestion_item_not_found", 404],
    ["faq_suggestion_run_not_found", 404],
  ] as const)("maps %s to %s", async (message, statusCode) => {
    const { app } = setup({
      repository: {
        createFaqSuggestionRun: vi.fn(async () => { throw new Error(message); }),
      },
    });
    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/faq-suggestions`,
      headers: auth,
    });
    expect(response.statusCode).toBe(statusCode);
    expect(response.json()).toEqual({ error: message });
    await app.close();
  });

  it("does not call the repository for another tenant", async () => {
    const { app, repository } = setup({ canAccessBrand: false });
    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/faq-suggestions/latest`,
      headers: auth,
    });
    expect(response.statusCode).toBe(403);
    expect(repository.getLatestFaqSuggestionRun).not.toHaveBeenCalled();
    await app.close();
  });
});
