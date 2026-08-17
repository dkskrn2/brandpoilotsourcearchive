import type {
  ContentPurpose,
  ContentStudioOutputFormat,
} from "@brand-pilot/content-contracts";
import type {
  AiContentReferenceSeed,
  ChannelConnection,
  ChannelType,
  DeliveryFormat,
  PublishArtifact,
} from "../../types";

export type AiContentType = "card_news" | "blog" | "marketing";
export type AiContentWizardStep = 1 | 2 | 3 | 4 | 5;
export type ContentCreationPhase = "setup" | "proposal_selection" | "generating" | "reviewing";
export type ContentSetupSection = "intent" | "sources" | "delivery";
export type ContentFamily = "informational" | "marketing";
export type ContentPurposeV2 = ContentPurpose;
export type ContentOutputFormatV2 = ContentStudioOutputFormat;
export type ContentOutputFormat = "card_news" | "blog" | "single_image" | "channel_text";
export type ContentChannelTarget = "instagram" | "threads" | "x" | "linkedin" | "youtube" | "tiktok" | "blog_export";
export type ContentReferenceRoleV2 = "planning" | "copy_pattern" | "visual_composition";
export type ContentAspectRatioV2 = "1:1" | "4:5" | "16:9" | "9:16";

export interface ContentReferenceSelectionV2 {
  referenceId: string;
  roles: ContentReferenceRoleV2[];
}

export type ContentSeedV2 =
  | { kind: "topic_text"; title: string }
  | { kind: "topic_url"; url: string }
  | { kind: "reference"; items: ContentReferenceSelectionV2[] };

export interface ContentOrchestrationV2 {
  contractVersion: "content-orchestration.v2";
  brandId: string;
  purpose: ContentPurposeV2;
  seed: ContentSeedV2;
  contentInstruction: string | null;
  productId: string | null;
  outputSettings: {
    outputFormat: ContentOutputFormatV2;
    channelTargets: [ContentChannelTarget];
    aspectRatio: ContentAspectRatioV2 | null;
    outputCount: 1;
  };
}

export interface ContentProposalV2 {
  conceptKey: string;
  title: string;
  informationalType: "problem_solution" | "how_to" | "checklist" | "comparison" | "trend_insight" | "q_and_a" | "myth_fact" | null;
  oneLineIntent: string;
  differentiator: string;
  differentiationAxes: Array<"target" | "situation" | "question" | "appeal" | "narrative" | "informational_type">;
  target: string;
  customerContext: string;
  keyMessage: string;
  hook: string;
  selectionReason: string;
  evidenceIds: string[];
  referenceIds: string[];
  outputFormat: ContentOutputFormatV2;
  channelTargets: [ContentChannelTarget];
  assetCount: number | null;
  outline: Array<{ index: number; role: string; headline: string; purpose: string }>;
  purposeDetails:
    | {
        kind: "informational";
        question: string;
        value: string;
        whyNow: string;
        learningPoints: string[];
      }
    | {
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
      };
}

export interface AiContentFinalizationDraftV2 {
  contractVersion: "content-finalization-draft.v2";
  avatarStyleImageId: string | null;
  userImageInstruction: string | null;
  attachmentIds: string[];
}
export type ContentMessageStrategy =
  | "problem_solution" | "how_to" | "comparison" | "faq" | "insight"
  | "benefit" | "social_proof" | "brand_story" | "cta";
export type AiGenerationStatus = "draft" | "analyzing" | "analysis_ready" | "queued" | "planning" | "generating" | "completed" | "partial_failed" | "failed";
export type AiOutputStatus = "queued" | "planning" | "generating" | "completed" | "failed";
export type SubjectType = "product" | "service";
export type SubjectAnalysisStatus = "queued" | "extracting" | "researching" | "analyzing" | "generating_appeals" | "ready" | "partial" | "failed";
export type SubjectEvidenceType = "product_fact" | "public_research" | "manual_input";

export interface AiContentUsage {
  generationUsed: number;
  generationLimit: number;
  newDownloadUsed: number;
  newDownloadLimit: number;
  resetsAt: string;
}

export interface AiContentBrandContext {
  ready: boolean;
  brandName: string;
  ownedUrl: string | null;
  sourceStatus: string | null;
  lastCrawledAt: string | null;
  wikiVersionId: string | null;
  wikiUpdatedAt: string | null;
  summary: string | null;
  pageCount: number;
  brandColor?: string;
}

export interface SubjectTarget {
  id: string;
  name: string;
  traits: string[];
  painPoints: string[];
  purchaseMotivations: string[];
  uspEvidence: Array<{ claim: string; support: string; sourceUrl: string }>;
}

export interface SubjectAppeal {
  id: string;
  targetId: string;
  title: string;
  description: string;
  evidenceType: SubjectEvidenceType;
  connectionReason: string;
  sources: Array<{ title: string; url: string }>;
}

export interface SubjectAnalysisImage {
  id: string;
  analysisId: string;
  sourceUrl: string;
  storageUrl: string;
  storagePath: string;
  width: number | null;
  height: number | null;
  mimeType: string;
  altText: string;
  role: "product" | "service" | "logo" | "detail" | "unknown";
  selectionScore: number;
  createdAt: string;
}

export interface SubjectAnalysis {
  id: string;
  generationId?: string | null;
  contractVersion?: "subject-analysis.v1" | "subject-analysis.v2";
  workspaceId: string;
  brandId: string;
  subjectType: SubjectType;
  sourceUrl: string;
  normalizedUrl: string;
  input:
    | { name: string; promotion: string; promotionOrTerms?: string; description: string }
    | { name: string; promotion?: string; promotionOrTerms: string; description: string };
  status: SubjectAnalysisStatus;
  facts: Array<{ key: string; value: string; sourceUrl: string }>;
  structuredData: Record<string, unknown>;
  research: Record<string, unknown>;
  targets: SubjectTarget[];
  appealsByTarget: Record<string, SubjectAppeal[]>;
  selectedImageId: string | null;
  images: SubjectAnalysisImage[];
  analysisVersion: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  sourceGaps?: string[];
}

export interface AudiencePreset {
  id: string;
  name: string;
  situation: string;
  problem: string;
  motivation: string;
  useCount: number;
  lastUsedAt: string | null;
}

export interface AppealPreset {
  id: string;
  title: string;
  description: string;
  evidenceType: "fact" | "benefit" | "price" | "trust" | "emotion";
  useCount: number;
  lastUsedAt: string | null;
}

export type AudienceSnapshot = Pick<AudiencePreset, "id" | "name" | "situation" | "problem" | "motivation">;
export type AppealSnapshot = Pick<AppealPreset, "id" | "title" | "description" | "evidenceType">;

export interface AiContentReference {
  id: string;
  title: string;
  previewUrl: string | null;
  source: "owned" | "api" | "saved_trend" | "uploaded";
  format: "card_news" | "image" | "reel" | "blog" | "marketing";
  primaryCategory: string | null;
  subcategory: string | null;
  appealIds: string[];
  comparableMetric: { label: string; value: number } | null;
}

export interface AiContentReferenceQuery {
  strategies: ContentMessageStrategy[];
  formats: ContentOutputFormat[];
  tags: string[];
}

export interface ContentProposal {
  contractVersion: "content-proposal.v1";
  title: string;
  reasonToCreateNow: string;
  contentFamily: ContentFamily;
  topic: string;
  target: Record<string, unknown>;
  messageStrategy: ContentMessageStrategy;
  hook: string;
  keyMessage: string;
  evidence: Array<{ sourceSnapshotId: string; summary: string }>;
  outline: Array<{ heading: string; purpose: string }>;
  outputFormat: ContentOutputFormat;
  channelTargets: ContentChannelTarget[];
  recommendedReferenceQuery: {
    strategies: ContentMessageStrategy[];
    formats: ContentOutputFormat[];
    tags: string[];
  };
}

export interface ContentProposalRequest {
  contractVersion: "content-proposal-request.v1";
  contentFamily: ContentFamily;
  subjectInput: Record<string, unknown>;
  channelTargets: string[];
  outputFormats: ContentOutputFormat[];
  sourceSnapshotIds: string[];
  performanceSnapshotIds: string[];
}

export interface ContentOrchestration {
  contractVersion: "content-orchestration.v1";
  contentFamily: ContentFamily;
  subject:
    | { mode: "brand_topic"; topic: string }
    | { mode: "product_service"; productServiceId: string }
    | { mode: "new_subject"; subjectAnalysisId: string };
  target: { id: string | null; snapshot: Record<string, unknown> };
  strategy: ContentMessageStrategy;
  outputFormat: ContentOutputFormat;
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

export interface ContentProposalRecord {
  id: string;
  batchId: string;
  proposal: ContentProposal;
  status: "suggested" | "selected" | "dismissed";
  generationId: string | null;
  createdAt: string;
}

export interface ContentProposalRecordV2 extends Omit<ContentProposalRecord, "proposal"> {
  proposal: ContentProposalV2;
}

export interface ContentProposalBatch {
  id: string;
  workspaceId: string;
  brandId: string;
  origin: "manual" | "scheduled_crawl";
  contentFamily: ContentFamily;
  request: Record<string, unknown>;
  sourceSnapshots: Record<string, unknown>[];
  status: "queued" | "building" | "ready" | "failed";
  proposals?: Array<ContentProposalRecord | ContentProposalRecordV2>;
  researchEvidence?: {
    items: Array<{ id: string; title: string; url: string; publisher: string | null }>;
  };
  selectedReferences?: Array<{
    id: string;
    title: string;
    preview: { url: string | null; mimeType: string | null };
  }>;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiContentDraftReference {
  assetType: "reference" | "avatar" | "product_service" | "wiki";
  assetId: string;
  generationId: string;
  title: string;
}

export interface GenerationAttachment {
  id: string;
  role: "product" | "person" | "scale" | "visual_reference" | "document"
    | "product_image" | "supporting_image";
  fileName: string;
  mimeType: string;
  size: number;
  file?: File;
  storageUrl?: string;
  storagePath?: string;
  uploadStatus?: "pending" | "failed" | "confirmed";
  uploadAction?: AttachmentLifecycleAction;
  uploadRetryable?: boolean;
}

export type AttachmentLifecycleAction = "retry" | "reselect" | "new_generation" | "none";
export type GenerationAttachmentUpdate =
  | GenerationAttachment[]
  | ((current: GenerationAttachment[]) => GenerationAttachment[]);

export interface GenerationBrief {
  purpose: "sales" | "awareness" | "information" | "event";
  emphasis: string;
  cta: string;
  additionalInstruction: string;
  selectedColor: string;
  attachments: GenerationAttachment[];
  aspectRatio: "1:1" | "4:5" | "16:9" | "9:16";
  outputCount: 1 | 2 | 3;
  outputDirections: string[];
}

export type GenerationBriefUpdate =
  | GenerationBrief
  | ((current: GenerationBrief) => GenerationBrief);

export interface AiContentDraft {
  orchestration?: ContentOrchestration | null;
  subjectType: SubjectType | null;
  subjectInput: {
    sourceUrl: string;
    name: string;
    promotion: string;
    description: string;
  };
  subjectAnalysisId: string | null;
  subjectAnalysisVersion: number | null;
  subjectAttachments?: GenerationAttachment[];
  selectedSubjectImageIds: string[];
  selectedTarget: SubjectTarget | null;
  selectedAppeal: SubjectAppeal | null;
  appealOverridesByTarget: Record<string, SubjectAppeal[]>;
  referenceIds: string[];
  brief: GenerationBrief | null;

  /** @deprecated Read compatibility for the pre-subject-analysis wizard. Never send these fields in new writes. */
  analysisSource: "owned" | "product_url" | null;
  /** @deprecated Use subjectInput.sourceUrl. */
  productUrl: string;
  /** @deprecated Use selectedSubjectImageIds. */
  selectedAnalysisImageIds: string[];
  /** @deprecated Use selectedTarget. */
  audience: AudienceSnapshot | null;
  /** @deprecated Use selectedAppeal. */
  coreAppeal: AppealSnapshot | null;
  /** @deprecated Read-only compatibility; new writes ignore this field. */
  secondaryAppeals: AppealSnapshot[];
}

export interface SubjectAnalysisInput {
  generationId: string;
  subjectType: SubjectType;
  sourceUrl: string | null;
  attachmentIds: string[];
  manualInput: { name: string; promotionOrTerms: string; description: string };
  idempotencyKey: string;
}

/** @deprecated Test-double compatibility for pre-v2 callers. The HTTP gateway rejects this shape. */
export interface LegacySubjectAnalysisInput {
  subjectType: SubjectType;
  sourceUrl: string;
  manualInput: { name: string; promotion: string; description: string };
  idempotencyKey: string;
  force?: boolean;
}

export interface AiGenerationOutput {
  id: string;
  generationId: string;
  title: string;
  status: AiOutputStatus;
  artifact: PublishArtifact | null;
  failureReason: string | null;
  downloadedAt: string | null;
  manifestVersion: "ai-content.v3" | null;
  outputFormat: ContentOutputFormatV2;
  publishSupported?: boolean;
}

export interface AiContentGenerationEvidenceSnapshot {
  orchestration: Record<string, unknown>;
  generationInput: Record<string, unknown>;
  references: Array<{
    id: string;
    title: string;
    url: string | null;
    previewUrl: string | null;
    roles: string[];
  }>;
  avatar: Record<string, unknown> | null;
  proposal: Record<string, unknown> | null;
}

export interface AiContentGenerationProgress {
  phase: "queued" | "planning" | "rendering" | "finalizing";
  totalAssets: number;
  completedAssets: number;
  failedAssets: number;
  items: Array<{
    index: number;
    role: string;
    status: "queued" | "processing" | "completed" | "failed";
  }>;
  startedAt: string | null;
  updatedAt: string;
}

export interface AiContentGeneration {
  id: string;
  brandId: string;
  title: string;
  outputFormat: ContentOutputFormatV2;
  purpose: ContentPurposeV2;
  status: AiGenerationStatus;
  currentStep: AiContentWizardStep;
  draft: AiContentDraft;
  analysis?: Record<string, unknown>;
  evidenceSnapshot?: AiContentGenerationEvidenceSnapshot | null;
  outputs: AiGenerationOutput[];
  attachmentsLockedAt: string | null;
  terminalAt: string | null;
  retryableUntil: string | null;
  progress?: AiContentGenerationProgress | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiContentPublishTargetInput {
  channel: ChannelType;
  deliveryFormat: DeliveryFormat;
}

export interface AiContentPublishTargetResult extends AiContentPublishTargetInput {
  channelOutputId: string;
  queueId: string | null;
  status: "scheduled" | "publishing" | "published" | "failed";
  publishedUrl: string | null;
  errorCode: string | null;
}

export interface ManualVisualSelectionV1 {
  contractVersion: "manual-visual-selection.v1";
  product: null | { productServiceId: string; versionId: string };
  stylePreset: null | { presetId: string; revision: number };
  avatar: null | { avatarId: string; revision: number };
}

export interface AiContentGateway {
  getUsage(brandId: string): Promise<AiContentUsage>;
  getBrandContext(brandId: string): Promise<AiContentBrandContext>;
  listGenerations(brandId: string): Promise<AiContentGeneration[]>;
  getGeneration(brandId: string, generationId: string): Promise<AiContentGeneration>;
  uploadAttachment(brandId: string, generationId: string, attachment: GenerationAttachment, onProgress?: (percentage: number) => void): Promise<GenerationAttachment>;
  removeAttachment(brandId: string, generationId: string, attachmentId: string): Promise<void>;
  listAudiencePresets(brandId: string): Promise<AudiencePreset[]>;
  saveAudiencePreset(brandId: string, input: Omit<AudiencePreset, "id" | "useCount" | "lastUsedAt">): Promise<AudiencePreset>;
  listAppealPresets(brandId: string): Promise<AppealPreset[]>;
  saveAppealPreset(brandId: string, input: Omit<AppealPreset, "id" | "useCount" | "lastUsedAt">): Promise<AppealPreset>;
  listReferences(brandId: string, query?: AiContentType | AiContentReferenceQuery): Promise<AiContentReference[]>;
  listReferenceSeeds(brandId: string, format: ContentOutputFormatV2): Promise<AiContentReferenceSeed[]>;
  retryOutput(brandId: string, outputId: string, reason: string): Promise<AiContentGeneration>;
  downloadOutput(brandId: string, outputId: string): Promise<{ blob: Blob; fileName: string }>;
  downloadGeneration(brandId: string, generationId: string, outputIds?: string[]): Promise<{ blob: Blob; fileName: string }>;
  publishOutput(brandId: string, outputId: string, input: {
    idempotencyKey: string;
    targets: AiContentPublishTargetInput[];
  }): Promise<{ outputId: string; publishGroupId: string; targets: AiContentPublishTargetResult[] }>;
  getPublishQueueResult(brandId: string, queueId: string): Promise<AiContentPublishTargetResult>;
  listChannels(brandId: string): Promise<ChannelConnection[]>;
  getCachedSubjectAnalysis(brandId: string, subjectType: SubjectType, sourceUrl: string): Promise<SubjectAnalysis | null>;
  requestSubjectAnalysis(brandId: string, input: SubjectAnalysisInput | LegacySubjectAnalysisInput): Promise<SubjectAnalysis>;
  getSubjectAnalysis(brandId: string, analysisId: string): Promise<SubjectAnalysis>;
  regenerateSubjectAppeals(brandId: string, analysisId: string, idempotencyKey: string): Promise<SubjectAnalysis>;
  reanalyzeSubject(brandId: string, analysisId: string, idempotencyKey: string): Promise<SubjectAnalysis>;
  selectSubjectImage(brandId: string, analysisId: string, imageId: string): Promise<SubjectAnalysis>;
  createProposalBatch(brandId: string, input: {
    idempotencyKey: string;
    request: ContentOrchestrationV2;
  }): Promise<{ batchId: string; status: ContentProposalBatch["status"] }>;
  getProposalBatch(brandId: string, batchId: string, signal?: AbortSignal): Promise<ContentProposalBatch>;
  listSuggestedProposals(brandId: string, signal?: AbortSignal): Promise<ContentProposalRecord[]>;
  selectProposal(brandId: string, proposalId: string, idempotencyKey: string): Promise<AiContentGeneration>;
  updateFinalizationDraft?(
    brandId: string,
    generationId: string,
    draft: AiContentFinalizationDraftV2,
  ): Promise<AiContentGeneration>;
  getManualVisualSelection?(
    brandId: string,
    generationId: string,
  ): Promise<ManualVisualSelectionV1>;
  updateManualVisualSelection?(
    brandId: string,
    generationId: string,
    selection: ManualVisualSelectionV1,
  ): Promise<ManualVisualSelectionV1>;
  startGenerationV2?(
    brandId: string,
    generationId: string,
    idempotencyKey: string,
  ): Promise<AiContentGeneration>;
  dismissProposal(brandId: string, proposalId: string): Promise<ContentProposalRecord>;
  listDraftReferences(brandId: string, assetType: AiContentDraftReference["assetType"], assetId: string, signal?: AbortSignal): Promise<AiContentDraftReference[]>;
}
