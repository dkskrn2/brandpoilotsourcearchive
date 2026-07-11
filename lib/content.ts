export type ContentSection = {
  title: string;
  paragraphs: string[];
  points?: string[];
};

export type ContentArticle = {
  slug: string;
  category: string;
  title: string;
  summary: string;
  publishedAt: string;
  readingTime: string;
  image: string;
  imageAlt: string;
  introduction: string;
  sections: ContentSection[];
};

export const contentArticles: ContentArticle[] = [
  {
    slug: "where-revenue-flow-stops",
    category: "Growth Strategy",
    title: "매출은 결과입니다. 먼저 흐름이 멈춘 지점을 봐야 합니다",
    summary: "유입, 탐색, 문의, 구매가 이어지는 과정에서 어디가 막혔는지 확인하는 진단 순서를 정리합니다.",
    publishedAt: "2026.07.11",
    readingTime: "6분",
    image: "/images/generated/revenue-diagnostic-v2.png",
    imageAlt: "유입부터 구매까지 이어지는 매출 흐름의 진단 구조",
    introduction: "매출이 떨어졌을 때 광고 예산이나 화면 디자인부터 바꾸면 원인을 놓치기 쉽습니다. 고객이 들어오고 판단하고 행동하는 흐름을 먼저 나눠 봐야 합니다.",
    sections: [
      {
        title: "매출 문제를 한 숫자로 보면 안 되는 이유",
        paragraphs: ["최종 매출은 유입량, 고객의 이해, 신뢰, 가격 판단, 문의 과정이 겹쳐서 만들어진 결과입니다. 한 지표만 보면 실제 병목이 아닌 곳에 비용을 쓰게 됩니다.", "먼저 고객이 다음 단계로 넘어가기 위해 무엇을 알아야 하는지 적고, 단계별로 확인할 수 있는 증거를 연결해야 합니다."]
      },
      {
        title: "진단은 고객의 순서대로 진행합니다",
        paragraphs: ["사이트 내부의 조직 구조가 아니라 고객이 실제로 겪는 순서로 살펴봅니다."],
        points: ["어떤 경로로 들어왔는지 확인합니다.", "첫 화면에서 무엇을 이해했는지 확인합니다.", "비교와 신뢰에 필요한 정보가 있었는지 확인합니다.", "문의나 구매 직전에 생긴 부담을 확인합니다."]
      },
      {
        title: "개선 순서는 영향과 근거로 정합니다",
        paragraphs: ["모든 문제를 한꺼번에 고칠 필요는 없습니다. 고객 이탈에 미치는 영향이 크고, 데이터와 인터뷰에서 반복해서 확인되는 구간부터 바꾸는 편이 안전합니다.", "작은 개선이라도 무엇을 바꿨고 어떤 반응을 기대하는지 남겨야 다음 판단의 기준이 됩니다."]
      }
    ]
  },
  {
    slug: "research-before-redesign",
    category: "UX Research",
    title: "리뉴얼 전에 고객이 멈추는 이유부터 확인해야 합니다",
    summary: "보기 좋은 화면보다 먼저 확인해야 할 고객의 질문과 행동 신호를 살펴봅니다.",
    publishedAt: "2026.07.08",
    readingTime: "5분",
    image: "/images/generated/ux-research-journey.webp",
    imageAlt: "고객 행동과 인터뷰 기록을 하나의 여정으로 연결하는 리서치 구조",
    introduction: "리뉴얼은 화면을 새로 그리는 일이 아니라 고객의 판단 흐름을 다시 연결하는 일입니다. 현재 화면이 왜 작동하지 않는지 모르면 새 디자인에서도 같은 문제가 반복됩니다.",
    sections: [
      {
        title: "행동과 이유는 함께 봐야 합니다",
        paragraphs: ["분석 도구는 고객이 어디서 나갔는지 알려주지만 왜 나갔는지는 말해주지 않습니다. 인터뷰는 이유를 들려주지만 실제 행동의 크기를 보여주지는 않습니다.", "두 증거를 같은 고객 여정 위에 놓으면 무엇을 먼저 고쳐야 할지 선명해집니다."]
      },
      {
        title: "고객의 질문을 화면 구조로 바꿉니다",
        paragraphs: ["고객이 가격을 보기 전에 신뢰를 확인한다면 회사 소개와 사례가 먼저 필요할 수 있습니다. 기능보다 위험을 걱정한다면 사용 과정과 지원 범위를 앞에서 설명해야 합니다."],
        points: ["처음 들어왔을 때 무엇을 찾는지", "비교할 때 어떤 기준을 쓰는지", "결정 직전에 무엇을 걱정하는지"]
      },
      {
        title: "리뉴얼의 범위가 작아질 수도 있습니다",
        paragraphs: ["진단 결과 전체 리뉴얼보다 핵심 페이지의 정보 순서와 문구를 바꾸는 것이 더 적합할 수 있습니다. 문제를 먼저 정의하면 필요한 범위만 정확하게 설계할 수 있습니다."]
      }
    ]
  },
  {
    slug: "decision-ready-data",
    category: "Data Analytics",
    title: "보고서가 아니라 다음 결정을 만드는 데이터 분석",
    summary: "많은 지표를 나열하지 않고 행동으로 이어지는 비교 기준을 만드는 방법을 설명합니다.",
    publishedAt: "2026.07.04",
    readingTime: "7분",
    image: "/images/generated/data-decision-system.webp",
    imageAlt: "여러 데이터 흐름이 하나의 의사결정 기준으로 모이는 분석 구조",
    introduction: "데이터가 많아도 어떤 행동을 바꿀지 정하지 못하면 분석은 보고서에서 끝납니다. 질문, 비교 기준, 다음 행동이 한 세트로 연결돼야 합니다.",
    sections: [
      {
        title: "지표보다 질문을 먼저 정합니다",
        paragraphs: ["전환율이 왜 떨어졌는지 알고 싶다면 전체 평균보다 유입 경로, 기기, 신규 고객 여부를 나눠 비교해야 합니다. 분석 단위는 화면에 있는 차트가 아니라 해결하려는 질문이 정합니다."]
      },
      {
        title: "비교할 기준이 있어야 변화가 보입니다",
        paragraphs: ["숫자 하나만 보면 좋은지 나쁜지 판단하기 어렵습니다. 이전 기간, 목표, 고객군, 실험 전후처럼 의미 있는 기준을 정해야 변화의 크기와 방향을 읽을 수 있습니다."],
        points: ["어떤 결정을 위해 보는 숫자인지", "무엇과 비교해야 의미가 생기는지", "결과에 따라 어떤 행동을 바꿀지"]
      },
      {
        title: "분석 결과에는 다음 행동이 남아야 합니다",
        paragraphs: ["결과를 공유할 때는 관찰한 사실과 해석, 실행할 일을 구분합니다. 그러면 팀이 숫자의 의미를 다시 논쟁하는 시간을 줄이고 실험과 개선으로 넘어갈 수 있습니다."]
      }
    ]
  },
  {
    slug: "repeatable-content-operations",
    category: "Content Operations",
    title: "콘텐츠가 꾸준히 나오게 만드는 운영 기준",
    summary: "글감 수집부터 초안, 이미지, 검토와 게시까지 반복 가능한 콘텐츠 흐름을 설계합니다.",
    publishedAt: "2026.07.01",
    readingTime: "5분",
    image: "/images/generated/content-operations-loop.webp",
    imageAlt: "소스 수집부터 게시까지 순환하는 콘텐츠 운영 흐름",
    introduction: "콘텐츠가 멈추는 이유는 아이디어가 부족해서가 아니라 무엇을 근거로 누가 검토할지 정해지지 않았기 때문인 경우가 많습니다.",
    sections: [
      {
        title: "글감은 떠올리는 것이 아니라 쌓는 것입니다",
        paragraphs: ["고객 질문, 제품 업데이트, 인터뷰, 시장 자료를 역할에 맞게 모으면 매번 빈 화면에서 시작하지 않아도 됩니다. 자료마다 사실 근거인지 관점을 찾는 참고 자료인지 구분해야 합니다."]
      },
      {
        title: "브랜드 기준을 초안 전에 적용합니다",
        paragraphs: ["브랜드가 말하는 고객, 서비스 범위, 목소리, 피해야 할 표현을 먼저 정리합니다. 이 기준이 있어야 작성자가 바뀌어도 글의 방향이 크게 흔들리지 않습니다."],
        points: ["누구에게 말하는지", "어떤 근거를 사용할지", "어떤 표현을 피할지", "누가 게시를 승인할지"]
      },
      {
        title: "자동화 뒤에도 사람의 판단을 남깁니다",
        paragraphs: ["반복 작업은 줄일 수 있지만 새로운 주장이나 민감한 표현은 사람이 확인해야 합니다. 자동화 범위와 승인 조건을 구분하면 속도와 신뢰를 함께 지킬 수 있습니다."]
      }
    ]
  }
];

export function getContentArticle(slug: string) {
  return contentArticles.find((article) => article.slug === slug);
}
