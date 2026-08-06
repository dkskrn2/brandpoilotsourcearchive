import { describe, expect, it } from "vitest";
import { buildCardNewsPlanPrompt, buildPrompt } from "./promptBuilder.js";
import { parseContentGenerationInput } from "./contracts.js";
import type { EditorialPlan } from "./editorialPlan.js";
import type { ContentGenerationInputV3 } from "@brand-pilot/worker-runtime";

const job = {
  id: "j", generationId: "g", outputId: "o", workspaceId: "w", brandId: "b", jobType: "generate" as const,
  contentType: "card_news" as const, status: "processing" as const, leaseToken: "l",
  payload: { contentGenerationInput: {
    contractVersion: "content-generation-input.v2", contentType: "card_news", brandContext: { name: "브랜드", context: { wiki: { pages: [{ title: "관련 없는 전체 Wiki", content: "최종 이미지 프롬프트에 포함되면 안 되는 긴 원문" }] } } },
    subject: { analysisId: "analysis-1", analysisVersion: 2, analysisContractVersion: "subject-analysis.v2", analysisResult: { subjectType: "product", productProfile: { name: "상세 제품 분석" }, serviceProfile: null, alternatives: [{ name: "대안 A" }] }, type: "product", sourceUrl: "https://example.com/product", facts: [{ claim: "검증된 사실" }], research: { claims: [{ sourceUrl: "https://research.example" }] }, selectedImages: [{ id: "img-1", url: "https://cdn.example/image.png", role: "product", altText: "제품" }] },
    message: { target: { id: "target-1", name: "초보 고객" }, appeal: { id: "appeal-1", targetId: "target-1", title: "검증된 장점" }, qualityBrief: { hook: "도움이 되는 훅" } },
    creativeDirection: { prompts: ["첫 번째 카드뉴스 지시"], brandColor: "#0057B8", selectedColor: "#0F766E", aspectRatio: "4:5", outputCount: 1 },
    references: [{ previewUrl: "https://cdn.example/reference.png" }], attachments: [],
  } },
};

describe("card-news prompt", () => {
  it("carries the individual-card revision contract into the generation prompt", () => {
    const plan: EditorialPlan = {
      version: "editorial-plan.v1",
      intent: "information",
      singleSubject: "검증된 주제",
      readerQuestion: "무엇인가?",
      corePromise: "도움을 줍니다.",
      slides: [
        { index: 1, role: "fact", headline: "첫 카드", keyMessage: "첫 내용", evidenceIds: ["subject-1"] },
        { index: 2, role: "fact", headline: "둘째 카드", keyMessage: "둘째 내용", evidenceIds: ["subject-1"] },
      ],
      cta: null,
      excludedTopics: [],
      referenceUses: [],
    };
    const prompt = buildPrompt({
      ...job,
      payload: {
        ...job.payload,
        revision: {
          contractVersion: "ai-content-revision.v1",
          action: "regenerate_card",
          idempotencyKey: "revision-card-2",
          cardIndex: 2,
          previousManifest: { type: "card_news", assets: [{ index: 1 }, { index: 2 }] },
          previousContent: { caption: "기존 카피" },
        },
      },
    }, plan);

    expect(prompt).toContain("부분 재생성 계약");
    expect(prompt).toContain("2번 카드만");
    expect(prompt).toContain("나머지 카드");
  });

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

  it("rejects attachment snapshots with missing structural fields", () => {
    const input = job.payload.contentGenerationInput;
    expect(() => parseContentGenerationInput({
      ...input,
      attachments: [{ id: "attachment-1" }],
    })).toThrow("content_generation_attachment_invalid");
  });

  it("uses informational orchestration with the fixed trust priority and visual-only avatar", () => {
    const input = job.payload.contentGenerationInput;
    const orchestratedJob = {
      ...job,
      payload: {
        contentGenerationInput: {
          ...input,
          orchestration: {
            contractVersion: "content-orchestration.v1",
            contentFamily: "informational",
            subject: { mode: "brand_topic", topic: "사용법" },
            target: { id: "target-1", snapshot: { name: "초보 고객" } },
            strategy: "how_to",
            outputFormat: "card_news",
            channelTargets: ["instagram"],
            brief: { goal: "문제를 해결하는 가이드" },
            references: [{ referenceItemId: "reference-1", roles: ["visual_composition"] }],
            avatar: {
              mode: "library",
              id: "avatar-1",
              snapshot: { assetUrl: "https://cdn.example/avatar.png" },
            },
          },
          creativeDirection: {
            ...input.creativeDirection,
            contentFamily: "informational",
            outputFormat: "card_news",
          },
        },
      },
    };
    const plan: EditorialPlan = {
      version: "editorial-plan.v1",
      intent: "information",
      singleSubject: "사용법",
      readerQuestion: "어떻게 쓰나요?",
      corePromise: "쉽게 이해합니다.",
      slides: [{ index: 1, role: "fact", headline: "사용법", keyMessage: "검증된 설명", evidenceIds: [] }],
      cta: null,
      excludedTopics: [],
      referenceUses: [],
    };
    const prompt = buildPrompt(orchestratedJob, plan);
    expect(prompt).toContain("승인 Brand Core");
    expect(prompt).toContain("승인 제품·서비스");
    expect(prompt).toContain("사용자가 확정한 target, strategy, brief");
    expect(prompt).toContain("선택 레퍼런스의 패턴 영감");
    expect(prompt).toContain("교육·문제 해결·가이드 톤");
    expect(prompt).toContain("원문 문장을 그대로 복제하지 마세요");
    const promptData = JSON.parse(prompt.split("작업 데이터(JSON):\n")[1]!);
    expect(promptData.visualDirection.avatar.snapshot.assetUrl).toBe("https://cdn.example/avatar.png");
    expect(promptData.factualDirection).not.toHaveProperty("avatar");
  });

  it("builds a network-free v3 planning prompt from only sealed inputs and keeps image instructions visual-only", () => {
    const uid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
    const reference = { referenceItemId: uid(5), snapshotId: uid(6), roles: ["copy_pattern", "visual_composition"] as const, title: "Editorial reference", sourceUrl: "https://reference.example/editorial", capturedAt: "2026-07-31T00:00:00.000Z", contentHash: "b".repeat(64), text: "Short copy and calm hierarchy", image: null };
    const style = { referenceItemId: uid(5), description: "Uploaded soft editorial image", tags: ["calm"], storageUrl: "https://cdn.example/style.webp", storagePath: "owned/style.webp", mimeType: "image/webp" as const, checksum: "a".repeat(64) };
    const attachment = { id: uid(8), role: "supporting_image" as const, fileName: "tea.webp", mimeType: "image/webp" as const, sizeBytes: 100, checksum: "d".repeat(64), storageUrl: "https://cdn.example/attachment.webp", storagePath: "owned/attachment.webp" };
    const product = { id: uid(2), versionId: uid(3), kind: "product" as const, name: "Tea", description: "Green tea", features: ["Fresh leaves"], benefits: ["Calm focus"], cautions: ["Contains caffeine"], evergreenPurchaseInfo: "Available online", images: [{ assetId: uid(4), role: "hero" as const, storageUrl: "https://cdn.example/product.webp", storagePath: "owned/product.webp", mimeType: "image/webp", checksum: "e".repeat(64) }] };
    const input: ContentGenerationInputV3 = {
      contractVersion: "content-generation-input.v3", generationId: uid(10), capturedAt: "2026-07-31T00:00:00.000Z",
      brandCore: { versionId: uid(1), companyOverview: "Company", businessDescription: "Business", primaryCategory: "Food", detailedCategory: "Tea", primaryTarget: "Office workers", differentiator: "Fresh", coreAppeal: "Calm" },
      brandRules: { versionId: uid(11), version: 1, content: { contractVersion: "brand-rules.v1", requiredPhrases: [], forbiddenPhrases: [], exaggerationRules: [], ctaRules: { defaultCta: "", allowed: [] }, channelRules: {}, designRules: { colors: [], fonts: [], notes: [], referenceImages: [] }, autoApprovalRules: { enabled: false, conditions: [] } }, contentSha256: "67b61ecaeab23a876527fa4148e4046c2721084306d79b60bfec4f96956ba84b" },
      subject: { kind: "topic_text", title: "Afternoon tea" }, contentInstruction: "Use concise practical copy", product,
      researchEvidence: { contractVersion: "research-evidence.v1", decision: "not_needed", reason: "Product facts suffice", queries: [], capturedAt: "2026-07-31T00:00:00.000Z", items: [] },
      references: { selected: [reference], brandStyleImages: [style], avatarStyleImageId: uid(5), attachments: [attachment] },
      selectedProposal: {
        id: uid(9), conceptKey: "tea-offer", title: "Tea offer", informationalType: null, oneLineIntent: "Introduce tea", differentiator: "Afternoon focus", differentiationAxes: ["situation"], target: "Office workers", customerContext: "Afternoon fatigue", keyMessage: "Choose a calm break", hook: "Need a pause?", selectionReason: "Relevant", evidenceIds: [], referenceIds: [uid(5)], outputFormat: "card_news", channelTargets: ["instagram"], assetCount: 2,
        outline: [{ index: 1, role: "hook", headline: "Pause", purpose: "Open" }, { index: 2, role: "benefit", headline: "Fresh tea", purpose: "Explain" }],
        purposeDetails: { kind: "marketing", campaignObjective: "Sales", situationAndNeed: "Afternoon focus", productId: uid(2), targetSegment: "Office workers", strengths: ["Fresh leaves"], limitations: ["Contains caffeine"], appeal: "Calm focus", buyingBarriers: ["Price"], cta: "Buy now" },
      },
      userImageInstruction: "Soft natural light for every image",
      outputSettings: { purpose: "marketing", outputFormat: "card_news", channelTargets: ["instagram"], aspectRatio: "1:1", outputCount: 1 },
    };
    const prompt = buildCardNewsPlanPrompt({ ...job, generationId: input.generationId }, input);
    expect(prompt).toContain("card-news-plan.v2");
    expect(prompt).toContain("마케팅성 카드뉴스");
    expect(buildCardNewsPlanPrompt(
      { ...job, generationId: input.generationId },
      { ...input, outputSettings: { ...input.outputSettings, purpose: "informational" } },
    )).toContain("정보성 카드뉴스");
    expect(prompt).toContain("gpt-image-2");
    expect(prompt).toContain("1:1");
    expect(prompt).not.toContain("1080×1080");
    expect(prompt).toContain("정확히 2장");
    expect(prompt).toContain("index, role, order");
    expect(prompt).toContain("한 장이 부실하지 않게");
    expect(prompt).toContain("모바일 가독성");
    expect(prompt).toContain("contentInstruction");
    expect(prompt).toContain("userImageInstruction은 모든 생성 이미지의 공통 시각 지시");
    expect(prompt).toContain("카피 사실이나 근거로 사용하지 마세요");
    expect(prompt).toContain("제품 사실은 product 스냅샷 안에서만");
    expect(prompt).toContain("evidenceIds");
    expect(prompt).toContain("ID를 발명하지 마세요");
    expect(prompt).toContain("제품 사실에는 research evidence ID를 발명하지 마세요");
    expect(prompt).toContain("파일, 웹, shell, image_generation 도구를 호출하지 마세요");
    const promptData = JSON.parse(prompt.split("고정 입력(JSON):\n")[1]!);
    expect(promptData).toMatchObject({
      brandCore: input.brandCore,
      brandRules: input.brandRules,
      product,
      references: input.references,
      selectedProposal: input.selectedProposal,
      userImageInstruction: input.userImageInstruction,
    });
    expect(promptData.brandRules).toEqual(input.brandRules);
    expect(prompt).toContain("requiredPhrases");
    expect(JSON.stringify(promptData)).not.toMatch(/wiki|faq/i);
    expect(promptData.logoPolicy).toEqual({ allowGeneratedLogo: false, allowReservedLogoArea: false, allowExternalReferenceLogo: false, allowExistingProductPackagingLogo: true });

    const repair = buildCardNewsPlanPrompt({ ...job, generationId: input.generationId }, input, "card_news_plan_invalid:index mismatch");
    expect(repair).toContain("card_news_plan_invalid:index mismatch");
    expect(repair).toContain("보정 기회는 이번 한 번뿐");
  });
});
