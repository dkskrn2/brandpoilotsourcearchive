import { describe, expect, it } from "vitest";
import {
  parseFrozenManualVisualSelection,
  parseFrozenManualVisualSelectionV1,
  parseManualVisualSelection,
  parseManualVisualSelectionV1,
  parseManualVisualSelectionV2,
} from "./manualVisualSelection.js";

const id = (digit: number) => `${digit}0000000-0000-4000-8000-00000000000${digit}`;

describe("manual visual selection v1", () => {
  it("parses explicit product, style and avatar revisions", () => {
    expect(parseManualVisualSelectionV1({
      contractVersion: "manual-visual-selection.v1",
      product: { productServiceId: id(1), versionId: id(2) },
      stylePreset: { presetId: id(3), revision: 2 },
      avatar: { avatarId: id(4), revision: 1 },
    })).toEqual(expect.objectContaining({ contractVersion: "manual-visual-selection.v1" }));
  });

  it("accepts explicit null selections without inventing defaults", () => {
    expect(parseManualVisualSelectionV1({
      contractVersion: "manual-visual-selection.v1",
      product: null,
      stylePreset: null,
      avatar: null,
    })).toEqual({ contractVersion: "manual-visual-selection.v1", product: null, stylePreset: null, avatar: null });
  });

  it("rejects unknown versions and keys", () => {
    expect(() => parseManualVisualSelectionV1({
      contractVersion: "manual-visual-selection.v2", product: null, stylePreset: null, avatar: null,
    })).toThrow("manual_visual_selection_invalid");
    expect(() => parseManualVisualSelectionV1({
      contractVersion: "manual-visual-selection.v1", product: null, stylePreset: null, avatar: null, fallback: true,
    })).toThrow("manual_visual_selection_invalid");
  });

  it("freezes business text and owned IDs without storage paths or URLs", () => {
    const frozen = parseFrozenManualVisualSelectionV1({
      contractVersion: "manual-visual-selection-frozen.v1",
      product: {
        productServiceId: id(1), versionId: id(2), kind: "product", name: "Tea",
        description: "Cooling tea", features: ["Low sugar"], benefits: ["Refreshing"], cautions: [],
        evergreenPurchaseInfo: "Available online",
        images: [{ assetId: id(5), role: "hero", position: 1 }],
      },
      stylePreset: {
        presetId: id(3), revision: 2, name: "Editorial", description: "Strong hierarchy",
        visualTokens: { colors: ["#ff0000"], fonts: ["Pretendard"], notes: ["Red emphasis"] },
        referenceItemIds: [id(6)],
      },
      avatar: {
        avatarId: id(4), revision: 1, name: "Host", description: "Friendly presenter",
        imageAssetIds: [id(7)], objectSha256: "a".repeat(64),
      },
    });
    expect(JSON.stringify(frozen)).not.toMatch(/storage|https?:/);
  });

  it("rejects a frozen style description that the database cannot store", () => {
    expect(() => parseFrozenManualVisualSelectionV1({
      contractVersion: "manual-visual-selection-frozen.v1", product: null,
      stylePreset: {
        presetId: id(3), revision: 2, name: "Editorial", description: "a".repeat(1_001),
        visualTokens: { colors: [], fonts: [], notes: [] }, referenceItemIds: [id(6)],
      },
      avatar: null,
    })).toThrow("manual_visual_selection_invalid");
  });
});

describe("manual visual selection v2", () => {
  it("selects one combined preset after proposal selection", () => {
    const value = {
      contractVersion: "manual-visual-selection.v2",
      product: { productServiceId: id(1), versionId: id(2) },
      preset: { presetId: id(3), revision: 4 },
    };
    expect(parseManualVisualSelectionV2(value)).toEqual(value);
    expect(parseManualVisualSelection(value)).toEqual(value);
  });

  it("rejects separate avatar/style choices and storage metadata", () => {
    expect(() => parseManualVisualSelectionV2({
      contractVersion: "manual-visual-selection.v2",
      product: null,
      preset: null,
      avatar: { avatarId: id(4), revision: 1 },
    })).toThrow("manual_visual_selection_invalid");
    expect(() => parseManualVisualSelectionV2({
      contractVersion: "manual-visual-selection.v2",
      product: null,
      preset: { presetId: id(3), revision: 1, storageUrl: "https://example.test/style.png" },
    })).toThrow("manual_visual_selection_invalid");
  });

  it("reads frozen v2 IDs and analysis without storage paths or checksums", () => {
    const frozen = {
      contractVersion: "manual-visual-selection-frozen.v2",
      product: null,
      preset: {
        presetId: id(3),
        revision: 4,
        name: "Editorial",
        designStyle: {
          designStyleId: id(5),
          revision: 2,
          analysis: {
            contractVersion: "design-style-analysis.v1",
            layout: { composition: ["좌우 분할"], hierarchy: [], spacing: [], alignment: [], recurringModules: [] },
            typography: { families: [], weightHierarchy: [], scale: [], placement: [] },
            color: { palette: ["보라색"], contrast: [], background: [], accentUsage: [] },
            graphics: { media: [], shapes: [], icons: [], texture: [] },
            visualCues: { comparison: ["병렬 배치"], humor: [], practicality: [], empathy: [] },
            promptGuidance: { use: ["명확한 위계"], avoid: [] },
          },
          referenceItemIds: [id(6)],
        },
        avatar: {
          avatarId: id(4), revision: 1, name: "Host", description: "친근한 진행자",
          imageAssetIds: [id(7)],
        },
      },
    };
    expect(parseFrozenManualVisualSelection(frozen)).toEqual(frozen);
    expect(JSON.stringify(frozen)).not.toMatch(/storage|checksum|sha256|https?:/i);
  });

  it("keeps V1 read compatibility without allowing V1 through the V2 writer", () => {
    const legacy = {
      contractVersion: "manual-visual-selection.v1",
      product: null,
      stylePreset: null,
      avatar: null,
    };
    expect(parseManualVisualSelection(legacy)).toEqual(legacy);
    expect(() => parseManualVisualSelectionV2(legacy)).toThrow("manual_visual_selection_invalid");
  });
});
