import { parseContentGenerationInput, type BlogJob } from "./contracts.js";

export const blogSkillVersion = "blog-writer-skill.v7";

export function buildPrompt(job: BlogJob) {
  const input = job.jobType === "generate" ? parseContentGenerationInput(job.payload.contentGenerationInput) : null;
  return [
    ".agents/skills/blog-writer/SKILL.md를 읽고 따르세요.",
    `계약 버전: ${blogSkillVersion}`,
    `현재 작업 유형: ${job.jobType}`,
    "generate 작업에서는 content-generation-input.v2 봉투만 입력으로 사용하세요.",
    "subject.analysisResult의 제품·서비스 프로필, subtype, 대안, 장벽과 VOC를 글의 구조와 설명 맥락에 사용하세요.",
    "subject.facts만 제품·서비스의 사실 근거로 사용하세요. subject.research는 출처가 포함된 시장 맥락으로만 사용하세요.",
    "generate 작업에서는 message.qualityBrief.sourceGaps를 사실 근거가 부족한 금지 주장 목록으로 취급하고, 해당 내용을 사실·혜택·지원 범위로 단정하지 마세요.",
    "message.target 1개와 message.appeal 1개를 그대로 사용하고 변경·추가하지 마세요.",
    "subject.selectedImages와 attachments의 선택된 제품·사용자 이미지는 설명에 실제로 필요할 때만 반영하세요.",
    "references는 정보 구조와 설명 방식 같은 시각적 방향만 참고하고 문장, 인물, 로고, 고유 그래픽과 구도를 복제하지 마세요.",
    "creativeDirection.selectedColor를 반영하고 creativeDirection.prompts의 각 값을 해당 출력의 지시로 순서대로 보존해 사용하세요.",
    "제품 URL을 다시 가져오거나 공개 웹 검색을 수행하지 마세요. 입력 봉투에 없는 사실은 만들지 마세요.",
    "독자의 검색 의도와 실제로 해결해야 할 질문을 분석하고, H1은 정확히 하나만 사용하세요.",
    "SEO 제목·메타 제목·메타 설명을 제공하되 키워드를 반복 삽입하지 마세요. 한국어 화자가 직접 설명하듯 자연스럽게 쓰고 AI 특유의 상투적 결론과 과도한 나열을 피하세요.",
    "semantic HTML로 article, header, section, h1/h2/h3, p, ul/ol, figure를 적절히 사용하세요.",
    "본문 이미지는 비교, 과정, 구조 또는 예시를 설명해야 이해가 분명히 좋아지는 경우에만 0~5장을 만드세요. 장식용 이미지는 만들지 마세요.",
    "본문 이미지를 만들면 HTML의 실제 관련 문단에 inline-01.png부터 순서대로 참조하고 구체적인 한국어 alt를 작성하세요.",
    "analyze 작업에서는 이미지 없이 analysis.json만 출력하세요. JSON은 반드시 {\"qualityBrief\":{\"version\":\"content-quality.v1\",\"hook\":\"...\",\"readerPayoff\":\"...\",\"whyNow\":\"...\",\"specificClaims\":[\"...\",\"...\"],\"evidence\":[{\"claim\":\"...\",\"support\":\"...\",\"sourceUrl\":\"https://...\"},{\"claim\":\"...\",\"support\":\"...\"}],\"sourceGaps\":[]}} 형태여야 하며 evidence는 2개 이상이어야 합니다.",
    "generate 작업에서는 content.json, article.html, cover.png를 출력하고 필요할 때만 inline PNG를 추가하세요.",
    "입력에 qualityBrief가 있으면 hook, readerPayoff, whyNow, specificClaims, evidence를 우선 반영하세요.",
    "실제 경험이나 고객 반응이 근거에 없으면 만들어내지 마세요.",
    "작업 데이터(JSON):",
    JSON.stringify(input ?? job.payload, null, 2),
  ].join("\n");
}
