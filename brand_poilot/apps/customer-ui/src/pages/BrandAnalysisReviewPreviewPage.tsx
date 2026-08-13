import { useState } from "react";
import { BrandAnalysisReviewStep } from "../components/brand-intelligence/BrandAnalysisReviewStep";
import { PreviewShell } from "../components/brand-center-preview/PreviewShell";
import type { BrandIntelligenceResult } from "../features/brand-intelligence/types";
import type { ContentCategory } from "../types";

const previewCategories: ContentCategory[] = [
  {
    code: "marketing",
    name: "마케팅·광고",
    recommendedHashtags: [],
    subcategories: [
      { code: "content-marketing", name: "콘텐츠 마케팅" },
      { code: "brand-strategy", name: "브랜드 전략" },
      { code: "marketing-automation", name: "마케팅 자동화" },
    ],
  },
  {
    code: "software",
    name: "소프트웨어·IT",
    recommendedHashtags: [],
    subcategories: [
      { code: "saas", name: "SaaS" },
      { code: "business-software", name: "기업용 소프트웨어" },
    ],
  },
  {
    code: "consulting",
    name: "비즈니스 서비스",
    recommendedHashtags: [],
    subcategories: [
      { code: "growth-consulting", name: "성장 컨설팅" },
      { code: "data-consulting", name: "데이터 컨설팅" },
    ],
  },
];

const previewResult: BrandIntelligenceResult = {
  contractVersion: "brand-intelligence-result.v2",
  companyNameSuggestion: { name: "모종", sourceFactIds: ["fact-company"] },
  oneLineDefinition: "브랜드의 근거를 모아 콘텐츠 운영까지 연결하는 통합 마케팅 솔루션",
  companyOverview: "흩어진 브랜드 자료를 하나의 기준으로 정리하고, 검토된 정보가 실제 콘텐츠 제작에 일관되게 사용되도록 돕습니다.",
  businessDescription: "웹사이트와 문서에서 브랜드 정보를 분석해 핵심 메시지, 고객 니즈, 상품·서비스 정보를 구조화하고 승인 기반 콘텐츠 워크플로로 연결합니다.",
  primaryCategory: { code: "marketing", name: "마케팅·광고" },
  subcategories: [
    { code: "content-marketing", name: "콘텐츠 마케팅" },
    { code: "brand-strategy", name: "브랜드 전략" },
    { code: null, name: "브랜드 운영 워크플로" },
  ],
  primaryTarget: "브랜드 메시지를 일관되게 운영하려는 성장 단계의 마케팅 조직",
  secondaryTargets: [
    "콘텐츠 운영팀",
    "승인 흐름이 필요한 브랜드 담당자",
    "반복 제작 업무를 줄이려는 소규모 팀",
  ],
  customerNeeds: [
    "브랜드 자료를 한곳에서 관리",
    "근거가 분명한 콘텐츠 초안 작성",
    "팀 검토와 승인 이력 유지",
  ],
  valueProposition: "검증된 브랜드 근거와 사람의 승인을 중심으로 안전하고 반복 가능한 콘텐츠 운영 환경을 제공합니다.",
  differentiators: [
    "원본 자료와 AI 제안을 함께 검토할 수 있습니다.",
    "승인된 정보만 콘텐츠 생성에 사용합니다.",
    "수집부터 제작과 게시까지 한 흐름으로 관리합니다.",
  ],
  coreAppeal: "브랜드 기준을 지키면서 콘텐츠 제작 속도를 높이는 운영 시스템",
  supportingAppeals: [
    "모든 분석 결과를 바로 수정 가능",
    "근거 링크와 검토 이력 제공",
    "팀 단위 승인 흐름 지원",
  ],
  offerings: [
    {
      kind: "product",
      name: "Brand Pilot",
      description: "브랜드 분석부터 콘텐츠 제작과 승인까지 연결하는 운영 제품",
      target: "브랜드·콘텐츠 운영팀",
      benefit: "일관된 제작 기준과 반복 가능한 워크플로",
      priceText: "요금 문의",
      purchaseUrl: "https://www.danbammsg.co.kr/",
      sourceFactIds: ["fact-product"],
    },
    {
      kind: "service",
      name: "브랜드 운영 진단",
      description: "운영 중 끊기는 지점을 찾아 실행 가능한 개선 순서를 제안하는 서비스",
      target: "성장 병목을 겪는 조직",
      benefit: "우선순위가 명확한 실행 계획",
      priceText: "상담 후 안내",
      purchaseUrl: "https://www.danbammsg.co.kr/",
      sourceFactIds: ["fact-service"],
    },
  ],
  faqSuggestions: [],
  keywords: ["브랜드 운영", "콘텐츠 자동화", "근거 관리", "사람 승인"],
  observedTone: {
    summary: "명확하고 실용적이며, 근거와 운영 절차를 강조하는 톤",
    sourceFactIds: ["fact-tone"],
  },
  competitors: [{
    name: "콘텐츠 운영 솔루션 A",
    description: "콘텐츠 제작과 일정 관리를 중심으로 제공하는 비교 대상",
    sourceUrls: ["https://example.com/competitor-a"],
  }],
  marketContext: [],
  evidence: [],
  sourceGaps: ["공개된 상세 가격 정보가 부족합니다."],
};

export function BrandAnalysisReviewPreviewPage() {
  const [companyName, setCompanyName] = useState("모종");
  const [draft, setDraft] = useState<BrandIntelligenceResult>(() => structuredClone(previewResult));
  const [confirmed, setConfirmed] = useState(false);

  return (
    <PreviewShell
      currentStep="analysis"
      sourceUrl="https://www.danbammsg.co.kr/"
      sourceFiles={[]}
      canEnterStep={(step) => step === "analysis"}
      onStepSelected={() => undefined}
    >
      <section className="brand-center-preview__card-heading">
        <h2>AI 분석 결과를 확인하고 수정하세요</h2>
      </section>
      {confirmed ? (
        <p className="brand-review-preview-notice" role="status">
          미리보기에서 변경 내용을 확인했습니다.
        </p>
      ) : null}
      <BrandAnalysisReviewStep
        companyName={companyName}
        draft={draft}
        saving={false}
        error={null}
        categories={previewCategories}
        onCompanyNameChange={setCompanyName}
        onChange={setDraft}
        onConfirm={async () => setConfirmed(true)}
      />
    </PreviewShell>
  );
}
