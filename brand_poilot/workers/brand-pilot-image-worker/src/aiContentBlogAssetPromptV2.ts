import {
  buildAiContentManualAssetCommonInstructions,
  type AiContentManualAssetPromptV2Input,
} from "./aiContentManualAssetPromptV2Common.js";

export function buildAiContentBlogAssetPromptV2(input: AiContentManualAssetPromptV2Input): string {
  if (input.renderContract.blogInsertionContext === null) {
    throw new Error("ai_content_blog_insertion_binding_invalid");
  }
  return [
    "당신은 Brand Pilot에서 실제 게시할 블로그 글에 삽입되는 보조 이미지를 완성하는 콘텐츠 디자이너입니다.",
    "",
    "content-plan.json의 블로그 HTML은 이미 최종 글로 확정되었습니다. HTML을 다시 작성하지 마세요.",
    "article을 재작성하거나 글 전체를 요약·수정·대체하지 말고, 기존 최종 HTML의 정확한 삽입 문맥에 맞는 보조 이미지 한 장만 만드세요.",
    "",
    `<이번 콘텐츠>\n출력 형식: 블로그 최종 HTML의 보조 PNG\n콘텐츠 성격: ${input.renderContract.purpose}\n현재 이미지: ${input.renderContract.assetIndex}\n현재 이미지 역할: 시스템 고정 렌더 바인딩 JSON의 currentAsset.role`,
    "",
    buildAiContentManualAssetCommonInstructions(input),
    "",
    "<블로그 보조 이미지 제작 원칙>",
    "1. inputs/blog-insertion-context.json을 읽고 placeholder, altText, nearestHeading, previousParagraph, nextParagraph와 role이 나타내는 정확한 삽입 문맥을 이해하세요.",
    "2. content-generation-input.json의 고정 원문·선택 구성안·브랜드 맥락과 content-plan.json의 최종 HTML을 함께 참고하되 글이나 HTML을 다시 쓰지 마세요.",
    "3. 현재 placeholder에 들어갈 보조 이미지 한 장만 생성하세요. 전체 페이지 스크린샷을 만들지 말고 글 전체를 카드뉴스 한 장으로 축약하지 마세요.",
    "4. 이미지는 주변 문단의 의미를 보조해야 하며 원문에 없는 통계, 제품 효능, 수치, 인물 발언과 사실을 새로 만들지 마세요.",
    "5. 마케팅성 콘텐츠라면 제공된 제품·서비스 고정 정보만 사용하고 제공되지 않은 가격, 성능, 효능과 혜택을 만들지 마세요.",
    "6. 설명용 도표에 문자가 꼭 필요하면 모바일과 블로그 본문에서 읽을 수 있는 정확한 한국어만 사용하세요. 긴 본문을 이미지 안에 다시 옮기지 마세요.",
    "7. gpt-image-2를 사용하여 정확한 삽입 문맥용 최종 PNG 한 장을 완성하세요.",
    "</블로그 보조 이미지 제작 원칙>",
  ].join("\n");
}
