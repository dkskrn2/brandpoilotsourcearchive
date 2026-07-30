import { describe, expect, it } from "vitest";
import type { ServiceSubtype } from "./contracts.js";
import { parseSubjectAnalysisResult, parseSubjectAnalysisResultV2, SubjectAnalysisContractError } from "./result.js";

const attachmentId = "123e4567-e89b-42d3-a456-426614174000";
const foreignAttachmentId = "123e4567-e89b-42d3-a456-426614174001";

const context = (expectedSubjectType: "product" | "service", allowedAttachmentIds = [attachmentId]) => ({
  expectedSubjectType,
  allowedAttachmentIds,
});

function result() {
  const target = (id: string) => ({ id, name: id, traits: ["특성"], painPoints: ["문제"], purchaseMotivations: ["동기"], uspEvidence: [{ claim: "근거", support: "설명", sourceUrl: "https://example.com/product" }] });
  const appeal = (id: string, targetId: string) => ({ id, targetId, title: id, description: "설명", evidenceType: "product_fact" as const, connectionReason: "연결", sources: [{ title: "상품 페이지", url: "https://example.com/product" }] });
  return { contractVersion: "subject-analysis-result.v1" as const, summary: "요약", needs: [{ text: "필요", sourceUrl: "https://example.com/voc" }], alternatives: [{ name: "대안", strengths: ["장점"], limitations: ["한계"], sourceUrls: ["https://example.com/alternative"] }], voc: [{ quoteSummary: "표현", context: "맥락", sourceUrl: "https://example.com/voc" }], usps: [{ claim: "주장", support: "근거", sourceUrl: "https://example.com/product" }], targets: [target("t1"), target("t2"), target("t3")] as never, appealsByTarget: { t1: [appeal("a1", "t1"), appeal("a2", "t1")], t2: [appeal("a3", "t2"), appeal("a4", "t2")], t3: [appeal("a5", "t3"), appeal("a6", "t3")] }, recommendedImageId: null, sourceGaps: [] };
}

function resultV2() {
  return {
    contractVersion: "subject-analysis-result.v2" as const,
    phase: "analysis" as const,
    subjectType: "product" as const,
    summary: "근거 기반 제품 분석",
    verifiedFacts: [{ claim: "소재", support: "첨부 문서에 기재", sourceUrl: `attachment://${attachmentId}` }],
    voc: [{ quoteSummary: "배송 문의", context: "공개 고객 의견", sourceUrl: "https://research.example.com/voc" }],
    alternatives: [{ name: "대안", strengths: ["장점"], limitations: ["한계"], sourceUrls: ["https://research.example.com/alternative"] }],
    barriers: [{ barrier: "규격 불확실", evidence: "규격 문의가 반복됨", sourceUrls: [`attachment://${attachmentId}`] }],
    productProfile: {
      name: "정리함",
      category: "생활용품",
      specifications: ["중형"],
      materials: ["재생 플라스틱"],
      options: ["파란색"],
      price: "직접 입력 가격",
      discountsAndPromotions: ["직접 입력 프로모션"],
      shipping: ["일반 배송"],
      returns: ["상세 페이지 조건"],
      functions: [{ function: "정리", benefit: "시간 절약", purchaseReason: "반복 작업 감소" }],
      useContexts: ["책상 정리"],
      purchaseBarriers: ["규격 불확실"],
      reviewPatterns: { recurringSatisfaction: ["정리 편의"], recurringComplaints: ["크기 확인 필요"] },
      productImageCandidates: [{ attachmentId, reason: "제품 전체가 보임" }],
      detailImageCandidates: [{ attachmentId, reason: "소재가 보임" }],
    },
    serviceProfile: null,
    serviceSubtype: null,
    sourceGaps: [],
  };
}

function serviceProfile() {
  return {
    customerProblem: ["업무 병목"],
    currentAlternatives: ["수작업"],
    deliveryProcess: ["진단", "수행", "지원"],
    deliverables: ["진단 보고서"],
    users: ["실무자"],
    buyers: ["팀장"],
    price: "직접 입력 이용료",
    beforeAfterWorkflow: { before: ["수작업 집계"], after: ["자동 집계"] },
    afterState: ["처리 시간 감소"],
    terms: { contract: ["월 계약"], renewal: ["자동 갱신"], cancellation: ["해지 조건 확인"] },
    support: ["이메일 지원"],
    trustEvidence: ["전문 인력"],
    securityEvidence: ["보안 정책 문서"],
    performanceEvidence: ["첨부 성과 자료"],
    adoptionBarriers: ["초기 설정 부담"],
  };
}

describe("subject analysis result contract", () => {
  it("accepts exactly three targets with two appeals each", () => {
    expect(parseSubjectAnalysisResult(result()).targets).toHaveLength(3);
  });
  it("rejects missing appeal coverage", () => {
    const value = result();
    delete (value.appealsByTarget as Record<string, unknown>).t3;
    expect(() => parseSubjectAnalysisResult(value)).toThrowError(SubjectAnalysisContractError);
  });
  it("rejects a public claim without HTTPS evidence", () => {
    const value = result();
    value.voc[0].sourceUrl = "http://example.com/voc";
    expect(() => parseSubjectAnalysisResult(value)).toThrow("subject_analysis_voc_source_invalid");
  });
  it("rejects duplicate target IDs", () => {
    const value = result();
    (value.targets[1] as { id: string }).id = "t1";
    expect(() => parseSubjectAnalysisResult(value)).toThrow("subject_analysis_target_id_duplicate");
  });
});

describe("subject analysis v2 result contract", () => {
  it("accepts a product profile with HTTPS and attachment evidence", () => {
    expect(parseSubjectAnalysisResultV2(resultV2(), context("product"))).toMatchObject({
      subjectType: "product",
      productProfile: { functions: [{ function: "정리" }] },
      serviceProfile: null,
      serviceSubtype: null,
    });
  });

  it("requires a product profile and rejects a mixed service profile", () => {
    expect(() => parseSubjectAnalysisResultV2({ ...resultV2(), productProfile: null }, context("product")))
      .toThrow("subject_analysis_product_profile_invalid");
    expect(() => parseSubjectAnalysisResultV2({ ...resultV2(), serviceProfile: serviceProfile() }, context("product")))
      .toThrow("subject_analysis_product_profile_invalid");
  });

  it.each<ServiceSubtype>([
    "saas",
    "consulting",
    "education",
    "agency",
    "subscription",
    "professional",
    "other_service",
  ])("accepts the %s service subtype with a service profile", (serviceSubtype) => {
    const value = {
      ...resultV2(),
      subjectType: "service" as const,
      productProfile: null,
      serviceProfile: serviceProfile(),
      serviceSubtype,
    };

    expect(parseSubjectAnalysisResultV2(value, context("service"))).toMatchObject({ subjectType: "service", serviceSubtype });
  });

  it("requires a service profile and rejects mixed or invalid service profiles", () => {
    const service = {
      ...resultV2(),
      subjectType: "service" as const,
      productProfile: null,
      serviceProfile: serviceProfile(),
      serviceSubtype: "consulting",
    };
    expect(() => parseSubjectAnalysisResultV2({ ...service, serviceProfile: null }, context("service")))
      .toThrow("subject_analysis_service_profile_invalid");
    expect(() => parseSubjectAnalysisResultV2({ ...service, productProfile: resultV2().productProfile }, context("service")))
      .toThrow("subject_analysis_service_profile_invalid");
    expect(() => parseSubjectAnalysisResultV2({ ...service, serviceSubtype: "software" }, context("service")))
      .toThrow("subject_analysis_service_subtype_invalid");
  });

  it("rejects evidence URLs outside HTTPS and attachment UUID schemes", () => {
    const httpEvidence = resultV2();
    httpEvidence.verifiedFacts[0].sourceUrl = "http://example.com/fact";
    expect(() => parseSubjectAnalysisResultV2(httpEvidence, context("product"))).toThrow("subject_analysis_source_url_invalid");

    const invalidAttachment = resultV2();
    invalidAttachment.barriers[0].sourceUrls[0] = "attachment://not-a-uuid";
    expect(() => parseSubjectAnalysisResultV2(invalidAttachment, context("product"))).toThrow("subject_analysis_source_url_invalid");
  });

  it("rejects incomplete, malformed, extra, and oversized product profile fields", () => {
    const incomplete = resultV2();
    delete (incomplete.productProfile as Partial<typeof incomplete.productProfile>).materials;
    expect(() => parseSubjectAnalysisResultV2(incomplete, context("product")))
      .toThrow("subject_analysis_product_profile_invalid");

    const malformed = resultV2();
    (malformed.productProfile.functions[0] as { benefit: unknown }).benefit = 42;
    expect(() => parseSubjectAnalysisResultV2(malformed, context("product")))
      .toThrow("subject_analysis_product_profile_invalid");

    const extra = resultV2();
    (extra.productProfile as Record<string, unknown>).unknown = true;
    expect(() => parseSubjectAnalysisResultV2(extra, context("product")))
      .toThrow("subject_analysis_product_profile_invalid");

    const oversized = resultV2();
    oversized.productProfile.materials = Array.from({ length: 21 }, (_, index) => `소재 ${index}`);
    expect(() => parseSubjectAnalysisResultV2(oversized, context("product")))
      .toThrow("subject_analysis_product_profile_invalid");
  });

  it("rejects incomplete and malformed service profile fields", () => {
    const incomplete = {
      ...resultV2(),
      subjectType: "service" as const,
      productProfile: null,
      serviceProfile: serviceProfile(),
      serviceSubtype: "saas",
    };
    delete (incomplete.serviceProfile as Partial<typeof incomplete.serviceProfile>).securityEvidence;
    expect(() => parseSubjectAnalysisResultV2(incomplete, context("service")))
      .toThrow("subject_analysis_service_profile_invalid");

    const malformed = {
      ...resultV2(),
      subjectType: "service" as const,
      productProfile: null,
      serviceProfile: { ...serviceProfile(), beforeAfterWorkflow: { before: "수작업", after: ["자동화"] } },
      serviceSubtype: "saas",
    };
    expect(() => parseSubjectAnalysisResultV2(malformed, context("service")))
      .toThrow("subject_analysis_service_profile_invalid");
  });

  it("rejects a model subject type that differs from the parsing context", () => {
    expect(() => parseSubjectAnalysisResultV2(resultV2(), context("service")))
      .toThrow("subject_analysis_subject_type_mismatch");
  });

  it("rejects foreign attachment evidence and candidate attachment IDs", () => {
    const foreignEvidence = resultV2();
    foreignEvidence.verifiedFacts[0].sourceUrl = `attachment://${foreignAttachmentId}`;
    expect(() => parseSubjectAnalysisResultV2(foreignEvidence, context("product")))
      .toThrow("subject_analysis_attachment_not_allowed");

    const foreignCandidate = resultV2();
    foreignCandidate.productProfile.productImageCandidates[0].attachmentId = foreignAttachmentId;
    expect(() => parseSubjectAnalysisResultV2(foreignCandidate, context("product")))
      .toThrow("subject_analysis_attachment_not_allowed");

    const malformedCandidate = resultV2();
    malformedCandidate.productProfile.detailImageCandidates[0].attachmentId = "not-a-uuid";
    expect(() => parseSubjectAnalysisResultV2(malformedCandidate, context("product")))
      .toThrow("subject_analysis_product_profile_invalid");
  });
});
