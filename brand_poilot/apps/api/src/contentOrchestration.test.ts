import { describe, expect, it } from "vitest";
import {
  assertContentGenerationStartAllowed,
  mapOrchestrationToWorkerType,
  parseContentOrchestrationV1,
} from "./contentOrchestration.js";
import type { ContentOrchestrationV1 } from "./aiContentContracts.js";

function orchestration(
  overrides: Partial<ContentOrchestrationV1> = {},
): ContentOrchestrationV1 {
  return {
    contractVersion: "content-orchestration.v1",
    contentFamily: "marketing",
    subject: {
      mode: "product_service",
      productServiceId: "product-service-version-1",
    },
    target: { id: null, snapshot: { label: "바쁜 고객" } },
    strategy: "benefit",
    outputFormat: "single_image",
    channelTargets: ["instagram"],
    brief: { goal: "제품의 검증된 효익 설명" },
    references: [{
      referenceItemId: "reference-1",
      roles: ["visual_composition"],
    }],
    avatar: null,
    ...overrides,
  };
}

describe("content orchestration", () => {
  it.each([
    ["card_news", "card_news"],
    ["blog", "blog"],
    ["single_image", "marketing"],
    ["channel_text", "marketing"],
  ] as const)("maps %s to the deterministic legacy worker type %s", (outputFormat, expected) => {
    expect(mapOrchestrationToWorkerType({
      contentFamily: "informational",
      outputFormat,
    })).toBe(expected);
    expect(mapOrchestrationToWorkerType({
      contentFamily: "marketing",
      outputFormat,
    })).toBe(expected);
  });

  it("parses a valid orchestration without promoting references into subject facts", () => {
    const parsed = parseContentOrchestrationV1(orchestration());

    expect(parsed).toEqual(orchestration());
    expect(parsed.references).toEqual([{
      referenceItemId: "reference-1",
      roles: ["visual_composition"],
    }]);
    expect(parsed.subject).toEqual({
      mode: "product_service",
      productServiceId: "product-service-version-1",
    });
    expect(parsed.subject).not.toHaveProperty("facts");
  });

  it.each([
    { contentFamily: "informational", strategy: "benefit", outputFormat: "card_news" },
    { contentFamily: "marketing", strategy: "how_to", outputFormat: "single_image" },
    { contentFamily: "informational", strategy: "insight", outputFormat: "single_image" },
    { contentFamily: "marketing", strategy: "benefit", outputFormat: "blog" },
  ] as const)("rejects invalid family, strategy, and format combinations: %o", (invalid) => {
    expect(() => parseContentOrchestrationV1(orchestration(invalid)))
      .toThrow("content_orchestration_combination_invalid");
  });

  it("rejects a sixth external reference", () => {
    const references = Array.from({ length: 6 }, (_, index) => ({
      referenceItemId: `reference-${index + 1}`,
      roles: ["planning" as const],
    }));

    expect(() => parseContentOrchestrationV1(orchestration({ references })))
      .toThrow("content_orchestration_reference_limit_exceeded");
  });

  it("rejects two avatars at the runtime boundary", () => {
    const avatar = {
      mode: "library",
      id: "avatar-1",
      snapshot: { assetVersionId: "avatar-version-1" },
    };
    const invalid = {
      ...orchestration(),
      avatar: [avatar, { ...avatar, id: "avatar-2" }],
    };

    expect(() => parseContentOrchestrationV1(invalid))
      .toThrow("content_orchestration_avatar_invalid");
  });

  it.each([
    { ...orchestration(), contractVersion: "content-orchestration.v2" },
    { ...orchestration(), subject: { mode: "brand_topic", topic: "", wikiItemIds: [] } },
    { ...orchestration(), target: { id: 1, snapshot: {} } },
    { ...orchestration(), channelTargets: ["reels"] },
    { ...orchestration(), references: [{ referenceItemId: "", roles: ["planning"] }] },
    { ...orchestration(), references: [{ referenceItemId: "reference-1", roles: ["copying"] }] },
    { ...orchestration(), avatar: { mode: "library", id: "", snapshot: {} } },
  ])("rejects malformed orchestration contract fields: %o", (invalid) => {
    expect(() => parseContentOrchestrationV1(invalid))
      .toThrow("content_orchestration_invalid");
  });

  it("gates generation start by channel capability and rejects video channels", () => {
    const capabilities = [
      {
        channel: "instagram" as const,
        generationFormats: ["card_news", "single_image"] as const,
        exportModes: ["image"] as const,
        publishModes: ["instagram_feed_single"],
      },
      {
        channel: "x" as const,
        generationFormats: [] as const,
        exportModes: ["text"] as const,
        publishModes: [],
      },
    ];

    expect(() => assertContentGenerationStartAllowed({
      outputFormat: "single_image",
      channelTargets: ["instagram"],
    }, capabilities)).not.toThrow();
    expect(() => assertContentGenerationStartAllowed({
      outputFormat: "channel_text",
      channelTargets: ["x"],
    }, capabilities)).not.toThrow();
    expect(() => assertContentGenerationStartAllowed({
      outputFormat: "blog",
      channelTargets: ["blog_export"],
    }, capabilities)).not.toThrow();

    for (const channel of ["youtube", "tiktok"] as const) {
      expect(() => assertContentGenerationStartAllowed({
        outputFormat: "single_image",
        channelTargets: [channel],
      }, capabilities)).toThrow("content_orchestration_channel_unsupported");
    }
    expect(() => assertContentGenerationStartAllowed({
      outputFormat: "channel_text",
      channelTargets: ["instagram"],
    }, capabilities)).toThrow("content_orchestration_channel_capability_mismatch");
  });
});
