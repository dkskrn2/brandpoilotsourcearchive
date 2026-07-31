import { describe, expect, it } from "vitest";
import {
  parseCreateBrandAnalysisInput,
  parseBrandIntelligenceResult,
  toBrandIntelligenceCommonView,
} from "./brandIntelligenceContracts.js";

const offering = {
  kind: "service",
  name: "브랜드 운영",
  description: "브랜드 콘텐츠 운영 서비스",
  target: "중소 브랜드",
  benefit: "운영 시간 절감",
  priceText: null,
  purchaseUrl: "https://example.com/service",
  sourceFactIds: ["fact-1"],
};

function v2(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "brand-intelligence-result.v2",
    companyNameSuggestion: {
      name: "모종애드",
      sourceFactIds: ["fact-1"],
    },
    oneLineDefinition: "브랜드 콘텐츠 운영 파트너",
    companyOverview: "브랜드 운영을 돕습니다.",
    businessDescription: "콘텐츠 제작과 운영을 연결합니다.",
    primaryCategory: { code: "marketing", name: "마케팅" },
    subcategories: [],
    primaryTarget: "중소 브랜드",
    secondaryTargets: [],
    customerNeeds: ["지속적인 콘텐츠 운영"],
    valueProposition: "반복 업무를 줄입니다.",
    differentiators: ["자사 근거 중심"],
    coreAppeal: "운영 효율",
    supportingAppeals: [],
    offerings: [offering],
    faqSuggestions: [{
      question: "서비스 가격은 어떻게 확인하나요?",
      answer: "상담 후 범위에 따라 안내합니다.",
      category: "price",
      sourceFactIds: ["fact-1"],
    }],
    keywords: ["브랜드", "콘텐츠"],
    observedTone: { summary: "명확하고 실용적", sourceFactIds: ["fact-1"] },
    competitors: [],
    marketContext: [],
    evidence: [{
      fieldPath: "businessDescription",
      claim: "콘텐츠 제작과 운영을 연결합니다.",
      sourceId: "owned-1",
      sourceUrl: "https://example.com/about",
      excerpt: "콘텐츠 제작부터 운영까지",
      sourceKind: "owned",
    }],
    sourceGaps: [],
    ...overrides,
  };
}

const registry = {
  ownedFactIds: new Set(["fact-1"]),
  externalSources: new Map<string, string>(),
};

describe("brand-intelligence-result.v2", () => {
  it("accepts a user-owned company name and rejects blank/control characters", () => {
    expect(parseCreateBrandAnalysisInput({
      companyName: " 모종애드 ",
      ownedUrl: "https://example.com",
      uploadIds: [],
      idempotencyKey: "create-1",
    })).toMatchObject({ companyName: "모종애드" });
    expect(() => parseCreateBrandAnalysisInput({
      companyName: " ",
      ownedUrl: "https://example.com",
      uploadIds: [],
      idempotencyKey: "create-2",
    })).toThrow("brand_analysis_company_name_required");
    expect(() => parseCreateBrandAnalysisInput({
      companyName: "모종\u0000애드",
      ownedUrl: "https://example.com",
      uploadIds: [],
      idempotencyKey: "create-3",
    })).toThrow("brand_analysis_company_name_invalid");
  });

  it("accepts five combined product/service offerings", () => {
    const result = parseBrandIntelligenceResult(v2({
      offerings: Array.from({ length: 5 }, (_, index) => ({
        ...offering,
        name: `대표 서비스 ${index + 1}`,
      })),
    }), registry);
    expect(result.contractVersion).toBe("brand-intelligence-result.v2");
  });

  it("rejects more than five offerings and companyName inside model JSON", () => {
    expect(() => parseBrandIntelligenceResult(v2({
      offerings: Array.from({ length: 6 }, () => offering),
    }), registry)).toThrow("brand_intelligence_offering_limit_exceeded");
    expect(() => parseBrandIntelligenceResult(v2({ companyName: "모종애드" }), registry))
      .toThrow("brand_intelligence_result_invalid");
  });

  it("enforces owned fact and external source registries", () => {
    expect(() => parseBrandIntelligenceResult(v2({
      offerings: [{ ...offering, sourceFactIds: ["invented"] }],
    }), registry)).toThrow("brand_intelligence_owned_fact_registry_mismatch");

    const external = v2({
      competitors: [{
        name: "경쟁사",
        description: "대안 서비스",
        sourceUrls: ["https://competitor.example.com"],
      }],
    });
    expect(() => parseBrandIntelligenceResult(external, registry))
      .toThrow("brand_intelligence_external_registry_mismatch");
  });

  it("validates company name and FAQ suggestion fact registries", () => {
    const parsed = parseBrandIntelligenceResult(v2(), registry);
    expect(parsed.contractVersion).toBe("brand-intelligence-result.v2");
    if (parsed.contractVersion !== "brand-intelligence-result.v2") throw new Error("expected v2");
    expect(parsed.companyNameSuggestion?.name).toBe("모종애드");
    expect(parsed.faqSuggestions).toHaveLength(1);

    expect(() => parseBrandIntelligenceResult(v2({
      faqSuggestions: [{
        question: "가격은?",
        answer: "문의하세요.",
        category: "price",
        sourceFactIds: ["invented"],
      }],
    }), registry)).toThrow("brand_intelligence_owned_fact_registry_mismatch");
  });

  it("keeps stored v2 results without suggestions compatible", () => {
    const legacy = { ...v2() } as Partial<ReturnType<typeof v2>>;
    delete legacy.companyNameSuggestion;
    delete legacy.faqSuggestions;
    const parsed = parseBrandIntelligenceResult(legacy, registry);
    if (parsed.contractVersion !== "brand-intelligence-result.v2") throw new Error("expected v2");
    expect(parsed.companyNameSuggestion).toBeNull();
    expect(parsed.faqSuggestions).toEqual([]);
  });

  it("limits distinct external URLs to ten", () => {
    const urls = Array.from({ length: 11 }, (_, index) => `https://external${index}.example.com`);
    expect(() => parseBrandIntelligenceResult(v2({
      marketContext: urls.map((url) => ({ claim: "시장 정보", sourceUrls: [url] })),
    }), {
      ...registry,
      externalSources: new Map(urls.map((url) => [url, `external-${url}`])),
    })).toThrow("brand_intelligence_external_url_limit_exceeded");
  });

  it("normalizes v1 to the common view without offerings", () => {
    const v1 = {
      contractVersion: "brand-intelligence-result.v1",
      companyOverview: "회사 소개",
      businessDescription: "사업 소개",
      primaryCategory: { code: null, name: "마케팅" },
      subcategories: [],
      primaryTarget: "브랜드",
      differentiators: "근거 중심",
      coreAppeal: "효율",
      competitors: [],
      evidence: [],
      sourceGaps: [],
    };
    expect(toBrandIntelligenceCommonView(
      parseBrandIntelligenceResult(v1),
      "모종애드",
    )).toMatchObject({
      companyName: "모종애드",
      offerings: [],
      differentiators: ["근거 중심"],
    });
  });
});
