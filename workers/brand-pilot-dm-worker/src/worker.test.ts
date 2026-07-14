import { describe, expect, it, vi } from "vitest";
import { runDmWorkerOnce } from "./worker.js";

describe("DM worker", () => {
  it("sends only retrieved Wiki context to the Codex result flow", async () => {
    const api = {
      heartbeatWorker: vi.fn(async () => ({})),
      claim: vi.fn(async () => ({
        id: "job-1",
        workspaceId: "workspace-1",
        brandId: "brand-1",
        leaseToken: "lease-1",
        payload: { conversationId: "conversation-1", senderId: "sender-1", messageId: "message-1", question: "운영 시간은?" },
        attemptCount: 1,
      })),
      complete: vi.fn(async () => ({})),
      fail: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    const db = {
      searchWiki: vi.fn(async () => [{ id: "00000000-0000-4000-8000-000000000001", content: "운영 시간은 평일 9시~18시입니다.", score: 0.9 }]),
      conversationHistory: vi.fn(async () => []),
    };
    const embed = vi.fn(async () => [0.1]);
    const prompts: string[] = [];
    const runCodex = async (input: { prompt: string; runtimeDirectory: string; timeoutMs: number }) => {
      prompts.push(input.prompt);
      return {
        decision: "answer" as const,
        answer: "평일 오전 9시부터 오후 6시까지입니다.",
        wikiChunkIds: ["00000000-0000-4000-8000-000000000001"],
        confidence: 0.9,
        reason: "FAQ 근거",
      };
    };

    await expect(runDmWorkerOnce({
      workerId: "worker-1", api, db, apiKey: "key", runtimeDirectory: "runtime", embed: embed as any, runCodex,
    })).resolves.toMatchObject({ status: "completed", jobId: "job-1", decision: "answer" });
    expect(prompts[0]).toContain("운영 시간은 평일 9시~18시입니다.");
    expect(api.complete).toHaveBeenCalledWith("job-1", "worker-1", "lease-1", expect.objectContaining({ decision: "answer" }));
  });

  it("marks a timeout retryable without leaking an answer", async () => {
    const api = {
      heartbeatWorker: vi.fn(async () => ({})),
      claim: vi.fn(async () => ({ id: "job-1", workspaceId: "workspace-1", brandId: "brand-1", leaseToken: "lease-1", payload: { conversationId: "conversation-1", senderId: "sender-1", messageId: "message-1", question: "질문" }, attemptCount: 1 })),
      complete: vi.fn(async () => ({})),
      fail: vi.fn(async () => ({})),
      heartbeat: vi.fn(async () => ({})),
    };
    await expect(runDmWorkerOnce({
      workerId: "worker-1", api, db: { searchWiki: vi.fn(), conversationHistory: vi.fn() }, apiKey: "key", runtimeDirectory: "runtime",
      embed: vi.fn(async () => { throw new Error("codex_timeout"); }) as any,
      runCodex: vi.fn(),
    })).resolves.toMatchObject({ status: "failed" });
    expect(api.fail).toHaveBeenCalledWith("job-1", "worker-1", "lease-1", "codex_timeout", true, 5000);
  });
});
