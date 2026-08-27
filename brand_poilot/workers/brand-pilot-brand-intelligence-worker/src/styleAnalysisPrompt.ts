export function buildStyleAnalysisPrompt(): string {
  return [
    "등록된 이미지 묶음의 디자인 스타일을 분석하라.",
    "이미지에서 직접 관찰되는 시각 구조만 분석한다.",
    "콘텐츠 사실, 제품 효익, 비교 결론, 브랜드 성과를 추론하지 않는다.",
    "모든 이미지를 하나의 스타일 묶음으로 보고 반복되는 규칙과 변형 범위를 기록한다.",
    "layout, typography, color, graphics, visualCues, promptGuidance를 구체적인 한국어 관찰문으로 작성한다.",
    "보이지 않는 항목은 빈 배열로 둔다. 추정으로 채우지 않는다.",
    "설명이나 Markdown 없이 design-style-analysis.v1 JSON 하나만 반환한다.",
  ].join("\n");
}
