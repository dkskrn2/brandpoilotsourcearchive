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

describe("FAQ suggestion worker result contract", () => {
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
