import { cardDeckEditorialPlanSha256 } from "@brand-pilot/content-contracts/card-deck-editorial-plan/node";
import {
  compileReelStoryboardDraftV1,
  compileReelStoryboardSceneV1,
} from "@brand-pilot/content-contracts/reel-storyboard";
import { reelStoryboardSha256 } from "@brand-pilot/content-contracts/reel-storyboard/node";
import { compileStructuredScene } from "@brand-pilot/content-contracts/structured-scene-copy";

const uid = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (character: string) => character.repeat(64);

export function manualImageJobV2() {
  const product = {
    id: uid(8), versionId: uid(9), kind: "product", name: "차 제품", description: "차 제품 설명",
    features: ["간편함"], benefits: ["편리한 음용"], cautions: [], evergreenPurchaseInfo: "공식 판매처 확인",
    images: [{ assetId: uid(10), role: "hero", storageUrl: "https://owned.example/product.png", storagePath: "owned/product.png", mimeType: "image/png", checksum: sha("a") }],
  };
  const reference = {
    referenceItemId: uid(30), snapshotId: uid(31), roles: ["visual_composition"], title: "참고 이미지",
    sourceUrl: "https://external.example/source", capturedAt: "2026-07-31T00:00:00Z", contentHash: sha("c"),
    text: "동결된 참고 내용", image: { storageUrl: "https://owned.example/reference.png", storagePath: "owned/reference.png", mimeType: "image/png", checksum: sha("d") },
  };
  const style = {
    referenceItemId: uid(30), description: "브랜드 아바타", tags: ["avatar"], storageUrl: "https://owned.example/style.png",
    storagePath: "owned/style.png", mimeType: "image/png", checksum: sha("e"),
  };
  const attachments = [
    { id: uid(20), role: "supporting_image", fileName: "first unsafe name.png", mimeType: "image/png", sizeBytes: 10, checksum: sha("1"), storageUrl: "https://owned.example/attachment-one", storagePath: "owned/attachment-one" },
    { id: uid(21), role: "product_image", fileName: "../../second.jpg", mimeType: "image/jpeg", sizeBytes: 10, checksum: sha("2"), storageUrl: "https://owned.example/attachment-two", storagePath: "owned/attachment-two" },
    { id: uid(22), role: "visual_reference", fileName: "third.webp", mimeType: "image/webp", sizeBytes: 10, checksum: sha("3"), storageUrl: "https://owned.example/attachment-three", storagePath: "owned/attachment-three" },
  ];
  const imagePackage = {
    contractVersion: "image-generation-package.v1", generationId: uid(2), outputFormat: "card_news", purpose: "marketing",
    assetCount: 3, aspectRatio: "1:1", channelTargets: ["instagram"],
    assets: [
      { index: 1, role: "hook", copy: "첫 장면", visualDirection: "첫 장면 비주얼", evidenceIds: [], productImageAssetIds: [], attachmentIds: [] },
      { index: 2, role: "detail", copy: "두 번째 장면", visualDirection: "두 번째 장면 비주얼", evidenceIds: [], productImageAssetIds: [uid(10)], attachmentIds: [] },
      { index: 3, role: "close", copy: "마지막 장면", visualDirection: "마지막 장면 비주얼", evidenceIds: [], productImageAssetIds: [], attachmentIds: [] },
    ],
    product, references: [reference], brandStyleImages: [style], avatarStyleImageId: uid(30), attachments,
    userImageInstruction: "첨부 이미지는 선택적 시각 참고로 확인합니다.",
    logoPolicy: { allowGeneratedLogo: false, allowReservedLogoArea: false, allowExternalReferenceLogo: false, allowExistingProductPackagingLogo: true },
  };
  const contentGenerationInput = {
    contractVersion: "content-generation-input.v3", generationId: uid(2),
    brandCore: { versionId: uid(40), companyOverview: "차 브랜드", businessDescription: "차를 판매합니다.", primaryCategory: "Food", detailedCategory: "Tea", primaryTarget: "성인", differentiator: "간편함", coreAppeal: "차분함" },
    brandRules: {
      versionId: uid(41), version: 1,
      content: {
        contractVersion: "brand-rules.v1", requiredPhrases: [], forbiddenPhrases: [], exaggerationRules: [],
        ctaRules: { defaultCta: "", allowed: [] }, channelRules: {},
        designRules: { colors: [], fonts: [], notes: [], referenceImages: [] },
        autoApprovalRules: { enabled: false, conditions: [] },
      },
      contentSha256: sha("b"),
    },
    subject: { kind: "topic_text", title: "차를 고르는 법" }, contentInstruction: null, product,
    researchEvidence: { contractVersion: "research-evidence.v1", decision: "not_needed", reason: "고정 제품 정보 사용", queries: [], capturedAt: "2026-07-31T00:00:00Z", items: [] },
    references: { selected: [reference], brandStyleImages: [style], avatarStyleImageId: uid(30), attachments },
    selectedProposal: {
      id: uid(50), conceptKey: "tea-product", title: "차 제품 안내", informationalType: null,
      oneLineIntent: "제품을 명확히 소개합니다.", differentiator: "간편함", differentiationAxes: ["appeal"],
      target: "성인", customerContext: "차를 선택하는 상황", keyMessage: "간편하게 차를 즐기세요.", hook: "어떤 차를 고를까요?", selectionReason: "제품 맥락에 적합합니다.",
      evidenceIds: [], referenceIds: [uid(30)], outputFormat: "card_news", channelTargets: ["instagram"], assetCount: 3,
      outline: [
        { index: 1, role: "hook", headline: "첫 장면", purpose: "관심을 엽니다." },
        { index: 2, role: "detail", headline: "두 번째 장면", purpose: "제품을 설명합니다." },
        { index: 3, role: "close", headline: "마지막 장면", purpose: "행동을 안내합니다." },
      ],
      purposeDetails: { kind: "marketing", campaignObjective: "제품 인지도", situationAndNeed: "간편한 차가 필요한 상황", productId: uid(8), targetSegment: "성인", strengths: ["간편함"], limitations: [], appeal: "편리함", buyingBarriers: [], cta: "공식 정보를 확인하세요." },
    },
    userImageInstruction: "첨부 이미지는 선택적 시각 참고로 확인합니다.",
    outputSettings: { outputFormat: "card_news", channelTargets: ["instagram"], aspectRatio: "1:1", outputCount: 1, purpose: "marketing" },
    capturedAt: "2026-07-31T00:00:00Z",
  };
  const contentPlan = {
    contractVersion: "card-news-plan.v2",
    content: { caption: "차 제품을 소개합니다.", hashtags: ["#차"], cta: "공식 정보를 확인하세요." },
    imagePackage,
  };
  return {
    id: uid(1), generationId: uid(2), outputId: uid(3), workspaceId: uid(4), brandId: uid(5),
    jobKind: "image_asset", assetIndex: 2, leaseToken: "lease", attemptCount: 1,
    payload: {
      contractVersion: "ai-content-render-job.v2", jobKind: "image_asset", generationId: uid(2), outputId: uid(3),
      imagePackage, assetIndex: 2, assetKey: `${uid(2)}:2`,
      storagePath: `ai-content/${uid(5)}/${uid(2)}/${uid(3)}/assets/02.png`,
      rendererPromptVersion: "image-final-pixels.v2", contentGenerationInput, contentPlan,
    },
  };
}

export function cloneManualImageJobV2(): ReturnType<typeof manualImageJobV2> {
  return structuredClone(manualImageJobV2());
}

export function manualBlogImageJobV2() {
  const job = cloneManualImageJobV2();
  const imagePackage = job.payload.imagePackage;
  imagePackage.outputFormat = "blog";
  imagePackage.channelTargets = ["blog_export"];
  imagePackage.aspectRatio = "16:9";
  job.payload.contentGenerationInput.outputSettings = {
    outputFormat: "blog", channelTargets: ["blog_export"], aspectRatio: null,
    outputCount: 1, purpose: "marketing",
  };
  job.payload.contentGenerationInput.selectedProposal.outputFormat = "blog";
  job.payload.contentGenerationInput.selectedProposal.channelTargets = ["blog_export"];
  job.payload.contentGenerationInput.selectedProposal.assetCount = null;
  job.payload.contentGenerationInput.selectedProposal.outline = [
    { index: 1, role: "article", headline: "차 안내", purpose: "설명" },
  ];
  const images = imagePackage.assets.map((_, offset) =>
    `<img src="asset://${String(offset + 1).padStart(2, "0")}" alt="차 설명 이미지 ${offset + 1}">`).join("");
  job.payload.contentPlan = {
    contractVersion: "blog-plan.v2",
    content: {
      title: "차 안내", htmlTemplate: `<article><h1>차 안내</h1>${images}</article>`,
      metaTitle: "차 안내", metaDescription: "차를 안내합니다.", usedEvidenceIds: [],
    },
    imagePackage,
  };
  return job;
}

export function cloneManualBlogImageJobV2(): ReturnType<typeof manualBlogImageJobV2> {
  return structuredClone(manualBlogImageJobV2());
}

export function cardDeckImageJob() {
  const job = cloneManualImageJobV2();
  const deck = {
    contractVersion: "card-deck-editorial-plan.v1" as const,
    content: job.payload.contentPlan.content,
    deckNarrative: "차 제품을 한 흐름으로 소개합니다.",
    visualSystem: {
      paletteDirection: "따뜻한 녹색과 크림색",
      typographyDirection: "굵은 한글 제목과 명확한 수치 위계",
      graphicLanguage: "평면 편집 그래픽과 일관된 선 아이콘",
      imageryDirection: "실제 제품과 차 재료 중심",
      invariants: ["모든 카드의 색과 타이포 계층을 유지합니다."],
    },
    scenes: [1, 2, 3].map((index) => ({
      index,
      editorialRole: index === 1 ? "hook" : index === 3 ? "closing" : "detail",
      purpose: `${index}번 장면 목적`,
      coreMessage: `${index}번 핵심 의미`,
      headline: index === 2 ? "차 맛은 온도에서 갈립니다" : `${index}번 장면`,
      keyVisual: index === 2
        ? { type: "before_after" as const, entries: [
            { role: "before" as const, label: "기존", value: "100°C" },
            { role: "after" as const, label: "권장", value: "80°C" },
          ] }
        : { type: "none" as const, entries: [] },
      supportingTexts: index === 2 ? ["떫은맛은 줄이고 향은 살립니다"] : [],
      footnote: index === 2 ? "차 종류에 따라 달라질 수 있습니다" : null,
      visualThesis: index === 2 ? "100°C에서 80°C로 낮아지는 관계를 가장 강하게 보여줍니다." : `${index}번 장면을 명확히 보여줍니다.`,
      layoutArchetype: index === 2 ? "before_after" as const : "editorial_freeform" as const,
      evidenceIds: [] as string[],
      productImageAssetIds: index === 2 ? [uid(10)] : [] as string[],
      avatarImageAssetIds: index === 2 ? [uid(30)] : [] as string[],
    })),
  };
  const structuredScene = {
    index: 2,
    role: "detail",
    coreMessage: deck.scenes[1]!.coreMessage,
    headline: deck.scenes[1]!.headline,
    keyVisual: deck.scenes[1]!.keyVisual,
    supportingTexts: deck.scenes[1]!.supportingTexts,
    footnote: deck.scenes[1]!.footnote,
    visualDirection: [
      `Deck narrative: ${deck.deckNarrative}`,
      `Palette: ${deck.visualSystem.paletteDirection}`,
      `Typography: ${deck.visualSystem.typographyDirection}`,
      `Graphic language: ${deck.visualSystem.graphicLanguage}`,
      `Imagery: ${deck.visualSystem.imageryDirection}`,
      `Invariants: ${deck.visualSystem.invariants.join(" | ")}`,
      `Editorial role: ${deck.scenes[1]!.editorialRole}`,
      `Scene purpose: ${deck.scenes[1]!.purpose}`,
      `Visual thesis: ${deck.scenes[1]!.visualThesis}`,
      `Layout archetype: ${deck.scenes[1]!.layoutArchetype}`,
    ].join("\n"),
    evidenceIds: [],
    productImageAssetIds: [uid(10)],
  };
  const copy = [
    structuredScene.headline,
    ...structuredScene.keyVisual.entries.flatMap(({ label, value }) => label === null ? [value] : [label, value]),
    ...structuredScene.supportingTexts,
    structuredScene.footnote,
  ].filter((value): value is string => value !== null).join("\n");
  const deckSha256 = cardDeckEditorialPlanSha256(deck);
  for (const imagePackage of [job.payload.imagePackage, job.payload.contentPlan.imagePackage]) {
    imagePackage.assets[1] = {
      ...imagePackage.assets[1],
      copy,
      visualDirection: structuredScene.visualDirection,
    };
  }
  return {
    ...job,
    payload: {
      ...job.payload,
      contractVersion: "ai-content-card-deck-render-job.v1" as const,
      rendererPromptVersion: "image-card-deck.v1" as const,
      cardDeckBinding: {
        contractVersion: "card-deck-editorial-plan.v1" as const,
        deckSha256,
        sceneIndex: 2,
      },
      cardDeckContract: {
        contractVersion: "card-deck-editorial-plan.v1" as const,
        deckSha256,
        plan: deck,
      },
      cardDeckCurrentScene: {
        contractVersion: "card-deck-current-scene.v1" as const,
        deckSha256,
        sceneIndex: 2,
        compatibilityRole: "detail",
        scene: deck.scenes[1]!,
      },
    },
  };
}

export function cloneCardDeckImageJob(): ReturnType<typeof cardDeckImageJob> {
  return structuredClone(cardDeckImageJob());
}

export function reelStoryboardImageJob() {
  const job = cloneManualImageJobV2();
  const outline = [
    { index: 1, role: "hook", headline: "첫 장면", purpose: "관심을 엽니다." },
    { index: 2, role: "detail", headline: "두 번째 장면", purpose: "핵심 변화를 설명합니다." },
    { index: 3, role: "close", headline: "마지막 장면", purpose: "행동을 안내합니다." },
  ];
  const storyboard = {
    contractVersion: "reel-storyboard.v1" as const,
    content: job.payload.contentPlan.content,
    storyNarrative: "차를 더 맛있게 우려내는 온도 변화를 세 장면으로 설명합니다.",
    visualSystem: {
      paletteDirection: "따뜻한 녹색과 크림색",
      typographyDirection: "세로 화면에서 읽히는 굵은 한글 제목과 큰 수치",
      graphicLanguage: "일관된 평면 편집 그래픽과 선 아이콘",
      imageryDirection: "실제 차 제품과 온도 변화 중심",
      invariants: ["모든 장면의 색과 타이포 계층을 유지합니다."],
    },
    scenes: [1, 2, 3].map((index) => ({
      index,
      editorialRole: index === 1 ? "hook" : index === 3 ? "closing" : "detail",
      purpose: `${index}번 장면 목적`,
      coreMessage: `${index}번 핵심 의미`,
      headline: index === 2 ? "차 맛은 온도에서 갈립니다" : `${index}번 장면`,
      keyVisual: index === 2
        ? { type: "before_after" as const, entries: [
            { role: "before" as const, label: "기존", value: "100°C" },
            { role: "after" as const, label: "권장", value: "80°C" },
          ] }
        : { type: "none" as const, entries: [] },
      supportingTexts: index === 2 ? ["떫은맛은 줄이고 향은 살립니다"] : [],
      footnote: index === 2 ? "차 종류에 따라 달라질 수 있습니다" : null,
      visualThesis: index === 2 ? "100°C에서 80°C로 낮아지는 관계를 가장 강하게 보여줍니다." : `${index}번 장면을 명확히 보여줍니다.`,
      layoutArchetype: index === 2 ? "before_after" as const : "editorial_freeform" as const,
      evidenceIds: [] as string[],
      productImageAssetIds: index === 2 ? [uid(10)] : [] as string[],
      avatarImageAssetIds: index === 2 ? [uid(30)] : [] as string[],
    })),
  };
  const planDraft = compileReelStoryboardDraftV1(storyboard, outline);
  const scene = storyboard.scenes[1]!;
  const compiledScene = compileReelStoryboardSceneV1(storyboard, scene, outline[1]!.role);
  const compiledAsset = compileStructuredScene(compiledScene);
  const imagePackage = structuredClone(job.payload.imagePackage);
  imagePackage.outputFormat = "reel";
  imagePackage.aspectRatio = "9:16";
  imagePackage.assets = planDraft.assets.map((asset) => ({ ...asset, attachmentIds: [] }));
  imagePackage.assetCount = imagePackage.assets.length;
  const contentPlan = {
    contractVersion: "reel-plan.v2" as const,
    outputFormat: "reel" as const,
    content: storyboard.content,
    imagePackage,
  };
  const contentGenerationInput = structuredClone(job.payload.contentGenerationInput);
  contentGenerationInput.outputSettings.outputFormat = "reel";
  contentGenerationInput.outputSettings.aspectRatio = "9:16";
  contentGenerationInput.selectedProposal.outputFormat = "reel";
  contentGenerationInput.selectedProposal.assetCount = 3;
  contentGenerationInput.selectedProposal.outline = outline;
  const storyboardSha256 = reelStoryboardSha256(storyboard);
  return {
    ...job,
    payload: {
      contractVersion: "ai-content-reel-storyboard-render-job.v1" as const,
      jobKind: "image_asset" as const,
      generationId: job.generationId,
      outputId: job.outputId,
      imagePackage,
      assetIndex: 2,
      assetKey: `${job.generationId}:2`,
      storagePath: job.payload.storagePath,
      rendererPromptVersion: "image-reel-storyboard.v1" as const,
      contentGenerationInput,
      contentPlan,
      reelStoryboardBinding: {
        contractVersion: "reel-storyboard.v1" as const,
        storyboardSha256,
        sceneIndex: 2,
      },
      reelStoryboardContract: {
        contractVersion: "reel-storyboard.v1" as const,
        storyboardSha256,
        storyboard,
      },
      reelStoryboardCurrentScene: {
        contractVersion: "reel-storyboard-current-scene.v1" as const,
        storyboardSha256,
        sceneIndex: 2,
        compatibilityRole: outline[1]!.role,
        scene,
      },
    },
  };
}

export function cloneReelStoryboardImageJob(): ReturnType<typeof reelStoryboardImageJob> {
  return structuredClone(reelStoryboardImageJob());
}
