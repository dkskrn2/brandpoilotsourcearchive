import { describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer.js";

function repository() {
  return {
    health: vi.fn(async () => ({ database: "ok" as const })),
    listDmConversations: vi.fn(async () => ({ items: [], nextCursor: null })),
    getDmConversation: vi.fn(async () => ({ id: "conversation-1" })),
    listDmAttentionItems: vi.fn(async () => []),
    resolveDmAttentionItem: vi.fn(async () => ({ conversationId: "conversation-1", automationStatus: "active", attentionStatus: "resolved" })),
    getWikiStatus: vi.fn(async () => ({ activeVersion: null, latestFailedVersion: null, importStats: { total: 0, succeeded: 0, failed: 0, faqRows: 0, productRows: 0 } })),
  } as any;
}

const brandId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const attentionId = "33333333-3333-4333-8333-333333333333";

describe("DM operations routes", () => {
  it("validates filters and exposes the five operations endpoints", async () => {
    const repo = repository();
    const app = createServer({ repository: repo, logger: false });
    expect((await app.inject({ method: "GET", url: `/brands/${brandId}/dm/conversations?filter=bad` })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/brands/${brandId}/dm/conversations?filter=attention&limit=20` })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/brands/${brandId}/dm/conversations/${conversationId}` })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/brands/${brandId}/dm/attention-items?type=complaint` })).statusCode).toBe(200);
    expect((await app.inject({ method: "PATCH", url: `/dm/attention-items/${attentionId}`, payload: { status: "resolved" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/brands/${brandId}/wiki/status` })).statusCode).toBe(200);
    expect(repo.listDmConversations).toHaveBeenCalledWith(brandId, { filter: "attention", cursor: undefined, limit: 20 });
  });

  it("denies an attention item owned by another workspace", async () => {
    const repo = repository();
    const kakaoAuth = {
      getSession: vi.fn(async () => ({ userId: "user-1" })),
      canAccessBrand: vi.fn(async () => true),
      canAccessResource: vi.fn(async () => false),
    } as any;
    const app = createServer({ repository: repo, kakaoAuth, logger: false });
    const response = await app.inject({
      method: "PATCH",
      url: `/dm/attention-items/${attentionId}`,
      headers: { cookie: "bp_session=session-token" },
      payload: { status: "resolved" },
    });
    expect(response.statusCode).toBe(403);
    expect(repo.resolveDmAttentionItem).not.toHaveBeenCalled();
    expect(kakaoAuth.canAccessResource).toHaveBeenCalledWith("user-1", "dm_attention_items", attentionId);
  });
});
