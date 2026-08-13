import { describe, expect, it, vi } from "vitest";
import { buildFaqSuggestionPrompt, runFaqSuggestionOnce } from "./faqSuggestionWorker.js";

const claimed = {
  contractVersion: "faq-suggestion-input.v1" as const,
  runId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000002",
  brandId: "30000000-0000-4000-8000-000000000003",
  leaseToken: "40000000-0000-4000-8000-000000000004",
  sources: [{
    sourceType: "brand_core" as const,
    sourceId: "50000000-0000-4000-8000-000000000005",
    label: "브랜드 코어",
    content: "공식 스토어에서 구매할 수 있습니다.",
    contentHash: "a".repeat(64),
  }],
  existingFaqs: [],
};

const rawResult = {
  contractVersion: "faq-suggestion-result.v1",
  suggestions: [{
    category: "product",
    question: "제품은 어디서 구매하나요?",
    answer: "공식 스토어에서 구매할 수 있습니다.",
    evidence: [{ sourceType: "brand_core", sourceId: claimed.sources[0].sourceId }],
    confidence: 0.9,
  }],
};

function setup(result: unknown = rawResult) {
  const db = {
    heartbeatFaqSuggestionWorker: vi.fn(async () => undefined),
    claimFaqSuggestionRun: vi.fn(async () => claimed),
    heartbeatFaqSuggestionRun: vi.fn(async () => undefined),
    completeFaqSuggestionRun: vi.fn(async () => undefined),
    failFaqSuggestionRun: vi.fn(async () => undefined),
  };
  return {
    db,
    runCodex: vi.fn(async () => result),
  };
}

describe("runFaqSuggestionOnce", () => {
  it("builds a strict alias-only prompt without source or lease metadata", () => {
    const aliasInput = {
      contractVersion: "faq-suggestion-input.v2" as const,
      mode: "alias_only" as const,
      runId: claimed.runId,
      workspaceId: claimed.workspaceId,
      brandId: claimed.brandId,
      leaseToken: claimed.leaseToken,
      targetFaq: {
        id: "60000000-0000-4000-8000-000000000006",
        question: "배송은 언제 시작하나요?",
        answer: "결제 후 안내된 일정에 발송합니다.",
        updatedAt: "2026-08-12T00:00:00.000Z",
      },
    };
    const prompt = buildFaqSuggestionPrompt(aliasInput);
    expect(prompt).toContain("faq-alias-suggestion-result.v1");
    expect(prompt).toContain("3-8");
    expect(prompt).toContain(aliasInput.targetFaq.question);
    expect(prompt).not.toContain(aliasInput.workspaceId);
    expect(prompt).not.toContain(aliasInput.leaseToken);
  });

  it("runs alias-only generation and completes the discriminated result", async () => {
    const aliasInput = {
      contractVersion: "faq-suggestion-input.v2" as const,
      mode: "alias_only" as const,
      runId: claimed.runId,
      workspaceId: claimed.workspaceId,
      brandId: claimed.brandId,
      leaseToken: claimed.leaseToken,
      targetFaq: {
        id: "60000000-0000-4000-8000-000000000006",
        question: "배송은 언제 시작하나요?",
        answer: "결제 후 안내된 일정에 발송합니다.",
        updatedAt: "2026-08-12T00:00:00.000Z",
      },
    };
    const db = {
      heartbeatFaqSuggestionWorker: vi.fn(async () => undefined),
      claimFaqSuggestionRun: vi.fn(async () => aliasInput),
      heartbeatFaqSuggestionRun: vi.fn(async () => undefined),
      completeFaqSuggestionRun: vi.fn(async () => undefined),
      failFaqSuggestionRun: vi.fn(async () => undefined),
    };
    const runCodex = vi.fn(async () => ({
      contractVersion: "faq-alias-suggestion-result.v1",
      exampleUtterances: ["배송 언제 와요?", "언제 발송돼요?", "배송 일정 알려줘"],
    }));
    await expect(runFaqSuggestionOnce({
      workerId: "faq-worker-1",
      db,
      runCodex,
      runtimeDirectory: "C:/runtime",
    })).resolves.toEqual({ status: "completed", runId: claimed.runId });
    expect(db.completeFaqSuggestionRun).toHaveBeenCalledWith(
      claimed.runId,
      "faq-worker-1",
      claimed.leaseToken,
      {
        mode: "alias_only",
        exampleUtterances: ["배송 언제 와요?", "언제 발송돼요?", "배송 일정 알려줘"],
      },
    );
  });

  it("claims, invokes CLI once, validates, and completes without prompt secrets", async () => {
    const { db, runCodex } = setup();
    await expect(runFaqSuggestionOnce({
      workerId: "faq-worker-1",
      db,
      runCodex,
      runtimeDirectory: "C:/runtime",
      timeoutMs: 60_000,
    })).resolves.toEqual({ status: "completed", runId: claimed.runId });
    expect(runCodex).toHaveBeenCalledTimes(1);
    const prompt = runCodex.mock.calls[0]![0].prompt;
    expect(prompt).not.toContain(claimed.workspaceId);
    expect(prompt).not.toContain(claimed.leaseToken);
    expect(prompt).toContain("untrusted data");
    expect(db.completeFaqSuggestionRun).toHaveBeenCalledWith(
      claimed.runId,
      "faq-worker-1",
      claimed.leaseToken,
      expect.objectContaining({ suggestions: [expect.objectContaining({ category: "product" })] }),
    );
  });

  it("returns idle without invoking CLI", async () => {
    const { db, runCodex } = setup();
    db.claimFaqSuggestionRun.mockResolvedValueOnce(null as never);
    await expect(runFaqSuggestionOnce({
      workerId: "faq-worker-1", db, runCodex, runtimeDirectory: "C:/runtime",
    })).resolves.toEqual({ status: "idle" });
    expect(runCodex).not.toHaveBeenCalled();
  });

  it("retries timeouts and permanently fails invalid output", async () => {
    const timeout = setup();
    timeout.runCodex.mockRejectedValueOnce(new Error("codex_timeout"));
    await runFaqSuggestionOnce({
      workerId: "faq-worker-1", db: timeout.db, runCodex: timeout.runCodex,
      runtimeDirectory: "C:/runtime",
    });
    expect(timeout.db.failFaqSuggestionRun).toHaveBeenCalledWith(
      claimed.runId, "faq-worker-1", claimed.leaseToken, "codex_timeout", true,
    );

    const invalid = setup({ contractVersion: "wrong", suggestions: [] });
    await runFaqSuggestionOnce({
      workerId: "faq-worker-1", db: invalid.db, runCodex: invalid.runCodex,
      runtimeDirectory: "C:/runtime",
    });
    expect(invalid.db.failFaqSuggestionRun).toHaveBeenCalledWith(
      claimed.runId, "faq-worker-1", claimed.leaseToken,
      "faq_suggestion_result_contract_invalid", false,
    );
  });
});
