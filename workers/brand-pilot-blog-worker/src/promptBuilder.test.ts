import { describe, expect, it } from "vitest";
import { buildPrompt } from "./promptBuilder.js";

const job = {
  id: "j", generationId: "g", outputId: "o", workspaceId: "w", brandId: "b", jobType: "generate" as const,
  contentType: "blog" as const, status: "processing" as const, leaseToken: "l",
  payload: { contentGenerationInput: {
    contractVersion: "content-generation-input.v2", contentType: "blog", brandContext: { name: "브랜드" },
    subject: { analysisId: "analysis-1", analysisVersion: 2, analysisContractVersion: "subject-analysis.v2", analysisResult: { subjectType: "service", serviceSubtype: "saas", serviceProfile: { customerProblem: ["수동 처리"] }, productProfile: null }, type: "service", sourceUrl: "https://example.com/service", facts: [{ claim: "검증된 사실" }], research: { claims: [{ sourceUrl: "https://research.example" }] }, selectedImages: [{ id: "img-1", url: "https://cdn.example/image.png", role: "product", altText: "제품" }] },
    message: { target: { id: "target-1" }, appeal: { id: "appeal-1", targetId: "target-1" }, qualityBrief: { readerPayoff: "이해" } },
    creativeDirection: { prompts: ["첫 번째 블로그 지시"], brandColor: "#0057B8", selectedColor: "#0F766E", aspectRatio: "16:9", outputCount: 1 },
    references: [{ previewUrl: "https://cdn.example/reference.png" }], attachments: [],
  } },
};

describe("blog prompt", () => {
  it("requires v2 grounded semantic SEO writing", () => {
    const prompt = buildPrompt(job);
    expect(prompt).toContain("content-generation-input.v2");
    expect(prompt).toContain('"serviceSubtype": "saas"');
    expect(prompt).toContain('"analysisVersion": 2');
    expect(prompt).toContain("제품·서비스 프로필, subtype, 대안, 장벽과 VOC");
    expect(prompt).toContain("subject.facts만 제품·서비스의 사실 근거");
    expect(prompt).toContain("subject.research는 출처가 포함된 시장 맥락");
    expect(prompt).toContain("message.qualityBrief.sourceGaps");
    expect(prompt).toContain("message.target 1개와 message.appeal 1개");
    expect(prompt).toContain("creativeDirection.selectedColor");
    expect(prompt).toContain("공개 웹 검색을 수행하지 마세요");
    expect(prompt).toContain("semantic HTML");
    expect(prompt).toContain("0~5장");
    expect(prompt).toContain("설명해야 이해가 분명히 좋아지는 경우");
    expect(prompt).toContain('"prompts": [\n      "첫 번째 블로그 지시"');
  });

  it("rejects an appeal that does not belong to the selected target", () => {
    const input = job.payload.contentGenerationInput;
    expect(() => buildPrompt({ ...job, payload: { contentGenerationInput: { ...input, message: { ...input.message, appeal: { id: "appeal-1", targetId: "other" } } } } })).toThrow("content_generation_appeal_target_mismatch");
  });
});
