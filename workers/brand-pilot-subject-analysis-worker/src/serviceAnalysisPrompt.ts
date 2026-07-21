import type { SubjectAnalysisJobV2 } from "./contracts.js";

export const serviceAnalysisPromptVersion = "service-analysis.v2-ko";

export function buildServiceAnalysisPrompt(job: SubjectAnalysisJobV2): string {
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
    subjectType: "service",
    summary: "string",
    verifiedFacts: [{ claim: "string", support: "string", sourceUrl: "https://... or attachment://uuid" }],
    voc: [{ quoteSummary: "string", context: "string", sourceUrl: "https://..." }],
    alternatives: [{ name: "string", strengths: ["string"], limitations: ["string"], sourceUrls: ["https://..."] }],
    barriers: [{ barrier: "string", evidence: "string", sourceUrls: ["https://... or attachment://uuid"] }],
    productProfile: null,
    serviceProfile: {
      customerProblem: ["string"],
      currentAlternatives: ["string"],
      deliveryProcess: ["string"],
      deliverables: ["string"],
      users: ["string"],
      buyers: ["string"],
      price: "string",
      beforeAfterWorkflow: { before: ["string"], after: ["string"] },
      afterState: ["string"],
      terms: { contract: ["string"], renewal: ["string"], cancellation: ["string"] },
      support: ["string"],
      trustEvidence: ["string"],
      securityEvidence: ["string"],
      performanceEvidence: ["string"],
      adoptionBarriers: ["string"],
    },
    serviceSubtype: "saas | consulting | education | agency | subscription | professional | other_service",
    sourceGaps: ["string"],
  };

  return [
    `[프롬프트 버전] ${serviceAnalysisPromptVersion}`,
    "너는 무형 서비스 분석 담당자다. 한국어로 분석하고 마지막에는 지정된 JSON 하나만 출력한다.",
    "분석의 중심 흐름은 문제 → 제공 과정 → 이용 후 변화 → 신뢰·도입 부담이다.",
    "서비스의 실제 사용자와 구매 결정권자를 구분한다.",
    "계약·갱신·해지·지원·산출물·도입 장벽을 빠짐없이 확인한다.",
    "serviceProfile에서 가격·이용 조건, 도입 전·후 업무 흐름, 보안·성과 신뢰 근거를 구분해 기록한다.",
    "serviceSubtype은 saas, consulting, education, agency, subscription, professional, other_service 중 하나로 자동 판별한다.",
    "subtype은 내부 분석용으로만 사용하며 사용자 화면용 유형 설명을 생성하지 않는다.",
    "비 SaaS 서비스를 SaaS 기능 목록처럼 분석하지 않는다.",
    "saas: 기능, 업무 흐름, 연동, 권한, 온보딩, 도입 난이도를 분석한다.",
    "consulting: 진단 방법, 전문성, 수행 과정, 맞춤성, 산출물을 분석한다.",
    "education: 커리큘럼, 대상 수준, 학습 결과, 강사 신뢰도를 분석한다.",
    "agency: 업무 범위, 산출물, 대응 방식, 관리 부담 감소를 분석한다.",
    "subscription: 반복 제공 가치, 갱신 이유, 해지 조건, 이용 빈도를 분석한다.",
    "professional: 자격·경력, 정확성, 위험 감소, 상담 절차를 분석한다.",
    "other_service: 제공 과정, 산출물, 이용 조건, 신뢰 근거, 도입 부담을 서비스 특성에 맞게 분석한다.",
    "자료가 충돌하면 직접 입력 > 첨부 > URL > 브랜드 > 공개 검색 순으로 판단한다.",
    "브랜드 컨텍스트는 배경 정보이며 서비스 자료를 대체하지 않는다.",
    "공개 웹 검색은 VOC, 대안, 경쟁 맥락, 시장 언어에만 사용한다.",
    "공개 웹 검색만으로 가격, 효능, 성과, 성능, 계약 조건을 확정하지 않는다.",
    "확인된 사실에는 HTTPS 또는 attachment://uuid 출처를 기록하고, 근거가 부족하면 추측하지 말고 sourceGaps에 기록한다.",
    "serviceProfile은 객체로 작성하고 productProfile은 null로 작성한다.",
    "JSON 앞뒤에 설명이나 마크다운을 넣지 않는다.",
    "\n[분석 입력: 브랜드 컨텍스트 → 직접 입력 → 첨부 → URL 추출 → 공개 검색 정책]\n",
    JSON.stringify(analysisInput, null, 2),
    "\n[출력 스키마]\n",
    JSON.stringify(schema, null, 2),
  ].join("\n");
}
