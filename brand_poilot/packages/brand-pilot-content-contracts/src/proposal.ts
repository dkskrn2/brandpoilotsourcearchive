import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  CONTENT_PURPOSES,
  CONTENT_PROPOSAL_CONTRACT_VERSIONS,
  ContentPurposeSchema,
  ContentStudioOutputFormatSchema,
} from "./catalog.js";
import {
  ApprovedBrandCoreSnapshotV2Schema,
  ApprovedProductSnapshotV2Schema,
  ContentAspectRatioSchema,
  ContentChannelTargetSchema,
  FrozenReferenceSnapshotV2Schema,
  LowercaseSha256Schema,
  ResearchEvidenceSnapshotV1Schema,
  type ResearchEvidenceSnapshotV1,
  Sha256Schema,
  UtcTimestampSchema,
} from "./snapshots.js";

export const ContentProposalRequestV2Schema = Type.Object({
  contractVersion: Type.Literal(CONTENT_PROPOSAL_CONTRACT_VERSIONS.request),
  purpose: ContentPurposeSchema,
  outputFormat: ContentStudioOutputFormatSchema,
  channelTargets: Type.Array(ContentChannelTargetSchema, { minItems: 1, maxItems: 1 }),
  requestFingerprint: LowercaseSha256Schema,
}, { additionalProperties: false });
export type ContentProposalRequestV2 = Static<typeof ContentProposalRequestV2Schema>;

export const ProposalSubjectV2Schema = Type.Union([
  Type.Object({
    kind: Type.Literal("topic_text"),
    title: Type.String({ minLength: 1, maxLength: 500 }),
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal("topic_url"),
    requestedUrl: Type.String({ minLength: 1, maxLength: 2_000, pattern: "^https?://" }),
    canonicalUrl: Type.String({ minLength: 1, maxLength: 2_000, pattern: "^https?://" }),
    title: Type.Union([Type.String({ minLength: 1, maxLength: 500 }), Type.Null()]),
    text: Type.String({ minLength: 1, maxLength: 50_000 }),
    contentHash: Sha256Schema,
    capturedAt: UtcTimestampSchema,
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal("reference"),
    referenceIds: Type.Array(
      Type.String({
        pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
      }),
      { minItems: 1, maxItems: 5 },
    ),
  }, { additionalProperties: false }),
]);
export type ProposalSubjectV2 = Static<typeof ProposalSubjectV2Schema>;

export const ProposalInputOutputSettingsV2Schema = Type.Object({
  outputFormat: ContentStudioOutputFormatSchema,
  channelTargets: Type.Array(ContentChannelTargetSchema, { minItems: 1, maxItems: 1 }),
  aspectRatio: Type.Union([ContentAspectRatioSchema, Type.Null()]),
  outputCount: Type.Literal(1),
  purpose: ContentPurposeSchema,
}, { additionalProperties: false });
export type ProposalInputOutputSettingsV2 = Static<typeof ProposalInputOutputSettingsV2Schema>;

const proposalInputSharedProperties = {
  brandCore: ApprovedBrandCoreSnapshotV2Schema,
  subject: ProposalSubjectV2Schema,
  contentInstruction: Type.Union([Type.String({ minLength: 1, maxLength: 4_000 }), Type.Null()]),
  product: Type.Union([ApprovedProductSnapshotV2Schema, Type.Null()]),
  references: Type.Array(FrozenReferenceSnapshotV2Schema, { maxItems: 5 }),
  outputSettings: ProposalInputOutputSettingsV2Schema,
  capturedAt: UtcTimestampSchema,
} as const;

export const ProposalBaseInputSnapshotV2Schema = Type.Object({
  contractVersion: Type.Literal(CONTENT_PROPOSAL_CONTRACT_VERSIONS.baseInput),
  ...proposalInputSharedProperties,
}, { additionalProperties: false });
export type ProposalBaseInputSnapshotV2 = Static<typeof ProposalBaseInputSnapshotV2Schema>;

export const ProposalInputSnapshotV2Schema = Type.Object({
  contractVersion: Type.Literal(CONTENT_PROPOSAL_CONTRACT_VERSIONS.composedInput),
  ...proposalInputSharedProperties,
  researchEvidence: ResearchEvidenceSnapshotV1Schema,
}, { additionalProperties: false });
export type ProposalInputSnapshotV2 = Static<typeof ProposalInputSnapshotV2Schema>;

export const INFORMATIONAL_PROPOSAL_TYPES = [
  "problem_solution",
  "how_to",
  "checklist",
  "comparison",
  "trend_insight",
  "q_and_a",
  "myth_fact",
] as const;
export const PROPOSAL_DIFFERENTIATION_AXES = [
  "target",
  "situation",
  "question",
  "appeal",
  "narrative",
  "informational_type",
] as const;

export const InformationalProposalTypeV2Schema = Type.Union(
  INFORMATIONAL_PROPOSAL_TYPES.map((value) => Type.Literal(value)),
);
export const ProposalDifferentiationAxisV2Schema = Type.Union(
  PROPOSAL_DIFFERENTIATION_AXES.map((value) => Type.Literal(value)),
);
export type InformationalProposalTypeV2 = Static<typeof InformationalProposalTypeV2Schema>;
export type ProposalDifferentiationAxisV2 = Static<typeof ProposalDifferentiationAxisV2Schema>;

export const ContentProposalOutlineItemV2Schema = Type.Object({
  index: Type.Integer({ minimum: 1 }),
  role: Type.String({ minLength: 1, maxLength: 200 }),
  headline: Type.String({ minLength: 1, maxLength: 500 }),
  purpose: Type.String({ minLength: 1, maxLength: 4_000 }),
}, { additionalProperties: false });
export type ContentProposalOutlineItemV2 = Static<typeof ContentProposalOutlineItemV2Schema>;

export const InformationalPurposeDetailsV2Schema = Type.Object({
  kind: Type.Literal(CONTENT_PURPOSES[0]),
  question: Type.String({ minLength: 1, maxLength: 4_000 }),
  value: Type.String({ minLength: 1, maxLength: 4_000 }),
  whyNow: Type.String({ minLength: 1, maxLength: 4_000 }),
  learningPoints: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), { minItems: 1, maxItems: 20 }),
}, { additionalProperties: false });
export type InformationalPurposeDetailsV2 = Static<typeof InformationalPurposeDetailsV2Schema>;

export const MarketingPurposeDetailsV2Schema = Type.Object({
  kind: Type.Literal(CONTENT_PURPOSES[1]),
  campaignObjective: Type.String({ minLength: 1, maxLength: 4_000 }),
  situationAndNeed: Type.String({ minLength: 1, maxLength: 4_000 }),
  productId: Type.String({
    pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
  }),
  targetSegment: Type.String({ minLength: 1, maxLength: 4_000 }),
  strengths: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), { maxItems: 20 }),
  limitations: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), { maxItems: 20 }),
  appeal: Type.String({ minLength: 1, maxLength: 4_000 }),
  buyingBarriers: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), { maxItems: 20 }),
  cta: Type.String({ minLength: 1, maxLength: 4_000 }),
}, { additionalProperties: false });
export type MarketingPurposeDetailsV2 = Static<typeof MarketingPurposeDetailsV2Schema>;

export const ContentProposalV2Properties = {
  conceptKey: Type.String({ minLength: 1, maxLength: 200 }),
  title: Type.String({ minLength: 1, maxLength: 500 }),
  informationalType: Type.Union([InformationalProposalTypeV2Schema, Type.Null()]),
  oneLineIntent: Type.String({ minLength: 1, maxLength: 4_000 }),
  differentiator: Type.String({ minLength: 1, maxLength: 4_000 }),
  differentiationAxes: Type.Array(ProposalDifferentiationAxisV2Schema, { minItems: 1, maxItems: 6 }),
  target: Type.String({ minLength: 1, maxLength: 4_000 }),
  customerContext: Type.String({ minLength: 1, maxLength: 4_000 }),
  keyMessage: Type.String({ minLength: 1, maxLength: 4_000 }),
  hook: Type.String({ minLength: 1, maxLength: 4_000 }),
  selectionReason: Type.String({ minLength: 1, maxLength: 4_000 }),
  evidenceIds: Type.Array(Type.String({
    pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
  }), { maxItems: 8 }),
  referenceIds: Type.Array(Type.String({
    pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
  }), { maxItems: 5 }),
  outputFormat: ContentStudioOutputFormatSchema,
  channelTargets: Type.Array(ContentChannelTargetSchema, { minItems: 1, maxItems: 1 }),
  assetCount: Type.Union([Type.Integer({ minimum: 1, maximum: 5 }), Type.Null()]),
  outline: Type.Array(ContentProposalOutlineItemV2Schema, { minItems: 1, maxItems: 100 }),
  purposeDetails: Type.Union([InformationalPurposeDetailsV2Schema, MarketingPurposeDetailsV2Schema]),
} as const;

export const ContentProposalV2Schema = Type.Object(
  ContentProposalV2Properties,
  { additionalProperties: false },
);
export type ContentProposalV2 = Static<typeof ContentProposalV2Schema>;

export const ContentProposalSetV2Schema = Type.Object({
  contractVersion: Type.Literal(CONTENT_PROPOSAL_CONTRACT_VERSIONS.output),
  proposals: Type.Array(ContentProposalV2Schema, { minItems: 3, maxItems: 3 }),
}, { additionalProperties: false });
export type ContentProposalSetV2 = Static<typeof ContentProposalSetV2Schema>;

function parse<T>(schema: Parameters<typeof Value.Check>[0], value: unknown, code: string): T {
  if (!Value.Check(schema, value)) throw new Error(code);
  return value as T;
}

export function parseContentProposalRequestV2(value: unknown): ContentProposalRequestV2 {
  return parse(ContentProposalRequestV2Schema, value, "content_proposal_request_v2_invalid");
}

export function parseProposalBaseInputSnapshotV2(value: unknown): ProposalBaseInputSnapshotV2 {
  return parse(ProposalBaseInputSnapshotV2Schema, value, "proposal_base_input_v2_invalid");
}

export function parseProposalInputSnapshotV2(value: unknown): ProposalInputSnapshotV2 {
  return parse(ProposalInputSnapshotV2Schema, value, "proposal_input_v2_invalid");
}

export function parseResearchEvidenceSnapshotV1(value: unknown): ResearchEvidenceSnapshotV1 {
  return parse(ResearchEvidenceSnapshotV1Schema, value, "research_evidence_v1_invalid");
}

export function parseContentProposalSetV2(value: unknown): ContentProposalSetV2 {
  return parse(ContentProposalSetV2Schema, value, "content_proposal_set_v2_invalid");
}
