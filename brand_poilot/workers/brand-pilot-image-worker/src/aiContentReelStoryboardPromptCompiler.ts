import type { StagedAiContentAssetInputs } from "./aiContentAssetPrompt.js";
import type { AiContentReelStoryboardImageAssetPayloadV1 } from "./aiContentReelStoryboardRenderContract.js";

function safeJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/[<>&\u2028\u2029]/g, (character) => {
    if (character === "<") return "\\u003c";
    if (character === ">") return "\\u003e";
    if (character === "&") return "\\u0026";
    if (character === "\u2028") return "\\u2028";
    return "\\u2029";
  });
}

function section(name: string, value: unknown): string { return `[${name}]\n${safeJson(value)}`; }

function referencedEditorialText(
  text: string,
  scene: AiContentReelStoryboardImageAssetPayloadV1["reelStoryboardCurrentScene"]["scene"],
): string {
  const tokens = [
    { value: scene.headline, reference: "[HEADLINE]" },
    ...scene.keyVisual.entries.flatMap(({ role, label, value }, index) => [
      ...(label === null ? [] : [{ value: label, reference: `[KEY_VISUAL.${role}.${index + 1}.label]` }]),
      { value, reference: `[KEY_VISUAL.${role}.${index + 1}.value]` },
    ]),
    ...scene.supportingTexts.map((value, index) => ({ value, reference: `[SUPPORTING_TEXT.${index + 1}]` })),
    ...(scene.footnote === null ? [] : [{ value: scene.footnote, reference: "[FOOTNOTE]" }]),
  ].filter(({ value }) => value.length > 0).sort((left, right) => right.value.length - left.value.length);
  return tokens.reduce((result, { value, reference }) => result.replaceAll(value, reference), text);
}

function referencedEditorialValue(
  value: unknown,
  scene: AiContentReelStoryboardImageAssetPayloadV1["reelStoryboardCurrentScene"]["scene"],
): unknown {
  if (typeof value === "string") return referencedEditorialText(value, scene);
  if (Array.isArray(value)) return value.map((entry) => referencedEditorialValue(entry, scene));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, referencedEditorialValue(entry, scene)]));
  }
  return value;
}

export function compileAiContentReelStoryboardRenderPrompt(
  payload: AiContentReelStoryboardImageAssetPayloadV1,
  staged: StagedAiContentAssetInputs,
): string {
  const storyboard = payload.reelStoryboardContract.storyboard;
  const scene = payload.reelStoryboardCurrentScene.scene;
  return [
    section("GLOBAL VISUAL SYSTEM", {
      storyNarrative: referencedEditorialText(storyboard.storyNarrative, scene),
      visualSystem: referencedEditorialValue(storyboard.visualSystem, scene),
    }),
    section("SCENE PURPOSE", {
      editorialRole: scene.editorialRole,
      compatibilityRole: payload.reelStoryboardCurrentScene.compatibilityRole,
      purpose: referencedEditorialText(scene.purpose, scene),
      coreMessageNonDisplay: referencedEditorialText(scene.coreMessage, scene),
    }),
    section("HEADLINE - VERBATIM", scene.headline),
    section("KEY VISUAL RELATION", scene.keyVisual),
    section("VISUAL THESIS", referencedEditorialText(scene.visualThesis, scene)),
    section("LAYOUT ARCHETYPE", scene.layoutArchetype),
    section("SUPPORTING TEXT - VERBATIM", scene.supportingTexts),
    section("FOOTNOTE - VERBATIM", scene.footnote),
    section("REFERENCE FILES", {
      contentGenerationInput: "inputs/content-generation-input.json",
      contentPlan: "inputs/content-plan.json",
      reelStoryboard: "inputs/reel-storyboard.json",
      reelStoryboardCurrentScene: "inputs/reel-storyboard-current-scene.json",
      productImages: staged.productImages, styleImages: staged.styleImages,
      references: staged.references, attachments: staged.attachments,
    }),
    section("RENDERING RULES", [
      "Create exactly one final publish-ready 9:16 Reel scene as a PNG.",
      "Pass this compiled prompt to gpt-image-2 without summarizing, rewriting, translating, or omitting any section.",
      "Every string in HEADLINE, KEY VISUAL RELATION, SUPPORTING TEXT, and FOOTNOTE is locked display copy.",
      "Preserve every keyVisual role, label, value, and relationship exactly.",
      "GLOBAL VISUAL SYSTEM and VISUAL THESIS define art direction; do not reduce them to a generic clean infographic.",
      "The current asset copy is a validation projection; the Storyboard scene is the sole semantic source.",
      "Do not display coreMessageNonDisplay as additional copy.",
      "Do not create a collage, multiple scenes, alternatives, logos, watermarks, or unsupported facts.",
      "Use only staged local reference files. Do not use network, web search, shell, or external APIs.",
      "Use Codex built-in image_generation with gpt-image-2 and return only the required completion JSON.",
      `After the PNG is verified, return exactly: {"contractVersion":"ai-content-asset-render.v2","assetIndex":${payload.assetIndex},"status":"completed"}`,
    ]),
  ].join("\n\n");
}
