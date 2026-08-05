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
import { LowercaseSha256Schema, NonEmptyStringSchema, UuidSchema } from "./snapshots.js";

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

const RenderedAssetStorageProperties = {
  storagePath: Type.String({
    minLength: 1,
    pattern: "^[^/\\\\]+(?:/[^/\\\\]+)*$",
  }),
  checksum: LowercaseSha256Schema,
} as const;

const RenderedAssetPublicProperties = {
  index: Type.Integer({ minimum: 1 }),
  url: Type.String({ minLength: 1, pattern: "^https://" }),
  fileName: NonEmptyStringSchema,
} as const;

export const RenderedImageAssetSchema = Type.Object({
  role: Type.Union([Type.Literal("slide"), Type.Literal("inline"), Type.Literal("scene")]),
  ...RenderedAssetPublicProperties,
  mimeType: Type.Literal("image/png"),
  width: Type.Integer({ minimum: 1 }),
  height: Type.Integer({ minimum: 1 }),
  ...RenderedAssetStorageProperties,
}, { additionalProperties: false });

export const RenderedHtmlAssetSchema = Type.Object({
  role: Type.Literal("html"),
  ...RenderedAssetPublicProperties,
  mimeType: Type.Literal("text/html"),
  ...RenderedAssetStorageProperties,
}, { additionalProperties: false });

export const RenderedVideoAssetSchema = Type.Object({
  role: Type.Literal("video"),
  ...RenderedAssetPublicProperties,
  mimeType: Type.Literal("video/mp4"),
  width: Type.Integer({ minimum: 1 }),
  height: Type.Integer({ minimum: 1 }),
  durationSeconds: Type.Number({ exclusiveMinimum: 0 }),
  videoCodec: Type.Literal("h264"),
  fps: Type.Literal(30),
  audioCodec: Type.Null(),
  ...RenderedAssetStorageProperties,
}, { additionalProperties: false });

export const RenderedAssetSchema = Type.Union([
  RenderedImageAssetSchema,
  RenderedHtmlAssetSchema,
  RenderedVideoAssetSchema,
]);

export const RenderedAssetInventorySchema = Type.Object({
  generationId: UuidSchema,
  outputFormat: ContentStudioOutputFormatSchema,
  purpose: ContentPurposeSchema,
  assets: Type.Array(RenderedAssetSchema, { minItems: 1 }),
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

const ENCODED_PATH_SEPARATOR = /%(?:2f|5c)/i;
const DOT_PATH_SEGMENT = /(?:^|\/)(?:(?:\.|%2e){1,2})(?:\/|$)/i;

function hasForbiddenPathSyntax(path: string): boolean {
  return path.includes("\\") || ENCODED_PATH_SEPARATOR.test(path) || DOT_PATH_SEGMENT.test(path);
}

function rawHttpsPath(url: string): string {
  if (!url.startsWith("https://") || url.includes("?") || url.includes("#") || url.includes("\\")) {
    fail("rendered_asset_url_invalid");
  }
  const authorityStart = "https://".length;
  const pathStart = url.indexOf("/", authorityStart);
  if (pathStart < 0 || pathStart === authorityStart) fail("rendered_asset_url_invalid");
  const rawPath = url.slice(pathStart);
  if (hasForbiddenPathSyntax(rawPath)) fail("rendered_asset_url_invalid");
  return rawPath;
}

function assertCanonicalRenderedAssetPath(asset: RenderedAssetInventory["assets"][number]): void {
  if (asset.fileName !== asset.fileName.trim()
    || asset.fileName === "."
    || asset.fileName === ".."
    || asset.fileName.includes("/")
    || asset.fileName.includes("\\")
    || /[\u0000-\u001f\u007f-\u009f]/.test(asset.fileName)) {
    fail("rendered_file_name_invalid");
  }
  const segments = asset.storagePath.split("/");
  if (asset.storagePath.startsWith("/")
    || hasForbiddenPathSyntax(asset.storagePath)
    || segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    fail("rendered_storage_path_invalid");
  }
  const rawPath = rawHttpsPath(asset.url);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(asset.url);
  } catch {
    fail("rendered_asset_url_invalid");
  }
  if (parsedUrl.protocol !== "https:") fail("rendered_asset_url_invalid");
  if (parsedUrl.username !== "" || parsedUrl.password !== "" || parsedUrl.search !== "" || parsedUrl.hash !== "") {
    fail("rendered_asset_url_invalid");
  }
  if (rawPath !== `/${asset.storagePath}`) fail("rendered_url_path_mismatch");
  if (parsedUrl.pathname !== `/${asset.storagePath}`) fail("rendered_url_path_mismatch");
}

export function parseContentPipelineAuthorityContext(value: unknown): ContentPipelineAuthorityContext {
  if (!Value.Check(ContentPipelineAuthorityContextSchema, value)) {
    fail("content_pipeline_authority_context_invalid");
  }
  return value as ContentPipelineAuthorityContext;
}

export function parseRenderedAssetInventory(value: unknown): RenderedAssetInventory {
  if (!Value.Check(RenderedAssetInventorySchema, value)) {
    fail("rendered_asset_inventory_invalid");
  }
  const inventory = value as RenderedAssetInventory;
  for (const asset of inventory.assets) assertCanonicalRenderedAssetPath(asset);
  return inventory;
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
  const authorityEvidenceIds = new Set<string>();
  for (const row of authority.evidence) {
    if (row.workspaceId !== scope.workspaceId) fail("authority_evidence_scope_mismatch");
    if (row.brandId !== scope.brandId) fail("authority_evidence_scope_mismatch");
    if (row.proposalBatchId !== selection.proposalBatchId) fail("authority_evidence_batch_mismatch");
    if (authorityEvidenceIds.has(row.evidenceId)) fail("authority_evidence_duplicate");
    authorityEvidenceIds.add(row.evidenceId);
  }
  const authorityReferenceIdentities = new Set<string>();
  for (const row of authority.references) {
    if (row.workspaceId !== scope.workspaceId) fail("authority_reference_scope_mismatch");
    if (row.brandId !== scope.brandId) fail("authority_reference_scope_mismatch");
    if (row.proposalBatchId !== selection.proposalBatchId) fail("authority_reference_batch_mismatch");
    const identity = `${row.referenceItemId}:${row.snapshotId}`;
    if (authorityReferenceIdentities.has(identity)) fail("authority_reference_duplicate");
    authorityReferenceIdentities.add(identity);
  }

  const authorizedEvidence = new Set(authority.evidence.map((row) => row.evidenceId));
  const inputEvidenceIds = new Set<string>();
  for (const item of input.researchEvidence.items) {
    if (inputEvidenceIds.has(item.id)) fail("input_evidence_duplicate");
    inputEvidenceIds.add(item.id);
    if (!authorizedEvidence.has(item.id)) fail("input_evidence_not_authorized");
  }
  const frozenEvidence = new Set(input.researchEvidence.items.map((item) => item.id));
  const proposalEvidenceIds = new Set<string>();
  for (const evidenceId of input.selectedProposal.evidenceIds) {
    if (proposalEvidenceIds.has(evidenceId)) fail("proposal_evidence_duplicate");
    proposalEvidenceIds.add(evidenceId);
    if (!frozenEvidence.has(evidenceId)) fail("proposal_evidence_not_frozen");
  }

  const authorizedReferences = new Set(
    authority.references.map((row) => `${row.referenceItemId}:${row.snapshotId}`),
  );
  const selectedReferenceIdentities = new Set<string>();
  const selectedReferenceIds = new Set<string>();
  for (const reference of input.references.selected) {
    const identity = `${reference.referenceItemId}:${reference.snapshotId}`;
    if (selectedReferenceIdentities.has(identity) || selectedReferenceIds.has(reference.referenceItemId)) {
      fail("input_reference_duplicate");
    }
    selectedReferenceIdentities.add(identity);
    selectedReferenceIds.add(reference.referenceItemId);
    if (!authorizedReferences.has(identity)) {
      fail("input_reference_not_authorized");
    }
  }
  const frozenReferenceIds = new Set(input.references.selected.map((item) => item.referenceItemId));
  const proposalReferenceIds = new Set<string>();
  for (const referenceId of input.selectedProposal.referenceIds) {
    if (proposalReferenceIds.has(referenceId)) fail("proposal_reference_duplicate");
    proposalReferenceIds.add(referenceId);
    if (!frozenReferenceIds.has(referenceId)) fail("proposal_reference_not_frozen");
  }

  const styleImageIds = new Set<string>();
  for (const styleImage of input.references.brandStyleImages) {
    if (styleImageIds.has(styleImage.referenceItemId)) fail("brand_style_image_duplicate");
    styleImageIds.add(styleImage.referenceItemId);
  }
  if (input.references.avatarStyleImageId !== null
    && !styleImageIds.has(input.references.avatarStyleImageId)) fail("avatar_style_image_not_frozen");
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
  if (!same(input.selectedProposal.channelTargets, input.outputSettings.channelTargets)) {
    fail("selected_proposal_channel_mismatch");
  }
}

export function assertPlannerPromptBinding(
  input: ContentGenerationInputV3,
  binding: ContentPromptBinding,
): void {
  if (!Value.Check(ContentPromptBindingSchema, binding)) fail("content_prompt_binding_invalid");
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
}

function planImagePackage(plan: ContentPlanResultV2): ImageGenerationPackageV1 | null {
  return plan.imagePackage;
}

function assertDuplicateFreeSubset(
  values: readonly string[],
  allowedValues: ReadonlySet<string>,
  duplicateCode: string,
  unknownCode: string,
): void {
  if (new Set(values).size !== values.length) fail(duplicateCode);
  for (const value of values) {
    if (!allowedValues.has(value)) fail(unknownCode);
  }
}

function assertImagePackageAssetBindings(
  input: ContentGenerationInputV3,
  imagePackage: ImageGenerationPackageV1,
): void {
  const evidenceIds = new Set(input.researchEvidence.items.map((item) => item.id));
  const productImageAssetIds = new Set(input.product?.images.map((image) => image.assetId) ?? []);
  const attachmentIds = new Set(input.references.attachments.map((attachment) => attachment.id));
  for (const asset of imagePackage.assets) {
    assertDuplicateFreeSubset(
      asset.evidenceIds,
      evidenceIds,
      "image_asset_evidence_duplicate",
      "image_asset_evidence_not_frozen",
    );
    assertDuplicateFreeSubset(
      asset.productImageAssetIds,
      productImageAssetIds,
      "image_asset_product_image_duplicate",
      "image_asset_product_image_not_frozen",
    );
    assertDuplicateFreeSubset(
      asset.attachmentIds,
      attachmentIds,
      "image_asset_attachment_duplicate",
      "image_asset_attachment_not_frozen",
    );
  }

  if (input.outputSettings.outputFormat === "blog") {
    for (const asset of imagePackage.assets) {
      if (asset.role !== asset.role.trim()
        || asset.role.trim().length === 0
        || /[\u0000-\u001f\u007f-\u009f]/.test(asset.role)) fail("blog_image_asset_role_invalid");
    }
    return;
  }

  const expectedCount = imagePackage.assetCount;
  const outline = input.selectedProposal.outline;
  const outlineIndices = outline.map((item) => item.index).sort((left, right) => left - right);
  if (outline.length !== expectedCount
    || !same(outlineIndices, Array.from({ length: expectedCount }, (_, index) => index + 1))) {
    fail("proposal_outline_index_mismatch");
  }
  const outlineByIndex = new Map(outline.map((item) => [item.index, item]));
  for (const asset of imagePackage.assets) {
    if (outlineByIndex.get(asset.index)?.role !== asset.role) fail("image_asset_outline_mismatch");
  }
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
  assertImagePackageAssetBindings(input, imagePackage);
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
  authority: ContentPipelineAuthorityContext,
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
  const requiredStoragePrefix = `ai-content/${authority.scope.brandId}/${input.generationId}/`;
  const uniqueness = {
    identity: new Set<string>(),
    url: new Set<string>(),
    fileName: new Set<string>(),
    storagePath: new Set<string>(),
    checksum: new Set<string>(),
  };
  for (const asset of rendered.assets) {
    if (!asset.storagePath.startsWith(requiredStoragePrefix)) fail("rendered_storage_prefix_mismatch");
    const values = {
      identity: `${asset.role}:${asset.index}`,
      url: asset.url,
      fileName: asset.fileName,
      storagePath: asset.storagePath,
      checksum: asset.checksum,
    };
    for (const key of Object.keys(values) as Array<keyof typeof values>) {
      if (uniqueness[key].has(values[key])) fail("rendered_asset_duplicate");
      uniqueness[key].add(values[key]);
    }
  }
  const expected = expectedAssetInventory(input.outputSettings.outputFormat, imageCount);
  if (!same(normalizedAssets(rendered.assets), normalizedAssets(expected))) fail("rendered_asset_inventory_mismatch");
  const manifestAssets = manifest.assets.map(({ role, index }) => ({ role, index }));
  if (!same(normalizedAssets(manifestAssets), normalizedAssets(expected))) fail("manifest_asset_inventory_mismatch");
  const manifestByIdentity = new Map(manifest.assets.map((asset) => [`${asset.role}:${asset.index}`, asset]));
  for (const renderedAsset of rendered.assets) {
    const { storagePath: _storagePath, checksum: _checksum, ...publicAsset } = renderedAsset;
    const manifestAsset = manifestByIdentity.get(`${renderedAsset.role}:${renderedAsset.index}`);
    if (!same(publicAsset, manifestAsset)) fail("manifest_rendered_asset_mismatch");
  }
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
  const parsedAuthority = parseContentPipelineAuthorityContext(authority);
  const parsedRendered = parseRenderedAssetInventory(rendered);
  assertPurposeProductInvariant(input);
  assertEvidenceOwnership(input, parsedAuthority);
  assertSelectedProposalInvariant(input, parsedAuthority);
  assertPlannerPromptBinding(input, binding);
  assertPlanMatchesInput(input, binding, plan, imagePackage);
  assertManifestMatchesInput(input, binding, manifest);
  assertAssetCountInvariant(input, parsedAuthority, plan, imagePackage, parsedRendered, manifest);
}
