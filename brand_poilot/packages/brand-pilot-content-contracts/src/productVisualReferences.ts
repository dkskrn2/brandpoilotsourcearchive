import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { UuidSchema } from "./snapshots.js";

const Sha256Schema = Type.String({ pattern: "^[0-9a-f]{64}$" });
const HttpsUrlSchema = Type.String({ minLength: 1, maxLength: 2_048 });

export const ProductVisualSourceSnapshotV1Schema = Type.Object({
  contractVersion: Type.Literal("product-visual-source-snapshot.v1"),
  productServiceId: UuidSchema,
  versionId: UuidSchema,
  kind: Type.Union([Type.Literal("product"), Type.Literal("service")]),
  sourceUrls: Type.Array(HttpsUrlSchema, { minItems: 1, maxItems: 5 }),
}, { additionalProperties: false });

const ProductVisualCandidateV1Schema = Type.Object({
  candidateId: Sha256Schema,
  sourcePageUrl: HttpsUrlSchema,
  imageUrl: HttpsUrlSchema,
  discoveryMethod: Type.Union([
    Type.Literal("json_ld"),
    Type.Literal("product_gallery"),
    Type.Literal("open_graph"),
    Type.Literal("main_image"),
  ]),
  mimeType: Type.Union([
    Type.Literal("image/jpeg"),
    Type.Literal("image/png"),
    Type.Literal("image/webp"),
  ]),
  width: Type.Integer({ minimum: 1, maximum: 20_000 }),
  height: Type.Integer({ minimum: 1, maximum: 20_000 }),
  contentSha256: Sha256Schema,
  decision: Type.Union([Type.Literal("selected"), Type.Literal("excluded")]),
  reason: Type.String({ minLength: 1, maxLength: 120 }),
}, { additionalProperties: false });

const rankedReference = {
  rank: Type.Integer({ minimum: 1, maximum: 5 }),
  reason: Type.String({ minLength: 1, maxLength: 120 }),
};
const ProductVisualFinalReferenceV1Schema = Type.Union([
  Type.Object({ sourceType: Type.Literal("attachment"), referenceId: UuidSchema, ...rankedReference }, { additionalProperties: false }),
  Type.Object({ sourceType: Type.Literal("registered"), referenceId: UuidSchema, ...rankedReference }, { additionalProperties: false }),
  Type.Object({ sourceType: Type.Literal("url"), referenceId: Sha256Schema, ...rankedReference }, { additionalProperties: false }),
]);

export const ProductVisualReferenceSnapshotV1Schema = Type.Object({
  contractVersion: Type.Literal("product-visual-reference-snapshot.v1"),
  sourceSnapshot: Type.Union([Type.Null(), ProductVisualSourceSnapshotV1Schema]),
  candidates: Type.Array(ProductVisualCandidateV1Schema, { maxItems: 20 }),
  finalReferences: Type.Array(ProductVisualFinalReferenceV1Schema, { maxItems: 5 }),
}, { additionalProperties: false });

export type ProductVisualSourceSnapshotV1 = Static<typeof ProductVisualSourceSnapshotV1Schema>;
export type ProductVisualCandidateV1 = Static<typeof ProductVisualCandidateV1Schema>;
export type ProductVisualFinalReferenceV1 = Static<typeof ProductVisualFinalReferenceV1Schema>;
export type ProductVisualReferenceSnapshotV1 = Static<typeof ProductVisualReferenceSnapshotV1Schema>;

function isSafeHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && parsed.username === ""
      && parsed.password === ""
      && parsed.hash === "";
  } catch {
    return false;
  }
}

function invalidSource(): never { throw new Error("product_visual_source_snapshot_invalid"); }
function invalidReference(): never { throw new Error("product_visual_reference_snapshot_invalid"); }

export function parseProductVisualSourceSnapshotV1(value: unknown): ProductVisualSourceSnapshotV1 {
  if (!Value.Check(ProductVisualSourceSnapshotV1Schema, value)) invalidSource();
  const result = structuredClone(value as ProductVisualSourceSnapshotV1);
  if (result.sourceUrls.some((url) => !isSafeHttpsUrl(url))) invalidSource();
  if (new Set(result.sourceUrls).size !== result.sourceUrls.length) invalidSource();
  return result;
}

export function parseProductVisualReferenceSnapshotV1(value: unknown): ProductVisualReferenceSnapshotV1 {
  if (!Value.Check(ProductVisualReferenceSnapshotV1Schema, value)) invalidReference();
  const result = structuredClone(value as ProductVisualReferenceSnapshotV1);
  if (result.sourceSnapshot) {
    try { parseProductVisualSourceSnapshotV1(result.sourceSnapshot); } catch { invalidReference(); }
  }
  if (result.candidates.some(({ sourcePageUrl, imageUrl }) => (
    !isSafeHttpsUrl(sourcePageUrl) || !isSafeHttpsUrl(imageUrl)
  ))) invalidReference();
  if (new Set(result.candidates.map(({ candidateId }) => candidateId)).size !== result.candidates.length) invalidReference();
  if (new Set(result.candidates.map(({ contentSha256 }) => contentSha256)).size !== result.candidates.length) invalidReference();
  if (new Set(result.finalReferences.map(({ referenceId }) => referenceId)).size !== result.finalReferences.length) invalidReference();
  if (result.finalReferences.some(({ rank }, index) => rank !== index + 1)) invalidReference();
  const candidateIds = new Set(result.candidates.map(({ candidateId }) => candidateId));
  const selectedCandidateIds = new Set(result.candidates
    .filter(({ decision }) => decision === "selected")
    .map(({ candidateId }) => candidateId));
  const finalUrlReferenceIds = new Set(result.finalReferences
    .filter(({ sourceType }) => sourceType === "url")
    .map(({ referenceId }) => referenceId));
  if ((!result.sourceSnapshot && finalUrlReferenceIds.size > 0)
    || result.finalReferences.some(({ sourceType, referenceId }) => sourceType === "url" && !candidateIds.has(referenceId))
    || selectedCandidateIds.size !== finalUrlReferenceIds.size
    || [...selectedCandidateIds].some((candidateId) => !finalUrlReferenceIds.has(candidateId))) {
    invalidReference();
  }
  return result;
}
