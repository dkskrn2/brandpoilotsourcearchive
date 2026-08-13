import { describe, expect, it } from "vitest";
import {
  validateFaqSuggestionResult,
  type FaqSuggestionWorkerInput,
} from "./faqSuggestionContracts.js";

const input: FaqSuggestionWorkerInput = {
  contractVersion: "faq-suggestion-input.v1",
  runId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "15000000-0000-4000-8000-000000000001",
  brandId: "20000000-0000-4000-8000-000000000002",
  leaseToken: "30000000-0000-4000-8000-000000000003",
  sources: [{
    sourceType: "brand_core",
    sourceId: "40000000-0000-4000-8000-000000000004",
    label: "브랜드 코어",
    content: "공식 온라인 스토어에서 제품을 구매할 수 있습니다.",
    contentHash: "a".repeat(64),
  }],
  existingFaqs: [],
};

const suggestion = {
  category: "product",
  question: "제품은 어떻게 구매하나요?",
  answer: "공식 온라인 스토어에서 구매할 수 있습니다.",
  evidence: [{
    sourceType: "brand_core",
    sourceId: "40000000-0000-4000-8000-000000000004",
  }],
  confidence: 0.92,
};

const v2FullInput = {
  ...input,
  contractVersion: "faq-suggestion-input.v2" as const,
  mode: "full_faq" as const,
};

const v2AliasInput = {
  contractVersion: "faq-suggestion-input.v2" as const,
  mode: "alias_only" as const,
  runId: input.runId,
  workspaceId: input.workspaceId,
  brandId: input.brandId,
  leaseToken: input.leaseToken,
  targetFaq: {
    id: "50000000-0000-4000-8000-000000000005",
    question: "배송은 언제 시작하나요?",
    answer: "결제 후 안내된 일정에 발송합니다.",
    updatedAt: "2026-08-12T00:00:00.000Z",
  },
};

describe("FAQ suggestion worker result contract", () => {
  it("accepts v2 full FAQ suggestions with three to eight example utterances", () => {
    expect(validateFaqSuggestionResult({
      contractVersion: "faq-suggestion-result.v2",
      suggestions: [{
        ...suggestion,
        exampleUtterances: ["제품 어디서 사요?", "구매 방법", "제품 구매처 알려줘"],
      }],
    }, v2FullInput)).toEqual({
      mode: "full_faq",
      suggestions: [{
        ...suggestion,
        exampleUtterances: ["제품 어디서 사요?", "구매 방법", "제품 구매처 알려줘"],
        evidence: [{ ...suggestion.evidence[0], label: "브랜드 코어" }],
      }],
      rejections: [],
    });
  });

  it("accepts alias-only output and rejects a full result for an alias-only run", () => {
    expect(validateFaqSuggestionResult({
      contractVersion: "faq-alias-suggestion-result.v1",
      exampleUtterances: ["배송 언제 와요?", "언제 발송돼요?", "배송 일정 알려줘"],
    }, v2AliasInput)).toEqual({
      mode: "alias_only",
      exampleUtterances: ["배송 언제 와요?", "언제 발송돼요?", "배송 일정 알려줘"],
    });
    expect(() => validateFaqSuggestionResult({
      contractVersion: "faq-suggestion-result.v2",
      suggestions: [{ ...suggestion, exampleUtterances: ["하나", "둘", "셋"] }],
    }, v2AliasInput)).toThrow("faq_alias_suggestion_result_contract_invalid");
  });

  it("rejects too few, too many, duplicate, and unknown alias fields", () => {
    for (const exampleUtterances of [
      ["하나", "둘"],
      Array.from({ length: 9 }, (_, index) => `표현 ${index}`),
      ["배송 언제?", "배송 언제", "배송 일정"],
    ]) {
      expect(() => validateFaqSuggestionResult({
        contractVersion: "faq-alias-suggestion-result.v1",
        exampleUtterances,
      }, v2AliasInput)).toThrow("faq_alias_suggestion_utterances_invalid");
    }
    expect(() => validateFaqSuggestionResult({
      contractVersion: "faq-alias-suggestion-result.v1",
      exampleUtterances: ["하나", "둘", "셋"],
      commentary: "done",
    }, v2AliasInput)).toThrow("faq_alias_suggestion_result_contract_invalid");
  });

  it("accepts grounded suggestions and attaches evidence labels", () => {
    expect(validateFaqSuggestionResult({
      contractVersion: "faq-suggestion-result.v1",
      suggestions: [suggestion],
    }, input)).toEqual({
      suggestions: [{
        ...suggestion,
        evidence: [{ ...suggestion.evidence[0], label: "브랜드 코어" }],
      }],
      rejections: [],
    });
  });

  it("rejects a wrong top-level contract and unknown fields", () => {
    expect(() => validateFaqSuggestionResult(
      { contractVersion: "wrong", suggestions: [] }, input,
    )).toThrow("faq_suggestion_result_contract_invalid");
    expect(() => validateFaqSuggestionResult({
      contractVersion: "faq-suggestion-result.v1",
      suggestions: [suggestion],
      commentary: "done",
    }, input)).toThrow("faq_suggestion_result_contract_invalid");
  });

  it("rejects raw URLs and more than twenty suggestions", () => {
    expect(() => validateFaqSuggestionResult({
      contractVersion: "faq-suggestion-result.v1",
      suggestions: [{ ...suggestion, answer: "https://example.com 에서 구매하세요." }],
    }, input)).toThrow("faq_suggestion_answer_url_forbidden");
    expect(() => validateFaqSuggestionResult({
      contractVersion: "faq-suggestion-result.v1",
      suggestions: Array.from({ length: 21 }, (_, index) => ({
        ...suggestion,
        question: `제품 구매 방법 ${index}`,
      })),
    }, input)).toThrow("faq_suggestion_limit_exceeded");
  });

  it("fails when no suggestion is valid", () => {
    expect(() => validateFaqSuggestionResult({
      contractVersion: "faq-suggestion-result.v1",
      suggestions: [{
        ...suggestion,
        evidence: [{ sourceType: "brand_core", sourceId: "unknown" }],
      }],
    }, input)).toThrow("faq_suggestion_evidence_not_provided");
  });

  it("returns valid suggestions and rejection codes for a mixed result", () => {
    const mixed = validateFaqSuggestionResult({
      contractVersion: "faq-suggestion-result.v1",
      suggestions: [
        suggestion,
        { ...suggestion, category: "promotion", question: "프로모션이 있나요?" },
        { ...suggestion, question: "근거가 중복인가요?", evidence: [
          suggestion.evidence[0],
          suggestion.evidence[0],
        ] },
      ],
    }, input);
    expect(mixed.suggestions).toHaveLength(1);
    expect(mixed.rejections).toEqual([
      { index: 1, code: "faq_suggestion_category_invalid" },
      { index: 2, code: "faq_suggestion_evidence_duplicate" },
    ]);
  });

  it.each([
    [{ ...suggestion, confidence: 2 }, "faq_suggestion_confidence_invalid"],
    [{ ...suggestion, evidence: [] }, "faq_suggestion_evidence_invalid"],
    [{ ...suggestion, question: "q".repeat(501) }, "faq_suggestion_question_invalid"],
    [{ ...suggestion, answer: "a".repeat(2_001) }, "faq_suggestion_answer_invalid"],
    [{ ...suggestion, extra: true }, "faq_suggestion_item_contract_invalid"],
  ] as const)("rejects an invalid item with %s", (invalid, code) => {
    expect(() => validateFaqSuggestionResult({
      contractVersion: "faq-suggestion-result.v1",
      suggestions: [invalid],
    }, input)).toThrow(code);
  });
});
