import { describe, expect, it, vi } from "vitest";
import { createRepository } from "./repository.js";

function webhookInput() {
  return {
    recipientId: "ig-account-1",
    senderId: "sender-1",
    messageId: "mid-1",
    text: "운영 시간이 궁금해요",
    isEcho: false,
    timestamp: 1_720_000_000_000,
    rawPayload: { message: { mid: "mid-1", text: "운영 시간이 궁금해요" } },
  };
}

describe("Instagram DM webhook repository", () => {
  it("stores one inbound message and debounces a reply job by conversation", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("from brand_channels channel")) return { rowCount: 1, rows: [{ id: "channel-1", workspace_id: "workspace-1", brand_id: "brand-1" }] };
      if (sql.includes("insert into instagram_dm_conversations")) return { rowCount: 1, rows: [{ id: "conversation-1" }] };
      if (sql.includes("insert into instagram_dm_messages")) return { rowCount: 1, rows: [{ id: "message-1" }] };
      if (sql.includes("from instagram_dm_settings")) return { rowCount: 1, rows: [{ enabled: true }] };
      if (sql.includes("from wiki_chunks")) return { rowCount: 1, rows: [{ ready: true }] };
      if (sql.includes("count(*) filter")) return { rowCount: 1, rows: [{ participant_count: "1", brand_count: "1" }] };
      if (sql.includes("insert into jobs")) return { rowCount: 1, rows: [{ id: "dm-job-1" }] };
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository({ query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as any);

    await expect(repository.receiveInstagramWebhookMessage(webhookInput())).resolves.toEqual({
      status: "queued",
      brandId: "brand-1",
      conversationId: "conversation-1",
      jobId: "dm-job-1",
    });
    const job = statements.find((statement) => statement.sql.includes("insert into jobs"));
    expect(job?.sql).toContain("now() + interval '3 seconds'");
    expect(job?.sql).toContain("on conflict (job_type, dedupe_key)");
    expect(job?.values).toContain("conversation-1");
  });

  it("does not create a job when the chatbot is disabled", async () => {
    const query = vi.fn(async (sql: string) => {
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("from brand_channels channel")) return { rowCount: 1, rows: [{ id: "channel-1", workspace_id: "workspace-1", brand_id: "brand-1" }] };
      if (sql.includes("insert into instagram_dm_conversations")) return { rowCount: 1, rows: [{ id: "conversation-1" }] };
      if (sql.includes("insert into instagram_dm_messages")) return { rowCount: 1, rows: [{ id: "message-1" }] };
      if (sql.includes("from instagram_dm_settings")) return { rowCount: 1, rows: [{ enabled: false }] };
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository({ query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as any);

    await expect(repository.receiveInstagramWebhookMessage(webhookInput())).resolves.toMatchObject({ status: "disabled", jobId: null });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("insert into jobs"))).toBe(false);
  });

  it("keeps a repeated Meta message id idempotent", async () => {
    const query = vi.fn(async (sql: string) => {
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("from brand_channels channel")) return { rowCount: 1, rows: [{ id: "channel-1", workspace_id: "workspace-1", brand_id: "brand-1" }] };
      if (sql.includes("insert into instagram_dm_conversations")) return { rowCount: 1, rows: [{ id: "conversation-1" }] };
      if (sql.includes("insert into instagram_dm_messages")) return { rowCount: 0, rows: [] };
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository({ query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as any);

    await expect(repository.receiveInstagramWebhookMessage(webhookInput())).resolves.toMatchObject({ status: "duplicate", jobId: null });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("insert into jobs"))).toBe(false);
  });
});
