import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  AI_CONTENT_MANIFEST_VERSION,
  CONTENT_GENERATION_INPUT_VERSION,
  CONTENT_IMAGE_PROMPT_VERSIONS,
  CONTENT_PLANNER_MODEL_ID,
  CONTENT_PROMPT_BINDING_VERSION,
  CONTENT_PROMPT_DEFINITION_VERSIONS,
  CONTENT_PROPOSAL_CONTRACT_VERSIONS,
  CONTENT_PROPOSAL_PROMPT_VERSION,
  ContentPurposeSchema,
  ContentStudioOutputFormatSchema,
  IMAGE_GENERATION_PACKAGE_VERSION,
} from "./catalog.js";
import { PlanContractVersionSchema } from "./plans.js";
import { Sha256Schema } from "./snapshots.js";

export const PlannerPromptVersionSchema = Type.Union(
  Object.values(CONTENT_PROMPT_DEFINITION_VERSIONS)
    .flatMap((versions) => Object.values(versions))
    .map((value) => Type.Literal(value)),
);
export const ImagePromptVersionSchema = Type.Union(
  Object.values(CONTENT_IMAGE_PROMPT_VERSIONS)
    .flatMap((versions) => Object.values(versions))
    .map((value) => Type.Literal(value)),
);

export const ContentPromptBindingSchema = Type.Object({
  contractVersion: Type.Literal(CONTENT_PROMPT_BINDING_VERSION),
  outputFormat: ContentStudioOutputFormatSchema,
  purpose: ContentPurposeSchema,
  proposalRequestVersion: Type.Literal(CONTENT_PROPOSAL_CONTRACT_VERSIONS.request),
  proposalBaseInputVersion: Type.Literal(CONTENT_PROPOSAL_CONTRACT_VERSIONS.baseInput),
  proposalComposedInputVersion: Type.Literal(CONTENT_PROPOSAL_CONTRACT_VERSIONS.composedInput),
  proposalOutputVersion: Type.Literal(CONTENT_PROPOSAL_CONTRACT_VERSIONS.output),
  proposalPromptVersion: Type.Literal(CONTENT_PROPOSAL_PROMPT_VERSION),
  proposalSchemaSha256: Sha256Schema,
  generationInputVersion: Type.Literal(CONTENT_GENERATION_INPUT_VERSION),
  generationSchemaSha256: Sha256Schema,
  planContractVersion: PlanContractVersionSchema,
  planSchemaSha256: Sha256Schema,
  plannerPromptVersion: PlannerPromptVersionSchema,
  imagePackageVersion: Type.Literal(IMAGE_GENERATION_PACKAGE_VERSION),
  imagePromptVersion: ImagePromptVersionSchema,
  manifestVersion: Type.Literal(AI_CONTENT_MANIFEST_VERSION),
  contractSourceHash: Sha256Schema,
  model: Type.Literal(CONTENT_PLANNER_MODEL_ID),
}, { additionalProperties: false });
export type ContentPromptBinding = Static<typeof ContentPromptBindingSchema>;

export function parseContentPromptBinding(value: unknown): ContentPromptBinding {
  if (!Value.Check(ContentPromptBindingSchema, value)) {
    throw new Error("content_prompt_binding_invalid");
  }
  return value as ContentPromptBinding;
}
