import { describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer.js";

function repository() {
  return {
    health: vi.fn(async () => ({ database: "ok" as const })),
    listDmConversations: vi.fn(async () => ({ items: [], nextCursor: null })),
    getDmConversation: vi.fn(async () => ({ id: "conversation-1" })),
    sendManualDmReply: vi.fn(async () => ({ id: "message-manual", body: "직접 답변" })),
    listDmAttentionItems: vi.fn(async () => []),
    resolveDmAttentionItem: vi.fn(async () => ({ conversationId: "conversation-1", automationStatus: "active", attentionStatus: "resolved" })),
    getWikiStatus: vi.fn(async () => ({ activeVersion: null, latestFailedVersion: null, importStats: { total: 0, succeeded: 0, failed: 0, faqRows: 0, productRows: 0 } })),
  } as any;
}

const brandId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const attentionId = "33333333-3333-4333-8333-333333333333";
const idempotencyKey = "44444444-4444-4444-8444-444444444444";

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

  it("validates and sends a manual conversation reply", async () => {
    const repo = repository();
    const app = createServer({ repository: repo, logger: false });

    expect((await app.inject({ method: "POST", url: `/brands/${brandId}/dm/conversations/${conversationId}/messages`, payload: { body: " ", idempotencyKey } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/brands/${brandId}/dm/conversations/${conversationId}/messages`, payload: { body: "답변", idempotencyKey: "not-a-uuid" } })).statusCode).toBe(400);
    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/dm/conversations/${conversationId}/messages`,
      payload: { body: "  직접 답변  ", idempotencyKey }
    });

    expect(response.statusCode).toBe(200);
    expect(repo.sendManualDmReply).toHaveBeenCalledWith(brandId, conversationId, "직접 답변", idempotencyKey);
  });

  it.each([
    ["dm_manual_reply_channel_not_ready", 409, "dm_manual_reply_channel_not_ready", null],
    ["dm_manual_reply_failed:meta_graph_401", 502, "meta_graph_401", "failed"],
    ["dm_manual_reply_failed:meta_graph_400", 502, "meta_graph_400", "failed"],
    ["dm_manual_reply_unknown:meta_graph_503", 502, "meta_graph_503", "unknown"],
  ] as const)("returns a classified manual delivery error", async (repositoryError, statusCode, errorCode, deliveryStatus) => {
    const repo = repository();
    repo.sendManualDmReply.mockRejectedValueOnce(new Error(repositoryError));
    const app = createServer({ repository: repo, logger: false });

    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/dm/conversations/${conversationId}/messages`,
      payload: { body: "직접 답변", idempotencyKey },
    });

    expect(response.statusCode).toBe(statusCode);
    expect(response.json()).toEqual({
      error: errorCode,
      deliveryStatus,
      requestId: expect.any(String),
    });
  });
});
