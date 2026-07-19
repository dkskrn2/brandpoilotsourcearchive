import { describe, expect, it } from "vitest";
import { parseSubjectAnalysisResult, SubjectAnalysisContractError } from "./result.js";

function result() {
  const target = (id: string) => ({ id, name: id, traits: ["특성"], painPoints: ["문제"], purchaseMotivations: ["동기"], uspEvidence: [{ claim: "근거", support: "설명", sourceUrl: "https://example.com/product" }] });
  const appeal = (id: string, targetId: string) => ({ id, targetId, title: id, description: "설명", evidenceType: "product_fact" as const, connectionReason: "연결", sources: [{ title: "상품 페이지", url: "https://example.com/product" }] });
  return { contractVersion: "subject-analysis-result.v1" as const, summary: "요약", needs: [{ text: "필요", sourceUrl: "https://example.com/voc" }], alternatives: [{ name: "대안", strengths: ["장점"], limitations: ["한계"], sourceUrls: ["https://example.com/alternative"] }], voc: [{ quoteSummary: "표현", context: "맥락", sourceUrl: "https://example.com/voc" }], usps: [{ claim: "주장", support: "근거", sourceUrl: "https://example.com/product" }], targets: [target("t1"), target("t2"), target("t3")] as never, appealsByTarget: { t1: [appeal("a1", "t1"), appeal("a2", "t1")], t2: [appeal("a3", "t2"), appeal("a4", "t2")], t3: [appeal("a5", "t3"), appeal("a6", "t3")] }, recommendedImageId: null, sourceGaps: [] };
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
