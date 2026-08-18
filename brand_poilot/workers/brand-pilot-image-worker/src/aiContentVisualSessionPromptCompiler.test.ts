import { describe, expect, it } from "vitest";
import { compileAiContentVisualSessionPrompt } from "./aiContentVisualSessionPromptCompiler.js";

const scene = (index: number) => ({
  index, editorialContext: { editorialRole: "detail", purpose: `Purpose ${index}`, coreMessage: `Core ${index}` },
  lockedDisplay: { headline: `Headline ${index}`, relation: { type: "related_facts", entries: [{ role: "fact", label: "A", value: "80%" }, { role: "fact", label: "B", value: "83.3%" }] }, supportingTexts: [], footnote: null },
  referenceBindings: { productImageAssetIds: [], avatarImageAssetIds: [] },
});

describe("visual session prompt compiler", () => {
  it("keeps one free medium without hardcoding illustration and forbids relation/layout inference", () => {
    const prompt = compileAiContentVisualSessionPrompt({
      session: { contractVersion: "ai-content-visual-session.v1", outputFormat: "card_news", source: { contractVersion: "card-manuscript-plan.v1", sha256: "a".repeat(64) }, narrative: "Narrative", primaryMediumPolicy: { mode: "free_once", styleReferenceIds: [] }, scenes: [scene(1), scene(2)] },
      userImageInstruction: null, staged: { productImages: [], styleImages: [], references: [], attachments: [] },
    });
    expect(prompt).toContain("Choose one primary visual medium once");
    expect(prompt).toContain("related_facts groups related independent claims");
    expect(prompt).toContain("BRAND_PILOT_SCENE_INDEX=1");
    expect(prompt).toContain("BRAND_PILOT_SCENE_INDEX=2");
    expect(prompt).toContain("Vary composition without changing the primary medium");
    expect(prompt).toContain("Do not add explanatory text");
    expect(prompt).toContain("page numbering");
    expect(prompt).not.toContain("Use editorial illustration");
    expect(prompt).not.toContain("GLOBAL VISUAL SYSTEM");
    expect(prompt).not.toContain("layoutArchetype");
  });

  it("makes registered brand style the primary medium authority", () => {
    const prompt = compileAiContentVisualSessionPrompt({
      session: { contractVersion: "ai-content-visual-session.v1", outputFormat: "reel", source: { contractVersion: "reel-storyboard.v1", sha256: "b".repeat(64) }, narrative: "Narrative", primaryMediumPolicy: { mode: "brand_style_reference", styleReferenceIds: ["10000000-0000-4000-8000-000000000001"] }, scenes: [scene(1)] },
      userImageInstruction: "Keep it calm", staged: { productImages: [], styleImages: [{ id: "10000000-0000-4000-8000-000000000001", path: "inputs/style.png", avatar: false }], references: [], attachments: [] },
    });
    expect(prompt).toContain("approved brand-style reference files as the primary visual medium authority");
  });
});
