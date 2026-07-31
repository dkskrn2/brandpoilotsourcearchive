import { describe, expect, it } from "vitest";
import { parseBrandIntelligenceResult } from "./result.js";

function v2(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "brand-intelligence-result.v2",
    companyNameSuggestion: {
      name: "그로스라인",
      sourceFactIds: ["fact-company"],
    },
    oneLineDefinition: "브랜드 운영 파트너",
    companyOverview: "브랜드 운영을 지원합니다.",
    businessDescription: "운영 진단과 자동화를 제공합니다.",
    primaryCategory: { code: null, name: "브랜드 컨설팅" },
    subcategories: [],
    primaryTarget: "온라인 사업자",
    secondaryTargets: [],
    customerNeeds: [],
    valueProposition: "운영 효율 개선",
    differentiators: ["근거 중심"],
    coreAppeal: "반복 업무 절감",
    supportingAppeals: [],
    offerings: [],
    faqSuggestions: [{
      question: "서비스 가격은 어떻게 확인하나요?",
      answer: "상담 후 범위에 따라 안내합니다.",
      category: "price",
      sourceFactIds: ["fact-price"],
    }],
    keywords: [],
    observedTone: null,
    competitors: [],
    marketContext: [],
    evidence: [],
    sourceGaps: [],
    ...overrides,
  };
}

describe("brand intelligence result suggestions", () => {
  it("parses an evidence-backed company name and FAQ suggestions", () => {
    const result = parseBrandIntelligenceResult(v2());
    expect(result.contractVersion).toBe("brand-intelligence-result.v2");
    if (result.contractVersion !== "brand-intelligence-result.v2") throw new Error("expected v2");
    expect(result.companyNameSuggestion?.name).toBe("그로스라인");
    expect(result.faqSuggestions).toEqual([expect.objectContaining({
      category: "price",
      sourceFactIds: ["fact-price"],
    })]);
  });

  it("rejects unsupported FAQ categories and more than twenty suggestions", () => {
    expect(() => parseBrandIntelligenceResult(v2({
      faqSuggestions: [{
        question: "질문",
        answer: "답변",
        category: "unsupported",
        sourceFactIds: ["fact-1"],
      }],
    }))).toThrow("brand_intelligence_faq_invalid");

    expect(() => parseBrandIntelligenceResult(v2({
      faqSuggestions: Array.from({ length: 21 }, (_, index) => ({
        question: `질문 ${index + 1}`,
        answer: "답변",
        category: "other",
        sourceFactIds: ["fact-1"],
      })),
    }))).toThrow("brand_intelligence_faq_limit_exceeded");
  });

  it("keeps older v2 results readable with empty suggestion defaults", () => {
    const legacy = v2();
    delete legacy.companyNameSuggestion;
    delete legacy.faqSuggestions;
    const result = parseBrandIntelligenceResult(legacy);
    if (result.contractVersion !== "brand-intelligence-result.v2") throw new Error("expected v2");
    expect(result.companyNameSuggestion).toBeNull();
    expect(result.faqSuggestions).toEqual([]);
  });
});
