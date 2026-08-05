import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  CONTENT_ORCHESTRATION_VERSION,
  ContentPurposeSchema,
  ContentStudioOutputFormatSchema,
} from "./catalog.js";
import {
  ContentAspectRatioSchema,
  ContentChannelTargetSchema,
  ContentReferenceRoleSchema,
  UuidSchema,
} from "./snapshots.js";

export const ContentOutputSettingsV2Schema = Type.Object({
  outputFormat: ContentStudioOutputFormatSchema,
  channelTargets: Type.Array(ContentChannelTargetSchema, { minItems: 1, maxItems: 1 }),
  aspectRatio: Type.Union([ContentAspectRatioSchema, Type.Null()]),
  outputCount: Type.Literal(1),
}, { additionalProperties: false });
export type ContentOutputSettingsV2 = Static<typeof ContentOutputSettingsV2Schema>;

export const ContentSeedV2Schema = Type.Union([
  Type.Object({
    kind: Type.Literal("topic_text"),
    title: Type.String({ minLength: 1, maxLength: 500 }),
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal("topic_url"),
    url: Type.String({ minLength: 1, maxLength: 2_000, pattern: "^https?://" }),
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal("reference"),
    items: Type.Array(Type.Object({
      referenceId: UuidSchema,
      roles: Type.Array(ContentReferenceRoleSchema, { minItems: 1, maxItems: 3 }),
    }, { additionalProperties: false }), { minItems: 1, maxItems: 5 }),
  }, { additionalProperties: false }),
]);
export type ContentSeedV2 = Static<typeof ContentSeedV2Schema>;

export const ContentOrchestrationV2Schema = Type.Object({
  contractVersion: Type.Literal(CONTENT_ORCHESTRATION_VERSION),
  brandId: UuidSchema,
  purpose: ContentPurposeSchema,
  seed: ContentSeedV2Schema,
  contentInstruction: Type.Union([Type.String({ minLength: 1, maxLength: 4_000 }), Type.Null()]),
  productId: Type.Union([UuidSchema, Type.Null()]),
  outputSettings: ContentOutputSettingsV2Schema,
}, { additionalProperties: false });
export type ContentOrchestrationV2 = Static<typeof ContentOrchestrationV2Schema>;

export function parseContentOrchestrationV2(value: unknown): ContentOrchestrationV2 {
  if (!Value.Check(ContentOrchestrationV2Schema, value)) {
    throw new Error("content_orchestration_v2_invalid");
  }
  return value as ContentOrchestrationV2;
}
