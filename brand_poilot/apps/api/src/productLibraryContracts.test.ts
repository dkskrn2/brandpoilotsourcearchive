import { describe, expect, it } from "vitest";
import { parseProductServiceProfile } from "./productLibraryContracts.js";

const valid = {
  contractVersion: "product-service.v1",
  name: "모종 애드",
  kind: "service",
  description: "SNS 마케팅 통합 솔루션",
  features: ["콘텐츠 생성"],
  benefits: ["운영 시간 절감"],
  cautions: [],
  audiences: [{ id: "owner", name: "브랜드 운영자" }],
  appealsByTarget: { owner: [{ id: "time", text: "시간 절감" }] },
  evergreenPurchaseInfo: "상담 후 이용",
  sourceUrls: ["https://example.com/product"],
};

describe("product service profile contract", () => {
  it("accepts evergreen reusable product information", () => {
    expect(parseProductServiceProfile(valid)).toEqual(valid);
  });

  it.each(["promotion", "offerEndsAt", "discountEndsAt"])("rejects period offer field %s", (field) => {
    expect(() => parseProductServiceProfile({ ...valid, [field]: "기간 한정" })).toThrow(field);
  });
});
