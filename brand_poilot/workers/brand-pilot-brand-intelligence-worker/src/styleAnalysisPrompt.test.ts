import { describe, expect, it } from "vitest";
import { buildStyleAnalysisPrompt } from "./styleAnalysisPrompt.js";

describe("style analysis prompt", () => {
  it("limits analysis to observed visual structure", () => {
    const prompt = buildStyleAnalysisPrompt();
    expect(prompt).toContain("직접 관찰되는 시각 구조만");
    expect(prompt).toContain("콘텐츠 사실, 제품 효익, 비교 결론, 브랜드 성과를 추론하지 않는다");
    expect(prompt).toContain("design-style-analysis.v1 JSON 하나만");
  });
});
