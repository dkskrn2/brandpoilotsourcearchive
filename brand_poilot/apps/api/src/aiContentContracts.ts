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
export type AiContentAssetRole = "slide" | "cover" | "inline" | "html" | "creative";

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
  return {
    type: source.type as AiContentType,
    title: requiredString(source.title, "ai_content_title_invalid", 200),
    draft: inputObject(source.draft, "ai_content_draft_invalid"),
    idempotencyKey: requiredString(source.idempotencyKey, "ai_content_idempotency_key_invalid", 200),
  };
}

export function parseUpdateAiContentDraftInput(value: unknown): UpdateAiContentDraftInput {
  const source = inputObject(value);
  if (!Array.isArray(source.referenceIds) || source.referenceIds.some((id) => typeof id !== "string" || !id.trim())) {
    fail("ai_content_reference_ids_invalid");
  }
  return {
    draft: inputObject(source.draft, "ai_content_draft_invalid"),
    referenceIds: source.referenceIds.map((id) => String(id).trim()),
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
