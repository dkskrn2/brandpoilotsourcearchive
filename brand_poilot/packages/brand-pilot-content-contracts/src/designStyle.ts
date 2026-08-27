import { Type, type Static, type TObject } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const ObservationSchema = Type.String({ minLength: 1, maxLength: 500 });
const ObservationListSchema = Type.Array(ObservationSchema, { maxItems: 20 });

function observationGroup<const T extends Record<string, typeof ObservationListSchema>>(properties: T): TObject<T> {
  return Type.Object(properties, { additionalProperties: false });
}

export const DesignStyleAnalysisV1Schema = Type.Object({
  contractVersion: Type.Literal("design-style-analysis.v1"),
  layout: observationGroup({
    composition: ObservationListSchema,
    hierarchy: ObservationListSchema,
    spacing: ObservationListSchema,
    alignment: ObservationListSchema,
    recurringModules: ObservationListSchema,
  }),
  typography: observationGroup({
    families: ObservationListSchema,
    weightHierarchy: ObservationListSchema,
    scale: ObservationListSchema,
    placement: ObservationListSchema,
  }),
  color: observationGroup({
    palette: ObservationListSchema,
    contrast: ObservationListSchema,
    background: ObservationListSchema,
    accentUsage: ObservationListSchema,
  }),
  graphics: observationGroup({
    media: ObservationListSchema,
    shapes: ObservationListSchema,
    icons: ObservationListSchema,
    texture: ObservationListSchema,
  }),
  visualCues: observationGroup({
    comparison: ObservationListSchema,
    humor: ObservationListSchema,
    practicality: ObservationListSchema,
    empathy: ObservationListSchema,
  }),
  promptGuidance: observationGroup({
    use: ObservationListSchema,
    avoid: ObservationListSchema,
  }),
}, { additionalProperties: false });

export type DesignStyleAnalysisV1 = Static<typeof DesignStyleAnalysisV1Schema>;

function invalid(): never {
  throw new Error("design_style_analysis_v1_invalid");
}

function validateObservations(value: unknown): void {
  if (Array.isArray(value)) {
    if (value.some((item) => typeof item !== "string" || item !== item.trim())) invalid();
    if (new Set(value).size !== value.length) invalid();
    return;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) validateObservations(child);
  }
}

export function parseDesignStyleAnalysisV1(value: unknown): DesignStyleAnalysisV1 {
  if (!Value.Check(DesignStyleAnalysisV1Schema, value)) invalid();
  validateObservations(value);
  return structuredClone(value as DesignStyleAnalysisV1);
}
