import { describe, expect, it, vi } from "vitest";
import { createRepository } from "./repository.js";

describe("DM operations repository", () => {
  it("returns a cursor page with participant and open attention metadata", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("from instagram_dm_conversations conversation")) return {
        rowCount: 1,
        rows: [{
          id: "11111111-1111-4111-8111-111111111111",
          external_participant_id: "sender-123456",
          participant_name: null,
          participant_username: "customer",
          participant_profile_url: null,
          last_message_at: "2026-07-14T10:00:00.000Z",
          automation_status: "paused",
          attention_status: "open",
          unread_count: 2,
          last_message_body: "도와주세요",
          last_message_direction: "inbound",
          last_message_created_at: "2026-07-14T10:00:00.000Z",
          open_attention_types: ["complaint"],
        }],
      };
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository({ query, connect: vi.fn() } as any);
    await expect(repository.listDmConversations("brand-1", { filter: "attention", limit: 20 })).resolves.toEqual({
      items: [expect.objectContaining({
        id: "11111111-1111-4111-8111-111111111111",
        participant: expect.objectContaining({ displayName: "customer" }),
        openAttentionTypes: ["complaint"],
        unreadCount: 2,
      })],
      nextCursor: null,
    });
  });

  it("resolves every open item before reactivating the conversation", async () => {
    const statements: string[] = [];
    const query = vi.fn(async (sql: string) => {
      statements.push(sql.trim());
      if (sql.includes("select id, conversation_id")) return { rowCount: 1, rows: [{ id: "attention-1", conversation_id: "conversation-1" }] };
      if (sql.includes("select count(*)")) return { rowCount: 1, rows: [{ count: 0 }] };
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository({ query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as any);
    await expect(repository.resolveDmAttentionItem("attention-1")).resolves.toEqual({
      conversationId: "conversation-1",
      automationStatus: "active",
      attentionStatus: "resolved",
    });
    expect(statements.findIndex((sql) => sql.includes("update dm_attention_items")))
      .toBeLessThan(statements.findIndex((sql) => sql.includes("update instagram_dm_conversations")));
    expect(statements).toContain("commit");
  });

  it("reports active and failed Wiki versions without returning document text", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("from wiki_versions")) return { rowCount: 2, rows: [
        { id: "version-active", status: "active", source_count: 3, document_count: 3, knowledge_entry_count: 2, chunk_count: 7, activated_at: "2026-07-14T09:00:00Z", failed_at: null, error_message: null, created_at: "2026-07-14T08:00:00Z" },
        { id: "version-failed", status: "failed", source_count: 2, document_count: 1, knowledge_entry_count: 1, chunk_count: 0, activated_at: null, failed_at: "2026-07-14T07:00:00Z", error_message: "embedding_failed", created_at: "2026-07-14T06:00:00Z" },
      ] };
      return { rowCount: 1, rows: [{ total: 2, succeeded: 1, failed: 1, faq_rows: 10, product_rows: 4 }] };
    });
    const repository = createRepository({ query, connect: vi.fn() } as any);
    const status = await repository.getWikiStatus("brand-1");
    expect(status.activeVersion).toMatchObject({ id: "version-active", documentCount: 3, chunkCount: 7 });
    expect(status.latestFailedVersion).toMatchObject({ id: "version-failed", errorMessage: "embedding_failed" });
    expect(status.importStats).toEqual({ total: 2, succeeded: 1, failed: 1, faqRows: 10, productRows: 4 });
    expect(JSON.stringify(status)).not.toContain("content");
  });
});
