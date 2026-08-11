import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ContentGenerationInputV3 } from "@brand-pilot/content-contracts";
import {
  parseCardNewsPlanDraftV1 as parseContractDraft,
  type CardNewsPlanDraftV1,
} from "@brand-pilot/content-contracts/planner-drafts";
import {
  compileStructuredCardNewsPlanDraftV2,
  parseStructuredCardNewsPlanDraftV2,
} from "./structuredSceneDraft.js";

function planMismatch(detail: string): never {
  throw new Error(`card_news_plan_invalid:${detail}`);
}

function assertDuplicateFreeSubset(
  values: readonly string[],
  allowed: ReadonlySet<string>,
  duplicateDetail: string,
  unknownDetail: string,
): void {
  if (new Set(values).size !== values.length) planMismatch(duplicateDetail);
  if (values.some((value) => !allowed.has(value))) planMismatch(unknownDetail);
}

export function parseCardNewsPlanDraftV1(
  value: unknown,
  input: ContentGenerationInputV3,
): CardNewsPlanDraftV1 {
  let draft: CardNewsPlanDraftV1;
  try {
    draft = parseContractDraft(value);
  } catch {
    planMismatch("card_news_plan_draft_invalid");
  }

  const hashtags = draft.content.hashtags.map((value) => value.trim());
  if (!draft.content.caption.trim() || !draft.content.cta.trim() || hashtags.some((value) => !value)) {
    planMismatch("content_invalid");
  }
  if (new Set(hashtags).size !== hashtags.length) planMismatch("hashtag_duplicate");

  const outline = input.selectedProposal.outline;
  if (
    input.selectedProposal.assetCount === null
    || draft.assets.length !== input.selectedProposal.assetCount
    || outline.length !== input.selectedProposal.assetCount
  ) {
    planMismatch("asset_count_mismatch");
  }

  const allowedEvidenceIds = new Set(input.researchEvidence.items.map((item) => item.id));
  const allowedProductImageIds = new Set(input.product?.images.map((image) => image.assetId) ?? []);
  draft.assets.forEach((asset, offset) => {
    const locked = outline[offset];
    if (!locked || asset.index !== locked.index) planMismatch("asset_index_mismatch");
    if (asset.role !== locked.role) planMismatch("asset_role_mismatch");
    assertDuplicateFreeSubset(asset.evidenceIds, allowedEvidenceIds, "evidence_id_duplicate", "evidence_id_unknown");
    assertDuplicateFreeSubset(
      asset.productImageAssetIds,
      allowedProductImageIds,
      "product_image_id_duplicate",
      "product_image_id_unknown",
    );
  });

  return draft;
}

export function parseStructuredCardNewsPlanDraftForInput(
  value: unknown,
  input: ContentGenerationInputV3,
): CardNewsPlanDraftV1 {
  try {
    const draft = parseStructuredCardNewsPlanDraftV2(value);
    return parseCardNewsPlanDraftV1(compileStructuredCardNewsPlanDraftV2(draft), input);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("card_news_plan_invalid:")) throw error;
    planMismatch("card_news_plan_draft_invalid");
  }
}

export async function loadStructuredCardNewsPlanDraft(outputDir: string, input: ContentGenerationInputV3) {
  const value = JSON.parse(await readFile(path.join(outputDir, "card-news-plan.json"), "utf8"));
  return parseStructuredCardNewsPlanDraftForInput(value, input);
}
