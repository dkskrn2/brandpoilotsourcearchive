import { isDeepStrictEqual } from "node:util";
import {
  parseContentGenerationInputV3,
  parseContentPlanResultV2,
  parseImageGenerationPackageV1,
  type ContentGenerationInputV3,
  type ContentPlanResultV2,
  type ImageGenerationPackageV1,
} from "@brand-pilot/content-contracts";
import {
  compileReelStoryboardSceneV1,
  parseReelStoryboardV1,
  type ReelStoryboardSceneV1,
  type ReelStoryboardV1,
} from "@brand-pilot/content-contracts/reel-storyboard";
import { reelStoryboardSha256 } from "@brand-pilot/content-contracts/reel-storyboard/node";
import { compileStructuredScene } from "@brand-pilot/content-contracts/structured-scene-copy";
import type { AiContentManualImageAssetIdentity } from "./aiContentManualRenderContract.js";

export interface AiContentReelStoryboardImageAssetPayloadV1 {
  contractVersion: "ai-content-reel-storyboard-render-job.v1";
  jobKind: "image_asset";
  generationId: string;
  outputId: string;
  imagePackage: ImageGenerationPackageV1;
  assetIndex: number;
  assetKey: string;
  storagePath: string;
  rendererPromptVersion: "image-reel-storyboard.v1";
  contentGenerationInput: ContentGenerationInputV3;
  contentPlan: ContentPlanResultV2;
  reelStoryboardBinding: { contractVersion: "reel-storyboard.v1"; storyboardSha256: string; sceneIndex: number };
  reelStoryboardContract: { contractVersion: "reel-storyboard.v1"; storyboardSha256: string; storyboard: ReelStoryboardV1 };
  reelStoryboardCurrentScene: {
    contractVersion: "reel-storyboard-current-scene.v1";
    storyboardSha256: string;
    sceneIndex: number;
    compatibilityRole: string;
    scene: ReelStoryboardSceneV1;
  };
}

function invalid(): never { throw new Error("ai_content_render_job_invalid"); }

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const source = value as Record<string, unknown>;
  const actual = Object.keys(source);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) invalid();
  return source;
}

export function parseAiContentReelStoryboardImageAssetPayloadV1(
  value: unknown,
  identity: AiContentManualImageAssetIdentity,
): AiContentReelStoryboardImageAssetPayloadV1 {
  try {
    const source = exactRecord(value, [
      "contractVersion", "jobKind", "generationId", "outputId", "imagePackage", "assetIndex", "assetKey",
      "storagePath", "rendererPromptVersion", "contentGenerationInput", "contentPlan",
      "reelStoryboardBinding", "reelStoryboardContract", "reelStoryboardCurrentScene",
    ]);
    const binding = exactRecord(source.reelStoryboardBinding, ["contractVersion", "storyboardSha256", "sceneIndex"]);
    const contract = exactRecord(source.reelStoryboardContract, ["contractVersion", "storyboardSha256", "storyboard"]);
    const current = exactRecord(source.reelStoryboardCurrentScene, [
      "contractVersion", "storyboardSha256", "sceneIndex", "compatibilityRole", "scene",
    ]);
    const imagePackage = parseImageGenerationPackageV1(source.imagePackage);
    const contentGenerationInput = parseContentGenerationInputV3(source.contentGenerationInput);
    const contentPlan = parseContentPlanResultV2(source.contentPlan);
    const storyboard = parseReelStoryboardV1(contract.storyboard);
    const storyboardSha256 = reelStoryboardSha256(storyboard);
    const currentScene = storyboard.scenes[identity.assetIndex - 1];
    const expectedPath = `ai-content/${identity.brandId}/${identity.generationId}/${identity.outputId}/assets/${String(identity.assetIndex).padStart(2, "0")}.png`;
    if (
      source.contractVersion !== "ai-content-reel-storyboard-render-job.v1"
      || source.jobKind !== "image_asset"
      || source.rendererPromptVersion !== "image-reel-storyboard.v1"
      || source.generationId !== identity.generationId
      || source.outputId !== identity.outputId
      || source.assetIndex !== identity.assetIndex
      || source.assetKey !== `${identity.generationId}:${identity.assetIndex}`
      || source.storagePath !== expectedPath
      || binding.contractVersion !== "reel-storyboard.v1"
      || contract.contractVersion !== "reel-storyboard.v1"
      || current.contractVersion !== "reel-storyboard-current-scene.v1"
      || binding.storyboardSha256 !== storyboardSha256
      || contract.storyboardSha256 !== storyboardSha256
      || current.storyboardSha256 !== storyboardSha256
      || binding.sceneIndex !== identity.assetIndex
      || current.sceneIndex !== identity.assetIndex
      || !currentScene || currentScene.index !== identity.assetIndex
      || typeof current.compatibilityRole !== "string" || !current.compatibilityRole.trim()
      || imagePackage.outputFormat !== "reel" || imagePackage.aspectRatio !== "9:16"
      || imagePackage.generationId !== identity.generationId
      || contentPlan.contractVersion !== "reel-plan.v2" || contentPlan.imagePackage === null
      || contentGenerationInput.generationId !== identity.generationId
      || contentGenerationInput.outputSettings.outputFormat !== "reel"
      || contentGenerationInput.outputSettings.aspectRatio !== "9:16"
      || contentGenerationInput.selectedProposal.outputFormat !== "reel"
      || !isDeepStrictEqual(contentPlan.imagePackage, imagePackage)
      || !isDeepStrictEqual(current.scene, currentScene)
    ) invalid();
    const outline = contentGenerationInput.selectedProposal.outline[identity.assetIndex - 1];
    const asset = imagePackage.assets[identity.assetIndex - 1];
    if (!outline || !asset || outline.index !== identity.assetIndex
      || outline.role !== current.compatibilityRole || asset.index !== identity.assetIndex) invalid();
    const compiled = compileReelStoryboardSceneV1(storyboard, currentScene, current.compatibilityRole.trim());
    const { attachmentIds: _attachmentIds, ...assetWithoutAttachments } = asset;
    if (!isDeepStrictEqual(compileStructuredScene(compiled), assetWithoutAttachments)) invalid();
    return {
      contractVersion: "ai-content-reel-storyboard-render-job.v1", jobKind: "image_asset",
      generationId: identity.generationId, outputId: identity.outputId, imagePackage,
      assetIndex: identity.assetIndex, assetKey: String(source.assetKey), storagePath: String(source.storagePath),
      rendererPromptVersion: "image-reel-storyboard.v1", contentGenerationInput, contentPlan,
      reelStoryboardBinding: { contractVersion: "reel-storyboard.v1", storyboardSha256, sceneIndex: identity.assetIndex },
      reelStoryboardContract: { contractVersion: "reel-storyboard.v1", storyboardSha256, storyboard },
      reelStoryboardCurrentScene: {
        contractVersion: "reel-storyboard-current-scene.v1", storyboardSha256, sceneIndex: identity.assetIndex,
        compatibilityRole: current.compatibilityRole.trim(), scene: currentScene,
      },
    };
  } catch {
    throw new Error("ai_content_render_job_invalid");
  }
}
