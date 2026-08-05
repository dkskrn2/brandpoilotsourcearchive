import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  CONTENT_GENERATION_INPUT_VERSION,
  ContentPurposeSchema,
  ContentStudioOutputFormatSchema,
  IMAGE_GENERATION_PACKAGE_VERSION,
} from "./catalog.js";
import {
  ContentProposalV2Properties,
  ProposalSubjectV2Schema,
} from "./proposal.js";
import {
  ApprovedBrandCoreSnapshotV2Schema,
  ApprovedProductSnapshotV2Schema,
  ContentAspectRatioSchema,
  ContentChannelTargetSchema,
  FinalAttachmentSnapshotV1Schema,
  FrozenReferenceSnapshotV2Schema,
  FrozenStyleImageSnapshotV1Schema,
  ResearchEvidenceSnapshotV1Schema,
  UtcTimestampSchema,
  UuidSchema,
} from "./snapshots.js";

export const ContentGenerationOutputSettingsV3Schema = Type.Object({
  outputFormat: ContentStudioOutputFormatSchema,
  channelTargets: Type.Array(ContentChannelTargetSchema, { minItems: 1, maxItems: 1 }),
  aspectRatio: Type.Union([ContentAspectRatioSchema, Type.Null()]),
  outputCount: Type.Literal(1),
  purpose: ContentPurposeSchema,
}, { additionalProperties: false });
export type ContentGenerationOutputSettingsV3 = Static<typeof ContentGenerationOutputSettingsV3Schema>;

export const ContentGenerationReferencesV3Schema = Type.Object({
  selected: Type.Array(FrozenReferenceSnapshotV2Schema, { maxItems: 5 }),
  brandStyleImages: Type.Array(FrozenStyleImageSnapshotV1Schema, { maxItems: 5 }),
  avatarStyleImageId: Type.Union([UuidSchema, Type.Null()]),
  attachments: Type.Array(FinalAttachmentSnapshotV1Schema, { maxItems: 20 }),
}, { additionalProperties: false });
export type ContentGenerationReferencesV3 = Static<typeof ContentGenerationReferencesV3Schema>;

export const SelectedContentProposalV3Schema = Type.Object({
  id: UuidSchema,
  ...ContentProposalV2Properties,
}, { additionalProperties: false });
export type SelectedContentProposalV3 = Static<typeof SelectedContentProposalV3Schema>;

export const ContentGenerationInputV3Schema = Type.Object({
  contractVersion: Type.Literal(CONTENT_GENERATION_INPUT_VERSION),
  generationId: UuidSchema,
  brandCore: ApprovedBrandCoreSnapshotV2Schema,
  subject: ProposalSubjectV2Schema,
  contentInstruction: Type.Union([Type.String({ minLength: 1, maxLength: 4_000 }), Type.Null()]),
  product: Type.Union([ApprovedProductSnapshotV2Schema, Type.Null()]),
  researchEvidence: ResearchEvidenceSnapshotV1Schema,
  references: ContentGenerationReferencesV3Schema,
  selectedProposal: SelectedContentProposalV3Schema,
  userImageInstruction: Type.Union([Type.String({ minLength: 1, maxLength: 4_000 }), Type.Null()]),
  outputSettings: ContentGenerationOutputSettingsV3Schema,
  capturedAt: UtcTimestampSchema,
}, { additionalProperties: false });
export type ContentGenerationInputV3 = Static<typeof ContentGenerationInputV3Schema>;

export const ImageGenerationAssetV1Schema = Type.Object({
  index: Type.Integer({ minimum: 1, maximum: 5 }),
  role: Type.String({ minLength: 1, maxLength: 200 }),
  copy: Type.String({ minLength: 1, maxLength: 4_000 }),
  visualDirection: Type.String({ minLength: 1, maxLength: 4_000 }),
  evidenceIds: Type.Array(UuidSchema, { maxItems: 8 }),
  productImageAssetIds: Type.Array(UuidSchema, { maxItems: 20 }),
  attachmentIds: Type.Array(UuidSchema, { maxItems: 20 }),
}, { additionalProperties: false });
export type ImageGenerationAssetV1 = Static<typeof ImageGenerationAssetV1Schema>;

export const ImageGenerationLogoPolicyV1Schema = Type.Object({
  allowGeneratedLogo: Type.Literal(false),
  allowReservedLogoArea: Type.Literal(false),
  allowExternalReferenceLogo: Type.Literal(false),
  allowExistingProductPackagingLogo: Type.Literal(true),
}, { additionalProperties: false });
export type ImageGenerationLogoPolicyV1 = Static<typeof ImageGenerationLogoPolicyV1Schema>;

export const ImageGenerationPackageV1Schema = Type.Object({
  contractVersion: Type.Literal(IMAGE_GENERATION_PACKAGE_VERSION),
  generationId: UuidSchema,
  outputFormat: ContentStudioOutputFormatSchema,
  purpose: ContentPurposeSchema,
  assetCount: Type.Integer({ minimum: 1, maximum: 5 }),
  aspectRatio: ContentAspectRatioSchema,
  channelTargets: Type.Array(ContentChannelTargetSchema, { minItems: 1, maxItems: 1 }),
  assets: Type.Array(ImageGenerationAssetV1Schema, { minItems: 1, maxItems: 5 }),
  product: Type.Union([ApprovedProductSnapshotV2Schema, Type.Null()]),
  references: Type.Array(FrozenReferenceSnapshotV2Schema, { maxItems: 5 }),
  brandStyleImages: Type.Array(FrozenStyleImageSnapshotV1Schema, { maxItems: 5 }),
  avatarStyleImageId: Type.Union([UuidSchema, Type.Null()]),
  attachments: Type.Array(FinalAttachmentSnapshotV1Schema, { maxItems: 20 }),
  userImageInstruction: Type.Union([Type.String({ minLength: 1, maxLength: 4_000 }), Type.Null()]),
  logoPolicy: ImageGenerationLogoPolicyV1Schema,
}, { additionalProperties: false });
export type ImageGenerationPackageV1 = Static<typeof ImageGenerationPackageV1Schema>;

function parse<S extends TSchema>(schema: S, value: unknown, code: string): Static<S> {
  if (!Value.Check(schema, value)) throw new Error(code);
  return value as Static<S>;
}

export function parseContentGenerationInputV3(value: unknown): ContentGenerationInputV3 {
  return parse(ContentGenerationInputV3Schema, value, "content_generation_input_v3_invalid");
}

export function parseImageGenerationPackageV1(value: unknown): ImageGenerationPackageV1 {
  return parse(ImageGenerationPackageV1Schema, value, "image_generation_package_v1_invalid");
}
