import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const NullableUrlSchema = Type.Union([
  Type.Null(),
  Type.String({ minLength: 1, maxLength: 2_000 }),
]);
const NullableSha256Schema = Type.Union([
  Type.Null(),
  Type.String({ pattern: "^[0-9a-f]{64}$" }),
]);

export const ResearchSourceAcquisitionV1Schema = Type.Object({
  contractVersion: Type.Literal("research-source-acquisition.v1"),
  status: Type.Union([
    Type.Literal("complete_body"),
    Type.Literal("partial_body"),
    Type.Literal("metadata_only"),
    Type.Literal("access_failed"),
    Type.Literal("indeterminate"),
    Type.Literal("not_applicable"),
  ]),
  requestedUrl: NullableUrlSchema,
  canonicalUrl: NullableUrlSchema,
  contentHash: NullableSha256Schema,
  capturedAt: Type.String({ minLength: 20, maxLength: 40 }),
}, { additionalProperties: false });

export type ResearchSourceAcquisitionV1 = Static<typeof ResearchSourceAcquisitionV1Schema>;

function invalid(): never {
  throw new Error("research_source_acquisition_invalid");
}

function normalizedPublicHttpUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:")
      || parsed.username
      || parsed.password
      || parsed.hash) invalid();
    return parsed.toString();
  } catch {
    return invalid();
  }
}

export function parseResearchSourceAcquisitionV1(value: unknown): ResearchSourceAcquisitionV1 {
  if (!Value.Check(ResearchSourceAcquisitionV1Schema, value)) invalid();
  const parsed = structuredClone(value as ResearchSourceAcquisitionV1);
  if (!Number.isFinite(Date.parse(parsed.capturedAt))) invalid();

  if (parsed.status === "not_applicable") {
    if (parsed.requestedUrl !== null || parsed.canonicalUrl !== null || parsed.contentHash !== null) invalid();
    return parsed;
  }

  if (parsed.requestedUrl === null || parsed.canonicalUrl === null || parsed.contentHash === null) invalid();
  if (normalizedPublicHttpUrl(parsed.requestedUrl) !== parsed.requestedUrl
    || normalizedPublicHttpUrl(parsed.canonicalUrl) !== parsed.canonicalUrl) invalid();
  return parsed;
}
