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
    referenceItemId: uid(30), description: "따뜻한 스타일", tags: ["warm"], storageUrl: "https://owned.example/style.png",
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
