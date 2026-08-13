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
  payloadOverrides: Record<string, unknown> = {},
  confirmationStatus: "pending_prompt" | "confirmed" | "cancelled" = "pending_prompt",
  clarificationEnabled = true,
  allowSending = true,
  allowFinalization = true,
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
            ...payloadOverrides,
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
    if (sql.includes("from dm_faq_confirmations") && sql.includes("for update")) {
      return {
        rowCount: 1,
        rows: [{ status: confirmationStatus, expires_at: "2099-01-01T00:00:00.000Z" }],
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
      if (!allowSending) return { rowCount: 0, rows: [] };
      if (attemptStatus !== "prepared") return { rowCount: 0, rows: [] };
      attemptStatus = "sending";
      events.push("sending");
      return { rowCount: 1, rows: [{ id: "attempt-1" }] };
    }
    if (sql.includes("set status = 'sent'")) {
      if (!allowFinalization) {
        attemptStatus = "unknown";
        return { rowCount: 0, rows: [] };
      }
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
  return { repository: createRepository(pool as any, {
    sendInstagramDirectMessage,
    faqMatching: {
      suggestionsEnabled: false,
      expandedExactEnabled: false,
      shadowMatchingEnabled: false,
      clarificationEnabled,
      brandAllowlist: ["brand-1"],
      clarifyThreshold: 0.78,
      confirmationTtlSeconds: 300,
    },
  }), events, statements, sendInstagramDirectMessage, release };
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
      "begin",
      "sending",
      "commit",
      "meta",
      "begin",
      "sent",
      "job-succeeded",
      "outbound",
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

  it("does not send a prepared automatic reply after its live job lease was superseded", async () => {
    const fixture = deliveryFixture(
      async () => ({ externalMessageId: "must-not-send" }),
      "restricted_action",
      {},
      "pending_prompt",
      true,
      false,
    );

    await expect(fixture.repository.completeDmReplyJob("job-1", completion)).resolves.toMatchObject({
      status: "cancelled",
    });
    expect(fixture.sendInstagramDirectMessage).not.toHaveBeenCalled();
    const sending = fixture.statements.find(({ sql }) => sql.includes("set status = 'sending'"));
    expect(sending?.sql).toContain("live_job.status = 'running'");
    expect(sending?.sql).toContain("live_job.locked_by = $6");
    expect(sending?.sql).toContain("live_job.lease_token = $7::uuid");
  });

  it("does not persist a late provider success after lease recovery made the attempt unknown", async () => {
    const fixture = deliveryFixture(
      async () => ({ externalMessageId: "late-provider-success" }),
      "restricted_action",
      {},
      "pending_prompt",
      true,
      true,
      false,
    );

    await expect(fixture.repository.completeDmReplyJob("job-1", completion))
      .rejects.toThrow("dm_delivery_finalization_conflict");
    expect(fixture.sendInstagramDirectMessage).toHaveBeenCalledTimes(1);
    expect(fixture.events).not.toContain("outbound");
    expect(fixture.events).not.toContain("job-succeeded");
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

  it("delivers a clarification prompt, marks it awaiting answer, and creates no attention", async () => {
    const confirmationId = "00000000-0000-4000-8000-000000000020";
    const knowledgeEntryId = "00000000-0000-4000-8000-000000000021";
    const fixture = deliveryFixture(
      async () => ({ externalMessageId: "outbound-clarification" }),
      "knowledge_gap",
      {
        route: "faq_clarification",
        policyReasonCode: "faq_clarification",
        forceAttentionType: null,
        confirmationId,
        exactFaqId: knowledgeEntryId,
        fixedReplyText: "“배송은 얼마나 걸리나요?”에 대해 문의하신 게 맞을까요?",
      },
    );
    const result: DmReplyJobCompletionInput = {
      ...completion,
      result: {
        decision: "answer",
        answer: "worker가 바꾸려 한 문구",
        wikiChunkIds: [],
        knowledgeEntryId,
        confidence: 1,
        reasonCode: "faq_clarification",
        needsAttention: false,
        reason: "faq_clarification_prompt",
      },
    };

    await fixture.repository.completeDmReplyJob("job-1", result);

    expect(fixture.events).not.toContain("attention");
    expect(fixture.sendInstagramDirectMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: "“배송은 얼마나 걸리나요?”에 대해 문의하신 게 맞을까요?",
    }));
    expect(fixture.statements.some(({ sql }) => (
      sql.includes("select id from instagram_dm_conversations") && sql.includes("for update")
    ))).toBe(true);
    expect(fixture.statements.some(({ sql }) => (
      sql.includes("update dm_delivery_attempts attempt")
      && sql.includes("confirmation.status = 'pending_prompt'")
      && sql.includes("confirmation.conversation_id = $5::uuid")
    ))).toBe(true);
    const confirmation = fixture.statements.find((statement) => (
      statement.sql.includes("status = 'awaiting_answer'")
    ));
    expect(confirmation?.sql).toContain("expires_at = now() + ($2::integer * interval '1 second')");
    expect(confirmation?.values).toEqual([confirmationId, 300]);
    const sending = fixture.statements.find(({ sql }) => sql.includes("update dm_delivery_attempts attempt"));
    expect(sending?.sql).toContain("manual.status = 'sending'");
  });

  it("cancels a claimed clarification before Meta when a fast reply already resolved it", async () => {
    const confirmationId = "00000000-0000-4000-8000-000000000020";
    const fixture = deliveryFixture(
      async () => ({ externalMessageId: "must-not-send" }),
      "knowledge_gap",
      {
        route: "faq_clarification",
        policyReasonCode: "faq_clarification",
        forceAttentionType: null,
        confirmationId,
      },
      "confirmed",
    );

    await expect(fixture.repository.completeDmReplyJob("job-1", {
      ...completion,
      result: {
        decision: "answer",
        answer: "확인 질문",
        wikiChunkIds: [],
        knowledgeEntryId: null,
        confidence: 1,
        reasonCode: "faq_clarification",
        needsAttention: false,
        reason: "faq_clarification_prompt",
      },
    })).resolves.toEqual({ id: "job-1", status: "cancelled", decision: "ignore" });

    expect(fixture.sendInstagramDirectMessage).not.toHaveBeenCalled();
    expect(fixture.statements.some(({ sql }) => (
      sql.includes("status = 'cancelled'") && sql.includes("update jobs")
    ))).toBe(true);
  });

  it("cancels a claimed clarification before Meta after the runtime flag is rolled back", async () => {
    const confirmationId = "00000000-0000-4000-8000-000000000020";
    const fixture = deliveryFixture(
      async () => ({ externalMessageId: "must-not-send" }),
      "knowledge_gap",
      {
        route: "faq_clarification",
        policyReasonCode: "faq_clarification",
        forceAttentionType: null,
        confirmationId,
      },
      "pending_prompt",
      false,
    );

    await expect(fixture.repository.completeDmReplyJob("job-1", {
      ...completion,
      result: {
        decision: "answer", answer: "확인 질문", wikiChunkIds: [], knowledgeEntryId: null,
        confidence: 1, reasonCode: "faq_clarification", needsAttention: false,
        reason: "faq_clarification_prompt",
      },
    })).resolves.toEqual({ id: "job-1", status: "cancelled", decision: "ignore" });
    expect(fixture.sendInstagramDirectMessage).not.toHaveBeenCalled();
    expect(fixture.statements.some(({ sql }) => (
      sql.includes("status = 'cancelled'") && sql.includes("update dm_faq_confirmations")
    ))).toBe(true);
  });

  it("releases the acquired client when a duplicate completion sees a terminal attempt", async () => {
    const fixture = deliveryFixture(async () => ({ externalMessageId: "outbound-1" }));

    await fixture.repository.completeDmReplyJob("job-1", completion);
    await fixture.repository.completeDmReplyJob("job-1", completion);

    expect(fixture.release).toHaveBeenCalledTimes(3);
  });

  it("reports an overlapping duplicate completion as in progress while the first Meta send is running", async () => {
    let releaseSend!: () => void;
    const fixture = deliveryFixture(() => new Promise((resolve) => {
      releaseSend = () => resolve({ externalMessageId: "outbound-1" });
    }));

    const first = fixture.repository.completeDmReplyJob("job-1", completion);
    await vi.waitFor(() => expect(fixture.events).toContain("meta"));
    await expect(fixture.repository.completeDmReplyJob("job-1", completion)).resolves.toMatchObject({
      status: "in_progress",
    });
    expect(fixture.sendInstagramDirectMessage).toHaveBeenCalledTimes(1);
    releaseSend();
    await expect(first).resolves.toMatchObject({ status: "succeeded" });
  });

  it("marks a clear provider 4xx failed without adding outbound", async () => {
    const confirmationId = "00000000-0000-4000-8000-000000000020";
    const fixture = deliveryFixture(
      async () => { throw new MetaGraphRequestError({ status: 400 }); },
      "knowledge_gap",
      {
        route: "faq_clarification",
        policyReasonCode: "faq_clarification",
        forceAttentionType: null,
        confirmationId,
        exactFaqId: "00000000-0000-4000-8000-000000000021",
        fixedReplyText: "확인 질문",
      },
    );

    await expect(fixture.repository.completeDmReplyJob("job-1", {
      ...completion,
      result: { ...completion.result, reasonCode: "faq_clarification" },
    })).resolves.toMatchObject({ status: "failed" });
    expect(fixture.events).toContain("failed");
    expect(fixture.events).not.toContain("outbound");
    expect(fixture.statements.some(({ sql, values }) => (
      sql.includes("update dm_faq_confirmations")
      && sql.includes("status = 'cancelled'")
      && values.includes(confirmationId)
    ))).toBe(true);
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
    expect(queries[0]).toContain("update dm_faq_confirmations");
    expect(queries[0]).toContain("attempt.origin = 'manual'");
    expect(queries[0]).toContain("manual_delivery_recovery_required");
    expect(queries[0]).toContain("manual_superseded_jobs");
    expect(queries[0]).toContain("manual_cancelled_confirmations");
    const claim = queries.find((sql) => sql.includes("with cancelled_confirmation_jobs"));
    expect(claim).toContain("conversation.automation_status = 'active'");
  });

  it("cancels queued clarification prompts when the runtime capability is rolled back", async () => {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      queries.push({ sql, values });
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository({
      query,
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    } as any, {
      faqMatching: {
        suggestionsEnabled: false,
        expandedExactEnabled: false,
        shadowMatchingEnabled: false,
        clarificationEnabled: false,
        brandAllowlist: ["brand-1"],
        clarifyThreshold: 0.78,
        confirmationTtlSeconds: 300,
      },
    });

    await expect(repository.claimDmReplyJob("worker-1")).resolves.toBeNull();
    const claim = queries.find(({ sql }) => sql.includes("cancelled_confirmation_jobs"));
    expect(claim?.values).toEqual(["worker-1", false, ["brand-1"]]);
    expect(claim?.sql).toContain("not $2::boolean");
    expect(claim?.sql).toContain("job.brand_id::text = any($3::text[])");
  });

  it.each([
    [false, "failed"],
    [true, "queued"],
  ] as const)("resolves clarification state consistently when worker failure retryable=%s", async (retryable, status) => {
    const statements: string[] = [];
    const query = vi.fn(async (sql: string) => {
      statements.push(sql);
      return { rowCount: 1, rows: [{ id: "job-1", status }] };
    });
    const repository = createRepository({ query, connect: vi.fn() } as any);

    await expect(repository.failDmReplyJob("job-1", {
      workerId: "worker-1",
      leaseToken: completion.leaseToken,
      error: "worker failed",
      retryable,
      retryAfterMs: 1_000,
    })).resolves.toEqual({ id: "job-1", status });

    expect(statements[0]).toContain("cancelled_confirmation");
    expect(statements[0]).toContain("job.status = 'failed'");
    expect(statements[0]).toContain("job.payload_json->>'route' = 'faq_clarification'");
    expect(statements[0]).toContain("confirmation.status = 'pending_prompt'");
  });
});
