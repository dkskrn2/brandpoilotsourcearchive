import { describe, expect, it } from "vitest";
import { validateFinalAuditResult } from "./finalAuditValidation.js";

function result(overrides: Record<string, unknown> = {}) {
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
    faqSuggestions: [],
    keywords: [],
    observedTone: { summary: "차분한 문체", sourceFactIds: ["fact-company"] },
    competitors: [{
      name: "경쟁사",
      description: "비교 대상",
      sourceUrls: ["https://competitor.example/"],
    }],
    marketContext: [],
    evidence: [{
      fieldPath: "companyOverview",
      claim: "브랜드 운영을 지원합니다.",
      sourceId: "owned-1",
      sourceUrl: "https://brand.example/",
      excerpt: "브랜드 운영 서비스",
      sourceKind: "owned",
    }, {
      fieldPath: "competitors",
      claim: "비교 대상",
      sourceId: "external:https://competitor.example/",
      sourceUrl: "https://competitor.example/",
      excerpt: "경쟁사 소개",
      sourceKind: "external",
    }],
    sourceGaps: [],
    ...overrides,
  };
}

const options = {
  factIds: new Set(["fact-company"]),
  sources: [{
    sourceId: "owned-1",
    sourceUrl: "https://brand.example/",
    sourceKind: "owned" as const,
    text: "이 회사는 브랜드 운영 서비스를 제공합니다.",
  }],
  observedExternalUrls: new Set(["https://competitor.example/"]),
  allowedExternalUrls: new Set(["https://competitor.example/"]),
};

describe("final audit validation", () => {
  it("accepts a result that meets the API registry and grounding boundary", () => {
    expect(validateFinalAuditResult(result(), options)).toMatchObject({
      contractVersion: "brand-intelligence-result.v2",
      companyNameSuggestion: { sourceFactIds: ["fact-company"] },
    });
  });

  it("checks required raw suggestion fields and exact fact IDs before normalization", () => {
    const missingSuggestion = result();
    delete missingSuggestion.companyNameSuggestion;
    expect(() => validateFinalAuditResult(missingSuggestion, options))
      .toThrow("brand_intelligence_owned_fact_registry_mismatch");

    expect(() => validateFinalAuditResult(result({
      companyNameSuggestion: { name: "그로스라인", sourceFactIds: [" fact-company "] },
    }), options)).toThrow("brand_intelligence_owned_fact_registry_mismatch");
  });

  it("validates observed-tone fact IDs and owned evidence grounding", () => {
    expect(() => validateFinalAuditResult(result({
      observedTone: { summary: "차분한 문체", sourceFactIds: ["invented-fact"] },
    }), options)).toThrow("brand_intelligence_owned_fact_registry_mismatch");

    expect(() => validateFinalAuditResult(result({
      evidence: [{
        fieldPath: "companyOverview",
        claim: "브랜드 운영을 지원합니다.",
        sourceId: "owned-1",
        sourceUrl: "https://brand.example/",
        excerpt: "원문에 없는 문장",
        sourceKind: "owned",
      }],
    }), options)).toThrow("brand_intelligence_evidence_quote_mismatch");

    expect(() => validateFinalAuditResult(result({
      evidence: [{
        fieldPath: "companyOverview",
        claim: "브랜드 운영을 지원합니다.",
        sourceId: "owned-1",
        sourceUrl: null,
        excerpt: "브랜드 운영 서비스",
        sourceKind: "upload",
      }],
    }), options)).toThrow("brand_intelligence_evidence_registry_mismatch");
  });

  it("rejects control characters at the same boundary as the API v2 parser", () => {
    expect(() => validateFinalAuditResult(result({
      oneLineDefinition: "브랜드\u0001운영 파트너",
    }), options)).toThrow("brand_intelligence_result_invalid");
  });

  it("enforces API v2 category-code and keyword limits", () => {
    expect(() => validateFinalAuditResult(result({
      primaryCategory: { code: "c".repeat(201), name: "브랜드 컨설팅" },
    }), options)).toThrow("brand_intelligence_primary_category_invalid");

    expect(() => validateFinalAuditResult(result({
      keywords: ["k".repeat(201)],
    }), options)).toThrow("brand_intelligence_keywords_invalid");
  });

  it("validates external evidence URLs and their deterministic source IDs", () => {
    expect(() => validateFinalAuditResult(result({
      evidence: [{
        fieldPath: "competitors",
        claim: "비교 대상",
        sourceId: "external:invented",
        sourceUrl: "https://competitor.example/",
        excerpt: "경쟁사 소개",
        sourceKind: "external",
      }],
    }), options)).toThrow("brand_intelligence_external_registry_mismatch");

    expect(() => validateFinalAuditResult(result({
      competitors: [{
        name: "새 경쟁사",
        description: "추가한 대상",
        sourceUrls: ["https://invented.example/"],
      }],
    }), options)).toThrow("brand_intelligence_external_registry_mismatch");
  });

  it("counts external evidence URLs in the ten-URL limit", () => {
    const urls = Array.from({ length: 11 }, (_, index) => `https://external-${index}.example/`);
    expect(() => validateFinalAuditResult(result({
      competitors: [],
      evidence: urls.map((url) => ({
        fieldPath: "marketContext",
        claim: "시장 근거",
        sourceId: `external:${url}`,
        sourceUrl: url,
        excerpt: "외부 근거",
        sourceKind: "external",
      })),
    }), {
      ...options,
      observedExternalUrls: new Set(urls),
      allowedExternalUrls: new Set(urls),
    })).toThrow("brand_intelligence_external_url_limit_exceeded");
  });
});
