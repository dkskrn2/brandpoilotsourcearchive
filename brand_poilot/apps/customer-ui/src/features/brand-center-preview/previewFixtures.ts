import type { PreviewState } from "./types";

const previewFixture: PreviewState = {
  currentStep: "sources",
  sources: {
    url: "",
    files: [],
    error: null,
  },
  analysis: {
    state: "idle",
    error: null,
  },
  activeAnalysisRequestId: null,
  brandCore: {
    oneLine: "브랜드의 기준을 선명하게 정리해 콘텐츠 제작을 돕습니다.",
    description: "흩어진 브랜드 자료를 하나의 일관된 기준으로 정리하는 브랜드 운영 도구입니다.",
    target: "브랜드 메시지를 일관되게 운영하려는 소규모 마케팅 팀",
    customerProblem: "자료가 여러 곳에 흩어져 콘텐츠마다 브랜드 표현이 달라집니다.",
    primaryValue: "승인된 브랜드 정보를 바탕으로 일관된 콘텐츠 제작 기준을 제공합니다.",
    differentiators: [
      "원본 자료와 AI 제안을 함께 검토할 수 있습니다.",
      "승인된 정보만 생성 결과에 사용합니다.",
    ],
    tone: ["명확한", "신뢰감 있는", "실용적인"],
    priorityMessages: [
      "브랜드 기준을 한곳에서 관리하세요.",
      "검토하고 승인한 정보로 콘텐츠를 만드세요.",
    ],
  },
  brandCoreApproved: false,
  knowledge: [
    {
      id: "knowledge-faq-1",
      kind: "faq",
      title: "어떤 자료를 등록할 수 있나요?",
      content: "회사 소개서, 사업계획서, 제품 자료와 자사 URL을 등록할 수 있습니다.",
      reviewStatus: "ai_draft",
      origin: "ai",
    },
    {
      id: "knowledge-faq-2",
      kind: "faq",
      title: "AI 제안은 언제 수정할 수 있나요?",
      content: "검토를 시작하기 전부터 제안 내용을 직접 수정할 수 있습니다.",
      reviewStatus: "ai_draft",
      origin: "ai",
    },
    {
      id: "knowledge-faq-3",
      kind: "faq",
      title: "승인한 정보는 어디에 사용되나요?",
      content: "승인한 브랜드 기준과 지식은 카드뉴스 생성 입력으로 사용됩니다.",
      reviewStatus: "ai_draft",
      origin: "ai",
    },
    {
      id: "knowledge-how-to",
      kind: "how_to",
      title: "브랜드 자료 등록 방법",
      content: "자사 URL을 입력하거나 지원되는 문서 파일을 선택합니다.",
      reviewStatus: "ai_draft",
      origin: "ai",
    },
    {
      id: "knowledge-guide",
      kind: "guide",
      title: "브랜드 검토 가이드",
      content: "핵심 설명과 지식 초안을 확인하고 필요한 내용을 수정한 뒤 승인합니다.",
      reviewStatus: "ai_draft",
      origin: "ai",
    },
    {
      id: "knowledge-product-service-1",
      kind: "product_service",
      title: "Brand Pilot",
      content: "브랜드 자료 분석부터 승인 기반 콘텐츠 생성까지 연결하는 서비스입니다.",
      reviewStatus: "ai_draft",
      origin: "ai",
    },
    {
      id: "knowledge-product-service-2",
      kind: "product_service",
      title: "브랜드 센터",
      content: "브랜드 핵심과 콘텐츠 제작에 사용할 지식을 한곳에서 관리합니다.",
      reviewStatus: "ai_draft",
      origin: "ai",
    },
    {
      id: "knowledge-product-service-3",
      kind: "product_service",
      title: "카드뉴스 생성",
      content: "승인한 브랜드 기준을 바탕으로 일관된 카드뉴스 초안을 만듭니다.",
      reviewStatus: "ai_draft",
      origin: "ai",
    },
  ],
  activeKnowledgeKind: "all",
  editingKnowledgeId: null,
  generation: {
    state: "idle",
    error: null,
  },
  activeGenerationRequestId: null,
  announcement: "",
};

export function createPreviewState(
  override: Partial<PreviewState> = {},
): PreviewState {
  return structuredClone({
    ...previewFixture,
    ...override,
  });
}
