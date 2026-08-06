import { describe, expect, it } from "vitest";
import { parseBrandRulesContentV1 } from "@brand-pilot/content-contracts";
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

describe("BrandRulesV1 validation", () => {
  it("keeps the API canonical parser in parity with the shared immutable snapshot schema", () => {
    const raw = {
      contractVersion: "brand-rules.v1",
      requiredPhrases: [" 정확한 정보 "],
      forbiddenPhrases: [],
      exaggerationRules: [],
      ctaRules: { defaultCta: " 더 알아보기 ", allowed: [] },
      channelRules: { instagram: [" 짧은 문장 "] },
      designRules: { colors: [], fonts: [], notes: [] },
      autoApprovalRules: { enabled: false, conditions: [] },
    };
    const canonical = parseBrandRules(raw);

    expect(parseBrandRulesContentV1(canonical)).toEqual(canonical);
    expect(() => parseBrandRulesContentV1(raw)).toThrow("brand_rules_content_v1_invalid");
    expect(canonical).toMatchObject({
      requiredPhrases: ["정확한 정보"],
      ctaRules: { defaultCta: "더 알아보기" },
      channelRules: { instagram: ["짧은 문장"] },
      designRules: { referenceImages: [] },
    });
  });

  it("keeps review suggestions separate from runtime switches", () => {
    expect(parseBrandRules({
      contractVersion: "brand-rules.v1",
      requiredPhrases: ["브랜드 근거를 바탕으로"],
      forbiddenPhrases: ["무조건"],
      exaggerationRules: ["검증할 수 없는 최상급 표현을 사용하지 않습니다."],
      ctaRules: { defaultCta: "자세히 확인하기", allowed: ["문의하기"] },
      channelRules: { instagram: ["해시태그는 본문 마지막에 둡니다."] },
      designRules: { colors: ["#111111"], fonts: ["Pretendard"], notes: [] },
      autoApprovalRules: { enabled: true, conditions: ["금지 문구가 없습니다."] },
    }).autoApprovalRules).toEqual({
      enabled: true,
      conditions: ["금지 문구가 없습니다."],
    });
  });

  it("parses confirmed style reference images and defaults legacy rules", () => {
    const base = {
      contractVersion: "brand-rules.v1",
      requiredPhrases: [],
      forbiddenPhrases: [],
      exaggerationRules: [],
      ctaRules: { defaultCta: "", allowed: [] },
      channelRules: {},
      designRules: {
        colors: ["#174A3A"],
        fonts: ["Pretendard"],
        notes: ["절제된 이미지"],
      },
      autoApprovalRules: { enabled: false, conditions: [] },
    };
    const referenceImages = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
    ].map((referenceItemId, index) => ({
      referenceItemId,
      description: index === 0 ? "차분한 자연광" : "",
      tags: index === 0 ? ["자연광", "여백"] : [],
    }));
    expect(parseBrandRules({
      ...base,
      designRules: {
        ...base.designRules,
        referenceImages,
      },
    }).designRules).toEqual({
      colors: ["#174A3A"],
      fonts: ["Pretendard"],
      notes: ["절제된 이미지"],
      referenceImages,
    });
    expect(parseBrandRules(base).designRules).toMatchObject({
      referenceImages: [],
    });
  });

  it("rejects invalid or unbounded style reference images", () => {
    const base = {
      contractVersion: "brand-rules.v1",
      requiredPhrases: [],
      forbiddenPhrases: [],
      exaggerationRules: [],
      ctaRules: { defaultCta: "", allowed: [] },
      channelRules: {},
      designRules: { colors: [], fonts: [], notes: [] },
      autoApprovalRules: { enabled: false, conditions: [] },
    };
    const image = (id: string) => ({
      referenceItemId: id,
      description: "",
      tags: [],
    });
    const validIds = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
      "66666666-6666-4666-8666-666666666666",
    ];

    expect(() => parseBrandRules({
      ...base,
      designRules: { ...base.designRules, referenceImages: validIds.map(image) },
    })).toThrow("brand_core_validation_failed:rules.designRules.referenceImages");
    expect(() => parseBrandRules({
      ...base,
      designRules: { ...base.designRules, referenceImages: [image("not-a-uuid")] },
    })).toThrow("brand_core_validation_failed:rules.designRules.referenceImages");
    expect(() => parseBrandRules({
      ...base,
      designRules: {
        ...base.designRules,
        referenceImages: [image(validIds[0]!), image(validIds[0]!)],
      },
    })).toThrow("brand_core_validation_failed:rules.designRules.referenceImages");
    expect(() => parseBrandRules({
      ...base,
      designRules: {
        ...base.designRules,
        referenceImages: [{
          ...image(validIds[0]!),
          description: "x".repeat(241),
        }],
      },
    })).toThrow("brand_core_validation_failed:rules.designRules.referenceImages[0].description");
    expect(() => parseBrandRules({
      ...base,
      designRules: {
        ...base.designRules,
        referenceImages: [{
          ...image(validIds[0]!),
          tags: Array.from({ length: 11 }, (_, index) => `tag-${index}`),
        }],
      },
    })).toThrow("brand_core_validation_failed:rules.designRules.referenceImages[0].tags");
    expect(() => parseBrandRules({
      ...base,
      designRules: {
        ...base.designRules,
        referenceImages: [{
          ...image(validIds[0]!),
          tags: ["x".repeat(41)],
        }],
      },
    })).toThrow("brand_core_validation_failed:rules.designRules.referenceImages[0].tags");
    expect(() => parseBrandRules({
      ...base,
      designRules: {
        ...base.designRules,
        referenceImages: [{
          ...image(validIds[0]!),
          sourceUrl: "https://example.com/not-allowed",
        }],
      },
    })).toThrow("brand_core_validation_failed:rules.designRules.referenceImages[0]");
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
