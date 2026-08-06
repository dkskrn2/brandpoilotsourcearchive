import { parseContentGenerationInput, type AiContentJob } from "./contracts.js";
import { buildEditorialEvidencePool, type EditorialPlan } from "./editorialPlan.js";
import {
  buildAiContentRevisionInstruction,
  type ContentGenerationInputV3,
} from "@brand-pilot/worker-runtime";

export const cardNewsSkillVersion = "card-news-skill.v6";
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

export function buildPrompt(job: AiContentJob, editorialPlan?: EditorialPlan) {
  const input = job.jobType === "generate" ? parseContentGenerationInput(job.payload.contentGenerationInput) : null;
  if (input && !editorialPlan) throw new Error("editorial_plan_required");
  const selectedEvidence = input && editorialPlan
    ? buildEditorialEvidencePool(job).filter((item) => editorialPlan.slides.some((slide) => slide.evidenceIds.includes(item.id)))
    : [];
  const usedReferenceIds = new Set(editorialPlan?.referenceUses.map((item) => item.referenceId) ?? []);
  const selectedReferences = input?.references.filter((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const id = typeof (item as Record<string, unknown>).id === "string" ? (item as Record<string, unknown>).id as string : "";
    return usedReferenceIds.has(id);
  }) ?? [];
  const outputIndex = Number(job.payload.outputIndex);
  const selectedDirection = input?.creativeDirection.prompts[Number.isInteger(outputIndex) && outputIndex > 0 ? outputIndex - 1 : 0] ?? input?.creativeDirection.prompts[0];
  const orchestration = input?.orchestration
    ? (({ avatar: _avatar, ...value }) => value)(input.orchestration)
    : null;
  const generationInput = input && editorialPlan ? {
    editorialPlan,
    factualDirection: {
      subject: input.subject,
      target: input.message.target,
      appeal: input.message.appeal,
      qualityBrief: input.message.qualityBrief,
      orchestration,
    },
    subjectAnalysis: {
      analysisId: input.subject.analysisId,
      analysisVersion: input.subject.analysisVersion,
      contractVersion: input.subject.analysisContractVersion,
      type: input.subject.type,
      result: input.subject.analysisResult,
    },
    evidence: selectedEvidence,
    visualDirection: {
      selectedColor: input.creativeDirection.selectedColor,
      brandColor: input.creativeDirection.brandColor,
      aspectRatio: input.creativeDirection.aspectRatio,
      prompt: selectedDirection,
      selectedImages: input.subject.selectedImages,
      references: selectedReferences,
      attachments: input.attachments,
      ...(input.orchestration?.avatar ? { avatar: input.orchestration.avatar } : {}),
    },
    sourceGaps: Array.isArray(input.message.qualityBrief.sourceGaps) ? input.message.qualityBrief.sourceGaps : [],
  } : null;
  const revisionInstruction = buildAiContentRevisionInstruction(job.payload.revision, "card_news");
  return [
    ".agents/skills/card-news-creator/SKILL.md를 읽고 따르세요.",
    `계약 버전: ${cardNewsSkillVersion}`,
    `현재 작업 유형: ${job.jobType}`,
    "입력 우선순위는 다음과 같이 고정합니다: 승인 Brand Core > 승인 제품·서비스 > 사용자가 확정한 target, strategy, brief > 선택 레퍼런스의 패턴 영감.",
    "정보성 콘텐츠는 교육·문제 해결·가이드 톤을 사용하세요.",
    "generate 작업에서는 editorial-plan.v1을 최종 편집 계약으로 사용해 한국어 카드뉴스를 만드세요.",
    "subjectAnalysis.result의 제품·서비스 프로필, subtype, 대안, 장벽과 VOC를 기획 맥락으로 사용하되 확인된 사실과 편집안의 범위를 넘는 주장은 만들지 마세요.",
    "편집안의 singleSubject를 다른 제품, 상위 브랜드, 컨설팅 범위로 넓히지 마세요.",
    "편집안의 장별 role, headline, keyMessage와 순서를 그대로 유지하고 evidence에 없는 주장을 추가하지 마세요.",
    "각 장의 role은 내부 편집 메타데이터입니다. role 값이나 '문제', '처리 과정', '통제 방식', 'CTA' 같은 기획 단계명을 이미지 문구로 노출하지 마세요.",
    "excludedTopics와 sourceGaps의 내용을 사실·혜택·지원 범위로 단정하지 마세요.",
    "subject.selectedImages와 attachments의 선택된 제품·사용자 이미지를 반영하되 복제하지 마세요.",
    "references는 정보 위계, 색 대비, 시선 흐름과 표현 방식만 참고하고 문장, 인물, 로고, 고유 그래픽과 구도를 복제하지 마세요. 레퍼런스의 원문 문장을 그대로 복제하지 마세요.",
    "avatar snapshot은 visualDirection에서만 사용하고 제품 사실, 카피 사실 또는 근거로 사용하지 마세요.",
    "creativeDirection.selectedColor를 핵심 색상으로 반영하고 creativeDirection.prompts의 각 값을 해당 출력의 지시로 순서대로 보존해 사용하세요.",
    "제품 URL을 다시 가져오거나 공개 웹 검색을 수행하지 마세요. 입력 봉투에 없는 사실은 만들지 마세요.",
    input && editorialPlan
      ? `카드는 편집안과 동일하게 정확히 ${editorialPlan.slides.length}장 만드세요. 모든 카드는 선택한 ${input.creativeDirection.aspectRatio} 비율의 PNG이며 모바일에서도 한글이 선명해야 합니다.`
      : "generate 작업에서는 creativeDirection.aspectRatio에 지정된 비율을 사용하세요.",
    "generate 작업에서는 반드시 image_generation 도구로 최종 슬라이드 이미지를 직접 생성하세요.",
    "HTML, SVG, Canvas, 브라우저 스크린샷 또는 코드 기반 도형·텍스트 합성으로 최종 슬라이드를 프로그램 방식으로 조립하거나 렌더링하지 마세요.",
    "shell 도구는 image_generation이 만든 이미지 파일을 지정 출력 경로로 복사하고 크기·형식을 확인하는 용도로만 사용하세요.",
    "캡션은 자연스러운 한국어로 작성하고 관련 해시태그는 정확히 5개를 포함하세요.",
    "실제 경험이나 고객 반응이 근거에 없으면 만들어내지 마세요.",
    "가격, 수치, 기간, 성과, 후기 등 확인되지 않은 사실을 만들지 마세요.",
    "analyze 작업에서는 이미지 없이 analysis.json만 출력하세요. JSON은 반드시 {\"qualityBrief\":{\"version\":\"content-quality.v1\",\"hook\":\"...\",\"readerPayoff\":\"...\",\"whyNow\":\"...\",\"specificClaims\":[\"...\",\"...\"],\"evidence\":[{\"claim\":\"...\",\"support\":\"...\",\"sourceUrl\":\"https://...\"},{\"claim\":\"...\",\"support\":\"...\"}],\"sourceGaps\":[]}} 형태여야 하며 evidence는 2개 이상이어야 합니다.",
    "generate 작업에서는 content.json과 필요한 slide PNG만 출력하세요.",
    "이미지 생성 전에 내용을 다시 기획하거나 장수를 변경하지 마세요.",
    revisionInstruction,
    "작업 데이터(JSON):",
    JSON.stringify(generationInput ?? job.payload, null, 2),
  ].join("\n");
}
