import { describe, expect, it } from "vitest";
import { parseContentGenerationInput } from "./contracts.js";

function input(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "content-generation-input.v2",
    contentType: "card_news",
    brandContext: {},
    subject: {
      analysisId: "analysis-1",
      analysisVersion: 1,
      analysisContractVersion: "subject-analysis.v1",
      analysisResult: null,
      type: "product",
      sourceUrl: "",
      facts: [],
      research: {},
      selectedImages: [],
    },
    message: {
      target: { id: "target-1" },
      appeal: { id: "appeal-1", targetId: "target-1" },
      qualityBrief: {},
    },
    creativeDirection: {
      prompts: ["정보를 쉽게 설명"],
      brandColor: "#111111",
      selectedColor: "#111111",
      aspectRatio: "1:1",
      outputCount: 1,
    },
    references: [],
    attachments: [],
    ...overrides,
  };
}

function orchestration(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "content-orchestration.v1",
    contentFamily: "informational",
    subject: { mode: "brand_topic", topic: "주제", wikiItemIds: [] },
    target: { id: "target-1", snapshot: { name: "타깃" } },
    strategy: "how_to",
    outputFormat: "card_news",
    channelTargets: ["instagram"],
    brief: { goal: "쉽게 설명" },
    references: [],
    avatar: null,
    ...overrides,
  };
}

describe("card-news content generation contract", () => {
  it("preserves legacy v2 payloads without orchestration", () => {
    expect(parseContentGenerationInput(input()).orchestration).toBeNull();
  });

  it("validates and forwards deterministic orchestration", () => {
    const parsed = parseContentGenerationInput(input({
      orchestration: orchestration(),
      creativeDirection: {
        ...(input().creativeDirection as Record<string, unknown>),
        contentFamily: "informational",
        outputFormat: "card_news",
      },
    }));
    expect(parsed.orchestration).toEqual(orchestration());
    expect(parsed.creativeDirection).toMatchObject({
      contentFamily: "informational",
      outputFormat: "card_news",
    });
  });

  it("rejects mismatched family or output format", () => {
    expect(() => parseContentGenerationInput(input({
      orchestration: orchestration(),
      creativeDirection: {
        ...(input().creativeDirection as Record<string, unknown>),
        contentFamily: "marketing",
        outputFormat: "card_news",
      },
    }))).toThrow("content_generation_orchestration_mismatch");
  });

  it("rejects excluded user-facing media requests in the brief", () => {
    expect(() => parseContentGenerationInput(input({
      orchestration: orchestration({ brief: { request: "제품 Reel video 제작" } }),
      creativeDirection: {
        ...(input().creativeDirection as Record<string, unknown>),
        contentFamily: "informational",
        outputFormat: "card_news",
      },
    }))).toThrow("content_generation_video_unsupported");
  });
});
