import { describe, expect, it } from "vitest";
import { buildPrompt } from "./promptBuilder.js";

const job = {
  id: "j", generationId: "g", outputId: "o", workspaceId: "w", brandId: "b", jobType: "generate" as const,
  contentType: "marketing" as const, status: "processing" as const, leaseToken: "l",
  payload: { contentGenerationInput: {
    contractVersion: "content-generation-input.v2", contentType: "marketing", brandContext: { name: "브랜드" },
    subject: { analysisId: "analysis-1", analysisVersion: 2, analysisContractVersion: "subject-analysis.v2", analysisResult: { subjectType: "product", productProfile: { name: "상세 제품 분석" }, serviceProfile: null, barriers: [{ text: "가격 우려" }] }, type: "product", sourceUrl: "https://example.com/product", facts: [{ claim: "검증된 사실" }], research: { claims: [{ sourceUrl: "https://research.example" }] }, selectedImages: [{ id: "img-1", url: "https://cdn.example/image.png", role: "product", altText: "제품" }] },
    message: { target: { id: "target-1" }, appeal: { id: "appeal-1", targetId: "target-1" }, qualityBrief: { specificClaims: ["근거"] } },
    creativeDirection: { prompts: ["첫 번째 광고 지시", "두 번째 광고 지시"], brandColor: "#0057B8", selectedColor: "#0F766E", aspectRatio: "1:1", outputCount: 2 },
    references: [{ mediaUrl: "https://cdn.example/reference.png" }], attachments: [{ role: "user_reference", url: "https://cdn.example/user.png" }],
  } },
};

describe("marketing prompt", () => {
  it("requires independent grounded ads for each requested output", () => {
    const prompt = buildPrompt(job);
    expect(prompt).toContain("content-generation-input.v2");
    expect(prompt).toContain("상세 제품 분석");
    expect(prompt).toContain('"analysisVersion": 2');
    expect(prompt).toContain("제품·서비스 프로필, subtype, 대안, 장벽과 VOC");
    expect(prompt).toContain("subject.facts만 제품·서비스의 사실 근거");
    expect(prompt).toContain("subject.research는 출처가 포함된 시장 맥락");
    expect(prompt).toContain("message.qualityBrief.sourceGaps");
    expect(prompt).toContain("타깃이나 소구점을 변경·추가하지 마세요");
    expect(prompt).toContain("독립된 광고 1개와 메시지 가설 1개");
    expect(prompt).toContain("#0F766E");
    expect(prompt).toContain("공개 웹 검색을 수행하지 마세요");
    expect(prompt).toContain("요청된 비율에 맞춰 처음부터 구성");
    expect(prompt).toContain('"prompts": [\n      "첫 번째 광고 지시",\n      "두 번째 광고 지시"');
  });

  it("rejects missing appeal identifiers and target mismatches", () => {
    const input = job.payload.contentGenerationInput;
    expect(() => buildPrompt({ ...job, payload: { contentGenerationInput: { ...input, message: { ...input.message, appeal: { targetId: "target-1" } } } } })).toThrow("content_generation_appeal_id_invalid");
    expect(() => buildPrompt({ ...job, payload: { contentGenerationInput: { ...input, message: { ...input.message, appeal: { id: "appeal-1", targetId: "other" } } } } })).toThrow("content_generation_appeal_target_mismatch");
  });
});
