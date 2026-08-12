import {
  compileStructuredScene,
  parseStructuredSceneCopyV1,
  type StructuredSceneCopyV1,
} from "@brand-pilot/content-contracts/structured-scene-copy";
import {
  parseReelPlanDraftV1 as parseContractDraft,
  type ReelPlanDraftV1,
} from "@brand-pilot/content-contracts/planner-drafts";

export interface StructuredReelPlanDraftV2 {
  contractVersion: "reel-plan-draft.v2";
  content: ReelPlanDraftV1["content"];
  assets: StructuredSceneCopyV1[];
}

function invalid(): never {
  throw new Error("reel_structured_draft_invalid");
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const source = value as Record<string, unknown>;
  if (Object.keys(source).length !== keys.length || keys.some((key) => !(key in source))) invalid();
  return source;
}

export function parseStructuredReelPlanDraftV2(value: unknown): StructuredReelPlanDraftV2 {
  const source = exactObject(value, ["contractVersion", "content", "assets"]);
  if (source.contractVersion !== "reel-plan-draft.v2" || !Array.isArray(source.assets)
    || source.assets.length < 1 || source.assets.length > 5) invalid();
  try {
    return {
      contractVersion: "reel-plan-draft.v2",
      content: source.content as ReelPlanDraftV1["content"],
      assets: source.assets.map(parseStructuredSceneCopyV1),
    };
  } catch {
    return invalid();
  }
}

export function compileStructuredReelPlanDraftV2(draft: StructuredReelPlanDraftV2): ReelPlanDraftV1 {
  try {
    return parseContractDraft({
      contractVersion: "reel-plan-draft.v1",
      content: draft.content,
      assets: draft.assets.map(compileStructuredScene),
    });
  } catch {
    return invalid();
  }
}
