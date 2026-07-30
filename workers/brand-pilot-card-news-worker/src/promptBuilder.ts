import { parseContentGenerationInput, type AiContentJob } from "./contracts.js";
import { buildEditorialEvidencePool, type EditorialPlan } from "./editorialPlan.js";

export const cardNewsSkillVersion = "card-news-skill.v6";

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
  const generationInput = input && editorialPlan ? {
    editorialPlan,
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
    },
    sourceGaps: Array.isArray(input.message.qualityBrief.sourceGaps) ? input.message.qualityBrief.sourceGaps : [],
  } : null;
  return [
    ".agents/skills/card-news-creator/SKILL.md를 읽고 따르세요.",
    `계약 버전: ${cardNewsSkillVersion}`,
    `현재 작업 유형: ${job.jobType}`,
    "generate 작업에서는 editorial-plan.v1을 최종 편집 계약으로 사용해 한국어 카드뉴스를 만드세요.",
    "subjectAnalysis.result의 제품·서비스 프로필, subtype, 대안, 장벽과 VOC를 기획 맥락으로 사용하되 확인된 사실과 편집안의 범위를 넘는 주장은 만들지 마세요.",
    "편집안의 singleSubject를 다른 제품, 상위 브랜드, 컨설팅 범위로 넓히지 마세요.",
    "편집안의 장별 role, headline, keyMessage와 순서를 그대로 유지하고 evidence에 없는 주장을 추가하지 마세요.",
    "각 장의 role은 내부 편집 메타데이터입니다. role 값이나 '문제', '처리 과정', '통제 방식', 'CTA' 같은 기획 단계명을 이미지 문구로 노출하지 마세요.",
    "excludedTopics와 sourceGaps의 내용을 사실·혜택·지원 범위로 단정하지 마세요.",
    "subject.selectedImages와 attachments의 선택된 제품·사용자 이미지를 반영하되 복제하지 마세요.",
    "references는 정보 위계, 색 대비, 시선 흐름과 표현 방식만 참고하고 문장, 인물, 로고, 고유 그래픽과 구도를 복제하지 마세요.",
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
    "작업 데이터(JSON):",
    JSON.stringify(generationInput ?? job.payload, null, 2),
  ].join("\n");
}
