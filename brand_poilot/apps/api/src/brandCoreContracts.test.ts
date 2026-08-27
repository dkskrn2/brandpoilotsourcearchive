import { describe, expect, it } from "vitest";
import {
  mapAnalysisToBrandCoreDraft,
  parseBrandCoreForApproval,
  parseBrandCoreDraft,
  parseBrandEvidence,
  parseBrandReviewState,
  parseBrandRules,
  transitionBrandReviewState,
} from "./brandCoreContracts.js";
import type { BrandIntelligenceResultV1 } from "./brandIntelligenceContracts.js";

function validCore() {
  return {
    contractVersion: "brand-core.v1",
    summary: {
      oneLine: "브랜드 콘텐츠 운영을 단순하게 만듭니다.",
      description: "자사 자료를 근거로 콘텐츠 제작과 게시 운영을 연결합니다.",
    },
    audiences: [{
      name: "중소 브랜드 담당자",
      problem: "반복적인 콘텐츠 운영에 시간이 많이 듭니다.",
      desiredOutcome: "적은 인력으로 일관된 콘텐츠를 발행하고 싶습니다.",
    }],
    valueProposition: {
      primary: "브랜드 근거를 재사용해 반복 업무를 줄입니다.",
      differentiators: ["승인된 브랜드 정보만 생성에 사용합니다."],
      proofPoints: ["콘텐츠 생성부터 게시 검토까지 한 흐름으로 연결합니다."],
    },
    messaging: {
      appeals: ["반복 업무 절감"],
      tone: ["명확함", "실무적"],
      preferredPhrases: ["브랜드 근거를 바탕으로"],
      brandDirection: "과장 없이 실행 가능한 마케팅 운영을 돕습니다.",
      priorityMessages: ["승인된 정보로 일관된 콘텐츠를 만듭니다."],
    },
  };
}

function analysis(): BrandIntelligenceResultV1 {
  return {
    contractVersion: "brand-intelligence-result.v1",
    companyOverview: "그로스라인은 콘텐츠 운영을 지원합니다.",
    businessDescription: "자사 자료를 바탕으로 콘텐츠 제작과 게시 운영을 연결합니다.",
    primaryCategory: { code: "marketing", name: "마케팅" },
    subcategories: [],
    primaryTarget: "콘텐츠 운영 인력이 부족한 중소 브랜드 담당자",
    differentiators: "승인된 브랜드 정보를 콘텐츠 제작에 재사용합니다.",
    coreAppeal: "반복적인 콘텐츠 운영 업무를 줄입니다.",
    competitors: [],
    evidence: [{
      field: "businessDescription",
      claim: "콘텐츠 제작과 게시 운영을 연결합니다.",
      sourceId: "owned-url",
      sourceUrl: "https://example.com/service",
    }],
    sourceGaps: ["브랜드 톤 자료가 없습니다."],
  };
}

describe("BrandCoreV1 validation", () => {
  it("accepts a complete approval contract", () => {
    expect(parseBrandCoreForApproval(validCore())).toMatchObject(validCore());
  });

  it("returns the exact field path for missing and oversized values", () => {
    expect(() => parseBrandCoreForApproval({
      ...validCore(),
      summary: { ...validCore().summary, oneLine: "" },
    })).toThrow("brand_core_validation_failed:summary.oneLine");

    expect(() => parseBrandCoreDraft({
      ...validCore(),
      messaging: {
        ...validCore().messaging,
        appeals: Array.from({ length: 21 }, () => "소구점"),
      },
    })).toThrow("brand_core_validation_failed:messaging.appeals");
  });

  it("allows explicit empty draft fields but does not approve them", () => {
    const draft = validCore();
    draft.messaging.brandDirection = "";
    expect(parseBrandCoreDraft(draft).messaging.brandDirection).toBe("");
    expect(() => parseBrandCoreForApproval(draft))
      .toThrow("brand_core_validation_failed:messaging.brandDirection");
  });
});

describe("brand evidence and review state", () => {
  it("validates evidence URLs, confidence and known field paths", () => {
    expect(parseBrandEvidence([{
      fieldPath: "summary.description",
      sourceType: "owned_url",
      sourceId: "owned-url",
      sourceUrl: "https://example.com/service",
      excerpt: "콘텐츠 제작과 게시 운영을 연결합니다.",
      confidence: 0.9,
    }])).toHaveLength(1);

    expect(() => parseBrandEvidence([{
      fieldPath: "summary.description",
      sourceType: "owned_url",
      sourceId: "owned-url",
      sourceUrl: "https://example.com",
      excerpt: "근거",
      confidence: 1.1,
    }])).toThrow("brand_core_validation_failed:evidence[0].confidence");
  });

  it("rejects unknown review paths and backwards review transitions", () => {
    expect(() => parseBrandReviewState({
      invented: { decision: "ai_suggested", reviewerUserId: null, reviewedAt: null },
    })).toThrow("brand_core_validation_failed:reviewState.invented");

    expect(() => transitionBrandReviewState(
      { decision: "approved", reviewerUserId: "user-1", reviewedAt: "2026-07-26T00:00:00.000Z" },
      { decision: "user_edited", reviewerUserId: "user-1", reviewedAt: "2026-07-26T01:00:00.000Z" },
    )).toThrow("brand_core_review_transition_invalid");
  });
});

describe("BrandRulesV2 validation", () => {
  const rules = {
    contractVersion: "brand-rules.v2",
    requiredPhrases: ["정확한 정보"], forbiddenPhrases: [], exaggerationRules: [],
    ctaRules: { defaultCta: "", allowed: [] }, channelRules: {},
    autoApprovalRules: { enabled: false, conditions: [] },
  } as const;

  it("keeps the API parser in parity with the shared V2 schema", () => {
    expect(parseBrandRules(rules)).toEqual(rules);
  });

  it("rejects the removed designRules field and V1 writes", () => {
    expect(() => parseBrandRules({ ...rules, designRules: {} }))
      .toThrow("brand_core_validation_failed:rules");
    expect(() => parseBrandRules({ ...rules, contractVersion: "brand-rules.v1" }))
      .toThrow("brand_core_validation_failed:rules");
  });
});

describe("analysis to Brand Core draft mapping", () => {
  it("maps only observed analysis values and marks absent fields for review", () => {
    const mapped = mapAnalysisToBrandCoreDraft(analysis());

    expect(mapped.core).toMatchObject({
      contractVersion: "brand-core.v1",
      companyOverview: "그로스라인은 콘텐츠 운영을 지원합니다.",
      businessDescription: "자사 자료를 바탕으로 콘텐츠 제작과 게시 운영을 연결합니다.",
      primaryCategory: { code: "marketing", name: "마케팅" },
      subcategories: [],
      primaryTarget: "콘텐츠 운영 인력이 부족한 중소 브랜드 담당자",
      differentiators: ["승인된 브랜드 정보를 콘텐츠 제작에 재사용합니다."],
      coreAppeal: "반복적인 콘텐츠 운영 업무를 줄입니다.",
      summary: {
        oneLine: "반복적인 콘텐츠 운영 업무를 줄입니다.",
        description: "자사 자료를 바탕으로 콘텐츠 제작과 게시 운영을 연결합니다.",
      },
      valueProposition: {
        primary: "반복적인 콘텐츠 운영 업무를 줄입니다.",
        differentiators: ["승인된 브랜드 정보를 콘텐츠 제작에 재사용합니다."],
        proofPoints: [],
      },
      messaging: {
        tone: [],
        preferredPhrases: [],
        priorityMessages: [],
      },
    });
    expect(mapped.evidence[0]).toMatchObject({
      fieldPath: "summary.description",
      sourceType: "owned_url",
      confidence: null,
    });
    expect(mapped.needsReview).toEqual(expect.arrayContaining([
      "audiences",
      "valueProposition.proofPoints",
      "messaging.tone",
      "messaging.preferredPhrases",
      "messaging.priorityMessages",
    ]));
    expect(mapped.core.messaging.tone).not.toContain(expect.any(String));
  });
});
