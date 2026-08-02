import { parseContentOrchestrationV1 } from "./contentOrchestration.js";

export type AiContentType = "card_news" | "blog" | "marketing";
export type ContentFamily = "informational" | "marketing";
export type OutputFormat = "card_news" | "blog" | "single_image" | "channel_text";
export type ContentChannelTarget =
  | "instagram"
  | "threads"
  | "x"
  | "linkedin"
  | "youtube"
  | "tiktok"
  | "blog_export";

export type ContentPurposeV2 = "informational" | "marketing";
export type ContentOutputFormatV2 = "card_news" | "blog" | "reel" | "marketing_content";
export type ContentChannelV2 = ContentChannelTarget;
export type ContentReferenceRoleV2 = "planning" | "copy_pattern" | "visual_composition";
export type ContentRatioV2 = "1:1" | "4:5" | "16:9" | "9:16";
export type GeneratedImageMimeTypeV2 = "image/png" | "image/jpeg" | "image/webp";
export type InformationalProposalTypeV2 =
  | "problem_solution"
  | "how_to"
  | "checklist"
  | "comparison"
  | "trend_insight"
  | "q_and_a"
  | "myth_fact";
export type ProposalDifferentiationAxisV2 =
  | "target"
  | "situation"
  | "question"
  | "appeal"
  | "narrative"
  | "informational_type";

export interface ContentOutputSettingsV2 {
  outputFormat: ContentOutputFormatV2;
  channelTargets: [ContentChannelV2];
  aspectRatio: ContentRatioV2 | null;
  outputCount: 1;
}

export type ContentSeedV2 =
  | { kind: "topic_text"; title: string }
  | { kind: "topic_url"; url: string }
  | {
    kind: "reference";
    items: Array<{ referenceId: string; roles: ContentReferenceRoleV2[] }>;
  };

export interface ContentOrchestrationV2 {
  contractVersion: "content-orchestration.v2";
  brandId: string;
  purpose: ContentPurposeV2;
  seed: ContentSeedV2;
  contentInstruction: string | null;
  productId: string | null;
  outputSettings: ContentOutputSettingsV2;
}

export interface ApprovedBrandCoreSnapshotV2 {
  versionId: string;
  companyOverview: string;
  businessDescription: string;
  primaryCategory: string;
  detailedCategory: string;
  primaryTarget: string;
  differentiator: string;
  coreAppeal: string;
}

export interface OwnedImageSnapshotV2 {
  storageUrl: string;
  storagePath: string;
  mimeType: string;
  checksum: string;
}

export interface ApprovedProductImageSnapshotV2 extends OwnedImageSnapshotV2 {
  assetId: string;
  role: "hero" | "detail";
}

export interface ApprovedProductSnapshotV2 {
  id: string;
  versionId: string;
  kind: "product" | "service";
  name: string;
  description: string;
  features: string[];
  benefits: string[];
  cautions: string[];
  evergreenPurchaseInfo: string;
  images: ApprovedProductImageSnapshotV2[];
}

export interface FrozenReferenceImageSnapshotV2 {
  storageUrl: string;
  storagePath: string;
  mimeType: GeneratedImageMimeTypeV2;
  checksum: string;
}

export interface FrozenReferenceSnapshotV2 {
  referenceItemId: string;
  snapshotId: string;
  roles: ContentReferenceRoleV2[];
  title: string;
  sourceUrl: string;
  capturedAt: string;
  contentHash: string;
  text: string;
  image: FrozenReferenceImageSnapshotV2 | null;
}

export interface ResearchEvidenceItemSnapshotV1 {
  id: string;
  title: string;
  url: string;
  publisher: string | null;
  publishedAt: string | null;
  capturedAt: string;
  claimSummary: string;
  contentHash: string;
}

export interface ResearchEvidenceSnapshotV1 {
  contractVersion: "research-evidence.v1";
  decision: "searched" | "not_needed";
  reason: string;
  queries: string[];
  capturedAt: string;
  items: ResearchEvidenceItemSnapshotV1[];
}

export type ProposalSubjectV2 =
  | { kind: "topic_text"; title: string }
  | {
    kind: "topic_url";
    requestedUrl: string;
    canonicalUrl: string;
    title: string | null;
    text: string;
    contentHash: string;
    capturedAt: string;
  }
  | { kind: "reference"; referenceIds: string[] };

export interface ProposalInputOutputSettingsV2 extends ContentOutputSettingsV2 {
  purpose: ContentPurposeV2;
}

export interface ProposalInputSnapshotV2 {
  contractVersion: "proposal-input.v2";
  brandCore: ApprovedBrandCoreSnapshotV2;
  subject: ProposalSubjectV2;
  contentInstruction: string | null;
  product: ApprovedProductSnapshotV2 | null;
  references: FrozenReferenceSnapshotV2[];
  researchEvidence: ResearchEvidenceSnapshotV1;
  outputSettings: ProposalInputOutputSettingsV2;
  capturedAt: string;
}

export interface ContentProposalOutlineItemV2 {
  index: number;
  role: string;
  headline: string;
  purpose: string;
}

export interface InformationalPurposeDetailsV2 {
  kind: "informational";
  question: string;
  value: string;
  whyNow: string;
  learningPoints: string[];
}

export interface MarketingPurposeDetailsV2 {
  kind: "marketing";
  campaignObjective: string;
  situationAndNeed: string;
  productId: string;
  targetSegment: string;
  strengths: string[];
  limitations: string[];
  appeal: string;
  buyingBarriers: string[];
  cta: string;
}

export interface ContentProposalV2 {
  conceptKey: string;
  title: string;
  informationalType: InformationalProposalTypeV2 | null;
  oneLineIntent: string;
  differentiator: string;
  differentiationAxes: ProposalDifferentiationAxisV2[];
  target: string;
  customerContext: string;
  keyMessage: string;
  hook: string;
  selectionReason: string;
  evidenceIds: string[];
  referenceIds: string[];
  outputFormat: ContentOutputFormatV2;
  channelTargets: [ContentChannelV2];
  assetCount: number | null;
  outline: ContentProposalOutlineItemV2[];
  purposeDetails: InformationalPurposeDetailsV2 | MarketingPurposeDetailsV2;
}

export interface ContentProposalSetV2 {
  contractVersion: "content-proposal.v2";
  proposals: [ContentProposalV2, ContentProposalV2, ContentProposalV2];
}

export interface FrozenStyleImageV2 {
  referenceItemId: string;
  description: string;
  tags: string[];
  storageUrl: string;
  storagePath: string;
  mimeType: GeneratedImageMimeTypeV2;
  checksum: string;
}

export interface FinalAttachmentV2 {
  id: string;
  role: "product_image" | "visual_reference" | "supporting_image";
  fileName: string;
  mimeType: GeneratedImageMimeTypeV2;
  sizeBytes: number;
  checksum: string;
  storageUrl: string;
  storagePath: string;
}

export interface ContentGenerationOutputSettingsV3 {
  outputFormat: ContentOutputFormatV2;
  channelTargets: [ContentChannelV2];
  aspectRatio: ContentRatioV2 | null;
  outputCount: 1;
  purpose: ContentPurposeV2;
}

export interface ContentGenerationReferencesV3 {
  selected: FrozenReferenceSnapshotV2[];
  brandStyleImages: FrozenStyleImageV2[];
  avatarStyleImageId: string | null;
  attachments: FinalAttachmentV2[];
}

export interface ContentGenerationInputV3 {
  contractVersion: "content-generation-input.v3";
  generationId: string;
  brandCore: ApprovedBrandCoreSnapshotV2;
  subject: ProposalSubjectV2;
  contentInstruction: string | null;
  product: ApprovedProductSnapshotV2 | null;
  researchEvidence: ResearchEvidenceSnapshotV1;
  references: ContentGenerationReferencesV3;
  selectedProposal: ContentProposalV2 & { id: string };
  userImageInstruction: string | null;
  outputSettings: ContentGenerationOutputSettingsV3;
  capturedAt: string;
}

export interface ImageGenerationAssetV1 {
  index: number;
  role: string;
  copy: string;
  visualDirection: string;
  evidenceIds: string[];
  productImageAssetIds: string[];
  attachmentIds: string[];
}

export interface ImageGenerationLogoPolicyV1 {
  allowGeneratedLogo: false;
  allowReservedLogoArea: false;
  allowExternalReferenceLogo: false;
  allowExistingProductPackagingLogo: true;
}

export interface ImageGenerationPackageV1 {
  contractVersion: "image-generation-package.v1";
  generationId: string;
  outputFormat: ContentOutputFormatV2;
  purpose: ContentPurposeV2;
  assetCount: number;
  aspectRatio: ContentRatioV2;
  channelTargets: [ContentChannelV2];
  assets: ImageGenerationAssetV1[];
  product: ApprovedProductSnapshotV2 | null;
  references: FrozenReferenceSnapshotV2[];
  brandStyleImages: FrozenStyleImageV2[];
  avatarStyleImageId: string | null;
  attachments: FinalAttachmentV2[];
  userImageInstruction: string | null;
  logoPolicy: ImageGenerationLogoPolicyV1;
}
export type MessageStrategy =
  | "problem_solution"
  | "how_to"
  | "comparison"
  | "faq"
  | "insight"
  | "benefit"
  | "social_proof"
  | "brand_story"
  | "cta";

export interface ContentOrchestrationV1 {
  contractVersion: "content-orchestration.v1";
  contentFamily: ContentFamily;
  subject:
    | { mode: "brand_topic"; topic: string }
    | { mode: "product_service"; productServiceId: string }
    | { mode: "new_subject"; subjectAnalysisId: string };
  target: { id: string | null; snapshot: Record<string, unknown> };
  strategy: MessageStrategy;
  outputFormat: OutputFormat;
  channelTargets: ContentChannelTarget[];
  brief: Record<string, unknown>;
  references: Array<{
    referenceItemId: string;
    roles: Array<"planning" | "copy_pattern" | "visual_composition">;
  }>;
  avatar: null | {
    mode: "library" | "one_time";
    id: string;
    snapshot: Record<string, unknown>;
  };
}

export interface ContentProposalV1 {
  contractVersion: "content-proposal.v1";
  title: string;
  reasonToCreateNow: string;
  contentFamily: ContentFamily;
  topic: string;
  target: Record<string, unknown>;
  messageStrategy: MessageStrategy;
  hook: string;
  keyMessage: string;
  evidence: Array<{ sourceSnapshotId: string; summary: string }>;
  outline: Array<{ heading: string; purpose: string }>;
  outputFormat: OutputFormat;
  channelTargets: ContentChannelTarget[];
  recommendedReferenceQuery: {
    strategies: MessageStrategy[];
    formats: OutputFormat[];
    tags: string[];
  };
}

export interface ContentProposalRequestV1 {
  contractVersion: "content-proposal-request.v1";
  contentFamily: ContentFamily;
  subjectInput: Record<string, unknown>;
  channelTargets: string[];
  outputFormats: OutputFormat[];
  sourceSnapshotIds: string[];
  performanceSnapshotIds: string[];
}

export type AiContentJobType = "analyze" | "generate";
export type AiContentGenerationStatus =
  | "draft"
  | "analyzing"
  | "analysis_ready"
  | "queued"
  | "planning"
  | "generating"
  | "completed"
  | "partial_failed"
  | "failed";
export type AiContentOutputStatus = "queued" | "planning" | "generating" | "completed" | "failed";
export type AiContentAssetRole = "slide" | "cover" | "inline" | "html" | "creative" | "text";

export interface AiContentAsset {
  role: AiContentAssetRole;
  url: string;
  fileName: string;
  mimeType: "image/png" | "text/html" | "text/plain";
  width?: number;
  height?: number;
  index: number;
}

export interface CardNewsContent {
  caption: string;
  hashtags: string[];
  cta: string;
}

export interface BlogContent {
  title: string;
  summary: string;
  html: string;
  metaTitle: string;
  metaDescription: string;
  coverAlt?: string;
}

export interface MarketingContent {
  headline: string;
  body: string;
  cta: string;
  concept: string;
}

interface AiContentManifestBase<TType extends AiContentType, TContent> {
  version: "ai-content.v1";
  type: TType;
  title: string;
  assets: AiContentAsset[];
  content: TContent;
  family?: ContentFamily;
  strategy?: MessageStrategy;
  outputFormat?: OutputFormat;
}

export type CardNewsManifest = AiContentManifestBase<"card_news", CardNewsContent>;
export type BlogManifest = AiContentManifestBase<"blog", BlogContent>;
export type MarketingManifest = AiContentManifestBase<"marketing", MarketingContent>;
export type AiContentManifestV1 = CardNewsManifest | BlogManifest | MarketingManifest;

export type AiContentV2AssetRole = "slide" | "inline" | "html" | "creative" | "scene" | "video";

export interface AiContentManifestV2 {
  version: "ai-content.v2";
  type: AiContentType;
  purpose: "informational" | "marketing";
  outputFormat: "card_news" | "blog" | "reel" | "marketing_content";
  title: string;
  assets: Array<{
    role: AiContentV2AssetRole;
    index: number;
    url: string;
    fileName: string;
    mimeType: "image/png" | "text/html" | "video/mp4";
    width?: number;
    height?: number;
    durationSeconds?: number;
    videoCodec?: "h264";
    fps?: 30;
    audioCodec?: null;
  }>;
  content: Record<string, unknown>;
}

export type AiContentManifest = AiContentManifestV1 | AiContentManifestV2;

export interface CreateAiContentAnalysisInput {
  type: AiContentType;
  title: string;
  draft: Record<string, unknown>;
  orchestration?: ContentOrchestrationV1;
  idempotencyKey: string;
}

export interface UpdateAiContentDraftInput {
  draft: Record<string, unknown>;
  referenceIds: string[];
  orchestration?: ContentOrchestrationV1;
}

export interface StartAiContentGenerationInput {
  idempotencyKey: string;
  outputCount: 1 | 2 | 3;
}

export interface ContentFinalizationDraftV2 {
  contractVersion: "content-finalization-draft.v2";
  avatarStyleImageId: string | null;
  userImageInstruction: string | null;
  attachmentIds: string[];
}

export interface ContentGenerationStartV2 {
  contractVersion: "content-generation-start.v2";
  idempotencyKey: string;
}

export type AiContentAttachmentRole = "product" | "person" | "scale" | "visual_reference" | "document";

export interface AttachmentUploadTokenInput {
  role: AiContentAttachmentRole;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
}

export type AiContentAttachmentRoleV3 = "product_image" | "visual_reference" | "supporting_image";

export interface V3AttachmentUploadTokenInput {
  contractVersion: "ai-content-attachment-upload.v3";
  role: AiContentAttachmentRoleV3;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
}

export interface ConfirmUploadSessionInput {
  sessionId: string;
  nonce: string;
}

export interface CancelUploadSessionInput {
  sessionId: string;
  nonce: string;
}

export interface LegacyConfirmAttachmentInput extends AttachmentUploadTokenInput {
  storageUrl: string;
  storagePath: string;
}

export type ConfirmAttachmentInput =
  | ConfirmUploadSessionInput
  | LegacyConfirmAttachmentInput;

interface CompleteAiContentJobBase {
  jobId: string;
  workerId: string;
  leaseToken: string;
  skillVersion: string;
}

export interface CompleteAiContentAnalysisJobInput extends CompleteAiContentJobBase {
  jobType: "analyze";
  analysisJson: Record<string, unknown>;
}

export interface CompleteAiContentGenerationJobInput extends CompleteAiContentJobBase {
  jobType: "generate";
  manifest: AiContentManifest;
  manifestUrl: string;
}

export interface CompleteAiContentPlanningJobInput extends CompleteAiContentJobBase {
  jobType: "generate";
  plan: import("./aiContentPlanContracts.js").ContentPlanResultV2;
}

export type CompleteAiContentJobInput =
  | CompleteAiContentAnalysisJobInput
  | CompleteAiContentGenerationJobInput
  | CompleteAiContentPlanningJobInput;

export interface FailAiContentJobInput {
  jobId: string;
  workerId: string;
  leaseToken: string;
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
}

function fail(code: string): never {
  throw new Error(code);
}

function inputObject(value: unknown, code = "ai_content_invalid_body"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, code: string, maxLength = 500): string {
  if (typeof value !== "string") fail(code);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) fail(code);
  return normalized;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value: unknown, code: string): string {
  if (typeof value !== "string" || !UUID.test(value)) fail(code);
  return value.toLowerCase();
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  code = "ai_content_invalid_body",
): Record<string, unknown> {
  const source = inputObject(value, code);
  const actual = Object.keys(source);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) fail(code);
  return source;
}

export function parseAiContentGenerationId(value: unknown): string {
  return uuid(value, "ai_content_generation_id_invalid");
}

export function parseAiContentAttachmentId(value: unknown): string {
  return uuid(value, "ai_content_attachment_id_invalid");
}

export function parseAiContentUploadSessionId(value: unknown): string {
  return uuid(value, "ai_content_upload_session_id_invalid");
}

function parseAttachmentRole(value: unknown): AiContentAttachmentRole {
  if (!(new Set(["product", "person", "scale", "visual_reference", "document"])).has(String(value))) {
    fail("ai_content_attachment_role_invalid");
  }
  return value as AiContentAttachmentRole;
}

export function parseCreateAiContentAnalysisInput(value: unknown): CreateAiContentAnalysisInput {
  const source = inputObject(value);
  if (!(new Set(["card_news", "blog", "marketing"])).has(String(source.type))) {
    fail("ai_content_type_invalid");
  }
  const orchestration = source.orchestration === undefined
    ? undefined
    : parseContentOrchestrationInput(source.orchestration);
  if (orchestration && mapOrchestrationOutputToLegacyType(orchestration.outputFormat) !== source.type) {
    fail("ai_content_type_mapping_mismatch");
  }
  return {
    type: source.type as AiContentType,
    title: requiredString(source.title, "ai_content_title_invalid", 200),
    draft: inputObject(source.draft, "ai_content_draft_invalid"),
    ...(orchestration ? { orchestration } : {}),
    idempotencyKey: requiredString(source.idempotencyKey, "ai_content_idempotency_key_invalid", 200),
  };
}

function mapOrchestrationOutputToLegacyType(outputFormat: OutputFormat): AiContentType {
  if (outputFormat === "card_news") return "card_news";
  if (outputFormat === "blog") return "blog";
  return "marketing";
}

function parseContentOrchestrationInput(value: unknown): ContentOrchestrationV1 {
  // Kept as a late import boundary in the public parser contract: the canonical
  // parser remains the single source of validation truth in contentOrchestration.
  return parseContentOrchestrationV1(value);
}

export function parseUpdateAiContentDraftInput(value: unknown): UpdateAiContentDraftInput {
  const source = inputObject(value);
  if (!Array.isArray(source.referenceIds) || source.referenceIds.some((id) => typeof id !== "string" || !id.trim())) {
    fail("ai_content_reference_ids_invalid");
  }
  return {
    draft: inputObject(source.draft, "ai_content_draft_invalid"),
    referenceIds: source.referenceIds.map((id) => String(id).trim()),
    ...(source.orchestration === undefined
      ? {}
      : { orchestration: parseContentOrchestrationInput(source.orchestration) }),
  };
}

export function parseStartAiContentGenerationInput(value: unknown): StartAiContentGenerationInput {
  const source = inputObject(value);
  if (source.outputCount !== 1 && source.outputCount !== 2 && source.outputCount !== 3) {
    fail("ai_content_output_count_invalid");
  }
  return {
    idempotencyKey: requiredString(source.idempotencyKey, "ai_content_idempotency_key_invalid", 200),
    outputCount: source.outputCount,
  };
}

export function parseAttachmentUploadTokenInput(value: unknown): AttachmentUploadTokenInput {
  const source = inputObject(value);
  if (!Number.isSafeInteger(source.sizeBytes) || Number(source.sizeBytes) <= 0) {
    fail("ai_content_attachment_size_invalid");
  }
  return {
    role: parseAttachmentRole(source.role),
    fileName: requiredString(source.fileName, "ai_content_attachment_file_name_invalid", 200),
    mimeType: requiredString(source.mimeType, "ai_content_attachment_mime_invalid", 100),
    sizeBytes: Number(source.sizeBytes),
    checksum: requiredString(source.checksum, "ai_content_attachment_checksum_invalid", 128),
  };
}

export function parseV3AttachmentUploadTokenInput(value: unknown): V3AttachmentUploadTokenInput {
  const source = exactObject(value, [
    "contractVersion",
    "role",
    "fileName",
    "mimeType",
    "sizeBytes",
    "checksum",
  ]);
  if (source.contractVersion !== "ai-content-attachment-upload.v3") fail("ai_content_invalid_body");
  if (!(new Set(["product_image", "visual_reference", "supporting_image"])).has(String(source.role))) {
    fail("ai_content_attachment_role_invalid");
  }
  if (!Number.isSafeInteger(source.sizeBytes) || Number(source.sizeBytes) <= 0) {
    fail("ai_content_attachment_size_invalid");
  }
  return {
    contractVersion: source.contractVersion,
    role: source.role as AiContentAttachmentRoleV3,
    fileName: requiredString(source.fileName, "ai_content_attachment_file_name_invalid", 200),
    mimeType: requiredString(source.mimeType, "ai_content_attachment_mime_invalid", 100),
    sizeBytes: Number(source.sizeBytes),
    checksum: requiredString(source.checksum, "ai_content_attachment_checksum_invalid", 128),
  };
}

export function parseConfirmAttachmentInput(value: unknown): ConfirmAttachmentInput {
  const source = inputObject(value);
  if (Object.prototype.hasOwnProperty.call(source, "sessionId")
    || Object.prototype.hasOwnProperty.call(source, "nonce")) {
    const session = exactObject(source, ["sessionId", "nonce"]);
    return {
      sessionId: parseAiContentUploadSessionId(session.sessionId),
      nonce: requiredString(session.nonce, "ai_content_upload_nonce_invalid", 500),
    };
  }
  return parseLegacyConfirmAttachmentInput(source);
}

export function parseLegacyConfirmAttachmentInput(value: unknown): LegacyConfirmAttachmentInput {
  const source = inputObject(value);
  return {
    ...parseAttachmentUploadTokenInput(source),
    storageUrl: requiredString(source.storageUrl, "ai_content_attachment_url_invalid", 2_000),
    storagePath: requiredString(source.storagePath, "ai_content_attachment_path_invalid", 500),
  };
}

export function parseCancelUploadSessionInput(value: unknown): CancelUploadSessionInput {
  const source = exactObject(value, ["sessionId", "nonce"]);
  return {
    sessionId: parseAiContentUploadSessionId(source.sessionId),
    nonce: requiredString(source.nonce, "ai_content_upload_nonce_invalid", 500),
  };
}
