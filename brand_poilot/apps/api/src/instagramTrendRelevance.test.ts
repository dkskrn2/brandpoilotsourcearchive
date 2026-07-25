import { describe, expect, it } from "vitest";
import { assessInstagramTrendRelevance } from "./instagramTrendRelevance.js";

describe("Instagram trend semantic relevance", () => {
  it("keeps a caption that matches the requested hashtag and brand field", () => {
    expect(assessInstagramTrendRelevance({
      hashtag: "SaaS",
      caption: "#SaaS 운영 자동화와 구독 소프트웨어 성장 전략",
      categoryTerms: ["IT 소프트웨어", "업무 자동화", "SaaS"],
    })).toMatchObject({ relevant: true });
  });

  it("filters an ambiguous short hashtag when the caption has no field context", () => {
    expect(assessInstagramTrendRelevance({
      hashtag: "IT",
      caption: "I finally made it! #it #happy #family",
      categoryTerms: ["IT 소프트웨어", "개발", "데이터", "보안"],
    })).toMatchObject({ relevant: false, reason: "ambiguous_hashtag_without_category_context" });
  });

  it("filters media without enough caption context", () => {
    expect(assessInstagramTrendRelevance({
      hashtag: "마케팅",
      caption: null,
      categoryTerms: ["마케팅 컨설팅", "브랜드 전략"],
    })).toMatchObject({ relevant: false, reason: "caption_missing" });
  });
});
