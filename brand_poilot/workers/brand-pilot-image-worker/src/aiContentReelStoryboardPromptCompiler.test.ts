import { describe, expect, it } from "vitest";
import { cloneReelStoryboardImageJob } from "../test/fixtures/manualRender.js";
import { parseAiContentReelStoryboardImageAssetPayloadV1 } from "./aiContentReelStoryboardRenderContract.js";
import { compileAiContentReelStoryboardRenderPrompt } from "./aiContentReelStoryboardPromptCompiler.js";

describe("Reel Storyboard deterministic render prompt", () => {
  it("preserves exact display copy and semantic relations in a fixed section order", () => {
    const job = cloneReelStoryboardImageJob();
    const payload = parseAiContentReelStoryboardImageAssetPayloadV1(job.payload, {
      id: job.id, generationId: job.generationId, outputId: job.outputId,
      workspaceId: job.workspaceId, brandId: job.brandId, assetIndex: job.assetIndex,
    });
    const prompt = compileAiContentReelStoryboardRenderPrompt(payload, {
      productImages: [{ id: "product", path: "inputs/product-01.png" }],
      styleImages: [], references: [], attachments: [],
    });
    const headings = [
      "[GLOBAL VISUAL SYSTEM]", "[SCENE PURPOSE]", "[HEADLINE - VERBATIM]",
      "[KEY VISUAL RELATION]", "[VISUAL THESIS]", "[LAYOUT ARCHETYPE]",
      "[SUPPORTING TEXT - VERBATIM]", "[FOOTNOTE - VERBATIM]",
      "[REFERENCE FILES]", "[RENDERING RULES]",
    ];
    expect(headings.every((heading, index) => index === 0 || prompt.indexOf(headings[index - 1]!) < prompt.indexOf(heading))).toBe(true);
    for (const text of ["차 맛은 온도에서 갈립니다", "100°C", "80°C", "떫은맛은 줄이고 향은 살립니다", "차 종류에 따라 달라질 수 있습니다"]) {
      expect(prompt.split(text)).toHaveLength(2);
    }
    expect(prompt).toContain("publish-ready 9:16 Reel scene");
    expect(prompt).toContain("inputs/product-01.png");
  });
});
