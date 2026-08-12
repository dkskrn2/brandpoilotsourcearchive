import { describe, expect, it } from "vitest";
import { cloneCardDeckImageJob } from "../test/fixtures/manualRender.js";
import { parseAiContentCardDeckImageAssetPayloadV1 } from "./aiContentCardDeckRenderContract.js";

const identity = (job: ReturnType<typeof cloneCardDeckImageJob>) => ({
  id: job.id, generationId: job.generationId, outputId: job.outputId,
  workspaceId: job.workspaceId, brandId: job.brandId, assetIndex: job.assetIndex,
});

describe("Card Deck render contract", () => {
  it("accepts the exact bound Deck, current scene, flattened copy, and compatibility role", () => {
    const job = cloneCardDeckImageJob();
    expect(parseAiContentCardDeckImageAssetPayloadV1(job.payload, identity(job))).toEqual(job.payload);
  });

  it.each([
    ["binding hash", (job: ReturnType<typeof cloneCardDeckImageJob>) => { job.payload.cardDeckBinding.deckSha256 = "f".repeat(64); }],
    ["current scene", (job: ReturnType<typeof cloneCardDeckImageJob>) => { job.payload.cardDeckCurrentScene.sceneIndex = 1; }],
    ["compatibility role", (job: ReturnType<typeof cloneCardDeckImageJob>) => { job.payload.cardDeckCurrentScene.compatibilityRole = "hook"; }],
    ["flattened copy", (job: ReturnType<typeof cloneCardDeckImageJob>) => { job.payload.imagePackage.assets[1]!.copy = "다른 문구"; }],
    ["Deck scene", (job: ReturnType<typeof cloneCardDeckImageJob>) => { job.payload.cardDeckContract.plan.scenes[1]!.headline = "다른 제목"; }],
  ])("rejects a mismatched %s before rendering", (_label, mutate) => {
    const job = cloneCardDeckImageJob();
    mutate(job);
    expect(() => parseAiContentCardDeckImageAssetPayloadV1(job.payload, identity(job)))
      .toThrow("ai_content_render_job_invalid");
  });
});
