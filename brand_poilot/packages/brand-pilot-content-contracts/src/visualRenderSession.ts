import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { ContentGenerationInputV3 } from "./generation.js";
import type { CardManuscriptPlanV1 } from "./cardManuscriptPlan.js";
import type { ReelStoryboardV1 } from "./reelStoryboard.js";

const Sha256Schema = Type.String({ pattern: "^[0-9a-f]{64}$" });
const UuidSchema = Type.String({ pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$" });

export const AiContentVisualSessionV1Schema = Type.Object({
  contractVersion: Type.Literal("ai-content-visual-session.v1"),
  outputFormat: Type.Union([Type.Literal("card_news"), Type.Literal("reel")]),
  source: Type.Object({
    contractVersion: Type.Union([Type.Literal("card-manuscript-plan.v1"), Type.Literal("reel-storyboard.v1")]),
    sha256: Sha256Schema,
  }, { additionalProperties: false }),
  narrative: Type.String({ minLength: 1, maxLength: 4_000 }),
  primaryMediumPolicy: Type.Object({
    mode: Type.Union([Type.Literal("brand_style_reference"), Type.Literal("free_once")]),
    styleReferenceIds: Type.Array(UuidSchema, { maxItems: 5 }),
  }, { additionalProperties: false }),
  scenes: Type.Array(Type.Object({
    index: Type.Integer({ minimum: 1, maximum: 5 }),
    editorialContext: Type.Object({
      editorialRole: Type.String({ minLength: 1, maxLength: 200 }), purpose: Type.String({ minLength: 1, maxLength: 500 }), coreMessage: Type.String({ minLength: 1, maxLength: 500 }),
    }, { additionalProperties: false }),
    lockedDisplay: Type.Object({
      headline: Type.String({ minLength: 1, maxLength: 300 }),
      relation: Type.Object({
        type: Type.String({ minLength: 1, maxLength: 100 }),
        entries: Type.Array(Type.Object({ role: Type.String({ minLength: 1, maxLength: 100 }), label: Type.Union([Type.Null(), Type.String({ minLength: 1, maxLength: 100 })]), value: Type.String({ minLength: 1, maxLength: 300 }) }, { additionalProperties: false }), { maxItems: 4 }),
      }, { additionalProperties: false }),
      supportingTexts: Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { maxItems: 2 }),
      footnote: Type.Union([Type.Null(), Type.String({ minLength: 1, maxLength: 300 })]),
    }, { additionalProperties: false }),
    referenceBindings: Type.Object({ productImageAssetIds: Type.Array(UuidSchema, { maxItems: 20 }), avatarImageAssetIds: Type.Array(UuidSchema, { maxItems: 5 }) }, { additionalProperties: false }),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 5 }),
}, { additionalProperties: false });

export type AiContentVisualSessionV1 = Static<typeof AiContentVisualSessionV1Schema>;
type References = ContentGenerationInputV3["references"];

function mediumPolicy(references: References): AiContentVisualSessionV1["primaryMediumPolicy"] {
  const styleReferenceIds = references.brandStyleImages.filter(({ tags }) => !tags.includes("avatar")).map(({ referenceItemId }) => referenceItemId);
  return styleReferenceIds.length ? { mode: "brand_style_reference", styleReferenceIds } : { mode: "free_once", styleReferenceIds: [] };
}

function checked(value: AiContentVisualSessionV1): AiContentVisualSessionV1 {
  if (!Value.Check(AiContentVisualSessionV1Schema, value) || value.scenes.some(({ index }, offset) => index !== offset + 1)) throw new Error("ai_content_visual_session_invalid");
  return value;
}

export function projectCardVisualRenderSession(input: { sourceSha256: string; references: References; plan: CardManuscriptPlanV1 }): AiContentVisualSessionV1 {
  return checked({
    contractVersion: "ai-content-visual-session.v1", outputFormat: "card_news",
    source: { contractVersion: "card-manuscript-plan.v1", sha256: input.sourceSha256 }, narrative: input.plan.deckNarrative,
    primaryMediumPolicy: mediumPolicy(input.references),
    scenes: input.plan.scenes.map((scene) => ({ index: scene.index, editorialContext: { editorialRole: scene.editorialRole, purpose: scene.purpose, coreMessage: scene.coreMessage }, lockedDisplay: { headline: scene.headline, relation: scene.informationRelation, supportingTexts: scene.supportingTexts, footnote: scene.footnote }, referenceBindings: { productImageAssetIds: scene.productImageAssetIds, avatarImageAssetIds: scene.avatarImageAssetIds } })),
  });
}

export function projectReelVisualRenderSession(input: { sourceSha256: string; references: References; storyboard: ReelStoryboardV1 }): AiContentVisualSessionV1 {
  return checked({
    contractVersion: "ai-content-visual-session.v1", outputFormat: "reel",
    source: { contractVersion: "reel-storyboard.v1", sha256: input.sourceSha256 }, narrative: input.storyboard.storyNarrative,
    primaryMediumPolicy: mediumPolicy(input.references),
    scenes: input.storyboard.scenes.map((scene) => ({ index: scene.index, editorialContext: { editorialRole: scene.editorialRole, purpose: scene.purpose, coreMessage: scene.coreMessage }, lockedDisplay: { headline: scene.headline, relation: scene.keyVisual, supportingTexts: scene.supportingTexts, footnote: scene.footnote }, referenceBindings: { productImageAssetIds: scene.productImageAssetIds, avatarImageAssetIds: scene.avatarImageAssetIds ?? [] } })),
  });
}

export function parseAiContentVisualSessionV1(value: unknown): AiContentVisualSessionV1 {
  if (!Value.Check(AiContentVisualSessionV1Schema, value)) throw new Error("ai_content_visual_session_invalid");
  return checked(value as AiContentVisualSessionV1);
}
