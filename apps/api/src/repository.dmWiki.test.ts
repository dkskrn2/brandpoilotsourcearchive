import { describe, expect, it, vi } from "vitest";
import { encryptCredential } from "./credentialCrypto.js";
import { parseDmWorkerResult } from "./dmTypes.js";
import { createRepository } from "./repository.js";

function fakePool(query: ReturnType<typeof vi.fn>) {
  return {
    query,
    connect: vi.fn(async () => ({ query, release: vi.fn() })),
  };
}

const directFaqId = "00000000-0000-4000-8000-000000000003";
const leaseToken = "00000000-0000-4000-8000-000000000010";

function directFaqCompletionFixture(entry: { id: string; answer: string } | null) {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    statements.push({ sql, values });
    if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
    if (sql.includes("from jobs job") && sql.includes("instagram_dm_conversations conversation")) {
      return {
        rowCount: 1,
        rows: [{
          id: "job-1", workspace_id: "workspace-1", brand_id: "brand-1",
          payload_json: {
            conversationId: "conversation-1", turnId: "turn-1", senderId: "sender-1",
            messageId: "message-1", question: "운영 시간은?", route: "knowledge",
            policyReasonCode: "wiki_answer", forceAttentionType: null,
          },
          job_status: "running", locked_by: "worker-1", lease_token: leaseToken,
          locked_until_valid: true, conversation_id: "conversation-1", brand_channel_id: "channel-1",
          external_account_id: "ig-account-1", encrypted_payload: encryptCredential("meta-token"),
          auth_mode: "instagram_login", error_message: "error", attempt_id: null, attempt_status: null,
          attempt_decision: null,
        }],
      };
    }
    if (sql.includes("from knowledge_entries")) {
      return { rowCount: entry ? 1 : 0, rows: entry ? [entry] : [] };
    }
    if (sql.includes("from wiki_chunks")) return { rowCount: 0, rows: [] };
    if (sql.includes("insert into dm_delivery_attempts")) return { rowCount: 1, rows: [{ id: "attempt-1", status: "prepared" }] };
    if (sql.includes("set status = 'sending'")) return { rowCount: 1, rows: [{ id: "attempt-1" }] };
    return { rowCount: 1, rows: [{ id: "row-1" }] };
  });
  const sendInstagramDirectMessage = vi.fn(async () => ({ externalMessageId: "outbound-1" }));
  const repository = createRepository(
    { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as any,
    { sendInstagramDirectMessage },
  );
  return { repository, statements, sendInstagramDirectMessage };
}

describe("DM Wiki repository", () => {
  it("resolves a direct FAQ answer from the owned enabled entry and ignores worker answer text", async () => {
    const fixture = directFaqCompletionFixture({ id: directFaqId, answer: "평일 9시부터 18시까지 운영합니다." });
    const result = parseDmWorkerResult({
      decision: "answer", answer: "worker text must be ignored", wikiChunkIds: [],
      knowledgeEntryId: directFaqId, confidence: 0.91, reasonCode: "direct_faq",
      needsAttention: false, reason: "embedding_direct_faq",
    });

    await expect(fixture.repository.completeDmReplyJob("job-1", {
      workerId: "worker-1", leaseToken, result,
    })).resolves.toMatchObject({ status: "succeeded", decision: "answer" });

    const entryLookup = fixture.statements.find((statement) => statement.sql.includes("from knowledge_entries"));
    expect(entryLookup?.sql).toContain("workspace_id = $2");
    expect(entryLookup?.sql).toContain("brand_id = $3");
    expect(entryLookup?.sql).toContain("entry_type = 'faq'");
    expect(entryLookup?.sql).toContain("enabled");
    expect(entryLookup?.sql).toContain("direct_reply_enabled");
    expect(entryLookup?.values).toEqual([directFaqId, "workspace-1", "brand-1"]);
    const delivery = fixture.statements.find((statement) => statement.sql.includes("insert into dm_delivery_attempts"));
    expect(delivery?.values).toContain("평일 9시부터 18시까지 운영합니다.");
    expect(delivery?.values).not.toContain("worker text must be ignored");
  });

  it("rejects direct FAQ completion when the owned enabled entry cannot be resolved", async () => {
    const fixture = directFaqCompletionFixture(null);
    const result = parseDmWorkerResult({
      decision: "answer", answer: null, wikiChunkIds: [], knowledgeEntryId: directFaqId,
      confidence: 1, reasonCode: "direct_faq", needsAttention: false, reason: "payload_exact_faq",
    });

    await expect(fixture.repository.completeDmReplyJob("job-1", {
      workerId: "worker-1", leaseToken, result,
    })).rejects.toThrow("dm_knowledge_entry_not_owned");
    expect(fixture.sendInstagramDirectMessage).not.toHaveBeenCalled();
  });

  it("upserts only the final valid duplicate FAQ row and queues one refresh job", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("select workspace_id from brands")) return { rowCount: 1, rows: [{ workspace_id: "workspace-1" }] };
      if (sql.includes("insert into knowledge_imports")) return {
        rowCount: 1,
        rows: [{
          id: "import-1",
          file_name: values[2],
          status: "succeeded",
          result_json: JSON.parse(String(values[4])),
          created_at: new Date("2026-07-14T00:00:00.000Z"),
        }],
      };
      if (sql.includes("insert into jobs")) return { rowCount: 1, rows: [{ id: "job-1", status: "queued" }] };
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository(fakePool(query) as any);

    const result = await repository.createKnowledgeImport("brand-1", {
      fileName: "faq.csv",
      fileBase64: Buffer.from("question,answer\n운영 시간,09-18\n운영   시간,10-19\n,잘못된 행\n").toString("base64"),
    });

    expect(result).toMatchObject({ entryType: "faq", totalRows: 3, validRows: 2, duplicateRows: 1, invalidRows: 1, updatedRows: 1 });
    const entryInsert = statements.find((statement) => statement.sql.includes("insert into knowledge_entries"));
    expect(entryInsert?.values).toContain("10-19");
    expect(entryInsert?.values).not.toContain("09-18");
    expect(entryInsert?.sql).toContain("on conflict (brand_id, normalized_question)");
    const jobInsert = statements.find((statement) => statement.sql.includes("insert into jobs"));
    expect(jobInsert?.sql).toContain("'wiki_refresh'");
    expect(jobInsert?.sql).toContain("$2::uuid");
    expect(jobInsert?.sql).toContain("$2::text");
    expect(jobInsert?.values).toContain("brand-1");
  });

  it("upserts products by a brand-scoped product key and queues refresh without checking DM settings", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("select workspace_id from brands")) return { rowCount: 1, rows: [{ workspace_id: "workspace-1" }] };
      if (sql.includes("insert into knowledge_imports")) return {
        rowCount: 1,
        rows: [{
          id: "import-2",
          file_name: values[2],
          status: "succeeded",
          result_json: JSON.parse(String(values[4])),
          created_at: new Date("2026-07-14T00:00:00.000Z"),
        }],
      };
      if (sql.includes("insert into jobs")) return { rowCount: 1, rows: [{ id: "job-2", status: "queued" }] };
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository(fakePool(query) as any);

    const result = await repository.createKnowledgeImport("brand-1", {
      entryType: "product",
      fileName: "products.csv",
      fileBase64: Buffer.from([
        "name,description,price,currency,product_url,sku",
        "Mug,Old description,28000,KRW,https://example.com/old,MUG-1",
        " mug ,New description,29000,KRW,https://example.com/new,MUG-2",
      ].join("\n")).toString("base64"),
    });

    expect(result).toMatchObject({ entryType: "product", validRows: 2, duplicateRows: 1, updatedRows: 1 });
    const entryInsert = statements.find((statement) => statement.sql.includes("insert into knowledge_entries"));
    expect(entryInsert?.sql).toContain("on conflict (brand_id, normalized_question)");
    expect(entryInsert?.values).toContain("product:mug");
    expect(entryInsert?.values).toContain("New description");
    expect(entryInsert?.values).not.toContain("Old description");
    expect(entryInsert?.values).toContain(JSON.stringify({
      price: "29000",
      currency: "KRW",
      productUrl: "https://example.com/new",
      sku: "MUG-2",
    }));
    expect(statements.some((statement) => statement.sql.includes("instagram_dm_settings"))).toBe(false);
    expect(statements.find((statement) => statement.sql.includes("insert into jobs"))?.values).toContain("brand-1");
  });

  it("queues a manual Wiki refresh with explicit UUID and text casts for the shared brand parameter", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      if (sql.includes("select workspace_id from brands")) {
        return { rowCount: 1, rows: [{ workspace_id: "workspace-1" }] };
      }
      return { rowCount: 1, rows: [{ id: "job-1", status: "queued" }] };
    });
    const repository = createRepository(fakePool(query) as any);

    await repository.enqueueWikiRefresh("brand-1");

    const jobInsert = statements.find((statement) => statement.sql.includes("insert into jobs"));
    expect(jobInsert?.sql).toContain("$2::uuid");
    expect(jobInsert?.sql).toContain("$2::text");
  });
});
