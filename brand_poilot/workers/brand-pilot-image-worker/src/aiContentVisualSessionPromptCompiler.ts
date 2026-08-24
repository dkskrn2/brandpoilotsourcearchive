import type { AiContentVisualSessionV1 } from "@brand-pilot/content-contracts/visual-render-session";
import { compileAiContentVisualRenderPolicy } from "./aiContentVisualRenderPolicy.mjs";
import type { StagedAiContentAssetInputs } from "./aiContentAssetPrompt.js";

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function compileAiContentVisualSessionPrompt(input: {
  session: AiContentVisualSessionV1;
  userImageInstruction: string | null;
  staged: StagedAiContentAssetInputs;
}): string {
  return [
    ...compileAiContentVisualRenderPolicy({
      outputFormat: input.session.outputFormat,
      primaryMediumMode: input.session.primaryMediumPolicy.mode,
    }),
    `USER IMAGE DIRECTION (NON-DISPLAY)\n${input.userImageInstruction ?? "None"}`,
    `MANUSCRIPT NARRATIVE (NON-DISPLAY)\n${input.session.narrative}`,
    `COMPLETE EDITORIAL CONTEXT (NON-DISPLAY)\n${json(input.session.scenes.map(({ index, editorialContext }) => ({ index, ...editorialContext })))}`,
    `REFERENCE FILES\n${json(input.staged)}`,
    input.staged.productImages.length > 0
      ? `PRODUCT IDENTITY REFERENCES (NON-DISPLAY)\nEvery image_generation call MUST include every local path below in referenced_image_paths. Use them to preserve the selected product's real appearance. They are references, not a requirement to visibly place the product in every scene. Do not replace the product with a generic invented object.\n${json(input.staged.productImages.map(({ path }) => path))}`
      : "PRODUCT IDENTITY REFERENCES (NON-DISPLAY)\nNone. Do not invent a specific product appearance.",
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
