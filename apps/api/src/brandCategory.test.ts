import { describe, expect, it } from "vitest";
import { formatBrandCategoryContext, normalizeCustomSubcategory } from "./brandCategory";

describe("brand category context", () => {
  it("formats the primary category and ordered subcategories", () => {
    expect(formatBrandCategoryContext({
      primaryCategory: { code: "business_professional", name: "비즈니스·전문 서비스" },
      subcategories: [
        { type: "system", code: "marketing_consulting", name: "마케팅 컨설팅" },
        { type: "custom", code: null, name: "세일즈 메시지 설계" }
      ]
    })).toBe("비즈니스·전문 서비스 / 마케팅 컨설팅, 세일즈 메시지 설계");
  });

  it("returns 미설정 without a primary category", () => {
    expect(formatBrandCategoryContext({ primaryCategory: null, subcategories: [] })).toBe("미설정");
  });

  it("normalizes custom subcategory display and key with NFKC", () => {
    expect(normalizeCustomSubcategory("  Ｍarketing  ")).toEqual({
      name: "Marketing",
      key: "marketing"
    });
  });
});
