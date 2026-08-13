import { describe, expect, it } from "vitest";
import {
  parseContentSuggestionBatch,
  parseContentSuggestionCategoryCode,
} from "./contentSuggestionContracts.js";

const source = {
  url: "https://example.org/articles/indoor-travel",
  title: "실내 여행 자료",
  publisher: "예시 기관",
  publishedAt: "2026-08-08",
};

const item = {
  subcategoryCode: "domestic_travel",
  intent: "trend",
  position: 1,
  title: "장마철에도 실패 없는 서울 실내 여행 코스",
  whyNow: "비 예보와 여름 휴가 수요가 겹치는 시점입니다.",
  contentBrief: "실내 이동 동선과 체류 시간을 중심으로 구성합니다.",
  sources: [source],
};

const validBatch = {
  contractVersion: "content-suggestion-batch.v1",
  categoryCode: "travel_tourism",
  generationDate: "2026-08-09",
  items: [item],
};

describe("parseContentSuggestionCategoryCode", () => {
  it("normalizes a bounded catalog code", () => {
    expect(parseContentSuggestionCategoryCode(" travel_tourism ")).toBe("travel_tourism");
  });

  it("rejects a code outside the catalog format", () => {
    expect(() => parseContentSuggestionCategoryCode("Travel Tourism"))
      .toThrow("content_suggestion_category_code_invalid");
  });
});

describe("parseContentSuggestionBatch", () => {
  it("returns a normalized valid batch", () => {
    expect(parseContentSuggestionBatch(validBatch)).toEqual(validBatch);
  });

  it("rejects unknown fields at every contract level", () => {
    expect(() => parseContentSuggestionBatch({ ...validBatch, extra: true }))
      .toThrow("content_suggestion_unknown_field");
    expect(() => parseContentSuggestionBatch({
      ...validBatch,
      items: [{ ...item, extra: true }],
    })).toThrow("content_suggestion_unknown_field");
    expect(() => parseContentSuggestionBatch({
      ...validBatch,
      items: [{ ...item, sources: [{ ...source, extra: true }] }],
    })).toThrow("content_suggestion_unknown_field");
  });

  it("requires the exact version, KST date shape, and at least one item", () => {
    expect(() => parseContentSuggestionBatch({ ...validBatch, contractVersion: "v2" }))
      .toThrow("content_suggestion_contract_version_invalid");
    expect(() => parseContentSuggestionBatch({ ...validBatch, generationDate: "2026-02-30" }))
      .toThrow("content_suggestion_generation_date_invalid");
    expect(() => parseContentSuggestionBatch({ ...validBatch, items: [] }))
      .toThrow("content_suggestion_items_required");
  });

  it("caps the batch at 28 items", () => {
    expect(() => parseContentSuggestionBatch({
      ...validBatch,
      items: Array.from({ length: 29 }, (_, index) => ({
        ...item,
        subcategoryCode: `subcategory_${index}`,
      })),
    })).toThrow("content_suggestion_items_limit_exceeded");
  });

  it("allows only informational or trend positions one and two", () => {
    expect(() => parseContentSuggestionBatch({
      ...validBatch,
      items: [{ ...item, intent: "advertising" }],
    })).toThrow("content_suggestion_intent_invalid");
    expect(() => parseContentSuggestionBatch({
      ...validBatch,
      items: [{ ...item, position: 3 }],
    })).toThrow("content_suggestion_position_invalid");
  });

  it("rejects a duplicate subcategory intent position slot", () => {
    expect(() => parseContentSuggestionBatch({
      ...validBatch,
      items: [item, { ...item }],
    })).toThrow("content_suggestion_duplicate_slot");
  });

  it("enforces title, why-now, and brief limits", () => {
    expect(() => parseContentSuggestionBatch({
      ...validBatch,
      items: [{ ...item, title: "가".repeat(121) }],
    })).toThrow("content_suggestion_title_too_long");
    expect(() => parseContentSuggestionBatch({
      ...validBatch,
      items: [{ ...item, whyNow: "가".repeat(301) }],
    })).toThrow("content_suggestion_why_now_too_long");
    expect(() => parseContentSuggestionBatch({
      ...validBatch,
      items: [{ ...item, contentBrief: "가".repeat(501) }],
    })).toThrow("content_suggestion_content_brief_too_long");
  });

  it("requires one to three HTTP sources with valid optional dates", () => {
    expect(() => parseContentSuggestionBatch({
      ...validBatch,
      items: [{ ...item, sources: [] }],
    })).toThrow("content_suggestion_sources_invalid");
    expect(() => parseContentSuggestionBatch({
      ...validBatch,
      items: [{ ...item, sources: Array.from({ length: 4 }, () => source) }],
    })).toThrow("content_suggestion_sources_invalid");
    expect(() => parseContentSuggestionBatch({
      ...validBatch,
      items: [{ ...item, sources: [{ ...source, url: "file:///tmp/source" }] }],
    })).toThrow("content_suggestion_source_url_invalid");
    expect(() => parseContentSuggestionBatch({
      ...validBatch,
      items: [{ ...item, sources: [{ ...source, publishedAt: "2026-02-30" }] }],
    })).toThrow("content_suggestion_source_published_at_invalid");
  });

  it("preserves a missing source publication date as null", () => {
    const parsed = parseContentSuggestionBatch({
      ...validBatch,
      items: [{ ...item, sources: [{ ...source, publishedAt: null }] }],
    });
    expect(parsed.items[0].sources[0].publishedAt).toBeNull();
  });
});
