import {
  compileStructuredScene,
  parseStructuredSceneCopyV1,
  type StructuredSceneCopyV1,
} from "@brand-pilot/content-contracts/structured-scene-copy";
import {
  parseCardNewsPlanDraftV1 as parseContractDraft,
  type CardNewsPlanDraftV1,
} from "@brand-pilot/content-contracts/planner-drafts";

export interface StructuredCardNewsPlanDraftV2 {
  contractVersion: "card-news-plan-draft.v2";
  content: CardNewsPlanDraftV1["content"];
  assets: StructuredSceneCopyV1[];
}

function invalid(): never {
  throw new Error("card_news_plan_invalid:card_news_structured_draft_invalid");
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const source = value as Record<string, unknown>;
  if (Object.keys(source).length !== keys.length || keys.some((key) => !(key in source))) invalid();
  return source;
}

export function parseStructuredCardNewsPlanDraftV2(value: unknown): StructuredCardNewsPlanDraftV2 {
  const source = exactObject(value, ["contractVersion", "content", "assets"]);
  if (source.contractVersion !== "card-news-plan-draft.v2" || !Array.isArray(source.assets)
    || source.assets.length < 1 || source.assets.length > 5) invalid();
  try {
    return {
      contractVersion: "card-news-plan-draft.v2",
      content: source.content as CardNewsPlanDraftV1["content"],
      assets: source.assets.map(parseStructuredSceneCopyV1),
    };
  } catch {
    return invalid();
  }
}

export function compileStructuredCardNewsPlanDraftV2(
  draft: StructuredCardNewsPlanDraftV2,
): CardNewsPlanDraftV1 {
  try {
    return parseContractDraft({
      contractVersion: "card-news-plan-draft.v1",
      content: draft.content,
      assets: draft.assets.map(compileStructuredScene),
    });
  } catch {
    return invalid();
  }
}
