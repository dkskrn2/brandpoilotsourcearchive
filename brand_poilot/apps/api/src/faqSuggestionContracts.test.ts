import { describe, expect, it } from "vitest";
import {
  parseFaqSuggestionItemUpdate,
  parseFaqSuggestionReviewAction,
} from "./faqSuggestionContracts.js";

describe("FAQ suggestion contracts", () => {
  it("accepts a complete review edit", () => {
    expect(parseFaqSuggestionItemUpdate({
      category: "product",
      question: " 제품은 어떻게 구매하나요? ",
      answer: " 공식 온라인 스토어에서 구매할 수 있습니다. ",
      expectedUpdatedAt: "2026-08-02T00:00:00.000Z",
    })).toEqual({
      category: "product",
      question: "제품은 어떻게 구매하나요?",
      answer: "공식 온라인 스토어에서 구매할 수 있습니다.",
      expectedUpdatedAt: "2026-08-02T00:00:00.000Z",
    });
  });

  it("requires optimistic concurrency", () => {
    expect(() => parseFaqSuggestionReviewAction({}))
      .toThrow("faq_suggestion_validation_failed:expectedUpdatedAt");
  });

  it.each([
    "service",
    "product",
    "price_payment",
    "location_visit",
    "hours",
    "shipping",
    "exchange_refund",
    "reservation_usage",
    "account_membership",
    "other",
  ] as const)("accepts the %s category", (category) => {
    expect(parseFaqSuggestionItemUpdate({
      category,
      question: "문의 질문",
      answer: "문의 답변",
      expectedUpdatedAt: "2026-08-02T00:00:00.000Z",
    }).category).toBe(category);
  });

  it("rejects unknown categories", () => {
    expect(() => parseFaqSuggestionItemUpdate({
      category: "promotion",
      question: "할인이 있나요?",
      answer: "할인 정책을 확인해 주세요.",
      expectedUpdatedAt: "2026-08-02T00:00:00.000Z",
    })).toThrow("faq_suggestion_validation_failed:category");
  });

  it("enforces question and answer limits", () => {
    expect(() => parseFaqSuggestionItemUpdate({
      category: "other",
      question: "q".repeat(501),
      answer: "답변",
      expectedUpdatedAt: "2026-08-02T00:00:00.000Z",
    })).toThrow("faq_suggestion_validation_failed:question");

    expect(() => parseFaqSuggestionItemUpdate({
      category: "other",
      question: "질문",
      answer: "a".repeat(2_001),
      expectedUpdatedAt: "2026-08-02T00:00:00.000Z",
    })).toThrow("faq_suggestion_validation_failed:answer");
  });

  it.each([null, [], "not-an-object"])("rejects a non-object root: %j", (value) => {
    expect(() => parseFaqSuggestionItemUpdate(value))
      .toThrow("faq_suggestion_validation_failed:root");
    expect(() => parseFaqSuggestionReviewAction(value))
      .toThrow("faq_suggestion_validation_failed:root");
  });

  it("rejects unknown root fields", () => {
    expect(() => parseFaqSuggestionItemUpdate({
      category: "service",
      question: "상담 가능한가요?",
      answer: "상담 가능합니다.",
      expectedUpdatedAt: "2026-08-02T00:00:00.000Z",
      status: "approved",
    })).toThrow("faq_suggestion_validation_failed:status");

    expect(() => parseFaqSuggestionReviewAction({
      expectedUpdatedAt: "2026-08-02T00:00:00.000Z",
      force: true,
    })).toThrow("faq_suggestion_validation_failed:force");
  });

  it.each([
    "not-a-date",
    "2026-08-02",
    "2026-08-02T00:00:00",
    "2026-08-02T00:00:00+09:00",
  ])("rejects a non-canonical timestamp: %s", (expectedUpdatedAt) => {
    expect(() => parseFaqSuggestionReviewAction({ expectedUpdatedAt }))
      .toThrow("faq_suggestion_validation_failed:expectedUpdatedAt");
  });

  it("accepts a canonical optimistic concurrency token", () => {
    expect(parseFaqSuggestionReviewAction({
      expectedUpdatedAt: "2026-08-02T00:00:00.123Z",
    })).toEqual({
      expectedUpdatedAt: "2026-08-02T00:00:00.123Z",
    });
  });
});
