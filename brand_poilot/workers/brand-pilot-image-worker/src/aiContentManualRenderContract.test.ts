import { describe, expect, it } from "vitest";
import {
  buildAiContentManualRenderContract,
  parseAiContentManualImageAssetPayloadV3,
} from "./aiContentManualRenderContract.js";
import { cloneManualImageJobV3 } from "../test/fixtures/manualRender.js";

function identity(job: ReturnType<typeof cloneManualImageJobV3>) {
  return {
    id: job.id,
    generationId: job.generationId,
    outputId: job.outputId,
    workspaceId: job.workspaceId,
    brandId: job.brandId,
    assetIndex: job.assetIndex,
  };
}

describe("structured manual render contract", () => {
  it("binds the hydrated structured scene to the exact current canonical asset", () => {
    const job = cloneManualImageJobV3();
    const payload = parseAiContentManualImageAssetPayloadV3(job.payload, identity(job));
    const contract = buildAiContentManualRenderContract({ identity: identity(job), payload });

    expect(payload.renderSemanticScene.scene.coreMessage).toContain("화면에 직접 표시하지 않는");
    expect(contract).toMatchObject({
      contractVersion: "ai-content-manual-render.v3",
      rendererPromptVersion: "image-final-pixels.v3",
      currentAsset: {
        index: 2,
        role: "detail",
        copy: "두 번째 장면",
        visualDirection: "두 번째 장면 비주얼",
      },
      renderSemanticScene: {
        contractVersion: "structured-scene-copy.v1",
        scene: { index: 2, headline: "두 번째 장면" },
      },
    });
    expect(contract.currentAsset).not.toHaveProperty("coreMessage");
  });

  it.each([
    ["extra semantic key", (job: ReturnType<typeof cloneManualImageJobV3>) => Object.assign(job.payload.renderSemanticScene, { extra: true })],
    ["scene index", (job: ReturnType<typeof cloneManualImageJobV3>) => { job.payload.renderSemanticScene.scene.index = 1; }],
    ["scene role", (job: ReturnType<typeof cloneManualImageJobV3>) => { job.payload.renderSemanticScene.scene.role = "wrong"; }],
    ["flattened copy", (job: ReturnType<typeof cloneManualImageJobV3>) => { job.payload.renderSemanticScene.scene.headline = "다른 문구"; }],
    ["visual direction", (job: ReturnType<typeof cloneManualImageJobV3>) => { job.payload.renderSemanticScene.scene.visualDirection = "다른 표현"; }],
    ["semantic binding", (job: ReturnType<typeof cloneManualImageJobV3>) => { job.payload.renderSemanticBinding.sceneIndex = 1; }],
  ])("rejects a v3 payload with a mismatched %s", (_label, mutate) => {
    const job = cloneManualImageJobV3();
    mutate(job);
    expect(() => parseAiContentManualImageAssetPayloadV3(job.payload, identity(job)))
      .toThrow("ai_content_render_job_invalid");
  });
});
