import { describe, expect, it } from "vitest";
import { parseDesignStyleInput, parseVisualPresetInput } from "./designStyleContracts.js";

const id = (digit: number) => `${digit}0000000-0000-4000-8000-00000000000${digit}`;

describe("design style customer inputs", () => {
  it("accepts image-only design styles", () => {
    expect(parseDesignStyleInput({
      contractVersion: "design-style-input.v1", name: "비교 카드", referenceItemIds: [id(1)],
    })).toEqual({ contractVersion: "design-style-input.v1", name: "비교 카드", referenceItemIds: [id(1)] });
  });

  it("rejects manual visual tokens and duplicate images", () => {
    expect(() => parseDesignStyleInput({
      contractVersion: "design-style-input.v1", name: "비교 카드", referenceItemIds: [id(1)], colors: [],
    })).toThrow("design_style_input_invalid");
    expect(() => parseDesignStyleInput({
      contractVersion: "design-style-input.v1", name: "비교 카드", referenceItemIds: [id(1), id(1)],
    })).toThrow("design_style_input_invalid");
  });

  it("accepts one style and optional avatar in a preset", () => {
    expect(parseVisualPresetInput({
      contractVersion: "visual-preset-input.v1", name: "기본", designStyleId: id(1), avatarId: null, isDefault: false,
    })).toEqual({ contractVersion: "visual-preset-input.v1", name: "기본", designStyleId: id(1), avatarId: null, isDefault: false });
  });
});
