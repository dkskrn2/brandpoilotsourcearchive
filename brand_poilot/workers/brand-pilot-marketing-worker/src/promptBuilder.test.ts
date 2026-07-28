import { describe, expect, it } from "vitest";
import { buildPrompt } from "./promptBuilder.js";
import { parseContentGenerationInput } from "./contracts.js";

const job = {
  id: "j", generationId: "g", outputId: "o", workspaceId: "w", brandId: "b", jobType: "generate" as const,
  contentType: "marketing" as const, status: "processing" as const, leaseToken: "l",
  payload: { contentGenerationInput: {
    contractVersion: "content-generation-input.v2", contentType: "marketing", brandContext: { name: "브랜드" },
    subject: { analysisId: "analysis-1", analysisVersion: 2, analysisContractVersion: "subject-analysis.v2", analysisResult: { subjectType: "product", productProfile: { name: "상세 제품 분석" }, serviceProfile: null, barriers: [{ text: "가격 우려" }] }, type: "product", sourceUrl: "https://example.com/product", facts: [{ claim: "검증된 사실" }], research: { claims: [{ sourceUrl: "https://research.example" }] }, selectedImages: [{ id: "img-1", url: "https://cdn.example/image.png", role: "product", altText: "제품" }] },
    message: { target: { id: "target-1" }, appeal: { id: "appeal-1", targetId: "target-1" }, qualityBrief: { specificClaims: ["근거"] } },
    creativeDirection: { prompts: ["첫 번째 광고 지시", "두 번째 광고 지시"], brandColor: "#0057B8", selectedColor: "#0F766E", aspectRatio: "1:1", outputCount: 2 },
    references: [{ mediaUrl: "https://cdn.example/reference.png" }], attachments: [],
  } },
};

describe("marketing prompt", () => {
  it("carries copy-only revision constraints into the prompt", () => {
    const prompt = buildPrompt({
      ...job,
      payload: {
        ...job.payload,
        revision: {
          contractVersion: "ai-content-revision.v1",
          action: "regenerate_copy",
          idempotencyKey: "revision-copy-1",
          cardIndex: null,
          previousManifest: { type: "marketing", assets: [{ index: 1 }] },
          previousContent: { headline: "기존 헤드라인" },
        },
      },
    });

    expect(prompt).toContain("부분 재생성 계약");
    expect(prompt).toContain("카피만");
  });

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

  it("rejects attachment snapshots with missing structural fields", () => {
    const input = job.payload.contentGenerationInput;
    expect(() => parseContentGenerationInput({
      ...input,
      attachments: [{ id: "attachment-1" }],
    })).toThrow("content_generation_attachment_invalid");
  });

  it("uses marketing orchestration priority and a visual-only avatar for a single image", () => {
    const input = job.payload.contentGenerationInput;
    const prompt = buildPrompt({
      ...job,
      payload: {
        contentGenerationInput: {
          ...input,
          orchestration: {
            contractVersion: "content-orchestration.v1",
            contentFamily: "marketing",
            subject: { mode: "product_service", productServiceId: "product-1" },
            target: { id: "target-1", snapshot: { name: "구매 고려 고객" } },
            strategy: "benefit",
            outputFormat: "single_image",
            channelTargets: ["instagram"],
            brief: { goal: "검증된 효익 전달" },
            references: [{ referenceItemId: "reference-1", roles: ["visual_composition"] }],
            avatar: {
              mode: "library",
              id: "avatar-1",
              snapshot: { assetUrl: "https://cdn.example/avatar.png" },
            },
          },
          creativeDirection: {
            ...input.creativeDirection,
            contentFamily: "marketing",
            outputFormat: "single_image",
          },
        },
      },
    });
    expect(prompt).toContain("승인 Brand Core와 실행 규칙");
    expect(prompt).toContain("사용자가 확정한 target, strategy, brief");
    expect(prompt).toContain("효익·신뢰·CTA 톤");
    expect(prompt).toContain("원문 문장을 그대로 복제하지 마세요");
    const promptData = JSON.parse(prompt.split("작업 데이터(JSON):\n")[1]!);
    expect(promptData.visualDirection.avatar.snapshot.assetUrl).toBe("https://cdn.example/avatar.png");
    expect(promptData.factualDirection).not.toHaveProperty("avatar");
  });

  it("requires a text-only artifact and omits avatar visual input for channel text", () => {
    const input = job.payload.contentGenerationInput;
    const prompt = buildPrompt({
      ...job,
      payload: {
        contentGenerationInput: {
          ...input,
          orchestration: {
            contractVersion: "content-orchestration.v1",
            contentFamily: "marketing",
            subject: { mode: "product_service", productServiceId: "product-1" },
            target: { id: "target-1", snapshot: { name: "구매 고려 고객" } },
            strategy: "cta",
            outputFormat: "channel_text",
            channelTargets: ["threads"],
            brief: { goal: "행동 유도" },
            references: [],
            avatar: {
              mode: "library",
              id: "avatar-1",
              snapshot: { assetUrl: "https://cdn.example/avatar.png" },
            },
          },
          creativeDirection: {
            ...input.creativeDirection,
            contentFamily: "marketing",
            outputFormat: "channel_text",
          },
        },
      },
    });
    expect(prompt).toContain("channel-text.txt");
    expect(prompt).toContain("이미지를 생성하지 마세요");
    expect(prompt).not.toContain("creative.png는 정확히");
    const promptData = JSON.parse(prompt.split("작업 데이터(JSON):\n")[1]!);
    expect(promptData).not.toHaveProperty("visualDirection");
    expect(JSON.stringify(promptData)).not.toContain("avatar.png");
  });
});
