import type { BlogJob } from "./contracts.js";
import type { ContentGenerationInputV3, ResearchEvidenceSnapshotV1 } from "@brand-pilot/content-contracts";

export const blogPlanSkillVersion = "blog-writer-plan.v2";

export function buildBlogPlanPrompt(
  job: BlogJob,
  input: ContentGenerationInputV3,
  supplementalResearch: ResearchEvidenceSnapshotV1 | null,
  repairErrors?: string[],
) {
  const fixedEvidence = [...input.researchEvidence.items, ...(supplementalResearch?.items ?? [])];
  const purpose = input.outputSettings.purpose;
  const purposeRules = purpose === "informational"
    ? ["정보성 블로그는 검색 질문에 대한 교육, 문제 해결, 가이드 중심으로 작성하고 판매 주장이나 구매 압박을 넣지 마세요."]
    : purpose === "marketing"
      ? ["마케팅성 블로그는 고정 product와 선택 proposal의 고객 상황, 강점, 한계, 구매 장벽, CTA만 사용하고 제품 사실을 검색 근거로 보강하거나 추측하지 마세요."]
      : (() => { throw new Error("blog_plan_purpose_invalid"); })();
  const repair = repairErrors?.length
    ? ["이전 결과는 검증에 실패했습니다. 이 오류만 보정하고 전체 exact JSON을 다시 반환하세요.", ...repairErrors.map((error) => `- ${error}`)]
    : [];
  return [
    ".agents/skills/blog-writer/SKILL.md의 V3 HTML writer 규칙을 따르세요.",
    `계약 버전: ${blogPlanSkillVersion}`,
    "blog-plan.v2 exact JSON 하나만 반환하세요. HTML 한 개가 주 산출물이며 이미지 파일을 직접 만들거나 저장하지 마세요.",
    ...purposeRules,
    "metadata 상한은 title 500자, metaTitle 500자, metaDescription 2,000자입니다.",
    "HTML은 article 정확히 1개와 h1 정확히 1개를 사용하세요. h1 바로 다음은 section data-summary=\"true\"이고 direct child p가 정확히 3개, 정규화 합계 300자 이하이어야 합니다.",
    "article visible text를 3,000~10,000자로 작성하세요. 결과를 임의로 자르거나 빈 문단으로 길이를 채우지 마세요.",
    "독자가 실제로 묻는 자연스러운 질문형 h2/h3를 쓰고 각 heading 바로 다음 direct child p에서 핵심 답을 먼저 제시하세요.",
    "SEO metaTitle/metaDescription과 GEO에 유리한 직접 답변, 의미 있는 semantic HTML 구조를 작성하세요. keyword stuffing을 하지 마세요.",
    "상투적인 '오늘은 알아보겠습니다', '도움이 되었기를 바랍니다' 표현과 동일한 문장 구조 반복을 피하세요.",
    "출처 없는 수치나 최신 사실을 단정하지 마세요. 실제 사용한 fixedEvidence만 claim 근처 HTTPS a[data-evidence-id] 링크와 하단 section[data-references=\"true\"]에 동일 집합으로 표시하세요.",
    "제품 사실은 input.product 스냅샷 안에서만 사용하세요. 검색 근거로 제품 기능, 성능, 가격, 강점이나 한계를 추가하거나 추론하지 마세요.",
    "input.brandRules.content의 requiredPhrases, forbiddenPhrases, exaggerationRules, ctaRules, channelRules, designRules를 글과 이미지 지시에 적용하세요. autoApprovalRules는 생성 지시가 아니라 검토 설정이므로 실행하지 마세요.",
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
