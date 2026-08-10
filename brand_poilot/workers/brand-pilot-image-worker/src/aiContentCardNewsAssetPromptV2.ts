import {
  buildAiContentManualAssetCommonInstructions,
  type AiContentManualAssetPromptV2Input,
} from "./aiContentManualAssetPromptV2Common.js";

export function buildAiContentCardNewsAssetPromptV2(input: AiContentManualAssetPromptV2Input): string {
  return [
    "당신은 Brand Pilot에서 실제 게시에 사용할 Instagram 카드뉴스용 정방형 카드 콘텐츠 디자이너입니다.",
    "",
    "이번 작업은 단순한 배경 이미지나 장식 이미지를 만드는 작업이 아닙니다.",
    "제공된 원문, 사용자가 선택한 구성안, 전체 카드 흐름과 브랜드 맥락을 이해한 뒤 정보와 메시지, 한국어 문구, 타이포그래피, 레이아웃, 비주얼이 하나로 완성된 게시 가능한 카드뉴스 카드를 제작하는 작업입니다.",
    "",
    `<이번 콘텐츠>\n출력 형식: Instagram 카드뉴스용 정방형 카드 콘텐츠 1:1 비율\n콘텐츠 성격: ${input.renderContract.purpose}\n현재 제작 카드: ${input.renderContract.assetIndex}\n현재 카드 역할: 시스템 고정 렌더 바인딩 JSON의 currentAsset.role`,
    "",
    buildAiContentManualAssetCommonInstructions(input),
    "",
    "<카드뉴스 제작 원칙>",
    "1. content-generation-input.json의 원문과 선택 구성안 전체를 바탕으로 현재 카드에 필요한 한국어 문구를 직접 작성하세요.",
    "2. 현재 카드만 따로 보기 좋은 그림으로 만들지 말고 앞뒤 카드와 이어지는 하나의 카드뉴스로 이해하세요. 전체 outline 안에서 현재 카드가 전달해야 할 메시지를 완성하세요.",
    "3. 문구, 정보 위계, 타이포그래피, 레이아웃과 비주얼을 함께 설계하세요. 글자를 얹기 위한 빈 배경이나 분위기 이미지만 만들지 마세요.",
    "4. 작성한 문구를 별도 설명으로 반환하지 말고 최종 PNG 화면 안에 읽을 수 있는 한국어 콘텐츠로 포함하세요.",
    "5. 서버가 나중에 글자를 합성하거나 서버에서 텍스트 오버레이를 추가하는 단계는 없습니다. 지금 완성된 최종 픽셀을 만드세요.",
    "6. 정보성 콘텐츠라면 독자가 현재 카드만 보아도 그 카드의 핵심을 이해할 수 있어야 합니다.",
    "7. 마케팅성 콘텐츠라면 제공된 제품·서비스 고정 정보만 사용하고 제공되지 않은 가격, 성능, 효능과 혜택을 만들지 마세요.",
    "8. 전체 카드가 같은 콘텐츠로 보이도록 색상, 편집 방향, 타이포그래피와 정보 밀도를 유지하되 현재 카드의 역할에 맞게 구도를 설계하세요.",
    "9. 모바일 Instagram 화면에서 읽을 수 있도록 핵심 문구의 크기와 대비를 확보하고, 문장이 길면 의미를 유지하면서 자연스러운 한국어로 압축하세요.",
    "10. gpt-image-2를 사용하여 현재 카드의 최종 게시용 1:1 PNG 화면을 완성하세요.",
    "</카드뉴스 제작 원칙>",
  ].join("\n");
}
