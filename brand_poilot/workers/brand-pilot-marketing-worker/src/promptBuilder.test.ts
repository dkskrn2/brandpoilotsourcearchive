import { describe, expect, it } from "vitest";
import { buildMarketingPlanPrompt, buildPrompt } from "./promptBuilder.js";
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

const uid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const timestamp = "2026-07-31T00:00:00.000Z";
function v3Input(purpose: "informational" | "marketing", outputFormat: "reel" | "marketing_content") {
  const product = purpose === "marketing" ? {
    id: uid(2), versionId: uid(3), kind: "product", name: "Tea", description: "Green tea",
    features: ["Fresh leaves"], benefits: ["Calm focus"], cautions: ["Contains caffeine"], evergreenPurchaseInfo: "Online", images: [],
  } : null;
  return {
    contractVersion: "content-generation-input.v3" as const, generationId: uid(10), capturedAt: timestamp,
    brandCore: { versionId: uid(1), companyOverview: "Company", businessDescription: "Business", primaryCategory: "Food", detailedCategory: "Tea", primaryTarget: "Adults", differentiator: "Fresh", coreAppeal: "Calm" },
    subject: { kind: "topic_text" as const, title: "Tea guide" }, contentInstruction: "전체 카피를 실용적으로 작성", product,
    researchEvidence: purpose === "informational"
      ? { contractVersion: "research-evidence.v1" as const, decision: "searched" as const, reason: "Current facts", queries: ["tea"], capturedAt: timestamp, items: [{ id: uid(7), title: "Study", url: "https://evidence.example/study", publisher: null, publishedAt: null, capturedAt: timestamp, claimSummary: "Warm water", contentHash: "a".repeat(64) }] }
      : { contractVersion: "research-evidence.v1" as const, decision: "not_needed" as const, reason: "Fixed product", queries: [], capturedAt: timestamp, items: [] },
    references: { selected: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [] },
    selectedProposal: {
      id: uid(9), conceptKey: "tea", title: "Tea", informationalType: purpose === "informational" ? "how_to" as const : null,
      oneLineIntent: "Explain", differentiator: "Simple", differentiationAxes: ["question" as const], target: "Adults", customerContext: "Choosing",
      keyMessage: "Brew well", hook: "Better tea", selectionReason: "Useful", evidenceIds: purpose === "informational" ? [uid(7)] : [], referenceIds: [],
      outputFormat, channelTargets: ["instagram" as const], assetCount: 2,
      outline: [{ index: 1, role: "hook", headline: "Start", purpose: "Open" }, { index: 2, role: "detail", headline: "Steps", purpose: "Explain" }],
      purposeDetails: purpose === "informational"
        ? { kind: "informational" as const, question: "How?", value: "Guidance", whyNow: "Now", learningPoints: ["Step"] }
        : { kind: "marketing" as const, campaignObjective: "Conversion", situationAndNeed: "Afternoon focus", productId: uid(2), targetSegment: "Office workers", strengths: ["Fresh leaves"], limitations: ["Contains caffeine"], appeal: "Calm focus", buyingBarriers: ["Price"], cta: "Buy now" },
    },
    userImageInstruction: "모든 이미지에 부드러운 자연광 적용",
    outputSettings: { purpose, outputFormat, channelTargets: ["instagram" as const], aspectRatio: outputFormat === "reel" ? "9:16" as const : "4:5" as const, outputCount: 1 as const },
  };
}

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
    expect(prompt).toContain("승인 Brand Core");
    expect(prompt).toContain("승인 제품·서비스");
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

  it("builds an informational reel plan from frozen evidence without product sales language", () => {
    const input = v3Input("informational", "reel");
    const prompt = buildMarketingPlanPrompt({ ...job, generationId: input.generationId }, input);
    expect(prompt).toContain("marketing-plan.v2");
    expect(prompt).toContain("정보 제공, 인지도, 참여");
    expect(prompt).toContain("제품을 언급하거나 판매 CTA");
    expect(prompt).toContain("researchEvidence");
    expect(prompt).toContain("9:16");
    expect(prompt).toContain("vertical visualDirection");
    expect(prompt).toContain("장면 copy");
    expect(prompt).toContain("정확히 2");
    expect(prompt).toContain("장수를 다시 판단");
  });

  it("builds a marketing-content plan using only the fixed product for product facts", () => {
    const input = v3Input("marketing", "marketing_content");
    const prompt = buildMarketingPlanPrompt({ ...job, generationId: input.generationId }, input);
    for (const phrase of ["목적", "상황", "니즈", "제품 분석", "장점", "한계", "target segment", "appeal", "barrier", "CTA"]) {
      expect(prompt).toContain(phrase);
    }
    expect(prompt).toContain("제품 사실은 고정 product 스냅샷만");
    expect(prompt).toContain("시장 검색 근거로 제품 사실을 보강");
    expect(prompt).toContain("channel copy");
  });

  it("keeps content and common image instructions separate and forbids unsupported context", () => {
    const input = v3Input("marketing", "reel");
    const prompt = buildMarketingPlanPrompt({ ...job, generationId: input.generationId }, input, "marketing_plan_invalid:asset_count_mismatch");
    expect(prompt).toContain("contentInstruction은 전체 카피");
    expect(prompt).toContain("userImageInstruction은 모든 생성 이미지의 공통 시각 지시");
    expect(prompt).toContain("Wiki");
    expect(prompt).toContain("FAQ");
    expect(prompt).toContain("색상, 폰트, 메모");
    expect(prompt).toContain("로고");
    expect(prompt).toContain("부실하지 않게");
    expect(prompt).toContain("과밀");
    expect(prompt).toContain("보정 기회는 이번 한 번뿐");
    const fixed = JSON.parse(prompt.split("고정 입력(JSON):\n")[1]!);
    expect(fixed.contentInstruction).toBe("전체 카피를 실용적으로 작성");
    expect(fixed.userImageInstruction).toBe("모든 이미지에 부드러운 자연광 적용");
    expect(fixed.logoPolicy).toEqual({ allowGeneratedLogo: false, allowReservedLogoArea: false, allowExternalReferenceLogo: false, allowExistingProductPackagingLogo: true });
  });
});
