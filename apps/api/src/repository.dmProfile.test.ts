import { describe, expect, it, vi } from "vitest";
import { encryptCredential } from "./credentialCrypto.js";
import { createRepository } from "./repository.js";

const webhookInput = {
  recipientId: "ig-account-1", senderId: "sender-123456", messageId: "mid-1",
  text: "안녕하세요", isEcho: false, timestamp: 1, rawPayload: {},
};

function webhookFixture(profileFetchedAt: Date | null) {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    statements.push({ sql, values });
    if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
    if (sql.includes("from brand_channels channel")) return { rowCount: 1, rows: [{ id: "channel-1", workspace_id: "workspace-1", brand_id: "brand-1" }] };
    if (sql.includes("insert into instagram_dm_conversations")) return { rowCount: 1, rows: [{ id: "conversation-1", automation_status: "active", profile_fetched_at: profileFetchedAt }] };
    if (sql.includes("insert into instagram_dm_messages")) return { rowCount: 1, rows: [{ id: "message-1" }] };
    if (sql.includes("insert into dm_turns")) return { rowCount: 1, rows: [{ id: "turn-1", aggregated_text: "안녕하세요" }] };
    if (sql.includes("from instagram_dm_settings")) return { rowCount: 1, rows: [{ enabled: false }] };
    return { rowCount: 0, rows: [] };
  });
  return {
    repository: createRepository({ query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as any),
    statements,
  };
}

describe("Instagram DM profile refresh repository", () => {
  it.each([
    ["missing", null],
    ["stale", new Date("2026-07-12T00:00:00Z")],
  ])("queues one deduplicated profile job for a %s profile without calling Graph", async (_label, fetchedAt) => {
    const fixture = webhookFixture(fetchedAt);
    await expect(fixture.repository.receiveInstagramWebhookMessage(webhookInput)).resolves.toMatchObject({ status: "disabled" });
    const insert = fixture.statements.find((statement) => statement.sql.includes("'instagram_dm_profile_refresh'"));
    expect(insert?.sql).toContain("on conflict (job_type, dedupe_key)");
    expect(insert?.sql).toContain("$5::timestamptz is null");
    expect(insert?.values.slice(0, 4)).toEqual([
      "workspace-1", "brand-1", JSON.stringify({ conversationId: "conversation-1", senderId: "sender-123456" }), "conversation-1",
    ]);
  });

  it("lets the database skip a profile refreshed within 24 hours", async () => {
    const recent = new Date();
    const fixture = webhookFixture(recent);
    await fixture.repository.receiveInstagramWebhookMessage(webhookInput);
    const insert = fixture.statements.find((statement) => statement.sql.includes("'instagram_dm_profile_refresh'"));
    expect(insert?.values[4]).toBe(recent);
    expect(insert?.values[5]).toBe(24);
    expect(insert?.sql).toContain("now() - ($6::double precision * interval '1 hour')");
  });

  it("claims a profile job without returning credentials", async () => {
    const query = vi.fn(async () => ({
      rowCount: 1,
      rows: [{ id: "job-1", workspace_id: "workspace-1", brand_id: "brand-1", lease_token: "lease-1", payload_json: { conversationId: "conversation-1", senderId: "sender-1" }, attempt_count: 1 }],
    }));
    const repository = createRepository({ query, connect: vi.fn() } as any);
    await expect(repository.claimDmProfileRefreshJob("worker-1")).resolves.toEqual({
      id: "job-1", workspaceId: "workspace-1", brandId: "brand-1", leaseToken: "lease-1",
      payload: { conversationId: "conversation-1", senderId: "sender-1" }, attemptCount: 1,
    });
  });

  it("decrypts the credential and refreshes the profile only inside the central API", async () => {
    const query = vi.fn(async (sql: string, _values: unknown[] = []) => {
      if (sql.includes("select job.workspace_id")) return {
        rowCount: 1,
        rows: [{ workspace_id: "workspace-1", brand_id: "brand-1", payload_json: { conversationId: "conversation-1", senderId: "sender-123456" }, encrypted_payload: encryptCredential("secret-token") }],
      };
      return { rowCount: 1, rows: [{ id: "job-1", status: "succeeded" }] };
    });
    const fetchProfile = vi.fn(async () => ({ name: "고객", username: "customer", profilePictureUrl: "https://example.com/p.jpg" }));
    const repository = createRepository({ query, connect: vi.fn() } as any, { fetchInstagramMessagingProfile: fetchProfile });
    await expect(repository.runDmProfileRefreshJob("job-1", { workerId: "worker-1", leaseToken: "lease-1" }))
      .resolves.toEqual({ id: "job-1", status: "succeeded" });
    expect(fetchProfile).toHaveBeenCalledWith({ accessToken: "secret-token", senderId: "sender-123456" });
    expect(query.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining(["고객", "customer", "https://example.com/p.jpg"]));
  });
});
