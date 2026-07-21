import { describe, expect, it } from "vitest";
import type { ServiceSubtype } from "./contracts.js";
import { parseSubjectAnalysisResult, parseSubjectAnalysisResultV2, SubjectAnalysisContractError } from "./result.js";

const attachmentId = "123e4567-e89b-42d3-a456-426614174000";

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
    productProfile: { functions: [{ function: "정리", benefit: "시간 절약", purchaseReason: "반복 작업 감소" }] },
    serviceProfile: null,
    serviceSubtype: null,
    sourceGaps: [],
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
    expect(parseSubjectAnalysisResultV2(resultV2())).toMatchObject({
      subjectType: "product",
      productProfile: { functions: [{ function: "정리" }] },
      serviceProfile: null,
      serviceSubtype: null,
    });
  });

  it("requires a product profile and rejects a mixed service profile", () => {
    expect(() => parseSubjectAnalysisResultV2({ ...resultV2(), productProfile: null }))
      .toThrow("subject_analysis_product_profile_invalid");
    expect(() => parseSubjectAnalysisResultV2({ ...resultV2(), serviceProfile: { deliveryProcess: ["상담"] } }))
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
      serviceProfile: { deliveryProcess: ["진단", "수행", "지원"] },
      serviceSubtype,
    };

    expect(parseSubjectAnalysisResultV2(value)).toMatchObject({ subjectType: "service", serviceSubtype });
  });

  it("requires a service profile and rejects mixed or invalid service profiles", () => {
    const service = {
      ...resultV2(),
      subjectType: "service" as const,
      productProfile: null,
      serviceProfile: { deliveryProcess: ["상담"] },
      serviceSubtype: "consulting",
    };
    expect(() => parseSubjectAnalysisResultV2({ ...service, serviceProfile: null }))
      .toThrow("subject_analysis_service_profile_invalid");
    expect(() => parseSubjectAnalysisResultV2({ ...service, productProfile: { features: ["기능"] } }))
      .toThrow("subject_analysis_service_profile_invalid");
    expect(() => parseSubjectAnalysisResultV2({ ...service, serviceSubtype: "software" }))
      .toThrow("subject_analysis_service_subtype_invalid");
  });

  it("rejects evidence URLs outside HTTPS and attachment UUID schemes", () => {
    const httpEvidence = resultV2();
    httpEvidence.verifiedFacts[0].sourceUrl = "http://example.com/fact";
    expect(() => parseSubjectAnalysisResultV2(httpEvidence)).toThrow("subject_analysis_source_url_invalid");

    const invalidAttachment = resultV2();
    invalidAttachment.barriers[0].sourceUrls[0] = "attachment://not-a-uuid";
    expect(() => parseSubjectAnalysisResultV2(invalidAttachment)).toThrow("subject_analysis_source_url_invalid");
  });
});
