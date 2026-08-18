import { describe, expect, it } from "vitest";
import { projectCardVisualRenderSession, projectReelVisualRenderSession } from "./visualRenderSession.js";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const references = (withStyle: boolean) => ({
  selected: [], avatarStyleImageId: null, attachments: [],
  brandStyleImages: withStyle ? [
    { referenceItemId: uid(1), description: "approved", tags: ["brand_style"], storageUrl: "https://cdn/style", storagePath: "owned/style", mimeType: "image/png", checksum: "a".repeat(64) },
    { referenceItemId: uid(2), description: "avatar", tags: ["avatar"], storageUrl: "https://cdn/avatar", storagePath: "owned/avatar", mimeType: "image/png", checksum: "b".repeat(64) },
  ] : [],
});

describe("ai-content-visual-session.v1", () => {
  it("uses a non-avatar brand style as the primary medium authority for cards", () => {
    const result = projectCardVisualRenderSession({
      sourceSha256: "a".repeat(64), references: references(true),
      plan: {
        contractVersion: "card-manuscript-plan.v1", content: { caption: "c", hashtags: [], cta: "x" },
        deckNarrative: "n", evidenceSelection: { selectedEvidenceIds: [], excludedEvidenceIds: [] },
        scenes: [{ index: 1, editorialRole: "cta", purpose: "p", coreMessage: "m", headline: "h", informationRelation: { type: "none", entries: [] }, supportingTexts: [], footnote: null, evidenceIds: [], productImageAssetIds: [], avatarImageAssetIds: [uid(2)] }],
      },
    } as never);
    expect(result.primaryMediumPolicy).toEqual({ mode: "brand_style_reference", styleReferenceIds: [uid(1)] });
    expect(result.scenes[0]?.referenceBindings.avatarImageAssetIds).toEqual([uid(2)]);
  });

  it("uses free-once for reels without an approved style and strips storyboard design fields", () => {
    const result = projectReelVisualRenderSession({
      sourceSha256: "b".repeat(64), references: references(false),
      storyboard: {
        contractVersion: "reel-storyboard.v1", content: { caption: "c", hashtags: [], cta: "x" }, storyNarrative: "n",
        visualSystem: { paletteDirection: "red", typographyDirection: "large", graphicLanguage: "cards", imageryDirection: "photo", invariants: ["same"] },
        scenes: [{ index: 1, editorialRole: "hook", purpose: "p", coreMessage: "m", headline: "h", keyVisual: { type: "none", entries: [] }, supportingTexts: [], footnote: null, visualThesis: "dominant", layoutArchetype: "vertical_hook", evidenceIds: [], productImageAssetIds: [], avatarImageAssetIds: [] }],
      },
    } as never);
    expect(result.primaryMediumPolicy).toEqual({ mode: "free_once", styleReferenceIds: [] });
    expect(JSON.stringify(result)).not.toContain("paletteDirection");
    expect(JSON.stringify(result)).not.toContain("visualThesis");
    expect(JSON.stringify(result)).not.toContain("layoutArchetype");
  });
});
