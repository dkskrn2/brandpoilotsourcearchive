import { describe, expect, it, vi } from "vitest";
import { encryptCredential } from "./credentialCrypto.js";
import { MetaGraphRequestError } from "./metaGraph.js";
import { createRepository } from "./repository.js";
import type { DmReplyJobCompletionInput } from "./types.js";

const completion: DmReplyJobCompletionInput = {
  workerId: "worker-1",
  leaseToken: "00000000-0000-4000-8000-000000000010",
  result: {
    decision: "answer",
    answer: "쿠폰을 발급했습니다.",
    wikiChunkIds: ["00000000-0000-4000-8000-000000000001"],
    knowledgeEntryId: null,
    confidence: 0.9,
    reasonCode: "wiki_answer",
    needsAttention: false,
    reason: "worker answer",
  },
};

function deliveryFixture(
  send: () => Promise<{ externalMessageId: string }>,
  policyReasonCode: "restricted_action" | "complaint" | "knowledge_gap" = "restricted_action",
) {
  const events: string[] = [];
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  let attemptStatus: "prepared" | "sending" | "sent" | "unknown" | "failed" | null = null;
  let jobStatus = "running";

  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    statements.push({ sql, values });
    const normalized = sql.trim();
    if (normalized === "begin" || normalized === "commit" || normalized === "rollback") {
      events.push(normalized);
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes("from jobs job") && sql.includes("instagram_dm_conversations conversation")) {
      events.push("prepare-read");
      return {
        rowCount: 1,
        rows: [{
          id: "job-1",
          workspace_id: "workspace-1",
          brand_id: "brand-1",
          payload_json: {
            conversationId: "conversation-1",
            turnId: "turn-1",
            senderId: "sender-1",
            messageId: "message-1",
            question: "쿠폰을 발급해줘",
            route: "fixed_fallback",
            policyReasonCode,
            forceAttentionType: policyReasonCode,
          },
          job_status: jobStatus,
          locked_by: "worker-1",
          lease_token: completion.leaseToken,
          locked_until_valid: true,
          conversation_id: "conversation-1",
          brand_channel_id: "channel-1",
          external_account_id: "ig-account-1",
          encrypted_payload: encryptCredential("meta-token"),
          auth_mode: "instagram_login",
          attempt_id: attemptStatus ? "attempt-1" : null,
          attempt_status: attemptStatus,
        }],
      };
    }
    if (sql.includes("insert into dm_delivery_attempts")) {
      if (attemptStatus) return { rowCount: 0, rows: [] };
      attemptStatus = "prepared";
      events.push("prepared");
      return { rowCount: 1, rows: [{ id: "attempt-1", status: "prepared" }] };
    }
    if (sql.includes("from dm_delivery_attempts") && sql.includes("where id = $1")) {
      return { rowCount: attemptStatus ? 1 : 0, rows: attemptStatus ? [{ id: "attempt-1", status: attemptStatus }] : [] };
    }
    if (sql.includes("set status = 'sending'")) {
      if (attemptStatus !== "prepared") return { rowCount: 0, rows: [] };
      attemptStatus = "sending";
      events.push("sending");
      return { rowCount: 1, rows: [{ id: "attempt-1" }] };
    }
    if (sql.includes("set status = 'sent'")) {
      attemptStatus = "sent";
      events.push("sent");
      return { rowCount: 1, rows: [{ id: "attempt-1" }] };
    }
    if (sql.includes("set status = 'unknown'")) {
      attemptStatus = "unknown";
      events.push("unknown");
      return { rowCount: 1, rows: [{ id: "attempt-1" }] };
    }
    if (sql.includes("set status = 'failed'") && sql.includes("dm_delivery_attempts")) {
      attemptStatus = "failed";
      events.push("failed");
      return { rowCount: 1, rows: [{ id: "attempt-1" }] };
    }
    if (sql.includes("insert into instagram_dm_messages")) events.push("outbound");
    if (sql.includes("insert into dm_attention_items")) events.push("attention");
    if (sql.includes("automation_status = 'paused'")) events.push("paused");
    if (sql.includes("attention_status = 'open'") && !sql.includes("automation_status = 'paused'")) events.push("attention-open");
    if (sql.includes("update jobs") && sql.includes("status = 'succeeded'")) {
      jobStatus = "succeeded";
      events.push("job-succeeded");
    }
    if (sql.includes("update jobs") && sql.includes("status = 'failed'")) {
      jobStatus = "failed";
      events.push("job-failed");
    }
    return { rowCount: 1, rows: [] };
  });
  const sendInstagramDirectMessage = vi.fn(async () => {
    events.push("meta");
    return send();
  });
  const release = vi.fn();
  const pool = { query, connect: vi.fn(async () => ({ query, release })) };
  return { repository: createRepository(pool as any, { sendInstagramDirectMessage }), events, statements, sendInstagramDirectMessage, release };
}

describe("DM delivery lifecycle", () => {
  it("commits prepare before Meta, finalizes after confirmation, and never sends the same job twice", async () => {
    const fixture = deliveryFixture(async () => ({ externalMessageId: "outbound-1" }));

    await expect(fixture.repository.completeDmReplyJob("job-1", completion)).resolves.toEqual({
      id: "job-1",
      status: "succeeded",
      decision: "fallback",
    });
    expect(fixture.events).toEqual([
      "begin",
      "prepare-read",
      "prepared",
      "commit",
      "sending",
      "meta",
      "begin",
      "sent",
      "outbound",
      "job-succeeded",
      "attention",
      "attention-open",
      "commit",
    ]);
    expect(fixture.events).not.toContain("paused");
    await expect(fixture.repository.completeDmReplyJob("job-1", completion)).resolves.toMatchObject({ status: "succeeded" });

    expect(fixture.sendInstagramDirectMessage).toHaveBeenCalledTimes(1);
    expect(fixture.sendInstagramDirectMessage).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: "meta-token",
      recipientId: "sender-1",
      text: "자동 처리할 수 없는 요청입니다. 담당자가 확인하겠습니다.",
    }));
    const outbound = fixture.statements.find((statement) => statement.sql.includes("insert into instagram_dm_messages"));
    expect(outbound?.sql).toContain("decision, reason_code, delivery_attempt_id");
  });

  it("marks an ambiguous send unknown, creates attention, pauses, and does not add outbound", async () => {
    const fixture = deliveryFixture(async () => { throw Object.assign(new Error("socket reset"), { code: "ECONNRESET" }); });

    await expect(fixture.repository.completeDmReplyJob("job-1", completion)).resolves.toMatchObject({ status: "failed" });
    expect(fixture.events).toEqual(expect.arrayContaining(["unknown", "job-failed", "attention", "paused"]));
    expect(fixture.events).not.toContain("outbound");
    await fixture.repository.completeDmReplyJob("job-1", completion);
    expect(fixture.sendInstagramDirectMessage).toHaveBeenCalledTimes(1);
  });

  it("preserves a knowledge-gap fixed fallback and sends the knowledge-gap notice", async () => {
    const fixture = deliveryFixture(async () => ({ externalMessageId: "outbound-1" }), "knowledge_gap");

    await fixture.repository.completeDmReplyJob("job-1", completion);

    expect(fixture.sendInstagramDirectMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: "현재 확인 가능한 안내 자료가 부족합니다. 담당자가 확인 후 안내드리겠습니다.",
    }));
    const outbound = fixture.statements.find((statement) => statement.sql.includes("insert into instagram_dm_messages"));
    expect(outbound?.values).toEqual(expect.arrayContaining(["knowledge_gap"]));
    expect(fixture.events).toContain("attention-open");
    expect(fixture.events).not.toContain("paused");
  });

  it("keeps complaint conversations paused for operator review", async () => {
    const fixture = deliveryFixture(async () => ({ externalMessageId: "outbound-1" }), "complaint");

    await fixture.repository.completeDmReplyJob("job-1", completion);

    expect(fixture.events).toEqual(expect.arrayContaining(["attention", "paused"]));
  });

  it("releases the acquired client when a duplicate completion sees a terminal attempt", async () => {
    const fixture = deliveryFixture(async () => ({ externalMessageId: "outbound-1" }));

    await fixture.repository.completeDmReplyJob("job-1", completion);
    await fixture.repository.completeDmReplyJob("job-1", completion);

    expect(fixture.release).toHaveBeenCalledTimes(2);
  });

  it("marks a clear provider 4xx failed without adding outbound", async () => {
    const fixture = deliveryFixture(async () => { throw new MetaGraphRequestError({ status: 400 }); });

    await expect(fixture.repository.completeDmReplyJob("job-1", completion)).resolves.toMatchObject({ status: "failed" });
    expect(fixture.events).toContain("failed");
    expect(fixture.events).not.toContain("outbound");
  });

  it("recovers an expired sending attempt as unknown before claiming another job", async () => {
    const queries: string[] = [];
    const query = vi.fn(async (sql: string) => {
      queries.push(sql);
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository({
      query,
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    } as any);

    await expect(repository.claimDmReplyJob("worker-1")).resolves.toBeNull();
    expect(queries[0]).toContain("attempt.status = 'sending'");
    expect(queries[0]).toContain("job.locked_until < now()");
    expect(queries[0]).toContain("status = 'unknown'");
    expect(queries[0]).toContain("insert into dm_attention_items");
    expect(queries[0]).toContain("automation_status = 'paused'");
  });
});
