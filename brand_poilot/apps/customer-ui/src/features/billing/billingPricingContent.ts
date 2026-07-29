export interface BillingPlan {
  readonly name: "운영 시작" | "팀 운영" | "확장 운영";
  readonly recommended: boolean;
  readonly description: string;
  readonly price: string;
  readonly note: string;
  readonly facts: readonly (readonly [label: string, value: string])[];
  readonly features: readonly string[];
  readonly cta: "운영 시작 상담" | "팀 운영 상담" | "확장 운영 상담";
}

export interface BillingComparisonRow {
  readonly feature: string;
  readonly start: string;
  readonly team: string;
  readonly expand: string;
  readonly custom: string;
}

export interface BillingComparisonGroup {
  readonly label: string;
  readonly rows: readonly BillingComparisonRow[];
}

export interface BillingFaq {
  readonly question: string;
  readonly answer: string;
}

export const billingPlans = [
  {
    name: "운영 시작",
    description: "한 브랜드의 기준을 세우고, 첫 콘텐츠 발행 흐름을 연결합니다.",
    price: "별도 견적",
    note: "첫 운영 범위 기준",
    recommended: false,
    facts: [["브랜드", "1개"], ["검토", "담당자 1명"], ["게시", "Instagram"]],
    features: ["브랜드 자료와 참고 링크 등록", "브랜드 기준을 반영한 콘텐츠 초안", "카드뉴스와 문구 검토", "승인 후 게시 흐름 연결"],
    cta: "운영 시작 상담",
  },
  {
    name: "팀 운영",
    description: "정기 발행팀이 자료, 검토, 게시 상태를 한 흐름으로 관리합니다.",
    price: "별도 견적",
    note: "정기 운영 범위 기준",
    recommended: true,
    facts: [["브랜드", "1개"], ["검토", "복수 담당자"], ["운영", "정기 발행"]],
    features: ["운영 시작 플랜의 전체 기능", "담당자별 검토와 승인 상태", "발행 일정과 운영 기준 관리", "운영 결과를 반영한 기준 업데이트"],
    cta: "팀 운영 상담",
  },
  {
    name: "확장 운영",
    description: "여러 역할과 브랜드를 운영 기준 안에서 함께 다루는 팀을 위한 플랜입니다.",
    price: "별도 견적",
    note: "확장 범위 협의",
    recommended: false,
    facts: [["브랜드", "복수 운영"], ["검토", "역할 분리"], ["연동", "범위 협의"]],
    features: ["복수 브랜드의 자료와 기준 관리", "승인 단계와 책임 범위 설계", "운영 리포트와 개선 흐름", "채널과 시스템 연동 범위 검토"],
    cta: "확장 운영 상담",
  },
] satisfies readonly BillingPlan[];

export const billingComparisonGroups = [
  {
    label: "기본 운영",
    rows: [
      { feature: "브랜드 자료 등록", start: "포함", team: "포함", expand: "포함", custom: "맞춤" },
      { feature: "브랜드 기준 설정", start: "포함", team: "포함", expand: "포함", custom: "맞춤" },
      { feature: "콘텐츠 초안과 카드뉴스", start: "포함", team: "포함", expand: "포함", custom: "맞춤" },
    ],
  },
  {
    label: "검토와 발행",
    rows: [
      { feature: "담당자 검토 승인", start: "기본", team: "확장", expand: "역할 분리", custom: "맞춤" },
      { feature: "Instagram 게시 연결", start: "포함", team: "포함", expand: "포함", custom: "협의" },
      { feature: "정기 운영 일정", start: "협의", team: "포함", expand: "포함", custom: "맞춤" },
    ],
  },
  {
    label: "확장 범위",
    rows: [
      { feature: "복수 브랜드 운영", start: "-", team: "협의", expand: "포함", custom: "맞춤" },
      { feature: "운영 결과 리포트", start: "-", team: "기본", expand: "포함", custom: "맞춤" },
      { feature: "API와 내부 시스템 연동", start: "-", team: "-", expand: "검토", custom: "별도 협의" },
    ],
  },
] satisfies readonly BillingComparisonGroup[];

export const billingFaqs = [
  {
    question: "왜 정해진 금액 대신 견적으로 안내하나요?",
    answer: "Brand Pilot은 브랜드 수, 월간 콘텐츠 수, 검토 인원과 게시 범위에 따라 필요한 운영량이 달라집니다. 사용하지 않는 범위를 포함한 일괄 요금 대신 현재 운영에 필요한 범위를 확인한 뒤 견적을 안내합니다.",
  },
  {
    question: "도입 전에 어떤 정보를 준비해야 하나요?",
    answer: "운영할 브랜드 수, 현재 월간 발행량, 콘텐츠를 검토하는 담당자, 연결할 Instagram 계정과 참고 중인 자료를 알려주시면 됩니다. 정리된 문서가 없어도 상담에서 함께 확인할 수 있습니다.",
  },
  {
    question: "초기 설정 비용과 월 운영 비용은 어떻게 구분되나요?",
    answer: "브랜드 자료와 운영 기준을 처음 구성하는 범위는 초기 설정으로, 이후 콘텐츠 생성과 검토, 게시 지원은 월 운영 범위로 구분합니다. 최종 금액과 결제 주기는 견적서 또는 계약서에서 확인할 수 있습니다.",
  },
  {
    question: "운영 중에 플랜 범위를 바꿀 수 있나요?",
    answer: "네. 브랜드, 담당자, 발행량 또는 게시 범위가 달라지면 다음 운영 주기부터 범위를 다시 정할 수 있습니다. 변경 시점과 비용은 적용 전에 안내합니다.",
  },
  {
    question: "Instagram 외 채널도 연결할 수 있나요?",
    answer: "현재 기본 게시 자동화 범위는 Instagram입니다. 다른 채널은 콘텐츠 형식, 권한과 운영 정책이 달라 맞춤 운영에서 별도로 검토합니다.",
  },
] satisfies readonly BillingFaq[];
