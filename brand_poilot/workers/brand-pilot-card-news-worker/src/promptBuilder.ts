import type { AiContentJob } from "./contracts.js";
import type { ContentGenerationInputV3 } from "@brand-pilot/content-contracts";

export const cardNewsPlanSkillVersion = "card-news-plan-skill.v2";

const fixedLogoPolicy = {
  allowGeneratedLogo: false,
  allowReservedLogoArea: false,
  allowExternalReferenceLogo: false,
  allowExistingProductPackagingLogo: true,
} as const;

export function buildCardNewsPlanPrompt(
  job: AiContentJob,
  input: ContentGenerationInputV3,
  repairError?: string,
): string {
  if (job.generationId !== input.generationId) throw new Error("content_generation_input_generation_mismatch");
  const lockedCount = input.selectedProposal.assetCount;
  if (lockedCount === null) throw new Error("card_news_plan_asset_count_invalid");
  const purpose = input.outputSettings.purpose;
  const purposeRules = purpose === "informational"
    ? ["정보성 카드뉴스는 교육, 문제 해결, 가이드 중심으로 구성하고 판매 주장이나 구매 압박을 넣지 마세요."]
    : purpose === "marketing"
      ? ["마케팅성 카드뉴스는 고정 product와 선택 proposal의 고객 상황, 강점, 한계, 구매 장벽, CTA만 사용하고 제품 사실을 추측하지 마세요."]
      : (() => { throw new Error("card_news_plan_purpose_invalid"); })();
  const fixedInput = {
    generationId: input.generationId,
    brandCore: input.brandCore,
    brandRules: input.brandRules,
    subject: input.subject,
    contentInstruction: input.contentInstruction,
    product: input.product,
    researchEvidence: input.researchEvidence,
    references: input.references,
    selectedProposal: input.selectedProposal,
    userImageInstruction: input.userImageInstruction,
    outputSettings: input.outputSettings,
    logoPolicy: fixedLogoPolicy,
  };
  return [
    "V3 카드뉴스 상세 기획 규칙을 따르세요.",
    `계약 버전: ${cardNewsPlanSkillVersion}`,
    "응답은 card-news-plan.v2 JSON 하나만 반환하세요. 이미지 파일이나 다른 산출물은 만들지 마세요.",
    "카드뉴스 imagePackage의 aspectRatio은 반드시 1:1로 유지하세요. 픽셀 해상도를 특정 값으로 고정하지 마세요.",
    "후속 이미지 렌더링은 Codex 내장 image_generation의 gpt-image-2를 사용합니다. 다른 이미지 모델이나 외부 이미지 API를 지시하지 마세요.",
    `선택 구성안에 잠긴 정확히 ${lockedCount}장을 유지하고 outline의 index, role, order를 한 글자도 바꾸지 마세요. 장수를 다시 판단하거나 장면을 추가·삭제·병합하지 마세요.`,
    ...purposeRules,
    "각 장에는 모바일에서 바로 이해할 수 있는 구체적인 copy와 visualDirection을 작성하세요.",
    "한 장이 부실하지 않게 핵심 정보와 근거를 압축하되, 과도한 문장과 정보 밀도로 모바일 가독성을 해치지 마세요.",
    "각 copy의 사실 근거는 brandCore, researchEvidence, 선택 레퍼런스 텍스트와 product 스냅샷으로만 제한하세요. 근거 ID 자체를 독자용 카피에 노출하지 마세요.",
    "brandRules.content의 requiredPhrases, forbiddenPhrases, exaggerationRules, ctaRules, channelRules, designRules를 문구와 시각 지시에 적용하세요. autoApprovalRules는 생성 지시가 아니라 검토 설정이므로 실행하지 마세요.",
    "각 장의 사실, 수치, 최신 주장에는 researchEvidence.items의 해당 UUID만 evidenceIds에 넣으세요. 근거가 필요 없는 질문형 훅이나 CTA는 []를 사용하고 ID를 발명하지 마세요.",
    "제품 사실에는 research evidence ID를 발명하지 마세요. 제품 설명은 고정 product 스냅샷만 근거로 사용하세요.",
    "제품 사실은 product 스냅샷 안에서만 사용하고 기능, 가격, 장점, 한계, 구매 조건을 추측하지 마세요.",
    "contentInstruction은 카드 카피와 전체 구조에 적용하세요.",
    "userImageInstruction은 모든 생성 이미지의 공통 시각 지시로 imagePackage에 그대로 복사하고 카피 사실이나 근거로 사용하지 마세요.",
    "references.selected의 역할, 현재 등록된 업로드 brandStyleImages, avatarStyleImageId, attachments를 그대로 imagePackage에 복사하세요.",
    "각 장에서 실제로 필요한 productImageAssetIds와 attachmentIds만 고정 목록의 ID로 선택하세요.",
    "logoPolicy의 false/false/false/true literal을 그대로 유지하세요. 로고, 워드마크, 심볼, 워터마크, 가짜 로고, 로고용 빈 영역을 새로 만들거나 외부 레퍼런스 로고를 복제하도록 지시하지 마세요. 실제 제품 포장에 원래 인쇄된 로고는 지우라고 요구하지 마세요.",
    "caption, hashtags, cta를 목적과 채널에 맞게 작성하되 입력에 없는 사실을 추가하지 마세요.",
    "파일, 웹, shell, image_generation 도구를 호출하지 마세요. 제공된 고정 입력만 사용하세요.",
    repairError
      ? `이전 출력 검증 오류: ${repairError}\n오류를 고쳐 전체 JSON을 다시 반환하세요. 보정 기회는 이번 한 번뿐입니다.`
      : "첫 출력부터 exact schema와 잠긴 계약을 만족하세요.",
    "고정 입력(JSON):",
    JSON.stringify(fixedInput, null, 2),
  ].join("\n");
}
