import { describe, expect, it } from "vitest";
import { EMPHASIS_ANGLES, EXPRESSION_METHODS, editorialStrategyPromptRules } from "./editorialStrategyCatalog.js";

describe("editorial strategy catalog", () => {
  it("keeps the approved method and emphasis catalogs", () => {
    expect(EXPRESSION_METHODS).toHaveLength(9);
    expect(EMPHASIS_ANGLES).toHaveLength(9);
    expect(EXPRESSION_METHODS.map(([id]) => id)).toContain("comparison_decision");
    expect(EMPHASIS_ANGLES.map(([id]) => id)).toContain("humor");
  });
  it("selects internally, permits reuse and free composition, and requires substantive differences", () => {
    const prompt = editorialStrategyPromptRules().join("\n");
    expect(prompt).toContain("새 필드로 출력하지 마라");
    expect(prompt).toContain("자유 구성");
    expect(prompt).toContain("같은 표현방식이나 강조 관점");
    expect(prompt).toContain("같은 내용의 재표현이 되지 않게");
  });
});
