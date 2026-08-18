import type { AiContentVisualSessionV1 } from "@brand-pilot/content-contracts/visual-render-session";
import type { StagedAiContentAssetInputs } from "./aiContentAssetPrompt.js";

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function compileAiContentVisualSessionPrompt(input: {
  session: AiContentVisualSessionV1;
  userImageInstruction: string | null;
  staged: StagedAiContentAssetInputs;
}): string {
  const medium = input.session.primaryMediumPolicy.mode === "brand_style_reference"
    ? "Use the approved brand-style reference files as the primary visual medium authority for the complete output."
    : "Choose one primary visual medium once before Scene 1, then keep that medium consistent for the complete output. Do not default to editorial illustration or any named medium.";
  return [
    "Generate every scene in this visual session in ascending index order within this single execution.",
    "Call image_generation exactly once per scene. Do not retry a scene. Stop immediately if any scene fails.",
    "For Scene N, the image_generation tool prompt MUST begin with the exact first line BRAND_PILOT_SCENE_INDEX=N followed by a newline. This is an execution binding, not display copy.",
    "Do not use a previously generated scene as a reference image for a later scene.",
    medium,
    "Vary composition without changing the primary medium. Repeated semantic relation types must not force repeated layouts.",
    "informationRelation is semantic meaning only, never a chart, split-screen, column, or composition instruction.",
    "related_facts groups related independent claims. Never depict it as before/after, equal-denominator KPIs, or direct numeric comparison unless the locked relation says so.",
    "Only render text from headline, supportingTexts, footnote, relation label/value, and mandatory brand text.",
    "Do not add explanatory text, paraphrases, speech bubbles, sticker copy, pseudo-UI labels, decorative English, or page numbering.",
    "Page numbers, slide counters, 1/5 labels, pagination badges, and sequence numerals used only as page markers are forbidden. Their presence is not a reason to retry; generate only once.",
    "Preserve locked copy meaning and numbers. Pixel-level OCR equality is not automatically judged.",
    "The complete editorial context is non-display context. Never print it unless the same text is also in the current scene locked display.",
    `USER IMAGE DIRECTION (NON-DISPLAY)\n${input.userImageInstruction ?? "None"}`,
    `MANUSCRIPT NARRATIVE (NON-DISPLAY)\n${input.session.narrative}`,
    `COMPLETE EDITORIAL CONTEXT (NON-DISPLAY)\n${json(input.session.scenes.map(({ index, editorialContext }) => ({ index, ...editorialContext })))}`,
    `REFERENCE FILES\n${json(input.staged)}`,
    ...input.session.scenes.map((scene) => [
      `SCENE ${scene.index} - GENERATE IN ORDER`,
      `REQUIRED TOOL-PROMPT FIRST LINE (NON-DISPLAY)\nBRAND_PILOT_SCENE_INDEX=${scene.index}`,
      `EDITORIAL CONTEXT (NON-DISPLAY)\n${json(scene.editorialContext)}`,
      `LOCKED DISPLAY COPY\n${json(scene.lockedDisplay)}`,
      `REFERENCE BINDINGS\n${json(scene.referenceBindings)}`,
    ].join("\n")),
    `Return exactly this JSON after all successful tool calls:\n${json({ contractVersion: "ai-content-visual-session-render.v1", scenes: input.session.scenes.map(({ index }) => ({ index })) })}`,
  ].join("\n\n");
}
