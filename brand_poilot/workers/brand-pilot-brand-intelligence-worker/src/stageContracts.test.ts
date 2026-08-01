import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseExternalCandidateEnvelope,
  parseOfferingSuggestions,
  parseOwnedFactEnvelope,
} from "./stageContracts.js";

const supportedFactIds = new Set(["fact-valid"]);

function validOffering() {
  return {
    kind: "service",
    name: "브랜드 운영 진단",
    description: "현재 운영 상태를 진단합니다.",
    target: "온라인 사업자",
    benefit: "운영 개선 지점을 확인할 수 있습니다.",
    priceText: "상담 후 안내",
    purchaseUrl: "https://example.com/services/diagnosis",
    sourceFactIds: ["fact-valid"],
  };
}

function validFaq() {
  return {
    question: "서비스 가격은 어떻게 확인하나요?",
    answer: "상담 후 범위에 따라 안내합니다.",
    category: "price",
    sourceFactIds: ["fact-valid"],
  };
}

function validOfferingSuggestions() {
  return {
    companyNameSuggestion: {
      name: "그로스라인",
      sourceFactIds: ["fact-valid"],
    },
    offerings: [validOffering()],
    faqSuggestions: [validFaq()],
  };
}

function mixedRegistryOfferingSuggestions() {
  return {
    companyNameSuggestion: {
      name: "등록되지 않은 회사명",
      sourceFactIds: ["fact-valid", "fact-unregistered"],
    },
    offerings: [
      validOffering(),
      {
        ...validOffering(),
        name: "근거가 일치하지 않는 서비스",
        sourceFactIds: ["fact-valid", "fact-unregistered"],
      },
    ],
    faqSuggestions: [
      validFaq(),
      {
        ...validFaq(),
        question: "근거가 일치하지 않는 질문",
        sourceFactIds: ["fact-valid", "fact-unregistered"],
      },
    ],
  };
}

describe("brand intelligence stage contracts", () => {
  it("ships a discoverable v2-only runtime skill contract", async () => {
    const packageRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
    );
    const skill = await readFile(
      path.join(packageRoot, ".agents", "skills", "brand-intelligence", "SKILL.md"),
      "utf8",
    );
    expect(skill).toMatch(/^---\r?\nname: brand-intelligence\r?\ndescription: Use when /);
    expect(skill).toContain("brand-intelligence-result.v2");
    expect(skill).toContain("대표 상품·서비스는 최대 5개");
    expect(skill).toContain("외부 고유 URL은 최대 10개");
    expect(skill).not.toContain("brand-intelligence-result.v1");
  });

  it("accepts supported facts whose quote exists in the registered segment", () => {
    const parsed = parseOwnedFactEnvelope({
      stageVersion: "owned-facts.v1",
      output: [{
        id: "fact-1",
        claim: "콘텐츠 운영을 지원합니다.",
        sourceId: "owned-1",
        segmentId: "segment-1",
        sourceUrl: "https://example.com/about",
        quotes: ["콘텐츠 운영을 지원합니다"],
        category: "business",
        support: "supported",
      }],
    }, new Map([["segment-1", {
      sourceId: "owned-1",
      sourceUrl: "https://example.com/about",
      normalizedText: "브랜드의 콘텐츠 운영을 지원합니다.",
    }]]));
    expect(parsed.output[0]?.id).toBe("fact-1");
  });

  it("rejects invented sources, absent quotes, and extra keys", () => {
    const segments = new Map([["segment-1", {
      sourceId: "owned-1",
      sourceUrl: null,
      normalizedText: "등록된 본문",
    }]]);
    expect(() => parseOwnedFactEnvelope({
      stageVersion: "owned-facts.v1",
      output: [{
        id: "fact-1",
        claim: "주장",
        sourceId: "invented",
        segmentId: "segment-1",
        sourceUrl: null,
        quotes: ["등록된 본문"],
        category: "business",
        support: "supported",
      }],
    }, segments)).toThrow("owned_fact_source_registry_mismatch");
    expect(() => parseOwnedFactEnvelope({
      stageVersion: "owned-facts.v1",
      output: [{
        id: "fact-1",
        claim: "주장",
        sourceId: "owned-1",
        segmentId: "segment-1",
        sourceUrl: null,
        quotes: ["없는 인용"],
        category: "business",
        support: "supported",
      }],
    }, segments)).toThrow("owned_fact_quote_mismatch");
  });

  it("omits only quote-mismatched facts when explicitly requested", () => {
    const segments = new Map([["segment-1", {
      sourceId: "owned-1",
      sourceUrl: null,
      normalizedText: "등록된 본문과 검증된 사실",
    }]]);
    const parsed = parseOwnedFactEnvelope({
      stageVersion: "owned-facts.v1",
      output: [{
        id: "fact-valid",
        claim: "검증된 사실",
        sourceId: "owned-1",
        segmentId: "segment-1",
        sourceUrl: null,
        quotes: ["검증된 사실"],
        category: "business",
        support: "supported",
      }, {
        id: "fact-mismatch",
        claim: "재서술된 사실",
        sourceId: "owned-1",
        segmentId: "segment-1",
        sourceUrl: null,
        quotes: ["원문에 없는 인용"],
        category: "business",
        support: "supported",
      }],
    }, segments, { quoteMismatch: "drop-fact" });

    expect(parsed.output.map(({ id }) => id)).toEqual(["fact-valid"]);
    expect(parseOwnedFactEnvelope({
      stageVersion: "owned-facts.v1",
      output: [{
        id: "fact-only-mismatch",
        claim: "재서술된 사실",
        sourceId: "owned-1",
        segmentId: "segment-1",
        sourceUrl: null,
        quotes: ["원문에 없는 인용"],
        category: "business",
        support: "supported",
      }],
    }, segments, { quoteMismatch: "drop-fact" }).output).toEqual([]);
  });

  it("does not let quote omission hide registry, shape, or duplicate-id errors", () => {
    const segments = new Map([["segment-1", {
      sourceId: "owned-1",
      sourceUrl: null,
      normalizedText: "등록된 본문",
    }]]);
    const fact = {
      id: "fact-1",
      claim: "주장",
      sourceId: "owned-1",
      segmentId: "segment-1",
      sourceUrl: null,
      quotes: ["원문에 없는 인용"],
      category: "business",
      support: "supported",
    };
    const parse = (output: unknown[]) => parseOwnedFactEnvelope({
      stageVersion: "owned-facts.v1",
      output,
    }, segments, { quoteMismatch: "drop-fact" });

    expect(() => parse([{ ...fact, sourceId: "invented" }]))
      .toThrow("owned_fact_source_registry_mismatch");
    expect(() => parse([{ ...fact, sourceUrl: "https://example.com/invented" }]))
      .toThrow("owned_fact_source_registry_mismatch");
    expect(() => parse([{ ...fact, claim: "" }]))
      .toThrow("owned_fact_invalid");
    expect(() => parse([{ ...fact, extra: true }]))
      .toThrow("owned_fact_invalid");
    expect(() => parse([fact, { ...fact, quotes: ["등록된 본문"] }]))
      .toThrow("owned_fact_id_duplicate");
  });

  it("drops the entire fact when any one of its quotes is mismatched", () => {
    const segments = new Map([["segment-1", {
      sourceId: "owned-1",
      sourceUrl: null,
      normalizedText: "첫 번째 인용과 두 번째 인용",
    }]]);
    const parsed = parseOwnedFactEnvelope({
      stageVersion: "owned-facts.v1",
      output: [{
        id: "fact-1",
        claim: "주장",
        sourceId: "owned-1",
        segmentId: "segment-1",
        sourceUrl: null,
        quotes: ["첫 번째 인용", "원문에 없는 인용"],
        category: "business",
        support: "conflicting",
      }],
    }, segments, { quoteMismatch: "drop-fact" });

    expect(parsed.output).toEqual([]);
  });

  it("retains missing facts without quotes but omits supported facts without quotes", () => {
    const segments = new Map([["segment-1", {
      sourceId: "owned-1",
      sourceUrl: null,
      normalizedText: "등록된 본문",
    }]]);
    const base = {
      claim: "확인할 수 없음",
      sourceId: "owned-1",
      segmentId: "segment-1",
      sourceUrl: null,
      quotes: [],
      category: "business",
    };
    const parsed = parseOwnedFactEnvelope({
      stageVersion: "owned-facts.v1",
      output: [{ ...base, id: "fact-missing", support: "missing" }, {
        ...base,
        id: "fact-supported",
        support: "supported",
      }],
    }, segments, { quoteMismatch: "drop-fact" });

    expect(parsed.output.map(({ id }) => id)).toEqual(["fact-missing"]);
  });

  it("bounds and normalizes external search candidates", () => {
    const parsed = parseExternalCandidateEnvelope({
      stageVersion: "external-candidates.v1",
      output: [{ url: "https://example.com/a#fragment", reason: "경쟁 대안" }],
    });
    expect(parsed.output).toEqual([{
      url: "https://example.com/a",
      reason: "경쟁 대안",
    }]);
  });

  it("rejects an unregistered offering-stage fact ID by default", () => {
    expect(() => parseOfferingSuggestions(
      mixedRegistryOfferingSuggestions(),
      supportedFactIds,
    )).toThrow("brand_intelligence_offering_registry_mismatch");
  });

  it("drops complete registry-mismatched suggestions while retaining valid siblings", () => {
    const parsed = parseOfferingSuggestions(
      mixedRegistryOfferingSuggestions(),
      supportedFactIds,
      { registryMismatch: "drop-item" },
    );

    expect(parsed.dropped).toEqual({
      companyNameSuggestion: 1,
      offerings: 1,
      faqSuggestions: 1,
    });
    expect(parsed.output.companyNameSuggestion).toBeNull();
    expect(parsed.output.offerings).toEqual([validOffering()]);
    expect(parsed.output.faqSuggestions).toEqual([validFaq()]);
  });

  it("normalizes omitted nullable offering fields into the final result shape", () => {
    const parsed = parseOfferingSuggestions({
      companyNameSuggestion: null,
      offerings: [{
        kind: "product",
        name: "운영 템플릿",
        sourceFactIds: ["fact-valid"],
      }],
      faqSuggestions: [],
    }, supportedFactIds);

    expect(parsed.output.offerings).toEqual([{
      kind: "product",
      name: "운영 템플릿",
      description: null,
      target: null,
      benefit: null,
      priceText: null,
      purchaseUrl: null,
      sourceFactIds: ["fact-valid"],
    }]);
  });

  it.each([
    {
      label: "a malformed scalar",
      code: "brand_intelligence_offering_invalid",
      value: () => ({
        ...validOfferingSuggestions(),
        offerings: [{ ...validOffering(), name: 123 }],
      }),
    },
    {
      label: "an unsafe optional URL",
      code: "brand_intelligence_offering_invalid",
      value: () => ({
        ...validOfferingSuggestions(),
        offerings: [{ ...validOffering(), purchaseUrl: "http://example.com/buy" }],
      }),
    },
    {
      label: "an unknown top-level key",
      code: "brand_intelligence_offering_invalid",
      value: () => ({ ...validOfferingSuggestions(), unexpected: true }),
    },
    {
      label: "an unknown company-name key",
      code: "brand_intelligence_company_name_suggestion_invalid",
      value: () => ({
        ...validOfferingSuggestions(),
        companyNameSuggestion: {
          name: "그로스라인",
          sourceFactIds: ["fact-valid"],
          unexpected: true,
        },
      }),
    },
    {
      label: "an unknown offering key",
      code: "brand_intelligence_offering_invalid",
      value: () => ({
        ...validOfferingSuggestions(),
        offerings: [{ ...validOffering(), unexpected: true }],
      }),
    },
    {
      label: "an unknown FAQ key",
      code: "brand_intelligence_faq_invalid",
      value: () => ({
        ...validOfferingSuggestions(),
        faqSuggestions: [{ ...validFaq(), unexpected: true }],
      }),
    },
    {
      label: "more than five offerings",
      code: "brand_intelligence_offering_limit_exceeded",
      value: () => ({
        ...validOfferingSuggestions(),
        offerings: Array.from({ length: 6 }, validOffering),
      }),
    },
    {
      label: "more than twenty FAQs",
      code: "brand_intelligence_faq_limit_exceeded",
      value: () => ({
        ...validOfferingSuggestions(),
        faqSuggestions: Array.from({ length: 21 }, validFaq),
      }),
    },
    {
      label: "more than fifty source fact IDs",
      code: "brand_intelligence_offering_invalid",
      value: () => ({
        ...validOfferingSuggestions(),
        offerings: [{
          ...validOffering(),
          sourceFactIds: Array.from({ length: 51 }, () => "fact-valid"),
        }],
      }),
    },
    {
      label: "empty company-name source fact IDs",
      code: "brand_intelligence_company_name_suggestion_invalid",
      value: () => ({
        ...validOfferingSuggestions(),
        companyNameSuggestion: { name: "그로스라인", sourceFactIds: [] },
      }),
    },
    {
      label: "empty offering source fact IDs",
      code: "brand_intelligence_offering_invalid",
      value: () => ({
        ...validOfferingSuggestions(),
        offerings: [{ ...validOffering(), sourceFactIds: [] }],
      }),
    },
    {
      label: "empty FAQ source fact IDs",
      code: "brand_intelligence_faq_invalid",
      value: () => ({
        ...validOfferingSuggestions(),
        faqSuggestions: [{ ...validFaq(), sourceFactIds: [] }],
      }),
    },
    {
      label: "a non-string company-name source fact ID",
      code: "brand_intelligence_company_name_suggestion_invalid",
      value: () => ({
        ...validOfferingSuggestions(),
        companyNameSuggestion: { name: "그로스라인", sourceFactIds: [123] },
      }),
    },
    {
      label: "a non-string offering source fact ID",
      code: "brand_intelligence_offering_invalid",
      value: () => ({
        ...validOfferingSuggestions(),
        offerings: [{ ...validOffering(), sourceFactIds: [123] }],
      }),
    },
    {
      label: "a non-string FAQ source fact ID",
      code: "brand_intelligence_faq_invalid",
      value: () => ({
        ...validOfferingSuggestions(),
        faqSuggestions: [{ ...validFaq(), sourceFactIds: [123] }],
      }),
    },
  ])("rejects $label as a structural error in drop-item mode", ({ value, code }) => {
    expect(() => parseOfferingSuggestions(
      value(),
      supportedFactIds,
      { registryMismatch: "drop-item" },
    )).toThrow(code);
  });

  it("completes structural validation before checking registry membership", () => {
    const value = mixedRegistryOfferingSuggestions();
    value.offerings.push({ ...validOffering(), name: 123 as unknown as string });

    expect(() => parseOfferingSuggestions(value, supportedFactIds))
      .toThrow("brand_intelligence_offering_invalid");
    expect(() => parseOfferingSuggestions(value, supportedFactIds, {
      registryMismatch: "drop-item",
    })).toThrow("brand_intelligence_offering_invalid");
  });

  it("does not trim source fact IDs into registry matches", () => {
    const value = validOfferingSuggestions();
    value.offerings[0]!.sourceFactIds = [" fact-valid "];

    expect(() => parseOfferingSuggestions(value, supportedFactIds))
      .toThrow("brand_intelligence_offering_registry_mismatch");
    expect(parseOfferingSuggestions(value, supportedFactIds, {
      registryMismatch: "drop-item",
    }).output.offerings).toEqual([]);
  });
});
