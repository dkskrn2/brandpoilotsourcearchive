import { describe, expect, it } from "vitest";
import { buildPrompt } from "./promptBuilder.js";
import type { EditorialPlan } from "./editorialPlan.js";

const job = {
  id: "j", generationId: "g", outputId: "o", workspaceId: "w", brandId: "b", jobType: "generate" as const,
  contentType: "card_news" as const, status: "processing" as const, leaseToken: "l",
  payload: { contentGenerationInput: {
    contractVersion: "content-generation-input.v2", contentType: "card_news", brandContext: { name: "브랜드", context: { wiki: { pages: [{ title: "관련 없는 전체 Wiki", content: "최종 이미지 프롬프트에 포함되면 안 되는 긴 원문" }] } } },
    subject: { analysisId: "analysis-1", analysisVersion: 2, analysisContractVersion: "subject-analysis.v2", analysisResult: { subjectType: "product", productProfile: { name: "상세 제품 분석" }, serviceProfile: null, alternatives: [{ name: "대안 A" }] }, type: "product", sourceUrl: "https://example.com/product", facts: [{ claim: "검증된 사실" }], research: { claims: [{ sourceUrl: "https://research.example" }] }, selectedImages: [{ id: "img-1", url: "https://cdn.example/image.png", role: "product", altText: "제품" }] },
    message: { target: { id: "target-1", name: "초보 고객" }, appeal: { id: "appeal-1", targetId: "target-1", title: "검증된 장점" }, qualityBrief: { hook: "도움이 되는 훅" } },
    creativeDirection: { prompts: ["첫 번째 카드뉴스 지시"], brandColor: "#0057B8", selectedColor: "#0F766E", aspectRatio: "4:5", outputCount: 1 },
    references: [{ previewUrl: "https://cdn.example/reference.png" }], attachments: [{ role: "user_reference", url: "https://cdn.example/user.png" }],
  } },
};

describe("card-news prompt", () => {
  it("reads the v2 subject snapshot and format rules", () => {
    const plan: EditorialPlan = {
      version: "editorial-plan.v1", intent: "information", singleSubject: "검증된 주제", readerQuestion: "무엇인가?", corePromise: "도움을 줍니다.",
      slides: [{ index: 1, role: "fact", headline: "검증된 제목", keyMessage: "검증된 내용", evidenceIds: ["subject-1"] }],
      cta: null, excludedTopics: [], referenceUses: [],
    };
    const prompt = buildPrompt(job, plan);
    expect(prompt).toContain("editorial-plan.v1");
    expect(prompt).toContain("role은 내부 편집 메타데이터");
    expect(prompt).toContain("검증된 제목");
    expect(prompt).toContain("상세 제품 분석");
    expect(prompt).toContain('"analysisVersion": 2');
    expect(prompt).toContain("제품·서비스 프로필, subtype, 대안, 장벽과 VOC");
    expect(prompt).not.toContain("content-generation-input.v2 봉투만 입력");
    expect(prompt).not.toContain("subject.research");
    expect(prompt).not.toContain("최종 이미지 프롬프트에 포함되면 안 되는 긴 원문");
    expect(prompt).not.toContain("https://cdn.example/reference.png");
    expect(prompt).toContain("선택된 제품·사용자 이미지를 반영");
    expect(prompt).toContain("#0F766E");
    expect(prompt).toContain("공개 웹 검색을 수행하지 마세요");
    expect(prompt).toContain("정확히 1장");
    expect(prompt).toContain("선택한 4:5 비율");
    expect(prompt).toContain("정확히 5개");
    expect(prompt).toContain("image_generation 도구로 최종 슬라이드 이미지를 직접 생성");
    expect(prompt).toContain("HTML, SVG, Canvas, 브라우저 스크린샷");
    expect(prompt).toContain("최종 슬라이드를 프로그램 방식으로 조립하거나 렌더링하지 마세요");
    expect(prompt).toContain("첫 번째 카드뉴스 지시");
  });

  it("rejects legacy payloads instead of fetching their URL", () => {
    expect(() => buildPrompt({ ...job, payload: { draft: { productUrl: "https://example.com" } } }, {} as EditorialPlan)).toThrow("content_generation_input_invalid");
  });

  it("rejects missing or mismatched target and appeal identifiers", () => {
    const input = job.payload.contentGenerationInput;
    expect(() => buildPrompt({ ...job, payload: { contentGenerationInput: { ...input, message: { ...input.message, target: {} } } } }, {} as EditorialPlan)).toThrow("content_generation_target_id_invalid");
    expect(() => buildPrompt({
      ...job,
      payload: { contentGenerationInput: { ...input, message: { ...input.message, appeal: { id: "appeal-1", targetId: "other" } } } },
    }, {} as EditorialPlan)).toThrow("content_generation_appeal_target_mismatch");
  });

  it("uses the selected color when the brand color is not configured", () => {
    const input = job.payload.contentGenerationInput;
    const plan: EditorialPlan = { version: "editorial-plan.v1", intent: "information", singleSubject: "주제", readerQuestion: "질문", corePromise: "약속", slides: [{ index: 1, role: "fact", headline: "제목", keyMessage: "내용", evidenceIds: [] }], cta: null, excludedTopics: [], referenceUses: [] };
    expect(buildPrompt({ ...job, payload: { contentGenerationInput: { ...input, creativeDirection: { ...input.creativeDirection, brandColor: "" } } } }, plan)).toContain("#0F766E");
  });
});
