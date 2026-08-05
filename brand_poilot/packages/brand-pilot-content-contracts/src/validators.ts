import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  AI_CONTENT_MANIFEST_VERSION,
  CONTENT_FORMAT_CATALOG,
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
  type ContentStudioOutputFormat,
} from "./catalog.js";
import { ContentPromptBindingSchema, type ContentPromptBinding } from "./binding.js";
import {
  type ContentGenerationInputV3,
  type ImageGenerationPackageV1,
} from "./generation.js";
import type { AiContentManifestV3 } from "./manifest.js";
import type { ContentPlanResultV2 } from "./plans.js";
import { UuidSchema } from "./snapshots.js";

const AuthorityScopeSchema = Type.Object({
  workspaceId: UuidSchema,
  brandId: UuidSchema,
}, { additionalProperties: false });

export const ContentPipelineAuthorityContextSchema = Type.Object({
  scope: AuthorityScopeSchema,
  selection: Type.Object({
    workspaceId: UuidSchema,
    brandId: UuidSchema,
    proposalBatchId: UuidSchema,
    proposalId: UuidSchema,
    outputFormat: ContentStudioOutputFormatSchema,
    purpose: ContentPurposeSchema,
  }, { additionalProperties: false }),
  evidence: Type.Array(Type.Object({
    workspaceId: UuidSchema,
    brandId: UuidSchema,
    proposalBatchId: UuidSchema,
    evidenceId: UuidSchema,
  }, { additionalProperties: false })),
  references: Type.Array(Type.Object({
    workspaceId: UuidSchema,
    brandId: UuidSchema,
    proposalBatchId: UuidSchema,
    referenceItemId: UuidSchema,
    snapshotId: UuidSchema,
  }, { additionalProperties: false })),
}, { additionalProperties: false });
export type ContentPipelineAuthorityContext = Static<typeof ContentPipelineAuthorityContextSchema>;

export const RenderedAssetInventorySchema = Type.Object({
  generationId: UuidSchema,
  outputFormat: ContentStudioOutputFormatSchema,
  purpose: ContentPurposeSchema,
  assets: Type.Array(Type.Object({
    role: Type.Union([
      Type.Literal("slide"),
      Type.Literal("inline"),
      Type.Literal("scene"),
      Type.Literal("html"),
      Type.Literal("video"),
    ]),
    index: Type.Integer({ minimum: 1 }),
  }, { additionalProperties: false }), { minItems: 1 }),
}, { additionalProperties: false });
export type RenderedAssetInventory = Static<typeof RenderedAssetInventorySchema>;

function fail(code: string): never {
  throw new Error(code);
}

function same(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => same(value, right[index]));
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && same(leftRecord[key], rightRecord[key]));
}

function assertFormatSettings(input: ContentGenerationInputV3): void {
  const settings = input.outputSettings;
  if (settings.outputCount !== 1) fail("input_output_count_mismatch");
  if (settings.outputFormat === "blog") {
    if (!same(settings.channelTargets, ["blog_export"])) fail("input_channel_mismatch");
    if (settings.aspectRatio !== null) fail("input_aspect_ratio_mismatch");
    return;
  }
  if (!same(settings.channelTargets, ["instagram"])) fail("input_channel_mismatch");
  const expectedAspect = settings.outputFormat === "reel" ? "9:16" : "1:1";
  if (settings.aspectRatio !== expectedAspect) fail("input_aspect_ratio_mismatch");
}

export function assertPurposeProductInvariant(input: ContentGenerationInputV3): void {
  const purpose = input.outputSettings.purpose;
  if (purpose === "informational") {
    if (input.product !== null) fail("informational_product_must_be_null");
    if (input.researchEvidence.items.length === 0) fail("informational_evidence_required");
    if (input.selectedProposal.purposeDetails.kind !== "informational") fail("proposal_purpose_details_mismatch");
    return;
  }
  if (input.product === null) fail("marketing_product_required");
  if (input.selectedProposal.purposeDetails.kind !== "marketing") fail("proposal_purpose_details_mismatch");
  if (input.selectedProposal.purposeDetails.productId !== input.product.id) fail("marketing_product_snapshot_mismatch");
}

export function assertEvidenceOwnership(
  input: ContentGenerationInputV3,
  authority: ContentPipelineAuthorityContext,
): void {
  const { scope, selection } = authority;
  if (selection.workspaceId !== scope.workspaceId) fail("authority_selection_workspace_mismatch");
  if (selection.brandId !== scope.brandId) fail("authority_selection_brand_mismatch");
  for (const row of authority.evidence) {
    if (row.workspaceId !== scope.workspaceId) fail("authority_evidence_scope_mismatch");
    if (row.brandId !== scope.brandId) fail("authority_evidence_scope_mismatch");
    if (row.proposalBatchId !== selection.proposalBatchId) fail("authority_evidence_batch_mismatch");
  }
  for (const row of authority.references) {
    if (row.workspaceId !== scope.workspaceId) fail("authority_reference_scope_mismatch");
    if (row.brandId !== scope.brandId) fail("authority_reference_scope_mismatch");
    if (row.proposalBatchId !== selection.proposalBatchId) fail("authority_reference_batch_mismatch");
  }

  const authorizedEvidence = new Set(authority.evidence.map((row) => row.evidenceId));
  for (const item of input.researchEvidence.items) {
    if (!authorizedEvidence.has(item.id)) fail("input_evidence_not_authorized");
  }
  const frozenEvidence = new Set(input.researchEvidence.items.map((item) => item.id));
  for (const evidenceId of input.selectedProposal.evidenceIds) {
    if (!frozenEvidence.has(evidenceId)) fail("proposal_evidence_not_frozen");
  }

  const authorizedReferences = new Set(
    authority.references.map((row) => `${row.referenceItemId}:${row.snapshotId}`),
  );
  for (const reference of input.references.selected) {
    if (!authorizedReferences.has(`${reference.referenceItemId}:${reference.snapshotId}`)) {
      fail("input_reference_not_authorized");
    }
  }
  const frozenReferenceIds = new Set(input.references.selected.map((item) => item.referenceItemId));
  for (const referenceId of input.selectedProposal.referenceIds) {
    if (!frozenReferenceIds.has(referenceId)) fail("proposal_reference_not_frozen");
  }
}

export function assertSelectedProposalInvariant(
  input: ContentGenerationInputV3,
  authority: ContentPipelineAuthorityContext,
): void {
  if (input.selectedProposal.id !== authority.selection.proposalId) fail("selected_proposal_id_mismatch");
  if (input.selectedProposal.outputFormat !== authority.selection.outputFormat
    || input.outputSettings.outputFormat !== authority.selection.outputFormat) {
    fail("selected_proposal_format_mismatch");
  }
  if (input.outputSettings.purpose !== authority.selection.purpose
    || input.selectedProposal.purposeDetails.kind !== authority.selection.purpose) {
    fail("selected_proposal_purpose_mismatch");
  }
}

export function assertPlannerPromptBinding(
  input: ContentGenerationInputV3,
  binding: ContentPromptBinding,
): void {
  const format = input.outputSettings.outputFormat;
  const purpose = input.outputSettings.purpose;
  const catalog = CONTENT_FORMAT_CATALOG[format];
  if (binding.outputFormat !== format) fail("binding_output_format_mismatch");
  if (binding.purpose !== purpose) fail("binding_purpose_mismatch");
  if (binding.contractVersion !== CONTENT_PROMPT_BINDING_VERSION) fail("binding_contract_version_mismatch");
  if (binding.proposalRequestVersion !== CONTENT_PROPOSAL_CONTRACT_VERSIONS.request
    || binding.proposalBaseInputVersion !== CONTENT_PROPOSAL_CONTRACT_VERSIONS.baseInput
    || binding.proposalComposedInputVersion !== CONTENT_PROPOSAL_CONTRACT_VERSIONS.composedInput
    || binding.proposalOutputVersion !== CONTENT_PROPOSAL_CONTRACT_VERSIONS.output
    || binding.proposalPromptVersion !== CONTENT_PROPOSAL_PROMPT_VERSION) fail("binding_proposal_version_mismatch");
  if (binding.generationInputVersion !== CONTENT_GENERATION_INPUT_VERSION) fail("binding_generation_version_mismatch");
  if (binding.planContractVersion !== catalog.planContractVersion) fail("binding_plan_version_mismatch");
  if (binding.plannerPromptVersion !== CONTENT_PROMPT_DEFINITION_VERSIONS[format][purpose]) fail("binding_planner_prompt_mismatch");
  if (binding.imagePackageVersion !== IMAGE_GENERATION_PACKAGE_VERSION) fail("binding_image_package_version_mismatch");
  if (binding.imagePromptVersion !== CONTENT_IMAGE_PROMPT_VERSIONS[format][purpose]) fail("binding_image_prompt_mismatch");
  if (binding.manifestVersion !== AI_CONTENT_MANIFEST_VERSION) fail("binding_manifest_version_mismatch");
  if (binding.model !== CONTENT_PLANNER_MODEL_ID) fail("binding_model_mismatch");
  if (!Value.Check(ContentPromptBindingSchema, binding)) fail("content_prompt_binding_invalid");
}

function planImagePackage(plan: ContentPlanResultV2): ImageGenerationPackageV1 | null {
  return plan.imagePackage;
}

export function assertPlanMatchesInput(
  input: ContentGenerationInputV3,
  binding: ContentPromptBinding,
  plan: ContentPlanResultV2,
  imagePackage: ImageGenerationPackageV1 | null,
): void {
  assertFormatSettings(input);
  const format = input.outputSettings.outputFormat;
  if (plan.contractVersion !== CONTENT_FORMAT_CATALOG[format].planContractVersion) fail("plan_contract_version_mismatch");
  if (format === "reel" && (!("outputFormat" in plan) || plan.outputFormat !== "reel")) fail("plan_output_format_mismatch");
  if (binding.planContractVersion !== plan.contractVersion) fail("plan_binding_version_mismatch");
  if (!same(planImagePackage(plan), imagePackage)) fail("plan_image_package_mismatch");
  if (imagePackage === null) {
    if (format !== "blog") fail("image_package_required");
    return;
  }
  if (imagePackage.contractVersion !== binding.imagePackageVersion) fail("image_package_version_mismatch");
  if (imagePackage.generationId !== input.generationId) fail("image_generation_id_mismatch");
  if (imagePackage.outputFormat !== format) fail("image_output_format_mismatch");
  if (imagePackage.purpose !== input.outputSettings.purpose) fail("image_purpose_mismatch");
  if (!same(imagePackage.channelTargets, input.outputSettings.channelTargets)) fail("image_channel_mismatch");
  if (input.outputSettings.aspectRatio !== null
    && imagePackage.aspectRatio !== input.outputSettings.aspectRatio) fail("image_aspect_ratio_mismatch");
  if (!same(imagePackage.product, input.product)) fail("image_product_mismatch");
  if (!same(imagePackage.references, input.references.selected)) fail("image_references_mismatch");
  if (!same(imagePackage.brandStyleImages, input.references.brandStyleImages)) fail("image_style_images_mismatch");
  if (imagePackage.avatarStyleImageId !== input.references.avatarStyleImageId) fail("image_avatar_mismatch");
  if (!same(imagePackage.attachments, input.references.attachments)) fail("image_attachments_mismatch");
  if (imagePackage.userImageInstruction !== input.userImageInstruction) fail("image_instruction_mismatch");
}

type AssetIdentity = { role: RenderedAssetInventory["assets"][number]["role"]; index: number };

function expectedAssetInventory(
  format: ContentStudioOutputFormat,
  imageCount: number,
): AssetIdentity[] {
  const imageRole: AssetIdentity["role"] = format === "card_news" ? "slide" : format === "blog" ? "inline" : "scene";
  const images: AssetIdentity[] = Array.from(
    { length: imageCount },
    (_, index) => ({ role: imageRole, index: index + 1 }),
  );
  if (format === "blog") return [{ role: "html", index: 1 }, ...images];
  if (format === "reel") return [...images, { role: "video", index: 1 }];
  return images;
}

function normalizedAssets(assets: readonly AssetIdentity[]): string[] {
  return assets.map((asset) => `${asset.role}:${asset.index}`).sort();
}

export function assertAssetCountInvariant(
  input: ContentGenerationInputV3,
  plan: ContentPlanResultV2,
  imagePackage: ImageGenerationPackageV1 | null,
  rendered: RenderedAssetInventory,
  manifest: AiContentManifestV3,
): void {
  const planPackage = planImagePackage(plan);
  if (!same(planPackage, imagePackage)) fail("plan_image_package_mismatch");
  const imageCount = planPackage?.assetCount ?? 0;
  if (planPackage !== null) {
    if (planPackage.assets.length !== imageCount) fail("image_asset_count_mismatch");
    const plannedIndices = planPackage.assets.map((asset) => asset.index).sort((left, right) => left - right);
    if (!same(plannedIndices, Array.from({ length: imageCount }, (_, index) => index + 1))) {
      fail("image_asset_index_mismatch");
    }
  }
  if ((input.selectedProposal.assetCount ?? 0) !== imageCount) fail("proposal_asset_count_mismatch");

  if (rendered.generationId !== input.generationId) fail("rendered_generation_id_mismatch");
  if (rendered.outputFormat !== input.outputSettings.outputFormat) fail("rendered_output_format_mismatch");
  if (rendered.purpose !== input.outputSettings.purpose) fail("rendered_purpose_mismatch");
  const expected = expectedAssetInventory(input.outputSettings.outputFormat, imageCount);
  if (!same(normalizedAssets(rendered.assets), normalizedAssets(expected))) fail("rendered_asset_inventory_mismatch");
  const manifestAssets = manifest.assets.map(({ role, index }) => ({ role, index }));
  if (!same(normalizedAssets(manifestAssets), normalizedAssets(expected))) fail("manifest_asset_inventory_mismatch");
}

export function assertManifestMatchesInput(
  input: ContentGenerationInputV3,
  binding: ContentPromptBinding,
  manifest: AiContentManifestV3,
): void {
  if (manifest.version !== binding.manifestVersion) fail("manifest_version_mismatch");
  if (manifest.outputFormat !== input.outputSettings.outputFormat) fail("manifest_output_format_mismatch");
  if (manifest.purpose !== input.outputSettings.purpose) fail("manifest_purpose_mismatch");
  const isBlogContent = "html" in manifest.content;
  if ((input.outputSettings.outputFormat === "blog") !== isBlogContent) fail("manifest_content_kind_mismatch");
}

export function assertContentPipelineBindings(
  input: ContentGenerationInputV3,
  authority: ContentPipelineAuthorityContext,
  binding: ContentPromptBinding,
  plan: ContentPlanResultV2,
  imagePackage: ImageGenerationPackageV1 | null,
  rendered: RenderedAssetInventory,
  manifest: AiContentManifestV3,
): void {
  assertPurposeProductInvariant(input);
  assertEvidenceOwnership(input, authority);
  assertSelectedProposalInvariant(input, authority);
  assertPlannerPromptBinding(input, binding);
  assertPlanMatchesInput(input, binding, plan, imagePackage);
  assertManifestMatchesInput(input, binding, manifest);
  assertAssetCountInvariant(input, plan, imagePackage, rendered, manifest);
}
