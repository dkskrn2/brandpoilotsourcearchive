import { describe, expect, it } from "vitest";
import { buildAutomatedCardNewsInput } from "./automatedCardNews.js";
import { parseContentGenerationInputV2 } from "./aiContentGenerationInput.js";

describe("automated card news input", () => {
  it("maps scheduled topic and source evidence to the shared card-news contract", () => {
    const result = buildAutomatedCardNewsInput({
      contentTopicId: "topic-1",
      brand: {
        name: "Growthline",
        categoryContext: "브랜드 콘텐츠 운영",
        primaryCustomer: "콘텐츠 담당자",
        description: "자사 자료를 근거로 콘텐츠를 운영합니다.",
        tone: "명확하고 실무적으로",
        brandColor: "파란색",
        intelligence: {
          versionId: "analysis-1",
          profile: { primaryTarget: "브랜드 콘텐츠 담당자", coreAppeal: "반복 운영 감소" },
        },
      },
      topic: {
        title: "콘텐츠 승인 지연을 줄이는 방법",
        angle: "담당자와 승인 기한을 먼저 정한다",
        targetCustomer: "콘텐츠 담당자",
        region: null,
        season: null,
        notes: "실무 체크리스트 중심",
      },
      representativeUrl: "https://example.com/service",
      sourceMaterials: [{
        sourceType: "owned",
        contentUrl: "https://example.com/service",
        content: "승인 담당자와 승인 기한을 정하면 게시 일정의 지연을 줄일 수 있습니다.",
      }],
    });

    expect(() => parseContentGenerationInputV2(result)).not.toThrow();
    expect(result).toMatchObject({
      contractVersion: "content-generation-input.v2",
      contentType: "card_news",
      subject: {
        type: "service",
        sourceUrl: "https://example.com/service",
      },
      message: {
        target: { name: "콘텐츠 담당자" },
        appeal: { title: "담당자와 승인 기한을 먼저 정한다" },
      },
      creativeDirection: {
        aspectRatio: "1:1",
        outputCount: 1,
        selectedColor: "파란색",
      },
    });
    expect(JSON.stringify(result.subject.facts)).toContain("승인 담당자");
    expect(JSON.stringify(result.brandContext.context)).toContain("https://example.com/service");
    expect(result.brandContext.context).toMatchObject({
      brandIntelligence: {
        versionId: "analysis-1",
        profile: { primaryTarget: "브랜드 콘텐츠 담당자", coreAppeal: "반복 운영 감소" },
      },
    });
  });

  it("keeps the contract valid when a topic has no public URL", () => {
    const result = buildAutomatedCardNewsInput({
      contentTopicId: "topic-without-url",
      brand: { name: "Growthline", brandColor: null },
      topic: { title: "운영 체크리스트", angle: "반복 업무 줄이기" },
      representativeUrl: null,
      sourceMaterials: [],
    });

    expect(() => parseContentGenerationInputV2(result)).not.toThrow();
    expect(result.subject.sourceUrl).toBe("urn:brand-pilot:topic:topic-without-url");
    expect(result.creativeDirection.selectedColor).toBe("#2563eb");
  });
});
