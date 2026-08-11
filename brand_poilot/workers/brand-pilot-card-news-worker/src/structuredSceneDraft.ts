import {
  parseCardNewsPlanDraftV1 as parseContractDraft,
  type CardNewsPlanDraftV1,
} from "@brand-pilot/content-contracts/planner-drafts";

const KEY_VISUAL_TYPES = ["none", "number", "before_after", "comparison", "steps", "quote"] as const;
type KeyVisualType = (typeof KEY_VISUAL_TYPES)[number];

export interface StructuredCardNewsPlanDraftV2 {
  contractVersion: "card-news-plan-draft.v2";
  content: CardNewsPlanDraftV1["content"];
  assets: Array<{
    index: number;
    role: string;
    coreMessage: string;
    headline: string;
    keyVisual: { type: KeyVisualType; texts: string[] };
    supportingTexts: string[];
    footnote: string | null;
    visualDirection: string;
    evidenceIds: string[];
    productImageAssetIds: string[];
  }>;
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

function requiredText(value: unknown, maxLength: number, trim = true): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) invalid();
  return trim ? value.trim() : value;
}

function textList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) invalid();
  return value.map((item) => requiredText(item, maxLength));
}

function idList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== "string")) invalid();
  return [...value] as string[];
}

export function parseStructuredCardNewsPlanDraftV2(value: unknown): StructuredCardNewsPlanDraftV2 {
  const source = exactObject(value, ["contractVersion", "content", "assets"]);
  if (source.contractVersion !== "card-news-plan-draft.v2" || !Array.isArray(source.assets)
    || source.assets.length < 1 || source.assets.length > 5) invalid();

  const assets = source.assets.map((item) => {
    const asset = exactObject(item, [
      "index", "role", "coreMessage", "headline", "keyVisual", "supportingTexts", "footnote",
      "visualDirection", "evidenceIds", "productImageAssetIds",
    ]);
    if (!Number.isInteger(asset.index) || Number(asset.index) < 1 || Number(asset.index) > 5) invalid();
    const keyVisual = exactObject(asset.keyVisual, ["type", "texts"]);
    if (!(KEY_VISUAL_TYPES as readonly unknown[]).includes(keyVisual.type)) invalid();
    const keyVisualTexts = textList(keyVisual.texts, 4, 300);
    if ((keyVisual.type === "none" && keyVisualTexts.length !== 0)
      || (keyVisual.type !== "none" && keyVisualTexts.length === 0)) invalid();
    const footnote = asset.footnote === null ? null : requiredText(asset.footnote, 300);
    return {
      index: Number(asset.index),
      role: requiredText(asset.role, 200, false),
      coreMessage: requiredText(asset.coreMessage, 500),
      headline: requiredText(asset.headline, 300),
      keyVisual: { type: keyVisual.type as KeyVisualType, texts: keyVisualTexts },
      supportingTexts: textList(asset.supportingTexts, 2, 300),
      footnote,
      visualDirection: requiredText(asset.visualDirection, 3_500),
      evidenceIds: idList(asset.evidenceIds, 8),
      productImageAssetIds: idList(asset.productImageAssetIds, 20),
    };
  });

  return {
    contractVersion: "card-news-plan-draft.v2",
    content: source.content as CardNewsPlanDraftV1["content"],
    assets,
  };
}

export function compileStructuredCardNewsPlanDraftV2(
  draft: StructuredCardNewsPlanDraftV2,
): CardNewsPlanDraftV1 {
  return parseContractDraft({
    contractVersion: "card-news-plan-draft.v1",
    content: draft.content,
    assets: draft.assets.map((asset) => {
      const displayTexts = [
        asset.headline,
        ...asset.keyVisual.texts,
        ...asset.supportingTexts,
        ...(asset.footnote === null ? [] : [asset.footnote]),
      ];
      const copy = displayTexts.join("\n");
      const hierarchy = `정보 위계(서버 고정): headline=1; keyVisual=${asset.keyVisual.type}:${asset.keyVisual.texts.length}; supportingTexts=${asset.supportingTexts.length}; footnote=${asset.footnote === null ? 0 : 1}`;
      const visualDirection = `${hierarchy}\n${asset.visualDirection}`;
      if (copy.length > 4_000 || visualDirection.length > 4_000) invalid();
      return {
        index: asset.index,
        role: asset.role,
        copy,
        visualDirection,
        evidenceIds: asset.evidenceIds,
        productImageAssetIds: asset.productImageAssetIds,
      };
    }),
  });
}
