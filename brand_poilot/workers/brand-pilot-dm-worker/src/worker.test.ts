import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ClaimedDmJob } from "./client.js";
import { runDmWorkerOnce, runWorkerCycle } from "./worker.js";

const chunkId = "00000000-0000-4000-8000-000000000001";
const documentId = "00000000-0000-4000-8000-000000000002";
const knowledgeEntryId = "00000000-0000-4000-8000-000000000003";

function wikiChunk(overrides: Record<string, unknown> = {}) {
  return {
    chunkId,
    pageId: documentId,
    pageType: "faq",
    title: "운영 시간",
    content: "운영 시간은 평일 9시~18시입니다.",
    cosineSimilarity: 0.91,
    keywordMatch: 0.7,
    rrfScore: 0.016,
    ...overrides,
  };
}

function wikiPacket(chunks = [wikiChunk()]) {
  return {
    wikiVersionId: "00000000-0000-4000-8000-000000000010",
    brandCore: "Growthline은 브랜드 콘텐츠 운영 서비스입니다.",
    chunks,
    destinationUrls: [],
  };
}

function claimedJob(payload: Partial<ClaimedDmJob["payload"]>): ClaimedDmJob {
  return {
    id: "job-1",
    workspaceId: "workspace-1",
    brandId: "brand-1",
    leaseToken: "lease-1",
    payload: {
      conversationId: "conversation-1",
      senderId: "sender-1",
      messageId: "message-1",
      question: "운영 시간은?",
      route: "knowledge",
      policyReasonCode: "wiki_answer",
      forceAttentionType: null,
      ...payload,
    },
    attemptCount: 1,
  };
}

function workerApi(payload: Partial<ClaimedDmJob["payload"]> = {}) {
  return {
    heartbeatWorker: vi.fn(async () => ({})),
    claim: vi.fn(async () => claimedJob(payload)),
    complete: vi.fn(async () => ({})),
    fail: vi.fn(async () => ({})),
    heartbeat: vi.fn(async () => ({})),
  };
}

describe("DM worker", () => {
  it("keeps the DM job lease alive while waiting for the reserved Codex slot", async () => {
    const api = workerApi();
    const withCodexLeaseMock = vi.fn(async (task: () => Promise<unknown>, onWait: () => Promise<unknown>) => {
      await onWait();
      return task();
    });
    const withCodexLease = <T>(task: () => Promise<T>, onWait: () => Promise<unknown>) => (
      withCodexLeaseMock(task, onWait) as Promise<T>
    );
    const db = {
      searchCompiledWiki: vi.fn(async () => wikiPacket()),
      conversationHistory: vi.fn(async () => []),
    };

    await runDmWorkerOnce({
      workerId: "worker-1",
      api,
      db,
      runtimeDirectory: "runtime",
      withCodexLease,
      runCodex: vi.fn(async () => ({
        decision: "answer", answer: "안내입니다.", wikiChunkIds: [chunkId], knowledgeEntryId: null,
        confidence: 0.9, reasonCode: "wiki_answer", needsAttention: false, reason: "Wiki 근거",
      })),
    });

    expect(withCodexLeaseMock).toHaveBeenCalledOnce();
    expect(api.heartbeat).toHaveBeenCalledWith("job-1", "worker-1", "lease-1");
  });

  it("checks DM first and runs one Wiki item only when DM is idle", async () => {
    const runDm = vi.fn(async (): Promise<{ status: "idle" | "completed" }> => ({ status: "idle" }));
    const runProfile = vi.fn(async (): Promise<{ status: "idle" | "completed" }> => ({ status: "idle" }));
    const runWiki = vi.fn(async () => ({ status: "completed" as const, itemId: "item-1" }));

    await expect(runWorkerCycle({ runDm, runProfile, runWiki })).resolves.toEqual({ status: "completed", itemId: "item-1" });
    expect(runDm.mock.invocationCallOrder[0]).toBeLessThan(runWiki.mock.invocationCallOrder[0]);
    expect(runProfile.mock.invocationCallOrder[0]).toBeLessThan(runWiki.mock.invocationCallOrder[0]);

    runDm.mockResolvedValueOnce({ status: "completed" as const });
    await expect(runWorkerCycle({ runDm, runProfile, runWiki })).resolves.toEqual({ status: "completed" });
    expect(runWiki).toHaveBeenCalledTimes(1);

    runProfile.mockResolvedValueOnce({ status: "completed" as const });
    await expect(runWorkerCycle({ runDm, runProfile, runWiki })).resolves.toEqual({ status: "completed" });
    expect(runWiki).toHaveBeenCalledTimes(1);
  });

  it("sends only retrieved Wiki context to the Codex result flow", async () => {
    const api = workerApi();
    const db = {
      searchCompiledWiki: vi.fn(async () => wikiPacket()),
      conversationHistory: vi.fn(async () => []),
    };
    const prompts: string[] = [];
    const runCodex = vi.fn(async (input: { prompt: string; runtimeDirectory: string; timeoutMs: number }) => {
      prompts.push(input.prompt);
      return {
        decision: "answer" as const,
        answer: "평일 오전 9시부터 오후 6시까지입니다.",
        wikiChunkIds: [chunkId],
        knowledgeEntryId: null,
        confidence: 0.9,
        reasonCode: "wiki_answer",
        needsAttention: false,
        reason: "FAQ 근거",
      };
    });

    await expect(runDmWorkerOnce({
      workerId: "worker-1", api, db, runtimeDirectory: "runtime", runCodex,
    })).resolves.toMatchObject({ status: "completed", jobId: "job-1", decision: "answer" });
    expect(db.searchCompiledWiki).toHaveBeenCalledWith("workspace-1", "brand-1", "운영 시간은?");
    expect(runCodex).toHaveBeenCalledTimes(1);
    expect(prompts[0]).toContain("운영 시간은 평일 9시~18시입니다.");
    expect(prompts[0]).toContain("$dm-human-response");
    expect(prompts[0]).toContain("JSON만 출력");
    expect(api.complete).toHaveBeenCalledWith("job-1", "worker-1", "lease-1", expect.objectContaining({
      decision: "answer",
      knowledgeEntryId: null,
      reasonCode: "wiki_answer",
      needsAttention: false,
    }));
  });

  it("uses a payload exact FAQ ID before retrieval, history, or Codex", async () => {
    const api = workerApi({ exactFaqId: knowledgeEntryId });
    const db = { searchCompiledWiki: vi.fn(), conversationHistory: vi.fn() };
    const runCodex = vi.fn();

    await expect(runDmWorkerOnce({
      workerId: "worker-1", api, db, runtimeDirectory: "runtime", runCodex,
    })).resolves.toEqual({ status: "completed", jobId: "job-1", decision: "answer" });

    expect(db.searchCompiledWiki).not.toHaveBeenCalled();
    expect(db.conversationHistory).not.toHaveBeenCalled();
    expect(runCodex).not.toHaveBeenCalled();
    expect(api.complete).toHaveBeenCalledWith("job-1", "worker-1", "lease-1", {
      decision: "answer",
      answer: null,
      wikiChunkIds: [],
      knowledgeEntryId,
      confidence: 1,
      reasonCode: "direct_faq",
      needsAttention: false,
      reason: "payload_exact_faq",
    });
  });

  it("uses the compiled Wiki answer path even when the leading page score is high", async () => {
    const api = workerApi();
    const db = {
      searchCompiledWiki: vi.fn(async () => wikiPacket([
        wikiChunk({ cosineSimilarity: 0.91 }),
      ])),
      conversationHistory: vi.fn(async () => []),
    };
    const runCodex = vi.fn(async () => ({
      decision: "answer", answer: "평일 9시부터 18시까지입니다.", wikiChunkIds: [chunkId],
      destinationUrlIds: [], knowledgeEntryId: null, confidence: 0.9,
      reasonCode: "wiki_answer", needsAttention: false, reason: "Wiki 근거",
    }));

    await runDmWorkerOnce({
      workerId: "worker-1", api, db, runtimeDirectory: "runtime", runCodex,
    });

    expect(db.searchCompiledWiki).toHaveBeenCalledWith("workspace-1", "brand-1", "운영 시간은?");
    expect(runCodex).toHaveBeenCalledTimes(1);
    expect(db.conversationHistory).toHaveBeenCalledTimes(1);
    expect(api.complete).toHaveBeenCalledWith("job-1", "worker-1", "lease-1", expect.objectContaining({
      decision: "answer",
      wikiChunkIds: [chunkId],
      reasonCode: "wiki_answer",
    }));
  });

  it("uses Codex with at most the compiled search packet returned by the DB", async () => {
    const api = workerApi();
    const db = {
      searchCompiledWiki: vi.fn(async () => wikiPacket([
        wikiChunk({ cosineSimilarity: 0.91 }),
        wikiChunk({ chunkId: "00000000-0000-4000-8000-000000000004", cosineSimilarity: 0.89 }),
      ])),
      conversationHistory: vi.fn(async () => []),
    };
    const runCodex = vi.fn(async () => ({
      decision: "answer", answer: "평일 9시부터 18시까지입니다.", wikiChunkIds: [chunkId],
      knowledgeEntryId: null, confidence: 0.9, reasonCode: "wiki_answer", needsAttention: false, reason: "Wiki 근거",
    }));

    await runDmWorkerOnce({
      workerId: "worker-1", api, db, runtimeDirectory: "runtime", runCodex,
    });

    expect(runCodex).toHaveBeenCalledTimes(1);
  });

  it("rejects a destination ID that was not included in the compiled packet", async () => {
    const api = workerApi();
    await runDmWorkerOnce({
      workerId: "worker-1", api,
      db: { searchCompiledWiki: vi.fn(async () => wikiPacket()), conversationHistory: vi.fn(async () => []) },
      runtimeDirectory: "runtime",
      runCodex: vi.fn(async () => ({
        decision: "answer", answer: "제품 안내입니다.", wikiChunkIds: [chunkId],
        destinationUrlIds: ["00000000-0000-4000-8000-000000000099"], knowledgeEntryId: null,
        confidence: 0.8, reasonCode: "wiki_answer", needsAttention: false, reason: "제품 Wiki",
      })),
    });
    expect(api.complete).not.toHaveBeenCalled();
    expect(api.fail).toHaveBeenCalledWith(
      "job-1", "worker-1", "lease-1", "dm_destination_url_not_provided", false, 0,
    );
  });

  it("rejects an invented knowledge entry ID from the compiled Wiki Codex path", async () => {
    const api = workerApi();
    await runDmWorkerOnce({
      workerId: "worker-1", api,
      db: { searchCompiledWiki: vi.fn(async () => wikiPacket()), conversationHistory: vi.fn(async () => []) },
      runtimeDirectory: "runtime",
      runCodex: vi.fn(async () => ({
        decision: "answer", answer: "평일 9시부터 18시까지입니다.", wikiChunkIds: [chunkId],
        knowledgeEntryId: "00000000-0000-4000-8000-000000000099",
        confidence: 0.9, reasonCode: "wiki_answer", needsAttention: false, reason: "Wiki 근거",
      })),
    });

    expect(api.complete).not.toHaveBeenCalled();
    expect(api.fail).toHaveBeenCalledWith(
      "job-1", "worker-1", "lease-1", "dm_knowledge_entry_not_provided", false, 0,
    );
  });

  it("returns the knowledge gap fallback without Codex when retrieval has no basis", async () => {
    const api = workerApi();
    const db = { searchCompiledWiki: vi.fn(async () => null), conversationHistory: vi.fn() };
    const runCodex = vi.fn();

    await runDmWorkerOnce({
      workerId: "worker-1", api, db, runtimeDirectory: "runtime", runCodex,
    });

    expect(runCodex).not.toHaveBeenCalled();
    expect(api.complete).toHaveBeenCalledWith("job-1", "worker-1", "lease-1", {
      decision: "fallback",
      answer: null,
      wikiChunkIds: [],
      knowledgeEntryId: null,
      confidence: null,
      reasonCode: "knowledge_gap",
      needsAttention: true,
      reason: "wiki_no_basis",
    });
  });

  it("completes fixed fallback from immutable policy data without Wiki, history, or Codex", async () => {
    const api = workerApi({
      question: "정말 최악이고 너무 불편해요",
      route: "fixed_fallback",
      policyReasonCode: "complaint",
      forceAttentionType: "complaint",
    });
    const db = {
      searchCompiledWiki: vi.fn(),
      conversationHistory: vi.fn(),
    };
    const runCodex = vi.fn();

    await expect(runDmWorkerOnce({
      workerId: "worker-1", api, db, runtimeDirectory: "runtime", runCodex,
    })).resolves.toEqual({ status: "completed", jobId: "job-1", decision: "fallback" });

    expect(db.searchCompiledWiki).not.toHaveBeenCalled();
    expect(db.conversationHistory).not.toHaveBeenCalled();
    expect(runCodex).not.toHaveBeenCalled();
    expect(api.complete).toHaveBeenCalledWith("job-1", "worker-1", "lease-1", {
      decision: "fallback",
      answer: null,
      wikiChunkIds: [],
      knowledgeEntryId: null,
      confidence: null,
      reasonCode: "complaint",
      needsAttention: true,
      reason: "server_policy:complaint",
    });
  });

  it("sends a clarification prompt without Wiki, history, or Codex", async () => {
    const api = workerApi({
      route: "faq_clarification",
      policyReasonCode: "faq_clarification",
      exactFaqId: knowledgeEntryId,
      fixedReplyText: "“배송은 얼마나 걸리나요?”에 대해 문의하신 게 맞을까요?",
      confirmationId: "00000000-0000-4000-8000-000000000020",
    });
    const db = { searchCompiledWiki: vi.fn(), conversationHistory: vi.fn() };
    const runCodex = vi.fn();

    await runDmWorkerOnce({ workerId: "worker-1", api, db, runtimeDirectory: "runtime", runCodex });

    expect(db.searchCompiledWiki).not.toHaveBeenCalled();
    expect(db.conversationHistory).not.toHaveBeenCalled();
    expect(runCodex).not.toHaveBeenCalled();
    expect(api.complete).toHaveBeenCalledWith("job-1", "worker-1", "lease-1", {
      decision: "answer",
      answer: "“배송은 얼마나 걸리나요?”에 대해 문의하신 게 맞을까요?",
      wikiChunkIds: [],
      knowledgeEntryId,
      confidence: 1,
      reasonCode: "faq_clarification",
      needsAttention: false,
      reason: "faq_clarification_prompt",
    });
  });

  it.each([
    ["missing operational fields", {
      decision: "fallback", answer: null, wikiChunkIds: [], knowledgeEntryId: null, confidence: null, reason: "근거 부족",
    }],
    ["invalid source UUID", {
      decision: "answer", answer: "운영합니다.", wikiChunkIds: ["chunk-1"], knowledgeEntryId: null,
      confidence: 0.8, reasonCode: "wiki_answer", needsAttention: false, reason: "FAQ",
    }],
  ])("rejects %s instead of coercing the Codex result", async (_name, result) => {
    const api = workerApi();
    await runDmWorkerOnce({
      workerId: "worker-1",
      api,
      db: {
        searchCompiledWiki: vi.fn(async () => wikiPacket()),
        conversationHistory: vi.fn(async () => []),
      },
      runtimeDirectory: "runtime",
      runCodex: vi.fn(async () => result),
    });

    expect(api.complete).not.toHaveBeenCalled();
    expect(api.fail).toHaveBeenCalledWith(
      "job-1",
      "worker-1",
      "lease-1",
      expect.stringMatching(/^dm_/),
      false,
      0,
    );
  });

  it("marks a timeout retryable without leaking an answer", async () => {
    const api = workerApi({ question: "질문" });
    await expect(runDmWorkerOnce({
      workerId: "worker-1", api,
      db: { searchCompiledWiki: vi.fn(async () => wikiPacket()), conversationHistory: vi.fn(async () => []) },
      runtimeDirectory: "runtime",
      runCodex: vi.fn(async () => { throw new Error("codex_timeout"); }),
    })).resolves.toMatchObject({ status: "failed" });
    expect(api.fail).toHaveBeenCalledWith("job-1", "worker-1", "lease-1", "codex_timeout", true, 5000);
  });

  it("retries a transient network failure", async () => {
    const api = workerApi({ question: "질문" });

    await runDmWorkerOnce({
      workerId: "worker-1",
      api,
      db: {
        searchCompiledWiki: vi.fn(async () => wikiPacket()),
        conversationHistory: vi.fn(async () => []),
      },
      runtimeDirectory: "runtime",
      runCodex: vi.fn(async () => { throw new TypeError("fetch failed"); }),
    });

    expect(api.fail).toHaveBeenCalledWith("job-1", "worker-1", "lease-1", "fetch failed", true, 5000);
  });

  it("ships the human response skill and all required example categories", async () => {
    const skillDirectory = path.resolve("runtime/.agents/skills/dm-human-response");
    const [skill, examples] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(skillDirectory, "examples.md"), "utf8"),
    ]);

    expect(skill).toContain("name: dm-human-response");
    expect(skill).toContain("1~4문장");
    expect(skill).toContain("직접 답변");
    expect(skill).toContain("완료");
    expect(examples.match(/^### 정보 문의/gm)).toHaveLength(3);
    expect(examples.match(/^### 불만/gm)).toHaveLength(2);
    expect(examples.match(/^### 제한 요청/gm)).toHaveLength(2);
    expect(examples.match(/^### 근거 부족/gm)).toHaveLength(2);
  });

});
