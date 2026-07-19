import { describe, expect, it } from "vitest";
import { buildPrompt } from "./promptBuilder.js";

const job = {
  id: "j", generationId: "g", outputId: "o", workspaceId: "w", brandId: "b", jobType: "generate" as const,
  contentType: "card_news" as const, status: "processing" as const, leaseToken: "l",
  payload: {
    contractVersion: "content-generation-input.v2", contentType: "card_news", brandContext: { name: "브랜드" },
    subject: { facts: [{ claim: "검증된 사실" }], research: { claims: [{ sourceUrl: "https://research.example" }] }, selectedImages: [{ id: "img-1", url: "https://cdn.example/image.png", role: "product", altText: "제품" }] },
    message: { target: { id: "target-1", name: "초보 고객" }, appeal: { id: "appeal-1", targetId: "target-1", title: "검증된 장점" }, qualityBrief: { hook: "도움이 되는 훅" } },
    creativeDirection: { prompts: ["첫 번째 카드뉴스 지시"], brandColor: "#0057B8", selectedColor: "#0F766E", aspectRatio: "1:1", outputCount: 1 },
    references: [{ previewUrl: "https://cdn.example/reference.png" }], attachments: [{ role: "user_reference", url: "https://cdn.example/user.png" }],
  },
};

describe("card-news prompt", () => {
  it("reads the v2 subject snapshot and format rules", () => {
    const prompt = buildPrompt(job);
    expect(prompt).toContain("content-generation-input.v2");
    expect(prompt).toContain("subject.facts만 제품·서비스의 사실 근거");
    expect(prompt).toContain("subject.research는 출처가 포함된 시장 맥락");
    expect(prompt).toContain("타깃이나 소구점을 변경·추가하지 마세요");
    expect(prompt).toContain("선택된 제품·사용자 이미지를 반영");
    expect(prompt).toContain("#0F766E");
    expect(prompt).toContain("공개 웹 검색을 수행하지 마세요");
    expect(prompt).toContain("1장 이상 5장 이하");
    expect(prompt).toContain("정확히 5개");
    expect(prompt).toContain('"prompts": [\n      "첫 번째 카드뉴스 지시"');
  });

  it("rejects legacy payloads instead of fetching their URL", () => {
    expect(() => buildPrompt({ ...job, payload: { draft: { productUrl: "https://example.com" } } })).toThrow("content_generation_input_version_invalid");
  });

  it("rejects missing or mismatched target and appeal identifiers", () => {
    expect(() => buildPrompt({ ...job, payload: { ...job.payload, message: { ...job.payload.message, target: {} } } })).toThrow("content_generation_target_id_invalid");
    expect(() => buildPrompt({ ...job, payload: { ...job.payload, message: { ...job.payload.message, appeal: { id: "appeal-1", targetId: "other" } } } })).toThrow("content_generation_appeal_target_mismatch");
  });
});
