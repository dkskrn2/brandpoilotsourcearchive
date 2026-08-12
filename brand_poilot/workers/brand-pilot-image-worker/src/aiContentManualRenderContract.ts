import { isDeepStrictEqual } from "node:util";
import { load } from "cheerio";
import {
  assertPurposeProductInvariant,
  parseContentGenerationInputV3,
  parseContentPlanResultV2,
  parseImageGenerationPackageV1,
  type ContentGenerationInputV3,
  type ContentPlanResultV2,
  type ImageGenerationPackageV1,
} from "@brand-pilot/content-contracts";
import {
  compileStructuredScene,
  parseStructuredSceneCopyV1,
  type StructuredSceneCopyV1,
} from "@brand-pilot/content-contracts/structured-scene-copy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AiContentManualImageAssetPayloadV2 {
  contractVersion: "ai-content-render-job.v2";
  jobKind: "image_asset";
  generationId: string;
  outputId: string;
  imagePackage: ImageGenerationPackageV1;
  assetIndex: number;
  assetKey: string;
  storagePath: string;
  rendererPromptVersion: "image-final-pixels.v2";
  contentGenerationInput: ContentGenerationInputV3;
  contentPlan: ContentPlanResultV2;
}

export interface AiContentManualImageAssetPayloadV3 {
  contractVersion: "ai-content-render-job.v3";
  jobKind: "image_asset";
  generationId: string;
  outputId: string;
  imagePackage: ImageGenerationPackageV1;
  assetIndex: number;
  assetKey: string;
  storagePath: string;
  rendererPromptVersion: "image-final-pixels.v3";
  contentGenerationInput: ContentGenerationInputV3;
  contentPlan: ContentPlanResultV2;
  renderSemanticBinding: {
    contractVersion: "structured-scene-copy.v1";
    semanticSha256: string;
    sceneIndex: number;
  };
  renderSemanticScene: {
    contractVersion: "structured-scene-copy.v1";
    scene: StructuredSceneCopyV1;
  };
}

export type AiContentManualImageAssetPayload =
  | AiContentManualImageAssetPayloadV2
  | AiContentManualImageAssetPayloadV3;

export interface AiContentManualImageAssetIdentity {
  id: string;
  generationId: string;
  outputId: string;
  workspaceId: string;
  brandId: string;
  assetIndex: number;
}

export interface BlogInsertionContextV2 {
  placeholder: string;
  altText: string;
  nearestHeading: string | null;
  previousParagraph: string | null;
  nextParagraph: string | null;
  role: string;
}

export interface AiContentManualRenderContractV2 {
  contractVersion: "ai-content-manual-render.v2";
  rendererPromptVersion: "image-final-pixels.v2";
  generationId: string;
  outputId: string;
  workspaceId: string;
  brandId: string;
  assetIndex: number;
  assetKey: string;
  storagePath: string;
  outputFormat: ImageGenerationPackageV1["outputFormat"];
  purpose: ImageGenerationPackageV1["purpose"];
  aspectRatio: ImageGenerationPackageV1["aspectRatio"];
  currentAsset: { index: number; role: string; copy: string; visualDirection: string };
  blogInsertionContext: BlogInsertionContextV2 | null;
}

export interface AiContentManualRenderContractV3 {
  contractVersion: "ai-content-manual-render.v3";
  rendererPromptVersion: "image-final-pixels.v3";
  generationId: string;
  outputId: string;
  workspaceId: string;
  brandId: string;
  assetIndex: number;
  assetKey: string;
  storagePath: string;
  outputFormat: "card_news" | "reel";
  purpose: ImageGenerationPackageV1["purpose"];
  aspectRatio: "1:1" | "9:16";
  currentAsset: { index: number; role: string; copy: string; visualDirection: string };
  blogInsertionContext: null;
  renderSemanticScene: AiContentManualImageAssetPayloadV3["renderSemanticScene"];
}

export type AiContentManualRenderContract = AiContentManualRenderContractV2 | AiContentManualRenderContractV3;

function invalid(): never {
  throw new Error("ai_content_render_job_invalid");
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const source = value as Record<string, unknown>;
  if (Object.keys(source).length !== keys.length || Object.keys(source).some((key) => !keys.includes(key))) invalid();
  return source;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function duplicateFreeSubset(values: readonly string[], allowed: ReadonlySet<string>): boolean {
  return new Set(values).size === values.length && values.every((value) => allowed.has(value));
}

function assertCanonicalBindings(
  identity: AiContentManualImageAssetIdentity,
  input: ContentGenerationInputV3,
  plan: ContentPlanResultV2,
  imagePackage: ImageGenerationPackageV1,
): void {
  const format = input.outputSettings.outputFormat;
  assertPurposeProductInvariant(input);
  if (format === "card_news") {
    if (!sameStringArray(input.outputSettings.channelTargets, ["instagram"])
      || input.outputSettings.aspectRatio !== "1:1"
      || !sameStringArray(imagePackage.channelTargets, ["instagram"])
      || imagePackage.aspectRatio !== "1:1") invalid();
  } else if (format === "reel") {
    if (!sameStringArray(input.outputSettings.channelTargets, ["instagram"])
      || input.outputSettings.aspectRatio !== "9:16"
      || !sameStringArray(imagePackage.channelTargets, ["instagram"])
      || imagePackage.aspectRatio !== "9:16") invalid();
  } else if (!sameStringArray(input.outputSettings.channelTargets, ["blog_export"])
    || input.outputSettings.aspectRatio !== null
    || !sameStringArray(imagePackage.channelTargets, ["blog_export"])) invalid();
  const expectedPlanVersion = format === "card_news" ? "card-news-plan.v2" : format === "blog" ? "blog-plan.v2" : "reel-plan.v2";
  if (
    input.generationId !== identity.generationId
    || plan.contractVersion !== expectedPlanVersion
    || plan.imagePackage === null
    || !isDeepStrictEqual(plan.imagePackage, imagePackage)
    || imagePackage.generationId !== identity.generationId
    || imagePackage.outputFormat !== format
    || imagePackage.purpose !== input.outputSettings.purpose
    || input.selectedProposal.outputFormat !== format
    || input.selectedProposal.purposeDetails.kind !== input.outputSettings.purpose
    || !sameStringArray(imagePackage.channelTargets, input.outputSettings.channelTargets)
    || !sameStringArray(input.selectedProposal.channelTargets, input.outputSettings.channelTargets)
    || (input.outputSettings.aspectRatio !== null && imagePackage.aspectRatio !== input.outputSettings.aspectRatio)
    || !isDeepStrictEqual(imagePackage.product, input.product)
    || !isDeepStrictEqual(imagePackage.references, input.references.selected)
    || !isDeepStrictEqual(imagePackage.brandStyleImages, input.references.brandStyleImages)
    || imagePackage.avatarStyleImageId !== input.references.avatarStyleImageId
    || !isDeepStrictEqual(imagePackage.attachments, input.references.attachments)
    || imagePackage.userImageInstruction !== input.userImageInstruction
    || imagePackage.assetCount !== imagePackage.assets.length
  ) invalid();
  if (format === "reel" && (!("outputFormat" in plan) || plan.outputFormat !== "reel")) invalid();
  if (input.outputSettings.purpose === "marketing" && (input.product === null
    || input.selectedProposal.purposeDetails.kind !== "marketing"
    || input.selectedProposal.purposeDetails.productId !== input.product.id)) invalid();

  const productIds = new Set(input.product?.images.map((item) => item.assetId) ?? []);
  const attachmentIds = new Set(input.references.attachments.map((item) => item.id));
  const evidenceIds = new Set(input.researchEvidence.items.map((item) => item.id));
  const selectedReferenceIds = new Set(input.references.selected.map((item) => item.referenceItemId));
  const styleIds = new Set(input.references.brandStyleImages.map((item) => item.referenceItemId));
  if (
    productIds.size !== (input.product?.images.length ?? 0)
    || attachmentIds.size !== input.references.attachments.length
    || evidenceIds.size !== input.researchEvidence.items.length
    || selectedReferenceIds.size !== input.references.selected.length
    || styleIds.size !== input.references.brandStyleImages.length
    || !duplicateFreeSubset(input.selectedProposal.evidenceIds, evidenceIds)
    || !duplicateFreeSubset(input.selectedProposal.referenceIds, selectedReferenceIds)
    || (input.references.avatarStyleImageId !== null && !styleIds.has(input.references.avatarStyleImageId))
  ) invalid();
  imagePackage.assets.forEach((asset, offset) => {
    if (
      asset.index !== offset + 1
      || !duplicateFreeSubset(asset.productImageAssetIds, productIds)
      || !duplicateFreeSubset(asset.attachmentIds, attachmentIds)
      || (format !== "blog" && !duplicateFreeSubset(asset.evidenceIds, evidenceIds))
    ) invalid();
  });
  if (format !== "blog") {
    if (input.selectedProposal.assetCount !== imagePackage.assetCount || input.selectedProposal.outline.length !== imagePackage.assetCount) invalid();
    imagePackage.assets.forEach((asset, offset) => {
      const outline = input.selectedProposal.outline[offset];
      if (!outline || outline.index !== asset.index || outline.role !== asset.role) invalid();
    });
  }
  const currentAsset = imagePackage.assets[identity.assetIndex - 1];
  if (!currentAsset || currentAsset.index !== identity.assetIndex || !currentAsset.role.trim()) invalid();
}

export function parseAiContentManualImageAssetPayloadV2(
  value: unknown,
  identity: AiContentManualImageAssetIdentity,
): AiContentManualImageAssetPayloadV2 {
  try {
    if (![identity.id, identity.generationId, identity.outputId, identity.workspaceId, identity.brandId].every((id) => UUID.test(id))) invalid();
    const source = exactRecord(value, [
      "contractVersion", "jobKind", "generationId", "outputId", "imagePackage", "assetIndex", "assetKey",
      "storagePath", "rendererPromptVersion", "contentGenerationInput", "contentPlan",
    ]);
    const imagePackage = parseImageGenerationPackageV1(source.imagePackage);
    const contentGenerationInput = parseContentGenerationInputV3(source.contentGenerationInput);
    const contentPlan = parseContentPlanResultV2(source.contentPlan);
    const expectedPath = `ai-content/${identity.brandId}/${identity.generationId}/${identity.outputId}/assets/${String(identity.assetIndex).padStart(2, "0")}.png`;
    if (
      source.contractVersion !== "ai-content-render-job.v2"
      || source.jobKind !== "image_asset"
      || source.rendererPromptVersion !== "image-final-pixels.v2"
      || source.generationId !== identity.generationId
      || source.outputId !== identity.outputId
      || source.assetIndex !== identity.assetIndex
      || source.assetKey !== `${identity.generationId}:${identity.assetIndex}`
      || source.storagePath !== expectedPath
    ) invalid();
    assertCanonicalBindings(identity, contentGenerationInput, contentPlan, imagePackage);
    return {
      contractVersion: "ai-content-render-job.v2", jobKind: "image_asset",
      generationId: identity.generationId, outputId: identity.outputId, imagePackage,
      assetIndex: identity.assetIndex, assetKey: String(source.assetKey), storagePath: String(source.storagePath),
      rendererPromptVersion: "image-final-pixels.v2", contentGenerationInput, contentPlan,
    };
  } catch {
    throw new Error("ai_content_render_job_invalid");
  }
}

export function parseAiContentManualImageAssetPayloadV3(
  value: unknown,
  identity: AiContentManualImageAssetIdentity,
): AiContentManualImageAssetPayloadV3 {
  try {
    if (![identity.id, identity.generationId, identity.outputId, identity.workspaceId, identity.brandId].every((id) => UUID.test(id))) invalid();
    const source = exactRecord(value, [
      "contractVersion", "jobKind", "generationId", "outputId", "imagePackage", "assetIndex", "assetKey",
      "storagePath", "rendererPromptVersion", "contentGenerationInput", "contentPlan",
      "renderSemanticBinding", "renderSemanticScene",
    ]);
    const imagePackage = parseImageGenerationPackageV1(source.imagePackage);
    const contentGenerationInput = parseContentGenerationInputV3(source.contentGenerationInput);
    const contentPlan = parseContentPlanResultV2(source.contentPlan);
    const binding = exactRecord(source.renderSemanticBinding, ["contractVersion", "semanticSha256", "sceneIndex"]);
    const semanticSource = exactRecord(source.renderSemanticScene, ["contractVersion", "scene"]);
    const scene = parseStructuredSceneCopyV1(semanticSource.scene);
    const expectedPath = `ai-content/${identity.brandId}/${identity.generationId}/${identity.outputId}/assets/${String(identity.assetIndex).padStart(2, "0")}.png`;
    if (
      source.contractVersion !== "ai-content-render-job.v3"
      || source.jobKind !== "image_asset"
      || source.rendererPromptVersion !== "image-final-pixels.v3"
      || source.generationId !== identity.generationId
      || source.outputId !== identity.outputId
      || source.assetIndex !== identity.assetIndex
      || source.assetKey !== `${identity.generationId}:${identity.assetIndex}`
      || source.storagePath !== expectedPath
      || binding.contractVersion !== "structured-scene-copy.v1"
      || typeof binding.semanticSha256 !== "string"
      || !/^[0-9a-f]{64}$/.test(binding.semanticSha256)
      || binding.sceneIndex !== identity.assetIndex
      || semanticSource.contractVersion !== "structured-scene-copy.v1"
      || scene.index !== identity.assetIndex
      || (imagePackage.outputFormat !== "card_news" && imagePackage.outputFormat !== "reel")
    ) invalid();
    assertCanonicalBindings(identity, contentGenerationInput, contentPlan, imagePackage);
    const currentAsset = imagePackage.assets[identity.assetIndex - 1];
    if (!currentAsset) invalid();
    const { attachmentIds: _attachmentIds, ...assetWithoutAttachments } = currentAsset;
    if (!isDeepStrictEqual(compileStructuredScene(scene), assetWithoutAttachments)) invalid();
    return {
      contractVersion: "ai-content-render-job.v3", jobKind: "image_asset",
      generationId: identity.generationId, outputId: identity.outputId, imagePackage,
      assetIndex: identity.assetIndex, assetKey: String(source.assetKey), storagePath: String(source.storagePath),
      rendererPromptVersion: "image-final-pixels.v3", contentGenerationInput, contentPlan,
      renderSemanticBinding: {
        contractVersion: "structured-scene-copy.v1",
        semanticSha256: String(binding.semanticSha256),
        sceneIndex: identity.assetIndex,
      },
      renderSemanticScene: { contractVersion: "structured-scene-copy.v1", scene },
    };
  } catch {
    throw new Error("ai_content_render_job_invalid");
  }
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function deriveBlogInsertionContext(
  payload: AiContentManualImageAssetPayloadV2,
): BlogInsertionContextV2 | null {
  if (payload.imagePackage.outputFormat !== "blog") return null;
  if (payload.contentPlan.contractVersion !== "blog-plan.v2") throw new Error("ai_content_blog_insertion_binding_invalid");
  try {
    const html = payload.contentPlan.content.htmlTemplate;
    const $ = load(html);
    const articles = $("article");
    if (articles.length !== 1) throw new Error();
    const images = articles.find("img").toArray();
    if ($("img").length !== images.length || images.length !== payload.imagePackage.assetCount) throw new Error();
    const sources = images.map((image) => $(image).attr("src"));
    const expected = Array.from({ length: payload.imagePackage.assetCount }, (_, offset) => `asset://${String(offset + 1).padStart(2, "0")}`);
    const rawPlaceholders = html.match(/asset:\/\/[^\s"'<>]*/g) ?? [];
    if (!isDeepStrictEqual(sources, expected) || !isDeepStrictEqual(rawPlaceholders, expected)) throw new Error();
    const target = images[payload.assetIndex - 1];
    if (!target) throw new Error();
    const altText = normalizedText($(target).attr("alt") ?? "");
    if (!altText) throw new Error();
    const sequence = articles.find("h1,h2,h3,h4,h5,h6,p,img").toArray();
    const targetOffset = sequence.indexOf(target);
    if (targetOffset < 0) throw new Error();
    let nearestHeading: string | null = null;
    let previousParagraph: string | null = null;
    for (let offset = targetOffset - 1; offset >= 0; offset -= 1) {
      const element = sequence[offset]!;
      if (previousParagraph === null && element.tagName === "p") previousParagraph = normalizedText($(element).text()) || null;
      if (/^h[1-6]$/.test(element.tagName)) {
        nearestHeading = normalizedText($(element).text()) || null;
        break;
      }
    }
    let nextParagraph: string | null = null;
    for (let offset = targetOffset + 1; offset < sequence.length; offset += 1) {
      const element = sequence[offset]!;
      if (element.tagName === "p") {
        nextParagraph = normalizedText($(element).text()) || null;
        break;
      }
    }
    return {
      placeholder: expected[payload.assetIndex - 1]!, altText, nearestHeading, previousParagraph, nextParagraph,
      role: payload.imagePackage.assets[payload.assetIndex - 1]!.role,
    };
  } catch {
    throw new Error("ai_content_blog_insertion_binding_invalid");
  }
}

export function buildAiContentManualRenderContract(input: {
  identity: AiContentManualImageAssetIdentity;
  payload: AiContentManualImageAssetPayload;
}): AiContentManualRenderContract {
  const currentAsset = input.payload.imagePackage.assets[input.identity.assetIndex - 1]!;
  if (input.payload.contractVersion === "ai-content-render-job.v3") {
    return {
      contractVersion: "ai-content-manual-render.v3",
      rendererPromptVersion: input.payload.rendererPromptVersion,
      generationId: input.identity.generationId,
      outputId: input.identity.outputId,
      workspaceId: input.identity.workspaceId,
      brandId: input.identity.brandId,
      assetIndex: input.identity.assetIndex,
      assetKey: input.payload.assetKey,
      storagePath: input.payload.storagePath,
      outputFormat: input.payload.imagePackage.outputFormat as "card_news" | "reel",
      purpose: input.payload.imagePackage.purpose,
      aspectRatio: input.payload.imagePackage.aspectRatio as "1:1" | "9:16",
      currentAsset: {
        index: currentAsset.index, role: currentAsset.role,
        copy: currentAsset.copy, visualDirection: currentAsset.visualDirection,
      },
      blogInsertionContext: null,
      renderSemanticScene: input.payload.renderSemanticScene,
    };
  }
  return {
    contractVersion: "ai-content-manual-render.v2",
    rendererPromptVersion: input.payload.rendererPromptVersion,
    generationId: input.identity.generationId,
    outputId: input.identity.outputId,
    workspaceId: input.identity.workspaceId,
    brandId: input.identity.brandId,
    assetIndex: input.identity.assetIndex,
    assetKey: input.payload.assetKey,
    storagePath: input.payload.storagePath,
    outputFormat: input.payload.imagePackage.outputFormat,
    purpose: input.payload.imagePackage.purpose,
    aspectRatio: input.payload.imagePackage.aspectRatio,
    currentAsset: {
      index: currentAsset.index,
      role: currentAsset.role,
      copy: currentAsset.copy,
      visualDirection: currentAsset.visualDirection,
    },
    blogInsertionContext: deriveBlogInsertionContext(input.payload),
  };
}
