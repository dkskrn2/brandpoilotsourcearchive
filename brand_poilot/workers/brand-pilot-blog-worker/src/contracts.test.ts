import { describe, expect, it } from "vitest";
import { parseContentGenerationInput } from "./contracts.js";

function input(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "content-generation-input.v2",
    contentType: "blog",
    brandContext: {},
    subject: {
      analysisId: "analysis-1",
      analysisVersion: 1,
      analysisContractVersion: "subject-analysis.v1",
      analysisResult: null,
      type: "service",
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
      prompts: ["가이드 작성"],
      brandColor: "#111111",
      selectedColor: "#111111",
      aspectRatio: "16:9",
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
    subject: { mode: "brand_topic", topic: "주제", wikiItemIds: ["wiki-1"] },
    target: { id: "target-1", snapshot: { name: "타깃" } },
    strategy: "faq",
    outputFormat: "blog",
    channelTargets: ["blog_export"],
    brief: { goal: "질문 해결" },
    references: [],
    avatar: null,
    ...overrides,
  };
}

describe("blog content generation contract", () => {
  it("preserves legacy v2 payloads without orchestration", () => {
    expect(parseContentGenerationInput(input()).orchestration).toBeNull();
  });

  it("validates and forwards deterministic orchestration", () => {
    const parsed = parseContentGenerationInput(input({
      orchestration: orchestration(),
      creativeDirection: {
        ...(input().creativeDirection as Record<string, unknown>),
        contentFamily: "informational",
        outputFormat: "blog",
      },
    }));
    expect(parsed.orchestration).toEqual(orchestration());
    expect(parsed.creativeDirection).toMatchObject({
      contentFamily: "informational",
      outputFormat: "blog",
    });
  });

  it("rejects a worker mapping mismatch", () => {
    expect(() => parseContentGenerationInput(input({
      orchestration: orchestration({ outputFormat: "card_news" }),
      creativeDirection: {
        ...(input().creativeDirection as Record<string, unknown>),
        contentFamily: "informational",
        outputFormat: "card_news",
      },
    }))).toThrow("content_generation_orchestration_mismatch");
  });

  it("rejects excluded voice requests in the brief", () => {
    expect(() => parseContentGenerationInput(input({
      orchestration: orchestration({ brief: { request: "voice clone" } }),
      creativeDirection: {
        ...(input().creativeDirection as Record<string, unknown>),
        contentFamily: "informational",
        outputFormat: "blog",
      },
    }))).toThrow("content_generation_video_unsupported");
  });
});
