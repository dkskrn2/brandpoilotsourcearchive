import { describe, expect, it } from "vitest";
import { cloneReelStoryboardImageJob } from "../test/fixtures/manualRender.js";
import { parseAiContentReelStoryboardImageAssetPayloadV1 } from "./aiContentReelStoryboardRenderContract.js";

const identity = (job: ReturnType<typeof cloneReelStoryboardImageJob>) => ({
  id: job.id, generationId: job.generationId, outputId: job.outputId,
  workspaceId: job.workspaceId, brandId: job.brandId, assetIndex: job.assetIndex,
});

describe("Reel Storyboard render contract", () => {
  it("accepts the exact storyboard, current scene, flattened copy, and compatibility role", () => {
    const job = cloneReelStoryboardImageJob();
    expect(parseAiContentReelStoryboardImageAssetPayloadV1(job.payload, identity(job))).toEqual(job.payload);
  });

  it.each([
    ["binding hash", (job: ReturnType<typeof cloneReelStoryboardImageJob>) => { job.payload.reelStoryboardBinding.storyboardSha256 = "f".repeat(64); }],
    ["current scene", (job: ReturnType<typeof cloneReelStoryboardImageJob>) => { job.payload.reelStoryboardCurrentScene.sceneIndex = 1; }],
    ["compatibility role", (job: ReturnType<typeof cloneReelStoryboardImageJob>) => { job.payload.reelStoryboardCurrentScene.compatibilityRole = "hook"; }],
    ["flattened copy", (job: ReturnType<typeof cloneReelStoryboardImageJob>) => { job.payload.imagePackage.assets[1]!.copy = "다른 문구"; }],
    ["storyboard scene", (job: ReturnType<typeof cloneReelStoryboardImageJob>) => { job.payload.reelStoryboardContract.storyboard.scenes[1]!.headline = "다른 제목"; }],
  ])("rejects a mismatched %s before rendering", (_label, mutate) => {
    const job = cloneReelStoryboardImageJob();
    mutate(job);
    expect(() => parseAiContentReelStoryboardImageAssetPayloadV1(job.payload, identity(job)))
      .toThrow("ai_content_render_job_invalid");
  });
});
