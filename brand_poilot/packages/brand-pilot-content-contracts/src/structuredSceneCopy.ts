import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { UuidSchema } from "./snapshots.js";

export const STRUCTURED_SCENE_COPY_VERSION = "structured-scene-copy.v1" as const;

export const StructuredKeyVisualTypeV1Schema = Type.Union([
  Type.Literal("none"),
  Type.Literal("number"),
  Type.Literal("before_after"),
  Type.Literal("comparison"),
  Type.Literal("steps"),
  Type.Literal("quote"),
]);

export const StructuredKeyVisualEntryRoleV1Schema = Type.Union([
  Type.Literal("value"),
  Type.Literal("before"),
  Type.Literal("after"),
  Type.Literal("left"),
  Type.Literal("right"),
  Type.Literal("step"),
  Type.Literal("quote"),
  Type.Literal("attribution"),
]);

export const StructuredKeyVisualEntryV1Schema = Type.Object({
  role: StructuredKeyVisualEntryRoleV1Schema,
  label: Type.Union([Type.Null(), Type.String({ minLength: 1, maxLength: 100 })]),
  value: Type.String({ minLength: 1, maxLength: 300 }),
}, { additionalProperties: false });

export const StructuredKeyVisualV1Schema = Type.Object({
  type: StructuredKeyVisualTypeV1Schema,
  entries: Type.Array(StructuredKeyVisualEntryV1Schema, { maxItems: 4 }),
}, { additionalProperties: false });

export const StructuredSceneCopyV1Schema = Type.Object({
  index: Type.Integer({ minimum: 1, maximum: 5 }),
  role: Type.String({ minLength: 1, maxLength: 200 }),
  coreMessage: Type.String({ minLength: 1, maxLength: 500 }),
  headline: Type.String({ minLength: 1, maxLength: 300 }),
  keyVisual: StructuredKeyVisualV1Schema,
  supportingTexts: Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { maxItems: 2 }),
  footnote: Type.Union([Type.Null(), Type.String({ minLength: 1, maxLength: 300 })]),
  visualDirection: Type.String({ minLength: 1, maxLength: 3_500 }),
  evidenceIds: Type.Array(UuidSchema, { maxItems: 8 }),
  productImageAssetIds: Type.Array(UuidSchema, { maxItems: 20 }),
}, { additionalProperties: false });

export type StructuredSceneCopyV1 = Static<typeof StructuredSceneCopyV1Schema>;

export type CompiledStructuredSceneV1 = {
  index: number;
  role: string;
  copy: string;
  visualDirection: string;
  evidenceIds: string[];
  productImageAssetIds: string[];
};

function invalid(): never {
  throw new Error("structured_scene_copy_v1_invalid");
}

function relationInvalid(): never {
  throw new Error("structured_scene_relation_invalid");
}

function trimmed(value: string): string {
  const normalized = value.trim();
  if (!normalized) invalid();
  return normalized;
}

function validateRelations(keyVisual: StructuredSceneCopyV1["keyVisual"]): void {
  const roles = keyVisual.entries.map(({ role }) => role);
  switch (keyVisual.type) {
    case "none":
      if (roles.length !== 0) relationInvalid();
      return;
    case "number":
      if (roles.length < 1 || roles.length > 4 || roles.some((role) => role !== "value")) relationInvalid();
      return;
    case "before_after":
      if (roles.length !== 2 || roles[0] !== "before" || roles[1] !== "after") relationInvalid();
      return;
    case "comparison":
      if (roles.length !== 2 || roles[0] !== "left" || roles[1] !== "right"
        || keyVisual.entries.some(({ label }) => label === null)) relationInvalid();
      return;
    case "steps":
      if (roles.length < 2 || roles.length > 4 || roles.some((role) => role !== "step")) relationInvalid();
      return;
    case "quote":
      if ((roles.length !== 1 && roles.length !== 2) || roles[0] !== "quote"
        || (roles.length === 2 && roles[1] !== "attribution")) relationInvalid();
      return;
  }
}

export function parseStructuredSceneCopyV1(value: unknown): StructuredSceneCopyV1 {
  if (!Value.Check(StructuredSceneCopyV1Schema, value)) invalid();
  const source = value as StructuredSceneCopyV1;
  const normalized: StructuredSceneCopyV1 = {
    index: source.index,
    role: trimmed(source.role),
    coreMessage: trimmed(source.coreMessage),
    headline: trimmed(source.headline),
    keyVisual: {
      type: source.keyVisual.type,
      entries: source.keyVisual.entries.map((entry) => ({
        role: entry.role,
        label: entry.label === null ? null : trimmed(entry.label),
        value: trimmed(entry.value),
      })),
    },
    supportingTexts: source.supportingTexts.map(trimmed),
    footnote: source.footnote === null ? null : trimmed(source.footnote),
    visualDirection: trimmed(source.visualDirection),
    evidenceIds: [...source.evidenceIds],
    productImageAssetIds: [...source.productImageAssetIds],
  };
  validateRelations(normalized.keyVisual);
  if (flattenStructuredScene(normalized).length > 4_000) invalid();
  return normalized;
}

export function flattenStructuredScene(scene: StructuredSceneCopyV1): string {
  return [
    scene.headline,
    ...scene.keyVisual.entries.flatMap(({ label, value }) => label === null ? [value] : [label, value]),
    ...scene.supportingTexts,
    ...(scene.footnote === null ? [] : [scene.footnote]),
  ].join("\n");
}

export function buildLegacyVisualDirection(scene: StructuredSceneCopyV1): string {
  return scene.visualDirection;
}

export function compileStructuredScene(scene: StructuredSceneCopyV1): CompiledStructuredSceneV1 {
  return {
    index: scene.index,
    role: scene.role,
    copy: flattenStructuredScene(scene),
    visualDirection: buildLegacyVisualDirection(scene),
    evidenceIds: [...scene.evidenceIds],
    productImageAssetIds: [...scene.productImageAssetIds],
  };
}
