import { describe, expect, it, vi } from "vitest";
import { createRepository } from "./repository.js";

function webhookInput(messageId = "mid-1", text = "운영 시간이 궁금해요") {
  return {
    recipientId: "ig-account-1",
    senderId: "sender-1",
    messageId,
    text,
    isEcho: false,
    timestamp: 1_720_000_000_000,
    rawPayload: { message: { mid: messageId, text } },
  };
}

function isDmReplyJobInsert(sql: unknown) {
  const statement = String(sql);
  return statement.includes("insert into jobs") && statement.includes("'instagram_dm_reply'");
}

describe("Instagram DM webhook repository", () => {
  function activeKnowledgeFixture(
    exactFaq: { knowledge_entry_id: string | null; conflict_marker: string | null },
    options: Parameters<typeof createRepository>[1] = {},
    aggregatedQuestion = "배송은 얼마나 걸리나요?\n제주도도 같나요?",
    pendingConfirmation: Record<string, unknown> | null = null,
    clarificationSending = false,
    limits = { participant_count: "1", brand_count: "1" },
  ) {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("from brand_channels channel")) return { rowCount: 1, rows: [{ id: "channel-1", workspace_id: "workspace-1", brand_id: "brand-1" }] };
      if (sql.includes("insert into instagram_dm_conversations")) return { rowCount: 1, rows: [{ id: "conversation-1", automation_status: "active" }] };
      if (sql.includes("insert into instagram_dm_messages")) return { rowCount: 1, rows: [{ id: "message-1" }] };
      if (sql.includes("insert into dm_turns")) return { rowCount: 1, rows: [{ id: "turn-1", aggregated_text: aggregatedQuestion }] };
      if (sql.includes("from instagram_dm_settings")) return { rowCount: 1, rows: [{ enabled: true }] };
      if (sql.includes("from dm_faq_confirmations confirmation") && sql.includes("for update")) {
        return pendingConfirmation
          ? { rowCount: 1, rows: [pendingConfirmation] }
          : { rowCount: 0, rows: [] };
      }
      if (sql.includes("from dm_delivery_attempts attempt") && sql.includes("faq_clarification")) {
        return clarificationSending ? { rowCount: 1, rows: [{ id: "attempt-clarification" }] } : { rowCount: 0, rows: [] };
      }
      if (sql.includes("from wiki_versions version")) return { rowCount: 1, rows: [{ ready: true }] };
      if (sql.includes("find_direct_faq_exact")) return { rowCount: 1, rows: [exactFaq] };
      if (sql.includes("from knowledge_entries") && sql.includes("manual_aliases")) return {
        rowCount: 2,
        rows: [
          {
            id: "00000000-0000-4000-8000-000000000010",
            question: "배송은 얼마나 걸리나요?",
            aliases: ["배송 기간"],
            manual_aliases: ["택배 언제 와요"],
          },
          {
            id: "00000000-0000-4000-8000-000000000011",
            question: "운영시간이 어떻게 되나요?",
            aliases: [],
            manual_aliases: ["몇 시에 열어요"],
          },
        ],
      };
      if (sql.includes("insert into dm_faq_confirmations")) return {
        rowCount: 1,
        rows: [{ id: "00000000-0000-4000-8000-000000000012" }],
      };
      if (sql.includes("count(*) filter")) return { rowCount: 1, rows: [limits] };
      if (sql.includes("insert into jobs")) return { rowCount: 1, rows: [{ id: "dm-job-1" }] };
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository(
      { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as any,
      options,
    );
    return { aggregatedQuestion, query, repository, statements };
  }

  it("does not assign a DM when the same Instagram account belongs to multiple brands", async () => {
    const query = vi.fn(async (sql: string) => {
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("from brand_channels channel")) {
        return {
          rowCount: 2,
          rows: [
            { id: "channel-1", workspace_id: "workspace-1", brand_id: "brand-1" },
            { id: "channel-2", workspace_id: "workspace-2", brand_id: "brand-2" },
          ],
        };
      }
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository({ query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as any);

    await expect(repository.receiveInstagramWebhookMessage(webhookInput())).resolves.toEqual({
      status: "unknown_recipient",
      brandId: null,
      conversationId: null,
      jobId: null,
    });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("insert into instagram_dm_conversations"))).toBe(false);
  });

  it("adds a unique exact FAQ ID to an active knowledge job using the aggregated question", async () => {
    const exactFaqId = "00000000-0000-4000-8000-000000000003";
    const fixture = activeKnowledgeFixture({ knowledge_entry_id: exactFaqId, conflict_marker: null });

    await expect(fixture.repository.receiveInstagramWebhookMessage(webhookInput("mid-1", "제주도도 같나요?")))
      .resolves.toMatchObject({ status: "queued", jobId: "dm-job-1" });

    const exactLookup = fixture.statements.find((statement) => statement.sql.includes("find_direct_faq_exact"));
    expect(exactLookup?.values).toEqual(["workspace-1", "brand-1", fixture.aggregatedQuestion]);
    expect(fixture.statements.some((statement) => statement.sql.includes("from wiki_versions version"))).toBe(false);
    const job = fixture.statements.find((statement) => isDmReplyJobInsert(statement.sql));
    expect(JSON.parse(String(job?.values[2]))).toMatchObject({
      route: "knowledge",
      question: fixture.aggregatedQuestion,
      exactFaqId,
    });
  });

  it("opens attention and queues one fixed knowledge-gap fallback without pausing the conversation", async () => {
    const fixture = activeKnowledgeFixture({ knowledge_entry_id: null, conflict_marker: "knowledge_conflict" });

    await expect(fixture.repository.receiveInstagramWebhookMessage(webhookInput("mid-1", "제주도도 같나요?")))
      .resolves.toMatchObject({ status: "queued", jobId: "dm-job-1" });

    const attention = fixture.statements.filter((statement) => statement.sql.includes("insert into dm_attention_items"));
    expect(attention).toHaveLength(1);
    expect(attention[0]?.values).toEqual([
      "workspace-1", "brand-1", "conversation-1", "message-1", "turn-1",
      JSON.stringify({ reason: "knowledge_conflict" }),
    ]);
    expect(attention[0]?.sql).toContain("'knowledge_gap', 'knowledge_gap'");
    const pauses = fixture.statements.filter((statement) => statement.sql.includes("automation_status = 'paused'"));
    expect(pauses).toHaveLength(0);
    const attentionUpdates = fixture.statements.filter((statement) => statement.sql.includes("attention_status = 'open'"));
    expect(attentionUpdates).toHaveLength(1);
    expect(attentionUpdates[0]?.values).toEqual(["conversation-1"]);
    const jobs = fixture.statements.filter((statement) => isDmReplyJobInsert(statement.sql));
    expect(jobs).toHaveLength(1);
    expect(JSON.parse(String(jobs[0]?.values[2]))).toMatchObject({
      route: "fixed_fallback",
      policyReasonCode: "knowledge_gap",
      forceAttentionType: "knowledge_gap",
      question: fixture.aggregatedQuestion,
    });
  });

  it("leaves an unmatched active knowledge message as a normal knowledge job", async () => {
    const fixture = activeKnowledgeFixture({ knowledge_entry_id: null, conflict_marker: null });

    await expect(fixture.repository.receiveInstagramWebhookMessage(webhookInput("mid-1", "제주도도 같나요?")))
      .resolves.toMatchObject({ status: "queued", jobId: "dm-job-1" });

    const job = fixture.statements.find((statement) => isDmReplyJobInsert(statement.sql));
    const wikiReadiness = fixture.statements.find((statement) => statement.sql.includes("from wiki_versions version"));
    expect(wikiReadiness?.sql).toContain("chunk.enabled");
    expect(wikiReadiness?.sql).not.toContain("chunk.embedding");
    expect(wikiReadiness?.values).toEqual(["brand-1"]);
    expect(JSON.parse(String(job?.values[2]))).toEqual({
      conversationId: "conversation-1",
      turnId: "turn-1",
      senderId: "sender-1",
      messageId: "message-1",
      question: fixture.aggregatedQuestion,
      route: "knowledge",
      policyReasonCode: "wiki_answer",
      forceAttentionType: null,
    });
    expect(fixture.statements.some((statement) => statement.sql.includes("dm_attention_items"))).toBe(false);
  });

  it("uses a normalized manual alias as expanded exact only for an allowlisted brand", async () => {
    const fixture = activeKnowledgeFixture(
      { knowledge_entry_id: null, conflict_marker: null },
      {
        faqMatching: {
          suggestionsEnabled: false,
          expandedExactEnabled: true,
          shadowMatchingEnabled: false,
          clarificationEnabled: false,
          brandAllowlist: ["brand-1"],
          clarifyThreshold: 0.78,
          confirmationTtlSeconds: 300,
        },
      },
      "택배 언제 와요?!",
    );
    await fixture.repository.receiveInstagramWebhookMessage(webhookInput("mid-expanded", "택배 언제 와요?!"));
    const job = fixture.statements.find((statement) => isDmReplyJobInsert(statement.sql));
    expect(JSON.parse(String(job?.values[2]))).toMatchObject({
      route: "knowledge",
      exactFaqId: "00000000-0000-4000-8000-000000000010",
    });
    expect(fixture.statements.some((statement) => statement.sql.includes("from wiki_versions version"))).toBe(false);
  });

  it("records only identifiers and scores in shadow mode without changing the knowledge route", async () => {
    const telemetry = vi.fn();
    const privateQuestion = "배송은 얼마나 걸리나용";
    const fixture = activeKnowledgeFixture(
      { knowledge_entry_id: null, conflict_marker: null },
      {
        faqMatching: {
          suggestionsEnabled: false,
          expandedExactEnabled: false,
          shadowMatchingEnabled: true,
          clarificationEnabled: false,
          brandAllowlist: ["brand-1"],
          clarifyThreshold: 0.78,
          confirmationTtlSeconds: 300,
        },
        faqMatchTelemetry: telemetry,
      },
      privateQuestion,
    );

    await fixture.repository.receiveInstagramWebhookMessage(webhookInput("mid-shadow", privateQuestion));

    expect(telemetry).toHaveBeenCalledWith({
      event: "faq_match_shadow",
      messageId: "mid-shadow",
      kind: "candidate",
      knowledgeEntryId: "00000000-0000-4000-8000-000000000010",
      score: expect.any(Number),
    });
    expect(JSON.stringify(telemetry.mock.calls)).not.toContain(privateQuestion);
    const job = fixture.statements.find((statement) => isDmReplyJobInsert(statement.sql));
    expect(JSON.parse(String(job?.values[2]))).toMatchObject({ route: "knowledge" });
    expect(JSON.parse(String(job?.values[2]))).not.toHaveProperty("exactFaqId");
  });

  it("does not let shadow telemetry failure roll back DM routing", async () => {
    const fixture = activeKnowledgeFixture(
      { knowledge_entry_id: null, conflict_marker: null },
      {
        faqMatching: {
          suggestionsEnabled: false,
          expandedExactEnabled: false,
          shadowMatchingEnabled: true,
          clarificationEnabled: false,
          brandAllowlist: ["brand-1"],
          clarifyThreshold: 0.78,
          confirmationTtlSeconds: 300,
        },
        faqMatchTelemetry: () => { throw new Error("telemetry_unavailable"); },
      },
      "배송은 얼마나 걸리나용",
    );

    await expect(fixture.repository.receiveInstagramWebhookMessage(
      webhookInput("mid-shadow-failure", "배송은 얼마나 걸리나용"),
    )).resolves.toBeDefined();
    const job = fixture.statements.find((statement) => isDmReplyJobInsert(statement.sql));
    expect(JSON.parse(String(job?.values[2]))).toMatchObject({ route: "knowledge" });
  });

  it("queues a fixed clarification prompt for a fuzzy candidate without direct answering", async () => {
    const fixture = activeKnowledgeFixture(
      { knowledge_entry_id: null, conflict_marker: null },
      {
        faqMatching: {
          suggestionsEnabled: false,
          expandedExactEnabled: false,
          shadowMatchingEnabled: true,
          clarificationEnabled: true,
          brandAllowlist: ["brand-1"],
          clarifyThreshold: 0.7,
          confirmationTtlSeconds: 300,
        },
      },
      "배송은 얼마나 걸리나용",
    );
    await fixture.repository.receiveInstagramWebhookMessage(webhookInput("mid-fuzzy", "배송은 얼마나 걸리나용"));
    const job = fixture.statements.find((statement) => isDmReplyJobInsert(statement.sql));
    expect(JSON.parse(String(job?.values[2]))).toMatchObject({
      route: "faq_clarification",
      policyReasonCode: "faq_clarification",
      confirmationId: "00000000-0000-4000-8000-000000000012",
      fixedReplyText: expect.stringContaining("배송은 얼마나 걸리나요?"),
    });
    expect(job?.values[4]).toBe(true);
    expect(fixture.statements.some((statement) => statement.sql.includes("from wiki_versions version"))).toBe(false);
  });

  it("uses a fast affirmative reply to cancel the deferred prompt and queue the confirmed FAQ", async () => {
    const knowledgeEntryId = "00000000-0000-4000-8000-000000000010";
    const confirmationId = "00000000-0000-4000-8000-000000000012";
    const fixture = activeKnowledgeFixture(
      { knowledge_entry_id: null, conflict_marker: null },
      {
        faqMatching: {
          suggestionsEnabled: false,
          expandedExactEnabled: false,
          shadowMatchingEnabled: false,
          clarificationEnabled: true,
          brandAllowlist: ["brand-1"],
          clarifyThreshold: 0.78,
          confirmationTtlSeconds: 300,
        },
      },
      "네",
      {
        id: confirmationId,
        knowledge_entry_id: knowledgeEntryId,
        status: "awaiting_answer",
        expires_at: "2099-01-01T00:00:00.000Z",
      },
    );

    await fixture.repository.receiveInstagramWebhookMessage(webhookInput("mid-confirm", "네"));

    const job = fixture.statements.find((statement) => isDmReplyJobInsert(statement.sql));
    expect(JSON.parse(String(job?.values[2]))).toMatchObject({
      route: "knowledge",
      exactFaqId: knowledgeEntryId,
      parentConfirmationId: confirmationId,
    });
    expect(job?.values[3]).toBe(`faq-confirmation:${confirmationId}`);
    expect(fixture.statements.some(({ sql }) => sql.includes("status = 'confirmed'"))).toBe(true);
    expect(fixture.statements.some(({ sql }) => (
      sql.includes("update jobs set status = 'cancelled'") && sql.includes("confirmationId")
    ))).toBe(true);
    expect(fixture.statements.some(({ sql }) => sql.includes("find_direct_faq_exact"))).toBe(false);
  });

  it.each([
    ["아니요", "rejected", "2099-01-01T00:00:00.000Z"],
    ["다른 질문이에요", "cancelled", "2099-01-01T00:00:00.000Z"],
    ["새 질문이에요", "expired", "2000-01-01T00:00:00.000Z"],
  ])("resolves an active confirmation as %s -> %s and routes the message normally", async (
    text,
    expectedStatus,
    expiresAt,
  ) => {
    const fixture = activeKnowledgeFixture(
      { knowledge_entry_id: null, conflict_marker: null },
      {
        faqMatching: {
          suggestionsEnabled: false,
          expandedExactEnabled: false,
          shadowMatchingEnabled: false,
          clarificationEnabled: true,
          brandAllowlist: ["brand-1"],
          clarifyThreshold: 0.95,
          confirmationTtlSeconds: 300,
        },
      },
      text,
      {
        id: "00000000-0000-4000-8000-000000000012",
        knowledge_entry_id: "00000000-0000-4000-8000-000000000010",
        status: "awaiting_answer",
        expires_at: expiresAt,
      },
    );

    await fixture.repository.receiveInstagramWebhookMessage(webhookInput(`mid-${expectedStatus}`, text));

    expect(fixture.statements.some(({ sql, values }) => (
      sql.includes("update dm_faq_confirmations")
      && (sql.includes(`status = '${expectedStatus}'`) || values.includes(expectedStatus))
    ))).toBe(true);
    expect(fixture.statements.some(({ sql }) => sql.includes("find_direct_faq_exact"))).toBe(true);
  });

  it("does not discard a fast affirmative reply while its clarification prompt is already sending", async () => {
    const fixture = activeKnowledgeFixture(
      { knowledge_entry_id: null, conflict_marker: null },
      {
        faqMatching: {
          suggestionsEnabled: false,
          expandedExactEnabled: false,
          shadowMatchingEnabled: false,
          clarificationEnabled: true,
          brandAllowlist: ["brand-1"],
          clarifyThreshold: 0.78,
          confirmationTtlSeconds: 300,
        },
      },
      "네",
      {
        id: "00000000-0000-4000-8000-000000000012",
        knowledge_entry_id: "00000000-0000-4000-8000-000000000010",
        status: "pending_prompt",
        expires_at: "2099-01-01T00:00:00.000Z",
      },
      true,
    );

    await expect(fixture.repository.receiveInstagramWebhookMessage(
      webhookInput("mid-fast-confirm", "네"),
    )).resolves.toMatchObject({ status: "queued", jobId: "dm-job-1" });
    const job = fixture.statements.find(({ sql }) => isDmReplyJobInsert(sql));
    expect(JSON.parse(String(job?.values[2]))).toMatchObject({
      exactFaqId: "00000000-0000-4000-8000-000000000010",
      parentConfirmationId: "00000000-0000-4000-8000-000000000012",
    });
    expect(fixture.statements.some(({ sql }) => sql.includes("status = 'confirmed'"))).toBe(true);
  });

  it("checks the inbound rate limit before creating or resolving a FAQ confirmation", async () => {
    const fixture = activeKnowledgeFixture(
      { knowledge_entry_id: null, conflict_marker: null },
      {
        faqMatching: {
          suggestionsEnabled: false,
          expandedExactEnabled: false,
          shadowMatchingEnabled: true,
          clarificationEnabled: true,
          brandAllowlist: ["brand-1"],
          clarifyThreshold: 0.7,
          confirmationTtlSeconds: 300,
        },
      },
      "배송은 얼마나 걸리나용",
      null,
      false,
      { participant_count: "21", brand_count: "1" },
    );

    await expect(fixture.repository.receiveInstagramWebhookMessage(
      webhookInput("mid-rate-limited", "배송은 얼마나 걸리나용"),
    )).resolves.toMatchObject({ status: "rate_limited", jobId: null });
    const rateCheckIndex = fixture.statements.findIndex(({ sql }) => sql.includes("count(*) filter"));
    const confirmationMutationIndex = fixture.statements.findIndex(({ sql }) => (
      sql.includes("insert into dm_faq_confirmations") || sql.includes("update dm_faq_confirmations")
    ));
    expect(rateCheckIndex).toBeGreaterThanOrEqual(0);
    expect(confirmationMutationIndex).toBe(-1);
  });

  it("aggregates three active messages into one turn and refreshes its queued job", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    let messageSequence = 0;
    let aggregatedText = "";
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("from brand_channels channel")) return { rowCount: 1, rows: [{ id: "channel-1", workspace_id: "workspace-1", brand_id: "brand-1" }] };
      if (sql.includes("insert into instagram_dm_conversations")) return { rowCount: 1, rows: [{ id: "conversation-1", automation_status: "active" }] };
      if (sql.includes("insert into instagram_dm_messages")) {
        messageSequence += 1;
        return { rowCount: 1, rows: [{ id: `message-${messageSequence}` }] };
      }
      if (sql.includes("insert into dm_turns")) {
        aggregatedText = aggregatedText ? `${aggregatedText}\n${String(values[3])}` : String(values[3]);
        return { rowCount: 1, rows: [{ id: "turn-1", aggregated_text: aggregatedText }] };
      }
      if (sql.includes("from instagram_dm_settings")) return { rowCount: 1, rows: [{ enabled: true }] };
      if (sql.includes("from wiki_versions version")) return { rowCount: 1, rows: [{ ready: true }] };
      if (sql.includes("count(*) filter")) return { rowCount: 1, rows: [{ participant_count: "1", brand_count: "1" }] };
      if (sql.includes("insert into jobs")) return { rowCount: 1, rows: [{ id: "dm-job-1" }] };
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository({ query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as any);

    const messages = ["쿠폰이 있는데", "발급해줘", "지금 부탁해"];
    for (const [index, text] of messages.entries()) {
      await expect(repository.receiveInstagramWebhookMessage(webhookInput(`mid-${index + 1}`, text))).resolves.toMatchObject({
        status: "queued",
        jobId: "dm-job-1",
      });
    }

    const turnStatements = statements.filter((statement) => statement.sql.includes("insert into dm_turns"));
    const messageLinks = statements.filter((statement) => statement.sql.includes("update instagram_dm_messages") && statement.sql.includes("turn_id"));
    const jobStatements = statements.filter((statement) => isDmReplyJobInsert(statement.sql));
    expect(turnStatements).toHaveLength(3);
    expect(turnStatements.every((statement) => statement.sql.includes("dm_turns.aggregated_text || E'\\n' || excluded.aggregated_text"))).toBe(true);
    expect(messageLinks.map((statement) => statement.values)).toEqual([
      ["message-1", "turn-1"],
      ["message-2", "turn-1"],
      ["message-3", "turn-1"],
    ]);
    expect(jobStatements).toHaveLength(3);
    expect(jobStatements.every((statement) => statement.values[3] === "turn-1")).toBe(true);
    expect(jobStatements.every((statement) => statement.sql.includes("run_at = case when jobs.status = 'queued' then excluded.run_at"))).toBe(true);
    expect(jobStatements.map((statement) => JSON.parse(String(statement.values[2])).question)).toEqual([
      "쿠폰이 있는데",
      "쿠폰이 있는데\n발급해줘",
      "쿠폰이 있는데\n발급해줘\n지금 부탁해",
    ]);
  });

  it("does not create a job when the chatbot is disabled", async () => {
    const query = vi.fn(async (sql: string) => {
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("from brand_channels channel")) return { rowCount: 1, rows: [{ id: "channel-1", workspace_id: "workspace-1", brand_id: "brand-1" }] };
      if (sql.includes("insert into instagram_dm_conversations")) return { rowCount: 1, rows: [{ id: "conversation-1", automation_status: "active" }] };
      if (sql.includes("insert into instagram_dm_messages")) return { rowCount: 1, rows: [{ id: "message-1" }] };
      if (sql.includes("insert into dm_turns")) return { rowCount: 1, rows: [{ id: "turn-1", aggregated_text: "운영 시간이 궁금해요" }] };
      if (sql.includes("from instagram_dm_settings")) return { rowCount: 1, rows: [{ enabled: false }] };
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository({ query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as any);

    await expect(repository.receiveInstagramWebhookMessage(webhookInput())).resolves.toMatchObject({ status: "disabled", jobId: null });
    expect(query.mock.calls.some(([sql]) => isDmReplyJobInsert(sql))).toBe(false);
  });

  it("starts a new turn when the previous collecting window has expired", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    let messageSequence = 0;
    let turnSequence = 1;
    let aggregatedText = "";
    let expireBeforeNextMessage = false;
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("from brand_channels channel")) return { rowCount: 1, rows: [{ id: "channel-1", workspace_id: "workspace-1", brand_id: "brand-1" }] };
      if (sql.includes("insert into instagram_dm_conversations")) return { rowCount: 1, rows: [{ id: "conversation-1", automation_status: "active" }] };
      if (sql.includes("insert into instagram_dm_messages")) {
        messageSequence += 1;
        return { rowCount: 1, rows: [{ id: `message-${messageSequence}` }] };
      }
      if (sql.includes("update dm_turns") && sql.includes("closes_at <= now()")) {
        if (expireBeforeNextMessage) {
          turnSequence += 1;
          aggregatedText = "";
          expireBeforeNextMessage = false;
        }
        return { rowCount: turnSequence > 1 ? 1 : 0, rows: [] };
      }
      if (sql.includes("insert into dm_turns")) {
        aggregatedText = aggregatedText ? `${aggregatedText}\n${String(values[3])}` : String(values[3]);
        return { rowCount: 1, rows: [{ id: `turn-${turnSequence}`, aggregated_text: aggregatedText }] };
      }
      if (sql.includes("from instagram_dm_settings")) return { rowCount: 1, rows: [{ enabled: true }] };
      if (sql.includes("from wiki_versions version")) return { rowCount: 1, rows: [{ ready: true }] };
      if (sql.includes("count(*) filter")) return { rowCount: 1, rows: [{ participant_count: "1", brand_count: "1" }] };
      if (sql.includes("insert into jobs")) return { rowCount: 1, rows: [{ id: `dm-job-${turnSequence}` }] };
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository({ query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as any);

    await repository.receiveInstagramWebhookMessage(webhookInput("mid-1", "첫 문의"));
    expireBeforeNextMessage = true;
    await repository.receiveInstagramWebhookMessage(webhookInput("mid-2", "다음 문의"));

    const messageLinks = statements.filter((statement) => statement.sql.includes("update instagram_dm_messages") && statement.sql.includes("turn_id"));
    const jobStatements = statements.filter((statement) => isDmReplyJobInsert(statement.sql));
    const turnStatements = statements.filter((statement) => statement.sql.includes("insert into dm_turns"));
    const expiredTurnStatements = statements.filter((statement) => statement.sql.includes("update dm_turns") && statement.sql.includes("closes_at <= now()"));
    expect(messageLinks.map((statement) => statement.values)).toEqual([
      ["message-1", "turn-1"],
      ["message-2", "turn-2"],
    ]);
    expect(jobStatements.map((statement) => statement.values[3])).toEqual(["turn-1", "turn-2"]);
    expect(jobStatements.map((statement) => JSON.parse(String(statement.values[2])).question)).toEqual(["첫 문의", "다음 문의"]);
    expect(turnStatements.every((statement) => statement.sql.includes("where dm_turns.closes_at > now()"))).toBe(true);
    expect(expiredTurnStatements.every((statement) => statement.sql.includes("status = 'queued'"))).toBe(true);
  });

  it("links a paused inbound message to its turn without creating a job or notice", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("from brand_channels channel")) return { rowCount: 1, rows: [{ id: "channel-1", workspace_id: "workspace-1", brand_id: "brand-1" }] };
      if (sql.includes("insert into instagram_dm_conversations")) return { rowCount: 1, rows: [{ id: "conversation-1", automation_status: "paused" }] };
      if (sql.includes("insert into instagram_dm_messages")) return { rowCount: 1, rows: [{ id: "message-1" }] };
      if (sql.includes("insert into dm_turns")) return { rowCount: 1, rows: [{ id: "turn-1", aggregated_text: "추가 문의" }] };
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository({ query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as any);

    await expect(repository.receiveInstagramWebhookMessage(webhookInput())).resolves.toMatchObject({ status: "paused", jobId: null });
    expect(statements.some((statement) => statement.sql.includes("insert into dm_turns"))).toBe(true);
    expect(statements.find((statement) => statement.sql.includes("update instagram_dm_messages") && statement.sql.includes("turn_id"))?.values)
      .toEqual(["message-1", "turn-1"]);
    expect(query.mock.calls.some(([sql]) => isDmReplyJobInsert(sql))).toBe(false);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("dm_attention_items"))).toBe(false);
  });

  it("keeps a repeated Meta message id idempotent", async () => {
    const query = vi.fn(async (sql: string) => {
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("from brand_channels channel")) return { rowCount: 1, rows: [{ id: "channel-1", workspace_id: "workspace-1", brand_id: "brand-1" }] };
      if (sql.includes("insert into instagram_dm_conversations")) return { rowCount: 1, rows: [{ id: "conversation-1", automation_status: "active" }] };
      if (sql.includes("insert into instagram_dm_messages")) return { rowCount: 0, rows: [] };
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository({ query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as any);

    await expect(repository.receiveInstagramWebhookMessage(webhookInput())).resolves.toMatchObject({ status: "duplicate", jobId: null });
    expect(query.mock.calls.some(([sql]) => isDmReplyJobInsert(sql))).toBe(false);
  });

  it("claims the current turn text and marks that turn processing", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("with candidate")) return {
        rowCount: 1,
        rows: [{
          id: "job-1",
          workspace_id: "workspace-1",
          brand_id: "brand-1",
          lease_token: "lease-1",
          payload_json: {
            conversationId: "conversation-1",
            turnId: "turn-1",
            senderId: "sender-1",
            messageId: "message-1",
            route: "knowledge",
            policyReasonCode: "wiki_answer",
            forceAttentionType: null,
            question: "첫 문장\n둘째 문장",
          },
          attempt_count: 1,
        }],
      };
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository({
      query,
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    } as any);

    await expect(repository.claimDmReplyJob("worker-1")).resolves.toMatchObject({
      payload: { turnId: "turn-1", question: "첫 문장\n둘째 문장" },
    });
    const claimSql = String(query.mock.calls.find(([sql]) => String(sql).includes("with candidate"))?.[0]);
    expect(claimSql).toContain("join dm_turns");
    expect(claimSql).toContain("status = 'processing'");
    expect(claimSql).toContain("aggregated_text");
  });
});
