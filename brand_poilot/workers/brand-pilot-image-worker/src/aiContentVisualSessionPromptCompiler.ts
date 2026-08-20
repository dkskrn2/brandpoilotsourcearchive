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
