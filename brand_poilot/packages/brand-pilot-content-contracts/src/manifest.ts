import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  AI_CONTENT_MANIFEST_VERSION,
  ContentPurposeSchema,
  ContentStudioOutputFormatSchema,
} from "./catalog.js";
import { NonEmptyStringSchema } from "./snapshots.js";

export const ManifestImageAssetSchema = Type.Object({
  role: Type.Union([Type.Literal("slide"), Type.Literal("inline"), Type.Literal("scene")]),
  index: Type.Integer({ minimum: 1 }),
  url: NonEmptyStringSchema,
  fileName: NonEmptyStringSchema,
  mimeType: Type.Literal("image/png"),
  width: Type.Integer({ minimum: 1 }),
  height: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });
export type ManifestImageAsset = Static<typeof ManifestImageAssetSchema>;

export const ManifestHtmlAssetSchema = Type.Object({
  role: Type.Literal("html"),
  index: Type.Integer({ minimum: 1 }),
  url: NonEmptyStringSchema,
  fileName: NonEmptyStringSchema,
  mimeType: Type.Literal("text/html"),
}, { additionalProperties: false });
export type ManifestHtmlAsset = Static<typeof ManifestHtmlAssetSchema>;

export const ManifestVideoAssetSchema = Type.Object({
  role: Type.Literal("video"),
  index: Type.Integer({ minimum: 1 }),
  url: NonEmptyStringSchema,
  fileName: NonEmptyStringSchema,
  mimeType: Type.Literal("video/mp4"),
  width: Type.Integer({ minimum: 1 }),
  height: Type.Integer({ minimum: 1 }),
  durationSeconds: Type.Number({ exclusiveMinimum: 0 }),
  videoCodec: Type.Literal("h264"),
  fps: Type.Literal(30),
  audioCodec: Type.Null(),
}, { additionalProperties: false });
export type ManifestVideoAsset = Static<typeof ManifestVideoAssetSchema>;

export const ManifestAssetSchema = Type.Union([
  ManifestImageAssetSchema,
  ManifestHtmlAssetSchema,
  ManifestVideoAssetSchema,
]);
export type ManifestAsset = Static<typeof ManifestAssetSchema>;

export const SocialManifestContentSchema = Type.Object({
  caption: NonEmptyStringSchema,
  hashtags: Type.Array(NonEmptyStringSchema),
  cta: NonEmptyStringSchema,
}, { additionalProperties: false });
export type SocialManifestContent = Static<typeof SocialManifestContentSchema>;

export const BlogManifestContentSchema = Type.Object({
  title: NonEmptyStringSchema,
  summary: NonEmptyStringSchema,
  html: NonEmptyStringSchema,
  metaTitle: NonEmptyStringSchema,
  metaDescription: NonEmptyStringSchema,
}, { additionalProperties: false });
export type BlogManifestContent = Static<typeof BlogManifestContentSchema>;

export const ManifestContentSchema = Type.Union([
  SocialManifestContentSchema,
  BlogManifestContentSchema,
]);
export type ManifestContent = Static<typeof ManifestContentSchema>;

export const AiContentManifestV3Schema = Type.Object({
  version: Type.Literal(AI_CONTENT_MANIFEST_VERSION),
  outputFormat: ContentStudioOutputFormatSchema,
  purpose: ContentPurposeSchema,
  title: NonEmptyStringSchema,
  assets: Type.Array(ManifestAssetSchema, { minItems: 1 }),
  content: ManifestContentSchema,
}, { additionalProperties: false });
export type AiContentManifestV3 = Static<typeof AiContentManifestV3Schema>;

export function parseAiContentManifestV3(value: unknown): AiContentManifestV3 {
  if (!Value.Check(AiContentManifestV3Schema, value)) {
    throw new Error("ai_content_manifest_v3_invalid");
  }
  return value as AiContentManifestV3;
}
