import { parseContentGenerationInput, type BlogJob } from "./contracts.js";
import { buildAiContentRevisionInstruction, type ContentGenerationInputV3, type ResearchEvidenceSnapshotV1 } from "@brand-pilot/worker-runtime";

export const blogSkillVersion = "blog-writer-skill.v7";
export const blogPlanSkillVersion = "blog-writer-plan.v2";

export function buildBlogPlanPrompt(
  job: BlogJob,
  input: ContentGenerationInputV3,
  supplementalResearch: ResearchEvidenceSnapshotV1 | null,
  repairErrors?: string[],
) {
  const fixedEvidence = [...input.researchEvidence.items, ...(supplementalResearch?.items ?? [])];
  const repair = repairErrors?.length
    ? ["이전 결과는 검증에 실패했습니다. 이 오류만 보정하고 전체 exact JSON을 다시 반환하세요.", ...repairErrors.map((error) => `- ${error}`)]
    : [];
  return [
    ".agents/skills/blog-writer/SKILL.md의 V3 HTML writer 규칙을 따르세요.",
    `계약 버전: ${blogPlanSkillVersion}`,
    "blog-plan.v2 exact JSON 하나만 반환하세요. HTML 한 개가 주 산출물이며 이미지 파일을 직접 만들거나 저장하지 마세요.",
    "metadata 상한은 title 500자, metaTitle 500자, metaDescription 2,000자입니다.",
    "HTML은 article 정확히 1개와 h1 정확히 1개를 사용하세요. h1 바로 다음은 section data-summary=\"true\"이고 direct child p가 정확히 3개, 정규화 합계 300자 이하이어야 합니다.",
    "article visible text를 3,000~10,000자로 작성하세요. 결과를 임의로 자르거나 빈 문단으로 길이를 채우지 마세요.",
    "독자가 실제로 묻는 자연스러운 질문형 h2/h3를 쓰고 각 heading 바로 다음 direct child p에서 핵심 답을 먼저 제시하세요.",
    "SEO metaTitle/metaDescription과 GEO에 유리한 직접 답변, 의미 있는 semantic HTML 구조를 작성하세요. keyword stuffing을 하지 마세요.",
    "상투적인 '오늘은 알아보겠습니다', '도움이 되었기를 바랍니다' 표현과 동일한 문장 구조 반복을 피하세요.",
    "출처 없는 수치나 최신 사실을 단정하지 마세요. 실제 사용한 fixedEvidence만 claim 근처 HTTPS a[data-evidence-id] 링크와 하단 section[data-references=\"true\"]에 동일 집합으로 표시하세요.",
    "제품 사실은 input.product 스냅샷 안에서만 사용하세요. 검색 근거로 제품 기능, 성능, 가격, 강점이나 한계를 추가하거나 추론하지 마세요.",
    "이미지가 실제 이해를 높일 때만 0~5개를 선택하세요. 대표 이미지는 필수가 아닙니다. 이미지가 없으면 imagePackage는 null이고 asset://를 쓰지 마세요.",
    "이미지가 있으면 asset://01부터 assetCount까지 연속 placeholder를 관련 img src에 넣고 누락·고아 자산 없이 ImageGenerationPackageV1을 만드세요.",
    "imagePackage의 product, references, brandStyleImages, avatarStyleImageId, attachments, userImageInstruction은 고정 입력을 그대로 복사하세요. 각 asset에는 근거 UUID evidenceIds를 포함하세요.",
    "모든 이미지에 userImageInstruction과 고정 스타일·아바타·레퍼런스 역할을 적용하되 로고를 생성하거나 배치하지 마세요. 로고용 빈 영역, 워드마크, 심볼, 워터마크, 외부 로고 복제를 만들지 마세요.",
    "style 태그, inline style, link/source/svg, srcset, CSS URL, 외부 이미지 URL을 쓰지 마세요. img src는 오직 asset://NN만 허용합니다.",
    "contentInstruction을 글 전체의 구조와 문체에 적용하세요.",
    ...repair,
    "고정 입력(JSON):",
    JSON.stringify({ job: { generationId: job.generationId, outputId: job.outputId }, input, supplementalResearch, fixedEvidence }, null, 2),
  ].join("\n");
}

export function buildPrompt(job: BlogJob) {
  const input = job.jobType === "generate" ? parseContentGenerationInput(job.payload.contentGenerationInput) : null;
  const orchestration = input?.orchestration
    ? (({ avatar: _avatar, ...value }) => value)(input.orchestration)
    : null;
  const promptInput = input ? {
    ...input,
    orchestration,
    factualDirection: {
      brandContext: input.brandContext,
      subject: input.subject,
      target: input.message.target,
      appeal: input.message.appeal,
      qualityBrief: input.message.qualityBrief,
      orchestration,
    },
    ...(input.orchestration?.avatar
      ? { visualDirection: { avatar: input.orchestration.avatar } }
      : {}),
  } : null;
  const revisionInstruction = buildAiContentRevisionInstruction(job.payload.revision, "blog");
  return [
    ".agents/skills/blog-writer/SKILL.md를 읽고 따르세요.",
    `계약 버전: ${blogSkillVersion}`,
    `현재 작업 유형: ${job.jobType}`,
    "입력 우선순위는 다음과 같이 고정합니다: 승인 Brand Core > 승인 제품·서비스 > 사용자가 확정한 target, strategy, brief > 선택 레퍼런스의 패턴 영감.",
    "정보성 콘텐츠는 교육·문제 해결·가이드 톤을 사용하세요.",
    "generate 작업에서는 content-generation-input.v2 봉투만 입력으로 사용하세요.",
    "subject.analysisResult의 제품·서비스 프로필, subtype, 대안, 장벽과 VOC를 글의 구조와 설명 맥락에 사용하세요.",
    "subject.facts만 제품·서비스의 사실 근거로 사용하세요. subject.research는 출처가 포함된 시장 맥락으로만 사용하세요.",
    "generate 작업에서는 message.qualityBrief.sourceGaps를 사실 근거가 부족한 금지 주장 목록으로 취급하고, 해당 내용을 사실·혜택·지원 범위로 단정하지 마세요.",
    "message.target 1개와 message.appeal 1개를 그대로 사용하고 변경·추가하지 마세요.",
    "subject.selectedImages와 attachments의 선택된 제품·사용자 이미지는 설명에 실제로 필요할 때만 반영하세요.",
    "references는 정보 구조와 설명 방식 같은 시각적 방향만 참고하고 문장, 인물, 로고, 고유 그래픽과 구도를 복제하지 마세요. 레퍼런스의 원문 문장을 그대로 복제하지 마세요.",
    "avatar snapshot은 visualDirection에서만 사용하고 제품 사실, 본문 카피 사실 또는 근거로 사용하지 마세요.",
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
    revisionInstruction,
    "작업 데이터(JSON):",
    JSON.stringify(promptInput ?? job.payload, null, 2),
  ].join("\n");
}
