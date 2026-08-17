import { describe, expect, it } from "vitest";
import {
  parseBrandStylePresetInput,
  parseManualProductImagesInput,
} from "./manualVisualAssetsContracts.js";

const presetId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";

describe("manual visual asset contracts", () => {
  it("parses one closed named style preset with ordered references", () => {
    expect(parseBrandStylePresetInput({
      contractVersion: "brand-style-preset.v1",
      name: "Editorial Red",
      description: "Strong newsroom hierarchy",
      visualTokens: {
        colors: ["#ff0000", "#ffffff"],
        fonts: ["Pretendard"],
        notes: ["Use red only for emphasis"],
      },
      referenceItemIds: [presetId, secondId],
      isDefault: true,
    })).toEqual(expect.objectContaining({
      contractVersion: "brand-style-preset.v1",
      name: "Editorial Red",
      referenceItemIds: [presetId, secondId],
      isDefault: true,
    }));
  });

  it.each([
    ["unknown key", { extra: true }],
    ["duplicate reference", { referenceItemIds: [presetId, presetId] }],
    ["missing reference", { referenceItemIds: [] }],
    ["too many references", { referenceItemIds: [presetId, secondId, presetId.replace(/^1/, "3"), presetId.replace(/^1/, "4"), presetId.replace(/^1/, "5"), presetId.replace(/^1/, "6")] }],
  ])("rejects %s in a style preset", (_label, override) => {
    expect(() => parseBrandStylePresetInput({
      contractVersion: "brand-style-preset.v1",
      name: "Editorial",
      description: "",
      visualTokens: { colors: [], fonts: [], notes: [] },
      referenceItemIds: [presetId],
      isDefault: false,
      ...override,
    })).toThrow("brand_style_preset_validation_failed");
  });

  it("keeps style descriptions within the database limit", () => {
    const input = {
      contractVersion: "brand-style-preset.v1", name: "Editorial",
      visualTokens: { colors: [], fonts: [], notes: [] }, referenceItemIds: [presetId], isDefault: false,
    };
    expect(parseBrandStylePresetInput({ ...input, description: "a".repeat(1_000) }).description).toHaveLength(1_000);
    expect(() => parseBrandStylePresetInput({ ...input, description: "a".repeat(1_001) }))
      .toThrow("manual_visual_assets_validation_failed:description");
  });

  it("accepts zero product images and one ordered hero with details", () => {
    expect(parseManualProductImagesInput({
      contractVersion: "manual-product-images.v1",
      images: [],
    }).images).toEqual([]);
    expect(parseManualProductImagesInput({
      contractVersion: "manual-product-images.v1",
      images: [
        { sessionId: presetId, role: "hero", position: 1 },
        { sessionId: secondId, role: "detail", position: 2 },
      ],
    }).images).toHaveLength(2);
  });

  it.each([
    ["duplicate position", [
      { sessionId: presetId, role: "hero", position: 1 },
      { sessionId: secondId, role: "detail", position: 1 },
    ]],
    ["multiple heroes", [
      { sessionId: presetId, role: "hero", position: 1 },
      { sessionId: secondId, role: "hero", position: 2 },
    ]],
    ["no hero", [{ sessionId: presetId, role: "detail", position: 1 }]],
  ])("rejects %s", (_label, images) => {
    expect(() => parseManualProductImagesInput({
      contractVersion: "manual-product-images.v1",
      images,
    })).toThrow("manual_product_images_validation_failed");
  });
});
