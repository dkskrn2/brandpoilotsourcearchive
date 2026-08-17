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
  compileCardDeckSceneV1,
  parseCardDeckEditorialPlanV1,
  type CardDeckEditorialPlanV1,
  type CardDeckSceneV1,
} from "@brand-pilot/content-contracts/card-deck-editorial-plan";
import { cardDeckEditorialPlanSha256 } from "@brand-pilot/content-contracts/card-deck-editorial-plan/node";
import { compileStructuredScene } from "@brand-pilot/content-contracts/structured-scene-copy";
import type { AiContentManualImageAssetIdentity } from "./aiContentManualRenderContract.js";

export interface AiContentCardDeckImageAssetPayloadV1 {
  contractVersion: "ai-content-card-deck-render-job.v1";
  jobKind: "image_asset";
  generationId: string;
  outputId: string;
  imagePackage: ImageGenerationPackageV1;
  assetIndex: number;
  assetKey: string;
  storagePath: string;
  rendererPromptVersion: "image-card-deck.v1";
  contentGenerationInput: ContentGenerationInputV3;
  contentPlan: ContentPlanResultV2;
  cardDeckBinding: {
    contractVersion: "card-deck-editorial-plan.v1";
    deckSha256: string;
    sceneIndex: number;
  };
  cardDeckContract: {
    contractVersion: "card-deck-editorial-plan.v1";
    deckSha256: string;
    plan: CardDeckEditorialPlanV1;
  };
  cardDeckCurrentScene: {
    contractVersion: "card-deck-current-scene.v1";
    deckSha256: string;
    sceneIndex: number;
    compatibilityRole: string;
    scene: CardDeckSceneV1;
  };
}

function invalid(): never {
  throw new Error("ai_content_render_job_invalid");
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const source = value as Record<string, unknown>;
  const actual = Object.keys(source);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) invalid();
  return source;
}

export function parseAiContentCardDeckImageAssetPayloadV1(
  value: unknown,
  identity: AiContentManualImageAssetIdentity,
): AiContentCardDeckImageAssetPayloadV1 {
  try {
    const source = exactRecord(value, [
      "contractVersion", "jobKind", "generationId", "outputId", "imagePackage", "assetIndex", "assetKey",
      "storagePath", "rendererPromptVersion", "contentGenerationInput", "contentPlan",
      "cardDeckBinding", "cardDeckContract", "cardDeckCurrentScene",
    ]);
    const binding = exactRecord(source.cardDeckBinding, ["contractVersion", "deckSha256", "sceneIndex"]);
    const contract = exactRecord(source.cardDeckContract, ["contractVersion", "deckSha256", "plan"]);
    const current = exactRecord(source.cardDeckCurrentScene, [
      "contractVersion", "deckSha256", "sceneIndex", "compatibilityRole", "scene",
    ]);
    const imagePackage = parseImageGenerationPackageV1(source.imagePackage);
    const contentGenerationInput = parseContentGenerationInputV3(source.contentGenerationInput);
    const contentPlan = parseContentPlanResultV2(source.contentPlan);
    const deck = parseCardDeckEditorialPlanV1(contract.plan);
    const currentScene = deck.scenes[identity.assetIndex - 1];
    const deckSha256 = cardDeckEditorialPlanSha256(deck);
    const expectedPath = `ai-content/${identity.brandId}/${identity.generationId}/${identity.outputId}/assets/${String(identity.assetIndex).padStart(2, "0")}.png`;
    if (
      source.contractVersion !== "ai-content-card-deck-render-job.v1"
      || source.jobKind !== "image_asset"
      || source.rendererPromptVersion !== "image-card-deck.v1"
      || source.generationId !== identity.generationId
      || source.outputId !== identity.outputId
      || source.assetIndex !== identity.assetIndex
      || source.assetKey !== `${identity.generationId}:${identity.assetIndex}`
      || source.storagePath !== expectedPath
      || binding.contractVersion !== "card-deck-editorial-plan.v1"
      || contract.contractVersion !== "card-deck-editorial-plan.v1"
      || current.contractVersion !== "card-deck-current-scene.v1"
      || binding.deckSha256 !== deckSha256
      || contract.deckSha256 !== deckSha256
      || current.deckSha256 !== deckSha256
      || binding.sceneIndex !== identity.assetIndex
      || current.sceneIndex !== identity.assetIndex
      || !currentScene
      || currentScene.index !== identity.assetIndex
      || typeof current.compatibilityRole !== "string"
      || !current.compatibilityRole.trim()
      || imagePackage.outputFormat !== "card_news"
      || imagePackage.generationId !== identity.generationId
      || contentPlan.contractVersion !== "card-news-plan.v2"
      || contentPlan.imagePackage === null
      || contentGenerationInput.generationId !== identity.generationId
      || contentGenerationInput.outputSettings.outputFormat !== "card_news"
      || contentGenerationInput.selectedProposal.outputFormat !== "card_news"
      || !isDeepStrictEqual(contentPlan.imagePackage, imagePackage)
      || !isDeepStrictEqual(current.scene, currentScene)
    ) invalid();
    const outline = contentGenerationInput.selectedProposal.outline[identity.assetIndex - 1];
    const asset = imagePackage.assets[identity.assetIndex - 1];
    const avatarImageIds = new Set(contentGenerationInput.references.brandStyleImages
      .filter(({ tags }) => tags.includes("avatar"))
      .map(({ referenceItemId }) => referenceItemId));
    if (!outline || !asset || outline.index !== identity.assetIndex
      || outline.role !== current.compatibilityRole || asset.index !== identity.assetIndex
      || new Set(currentScene.avatarImageAssetIds ?? []).size !== (currentScene.avatarImageAssetIds ?? []).length
      || (currentScene.avatarImageAssetIds ?? []).some((id) => !avatarImageIds.has(id))) invalid();
    const compiled = compileCardDeckSceneV1(deck, currentScene, current.compatibilityRole.trim());
    const { attachmentIds: _attachmentIds, ...assetWithoutAttachments } = asset;
    if (!isDeepStrictEqual(compileStructuredScene(compiled), assetWithoutAttachments)) invalid();
    return {
      contractVersion: "ai-content-card-deck-render-job.v1", jobKind: "image_asset",
      generationId: identity.generationId, outputId: identity.outputId,
      imagePackage, assetIndex: identity.assetIndex,
      assetKey: String(source.assetKey), storagePath: String(source.storagePath),
      rendererPromptVersion: "image-card-deck.v1",
      contentGenerationInput, contentPlan,
      cardDeckBinding: {
        contractVersion: "card-deck-editorial-plan.v1", deckSha256, sceneIndex: identity.assetIndex,
      },
      cardDeckContract: { contractVersion: "card-deck-editorial-plan.v1", deckSha256, plan: deck },
      cardDeckCurrentScene: {
        contractVersion: "card-deck-current-scene.v1", deckSha256, sceneIndex: identity.assetIndex,
        compatibilityRole: current.compatibilityRole.trim(), scene: currentScene,
      },
    };
  } catch {
    throw new Error("ai_content_render_job_invalid");
  }
}
