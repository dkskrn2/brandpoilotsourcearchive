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
    expect(prompt).toContain("cohesive social editorial card series");
    expect(prompt).toContain("Short structural labels are allowed");
    expect(prompt).toContain("Step 1");
    expect(prompt).toContain("핵심");
    expect(prompt).toContain("Do not add new facts, claims, numbers, dates, conditions, sources, or quotes");
    expect(prompt).toContain("Do not add long explanatory text");
    expect(prompt).toContain("page numbering");
    expect(prompt).toContain("CANONICAL_D2PP_RENDER_POLICY_VERSION=visual-render-policy.d2pp.v4");
    expect(prompt).toMatch(/CANONICAL_D2PP_RENDER_POLICY_SHA256=[a-f0-9]{64}/);
    expect(prompt.match(/CANONICAL_D2PP_RENDER_POLICY_VERSION=/g)).toHaveLength(1);
    expect(prompt.match(/CANONICAL_D2PP_RENDER_POLICY_SHA256=/g)).toHaveLength(1);
    expect(prompt).not.toContain("Use editorial illustration");
    expect(prompt).not.toContain("GLOBAL VISUAL SYSTEM");
    expect(prompt).not.toContain("layoutArchetype");
  });

  it.each(["card_news", "reel"] as const)("uses the same bounded structural-label policy for %s", (outputFormat) => {
    const prompt = compileAiContentVisualSessionPrompt({
      session: { contractVersion: "ai-content-visual-session.v1", outputFormat, source: { contractVersion: outputFormat === "reel" ? "reel-storyboard.v1" : "card-manuscript-plan.v1", sha256: "f".repeat(64) }, narrative: "Narrative", primaryMediumPolicy: { mode: "free_once", styleReferenceIds: [] }, scenes: [scene(1)] },
      userImageInstruction: null, staged: { productImages: [], styleImages: [], references: [], attachments: [] },
    });

    expect(prompt).toContain("Short structural labels are allowed");
    expect(prompt).toContain("must not add substantive meaning");
    expect(prompt).toContain("CTA or button copy");
    expect(prompt).toContain("page counters, pagination, or progress markers");
  });

  it("makes registered brand style the primary medium authority", () => {
    const prompt = compileAiContentVisualSessionPrompt({
      session: { contractVersion: "ai-content-visual-session.v1", outputFormat: "reel", source: { contractVersion: "reel-storyboard.v1", sha256: "b".repeat(64) }, narrative: "Narrative", primaryMediumPolicy: { mode: "brand_style_reference", styleReferenceIds: ["10000000-0000-4000-8000-000000000001"] }, scenes: [scene(1)] },
      userImageInstruction: "Keep it calm", staged: { productImages: [], styleImages: [{ id: "10000000-0000-4000-8000-000000000001", path: "inputs/style.png", avatar: false }], references: [], attachments: [] },
    });
    expect(prompt).toContain("approved brand-style reference files as the primary visual medium authority");
  });

  it("requires Reel scenes to be generated natively at 1080x1920 without crop or padding", () => {
    const prompt = compileAiContentVisualSessionPrompt({
      session: { contractVersion: "ai-content-visual-session.v1", outputFormat: "reel", source: { contractVersion: "reel-storyboard.v1", sha256: "c".repeat(64) }, narrative: "Narrative", primaryMediumPolicy: { mode: "free_once", styleReferenceIds: [] }, scenes: [scene(1)] },
      userImageInstruction: null, staged: { productImages: [], styleImages: [], references: [], attachments: [] },
    });
    expect(prompt).toContain("native 1080x1920 pixel 9:16 portrait canvas");
    expect(prompt).toContain("Do not generate a different aspect ratio");
    expect(prompt).toContain("Do not crop, letterbox, pillarbox, pad, or add white bands");

    const cardPrompt = compileAiContentVisualSessionPrompt({
      session: { contractVersion: "ai-content-visual-session.v1", outputFormat: "card_news", source: { contractVersion: "card-manuscript-plan.v1", sha256: "d".repeat(64) }, narrative: "Narrative", primaryMediumPolicy: { mode: "free_once", styleReferenceIds: [] }, scenes: [scene(1)] },
      userImageInstruction: null, staged: { productImages: [], styleImages: [], references: [], attachments: [] },
    });
    expect(cardPrompt).not.toContain("native 1080x1920 pixel 9:16 portrait canvas");
    expect(cardPrompt).toContain("native 1:1 square canvas");
    expect(cardPrompt).toContain("Do not generate a portrait or landscape canvas");
    expect(cardPrompt).not.toContain("native 1080x1080 pixel 1:1 canvas");
  });

  it("keeps typography styling consistent across every Card News and Reel scene", () => {
    for (const outputFormat of ["card_news", "reel"] as const) {
      const prompt = compileAiContentVisualSessionPrompt({
        session: { contractVersion: "ai-content-visual-session.v1", outputFormat, source: { contractVersion: outputFormat === "reel" ? "reel-storyboard.v1" : "card-manuscript-plan.v1", sha256: "e".repeat(64) }, narrative: "Narrative", primaryMediumPolicy: { mode: "free_once", styleReferenceIds: [] }, scenes: [scene(1), scene(2)] },
        userImageInstruction: null, staged: { productImages: [], styleImages: [], references: [], attachments: [] },
      });
      expect(prompt).toContain("Keep the font family or closest available font style, weight system, and typographic character as consistent as possible across every scene in this complete output");
    }
  });
});
