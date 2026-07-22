import type { BrandAnalysisJob } from "./contracts.js";

export const brandIntelligenceSkillVersion = "brand-intelligence.v1-ko";

export function buildBrandIntelligencePrompt(job: BrandAnalysisJob): string {
  const analysisInput = {
    contractVersion: "brand-intelligence.v1",
    brand: { id: job.brandId },
    documents: job.evidence,
    researchPolicy: {
      publicWebSearch: true,
      purposes: ["competitors", "market_context"],
      requireSourceUrl: true,
    },
  };
  const schema = {
    contractVersion: "brand-intelligence-result.v1",
    companyOverview: "기업 개요",
    businessDescription: "사업 소개",
    primaryCategory: { code: null, name: "대표 분야" },
    subcategories: [{ code: null, name: "세부 분야" }],
    primaryTarget: "핵심 타깃",
    differentiators: "차별점",
    coreAppeal: "핵심 소구점",
    competitors: [{ name: "경쟁사", description: "비교 설명", sourceUrls: ["https://..."] }],
    evidence: [{ field: "필드명", claim: "근거 주장", sourceId: "입력 sourceId", sourceUrl: "https://... 또는 null" }],
    sourceGaps: ["확인하지 못한 정보"],
  };
  return [
    "너는 모종애드의 브랜드 정보 분석 담당자다.",
    "반드시 한국어로 답하고, 마지막에는 brand-intelligence-result.v1 JSON 하나만 출력한다. JSON 앞뒤에 설명이나 마크다운을 넣지 않는다.",
    "기업 개요, 사업 소개, 분야, 타깃, 차별점, 소구점은 입력 documents의 자사 자료에서만 도출한다.",
    "자사 자료에 없는 가격, 성과, 고객 수, 인증, 효능, 시장 점유율을 추측하거나 만들지 않는다.",
    "공개 웹검색은 경쟁사와 시장 맥락 확인에만 사용한다.",
    "경쟁사와 외부 시장 주장에는 반드시 접근 가능한 HTTPS 근거 URL을 넣는다.",
    "자사 정보의 evidence에는 실제 입력 sourceId를 사용하고, URL 문서라면 입력 근거 URL을 그대로 기록한다.",
    "내용이 충돌하면 최신성 판단 근거를 sourceGaps에 적고, 확인할 수 없는 값은 추측하지 않는다.",
    "사용자가 검토하고 수정할 초안이므로 짧은 키워드 나열 대신 바로 편집 가능한 자연스러운 문장으로 작성한다.",
    "대표 분야는 하나만, 세부 분야는 중복 없이 작성한다.",
    "경쟁사를 확인하지 못하면 가짜 경쟁사를 만들지 말고 competitors는 빈 배열로 두며 이유를 sourceGaps에 기록한다.",
    "\n[분석 입력]\n",
    JSON.stringify(analysisInput, null, 2),
    "\n[출력 스키마]\n",
    JSON.stringify(schema, null, 2),
  ].join("\n");
}
