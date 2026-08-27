import { describe, expect, it } from "vitest";
import { projectManualEditorialVisualInputs } from "./editorialVisualContext.js";

describe("manual editorial visual context", () => {
  it("projects the frozen V2 preset analysis without exposing asset storage metadata", () => {
    const input = {
      userImageInstruction: "숫자 비교를 선명하게",
      references: {
        attachments: [{ id: "attachment-1", role: "start_reference", fileName: "start.png" }],
      },
    };
    const selection = {
      contractVersion: "manual-visual-selection-frozen.v2",
      product: null,
      preset: {
        presetId: "preset-1",
        revision: 3,
        name: "비교 카드",
        designStyle: {
          designStyleId: "style-1",
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
          referenceItemIds: ["reference-1"],
        },
        avatar: {
          avatarId: "avatar-1", revision: 1, name: "진행자", description: "친근한 캐릭터",
          imageAssetIds: ["asset-1"],
        },
      },
    };

    const projected = projectManualEditorialVisualInputs(input as never, selection as never);

    expect(projected).toEqual({
      explicitUserDirection: "숫자 비교를 선명하게",
      attachments: [{ id: "attachment-1", role: "start_reference", fileName: "start.png" }],
      visualPreset: {
        name: "비교 카드",
        designStyle: selection.preset.designStyle.analysis,
        hasAvatar: true,
      },
      avatar: {
        name: "진행자",
        description: "친근한 캐릭터",
        imageAssetIds: ["asset-1"],
      },
    });
    expect(JSON.stringify(projected)).not.toMatch(/storage|checksum|sha256|referenceItemIds/i);
  });
});
