import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ContentGenerationInputV3 } from "@brand-pilot/content-contracts";
import {
  CARD_MANUSCRIPT_PLAN_VERSION,
  compileCardManuscriptPlanDraftV1,
  parseCardManuscriptPlanV1,
  type CardManuscriptPlanV1,
} from "@brand-pilot/content-contracts/card-manuscript-plan";
import { cardManuscriptPlanSha256 } from "@brand-pilot/content-contracts/card-manuscript-plan/node";
import type { CardNewsPlanDraftV1 } from "@brand-pilot/content-contracts/planner-drafts";

function invalid(detail: string): never {
  throw new Error(`card_news_plan_invalid:${detail}`);
}

function assertSubset(values: readonly string[], allowed: ReadonlySet<string>, detail: string): void {
  if (values.some((value) => !allowed.has(value))) invalid(detail);
}

export type CardManuscriptSubmission = {
  manuscriptPlan: CardManuscriptPlanV1;
  planDraft: CardNewsPlanDraftV1;
  cardManuscriptContract: {
    contractVersion: typeof CARD_MANUSCRIPT_PLAN_VERSION;
    manuscriptSha256: string;
    plan: CardManuscriptPlanV1;
  };
};

export function parseCardManuscriptSubmissionForInput(
  value: unknown,
  input: ContentGenerationInputV3,
): CardManuscriptSubmission {
  let manuscriptPlan: CardManuscriptPlanV1;
  try {
    manuscriptPlan = parseCardManuscriptPlanV1(value, input);
  } catch (error) {
    invalid(error instanceof Error ? error.message : "card_manuscript_plan_invalid");
  }
  if (input.selectedProposal.assetCount === null
    || manuscriptPlan.scenes.length !== input.selectedProposal.assetCount
    || input.selectedProposal.outline.length !== input.selectedProposal.assetCount) {
    invalid("asset_count_mismatch");
  }
  const productImageIds = new Set(input.product?.images.map(({ assetId }) => assetId) ?? []);
  const avatarImageIds = new Set(input.references.brandStyleImages
    .filter(({ tags }) => tags.includes("avatar"))
    .map(({ referenceItemId }) => referenceItemId));
  for (const scene of manuscriptPlan.scenes) {
    assertSubset(scene.productImageAssetIds, productImageIds, "product_image_id_unknown");
    assertSubset(scene.avatarImageAssetIds, avatarImageIds, "avatar_image_id_unknown");
  }
  let planDraft: CardNewsPlanDraftV1;
  try {
    planDraft = compileCardManuscriptPlanDraftV1(manuscriptPlan, input.selectedProposal.outline);
  } catch {
    invalid("outline_mismatch");
  }
  return {
    manuscriptPlan,
    planDraft,
    cardManuscriptContract: {
      contractVersion: CARD_MANUSCRIPT_PLAN_VERSION,
      manuscriptSha256: cardManuscriptPlanSha256(manuscriptPlan),
      plan: manuscriptPlan,
    },
  };
}

export async function loadCardManuscriptSubmission(outputDir: string, input: ContentGenerationInputV3) {
  const value = JSON.parse(await readFile(path.join(outputDir, "card-manuscript-plan.json"), "utf8"));
  return parseCardManuscriptSubmissionForInput(value, input);
}
