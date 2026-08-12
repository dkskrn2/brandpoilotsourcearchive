import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ContentGenerationInputV3 } from "@brand-pilot/content-contracts";
import {
  CARD_DECK_EDITORIAL_PLAN_VERSION,
  compileCardDeckPlanDraftV1,
  parseCardDeckEditorialPlanV1,
  type CardDeckEditorialPlanV1,
} from "@brand-pilot/content-contracts/card-deck-editorial-plan";
import { cardDeckEditorialPlanSha256 } from "@brand-pilot/content-contracts/card-deck-editorial-plan/node";
import type { CardNewsPlanDraftV1 } from "@brand-pilot/content-contracts/planner-drafts";

function invalid(detail: string): never {
  throw new Error(`card_news_plan_invalid:${detail}`);
}

function assertSubset(values: readonly string[], allowed: ReadonlySet<string>, detail: string): void {
  if (values.some((value) => !allowed.has(value))) invalid(detail);
}

export type CardDeckSubmission = {
  deckPlan: CardDeckEditorialPlanV1;
  planDraft: CardNewsPlanDraftV1;
  cardDeckContract: {
    contractVersion: typeof CARD_DECK_EDITORIAL_PLAN_VERSION;
    deckSha256: string;
    plan: CardDeckEditorialPlanV1;
  };
};

export function parseCardDeckSubmissionForInput(
  value: unknown,
  input: ContentGenerationInputV3,
): CardDeckSubmission {
  let deckPlan: CardDeckEditorialPlanV1;
  try {
    deckPlan = parseCardDeckEditorialPlanV1(value);
  } catch {
    invalid("card_deck_editorial_plan_invalid");
  }
  if (input.selectedProposal.assetCount === null
    || deckPlan.scenes.length !== input.selectedProposal.assetCount
    || input.selectedProposal.outline.length !== input.selectedProposal.assetCount) {
    invalid("asset_count_mismatch");
  }
  const evidenceIds = new Set(input.researchEvidence.items.map(({ id }) => id));
  const productImageIds = new Set(input.product?.images.map(({ assetId }) => assetId) ?? []);
  for (const scene of deckPlan.scenes) {
    assertSubset(scene.evidenceIds, evidenceIds, "evidence_id_unknown");
    assertSubset(scene.productImageAssetIds, productImageIds, "product_image_id_unknown");
  }
  let planDraft: CardNewsPlanDraftV1;
  try {
    planDraft = compileCardDeckPlanDraftV1(deckPlan, input.selectedProposal.outline);
  } catch {
    invalid("outline_mismatch");
  }
  return {
    deckPlan,
    planDraft,
    cardDeckContract: {
      contractVersion: CARD_DECK_EDITORIAL_PLAN_VERSION,
      deckSha256: cardDeckEditorialPlanSha256(deckPlan),
      plan: deckPlan,
    },
  };
}

export async function loadCardDeckSubmission(outputDir: string, input: ContentGenerationInputV3) {
  const value = JSON.parse(await readFile(path.join(outputDir, "card-deck-editorial-plan.json"), "utf8"));
  return parseCardDeckSubmissionForInput(value, input);
}
