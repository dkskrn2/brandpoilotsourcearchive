import { describe, expect, it } from "vitest";
import { isOfferingLocationQuestion, isOfferingQuestion, isProductQuestion } from "./db.js";

describe("compiled Wiki query routing", () => {
  it("routes broad offering and product detail questions to verified offering pages", () => {
    expect(isOfferingQuestion("여기는 어떤 서비스를 제공하나요?")).toBe(true);
    expect(isOfferingQuestion("어떤 제품이 있나요?")).toBe(true);
    expect(isOfferingQuestion("자세한 제품 정보는 어디에서 확인하나요?")).toBe(true);
  });

  it("keeps operational and informational questions on general retrieval", () => {
    expect(isOfferingQuestion("콘텐츠는 언제 게시되나요?")).toBe(false);
    expect(isOfferingQuestion("고객 인터뷰는 어떻게 하나요?")).toBe(false);
  });

  it("only prioritizes top-level offering links when the user asks where to find details", () => {
    expect(isOfferingLocationQuestion("자세한 제품 정보는 어디에서 확인하나요?")).toBe(true);
    expect(isOfferingLocationQuestion("어떤 제품이 있나요?")).toBe(false);
  });

  it("recognizes product wording without treating every offering question as a product question", () => {
    expect(isProductQuestion("어떤 제품이 있나요?")).toBe(true);
    expect(isProductQuestion("어떤 서비스를 제공하나요?")).toBe(false);
  });
});
