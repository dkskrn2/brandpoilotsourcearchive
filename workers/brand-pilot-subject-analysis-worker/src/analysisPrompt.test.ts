import { describe, expect, it } from "vitest";
import type { SubjectAnalysisJobV2 } from "./contracts.js";
import { buildProductAnalysisPrompt } from "./productAnalysisPrompt.js";
import { buildServiceAnalysisPrompt } from "./serviceAnalysisPrompt.js";

const attachmentId = "123e4567-e89b-42d3-a456-426614174000";

function job(type: "product" | "service"): SubjectAnalysisJobV2 {
  return {
    analysisId: "analysis-1",
    workerId: "worker-1",
    leaseToken: "lease-1",
    leaseExpiresAt: "2026-07-22T00:03:00.000Z",
    contractVersion: "subject-analysis.v2",
    phase: "analysis",
    brandContext: { name: "브랜드", positioning: "실용성" },
    subject: {
      type,
      sourceUrl: `https://example.com/${type}`,
      attachmentIds: [attachmentId],
      manualInput: { name: "분석 대상", promotionOrTerms: "조건", description: "직접 설명" },
    },
    extracted: {
      documents: [{ attachmentId, fileName: "brief.pdf", mimeType: "application/pdf", text: "첨부 내용" }],
      images: [{
        attachmentId,
        sourceUrl: `attachment://${attachmentId}`,
        storageUrl: "https://blob.example.com/image.png",
        mimeType: "image/png",
        altText: "대상 이미지",
      }],
      sourcePage: {
        sourceUrl: `https://example.com/${type}`,
        title: "상세 페이지",
        text: "URL 추출 내용",
        structuredData: {},
      },
      sourceGaps: [],
    },
    sourcePriority: ["manual_input", "attachments", "source_url", "brand_context", "public_research"],
  };
}

describe("v2 analysis prompts", () => {
  it("builds the product analysis policy and structure", () => {
    const prompt = buildProductAnalysisPrompt(job("product"));

    expect(prompt).toContain("product-analysis.v2-ko");
    expect(prompt).toContain("기능 → 효익 → 구매 이유");
    expect(prompt).toContain("규격·소재·옵션·배송·환불·사용 상황·구매 장벽");
    expect(prompt).toContain("가격·할인·프로모션");
    expect(prompt).toContain("후기의 반복 만족·불만 패턴");
    expect(prompt).toContain("제품 이미지 후보와 상세 이미지 후보");
    for (const field of ["price", "discountsAndPromotions", "reviewPatterns", "productImageCandidates", "detailImageCandidates"]) {
      expect(prompt).toContain(`"${field}"`);
    }
    expect(prompt).toContain("직접 입력 > 첨부 > URL > 브랜드 > 공개 검색");
    expect(prompt).toContain("공개 웹 검색으로 가격·효능·성과·성능을 확정하지 않는다");
    expect(prompt).toContain("subject-analysis-result.v2");
    expect(prompt).toContain('"subjectType": "product"');
    expect(prompt).toContain('"promotionOrTerms": "조건"');
  });

  it("builds the service analysis policy, subtype classification, and subtype guidance", () => {
    const prompt = buildServiceAnalysisPrompt(job("service"));

    expect(prompt).toContain("service-analysis.v2-ko");
    expect(prompt).toContain("문제 → 제공 과정 → 이용 후 변화 → 신뢰·도입 부담");
    expect(prompt).toContain("사용자와 구매 결정권자");
    expect(prompt).toContain("계약·갱신·해지·지원·산출물·도입 장벽");
    expect(prompt).toContain("가격·이용 조건");
    expect(prompt).toContain("도입 전·후 업무 흐름");
    expect(prompt).toContain("보안·성과 신뢰 근거");
    for (const field of ["price", "beforeAfterWorkflow", "securityEvidence", "performanceEvidence"]) {
      expect(prompt).toContain(`"${field}"`);
    }
    for (const subtype of ["saas", "consulting", "education", "agency", "subscription", "professional", "other_service"]) {
      expect(prompt).toContain(subtype);
    }
    for (const guidance of ["진단 방법", "커리큘럼", "업무 범위", "반복 제공 가치", "자격·경력"]) {
      expect(prompt).toContain(guidance);
    }
    expect(prompt).toContain("비 SaaS 서비스를 SaaS 기능 목록처럼 분석하지 않는다");
    expect(prompt).toContain("직접 입력 > 첨부 > URL > 브랜드 > 공개 검색");
    expect(prompt).toContain('"subjectType": "service"');
  });
});
