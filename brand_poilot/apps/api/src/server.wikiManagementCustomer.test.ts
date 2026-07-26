import { describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer.js";
import type { ApiRepository } from "./types.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const brandId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const itemId = "44444444-4444-4444-8444-444444444444";
const issueId = "55555555-5555-4555-8555-555555555555";
const auth = { cookie: "bp_session=session-1" };

const item = {
  id: itemId,
  workspaceId,
  brandId,
  itemType: "faq" as const,
  title: "배송 안내",
  content: "결제 후 영업일 2일 안에 발송합니다.",
  status: "draft" as const,
  origin: "manual" as const,
  provenance: { note: "고객지원 검토" },
  createdByUserId: userId,
  approvedByUserId: null,
  approvedAt: null,
  sourceKind: "faq" as const,
  sourceId: itemId,
  activeVersionId: null,
  lastBuiltAt: null,
  buildStatus: "draft" as const,
};

const issue = {
  id: issueId,
  workspaceId,
  brandId,
  issueType: "knowledge_gap",
  severity: "warning" as const,
  status: "open" as const,
  question: "제주 배송은 언제 오나요?",
  detail: {},
  sourceKind: null,
  sourceId: null,
  activeVersionId: "66666666-6666-4666-8666-666666666666",
  lastBuiltAt: "2026-07-26T12:00:00.000Z",
  buildStatus: "active" as const,
  resolvedAt: null,
};

function setup(options: {
  repository?: Partial<ApiRepository>;
  canAccessBrand?: boolean;
} = {}) {
  const repository = {
    health: vi.fn(async () => ({ database: "ok" as const })),
    getActive: vi.fn(async () => null),
    listVersions: vi.fn(async () => []),
    getActiveRules: vi.fn(async () => null),
    listRuleSets: vi.fn(async () => []),
    listWikiItems: vi.fn(async () => [item]),
    createWikiItem: vi.fn(async () => item),
    updateWikiItem: vi.fn(async () => ({ ...item, status: "active", buildStatus: "pending" })),
    listWikiIssues: vi.fn(async () => [issue]),
    resolveWikiIssue: vi.fn(async () => ({
      ...issue,
      status: "pending_build",
      sourceKind: "faq",
      sourceId: itemId,
      buildStatus: "pending",
    })),
    summarizeWiki: vi.fn(async () => ({
      state: "active",
      activeVersionId: issue.activeVersionId,
      lastBuiltAt: issue.lastBuiltAt,
      buildStatus: "active",
      itemCount: 1,
      issueCount: 1,
    })),
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

describe("Wiki management customer routes", () => {
  it("lists and authors a manual draft without an import", async () => {
    const { app, repository } = setup();
    const listed = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/wiki/items`,
      headers: auth,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([item]);
    expect(repository.listWikiItems).toHaveBeenCalledWith({ workspaceId, brandId });

    const created = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/wiki/items`,
      headers: auth,
      payload: {
        contractVersion: "wiki-item.v1",
        itemType: "faq",
        title: item.title,
        content: item.content,
        provenance: item.provenance,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(repository.createWikiItem).toHaveBeenCalledWith(
      { workspaceId, brandId, actorUserId: userId },
      expect.objectContaining({ itemType: "faq", title: item.title }),
    );
    await app.close();
  });

  it("passes activation and issue resolution through the authenticated actor", async () => {
    const { app, repository } = setup();
    const activated = await app.inject({
      method: "PATCH",
      url: `/brands/${brandId}/wiki/items/${itemId}`,
      headers: auth,
      payload: { status: "active" },
    });
    expect(activated.statusCode).toBe(200);
    expect(repository.updateWikiItem).toHaveBeenCalledWith(
      { workspaceId, brandId, actorUserId: userId, itemId },
      { status: "active" },
    );

    const issues = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/wiki/issues`,
      headers: auth,
    });
    expect(issues.statusCode).toBe(200);
    expect(issues.json()).toEqual([issue]);

    const resolved = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/wiki/issues/${issueId}/resolve`,
      headers: auth,
      payload: { sourceKind: "faq", sourceId: itemId },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toMatchObject({
      status: "pending_build",
      sourceKind: "faq",
      sourceId: itemId,
    });
    expect(repository.resolveWikiIssue).toHaveBeenCalledWith(
      { workspaceId, brandId, actorUserId: userId, issueId },
      { sourceKind: "faq", sourceId: itemId },
    );
    await app.close();
  });

  it("maps member issue resolution rejection to 403", async () => {
    const { app } = setup({
      repository: {
        resolveWikiIssue: vi.fn(async () => {
          throw new Error("wiki_issue_resolution_forbidden");
        }),
      } as Partial<ApiRepository>,
    });
    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/wiki/issues/${issueId}/resolve`,
      headers: auth,
      payload: { sourceKind: "faq", sourceId: itemId },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "wiki_issue_resolution_forbidden" });
    await app.close();
  });

  it("returns a conflict when an issue is no longer open", async () => {
    const { app } = setup({
      repository: {
        resolveWikiIssue: vi.fn(async () => {
          throw new Error("wiki_issue_not_open");
        }),
      } as Partial<ApiRepository>,
    });
    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/wiki/issues/${issueId}/resolve`,
      headers: auth,
      payload: { sourceKind: "faq", sourceId: itemId },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "wiki_issue_not_open" });
    await app.close();
  });

  it("does not call the repository for another tenant", async () => {
    const { app, repository } = setup({ canAccessBrand: false });
    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/wiki/items`,
      headers: auth,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "workspace_access_denied" });
    expect(repository.listWikiItems).not.toHaveBeenCalled();
    await app.close();
  });
});
