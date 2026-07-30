export const INSTAGRAM_CARD_IMAGE_PROMPT_VERSION = "instagram.card-image.v3";

export interface InstagramCardImageContext {
  brandProfile: {
    categoryContext: string | null;
    serviceDescription: string | null;
    primaryCustomer: string | null;
    tone: string | null;
  };
  masterDraft: {
    title: string;
    contentTheme: string;
    coreMessage: string;
    targetAudience: string;
    customerProblem: string;
    keyPoints: string[];
    supportingEvidence: string[];
  };
  instagram: {
    title: string;
    caption: string | null;
    hashtags: string[];
  };
}

function text(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function list(values: string[]) {
  return values.map(text).filter(Boolean).map((value) => `- ${value}`);
}

export function buildInstagramCardImagePrompt(context: InstagramCardImageContext) {
  const { brandProfile, masterDraft, instagram } = context;
  return [
    "Instagram 카드뉴스 전체 이미지를 생성하세요.",
    "가로와 세로가 같은 정방형 PNG 카드여야 합니다.",
    "아래 브랜드 맥락과 콘텐츠 초안을 읽고 가장 적절한 카드뉴스 구성을 먼저 판단하세요.",
    "카드 수는 내용에 맞게 결정하되 최소 1장, 최대 5장으로 제한하세요.",
    "각 카드는 하나의 독립된 PNG 파일로 생성하세요.",
    "하나의 이미지 안에 여러 카드, 콜라주, 분할 패널을 넣지 마세요.",
    "카드마다 하나의 파일만 생성하고 카드 순서대로 전달하세요.",
    "한국어 텍스트를 최대한 정확하게 이미지에 넣으세요.",
    "브랜드형 콘텐츠처럼 깔끔하고 읽기 쉬운 편집 디자인을 사용하세요.",
    "스톡사진 느낌보다 정보형 카드뉴스 디자인을 우선하세요.",
    "이 카드뉴스는 독자에게 인사이트를 제공하고, 공감, 공유, 저장할 만한 의미 있는 콘텐츠여야 합니다.",
    "첫 장은 강한 훅이 보이는 카드로 구성하세요. 사용자가 스크롤을 멈추고 읽고 싶게 만드는 문장이어야 합니다.",
    "이후 카드는 공감, 정보성, 사례 정리, 문제 인식, 실용 인사이트 중 내용에 가장 적합한 흐름으로 구성하세요.",
    "필요하면 놀라움, 공감, 불안, 욕망 같은 심리적 동기를 시각적으로 활용해도 됩니다.",
    "입력에 없는 사실, 숫자, 가격, 효능, 보장, 과장, 공포 조장, 클릭베이트는 만들지 마세요.",
    "로고나 브랜드명을 직접 삽입하지 마세요.",
    "Instagram 본문은 빈 줄로 구분한 2개 이상 문단으로 작성하세요.",
    "Instagram 해시태그는 정확히 5개를 작성하세요.",
    "카드 이미지와 본문에서 '자세히 확인하기', '더 알아보기', '문의하기', '상담 신청', '지금 확인' 같은 CTA 문구와 버튼을 사용하지 마세요.",
    "워터마크, UI 크롬, 가짜 앱 화면, QR 코드, 읽기 어려운 작은 텍스트를 넣지 마세요.",
    "",
    "[브랜드 맥락]",
    `- 분야: ${text(brandProfile.categoryContext)}`,
    `- 서비스 설명: ${text(brandProfile.serviceDescription)}`,
    `- 주요 고객: ${text(brandProfile.primaryCustomer)}`,
    `- 톤: ${text(brandProfile.tone)}`,
    "",
    "[콘텐츠 초안]",
    `- 제목: ${text(masterDraft.title)}`,
    `- 콘텐츠 주제: ${text(masterDraft.contentTheme)}`,
    `- 핵심 메시지: ${text(masterDraft.coreMessage)}`,
    `- 대상: ${text(masterDraft.targetAudience)}`,
    `- 고객 문제: ${text(masterDraft.customerProblem)}`,
    "- 핵심 포인트:",
    ...list(masterDraft.keyPoints),
    "- 근거:",
    ...list(masterDraft.supportingEvidence),
    "",
    "[Instagram 게시 정보]",
    `- 최종 제목: ${text(instagram.title)}`,
    `- 캡션: ${text(instagram.caption)}`,
    `- 해시태그: ${instagram.hashtags.map(text).filter(Boolean).join(" ")}`
  ].join("\n");
}
