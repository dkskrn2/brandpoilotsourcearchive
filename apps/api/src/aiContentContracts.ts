export type AiContentType = "card_news" | "blog" | "marketing";
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
export type AiContentAssetRole = "slide" | "cover" | "html" | "creative";

export interface AiContentAsset {
  role: AiContentAssetRole;
  url: string;
  fileName: string;
  mimeType: "image/png" | "text/html";
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
}

export type CardNewsManifest = AiContentManifestBase<"card_news", CardNewsContent>;
export type BlogManifest = AiContentManifestBase<"blog", BlogContent>;
export type MarketingManifest = AiContentManifestBase<"marketing", MarketingContent>;
export type AiContentManifest = CardNewsManifest | BlogManifest | MarketingManifest;

export interface CreateAiContentAnalysisInput {
  type: AiContentType;
  title: string;
  draft: Record<string, unknown>;
  idempotencyKey: string;
}

export interface UpdateAiContentDraftInput {
  draft: Record<string, unknown>;
  referenceIds: string[];
}

export interface StartAiContentGenerationInput {
  idempotencyKey: string;
  outputCount: 1 | 2 | 3;
}

export type AiContentAttachmentRole = "product" | "person" | "scale" | "visual_reference" | "document";

export interface AttachmentUploadTokenInput {
  role: AiContentAttachmentRole;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
}

export interface ConfirmAttachmentInput extends AttachmentUploadTokenInput {
  storageUrl: string;
  storagePath: string;
}

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

export type CompleteAiContentJobInput =
  | CompleteAiContentAnalysisJobInput
  | CompleteAiContentGenerationJobInput;

export interface FailAiContentJobInput {
  jobId: string;
  workerId: string;
  leaseToken: string;
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
}
