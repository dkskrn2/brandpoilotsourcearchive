import type { DeliveryFormat, InstagramDeliveryFormat } from "./instagramFormats.js";

export type {
  DeliveryFormat,
  InstagramDeliveryFormat,
  InstagramPromptVersion,
  InstagramRenderJobType
} from "./instagramFormats.js";

export type Channel = "instagram" | "threads" | "tiktok" | "youtube" | "x";
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
  enabled: boolean;
  fallbackMessage: string;
  errorMessage: string;
  webhookStatus: "connected" | "needs_attention" | "unchecked";
  workerStatus: DmWorkerStatus;
}

export interface KnowledgeImportDto {
  id: string;
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
  industry: string;
  primaryCustomer: string;
  description: string;
  tone: string;
  defaultCta: string;
  mainLink: string;
  autoApprovalEnabled: boolean;
}

export interface BrandProfileInput {
  name?: string;
  industry?: string;
  primaryCustomer?: string;
  description?: string;
  tone?: string;
  defaultCta?: string;
  mainLink?: string;
  autoApprovalEnabled?: boolean;
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

export interface ChannelDto {
  channel: Channel;
  status: string;
  accountLabel: string | null;
  lastHealthyAt: string | null;
  lastPublishedAt: string | null;
  lastError: string | null;
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
  contactEmail: string | null;
  status: SupportRequestStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SupportRequestInput {
  category: SupportRequestCategory;
  title: string;
  message: string;
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

export interface ContentOutputDto {
  id: string;
  contentId: string;
  title: string;
  channel: Channel;
  deliveryFormat: DeliveryFormat;
  status: string;
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
      deliveryFormat: "youtube_video";
    })
  | (TopicPublishGroupOutputBaseDto & {
      channel: "x";
      deliveryFormat: "x_post";
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
  industry: string | null;
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

export interface ApiRepository {
  health(): Promise<{ database: "ok" }>;
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
  getChannelConnectionRequest(brandId: string): Promise<ChannelConnectionRequestDto>;
  updateChannelConnectionRequest(brandId: string, input: ChannelConnectionRequestInput): Promise<ChannelConnectionRequestDto>;
  saveChannelCredentials(brandId: string, channel: Channel, input: CredentialInput): Promise<ChannelDto>;
  checkChannel(brandId: string, channel: Channel): Promise<ChannelDto>;
  createSupportRequest(brandId: string, input: SupportRequestInput): Promise<SupportRequestDto>;
  listSupportRequests(brandId: string): Promise<SupportRequestDto[]>;
  updateSupportRequestStatus(requestId: string, status: SupportRequestStatus): Promise<SupportRequestDto>;
  listContentOutputs(brandId: string): Promise<ContentOutputDto[]>;
  reviewContentOutput(outputId: string, action: "approve" | "reject" | "regenerate", reason?: string): Promise<{ id: string; status: string }>;
  listPublishQueue(brandId: string): Promise<PublishQueueDto[]>;
  listPublishResults(brandId: string): Promise<PublishResultDto[]>;
  downloadPublishedResults(brandId: string): Promise<DownloadPackageDto>;
  createTopicUpload(brandId: string, input: TopicUploadInput): Promise<TopicUploadDto>;
  createKnowledgeImport(brandId: string, input: KnowledgeImportInput): Promise<KnowledgeImportDto>;
  listKnowledgeImports(brandId: string): Promise<KnowledgeImportDto[]>;
  enqueueWikiRefresh(brandId: string): Promise<{ id: string; status: string }>;
  listTopicRows(brandId: string, status?: string): Promise<TopicRowDto[]>;
  crawlSources(brandId: string): Promise<PipelineRunResult>;
  crawlSingleSource(brandId: string, sourceId: string, trigger: SourceCrawlTrigger): Promise<SourceCrawlRunDto>;
  crawlDueSources(now?: Date): Promise<AutomaticCrawlResult>;
  listSourceCrawlRuns(brandId: string): Promise<SourceCrawlRunDto[]>;
  generateContent(brandId: string, now?: Date): Promise<PipelineRunResult>;
  runDailyGeneration(now?: Date): Promise<DailyGenerationRunResult>;
  schedulePublishQueue(brandId: string, now?: Date): Promise<PipelineRunResult>;
  runDuePublishing(now?: Date): Promise<PipelineRunResult>;
  publishQueueItem(queueId: string): Promise<{ id: string; status: string; publishedUrl: string | null }>;
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
}
