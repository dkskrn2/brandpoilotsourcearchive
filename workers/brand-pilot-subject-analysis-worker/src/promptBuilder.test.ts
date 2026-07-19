import { describe, expect, it } from "vitest";
import { buildSubjectAnalysisPrompt } from "./promptBuilder.js";
import type { SubjectAnalysisJob } from "./contracts.js";

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
});
