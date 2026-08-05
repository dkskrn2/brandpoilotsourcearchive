import { Type, type Static } from "@sinclair/typebox";
import { RESEARCH_EVIDENCE_VERSION } from "./catalog.js";

export const NonEmptyStringSchema = Type.String({ minLength: 1 });
export const UuidSchema = Type.String({
  pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
});
export const Sha256Schema = Type.String({ pattern: "^[0-9a-fA-F]{64}$" });
export const LowercaseSha256Schema = Type.String({ pattern: "^[0-9a-f]{64}$" });
export const UtcTimestampSchema = Type.String({
  pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z$",
});
export const HttpUrlSchema = Type.String({ minLength: 1, maxLength: 2_000, pattern: "^https?://" });

export const CONTENT_CHANNEL_TARGETS = [
  "instagram",
  "threads",
  "x",
  "linkedin",
  "youtube",
  "tiktok",
  "blog_export",
] as const;
export const CONTENT_REFERENCE_ROLES = ["planning", "copy_pattern", "visual_composition"] as const;
export const CONTENT_ASPECT_RATIOS = ["1:1", "4:5", "16:9", "9:16"] as const;
export const GENERATED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export const ContentChannelTargetSchema = Type.Union(
  CONTENT_CHANNEL_TARGETS.map((value) => Type.Literal(value)),
);
export const ContentReferenceRoleSchema = Type.Union(
  CONTENT_REFERENCE_ROLES.map((value) => Type.Literal(value)),
);
export const ContentAspectRatioSchema = Type.Union(
  CONTENT_ASPECT_RATIOS.map((value) => Type.Literal(value)),
);
export const GeneratedImageMimeTypeSchema = Type.Union(
  GENERATED_IMAGE_MIME_TYPES.map((value) => Type.Literal(value)),
);

export type ContentChannelTarget = Static<typeof ContentChannelTargetSchema>;
export type ContentReferenceRole = Static<typeof ContentReferenceRoleSchema>;
export type ContentAspectRatio = Static<typeof ContentAspectRatioSchema>;
export type GeneratedImageMimeType = Static<typeof GeneratedImageMimeTypeSchema>;

export const ApprovedBrandCoreSnapshotV2Schema = Type.Object({
  versionId: UuidSchema,
  companyOverview: Type.String({ minLength: 1, maxLength: 10_000 }),
  businessDescription: Type.String({ minLength: 1, maxLength: 10_000 }),
  primaryCategory: Type.String({ minLength: 1, maxLength: 500 }),
  detailedCategory: Type.String({ minLength: 1, maxLength: 500 }),
  primaryTarget: Type.String({ minLength: 1, maxLength: 2_000 }),
  differentiator: Type.String({ minLength: 1, maxLength: 4_000 }),
  coreAppeal: Type.String({ minLength: 1, maxLength: 4_000 }),
}, { additionalProperties: false });
export type ApprovedBrandCoreSnapshotV2 = Static<typeof ApprovedBrandCoreSnapshotV2Schema>;

export const OwnedImageSnapshotV2Schema = Type.Object({
  storageUrl: HttpUrlSchema,
  storagePath: Type.String({ minLength: 1, maxLength: 2_000 }),
  mimeType: Type.String({ minLength: 1, maxLength: 100, pattern: "^image/" }),
  checksum: Sha256Schema,
}, { additionalProperties: false });
export type OwnedImageSnapshotV2 = Static<typeof OwnedImageSnapshotV2Schema>;

export const ApprovedProductImageSnapshotV2Schema = Type.Object({
  assetId: UuidSchema,
  role: Type.Union([Type.Literal("hero"), Type.Literal("detail")]),
  storageUrl: HttpUrlSchema,
  storagePath: Type.String({ minLength: 1, maxLength: 2_000 }),
  mimeType: Type.String({ minLength: 1, maxLength: 100, pattern: "^image/" }),
  checksum: Sha256Schema,
}, { additionalProperties: false });
export type ApprovedProductImageSnapshotV2 = Static<typeof ApprovedProductImageSnapshotV2Schema>;

export const ApprovedProductSnapshotV2Schema = Type.Object({
  id: UuidSchema,
  versionId: UuidSchema,
  kind: Type.Union([Type.Literal("product"), Type.Literal("service")]),
  name: Type.String({ minLength: 1, maxLength: 500 }),
  description: Type.String({ minLength: 1, maxLength: 10_000 }),
  features: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), { maxItems: 50 }),
  benefits: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), { maxItems: 50 }),
  cautions: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), { maxItems: 50 }),
  evergreenPurchaseInfo: Type.String({ maxLength: 4_000 }),
  images: Type.Array(ApprovedProductImageSnapshotV2Schema, { maxItems: 20 }),
}, { additionalProperties: false });
export type ApprovedProductSnapshotV2 = Static<typeof ApprovedProductSnapshotV2Schema>;

export const FrozenOwnedImageSnapshotV2Schema = Type.Object({
  storageUrl: HttpUrlSchema,
  storagePath: Type.String({ minLength: 1, maxLength: 2_000 }),
  mimeType: GeneratedImageMimeTypeSchema,
  checksum: Sha256Schema,
}, { additionalProperties: false });
export type FrozenOwnedImageSnapshotV2 = Static<typeof FrozenOwnedImageSnapshotV2Schema>;

export const FrozenReferenceSnapshotV2Schema = Type.Object({
  referenceItemId: UuidSchema,
  snapshotId: UuidSchema,
  roles: Type.Array(ContentReferenceRoleSchema, { minItems: 1, maxItems: 3 }),
  title: Type.String({ minLength: 1, maxLength: 500 }),
  sourceUrl: HttpUrlSchema,
  capturedAt: UtcTimestampSchema,
  contentHash: Sha256Schema,
  text: Type.String({ minLength: 1, maxLength: 50_000 }),
  image: Type.Union([FrozenOwnedImageSnapshotV2Schema, Type.Null()]),
}, { additionalProperties: false });
export type FrozenReferenceSnapshotV2 = Static<typeof FrozenReferenceSnapshotV2Schema>;

export const ResearchEvidenceItemSnapshotV1Schema = Type.Object({
  id: UuidSchema,
  title: Type.String({ minLength: 1, maxLength: 500 }),
  url: HttpUrlSchema,
  publisher: Type.Union([Type.String({ minLength: 1, maxLength: 500 }), Type.Null()]),
  publishedAt: Type.Union([UtcTimestampSchema, Type.Null()]),
  capturedAt: UtcTimestampSchema,
  claimSummary: Type.String({ minLength: 1, maxLength: 4_000 }),
  contentHash: Sha256Schema,
}, { additionalProperties: false });
export type ResearchEvidenceItemSnapshotV1 = Static<typeof ResearchEvidenceItemSnapshotV1Schema>;

export const ResearchEvidenceSnapshotV1Schema = Type.Object({
  contractVersion: Type.Literal(RESEARCH_EVIDENCE_VERSION),
  decision: Type.Union([Type.Literal("searched"), Type.Literal("not_needed")]),
  reason: Type.String({ minLength: 1, maxLength: 4_000 }),
  queries: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 8 }),
  capturedAt: UtcTimestampSchema,
  items: Type.Array(ResearchEvidenceItemSnapshotV1Schema, { maxItems: 8 }),
}, { additionalProperties: false });
export type ResearchEvidenceSnapshotV1 = Static<typeof ResearchEvidenceSnapshotV1Schema>;

export const FrozenStyleImageSnapshotV1Schema = Type.Object({
  referenceItemId: UuidSchema,
  description: Type.String({ maxLength: 4_000 }),
  tags: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 20 }),
  storageUrl: HttpUrlSchema,
  storagePath: Type.String({ minLength: 1, maxLength: 2_000 }),
  mimeType: GeneratedImageMimeTypeSchema,
  checksum: Sha256Schema,
}, { additionalProperties: false });
export type FrozenStyleImageSnapshotV1 = Static<typeof FrozenStyleImageSnapshotV1Schema>;

export const FinalAttachmentSnapshotV1Schema = Type.Object({
  id: UuidSchema,
  role: Type.Union([
    Type.Literal("product_image"),
    Type.Literal("visual_reference"),
    Type.Literal("supporting_image"),
  ]),
  fileName: Type.String({ minLength: 1, maxLength: 500 }),
  mimeType: GeneratedImageMimeTypeSchema,
  sizeBytes: Type.Integer({ minimum: 1 }),
  checksum: Sha256Schema,
  storageUrl: HttpUrlSchema,
  storagePath: Type.String({ minLength: 1, maxLength: 2_000 }),
}, { additionalProperties: false });
export type FinalAttachmentSnapshotV1 = Static<typeof FinalAttachmentSnapshotV1Schema>;
