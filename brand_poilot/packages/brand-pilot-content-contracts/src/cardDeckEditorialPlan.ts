import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { CardNewsPlanDraftV1Schema, type CardNewsPlanDraftV1 } from "./plannerDrafts.js";
import { SocialPlanContentV2Schema } from "./plans.js";
import {
  parseStructuredSceneCopyV1,
  StructuredKeyVisualV1Schema,
  type StructuredSceneCopyV1,
} from "./structuredSceneCopy.js";
import { UuidSchema } from "./snapshots.js";

export const CARD_DECK_EDITORIAL_PLAN_VERSION = "card-deck-editorial-plan.v1" as const;

export const CardDeckLayoutArchetypeV1Schema = Type.Union([
  Type.Literal("cover_editorial"),
  Type.Literal("stat_focus"),
  Type.Literal("before_after"),
  Type.Literal("comparison"),
  Type.Literal("sequence"),
  Type.Literal("checklist"),
  Type.Literal("quote"),
  Type.Literal("editorial_freeform"),
]);

export const CardDeckVisualSystemV1Schema = Type.Object({
  paletteDirection: Type.String({ minLength: 1, maxLength: 1_000 }),
  typographyDirection: Type.String({ minLength: 1, maxLength: 1_000 }),
  graphicLanguage: Type.String({ minLength: 1, maxLength: 1_000 }),
  imageryDirection: Type.String({ minLength: 1, maxLength: 1_000 }),
  invariants: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { minItems: 1, maxItems: 12 }),
}, { additionalProperties: false });

export const CardDeckSceneV1Schema = Type.Object({
  index: Type.Integer({ minimum: 1, maximum: 5 }),
  editorialRole: Type.String({ minLength: 1, maxLength: 200 }),
  purpose: Type.String({ minLength: 1, maxLength: 500 }),
  coreMessage: Type.String({ minLength: 1, maxLength: 500 }),
  headline: Type.String({ minLength: 1, maxLength: 300 }),
  keyVisual: StructuredKeyVisualV1Schema,
  supportingTexts: Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { maxItems: 2 }),
  footnote: Type.Union([Type.Null(), Type.String({ minLength: 1, maxLength: 300 })]),
  visualThesis: Type.String({ minLength: 1, maxLength: 1_000 }),
  layoutArchetype: CardDeckLayoutArchetypeV1Schema,
  evidenceIds: Type.Array(UuidSchema, { maxItems: 8 }),
  productImageAssetIds: Type.Array(UuidSchema, { maxItems: 20 }),
  avatarImageAssetIds: Type.Optional(Type.Array(UuidSchema, { maxItems: 5 })),
}, { additionalProperties: false });

export const CardDeckEditorialPlanV1Schema = Type.Object({
  contractVersion: Type.Literal(CARD_DECK_EDITORIAL_PLAN_VERSION),
  content: SocialPlanContentV2Schema,
  deckNarrative: Type.String({ minLength: 1, maxLength: 4_000 }),
  visualSystem: CardDeckVisualSystemV1Schema,
  scenes: Type.Array(CardDeckSceneV1Schema, { minItems: 1, maxItems: 5 }),
}, { additionalProperties: false });

export type CardDeckEditorialPlanV1 = Static<typeof CardDeckEditorialPlanV1Schema>;
export type CardDeckSceneV1 = Static<typeof CardDeckSceneV1Schema>;

function invalid(): never {
  throw new Error("card_deck_editorial_plan_v1_invalid");
}

function trimmed(value: string): string {
  const normalized = value.trim();
  if (!normalized) invalid();
  return normalized;
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function normalizeScene(source: CardDeckSceneV1): CardDeckSceneV1 {
  const normalized: CardDeckSceneV1 = {
    index: source.index,
    editorialRole: trimmed(source.editorialRole),
    purpose: trimmed(source.purpose),
    coreMessage: trimmed(source.coreMessage),
    headline: trimmed(source.headline),
    keyVisual: {
      type: source.keyVisual.type,
      entries: source.keyVisual.entries.map(({ role, label, value }) => ({
        role,
        label: label === null ? null : trimmed(label),
        value: trimmed(value),
      })),
    },
    supportingTexts: source.supportingTexts.map(trimmed),
    footnote: source.footnote === null ? null : trimmed(source.footnote),
    visualThesis: trimmed(source.visualThesis),
    layoutArchetype: source.layoutArchetype,
    evidenceIds: [...source.evidenceIds],
    productImageAssetIds: [...source.productImageAssetIds],
    avatarImageAssetIds: [...(source.avatarImageAssetIds ?? [])],
  };
  if (!unique(normalized.evidenceIds) || !unique(normalized.productImageAssetIds)
    || !unique(normalized.avatarImageAssetIds ?? [])) invalid();
  try {
    parseStructuredSceneCopyV1({
      index: normalized.index,
      role: normalized.editorialRole,
      coreMessage: normalized.coreMessage,
      headline: normalized.headline,
      keyVisual: normalized.keyVisual,
      supportingTexts: normalized.supportingTexts,
      footnote: normalized.footnote,
      visualDirection: normalized.visualThesis,
      evidenceIds: normalized.evidenceIds,
      productImageAssetIds: normalized.productImageAssetIds,
    });
  } catch {
    invalid();
  }
  return normalized;
}

export function parseCardDeckEditorialPlanV1(value: unknown): CardDeckEditorialPlanV1 {
  if (!Value.Check(CardDeckEditorialPlanV1Schema, value)) invalid();
  const source = value as CardDeckEditorialPlanV1;
  const scenes = source.scenes.map(normalizeScene);
  if (scenes.some(({ index }, offset) => index !== offset + 1)) invalid();
  const hashtags = source.content.hashtags.map(trimmed);
  if (!unique(hashtags)) invalid();
  return {
    contractVersion: CARD_DECK_EDITORIAL_PLAN_VERSION,
    content: {
      caption: trimmed(source.content.caption),
      hashtags,
      cta: trimmed(source.content.cta),
    },
    deckNarrative: trimmed(source.deckNarrative),
    visualSystem: {
      paletteDirection: trimmed(source.visualSystem.paletteDirection),
      typographyDirection: trimmed(source.visualSystem.typographyDirection),
      graphicLanguage: trimmed(source.visualSystem.graphicLanguage),
      imageryDirection: trimmed(source.visualSystem.imageryDirection),
      invariants: source.visualSystem.invariants.map(trimmed),
    },
    scenes,
  };
}

function visualDirection(plan: CardDeckEditorialPlanV1, scene: CardDeckSceneV1): string {
  return [
    `Deck narrative: ${plan.deckNarrative}`,
    `Palette: ${plan.visualSystem.paletteDirection}`,
    `Typography: ${plan.visualSystem.typographyDirection}`,
    `Graphic language: ${plan.visualSystem.graphicLanguage}`,
    `Imagery: ${plan.visualSystem.imageryDirection}`,
    `Invariants: ${plan.visualSystem.invariants.join(" | ")}`,
    `Editorial role: ${scene.editorialRole}`,
    `Scene purpose: ${scene.purpose}`,
    `Visual thesis: ${scene.visualThesis}`,
    `Layout archetype: ${scene.layoutArchetype}`,
  ].join("\n");
}

export function compileCardDeckSceneV1(
  plan: CardDeckEditorialPlanV1,
  scene: CardDeckSceneV1,
  compatibilityRole: string,
): StructuredSceneCopyV1 {
  const role = compatibilityRole.trim();
  if (!role) throw new Error("card_deck_outline_mismatch");
  return parseStructuredSceneCopyV1({
    index: scene.index,
    role,
    coreMessage: scene.coreMessage,
    headline: scene.headline,
    keyVisual: scene.keyVisual,
    supportingTexts: scene.supportingTexts,
    footnote: scene.footnote,
    visualDirection: visualDirection(plan, scene),
    evidenceIds: scene.evidenceIds,
    productImageAssetIds: scene.productImageAssetIds,
  });
}

export function compileCardDeckPlanDraftV1(
  plan: CardDeckEditorialPlanV1,
  outline: ReadonlyArray<{ index: number; role: string }>,
): CardNewsPlanDraftV1 {
  if (outline.length !== plan.scenes.length
    || outline.some(({ index, role }, offset) => index !== offset + 1 || !role.trim())) {
    throw new Error("card_deck_outline_mismatch");
  }
  const draft = {
    contractVersion: "card-news-plan-draft.v1",
    content: plan.content,
    assets: plan.scenes.map((scene, offset) => {
      const compiled = compileCardDeckSceneV1(plan, scene, outline[offset]!.role);
      return {
        index: compiled.index,
        role: compiled.role,
        copy: [
          compiled.headline,
          ...compiled.keyVisual.entries.flatMap(({ label, value }) => label === null ? [value] : [label, value]),
          ...compiled.supportingTexts,
          ...(compiled.footnote === null ? [] : [compiled.footnote]),
        ].join("\n"),
        visualDirection: compiled.visualDirection,
        evidenceIds: compiled.evidenceIds,
        productImageAssetIds: compiled.productImageAssetIds,
      };
    }),
  };
  if (!Value.Check(CardNewsPlanDraftV1Schema, draft)) throw new Error("card_deck_plan_compile_invalid");
  return draft;
}
