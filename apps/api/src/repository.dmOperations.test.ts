import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRepository } from "./repository.js";
import { encryptCredential } from "./credentialCrypto.js";
import { MetaGraphRequestError } from "./metaGraph.js";
import type { InstagramDmSendInput, InstagramDmSendResult } from "./instagramMessaging.js";

const idempotencyKey = "44444444-4444-4444-8444-444444444444";

function manualReplyFixture(sendInstagramDirectMessage: (input: InstagramDmSendInput) => Promise<InstagramDmSendResult>) {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  let attemptInsertCount = 0;
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    statements.push({ sql, values });
    if (sql.includes("from instagram_dm_conversations conversation") && sql.includes("join brand_channels")) {
      return { rowCount: 1, rows: [{
        id: "conversation-1",
        workspace_id: "workspace-1",
        brand_id: "brand-1",
        brand_channel_id: "channel-1",
        external_participant_id: "recipient-1",
        external_account_id: "instagram-account-1",
        encrypted_payload: encryptCredential("meta-token"),
        auth_mode: "instagram_login"
      }] };
    }
    if (sql.includes("insert into dm_delivery_attempts")) {
      attemptInsertCount += 1;
      return attemptInsertCount === 1
        ? { rowCount: 1, rows: [{ id: "attempt-manual", status: "prepared" }] }
        : { rowCount: 0, rows: [] };
    }
    if (sql.includes("from dm_delivery_attempts attempt") && sql.includes("left join instagram_dm_messages")) {
      return { rowCount: 1, rows: [{
        id: "attempt-manual", status: "sent", provider_message_id: "provider-message-1", error: null,
        message_id: "message-manual", message_created_at: "2026-07-16T01:00:00.000Z",
      }] };
    }
    if (sql.includes("update dm_delivery_attempts") && sql.includes("status = 'sending'")) {
      return { rowCount: 1, rows: [{ id: "attempt-manual" }] };
    }
    if (sql.includes("insert into instagram_dm_messages")) {
      return { rowCount: 1, rows: [{ id: "message-manual", created_at: "2026-07-16T01:00:00.000Z" }] };
    }
    return { rowCount: 1, rows: [] };
  });
  const repository = createRepository({ query, connect: vi.fn() } as any, { sendInstagramDirectMessage });
  return { repository, statements };
}

describe("DM operations repository", () => {
  it("migrates delivery attempts for nullable manual jobs without weakening auto attempts", async () => {
    const migration = await readFile(resolve(process.cwd(), "../../db/migrations/053_dm_manual_delivery_audit.sql"), "utf8");

    expect(migration).toMatch(/alter column job_id drop not null/i);
    expect(migration).toMatch(/origin text not null default 'auto'/i);
    expect(migration).toMatch(/origin in \('auto', 'manual'\)/i);
    expect(migration).toMatch(/origin = 'auto'[\s\S]*job_id is not null[\s\S]*origin = 'manual'[\s\S]*job_id is null/i);
  });

  it("audits prepared, sending, and sent before storing a manual reply", async () => {
    const sendInstagramDirectMessage = vi.fn(async () => ({ externalMessageId: "provider-message-1" }));
    const { repository, statements } = manualReplyFixture(sendInstagramDirectMessage);

    await expect(repository.sendManualDmReply("brand-1", "conversation-1", "직접 답변", idempotencyKey))
      .resolves.toMatchObject({ id: "message-manual", body: "직접 답변", direction: "outbound", deliveryStatus: "sent" });
    expect(sendInstagramDirectMessage).toHaveBeenCalledWith({
      accessToken: "meta-token",
      instagramBusinessAccountId: "instagram-account-1",
      recipientId: "recipient-1",
      text: "직접 답변",
      tag: "HUMAN_AGENT"
    });
    const prepared = statements.findIndex(({ sql }) => sql.includes("insert into dm_delivery_attempts"));
    const sending = statements.findIndex(({ sql }) => sql.includes("update dm_delivery_attempts") && sql.includes("status = 'sending'"));
    const sent = statements.findIndex(({ sql }) => sql.includes("update dm_delivery_attempts") && sql.includes("status = 'sent'"));
    expect(prepared).toBeGreaterThanOrEqual(0);
    expect(prepared).toBeLessThan(sending);
    expect(sending).toBeLessThan(sent);
    expect(statements[prepared].sql).toContain("origin");
    expect(statements[prepared].values).toContain(idempotencyKey);
    expect(statements.some(({ sql }) => sql.includes("delivery_attempt_id"))).toBe(true);
    expect(statements.some(({ sql }) => sql.includes("automation_status") && sql.includes("update instagram_dm_conversations"))).toBe(false);
    expect(statements.some(({ sql }) => sql.includes("attention_status") && sql.includes("update instagram_dm_conversations"))).toBe(false);
  });

  it("audits a manual reply that fails channel credential readiness", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      if (sql.includes("from instagram_dm_conversations conversation") && sql.includes("join brand_channels")) {
        return { rowCount: 1, rows: [{
          id: "conversation-1", workspace_id: "workspace-1", brand_id: "brand-1",
          brand_channel_id: "channel-1", external_participant_id: "recipient-1",
          external_account_id: "instagram-account-1", encrypted_payload: null, auth_mode: "facebook_login",
        }] };
      }
      if (sql.includes("insert into dm_delivery_attempts")) return { rowCount: 1, rows: [{ id: "attempt-manual", status: "prepared" }] };
      return { rowCount: 1, rows: [] };
    });
    const sendInstagramDirectMessage = vi.fn();
    const repository = createRepository({ query, connect: vi.fn() } as any, { sendInstagramDirectMessage });

    await expect(repository.sendManualDmReply("brand-1", "conversation-1", "직접 답변", idempotencyKey))
      .rejects.toThrow("dm_manual_reply_channel_not_ready");

    expect(statements.some(({ sql }) => sql.includes("insert into dm_delivery_attempts"))).toBe(true);
    expect(statements).toContainEqual(expect.objectContaining({
      sql: expect.stringContaining("set status = 'failed'"),
      values: ["attempt-manual", "dm_manual_reply_channel_not_ready"],
    }));
    expect(sendInstagramDirectMessage).not.toHaveBeenCalled();
  });

  it("reuses a sent manual attempt without sending a duplicate message", async () => {
    const sendInstagramDirectMessage = vi.fn(async () => ({ externalMessageId: "provider-message-1" }));
    const { repository } = manualReplyFixture(sendInstagramDirectMessage);

    await repository.sendManualDmReply("brand-1", "conversation-1", "직접 답변", idempotencyKey);
    await expect(repository.sendManualDmReply("brand-1", "conversation-1", "직접 답변", idempotencyKey))
      .resolves.toMatchObject({ id: "message-manual", deliveryStatus: "sent" });
    expect(sendInstagramDirectMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    [new MetaGraphRequestError({ status: 401 }), "failed", "meta_graph_401"],
    [new MetaGraphRequestError({ status: 400 }), "failed", "meta_graph_400"],
    [new MetaGraphRequestError({ status: 503 }), "unknown", "meta_graph_503"],
  ] as const)("stores and returns a classified Meta failure", async (providerError, status, errorCode) => {
    const { repository, statements } = manualReplyFixture(vi.fn(async () => { throw providerError; }));

    await expect(repository.sendManualDmReply("brand-1", "conversation-1", "직접 답변", idempotencyKey))
      .rejects.toThrow(`dm_manual_reply_${status}:${errorCode}`);
    expect(statements).toContainEqual(expect.objectContaining({
      sql: expect.stringContaining("set status = $2"),
      values: ["attempt-manual", status, errorCode],
    }));
  });

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
