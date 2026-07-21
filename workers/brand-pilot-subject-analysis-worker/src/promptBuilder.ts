import type { SubjectAnalysisJob, SubjectWorkerJob } from "./contracts.js";
import { buildProductAnalysisPrompt } from "./productAnalysisPrompt.js";
import { buildProductAppealPrompt } from "./productAppealPrompt.js";
import { buildServiceAnalysisPrompt } from "./serviceAnalysisPrompt.js";
import { buildServiceAppealPrompt } from "./serviceAppealPrompt.js";

export const subjectAnalysisSkillVersion = "subject-analysis.v1-ko";

export function buildSubjectAnalysisPrompt(job: SubjectAnalysisJob): string {
  const analysisInput = {
    contractVersion: job.contractVersion,
    brand: job.brand,
    subject: job.subject,
    extracted: job.extracted,
    researchPolicy: job.researchPolicy,
  };
  const schema = {
    contractVersion: "subject-analysis-result.v1",
    summary: "string",
    needs: [{ text: "string", sourceUrl: "https://..." }],
    alternatives: [{ name: "string", strengths: ["string"], limitations: ["string"], sourceUrls: ["https://..."] }],
    voc: [{ quoteSummary: "string", context: "string", sourceUrl: "https://..." }],
    usps: [{ claim: "string", support: "string", sourceUrl: "https://..." }],
    targets: [{ id: "string", name: "string", traits: ["string"], painPoints: ["string"], purchaseMotivations: ["string"], uspEvidence: [{ claim: "string", support: "string", sourceUrl: "https://..." }] }],
    appealsByTarget: { "target-id": [{ id: "string", targetId: "target-id", title: "string", description: "string", evidenceType: "product_fact", connectionReason: "string", sources: [{ title: "string", url: "https://..." }] }] },
    recommendedImageId: "candidate-id-or-null",
    sourceGaps: ["string"],
  };
  return [
    "너는 모종의 상품·서비스 분석 담당자다.",
    "반드시 한국어로 답하고, 마지막에는 subject-analysis-result.v1 JSON 하나만 출력한다. JSON 앞뒤에 설명이나 마크다운을 넣지 않는다.",
    "제품·서비스 사실은 extracted.facts와 extracted.structuredData에서만 사용한다.",
    "공개 웹 검색은 VOC, 대안 비교, 시장 맥락에만 사용한다.",
    "공개 웹 근거에는 반드시 접근 가능한 HTTPS 출처 URL을 넣는다.",
    "근거 없는 가격, 효능, 후기, 성과 수치, 시장 점유율, 보장 문구, 1인칭 경험을 절대 만들지 않는다.",
    "검색 결과가 부족하면 추측하지 말고 sourceGaps에 기록하며 partial 품질로 반환한다.",
    "입력 imageCandidates의 ID만 평가하고 외부 이미지는 가져오지 않으며 새 이미지 URL을 만들지 않는다.",
    "타깃은 정확히 3개로 만들고, appealsByTarget의 각 타깃에는 최소 2개의 소구점을 넣는다.",
    "각 타깃과 소구점은 서로 다른 고객 상황을 설명해야 한다.",
    "\n[분석 입력]\n",
    JSON.stringify(analysisInput, null, 2),
    "\n[출력 스키마]\n",
    JSON.stringify(schema, null, 2),
  ].join("\n");
}

export function buildSubjectPrompt(job: SubjectWorkerJob): string {
  if (job.contractVersion === "subject-analysis.v1") return buildSubjectAnalysisPrompt(job);
  if (job.phase === "analysis") {
    return job.subject.type === "product"
      ? buildProductAnalysisPrompt(job)
      : buildServiceAnalysisPrompt(job);
  }
  return job.subject.type === "product"
    ? buildProductAppealPrompt(job)
    : buildServiceAppealPrompt(job);
}
