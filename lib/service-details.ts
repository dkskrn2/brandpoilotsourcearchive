export type ServiceDetail = {
  title: string;
  eyebrow: string;
  headline: string;
  description: string;
  image: string;
  imageAlt: string;
  sections: Array<{ title: string; body: string; points: string[] }>;
  process: string[];
};

export const serviceDetails = {
  "service-research": {
    title: "UX 리서치",
    eyebrow: "RESEARCH LENS",
    headline: "고객은 왜 들어오고, 어디서 멈출까요?",
    description: "사용자가 처음부터 끝까지 겪는 경험을 관찰하고, 추측이 아닌 근거로 개선 순서를 찾습니다.",
    image: "/images/generated/ux-research-journey.webp",
    imageAlt: "고객 행동과 인터뷰 기록이 고객 여정으로 연결되는 리서치 시각화",
    sections: [
      { title: "사용 과정을 보고 개선 순서를 찾습니다", body: "화면의 완성도보다 사용자가 목표를 달성하는 전체 과정을 살핍니다.", points: ["이탈 지점과 반복되는 불편 확인", "행동과 인터뷰를 함께 비교", "증거를 기준으로 개선 우선순위 합의"] },
      { title: "질문에 따라 조사 방법을 선택합니다", body: "정성·정량 방법을 목적에 맞게 조합해 이유와 규모를 함께 확인합니다.", points: ["사용자 인터뷰와 사용성 테스트", "서베이와 VoC 분석", "경쟁 서비스 벤치마킹"] },
      { title: "바꾸고 다시 측정합니다", body: "리서치 결과를 보고서로 끝내지 않고 실제 화면과 운영 변경으로 연결합니다.", points: ["목표와 가설 정의", "조사 실행과 반복 패턴 분석", "개선 전후 지표 비교"] }
    ],
    process: ["행동 관찰", "이유 확인", "여정 연결", "개선 검증"]
  },
  "service-analytics": {
    title: "데이터 분석",
    eyebrow: "DECISION SYSTEM",
    headline: "데이터는 쌓이는데, 왜 결정은 늦어질까요?",
    description: "흩어진 숫자를 비교 가능한 기준으로 묶고 다음 행동을 선택할 수 있는 정보로 바꿉니다.",
    image: "/images/generated/data-decision-system.webp",
    imageAlt: "여러 데이터 흐름이 하나의 의사결정 지점으로 모이는 분석 시각화",
    sections: [
      { title: "분석은 툴을 열기 전에 시작합니다", body: "무엇을 확인하고 어떤 결정을 내릴지 먼저 정해야 데이터가 답할 수 있습니다.", points: ["문제와 가설 정의", "문제에 맞는 지표 선택", "비교 기준과 평가 방식 합의"] },
      { title: "결과와 결론을 구분합니다", body: "숫자의 차이를 보여주는 데서 멈추지 않고 그 차이가 무엇을 의미하는지 설명합니다.", points: ["현상과 원인 분리", "절대값과 분포 함께 확인", "결론을 우선순위로 변환"] },
      { title: "마지막 문장은 다음 행동입니다", body: "분석 결과가 실제 업무의 선택과 실험으로 이어지도록 실행 단위를 정합니다.", points: ["실행 가능한 개선안", "담당자와 완료 기준", "변경 후 재측정"] }
    ],
    process: ["목적 정의", "데이터 비교", "결론 도출", "다음 행동"]
  },
  "service-design": {
    title: "전환 중심 설계",
    eyebrow: "CONVERSION PATH",
    headline: "방문자는 있는데, 왜 다음 행동은 없을까요?",
    description: "가치와 근거, CTA를 고객이 판단하는 순서로 배치해 복잡한 선택을 명확한 행동 경로로 바꿉니다.",
    image: "/images/generated/conversion-blueprint.webp",
    imageAlt: "복잡한 선택지가 명확한 행동 경로로 정리되는 전환 설계 시각화",
    sections: [
      { title: "보기 좋은 화면을 다음 행동으로 연결합니다", body: "시각적 완성도와 함께 고객이 무엇을 보고 결정해야 하는지 설계합니다.", points: ["핵심 가치와 차별점 배치", "주장을 뒷받침하는 증거", "결정에 필요한 정보 우선순위"] },
      { title: "CTA 앞의 망설임을 줄입니다", body: "문의와 구매 직전에 남는 가격·범위·진행 방식의 불안을 먼저 해결합니다.", points: ["버튼 의미와 다음 단계 명시", "반복되거나 늦은 CTA 정리", "위험과 기대 결과 설명"] },
      { title: "페이지마다 다른 질문에 답합니다", body: "랜딩은 관심, 서비스는 이해, 상세와 사례는 신뢰를 담당하도록 역할을 나눕니다.", points: ["유입 맥락별 메시지", "정보 중복 제거", "자연스러운 페이지 연결"] }
    ],
    process: ["정보", "판단", "근거", "행동"]
  },
  "service-consulting": {
    title: "비즈니스 로직 설계",
    eyebrow: "OPERATING LOGIC",
    headline: "기능은 늘어나는데, 왜 일은 더 복잡해질까요?",
    description: "개발 전에 업무 흐름과 예외 조건, 권한과 완료 기준을 정리해 운영이 흔들리지 않게 합니다.",
    image: "/images/generated/conversion-blueprint.webp",
    imageAlt: "복잡한 업무 규칙이 일관된 운영 경로로 정리되는 시각화",
    sections: [
      { title: "기능보다 실제 업무 흐름부터 정합니다", body: "누가 언제 무엇을 판단하고 다음 단계로 넘기는지 한 흐름으로 정리합니다.", points: ["현재 업무와 병목 확인", "담당자와 권한 구분", "예외 상황과 복구 방식"] },
      { title: "되돌리기 어려운 기준을 먼저 합의합니다", body: "정산, 상태값, 데이터 구조처럼 나중에 바꾸기 어려운 결정을 선행합니다.", points: ["상태 전이와 완료 조건", "데이터 소유권과 보존", "운영자 통제 범위"] },
      { title: "요구사항에 우선순위를 부여합니다", body: "모든 기능을 동시에 만들지 않고 고객 가치와 운영 위험을 기준으로 순서를 정합니다.", points: ["필수·선택 기능 분리", "의존 관계와 출시 단위", "검수 가능한 완료 기준"] }
    ],
    process: ["업무 흐름", "판단 규칙", "권한", "운영 기준"]
  },
  "service-writing": {
    title: "설득 카피라이팅",
    eyebrow: "MESSAGE FLOW",
    headline: "설명은 많은데, 왜 고객은 망설일까요?",
    description: "기능을 나열하는 대신 고객의 질문에 답하고, 근거와 다음 행동이 이어지는 문장을 설계합니다.",
    image: "/images/generated/content-operations-loop.webp",
    imageAlt: "아이디어가 문장과 이미지, 검토와 발행을 거쳐 개선되는 콘텐츠 흐름",
    sections: [
      { title: "고객이 판단할 이유를 먼저 씁니다", body: "제품이 무엇을 하는지보다 고객의 상황이 어떻게 달라지는지 먼저 설명합니다.", points: ["핵심 약속 한 문장", "고객 문제와 기대 결과", "차별점을 증명하는 근거"] },
      { title: "망설임을 구매 전에 해결합니다", body: "가격, 신뢰, 위험, 대안에 관한 질문을 고객이 떠올리는 순서대로 답합니다.", points: ["자주 묻는 질문", "사례와 수치", "범위와 제한 조건"] },
      { title: "버튼 다음의 일을 분명히 합니다", body: "CTA를 누르면 누가 언제 연락하고 무엇을 준비하는지 알려 행동 부담을 낮춥니다.", points: ["구체적인 CTA", "진행 과정 안내", "후속 메시지 일관성"] }
    ],
    process: ["망설임", "약속", "근거", "다음 행동"]
  },
  "service-startup": {
    title: "스타트업 구축",
    eyebrow: "LAUNCH LOOP",
    headline: "아이디어는 있는데, 어디까지 만들어야 할까요?",
    description: "검증에 필요한 범위만 빠르게 출시하고 실제 사용 데이터를 다음 기능의 우선순위로 연결합니다.",
    image: "/images/generated/content-operations-loop.webp",
    imageAlt: "아이디어가 MVP 출시와 측정, 개선으로 순환하는 제품 운영 흐름",
    sections: [
      { title: "실제 고객이 쓸 수 있는 서비스로 옮깁니다", body: "화면 시안에서 멈추지 않고 가입, 핵심 기능, 운영 도구까지 연결합니다.", points: ["핵심 사용자 여정", "데이터와 권한 구조", "배포와 운영 환경"] },
      { title: "지금 필요한 기능과 나중 기능을 나눕니다", body: "가설 검증에 직접 필요한 기능을 먼저 만들고 나머지는 관찰 결과에 따라 결정합니다.", points: ["검증할 가설", "최소 출시 범위", "후속 기능 판단 기준"] },
      { title: "출시 후 학습을 제품에 반영합니다", body: "지표와 사용자 피드백을 함께 보고 다음 실험의 순서를 정합니다.", points: ["핵심 행동 측정", "사용자 피드백 수집", "반복 출시와 개선"] }
    ],
    process: ["가설", "MVP", "출시", "학습"]
  }
} satisfies Record<string, ServiceDetail>;

export type ServiceSlug = keyof typeof serviceDetails;
