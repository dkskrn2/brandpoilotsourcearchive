import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { ReelPlanDraftV1Schema, type ReelPlanDraftV1 } from "./plannerDrafts.js";
import { SocialPlanContentV2Schema } from "./plans.js";
import {
  compileStructuredScene,
  parseStructuredSceneCopyV1,
  StructuredKeyVisualV1Schema,
  type StructuredSceneCopyV1,
} from "./structuredSceneCopy.js";
import { UuidSchema } from "./snapshots.js";
import type { ContentGenerationInputV3 } from "./generation.js";
import {
  CARD_MANUSCRIPT_COMPATIBILITY_VISUAL_DIRECTION,
  CardInformationRelationV1Schema,
  parseCardInformationRelationV1,
  type CardInformationRelationV1,
} from "./cardManuscriptPlan.js";

export const REEL_STORYBOARD_VERSION = "reel-storyboard.v1" as const;
export const REEL_STORYBOARD_V2_VERSION = "reel-storyboard.v2" as const;

export const ReelStoryboardLayoutArchetypeV1Schema = Type.Union([
  Type.Literal("vertical_hook"),
  Type.Literal("stat_focus"),
  Type.Literal("before_after"),
  Type.Literal("comparison"),
  Type.Literal("sequence"),
  Type.Literal("checklist"),
  Type.Literal("quote"),
  Type.Literal("editorial_freeform"),
]);

export const ReelStoryboardVisualSystemV1Schema = Type.Object({
  paletteDirection: Type.String({ minLength: 1, maxLength: 1_000 }),
  typographyDirection: Type.String({ minLength: 1, maxLength: 1_000 }),
  graphicLanguage: Type.String({ minLength: 1, maxLength: 1_000 }),
  imageryDirection: Type.String({ minLength: 1, maxLength: 1_000 }),
  invariants: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { minItems: 1, maxItems: 12 }),
}, { additionalProperties: false });

export const ReelStoryboardSceneV1Schema = Type.Object({
  index: Type.Integer({ minimum: 1, maximum: 5 }),
  editorialRole: Type.String({ minLength: 1, maxLength: 200 }),
  purpose: Type.String({ minLength: 1, maxLength: 500 }),
  coreMessage: Type.String({ minLength: 1, maxLength: 500 }),
  headline: Type.String({ minLength: 1, maxLength: 300 }),
  keyVisual: StructuredKeyVisualV1Schema,
  supportingTexts: Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { maxItems: 2 }),
  footnote: Type.Union([Type.Null(), Type.String({ minLength: 1, maxLength: 300 })]),
  visualThesis: Type.String({ minLength: 1, maxLength: 1_000 }),
  layoutArchetype: ReelStoryboardLayoutArchetypeV1Schema,
  evidenceIds: Type.Array(UuidSchema, { maxItems: 8 }),
  productImageAssetIds: Type.Array(UuidSchema, { maxItems: 20 }),
  avatarImageAssetIds: Type.Optional(Type.Array(UuidSchema, { maxItems: 5 })),
}, { additionalProperties: false });

export const ReelStoryboardV1Schema = Type.Object({
  contractVersion: Type.Literal(REEL_STORYBOARD_VERSION),
  content: SocialPlanContentV2Schema,
  storyNarrative: Type.String({ minLength: 1, maxLength: 4_000 }),
  visualSystem: ReelStoryboardVisualSystemV1Schema,
  scenes: Type.Array(ReelStoryboardSceneV1Schema, { minItems: 1, maxItems: 5 }),
}, { additionalProperties: false });

export type ReelStoryboardV1 = Static<typeof ReelStoryboardV1Schema>;
export type ReelStoryboardSceneV1 = Static<typeof ReelStoryboardSceneV1Schema>;

export const ReelStoryboardSceneV2Schema = Type.Object({
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

export const ReelStoryboardV2Schema = Type.Object({
  contractVersion: Type.Literal(REEL_STORYBOARD_V2_VERSION),
  content: SocialPlanContentV2Schema,
  storyNarrative: Type.String({ minLength: 1, maxLength: 4_000 }),
  evidenceSelection: Type.Object({
    selectedEvidenceIds: Type.Array(UuidSchema, { maxItems: 8 }),
    excludedEvidenceIds: Type.Array(UuidSchema, { maxItems: 8 }),
  }, { additionalProperties: false }),
  scenes: Type.Array(ReelStoryboardSceneV2Schema, { minItems: 1, maxItems: 5 }),
}, { additionalProperties: false });

export type ReelStoryboardV2 = Static<typeof ReelStoryboardV2Schema>;
export type ReelStoryboardSceneV2 = Static<typeof ReelStoryboardSceneV2Schema>;

function invalid(): never {
  throw new Error("reel_storyboard_v1_invalid");
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

function normalizeScene(source: ReelStoryboardSceneV1): ReelStoryboardSceneV1 {
  const normalized: ReelStoryboardSceneV1 = {
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

export function parseReelStoryboardV1(value: unknown): ReelStoryboardV1 {
  if (!Value.Check(ReelStoryboardV1Schema, value)) invalid();
  const source = value as ReelStoryboardV1;
  const scenes = source.scenes.map(normalizeScene);
  if (scenes.some(({ index }, offset) => index !== offset + 1)) invalid();
  const hashtags = source.content.hashtags.map(trimmed);
  if (!unique(hashtags)) invalid();
  return {
    contractVersion: REEL_STORYBOARD_VERSION,
    content: {
      caption: trimmed(source.content.caption),
      hashtags,
      cta: trimmed(source.content.cta),
    },
    storyNarrative: trimmed(source.storyNarrative),
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

function v2Invalid(): never {
  throw new Error("reel_storyboard_v2_invalid");
}

function v2Trimmed(value: string): string {
  const normalized = value.trim();
  if (!normalized) v2Invalid();
  return normalized;
}

function normalizeSceneV2(source: ReelStoryboardSceneV2): ReelStoryboardSceneV2 {
  const scene: ReelStoryboardSceneV2 = {
    index: source.index,
    editorialRole: v2Trimmed(source.editorialRole),
    purpose: v2Trimmed(source.purpose),
    coreMessage: v2Trimmed(source.coreMessage),
    headline: v2Trimmed(source.headline),
    informationRelation: parseCardInformationRelationV1(source.informationRelation),
    supportingTexts: source.supportingTexts.map(v2Trimmed),
    footnote: source.footnote === null ? null : v2Trimmed(source.footnote),
    evidenceIds: [...source.evidenceIds],
    productImageAssetIds: [...source.productImageAssetIds],
    avatarImageAssetIds: [...source.avatarImageAssetIds],
  };
  if (!unique(scene.evidenceIds) || !unique(scene.productImageAssetIds)
    || !unique(scene.avatarImageAssetIds)) v2Invalid();
  return scene;
}

export function parseReelStoryboardV2(
  value: unknown,
  frozenInput: ContentGenerationInputV3,
): ReelStoryboardV2 {
  if (!Value.Check(ReelStoryboardV2Schema, value)
    || frozenInput.outputSettings.outputFormat !== "reel") v2Invalid();
  const source = value as ReelStoryboardV2;
  const scenes = source.scenes.map(normalizeSceneV2);
  if (scenes.length !== frozenInput.selectedProposal.outline.length
    || scenes.some(({ index }, offset) => index !== offset + 1)) v2Invalid();
  const selectedEvidenceIds = [...source.evidenceSelection.selectedEvidenceIds];
  const excludedEvidenceIds = [...source.evidenceSelection.excludedEvidenceIds];
  if (!unique(selectedEvidenceIds) || !unique(excludedEvidenceIds)) {
    throw new Error("reel_storyboard_evidence_partition_invalid");
  }
  const pool = new Set(frozenInput.researchEvidence.items.map(({ id }) => id));
  const selected = new Set(selectedEvidenceIds);
  const excluded = new Set(excludedEvidenceIds);
  const partition = new Set([...selectedEvidenceIds, ...excludedEvidenceIds]);
  const sceneUnion = new Set(scenes.flatMap(({ evidenceIds }) => evidenceIds));
  if (!equalSets(pool, partition) || [...selected].some((id) => excluded.has(id))
    || !equalSets(selected, sceneUnion) || [...sceneUnion].some((id) => !pool.has(id))) {
    throw new Error("reel_storyboard_evidence_partition_invalid");
  }
  if (frozenInput.outputSettings.purpose === "informational"
    && scenes.some((scene) => scene.evidenceIds.length === 0
      && scene.editorialRole.toLowerCase() !== "transition"
      && scene.editorialRole.toLowerCase() !== "cta")) {
    throw new Error("reel_storyboard_scene_evidence_required");
  }
  if (!unique(scenes.map(({ headline }) => headline.normalize("NFC")))
    || !unique(scenes.map(({ coreMessage }) => coreMessage.normalize("NFC")))) v2Invalid();
  const hashtags = source.content.hashtags.map(v2Trimmed);
  if (!unique(hashtags)) v2Invalid();
  return {
    contractVersion: REEL_STORYBOARD_V2_VERSION,
    content: { caption: v2Trimmed(source.content.caption), hashtags, cta: v2Trimmed(source.content.cta) },
    storyNarrative: v2Trimmed(source.storyNarrative),
    evidenceSelection: { selectedEvidenceIds, excludedEvidenceIds },
    scenes,
  };
}

function visualDirection(storyboard: ReelStoryboardV1, scene: ReelStoryboardSceneV1): string {
  return [
    `Story narrative: ${storyboard.storyNarrative}`,
    `Palette: ${storyboard.visualSystem.paletteDirection}`,
    `Typography: ${storyboard.visualSystem.typographyDirection}`,
    `Graphic language: ${storyboard.visualSystem.graphicLanguage}`,
    `Imagery: ${storyboard.visualSystem.imageryDirection}`,
    `Invariants: ${storyboard.visualSystem.invariants.join(" | ")}`,
    `Editorial role: ${scene.editorialRole}`,
    `Scene purpose: ${scene.purpose}`,
    `Visual thesis: ${scene.visualThesis}`,
    `Layout archetype: ${scene.layoutArchetype}`,
  ].join("\n");
}

export function compileReelStoryboardSceneV1(
  storyboard: ReelStoryboardV1,
  scene: ReelStoryboardSceneV1,
  compatibilityRole: string,
): StructuredSceneCopyV1 {
  const role = compatibilityRole.trim();
  if (!role) throw new Error("reel_storyboard_outline_mismatch");
  return parseStructuredSceneCopyV1({
    index: scene.index,
    role,
    coreMessage: scene.coreMessage,
    headline: scene.headline,
    keyVisual: scene.keyVisual,
    supportingTexts: scene.supportingTexts,
    footnote: scene.footnote,
    visualDirection: visualDirection(storyboard, scene),
    evidenceIds: scene.evidenceIds,
    productImageAssetIds: scene.productImageAssetIds,
  });
}

export function compileReelStoryboardDraftV1(
  storyboard: ReelStoryboardV1,
  outline: ReadonlyArray<{ index: number; role: string }>,
): ReelPlanDraftV1 {
  if (outline.length !== storyboard.scenes.length
    || outline.some(({ index, role }, offset) => index !== offset + 1 || !role.trim())) {
    throw new Error("reel_storyboard_outline_mismatch");
  }
  const draft = {
    contractVersion: "reel-plan-draft.v1",
    content: storyboard.content,
    assets: storyboard.scenes.map((scene, offset) => compileStructuredScene(
      compileReelStoryboardSceneV1(storyboard, scene, outline[offset]!.role),
    )),
  };
  if (!Value.Check(ReelPlanDraftV1Schema, draft)) throw new Error("reel_storyboard_compile_invalid");
  return draft;
}

export function compileReelStoryboardSceneV2(
  scene: ReelStoryboardSceneV2,
  compatibilityRole: string,
): StructuredSceneCopyV1 {
  const role = compatibilityRole.trim();
  if (!role) throw new Error("reel_storyboard_outline_mismatch");
  const compatibilityRelation = scene.informationRelation.type === "related_facts"
    ? { ...scene.informationRelation, entries: scene.informationRelation.entries.map((entry) => ({ ...entry, role: "fact" })) }
    : scene.informationRelation;
  return parseStructuredSceneCopyV1({
    index: scene.index,
    role,
    coreMessage: scene.coreMessage,
    headline: scene.headline,
    keyVisual: compatibilityRelation as CardInformationRelationV1,
    supportingTexts: scene.supportingTexts,
    footnote: scene.footnote,
    visualDirection: CARD_MANUSCRIPT_COMPATIBILITY_VISUAL_DIRECTION,
    evidenceIds: scene.evidenceIds,
    productImageAssetIds: scene.productImageAssetIds,
  });
}

export function compileReelStoryboardDraftV2(
  storyboard: ReelStoryboardV2,
  outline: ReadonlyArray<{ index: number; role: string }>,
): ReelPlanDraftV1 {
  if (outline.length !== storyboard.scenes.length
    || outline.some(({ index, role }, offset) => index !== offset + 1 || !role.trim())) {
    throw new Error("reel_storyboard_outline_mismatch");
  }
  const draft = {
    contractVersion: "reel-plan-draft.v1",
    content: storyboard.content,
    assets: storyboard.scenes.map((scene, offset) => compileStructuredScene(
      compileReelStoryboardSceneV2(scene, outline[offset]!.role),
    )),
  };
  if (!Value.Check(ReelPlanDraftV1Schema, draft)) throw new Error("reel_storyboard_compile_invalid");
  return draft;
}
