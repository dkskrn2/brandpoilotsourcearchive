import { parseContentGenerationInput, type AiContentJob } from "./contracts.js";

export const cardNewsSkillVersion = "card-news-skill.v5";

export function buildPrompt(job: AiContentJob) {
  const input = job.jobType === "generate" ? parseContentGenerationInput(job.payload) : null;
  return [
    ".agents/skills/card-news-creator/SKILL.md를 읽고 따르세요.",
    `계약 버전: ${cardNewsSkillVersion}`,
    `현재 작업 유형: ${job.jobType}`,
    "generate 작업에서는 content-generation-input.v2 봉투만 입력으로 사용해 한국어 카드뉴스를 만드세요.",
    "subject.facts만 제품·서비스의 사실 근거로 사용하세요. subject.research는 출처가 포함된 시장 맥락으로만 사용하세요.",
    "message.target 1개와 message.appeal 1개를 그대로 사용하세요. 타깃이나 소구점을 변경·추가하지 마세요.",
    "subject.selectedImages와 attachments의 선택된 제품·사용자 이미지를 반영하되 복제하지 마세요.",
    "references는 정보 위계, 색 대비, 시선 흐름과 표현 방식만 참고하고 문장, 인물, 로고, 고유 그래픽과 구도를 복제하지 마세요.",
    "creativeDirection.selectedColor를 핵심 색상으로 반영하고 creativeDirection.prompts의 각 값을 해당 출력의 지시로 순서대로 보존해 사용하세요.",
    "제품 URL을 다시 가져오거나 공개 웹 검색을 수행하지 마세요. 입력 봉투에 없는 사실은 만들지 마세요.",
    "카드 수는 내용을 충분히 설명하는 최소 개수로 정하고 1장 이상 5장 이하로 만드세요. 모든 카드는 1080x1080 정방형 PNG이며 모바일에서도 한글이 선명해야 합니다.",
    "캡션은 자연스러운 한국어로 작성하고 관련 해시태그는 정확히 5개를 포함하세요.",
    "실제 경험이나 고객 반응이 근거에 없으면 만들어내지 마세요.",
    "가격, 수치, 기간, 성과, 후기 등 확인되지 않은 사실을 만들지 마세요.",
    "analyze 작업에서는 content-quality.v1 품질 브리프를 먼저 만들고 이미지 없이 analysis.json만 출력하세요.",
    "generate 작업에서는 content.json과 필요한 slide PNG만 출력하세요.",
    "입력에 qualityBrief가 있으면 hook, readerPayoff, whyNow, specificClaims, evidence를 우선 반영하세요.",
    "작업 데이터(JSON):",
    JSON.stringify(input ?? job.payload, null, 2),
  ].join("\n");
}
