import type { InstagramDeliveryFormat } from "./instagramFormats.js";
import type { DmAttentionType, DmDecision, DmJobRoute, DmReasonCode } from "./dmTypes.js";
import type {
  AiContentGenerationRecord,
  AiContentJobRecord,
  AiContentAttachmentRecord,
  AiContentReferenceRecord,
  AiContentUsageRecord,
  AiContentBrandContextRecord,
  AppealRecord,
  AudienceRecord,
  BrandGenerationScope,
  BrandScope,
  SaveAppealInput,
  SaveAudienceInput,
  SubjectAnalysisBrandContext,
  SubjectAnalysisWorkerLease,
} from "./aiContentRepository.js";
import type { LoadSubjectEvidenceInput, SubjectEvidenceAttachment } from "./aiContentSubjectEvidence.js";
import type {
  AiContentType,
  CompleteAiContentJobInput,
  CreateAiContentAnalysisInput,
  FailAiContentJobInput,
  StartAiContentGenerationInput,
  UpdateAiContentDraftInput,
} from "./aiContentContracts.js";
import type {
  SubjectAnalysisRecord,
  SubjectAnalysisRepository,
  SubjectBrandScope,
} from "./aiContentSubjectRepository.js";
import type {
  CreateSubjectAnalysisInput,
  CreateSubjectPipelineInput,
} from "./aiContentSubjectContracts.js";

export type {
  InstagramDeliveryFormat,
  InstagramPromptVersion,
  InstagramRenderJobType
} from "./instagramFormats.js";
export type { DmAttentionType, DmDecision, DmJobRoute, DmReasonCode } from "./dmTypes.js";

export type DeliveryFormat =
  | InstagramDeliveryFormat
  | "instagram_feed_single"
  | "threads_text"
  | "tiktok_video"
  | "youtube_video"
  | "youtube_short"
  | "x_post"
  | "linkedin_post";
export type Channel = "instagram" | "threads" | "x" | "linkedin" | "youtube" | "tiktok";
export type ChannelOAuthState = "connected" | "not_connected" | "needs_attention";
export type ChannelStatus =
  | "not_connected"
  | "connected"
  | "needs_attention"
  | "expired"
  | "insufficient_permissions"
  | "mapping_required"
  | "publish_failed";
export type SourceType = "owned" | "reference";
export type SupportRequestCategory = "bug" | "feature" | "channel" | "account" | "other";
export type SupportRequestStatus = "new" | "in_progress" | "resolved";

export type DmWorkerStatus = "online" | "worker_offline" | "unknown";

export interface InstagramDmSettingsDto {
  brandId: string;
  enabled: boolean;
  fallbackMessage: string;
  errorMessage: string;
  wikiReady: boolean;
  messagePermissionReady: boolean;
  webhookStatus: "connected" | "needs_attention" | "unchecked";
  workerStatus: DmWorkerStatus;
}

export interface KnowledgeImportDto {
  id: string;
  entryType: "faq" | "product";
  fileName: string;
  status: "processing" | "succeeded" | "failed";
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  invalidRows: number;
  updatedRows: number;
  createdAt: string;
}

export interface KnowledgeImportInput {
  entryType?: "faq" | "product";
  fileName: string;
  fileBase64: string;
}

export interface DmConversationMessageDto {
  id: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  messageType: "text" | "unsupported_media" | "system";
  body: string | null;
  createdAt: string;
}

export interface BrandProfileDto {
  id: string;
  brandId: string;
  name: string;
  primaryCategory: BrandPrimaryCategoryDto | null;
  subcategories: BrandSubcategoryDto[];
  primaryCustomer: string;
  description: string;
  tone: string;
  defaultCta: string;
  mainLink: string;
  autoApprovalEnabled: boolean;
  logoUrl: string | null;
}

export interface BrandProfileInput {
  name?: string;
  primaryCategoryCode?: string | null;
  subcategories?: BrandSubcategoryInput[];
  primaryCustomer?: string;
  description?: string;
  tone?: string;
  defaultCta?: string;
  mainLink?: string;
  autoApprovalEnabled?: boolean;
}

export interface BrandSubcategoryDto {
  type: "system" | "custom";
  code: string | null;
  name: string;
}

export type BrandSubcategoryInput =
  | { type: "system"; code: string }
  | { type: "custom"; name: string };

export interface BrandPrimaryCategoryDto {
  code: string;
  name: string;
}

export interface ContentCategoryDto {
  code: string;
  name: string;
  recommendedHashtags: string[];
  subcategories: Array<{ code: string; name: string }>;
}

export type InstagramTrendMediaKind = "reel" | "video" | "image" | "carousel";
export type InstagramTrendSort = "meta" | "likes" | "comments";
export type InstagramTrendMediaTypeFilter = "all" | InstagramTrendMediaKind;

export interface InstagramTrendMediaDto {
  id: string;
  instagramMediaId: string;
  username: string | null;
  caption: string | null;
  kind: InstagramTrendMediaKind;
  mediaUrl: string | null;
  previewUrl: string | null;
  permalink: string;
  postedAt: string | null;
  likeCount: number | null;
  commentsCount: number | null;
  metaRank: number;
  refreshedAt: string;
  isSaved: boolean;
}

export interface InstagramTrendPageDto {
  hashtag: { id: string; displayTag: string; normalizedTag: string };
  source: "cache" | "meta";
  refreshed: boolean;
  refreshedAt: string | null;
  lastErrorCode: string | null;
  page: number;
  pageSize: 20;
  total: number;
  items: InstagramTrendMediaDto[];
}

export interface InstagramTrendSearchHistoryDto {
  hashtagId: string;
  displayTag: string;
  isFavorite: boolean;
  lastSearchedAt: string;
  searchCount: number;
}

export interface InstagramTrendListInput {
  hashtag: string;
  type: InstagramTrendMediaTypeFilter;
  sort: InstagramTrendSort;
  page: number;
}

export interface InstagramTrendSearchInput {
  hashtag: string;
}

export interface InstagramTrendFavoriteInput {
  isFavorite: boolean;
}

export interface InstagramTrendSaveSourceDto {
  source: SourceDto;
  alreadySaved: boolean;
}

export interface InstagramTrendConnectionDto {
  status: "connected" | "not_connected" | "needs_attention" | "expired";
  accountLabel: string | null;
  instagramBusinessAccountId: string | null;
  scopes: string[];
  expiresAt: string | null;
  lastErrorCode: string | null;
}

export interface InstagramTrendCredentialInput {
  accountLabel: string | null;
  accessToken: string;
  expiresAt: string | null;
  facebookPageId: string | null;
  instagramBusinessAccountId: string;
  maskedDisplay: string;
  scopes: string[];
}

export type InstagramCapabilityStatus =
  | "available"
  | "unavailable"
  | "unchecked"
  | "needs_attention";

export interface BrandContentFormatDto {
  format: InstagramDeliveryFormat;
  enabled: boolean;
  rotationOrder: number;
  capabilityStatus: InstagramCapabilityStatus;
  capabilityCheckedAt: string | null;
  capabilityMetadata: Record<string, unknown>;
  lastError: string | null;
}

export interface InstagramFormatSettingsDto {
  brandId: string;
  brandColor: string | null;
  formats: BrandContentFormatDto[];
}

export interface InstagramFormatSettingsInput {
  brandColor?: string | null;
  formats?: Array<{
    format: InstagramDeliveryFormat;
    enabled: boolean;
  }>;
}

export type OnboardingStatus = "completed" | "needs_attention" | "pending";

export interface OnboardingStepDto {
  id: string;
  title: string;
  description: string;
  actionLabel: string;
  path?: string;
  status: OnboardingStatus;
}

export interface BrandUiStatusDto {
  brandId: string;
  brandName: string;
  logoUrl: string | null;
  lastGeneratedAt: string | null;
  navigation: {
    onboardingRemaining: number;
    contentReview: number;
    publishIssues: number;
    channelIssues: number;
  };
  onboarding: {
    completedCount: number;
    totalCount: number;
    remainingCount: number;
    steps: OnboardingStepDto[];
  };
}

export interface SourceDto {
  id: string;
  brandId: string;
  sourceType: SourceType;
  url: string;
  title: string | null;
  status: string;
  enabled: boolean;
  lastCrawledAt: string | null;
  lastError: string | null;
}

export interface SourceSnapshotDto {
  id: string;
  sourceUrlId: string;
  contentItemId?: string | null;
  sourceType: SourceType;
  url: string;
  title: string | null;
  status: string;
  fetchedAt: string;
  summary: string | null;
  errorMessage: string | null;
}

export interface SourceInput {
  sourceType: SourceType;
  url: string;
}

export interface SourceUpdateInput {
  sourceType?: SourceType;
  url?: string;
  enabled?: boolean;
}

export interface ChannelStateDto {
  channel: Channel;
  status: string;
  accountLabel: string | null;
  lastHealthyAt: string | null;
  lastPublishedAt: string | null;
  lastError: string | null;
}

export interface ChannelDto extends ChannelStateDto {
  enabled: boolean;
  oauthState: ChannelOAuthState;
  status: ChannelStatus;
}

export type PerformanceSyncStatus = "completed" | "partially_failed" | "failed" | "not_configured";

export interface PerformanceSyncSummaryDto {
  runDate: string;
  status: PerformanceSyncStatus | "not_due";
  channelsSelected: number;
  runsStarted: number;
  targetCount: number;
  successCount: number;
  failureCount: number;
}

export interface DashboardDto {
  period: "30d";
  generatedAt: string;
  lastCollectedAt: string | null;
  summary: {
    publishedCount: number;
    exposureCount: number | null;
    pendingReviewCount: number;
    failedPublishCount: number;
  };
  workflow: {
    queuedTopics: number;
    generating: number;
    pendingReview: number;
    scheduledOrPublished: number;
  };
  dailyExposure: Array<{ date: string; channels: Partial<Record<Channel, number>> }>;
  channelPerformance: Array<{
    channel: Channel;
    connectionStatus: ChannelStatus;
    publishedCount: number;
    exposureCount: number | null;
    lastCollectedAt: string | null;
    syncStatus: PerformanceSyncStatus | "running" | null;
  }>;
  topContents: Array<{
    publishQueueId: string;
    title: string;
    channel: Channel;
    deliveryFormat: DeliveryFormat | null;
    publishedAt: string;
    exposureCount: number | null;
    externalUrl: string | null;
  }>;
  attentionItems: Array<{
    type: "publish_failed" | "channel_error" | "sync_failed" | "stale_sync";
    channel: Channel | null;
    message: string;
  }>;
}

export interface ChannelConnectionRequestDto {
  id: string | null;
  brandId: string;
  status: string;
  instagramHandle: string | null;
  instagramProfileUrl: string | null;
  facebookPageUrl: string | null;
  metaBusinessName: string | null;
  threadsProfileUrl: string | null;
  contactName: string | null;
  contactEmail: string | null;
  hasAdminAccess: boolean;
  requestNote: string | null;
  submittedAt: string | null;
  updatedAt: string | null;
}

export interface ChannelConnectionRequestInput {
  instagramHandle?: string | null;
  instagramProfileUrl?: string | null;
  facebookPageUrl?: string | null;
  metaBusinessName?: string | null;
  threadsProfileUrl?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  hasAdminAccess?: boolean;
  requestNote?: string | null;
  submit?: boolean;
}

export interface SupportRequestDto {
  id: string;
  brandId: string;
  workspaceId: string;
  category: SupportRequestCategory;
  title: string;
  message: string;
  contactPhone: string;
  contactEmail: string | null;
  status: SupportRequestStatus;
  responseMessage: string | null;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupportRequestInput {
  category: SupportRequestCategory;
  title: string;
  message: string;
  contactPhone: string;
  contactEmail?: string | null;
}

export interface BillingSummaryDto {
  configured: boolean;
  subscription: {
    status: "none" | "pending_payment" | "active" | "cancel_scheduled" | "suspended" | "cancelled";
    planName: string | null;
    monthlyAmount: number | null;
    currency: "KRW";
    currentPeriodEnd: string | null;
    nextBillingAt: string | null;
    cancelAtPeriodEnd: boolean;
    suspensionReason: string | null;
  };
  entitlement: {
    active: boolean;
    source: "subscription" | "admin_grant" | null;
    expiresAt: string | null;
  };
  paymentMethod: {
    provider: string;
    label: string;
    last4: string | null;
  } | null;
  payments: Array<{
    id: string;
    orderId: string;
    amount: number;
    status: "approved" | "failed" | "cancelled" | "refunded";
    approvedAt: string | null;
  }>;
}

export interface CredentialInput {
  accountLabel?: string;
  connectionStatus?: ChannelStatus;
  externalAccountId?: string;
  secretValue: string;
  maskedDisplay?: string;
  provider?: "meta";
  credentialType?: "oauth" | "api_token";
  scopes?: string[];
  expiresAt?: string | null;
  authMode?: "facebook_login" | "instagram_login";
}

export type ContentOutputStatus =
  | "generating"
  | "generation_failed"
  | "pending_review"
  | "auto_approval_blocked"
  | "approved"
  | "auto_approved"
  | "rejected"
  | "regenerating"
  | "regenerated";

export interface ContentOutputDto {
  id: string;
  contentId: string;
  title: string;
  channel: Channel;
  deliveryFormat: DeliveryFormat;
  status: ContentOutputStatus;
  previewTitle: string | null;
  previewBody: string | null;
  sourceSummary: string | null;
  outputJson: Record<string, unknown>;
  sourceMode: string | null;
  blockReasons: string[];
  generatedAt: string;
}

export interface PublishQueueDto {
  id: string;
  title: string;
  channel: Channel;
  status: string;
  approvalType: string;
  topicPublishGroupId: string | null;
  slotDate: string | null;
  slotNumber: number | null;
  scheduledFor: string | null;
  lastError: string | null;
  sourceType: "topic_table" | "source_url" | "mixed" | "unknown";
  sourceLabel: string;
  sourceDetail: string | null;
  sourceUrls: string[];
  queuedAt: string;
  renderStatus: string | null;
}

export interface TopicPublishGroupOutputBaseDto {
  id: string;
  queueId: string | null;
  status: string;
  title: string;
  artifactPublicUrl: string | null;
  externalUrl: string | null;
  lastError: string | null;
}

export type TopicPublishGroupOutputDto =
  | (TopicPublishGroupOutputBaseDto & {
      channel: "instagram";
      deliveryFormat: InstagramDeliveryFormat;
    })
  | (TopicPublishGroupOutputBaseDto & {
      channel: "threads";
      deliveryFormat: "threads_text";
    })
  | (TopicPublishGroupOutputBaseDto & {
      channel: "tiktok";
      deliveryFormat: "tiktok_video";
    })
  | (TopicPublishGroupOutputBaseDto & {
      channel: "youtube";
      deliveryFormat: "youtube_video" | "youtube_short";
    })
  | (TopicPublishGroupOutputBaseDto & {
      channel: "x";
      deliveryFormat: "x_post";
    })
  | (TopicPublishGroupOutputBaseDto & {
      channel: "linkedin";
      deliveryFormat: "linkedin_post";
    });

export interface TopicPublishGroupDto {
  id: string;
  brandId: string;
  contentTopicId: string;
  topicTitle: string;
  status: string;
  slotDate: string | null;
  slotNumber: number | null;
  scheduledFor: string | null;
  outputs: TopicPublishGroupOutputDto[];
}

export interface PublishResultChannelDto {
  queueId: string;
  channelOutputId: string;
  channel: Channel;
  status: string;
  publishedAt: string | null;
  failedAt: string | null;
  title: string;
  previewTitle: string | null;
  previewBody: string | null;
  outputJson: Record<string, unknown>;
  artifactPublicUrl: string | null;
  externalPostId: string | null;
  externalUrl: string | null;
  lastError: string | null;
  sourceSummary: string | null;
}

export interface PublishResultDto {
  contentId: string;
  title: string;
  generatedAt: string;
  sourceType: "topic_table" | "source_url" | "mixed" | "unknown";
  sourceLabel: string;
  sourceDetail: string | null;
  sourceUrls: string[];
  channels: PublishResultChannelDto[];
}

export type PublishArtifactKind = "image_gallery" | "image" | "video" | "html" | "text" | "unknown";

export interface PublishArtifactAssetDto {
  url: string;
  fileName: string;
  mimeType: string;
  width: number | null;
  height: number | null;
}

export interface PublishArtifactDescriptorDto {
  kind: PublishArtifactKind;
  deliveryFormat: string | null;
  assets: PublishArtifactAssetDto[];
  posterUrl: string | null;
  html: string | null;
  text: string | null;
}

export interface PublishArtifactDto extends PublishArtifactDescriptorDto {
  queueId: string;
}

export interface DownloadPackageDto {
  fileName: string;
  mimeType: "application/zip";
  buffer: Buffer;
  itemCount: number;
}

export interface TopicUploadInput {
  fileName: string;
  csvText: string;
}

export interface TopicUploadDto {
  id: string;
  fileName: string;
  status: string;
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  invalidRows: number;
}

export interface TopicRowDto {
  id: string;
  uploadId: string;
  rowNumber: number;
  status: string;
  topicTitle: string;
  topicAngle: string;
  targetCustomer: string | null;
  region: string | null;
  season: string | null;
  referenceUrl: string | null;
  priority: number;
  notes: string | null;
  validationErrors: string[];
  createdAt: string;
  usedAt: string | null;
}

export interface PipelineRunResult {
  processed: number;
  created: number;
  updated: number;
  failed: number;
  reason?: "daily_topic_limit" | "no_producible_channel" | "no_usable_topic";
}

export interface DailyGenerationRunResult extends PipelineRunResult {
  brandsSelected: number;
  runsStarted: number;
  status: "succeeded" | "partial" | "failed";
}

export type SourceCrawlTrigger = "new_source" | "scheduled" | "manual" | "retry";
export type SourceCrawlRunStatus = "queued" | "running" | "succeeded" | "partial" | "failed" | "abandoned";

export interface SourceCrawlRunDto extends PipelineRunResult {
  id: string;
  brandId: string;
  sourceUrlId: string;
  trigger: SourceCrawlTrigger;
  status: SourceCrawlRunStatus;
  attempt: number;
  startedAt: string | null;
  finishedAt: string | null;
  nextRetryAt: string | null;
  lastError: string | null;
}

export interface AutomaticCrawlResult extends PipelineRunResult {
  brandsSelected: number;
  runsStarted: number;
  status: "succeeded" | "partial" | "failed";
}

export interface SourceCreateResult {
  source: SourceDto;
  initialCrawl: SourceCrawlRunDto;
}

export interface ImageRenderJobTopicContext {
  title: string;
  angle: string;
  targetCustomer: string | null;
  region: string | null;
  season: string | null;
  notes: string | null;
}

export interface ImageRenderJobBrandContext {
  name: string;
  categoryContext?: string | null;
  primaryCustomer: string | null;
  description: string | null;
  tone: string | null;
  brandColor: string | null;
}

export interface ImageRenderJobPayloadBase extends Record<string, unknown> {
  topic: ImageRenderJobTopicContext;
  brand: ImageRenderJobBrandContext;
  representativeUrl: string | null;
  maxImages: 5;
  jobId?: string;
  channelOutputId?: string;
  brandId?: string;
  channel?: "instagram";
  templateVersion?: string;
  imageSize?: string;
  outputFormat?: string;
  storagePrefix?: string;
  prompt?: string;
}

export interface InstagramFeedRenderJobPayload extends ImageRenderJobPayloadBase {
  deliveryFormat: "instagram_feed_carousel";
  promptVersion: "worker-card.v4";
}

export interface InstagramStoryRenderJobPayload extends ImageRenderJobPayloadBase {
  deliveryFormat: "instagram_story";
  promptVersion: "worker-story.v1";
}

export interface InstagramReelRenderJobPayload extends ImageRenderJobPayloadBase {
  deliveryFormat: "instagram_reel";
  promptVersion: "worker-reel.v3";
}

export type ImageRenderJobPayload =
  | InstagramFeedRenderJobPayload
  | InstagramStoryRenderJobPayload
  | InstagramReelRenderJobPayload;

export interface ImageRenderJobDto {
  id: string;
  workspaceId: string;
  brandId: string;
  channelOutputId: string;
  leaseToken: string;
  payload: ImageRenderJobPayload;
  attemptCount: number;
}

export interface ImageRenderJobCompletionInput {
  workerId: string;
  leaseToken: string;
  manifestUrl: string;
}

export interface TextRenderJobDto {
  id: string;
  workspaceId: string;
  brandId: string;
  channelOutputId: string;
  leaseToken: string;
  payload: import("./textRenderJobs.js").ThreadsRenderJobPayload;
  attemptCount: number;
}

export interface TextRenderJobCompletionInput {
  workerId: string;
  leaseToken: string;
  result: unknown;
}

export interface InstagramWebhookMessageInput {
  recipientId: string;
  senderId: string;
  messageId: string;
  text: string | null;
  isEcho: boolean;
  timestamp: number | null;
  rawPayload: Record<string, unknown>;
}

export type InstagramWebhookReceiveStatus = "unknown_recipient" | "ignored" | "duplicate" | "disabled" | "paused" | "wiki_not_ready" | "rate_limited" | "queued" | "unsupported_media";

export interface InstagramWebhookReceiveResult {
  status: InstagramWebhookReceiveStatus;
  brandId: string | null;
  conversationId: string | null;
  jobId: string | null;
}

export interface DmReplyJobPayload {
  conversationId: string;
  turnId: string;
  senderId: string;
  messageId: string;
  route: DmJobRoute;
  policyReasonCode: DmReasonCode;
  forceAttentionType: DmAttentionType | null;
  question: string;
  exactFaqId?: string | null;
}

export interface DmReplyJobDto {
  id: string;
  workspaceId: string;
  brandId: string;
  leaseToken: string;
  payload: DmReplyJobPayload;
  attemptCount: number;
}

export interface DmReplyJobCompletionInput {
  workerId: string;
  leaseToken: string;
  result: import("./dmTypes.js").DmWorkerResult;
}

export interface DmProfileRefreshJobDto {
  id: string;
  workspaceId: string;
  brandId: string;
  leaseToken: string;
  payload: {
    conversationId: string;
    senderId: string;
  };
  attemptCount: number;
}

export interface DmProfileRefreshJobInput {
  workerId: string;
  leaseToken: string;
}

export interface InstagramDmHistoryDto {
  id: string;
  direction: "inbound" | "outbound";
  messageType: string;
  body: string | null;
  decision: DmDecision | null;
  createdAt: string;
}

export type DmConversationFilter = "all" | "attention" | "complaint" | "unanswered" | "error";

export interface DmParticipantDto {
  instagramScopedId: string;
  displayName: string | null;
  username: string | null;
  profileImageUrl: string | null;
}

export interface DmConversationSummaryDto {
  id: string;
  participant: DmParticipantDto;
  lastMessage: { body: string | null; direction: "inbound" | "outbound"; createdAt: string } | null;
  automationStatus: "active" | "paused";
  attentionStatus: "none" | "open" | "resolved";
  openAttentionTypes: DmAttentionType[];
  unreadCount: number;
}

export interface DmConversationPageDto {
  items: DmConversationSummaryDto[];
  nextCursor: string | null;
}

export interface DmConversationDetailMessageDto {
  id: string;
  direction: "inbound" | "outbound";
  messageType: string;
  body: string | null;
  decision: DmDecision | null;
  reasonCode: DmReasonCode | null;
  sourceLabel: string | null;
  confidence: number | null;
  deliveryStatus: "prepared" | "sending" | "sent" | "unknown" | "failed" | null;
  createdAt: string;
}

export interface DmAttentionItemDto {
  id: string;
  conversationId: string;
  type: DmAttentionType;
  status: "open" | "resolved";
  originalMessage: string | null;
  reason: string | null;
  autoReplyStatus: "sent" | "not_sent" | "unknown" | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface DmConversationDetailDto extends DmConversationSummaryDto {
  messages: DmConversationDetailMessageDto[];
  attentionItems: DmAttentionItemDto[];
}

export interface WikiVersionSummaryDto {
  id: string;
  status: "building" | "ready" | "active" | "failed" | "superseded";
  buildStage?: "collecting" | "compiling" | "embedding" | "validating" | null;
  version: number | string;
  sourceCount: number;
  documentCount: number;
  knowledgeEntryCount: number;
  chunkCount: number;
  activatedAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
}

export interface WikiStatusDto {
  activeVersion: WikiVersionSummaryDto | null;
  currentVersion?: WikiVersionSummaryDto | null;
  latestFailedVersion: WikiVersionSummaryDto | null;
  importStats: { total: number; succeeded: number; failed: number; faqRows: number; productRows: number };
}

export interface SubjectAnalysisRepositoryV2 extends SubjectAnalysisRepository {
  requestSubjectAnalysis(
    input: SubjectBrandScope & CreateSubjectAnalysisInput,
  ): Promise<SubjectAnalysisRecord>;
  requestSubjectAnalysis(
    input: SubjectBrandScope & CreateSubjectPipelineInput,
  ): Promise<SubjectAnalysisRecord>;
  regenerateSubjectAppeals(
    input: SubjectBrandScope & { analysisId: string; idempotencyKey: string },
  ): Promise<SubjectAnalysisRecord>;
}

export interface ApiRepository extends Partial<SubjectAnalysisRepositoryV2> {
  health(): Promise<{ database: "ok" }>;
  getAiContentBrandContext(input: BrandScope): Promise<AiContentBrandContextRecord>;
  getConfirmedSubjectAnalysisBrandContext?(input: BrandScope): Promise<SubjectAnalysisBrandContext>;
  listSubjectEvidenceAttachments?(input: LoadSubjectEvidenceInput): Promise<SubjectEvidenceAttachment[]>;
  getSubjectAnalysisWorkerLease?(input: {
    analysisId: string;
    workerId: string;
    leaseToken: string;
  }): Promise<SubjectAnalysisWorkerLease | null>;
  createAiContentAnalysis(input: BrandScope & CreateAiContentAnalysisInput): Promise<AiContentGenerationRecord>;
  updateAiContentDraft(input: BrandGenerationScope & UpdateAiContentDraftInput): Promise<AiContentGenerationRecord>;
  startAiContentGeneration(input: BrandGenerationScope & StartAiContentGenerationInput & { usageDate: string; dailyGenerationLimit: number }): Promise<AiContentGenerationRecord>;
  listAiContentGenerations(input: BrandScope): Promise<AiContentGenerationRecord[]>;
  getAiContentGeneration(input: BrandGenerationScope): Promise<AiContentGenerationRecord | null>;
  listAiContentUsage(input: BrandScope & { usageDate: string }): Promise<AiContentUsageRecord>;
  listAiContentReferences(input: BrandScope & { type?: AiContentType }): Promise<AiContentReferenceRecord[]>;
  listBrandAudiences(input: BrandScope): Promise<AudienceRecord[]>;
  saveBrandAudience(input: SaveAudienceInput): Promise<AudienceRecord>;
  listBrandAppeals(input: BrandScope): Promise<AppealRecord[]>;
  saveBrandAppeal(input: SaveAppealInput): Promise<AppealRecord>;
  confirmAiContentAttachment(input: BrandGenerationScope & import("./aiContentContracts.js").ConfirmAttachmentInput): Promise<AiContentAttachmentRecord>;
  claimAiContentJob(input: { contentType: AiContentType; workerId: string; leaseSeconds: number }): Promise<AiContentJobRecord | null>;
  heartbeatAiContentJob(input: { jobId: string; workerId: string; leaseToken: string; leaseSeconds: number }): Promise<boolean>;
  completeAiContentJob(input: CompleteAiContentJobInput): Promise<AiContentGenerationRecord>;
  failAiContentJob(input: FailAiContentJobInput): Promise<AiContentGenerationRecord>;
  retryAiContentOutput(input: BrandScope & { outputId: string }): Promise<AiContentGenerationRecord>;
  downloadAiContentOutput(input: BrandScope & { outputId: string; usageDate: string; dailyDownloadLimit: number }): Promise<DownloadPackageDto>;
  downloadAiContentGeneration(input: BrandGenerationScope & { outputIds?: string[]; usageDate: string; dailyDownloadLimit: number }): Promise<DownloadPackageDto>;
  sendAiContentToPublish(input: BrandScope & { outputId: string }): Promise<{ publishGroupId: string; channelOutputId: string }>;
  prepareAiContentPublish(
    input: BrandScope & { outputId: string } & import("./aiContentPublishTargets.js").AiContentPublishRequest,
  ): Promise<import("./aiContentPublish.js").PreparedAiContentPublishResult>;
  getAiContentPublishQueueResult(
    input: BrandScope & { queueId: string },
  ): Promise<import("./aiContentPublish.js").AiContentPublishTargetResult>;
  listContentCategories(): Promise<ContentCategoryDto[]>;
  getInstagramTrendConnection(brandId: string): Promise<InstagramTrendConnectionDto>;
  saveInstagramTrendCredentials(brandId: string, input: InstagramTrendCredentialInput): Promise<InstagramTrendConnectionDto>;
  listInstagramTrends(brandId: string, input: InstagramTrendListInput): Promise<InstagramTrendPageDto>;
  searchInstagramTrends(brandId: string, input: InstagramTrendSearchInput): Promise<InstagramTrendPageDto>;
  listInstagramTrendSearches(brandId: string): Promise<InstagramTrendSearchHistoryDto[]>;
  setInstagramTrendFavorite(brandId: string, hashtagId: string, input: InstagramTrendFavoriteInput): Promise<InstagramTrendSearchHistoryDto>;
  saveInstagramTrendSource(brandId: string, mediaId: string): Promise<InstagramTrendSaveSourceDto>;
  getBillingSummary(brandId: string): Promise<BillingSummaryDto>;
  getBrandUiStatus(brandId: string): Promise<BrandUiStatusDto>;
  getBrandProfile(brandId: string): Promise<BrandProfileDto>;
  updateBrandProfile(brandId: string, input: BrandProfileInput): Promise<BrandProfileDto>;
  listInstagramFormats(brandId: string): Promise<InstagramFormatSettingsDto>;
  updateInstagramFormats(brandId: string, input: InstagramFormatSettingsInput): Promise<InstagramFormatSettingsDto>;
  checkInstagramCapability(brandId: string, format: InstagramDeliveryFormat): Promise<BrandContentFormatDto>;
  listSources(brandId: string): Promise<SourceDto[]>;
  listSourceSnapshots(brandId: string): Promise<SourceSnapshotDto[]>;
  createSource(brandId: string, input: SourceInput): Promise<SourceDto>;
  createSourceWithInitialCrawl(brandId: string, input: SourceInput): Promise<SourceCreateResult>;
  updateSource(sourceId: string, input: SourceUpdateInput): Promise<SourceDto>;
  deleteSource(sourceId: string): Promise<{ id: string }>;
  listChannels(brandId: string): Promise<ChannelDto[]>;
  getInstagramChannelIdentity(brandId: string): Promise<{ externalAccountId: string | null; accountLabel: string | null }>;
  updateChannelEnabled(brandId: string, channel: Channel, enabled: boolean): Promise<ChannelDto>;
  getChannelConnectionRequest(brandId: string): Promise<ChannelConnectionRequestDto>;
  updateChannelConnectionRequest(brandId: string, input: ChannelConnectionRequestInput): Promise<ChannelConnectionRequestDto>;
  saveChannelCredentials(brandId: string, channel: Channel, input: CredentialInput): Promise<ChannelDto>;
  checkChannel(brandId: string, channel: Channel): Promise<ChannelDto>;
  createSupportRequest(brandId: string, input: SupportRequestInput): Promise<SupportRequestDto>;
  listSupportRequests(brandId: string): Promise<SupportRequestDto[]>;
  updateSupportRequestStatus(requestId: string, status: SupportRequestStatus): Promise<SupportRequestDto>;
  respondToSupportRequest(requestId: string, responseMessage: string): Promise<SupportRequestDto>;
  listContentOutputs(brandId: string): Promise<ContentOutputDto[]>;
  reviewContentOutput(outputId: string, action: "approve" | "reject" | "regenerate", reason?: string): Promise<{ id: string; status: string }>;
  listPublishQueue(brandId: string): Promise<PublishQueueDto[]>;
  listPublishResults(brandId: string): Promise<PublishResultDto[]>;
  getContentOutputArtifact(outputId: string): Promise<PublishArtifactDto>;
  getPublishArtifact(queueId: string): Promise<PublishArtifactDto>;
  downloadPublishResult(queueId: string): Promise<DownloadPackageDto>;
  createTopicUpload(brandId: string, input: TopicUploadInput): Promise<TopicUploadDto>;
  createKnowledgeImport(brandId: string, input: KnowledgeImportInput): Promise<KnowledgeImportDto>;
  listKnowledgeImports(brandId: string): Promise<KnowledgeImportDto[]>;
  enqueueWikiRefresh(brandId: string): Promise<{ id: string; status: string }>;
  receiveInstagramWebhookMessage(input: InstagramWebhookMessageInput): Promise<InstagramWebhookReceiveResult>;
  getInstagramDmSettings(brandId: string): Promise<InstagramDmSettingsDto>;
  updateInstagramDmSettings(brandId: string, input: Partial<Pick<InstagramDmSettingsDto, "enabled" | "fallbackMessage" | "errorMessage">>): Promise<InstagramDmSettingsDto>;
  listInstagramDmHistory(brandId: string): Promise<InstagramDmHistoryDto[]>;
  listDmConversations(brandId: string, input: { filter: DmConversationFilter; cursor?: string; limit: number }): Promise<DmConversationPageDto>;
  getDmConversation(brandId: string, conversationId: string): Promise<DmConversationDetailDto>;
  sendManualDmReply(brandId: string, conversationId: string, body: string): Promise<DmConversationDetailMessageDto>;
  listDmAttentionItems(brandId: string, type?: DmAttentionType): Promise<DmAttentionItemDto[]>;
  resolveDmAttentionItem(attentionId: string): Promise<{ conversationId: string; automationStatus: "active"; attentionStatus: "resolved" }>;
  getWikiStatus(brandId: string): Promise<WikiStatusDto>;
  listTopicRows(brandId: string, status?: string): Promise<TopicRowDto[]>;
  crawlSources(brandId: string): Promise<PipelineRunResult>;
  crawlSingleSource(brandId: string, sourceId: string, trigger: SourceCrawlTrigger): Promise<SourceCrawlRunDto>;
  crawlDueSources(now?: Date): Promise<AutomaticCrawlResult>;
  listSourceCrawlRuns(brandId: string): Promise<SourceCrawlRunDto[]>;
  generateContent(brandId: string, now?: Date): Promise<PipelineRunResult>;
  runDailyGeneration(now?: Date): Promise<DailyGenerationRunResult>;
  runDailyPerformanceSync(now?: Date): Promise<PerformanceSyncSummaryDto>;
  getDashboard(brandId: string): Promise<DashboardDto>;
  schedulePublishQueue(brandId: string, now?: Date): Promise<PipelineRunResult>;
  runDuePublishing(now?: Date): Promise<PipelineRunResult>;
  publishQueueItem(queueId: string): Promise<{ id: string; status: string; publishedUrl: string | null }>;
  retryPublishQueueItem(queueId: string): Promise<{ id: string; status: "queued" | "scheduled" }>;
  claimImageRenderJob(workerId: string): Promise<ImageRenderJobDto | null>;
  heartbeatImageRenderJob(jobId: string, workerId: string, leaseToken: string): Promise<{ id: string; status: string }>;
  completeImageRenderJob(jobId: string, input: ImageRenderJobCompletionInput): Promise<{ id: string; status: string; artifactId: string }>;
  failImageRenderJob(jobId: string, input: {
    workerId: string;
    leaseToken: string;
    error: string;
    retryable: boolean;
    retryAfterMs: number;
  }): Promise<{ id: string; status: string }>;
  claimTextRenderJob(workerId: string): Promise<TextRenderJobDto | null>;
  heartbeatTextRenderJob(jobId: string, workerId: string, leaseToken: string): Promise<{ id: string; status: string }>;
  completeTextRenderJob(jobId: string, input: TextRenderJobCompletionInput): Promise<{ id: string; status: string }>;
  failTextRenderJob(jobId: string, input: {
    workerId: string;
    leaseToken: string;
    error: string;
    retryable: boolean;
    retryAfterMs: number;
  }): Promise<{ id: string; status: string }>;
  claimDmReplyJob(workerId: string): Promise<DmReplyJobDto | null>;
  heartbeatDmReplyJob(jobId: string, workerId: string, leaseToken: string): Promise<{ id: string; status: string }>;
  completeDmReplyJob(jobId: string, input: DmReplyJobCompletionInput): Promise<{ id: string; status: string; decision: import("./dmTypes.js").DmDecision }>;
  failDmReplyJob(jobId: string, input: {
    workerId: string;
    leaseToken: string;
    error: string;
    retryable: boolean;
    retryAfterMs: number;
  }): Promise<{ id: string; status: string }>;
  claimDmProfileRefreshJob(workerId: string): Promise<DmProfileRefreshJobDto | null>;
  runDmProfileRefreshJob(jobId: string, input: DmProfileRefreshJobInput): Promise<{ id: string; status: string }>;
  failDmProfileRefreshJob(jobId: string, input: {
    workerId: string;
    leaseToken: string;
    error: string;
    retryable: boolean;
    retryAfterMs: number;
  }): Promise<{ id: string; status: string }>;
  heartbeatDmWorker(workerId: string): Promise<{ workerId: string }>;
  acquireWorkerResourceLease(
    resourceType: import("./workerResources.js").WorkerResourceType,
    workerId: string,
    workload: import("./workerResources.js").WorkerResourceWorkload,
  ): Promise<WorkerResourceLeaseDto | null>;
  heartbeatWorkerResourceLease(id: string, workerId: string, leaseToken: string): Promise<WorkerResourceLeaseDto>;
  releaseWorkerResourceLease(id: string, workerId: string, leaseToken: string): Promise<{ id: string }>;
}

export interface WorkerResourceLeaseDto {
  id: string;
  leaseToken: string;
  expiresAt: string;
}
