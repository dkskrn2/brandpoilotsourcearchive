import type { SubjectAnalysisJobV2 } from "./contracts.js";

export const productAnalysisPromptVersion = "product-analysis.v2-ko";

export function buildProductAnalysisPrompt(job: SubjectAnalysisJobV2): string {
  const analysisInput = {
    brandContext: job.brandContext,
    manualInput: job.subject.manualInput,
    attachments: {
      documents: job.extracted.documents,
      images: job.extracted.images,
    },
    sourceUrl: {
      requestedUrl: job.subject.sourceUrl,
      extractedPage: job.extracted.sourcePage,
    },
    publicSearchPolicy: {
      allowedPurposes: ["voc", "alternatives", "market_context"],
      requireEvidenceUrl: true,
    },
    sourceGaps: job.extracted.sourceGaps,
    sourcePriority: job.sourcePriority,
  };
  const schema = {
    contractVersion: "subject-analysis-result.v2",
    phase: "analysis",
    subjectType: "product",
    summary: "string",
    verifiedFacts: [{ claim: "string", support: "string", sourceUrl: "https://... or attachment://uuid" }],
    voc: [{ quoteSummary: "string", context: "string", sourceUrl: "https://..." }],
    alternatives: [{ name: "string", strengths: ["string"], limitations: ["string"], sourceUrls: ["https://..."] }],
    barriers: [{ barrier: "string", evidence: "string", sourceUrls: ["https://... or attachment://uuid"] }],
    productProfile: {
      name: "string",
      category: "string",
      specifications: ["string"],
      materials: ["string"],
      options: ["string"],
      shipping: ["string"],
      returns: ["string"],
      functions: [{ function: "string", benefit: "string", purchaseReason: "string" }],
      useContexts: ["string"],
      purchaseBarriers: ["string"],
    },
    serviceProfile: null,
    serviceSubtype: null,
    sourceGaps: ["string"],
  };

  return [
    `[프롬프트 버전] ${productAnalysisPromptVersion}`,
    "너는 제품 분석 담당자다. 한국어로 분석하고 마지막에는 지정된 JSON 하나만 출력한다.",
    "분석의 중심 흐름은 기능 → 효익 → 구매 이유다.",
    "규격·소재·옵션·배송·환불·사용 상황·구매 장벽을 빠짐없이 확인한다.",
    "자료가 충돌하면 직접 입력 > 첨부 > URL > 브랜드 > 공개 검색 순으로 판단한다.",
    "브랜드 컨텍스트는 배경 정보이며 제품 자료를 대체하지 않는다.",
    "공개 웹 검색은 VOC, 대안, 경쟁 맥락, 시장 언어에만 사용한다.",
    "공개 웹 검색으로 가격·효능·성과·성능을 확정하지 않는다.",
    "확인되지 않은 가격, 효능, 성과, 성능, 후기, 수치, 보장 문구를 만들지 않는다.",
    "확인된 사실에는 HTTPS 또는 attachment://uuid 출처를 기록하고, 근거가 부족하면 추측하지 말고 sourceGaps에 기록한다.",
    "productProfile은 객체로 작성하고 serviceProfile과 serviceSubtype은 null로 작성한다.",
    "JSON 앞뒤에 설명이나 마크다운을 넣지 않는다.",
    "\n[분석 입력: 브랜드 컨텍스트 → 직접 입력 → 첨부 → URL 추출 → 공개 검색 정책]\n",
    JSON.stringify(analysisInput, null, 2),
    "\n[출력 스키마]\n",
    JSON.stringify(schema, null, 2),
  ].join("\n");
}
