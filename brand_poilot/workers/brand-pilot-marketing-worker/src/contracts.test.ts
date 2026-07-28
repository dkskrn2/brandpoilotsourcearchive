import { describe, expect, it } from "vitest";
import { parseContentGenerationInput } from "./contracts.js";

function input(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "content-generation-input.v2",
    contentType: "marketing",
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
      prompts: ["효익과 CTA 작성"],
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
    contentFamily: "marketing",
    subject: { mode: "product_service", productServiceId: "product-1" },
    target: { id: "target-1", snapshot: { name: "타깃" } },
    strategy: "benefit",
    outputFormat: "single_image",
    channelTargets: ["instagram"],
    brief: { goal: "효익 전달" },
    references: [],
    avatar: {
      mode: "library",
      id: "avatar-1",
      snapshot: { assetUrl: "https://cdn.example/avatar.png" },
    },
    ...overrides,
  };
}

describe("marketing content generation contract", () => {
  it("preserves legacy v2 payloads without orchestration", () => {
    expect(parseContentGenerationInput(input()).orchestration).toBeNull();
  });

  it.each(["single_image", "channel_text"])(
    "validates and forwards %s orchestration",
    (outputFormat) => {
      const selected = orchestration({
        outputFormat,
        channelTargets: outputFormat === "channel_text" ? ["threads"] : ["instagram"],
      });
      const parsed = parseContentGenerationInput(input({
        orchestration: selected,
        creativeDirection: {
          ...(input().creativeDirection as Record<string, unknown>),
          contentFamily: "marketing",
          outputFormat,
        },
      }));
      expect(parsed.orchestration).toEqual(selected);
      expect(parsed.creativeDirection).toMatchObject({
        contentFamily: "marketing",
        outputFormat,
      });
    },
  );

  it("rejects informational worker mapping", () => {
    expect(() => parseContentGenerationInput(input({
      orchestration: orchestration({
        contentFamily: "informational",
        strategy: "how_to",
        outputFormat: "blog",
        avatar: null,
      }),
      creativeDirection: {
        ...(input().creativeDirection as Record<string, unknown>),
        contentFamily: "informational",
        outputFormat: "blog",
      },
    }))).toThrow("content_generation_orchestration_mismatch");
  });

  it.each(["video", "Reel", "voice", "face swap"])(
    "rejects excluded %s requests in the brief",
    (request) => {
      expect(() => parseContentGenerationInput(input({
        orchestration: orchestration({ brief: { request } }),
        creativeDirection: {
          ...(input().creativeDirection as Record<string, unknown>),
          contentFamily: "marketing",
          outputFormat: "single_image",
        },
      }))).toThrow("content_generation_video_unsupported");
    },
  );
});
