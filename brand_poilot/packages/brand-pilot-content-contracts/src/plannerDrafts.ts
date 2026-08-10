import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  BlogPlanContentV2Schema,
  SocialPlanContentV2Schema,
} from "./plans.js";
import {
  ContentAspectRatioSchema,
  UuidSchema,
} from "./snapshots.js";

export const CreativeAssetDraftV1Schema = Type.Object({
  index: Type.Integer({ minimum: 1, maximum: 5 }),
  role: Type.String({ minLength: 1, maxLength: 200 }),
  copy: Type.String({ minLength: 1, maxLength: 4_000 }),
  visualDirection: Type.String({ minLength: 1, maxLength: 4_000 }),
  evidenceIds: Type.Array(UuidSchema, { maxItems: 8 }),
  productImageAssetIds: Type.Array(UuidSchema, { maxItems: 20 }),
}, { additionalProperties: false });
export type CreativeAssetDraftV1 = Static<typeof CreativeAssetDraftV1Schema>;

const CreativeAssetDraftListV1Schema = Type.Array(CreativeAssetDraftV1Schema, {
  minItems: 1,
  maxItems: 5,
});

export const CardNewsPlanDraftV1Schema = Type.Object({
  contractVersion: Type.Literal("card-news-plan-draft.v1"),
  content: SocialPlanContentV2Schema,
  assets: CreativeAssetDraftListV1Schema,
}, { additionalProperties: false });
export type CardNewsPlanDraftV1 = Static<typeof CardNewsPlanDraftV1Schema>;

export const ReelPlanDraftV1Schema = Type.Object({
  contractVersion: Type.Literal("reel-plan-draft.v1"),
  content: SocialPlanContentV2Schema,
  assets: CreativeAssetDraftListV1Schema,
}, { additionalProperties: false });
export type ReelPlanDraftV1 = Static<typeof ReelPlanDraftV1Schema>;

export const BlogImageDraftV1Schema = Type.Object({
  aspectRatio: ContentAspectRatioSchema,
  assets: CreativeAssetDraftListV1Schema,
}, { additionalProperties: false });
export type BlogImageDraftV1 = Static<typeof BlogImageDraftV1Schema>;

export const BlogPlanDraftV1Schema = Type.Object({
  contractVersion: Type.Literal("blog-plan-draft.v1"),
  content: BlogPlanContentV2Schema,
  imageDraft: Type.Union([Type.Null(), BlogImageDraftV1Schema]),
}, { additionalProperties: false });
export type BlogPlanDraftV1 = Static<typeof BlogPlanDraftV1Schema>;

export const ContentPlanDraftV1Schema = Type.Union([
  CardNewsPlanDraftV1Schema,
  BlogPlanDraftV1Schema,
  ReelPlanDraftV1Schema,
]);
export type ContentPlanDraftV1 = Static<typeof ContentPlanDraftV1Schema>;

function parse<S extends TSchema>(schema: S, value: unknown, code: string): Static<S> {
  if (!Value.Check(schema, value)) throw new Error(code);
  return value as Static<S>;
}

export function parseCardNewsPlanDraftV1(value: unknown): CardNewsPlanDraftV1 {
  return parse(CardNewsPlanDraftV1Schema, value, "card_news_plan_draft_v1_invalid");
}

export function parseBlogPlanDraftV1(value: unknown): BlogPlanDraftV1 {
  return parse(BlogPlanDraftV1Schema, value, "blog_plan_draft_v1_invalid");
}

export function parseReelPlanDraftV1(value: unknown): ReelPlanDraftV1 {
  return parse(ReelPlanDraftV1Schema, value, "reel_plan_draft_v1_invalid");
}

export function parseContentPlanDraftV1(value: unknown): ContentPlanDraftV1 {
  return parse(ContentPlanDraftV1Schema, value, "content_plan_draft_v1_invalid");
}
