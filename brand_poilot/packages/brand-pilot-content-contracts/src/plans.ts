import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { CONTENT_FORMAT_CATALOG } from "./catalog.js";
import { ImageGenerationPackageV1Schema } from "./generation.js";
import { UuidSchema } from "./snapshots.js";

export const PlanContractVersionSchema = Type.Union([
  Type.Literal(CONTENT_FORMAT_CATALOG.card_news.planContractVersion),
  Type.Literal(CONTENT_FORMAT_CATALOG.blog.planContractVersion),
  Type.Literal(CONTENT_FORMAT_CATALOG.reel.planContractVersion),
]);
export type PlanContractVersion = Static<typeof PlanContractVersionSchema>;

export const SocialPlanContentV2Schema = Type.Object({
  caption: Type.String({ minLength: 1, maxLength: 20_000 }),
  hashtags: Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { maxItems: 30 }),
  cta: Type.String({ minLength: 1, maxLength: 2_000 }),
}, { additionalProperties: false });
export type SocialPlanContentV2 = Static<typeof SocialPlanContentV2Schema>;

export const BlogPlanContentV2Schema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 500 }),
  htmlTemplate: Type.String({ minLength: 1, maxLength: 100_000 }),
  metaTitle: Type.String({ minLength: 1, maxLength: 500 }),
  metaDescription: Type.String({ minLength: 1, maxLength: 2_000 }),
  usedEvidenceIds: Type.Array(UuidSchema, { maxItems: 16 }),
}, { additionalProperties: false });
export type BlogPlanContentV2 = Static<typeof BlogPlanContentV2Schema>;

export const CardNewsPlanV2Schema = Type.Object({
  contractVersion: Type.Literal(CONTENT_FORMAT_CATALOG.card_news.planContractVersion),
  content: SocialPlanContentV2Schema,
  imagePackage: ImageGenerationPackageV1Schema,
}, { additionalProperties: false });
export type CardNewsPlanV2 = Static<typeof CardNewsPlanV2Schema>;

export const BlogPlanV2Schema = Type.Object({
  contractVersion: Type.Literal(CONTENT_FORMAT_CATALOG.blog.planContractVersion),
  content: BlogPlanContentV2Schema,
  imagePackage: Type.Union([ImageGenerationPackageV1Schema, Type.Null()]),
}, { additionalProperties: false });
export type BlogPlanV2 = Static<typeof BlogPlanV2Schema>;

export const ReelPlanV2Schema = Type.Object({
  contractVersion: Type.Literal(CONTENT_FORMAT_CATALOG.reel.planContractVersion),
  outputFormat: Type.Literal(CONTENT_FORMAT_CATALOG.reel.domainValue),
  content: SocialPlanContentV2Schema,
  imagePackage: ImageGenerationPackageV1Schema,
}, { additionalProperties: false });
export type ReelPlanV2 = Static<typeof ReelPlanV2Schema>;

export const ContentPlanResultV2Schema = Type.Union([
  CardNewsPlanV2Schema,
  BlogPlanV2Schema,
  ReelPlanV2Schema,
]);
export type ContentPlanResultV2 = Static<typeof ContentPlanResultV2Schema>;

function parse<S extends TSchema>(schema: S, value: unknown, code: string): Static<S> {
  if (!Value.Check(schema, value)) throw new Error(code);
  return value as Static<S>;
}

export function parseCardNewsPlanV2(value: unknown): CardNewsPlanV2 {
  return parse(CardNewsPlanV2Schema, value, "card_news_plan_v2_invalid");
}

export function parseBlogPlanV2(value: unknown): BlogPlanV2 {
  return parse(BlogPlanV2Schema, value, "blog_plan_v2_invalid");
}

export function parseReelPlanV2(value: unknown): ReelPlanV2 {
  return parse(ReelPlanV2Schema, value, "reel_plan_v2_invalid");
}

export function parseContentPlanResultV2(value: unknown): ContentPlanResultV2 {
  return parse(ContentPlanResultV2Schema, value, "content_plan_result_v2_invalid");
}
