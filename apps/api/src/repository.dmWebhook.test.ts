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
  function activeKnowledgeFixture(exactFaq: { knowledge_entry_id: string | null; conflict_marker: string | null }) {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const aggregatedQuestion = "배송은 얼마나 걸리나요?\n제주도도 같나요?";
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("from brand_channels channel")) return { rowCount: 1, rows: [{ id: "channel-1", workspace_id: "workspace-1", brand_id: "brand-1" }] };
      if (sql.includes("insert into instagram_dm_conversations")) return { rowCount: 1, rows: [{ id: "conversation-1", automation_status: "active" }] };
      if (sql.includes("insert into instagram_dm_messages")) return { rowCount: 1, rows: [{ id: "message-1" }] };
      if (sql.includes("insert into dm_turns")) return { rowCount: 1, rows: [{ id: "turn-1", aggregated_text: aggregatedQuestion }] };
      if (sql.includes("from instagram_dm_settings")) return { rowCount: 1, rows: [{ enabled: true }] };
      if (sql.includes("from wiki_versions version")) return { rowCount: 1, rows: [{ ready: true }] };
      if (sql.includes("find_direct_faq_exact")) return { rowCount: 1, rows: [exactFaq] };
      if (sql.includes("count(*) filter")) return { rowCount: 1, rows: [{ participant_count: "1", brand_count: "1" }] };
      if (sql.includes("insert into jobs")) return { rowCount: 1, rows: [{ id: "dm-job-1" }] };
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository({ query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as any);
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
