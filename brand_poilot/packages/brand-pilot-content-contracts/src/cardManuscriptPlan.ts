import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { ContentGenerationInputV3 } from "./generation.js";
import { parseCardNewsPlanDraftV1, type CardNewsPlanDraftV1 } from "./plannerDrafts.js";
import { SocialPlanContentV2Schema } from "./plans.js";
import { UuidSchema } from "./snapshots.js";

export const CARD_MANUSCRIPT_PLAN_VERSION = "card-manuscript-plan.v1" as const;
export const CARD_MANUSCRIPT_COMPATIBILITY_VISUAL_DIRECTION = [
  "The downstream image model owns composition, layout, color, typography, imagery, and spacing.",
  "Preserve only the locked display copy. informationRelation describes meaning, not a required layout.",
].join("\n");

export const CardInformationRelationTypeV1Schema = Type.Union([
  Type.Literal("none"),
  Type.Literal("number"),
  Type.Literal("before_after"),
  Type.Literal("comparison"),
  Type.Literal("steps"),
  Type.Literal("quote"),
  Type.Literal("related_facts"),
]);

export const CardInformationRelationEntryV1Schema = Type.Object({
  role: Type.String({ minLength: 1, maxLength: 100 }),
  label: Type.Union([Type.Null(), Type.String({ minLength: 1, maxLength: 100 })]),
  value: Type.String({ minLength: 1, maxLength: 300 }),
}, { additionalProperties: false });

export const CardInformationRelationV1Schema = Type.Object({
  type: CardInformationRelationTypeV1Schema,
  entries: Type.Array(CardInformationRelationEntryV1Schema, { maxItems: 4 }),
}, { additionalProperties: false });

export const CardManuscriptSceneV1Schema = Type.Object({
  index: Type.Integer({ minimum: 1, maximum: 5 }),
  editorialRole: Type.String({ minLength: 1, maxLength: 200 }),
  purpose: Type.String({ minLength: 1, maxLength: 500 }),
  coreMessage: Type.String({ minLength: 1, maxLength: 500 }),
  headline: Type.String({ minLength: 1, maxLength: 300 }),
  informationRelation: CardInformationRelationV1Schema,
  supportingTexts: Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { maxItems: 2 }),
  footnote: Type.Union([Type.Null(), Type.String({ minLength: 1, maxLength: 300 })]),
  evidenceIds: Type.Array(UuidSchema, { maxItems: 8 }),
  productImageAssetIds: Type.Array(UuidSchema, { maxItems: 20 }),
  avatarImageAssetIds: Type.Array(UuidSchema, { maxItems: 5 }),
}, { additionalProperties: false });

export const CardManuscriptPlanV1Schema = Type.Object({
  contractVersion: Type.Literal(CARD_MANUSCRIPT_PLAN_VERSION),
  content: SocialPlanContentV2Schema,
  deckNarrative: Type.String({ minLength: 1, maxLength: 4_000 }),
  evidenceSelection: Type.Object({
    selectedEvidenceIds: Type.Array(UuidSchema, { maxItems: 8 }),
    excludedEvidenceIds: Type.Array(UuidSchema, { maxItems: 8 }),
  }, { additionalProperties: false }),
  scenes: Type.Array(CardManuscriptSceneV1Schema, { minItems: 1, maxItems: 5 }),
}, { additionalProperties: false });

export type CardInformationRelationV1 = Static<typeof CardInformationRelationV1Schema>;
export type CardManuscriptSceneV1 = Static<typeof CardManuscriptSceneV1Schema>;
export type CardManuscriptPlanV1 = Static<typeof CardManuscriptPlanV1Schema>;

function invalid(): never {
  throw new Error("card_manuscript_plan_v1_invalid");
}

function relationInvalid(): never {
  throw new Error("card_manuscript_information_relation_invalid");
}

function trimmed(value: string): string {
  const normalized = value.trim();
  if (!normalized) invalid();
  return normalized;
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function equalSets(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function normalizeRelation(source: CardInformationRelationV1): CardInformationRelationV1 {
  const relation: CardInformationRelationV1 = {
    type: source.type,
    entries: source.entries.map(({ role, label, value }) => ({
      role: trimmed(role),
      label: label === null ? null : trimmed(label),
      value: trimmed(value),
    })),
  };
  const roles = relation.entries.map(({ role }) => role);
  switch (relation.type) {
    case "none":
      if (roles.length !== 0) relationInvalid();
      break;
    case "number":
      if (roles.length < 1 || roles.some((role) => role !== "value")) relationInvalid();
      break;
    case "before_after":
      if (roles.length !== 2 || roles[0] !== "before" || roles[1] !== "after") relationInvalid();
      break;
    case "comparison":
      if (roles.length !== 2 || roles[0] !== "left" || roles[1] !== "right"
        || relation.entries.some(({ label }) => label === null)) relationInvalid();
      break;
    case "steps":
      if (roles.length < 2 || roles.some((role) => role !== "step")) relationInvalid();
      break;
    case "quote":
      if ((roles.length !== 1 && roles.length !== 2) || roles[0] !== "quote"
        || (roles.length === 2 && roles[1] !== "attribution")) relationInvalid();
      break;
    case "related_facts":
      if (roles.length < 2) relationInvalid();
      break;
  }
  return relation;
}

export function parseCardInformationRelationV1(value: unknown): CardInformationRelationV1 {
  if (!Value.Check(CardInformationRelationV1Schema, value)) relationInvalid();
  return normalizeRelation(value as CardInformationRelationV1);
}

function normalizeScene(source: CardManuscriptSceneV1): CardManuscriptSceneV1 {
  const scene: CardManuscriptSceneV1 = {
    index: source.index,
    editorialRole: trimmed(source.editorialRole),
    purpose: trimmed(source.purpose),
    coreMessage: trimmed(source.coreMessage),
    headline: trimmed(source.headline),
    informationRelation: parseCardInformationRelationV1(source.informationRelation),
    supportingTexts: source.supportingTexts.map(trimmed),
    footnote: source.footnote === null ? null : trimmed(source.footnote),
    evidenceIds: [...source.evidenceIds],
    productImageAssetIds: [...source.productImageAssetIds],
    avatarImageAssetIds: [...source.avatarImageAssetIds],
  };
  if (!unique(scene.evidenceIds) || !unique(scene.productImageAssetIds)
    || !unique(scene.avatarImageAssetIds)) invalid();
  return scene;
}

export function parseCardManuscriptPlanV1(
  value: unknown,
  frozenInput: ContentGenerationInputV3,
): CardManuscriptPlanV1 {
  if (!Value.Check(CardManuscriptPlanV1Schema, value)
    || frozenInput.outputSettings.outputFormat !== "card_news") invalid();
  const source = value as CardManuscriptPlanV1;
  const scenes = source.scenes.map(normalizeScene);
  if (scenes.length !== frozenInput.selectedProposal.outline.length
    || scenes.some(({ index }, offset) => index !== offset + 1)) invalid();

  const selectedEvidenceIds = [...source.evidenceSelection.selectedEvidenceIds];
  const excludedEvidenceIds = [...source.evidenceSelection.excludedEvidenceIds];
  if (!unique(selectedEvidenceIds) || !unique(excludedEvidenceIds)) {
    throw new Error("card_manuscript_evidence_partition_invalid");
  }
  const pool = new Set(frozenInput.researchEvidence.items.map(({ id }) => id));
  const selected = new Set(selectedEvidenceIds);
  const excluded = new Set(excludedEvidenceIds);
  const partition = new Set([...selectedEvidenceIds, ...excludedEvidenceIds]);
  if (!equalSets(pool, partition) || [...selected].some((id) => excluded.has(id))) {
    throw new Error("card_manuscript_evidence_partition_invalid");
  }
  const sceneUnion = new Set(scenes.flatMap(({ evidenceIds }) => evidenceIds));
  if (!equalSets(selected, sceneUnion) || [...sceneUnion].some((id) => !pool.has(id))) {
    throw new Error("card_manuscript_evidence_partition_invalid");
  }
  if (frozenInput.outputSettings.purpose === "informational"
    && scenes.some((scene) => scene.evidenceIds.length === 0
      && scene.editorialRole.toLowerCase() !== "transition"
      && scene.editorialRole.toLowerCase() !== "cta")) {
    throw new Error("card_manuscript_scene_evidence_required");
  }
  if (!unique(scenes.map(({ headline }) => headline.normalize("NFC")))
    || !unique(scenes.map(({ coreMessage }) => coreMessage.normalize("NFC")))) invalid();
  const hashtags = source.content.hashtags.map(trimmed);
  if (!unique(hashtags)) invalid();

  return {
    contractVersion: CARD_MANUSCRIPT_PLAN_VERSION,
    content: {
      caption: trimmed(source.content.caption),
      hashtags,
      cta: trimmed(source.content.cta),
    },
    deckNarrative: trimmed(source.deckNarrative),
    evidenceSelection: { selectedEvidenceIds, excludedEvidenceIds },
    scenes,
  };
}

export function flattenCardManuscriptScene(scene: CardManuscriptSceneV1): string {
  return [
    scene.headline,
    ...scene.informationRelation.entries.flatMap(({ label, value }) => label === null ? [value] : [label, value]),
    ...scene.supportingTexts,
    ...(scene.footnote === null ? [] : [scene.footnote]),
  ].join("\n");
}

export function compileCardManuscriptPlanDraftV1(
  manuscript: CardManuscriptPlanV1,
  outline: ReadonlyArray<{ index: number; role: string }>,
): CardNewsPlanDraftV1 {
  if (outline.length !== manuscript.scenes.length
    || outline.some(({ index, role }, offset) => index !== offset + 1 || !role.trim())) {
    throw new Error("card_manuscript_outline_mismatch");
  }
  return parseCardNewsPlanDraftV1({
    contractVersion: "card-news-plan-draft.v1",
    content: manuscript.content,
    assets: manuscript.scenes.map((scene, offset) => ({
      index: scene.index,
      role: outline[offset]!.role,
      copy: flattenCardManuscriptScene(scene),
      visualDirection: CARD_MANUSCRIPT_COMPATIBILITY_VISUAL_DIRECTION,
      evidenceIds: [...scene.evidenceIds],
      productImageAssetIds: [...scene.productImageAssetIds],
    })),
  });
}
