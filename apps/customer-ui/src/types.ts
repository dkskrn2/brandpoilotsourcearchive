export type BadgeVariant = "neutral" | "info" | "ok" | "warn" | "bad" | "auto";

export type ChannelType = "instagram" | "threads" | "tiktok" | "youtube" | "x";

export type InstagramDeliveryFormat =
  | "instagram_feed_carousel"
  | "instagram_story"
  | "instagram_reel";

export type DeliveryFormat =
  | InstagramDeliveryFormat
  | "threads_text"
  | "tiktok_video"
  | "youtube_video"
  | "x_post";

export type InstagramCapabilityStatus = "available" | "unavailable" | "unchecked" | "needs_attention";
export type ContentSourceMode = "direct_url" | "topic_only" | "url_unavailable";

export type ChannelStatus =
  | "connected"
  | "not_connected"
  | "needs_attention"
  | "expired"
  | "insufficient_permissions"
  | "mapping_required"
  | "publish_failed";

export type ReviewStatus =
  | "pending_review"
  | "approved"
  | "auto_approved"
  | "auto_approval_blocked"
  | "regenerating"
  | "rejected";

export type OnboardingStatus = "completed" | "needs_attention" | "pending";
export type SupportRequestCategory = "bug" | "feature" | "channel" | "account" | "other";
export type SupportRequestStatus = "new" | "in_progress" | "resolved";

export interface BrandOnboardingStep {
  id: string;
  title: string;
  description: string;
  actionLabel: string;
  path?: string;
  status: OnboardingStatus;
}

export interface BrandUiStatus {
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
    steps: BrandOnboardingStep[];
  };
}

export interface NavItem {
  label: string;
  path: string;
  badge?: string;
  status?: BadgeVariant;
}

export interface BrandProfile {
  name: string;
  industry: string;
  primaryCustomer: string;
  description: string;
  tone: string;
  defaultCta: string;
  mainLink: string;
  autoApprovalEnabled: boolean;
}

export interface BrandContentFormat {
  format: InstagramDeliveryFormat;
  enabled: boolean;
  rotationOrder: number;
  capabilityStatus: InstagramCapabilityStatus;
  capabilityCheckedAt: string | null;
  capabilityMetadata: Record<string, unknown>;
  lastError: string | null;
}

export interface InstagramFormatSettings {
  brandId: string;
  brandColor: string | null;
  formats: BrandContentFormat[];
}

export interface InstagramFormatSettingsInput {
  brandColor?: string | null;
  formats?: Array<{
    format: InstagramDeliveryFormat;
    enabled: boolean;
  }>;
}

export interface ChannelConnection {
  type: ChannelType;
  label: string;
  status: ChannelStatus;
  accountLabel: string;
  lastHealthyAt: string;
  lastPublishedAt: string;
  alertTitle?: string;
  alertBody?: string;
}

export interface KnowledgeImport {
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

export interface InstagramDmSettings {
  brandId: string;
  enabled: boolean;
  fallbackMessage: string;
  errorMessage: string;
  wikiReady: boolean;
  messagePermissionReady: boolean;
  webhookStatus: "connected" | "needs_attention" | "unchecked";
  workerStatus: "online" | "worker_offline" | "unknown";
}

export interface InstagramDmHistory {
  id: string;
  direction: "inbound" | "outbound";
  messageType: string;
  body: string | null;
  decision: string | null;
  createdAt: string;
}

export interface ChannelConnectionRequest {
  id: string | null;
  brandId: string;
  status: "draft" | "submitted" | "in_review" | "needs_attention" | "connected" | string;
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

export interface SupportRequest {
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

export interface BillingSummary {
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

export interface ContentImageAsset {
  url: string;
  index?: number;
  role?: string;
  width?: number;
  height?: number;
  mimeType?: string;
}

export interface ContentVideoAsset {
  url: string;
  durationSeconds?: number | null;
  width?: number;
  height?: number;
  mimeType?: string;
}

export interface ContentOutputJson extends Record<string, unknown> {
  deliveryFormat?: DeliveryFormat;
  sourceMode?: ContentSourceMode;
  cards?: ContentImageAsset[];
  story?: ContentImageAsset;
  scenes?: ContentImageAsset[];
  cover?: ContentImageAsset;
  video?: ContentVideoAsset;
}

export interface ContentOutput {
  id: string;
  contentId: string;
  title: string;
  channel: ChannelType;
  deliveryFormat?: DeliveryFormat;
  sourceMode?: ContentSourceMode | null;
  status: ReviewStatus;
  topicId: string;
  generatedAt: string;
  sourceSummary: string;
  previewTitle: string;
  previewBody: string;
  previewImageUrl?: string | null;
  previewVideoUrl?: string | null;
  previewPosterUrl?: string | null;
  durationSeconds?: number | null;
  outputJson?: ContentOutputJson;
  blockReasons?: string[];
}

export interface SourceUrl {
  id: string;
  brandId: string;
  sourceType: "owned" | "reference";
  url: string;
  title: string | null;
  status: string;
  enabled: boolean;
  lastCrawledAt: string | null;
  lastError: string | null;
}

export interface SourceSnapshot {
  id: string;
  sourceUrlId: string;
  contentItemId?: string | null;
  sourceType: "owned" | "reference";
  url: string;
  title: string | null;
  status: "succeeded" | "failed" | string;
  fetchedAt: string;
  summary: string | null;
  errorMessage: string | null;
}

export interface SourceCrawlRun extends PipelineRunResult {
  id: string;
  brandId: string;
  sourceUrlId: string;
  trigger: "new_source" | "scheduled" | "manual" | "retry";
  status: "queued" | "running" | "succeeded" | "partial" | "failed" | "abandoned";
  attempt: number;
  startedAt: string | null;
  finishedAt: string | null;
  nextRetryAt: string | null;
  lastError: string | null;
}

export interface SourceCreateResult {
  source: SourceUrl;
  initialCrawl: SourceCrawlRun;
}

export interface PublishSlot {
  id: string;
  channel: ChannelType;
  time: string;
  title: string;
  approvalType: "manual" | "auto" | "empty";
  status: "queued" | "scheduled" | "publishing" | "published" | "failed" | "deferred" | "cancelled" | "empty";
  sourceType: "topic_table" | "source_url" | "mixed" | "unknown";
  sourceLabel: string;
  sourceDetail: string | null;
  sourceUrls: string[];
  queuedAt: string;
  lastError: string | null;
  renderStatus?: string | null;
  topicPublishGroupId?: string | null;
  slotDate?: string | null;
  slotNumber?: number | null;
  scheduledFor?: string | null;
}

export interface PublishResultChannel {
  queueId: string;
  channelOutputId: string;
  channel: ChannelType;
  status: "queued" | "scheduled" | "publishing" | "published" | "failed" | "deferred" | "cancelled";
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

export interface PublishResult {
  contentId: string;
  title: string;
  generatedAt: string;
  sourceType: "topic_table" | "source_url" | "mixed" | "unknown";
  sourceLabel: string;
  sourceDetail: string | null;
  sourceUrls: string[];
  channels: PublishResultChannel[];
}

export interface TopicUploadSummary {
  id: string;
  fileName: string;
  status: string;
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  invalidRows: number;
}

export interface TopicRow {
  id: string;
  uploadId: string;
  rowNumber: number;
  status: "uploaded" | "queued" | "used" | "skipped" | "invalid" | "failed" | "disabled";
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
}
