import { describe, expect, it } from "vitest";
import { parseDesignStyleAnalysisV1 } from "./designStyle.js";

const validAnalysis = {
  contractVersion: "design-style-analysis.v1",
  layout: {
    composition: ["좌우 분할"],
    hierarchy: ["큰 제목 뒤 보조 설명"],
    spacing: ["카드 사이 넓은 여백"],
    alignment: ["제목 왼쪽 정렬"],
    recurringModules: ["상단 라벨"],
  },
  typography: {
    families: ["고딕 계열"],
    weightHierarchy: ["제목 굵게"],
    scale: ["제목 대비 본문 작게"],
    placement: ["제목 상단"],
  },
  color: {
    palette: ["보라색과 흰색"],
    contrast: ["밝은 배경과 진한 제목"],
    background: ["밝은 단색"],
    accentUsage: ["핵심 수치에 보라색"],
  },
  graphics: {
    media: ["인물 일러스트"],
    shapes: ["둥근 카드"],
    icons: ["단순 선 아이콘"],
    texture: ["질감 없음"],
  },
  visualCues: {
    comparison: ["양쪽 항목 병렬 배치"],
    humor: [],
    practicality: ["체크 항목 묶음"],
    empathy: [],
  },
  promptGuidance: {
    use: ["명확한 시각 위계"],
    avoid: ["복잡한 배경"],
  },
} as const;

describe("design style analysis v1", () => {
  it("accepts the closed visual-language contract", () => {
    expect(parseDesignStyleAnalysisV1(validAnalysis)).toEqual(validAnalysis);
  });

  it("rejects unknown keys and non-visual claims", () => {
    expect(() => parseDesignStyleAnalysisV1({ ...validAnalysis, contentTopic: "상품 효익" }))
      .toThrow("design_style_analysis_v1_invalid");
  });

  it("requires trimmed unique bounded observations", () => {
    expect(() => parseDesignStyleAnalysisV1({
      ...validAnalysis,
      layout: { ...validAnalysis.layout, composition: ["좌우 분할", "좌우 분할"] },
    })).toThrow("design_style_analysis_v1_invalid");
    expect(() => parseDesignStyleAnalysisV1({
      ...validAnalysis,
      layout: { ...validAnalysis.layout, composition: [" 좌우 분할"] },
    })).toThrow("design_style_analysis_v1_invalid");
    expect(() => parseDesignStyleAnalysisV1({
      ...validAnalysis,
      promptGuidance: { ...validAnalysis.promptGuidance, use: Array.from({ length: 21 }, (_, index) => `규칙 ${index}`) },
    })).toThrow("design_style_analysis_v1_invalid");
  });
});
