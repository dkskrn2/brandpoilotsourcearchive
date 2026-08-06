import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import {
  parseImageGenerationPackageV1,
  type CardNewsPlanV2,
  type ContentGenerationInputV3,
} from "@brand-pilot/content-contracts";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function exactObject(value: unknown, keys: string[]): Record<string, unknown> {
  const source = record(value);
  if (!source || Object.keys(source).length !== keys.length || keys.some((key) => !(key in source))) throw new Error();
  return source;
}

function requiredText(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error();
  return value;
}

function planMismatch(detail: string): never {
  throw new Error(`card_news_plan_invalid:${detail}`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateAssetEvidenceIds(value: unknown, allowedEvidenceIds: Set<string>): void {
  const asset = record(value);
  if (!asset || !Array.isArray(asset.evidenceIds) || asset.evidenceIds.length > 8) planMismatch("evidence_ids_malformed");
  if (asset.evidenceIds.some((id) => typeof id !== "string" || !UUID.test(id))) planMismatch("evidence_ids_malformed");
  if (new Set(asset.evidenceIds).size !== asset.evidenceIds.length) planMismatch("evidence_id_duplicate");
  if (asset.evidenceIds.some((id) => !allowedEvidenceIds.has(id as string))) planMismatch("evidence_id_unknown");
}

export function parseCardNewsPlanV2(value: unknown, input: ContentGenerationInputV3): CardNewsPlanV2 {
  try {
    const source = exactObject(value, ["contractVersion", "content", "imagePackage"]);
    if (source.contractVersion !== "card-news-plan.v2") throw new Error();
    const contentSource = exactObject(source.content, ["caption", "hashtags", "cta"]);
    if (!Array.isArray(contentSource.hashtags) || contentSource.hashtags.length > 30) throw new Error();
    const hashtags = contentSource.hashtags.map((item) => requiredText(item, 100));
    if (new Set(hashtags).size !== hashtags.length) throw new Error();
    const rawPackage = exactObject(source.imagePackage, ["contractVersion", "generationId", "outputFormat", "purpose", "assetCount", "aspectRatio", "channelTargets", "assets", "product", "references", "brandStyleImages", "avatarStyleImageId", "attachments", "userImageInstruction", "logoPolicy"]);
    if (rawPackage.assetCount !== input.selectedProposal.assetCount) planMismatch("asset_count_mismatch");
    if (!Array.isArray(rawPackage.assets) || rawPackage.assets.length !== input.selectedProposal.outline.length) planMismatch("asset_count_mismatch");
    const allowedEvidenceIds = new Set(input.researchEvidence.items.map((item) => item.id));
    rawPackage.assets.forEach((value, offset) => {
      const asset = record(value);
      const locked = input.selectedProposal.outline[offset];
      if (!asset || !locked || asset.index !== locked.index) planMismatch("asset_index_mismatch");
      if (asset.role !== locked.role) planMismatch("asset_role_mismatch");
      validateAssetEvidenceIds(value, allowedEvidenceIds);
    });
    const rawLogoPolicy = record(rawPackage.logoPolicy);
    if (!rawLogoPolicy || rawLogoPolicy.allowGeneratedLogo !== false || rawLogoPolicy.allowReservedLogoArea !== false
      || rawLogoPolicy.allowExternalReferenceLogo !== false || rawLogoPolicy.allowExistingProductPackagingLogo !== true) {
      planMismatch("logo_policy_mismatch");
    }
    const imagePackage = parseImageGenerationPackageV1(rawPackage);
    if (input.outputSettings.outputFormat !== "card_news" || imagePackage.generationId !== input.generationId
      || imagePackage.outputFormat !== "card_news" || imagePackage.purpose !== input.outputSettings.purpose
      || imagePackage.assetCount !== input.selectedProposal.assetCount || imagePackage.aspectRatio !== input.outputSettings.aspectRatio
      || !isDeepStrictEqual(imagePackage.channelTargets, input.outputSettings.channelTargets)
      || !isDeepStrictEqual(imagePackage.product, input.product) || !isDeepStrictEqual(imagePackage.references, input.references.selected)
      || !isDeepStrictEqual(imagePackage.brandStyleImages, input.references.brandStyleImages)
      || imagePackage.avatarStyleImageId !== input.references.avatarStyleImageId
      || !isDeepStrictEqual(imagePackage.attachments, input.references.attachments)
      || imagePackage.userImageInstruction !== input.userImageInstruction) planMismatch("fixed_input_mismatch");
    return { contractVersion: "card-news-plan.v2", content: { caption: requiredText(contentSource.caption, 20_000), hashtags, cta: requiredText(contentSource.cta, 2_000) }, imagePackage };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("card_news_plan_invalid:")) throw error;
    throw new Error("card_news_plan_invalid");
  }
}

export async function loadCardNewsPlanV2(outputDir: string, input: ContentGenerationInputV3) {
  return parseCardNewsPlanV2(JSON.parse(await readFile(path.join(outputDir, "card-news-plan.json"), "utf8")), input);
}
