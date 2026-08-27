import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { UuidSchema } from "./snapshots.js";
import {
  DesignStyleAnalysisV1Schema,
  parseDesignStyleAnalysisV1,
} from "./designStyle.js";

const Sha256Schema = Type.String({ pattern: "^[0-9a-f]{64}$" });
const RevisionSchema = Type.Integer({ minimum: 1, maximum: 2_147_483_647 });

export const ManualVisualSelectionV1Schema = Type.Object({
  contractVersion: Type.Literal("manual-visual-selection.v1"),
  product: Type.Union([Type.Null(), Type.Object({
    productServiceId: UuidSchema,
    versionId: UuidSchema,
  }, { additionalProperties: false })]),
  stylePreset: Type.Union([Type.Null(), Type.Object({
    presetId: UuidSchema,
    revision: RevisionSchema,
  }, { additionalProperties: false })]),
  avatar: Type.Union([Type.Null(), Type.Object({
    avatarId: UuidSchema,
    revision: RevisionSchema,
  }, { additionalProperties: false })]),
}, { additionalProperties: false });

const ProductSelectionSchema = Type.Union([Type.Null(), Type.Object({
  productServiceId: UuidSchema,
  versionId: UuidSchema,
}, { additionalProperties: false })]);

export const ManualVisualSelectionV2Schema = Type.Object({
  contractVersion: Type.Literal("manual-visual-selection.v2"),
  product: ProductSelectionSchema,
  preset: Type.Union([Type.Null(), Type.Object({
    presetId: UuidSchema,
    revision: RevisionSchema,
  }, { additionalProperties: false })]),
}, { additionalProperties: false });

const FrozenProductSchema = Type.Object({
  productServiceId: UuidSchema,
  versionId: UuidSchema,
  kind: Type.Union([Type.Literal("product"), Type.Literal("service")]),
  name: Type.String({ minLength: 1, maxLength: 300 }),
  description: Type.String({ maxLength: 10_000 }),
  features: Type.Array(Type.String({ minLength: 1, maxLength: 1_000 }), { maxItems: 50 }),
  benefits: Type.Array(Type.String({ minLength: 1, maxLength: 1_000 }), { maxItems: 50 }),
  cautions: Type.Array(Type.String({ minLength: 1, maxLength: 1_000 }), { maxItems: 50 }),
  evergreenPurchaseInfo: Type.String({ maxLength: 5_000 }),
  images: Type.Array(Type.Object({
    assetId: UuidSchema,
    role: Type.Union([Type.Literal("hero"), Type.Literal("detail")]),
    position: Type.Integer({ minimum: 1, maximum: 5 }),
  }, { additionalProperties: false }), { maxItems: 5 }),
}, { additionalProperties: false });

const VisualTokensSchema = Type.Object({
  colors: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: 12 }),
  fonts: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { maxItems: 12 }),
  notes: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 20 }),
}, { additionalProperties: false });

export const FrozenManualVisualSelectionV1Schema = Type.Object({
  contractVersion: Type.Literal("manual-visual-selection-frozen.v1"),
  product: Type.Union([Type.Null(), FrozenProductSchema]),
  stylePreset: Type.Union([Type.Null(), Type.Object({
    presetId: UuidSchema,
    revision: RevisionSchema,
    name: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.String({ maxLength: 1_000 }),
    visualTokens: VisualTokensSchema,
    referenceItemIds: Type.Array(UuidSchema, { minItems: 1, maxItems: 5 }),
  }, { additionalProperties: false })]),
  avatar: Type.Union([Type.Null(), Type.Object({
    avatarId: UuidSchema,
    revision: RevisionSchema,
    name: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.String({ maxLength: 2_000 }),
    imageAssetIds: Type.Array(UuidSchema, { minItems: 1, maxItems: 5 }),
    objectSha256: Sha256Schema,
  }, { additionalProperties: false })]),
}, { additionalProperties: false });

export const FrozenManualVisualSelectionV2Schema = Type.Object({
  contractVersion: Type.Literal("manual-visual-selection-frozen.v2"),
  product: Type.Union([Type.Null(), FrozenProductSchema]),
  preset: Type.Union([Type.Null(), Type.Object({
    presetId: UuidSchema,
    revision: RevisionSchema,
    name: Type.String({ minLength: 1, maxLength: 120 }),
    designStyle: Type.Object({
      designStyleId: UuidSchema,
      revision: RevisionSchema,
      analysis: DesignStyleAnalysisV1Schema,
      referenceItemIds: Type.Array(UuidSchema, { minItems: 1, maxItems: 5 }),
    }, { additionalProperties: false }),
    avatar: Type.Union([Type.Null(), Type.Object({
      avatarId: UuidSchema,
      revision: RevisionSchema,
      name: Type.String({ minLength: 1, maxLength: 120 }),
      description: Type.String({ maxLength: 2_000 }),
      imageAssetIds: Type.Array(UuidSchema, { minItems: 1, maxItems: 5 }),
    }, { additionalProperties: false })]),
  }, { additionalProperties: false })]),
}, { additionalProperties: false });

export const ManualVisualSelectionSchema = Type.Union([
  ManualVisualSelectionV1Schema,
  ManualVisualSelectionV2Schema,
]);
export const FrozenManualVisualSelectionSchema = Type.Union([
  FrozenManualVisualSelectionV1Schema,
  FrozenManualVisualSelectionV2Schema,
]);

export type ManualVisualSelectionV1 = Static<typeof ManualVisualSelectionV1Schema>;
export type FrozenManualVisualSelectionV1 = Static<typeof FrozenManualVisualSelectionV1Schema>;
export type ManualVisualSelectionV2 = Static<typeof ManualVisualSelectionV2Schema>;
export type FrozenManualVisualSelectionV2 = Static<typeof FrozenManualVisualSelectionV2Schema>;
export type ManualVisualSelection = Static<typeof ManualVisualSelectionSchema>;
export type FrozenManualVisualSelection = Static<typeof FrozenManualVisualSelectionSchema>;

function invalid(): never { throw new Error("manual_visual_selection_invalid"); }
function unique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) invalid();
}

export function parseManualVisualSelectionV1(value: unknown): ManualVisualSelectionV1 {
  if (!Value.Check(ManualVisualSelectionV1Schema, value)) invalid();
  return structuredClone(value as ManualVisualSelectionV1);
}

export function parseFrozenManualVisualSelectionV1(value: unknown): FrozenManualVisualSelectionV1 {
  if (!Value.Check(FrozenManualVisualSelectionV1Schema, value)) invalid();
  const result = structuredClone(value as FrozenManualVisualSelectionV1);
  if (result.product) {
    unique(result.product.images.map(({ assetId }) => assetId));
    unique(result.product.images.map(({ position }) => String(position)));
    if (result.product.images.some(({ position }, index) => position !== index + 1)
      || (result.product.images.length > 0
        && result.product.images.filter(({ role }) => role === "hero").length !== 1)) invalid();
  }
  if (result.stylePreset) {
    unique(result.stylePreset.referenceItemIds);
    unique(result.stylePreset.visualTokens.colors);
    unique(result.stylePreset.visualTokens.fonts);
    unique(result.stylePreset.visualTokens.notes);
  }
  if (result.avatar) unique(result.avatar.imageAssetIds);
  return result;
}

export function parseManualVisualSelectionV2(value: unknown): ManualVisualSelectionV2 {
  if (!Value.Check(ManualVisualSelectionV2Schema, value)) invalid();
  return structuredClone(value as ManualVisualSelectionV2);
}

export function parseManualVisualSelection(value: unknown): ManualVisualSelection {
  if (!Value.Check(ManualVisualSelectionSchema, value)) invalid();
  return structuredClone(value as ManualVisualSelection);
}

export function parseFrozenManualVisualSelectionV2(value: unknown): FrozenManualVisualSelectionV2 {
  if (!Value.Check(FrozenManualVisualSelectionV2Schema, value)) invalid();
  const result = structuredClone(value as FrozenManualVisualSelectionV2);
  if (result.product) {
    unique(result.product.images.map(({ assetId }) => assetId));
    unique(result.product.images.map(({ position }) => String(position)));
    if (result.product.images.some(({ position }, index) => position !== index + 1)
      || (result.product.images.length > 0
        && result.product.images.filter(({ role }) => role === "hero").length !== 1)) invalid();
  }
  if (result.preset) {
    parseDesignStyleAnalysisV1(result.preset.designStyle.analysis);
    unique(result.preset.designStyle.referenceItemIds);
    if (result.preset.avatar) unique(result.preset.avatar.imageAssetIds);
  }
  return result;
}

export function parseFrozenManualVisualSelection(value: unknown): FrozenManualVisualSelection {
  if (!value || typeof value !== "object") invalid();
  const version = (value as { contractVersion?: unknown }).contractVersion;
  if (version === "manual-visual-selection-frozen.v1") return parseFrozenManualVisualSelectionV1(value);
  if (version === "manual-visual-selection-frozen.v2") return parseFrozenManualVisualSelectionV2(value);
  invalid();
}
