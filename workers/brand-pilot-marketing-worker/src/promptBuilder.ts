import { parseContentGenerationInput, type MarketingJob } from "./contracts.js";
import { requestedDimensions } from "./manifest.js";

export const marketingSkillVersion = "marketing-creative-skill.v5";

export function buildPrompt(job: MarketingJob) {
  const input = job.jobType === "generate" ? parseContentGenerationInput(job.payload) : null;
  const dimensions = requestedDimensions(job.payload);
  return [
    ".agents/skills/marketing-creative/SKILL.md를 읽고 따르세요.",
    `계약 버전: ${marketingSkillVersion}`,
    `현재 작업 유형: ${job.jobType}`,
    "generate 작업에서는 content-generation-input.v2 봉투만 입력으로 사용하세요.",
    "subject.facts만 제품·서비스의 사실 근거로 사용하세요. subject.research는 출처가 포함된 시장 맥락으로만 사용하세요.",
    "message.target 1개와 message.appeal 1개를 그대로 사용하세요. 타깃이나 소구점을 변경·추가하지 마세요.",
    "subject.selectedImages와 attachments의 선택된 제품·사용자 이미지를 반영하되 복제하지 마세요.",
    "references는 정보 위계, 색 대비, 시선 흐름과 표현 방식만 참고하고 문장, 인물, 로고, 고유 그래픽과 구도를 복제하지 마세요.",
    "creativeDirection.selectedColor를 반영하고 creativeDirection.prompts의 각 값을 해당 출력의 지시로 순서대로 보존해 사용하세요.",
    "제품 URL을 다시 가져오거나 공개 웹 검색을 수행하지 마세요. 입력 봉투에 없는 사실은 만들지 마세요.",
    "각 결과는 독립된 광고 1개와 메시지 가설 1개여야 합니다. 여러 결과는 색만 바꾸지 말고 서로 다른 메시지 가설을 사용하세요.",
    "한 명의 구체적인 대상, 하나의 핵심 혜택, 하나의 실제 행동만 전달하세요.",
    `creative.png는 정확히 ${dimensions.width}x${dimensions.height} PNG로 저장하세요. 요청된 비율에 맞춰 처음부터 구성하고 사후 크롭을 전제로 만들지 마세요.`,
    "이미지에 가짜 버튼, 플랫폼 UI, QR 코드 또는 출처 URL을 그리지 마세요.",
    "AI 광고 문구처럼 모호한 최상급 표현을 반복하지 말고 사람이 쓴 구체적인 한국어를 사용하세요.",
    "analyze 작업에서는 content-quality.v1 품질 브리프를 먼저 만들고 이미지 없이 analysis.json만 출력하세요.",
    "generate 작업에서는 content.json과 요청 크기의 creative.png를 출력하세요.",
    "입력에 qualityBrief가 있으면 hook, readerPayoff, whyNow, specificClaims, evidence를 우선 반영하세요.",
    "작업 데이터(JSON):",
    JSON.stringify(input ?? job.payload, null, 2),
  ].join("\n");
}
