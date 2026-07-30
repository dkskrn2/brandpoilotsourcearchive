import { describe, expect, it } from "vitest";
import { buildSubjectAnalysisPrompt, buildSubjectPrompt } from "./promptBuilder.js";
import type { SubjectAnalysisJob, SubjectAnalysisJobV2, SubjectAppealJobV2 } from "./contracts.js";

const job = {
  analysisId: "a1", workerId: "w1", leaseToken: "l1", leaseExpiresAt: "2026-07-20T00:00:00Z", contractVersion: "subject-analysis.v1",
  brand: { name: "브랜드", primaryCategory: "생활", subcategories: ["정리"], brandColor: "파란색" },
  subject: { type: "product", sourceUrl: "https://example.com/product", manualInput: { name: "상품", promotion: "", description: "설명" } },
  extracted: { facts: [{ key: "name", value: "상품", sourceUrl: "https://example.com/product" }], structuredData: {}, imageCandidates: [] },
  researchPolicy: { publicWebSearch: true, allowedPurposes: ["voc", "alternatives", "market_context"], requireSourceUrl: true },
} satisfies SubjectAnalysisJob;

describe("subject analysis prompt", () => {
  it("restricts research and claims in Korean", () => {
    const prompt = buildSubjectAnalysisPrompt(job);
    expect(prompt).toContain("제품·서비스 사실은 extracted.facts와 extracted.structuredData");
    expect(prompt).toContain("공개 웹 검색은 VOC, 대안 비교, 시장 맥락에만");
    expect(prompt).toContain("타깃은 정확히 3개");
    expect(prompt).toContain("HTTPS 출처 URL");
    expect(prompt).toContain("근거 없는 가격, 효능, 후기");
    expect(prompt).not.toContain("타사 이미지를 다운로드");
    expect(prompt).toContain("subject-analysis-result.v1");
  });

  it("dispatches v1 without changing the legacy prompt", () => {
    const prompt = buildSubjectPrompt(job);
    expect(prompt).toBe(buildSubjectAnalysisPrompt(job));
    expect(prompt.split("\n")[0]).toBe("너는 Brand Pilot의 상품·서비스 분석 담당자다.");
  });

  it.each([
    [v2AnalysisJob("product"), "product-analysis.v2-ko"],
    [v2AnalysisJob("service"), "service-analysis.v2-ko"],
    [v2AppealJob("product"), "product-appeal.v2-ko"],
    [v2AppealJob("service"), "service-appeal.v2-ko"],
  ])("dispatches a v2 phase and subject type to %s", (value, version) => {
    expect(buildSubjectPrompt(value)).toContain(version);
  });
});

function v2AnalysisJob(type: "product" | "service"): SubjectAnalysisJobV2 {
  return {
    analysisId: "analysis-v2",
    workerId: "worker-1",
    leaseToken: "lease-v2",
    leaseExpiresAt: "2026-07-22T00:03:00.000Z",
    contractVersion: "subject-analysis.v2",
    phase: "analysis",
    brandContext: {},
    subject: {
      type,
      sourceUrl: `https://example.com/${type}`,
      attachmentIds: [],
      manualInput: { name: "대상", promotionOrTerms: "", description: "설명" },
    },
    extracted: { documents: [], images: [], sourcePage: null, sourceGaps: [] },
    sourcePriority: ["manual_input", "attachments", "source_url", "brand_context", "public_research"],
  };
}

function v2AppealJob(type: "product" | "service"): SubjectAppealJobV2 {
  const analysis = v2AnalysisJob(type);
  return {
    analysisId: analysis.analysisId,
    workerId: analysis.workerId,
    leaseToken: analysis.leaseToken,
    leaseExpiresAt: analysis.leaseExpiresAt,
    contractVersion: "subject-analysis.v2",
    phase: "appeal",
    brandContext: analysis.brandContext,
    subject: analysis.subject,
    analysisResult: {
      contractVersion: "subject-analysis-result.v2",
      phase: "analysis",
      subjectType: type,
      summary: "분석",
      verifiedFacts: [],
      voc: [],
      alternatives: [],
      barriers: [],
      productProfile: type === "product" ? {} as never : null,
      serviceProfile: type === "service" ? {} as never : null,
      serviceSubtype: type === "service" ? "other_service" : null,
      sourceGaps: [],
    },
    sourcePriority: analysis.sourcePriority,
  };
}
