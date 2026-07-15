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
export type DmDecision = "answer" | "fallback" | "ignore" | "error";
export type DmReasonCode =
  | "direct_faq"
  | "wiki_answer"
  | "restricted_action"
  | "complaint"
  | "knowledge_gap"
  | "low_confidence"
  | "processing_error"
  | "system_event";
export type DmAttentionType =
  | "restricted_action"
  | "complaint"
  | "knowledge_gap"
  | "delivery_unknown"
  | "processing_error";
export type DmJobRoute = "fixed_fallback" | "knowledge" | "ignore";

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
  id: string;
  brandId: string;
  name: string;
  primaryCategory: BrandPrimaryCategory | null;
  subcategories: BrandSubcategory[];
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
  primaryCategoryCode?: string;
  subcategories?: BrandSubcategoryInput[];
  primaryCustomer?: string;
  description?: string;
  tone?: string;
  defaultCta?: string;
  mainLink?: string;
  autoApprovalEnabled?: boolean;
}

export interface BrandSubcategory {
  type: "system" | "custom";
  code: string | null;
  name: string;
}

export type BrandSubcategoryInput =
  | { type: "system"; code: string }
  | { type: "custom"; name: string };

export interface BrandPrimaryCategory {
  code: string;
  name: string;
}

export interface ContentCategory {
  code: string;
  name: string;
  recommendedHashtags: string[];
  subcategories: Array<{ code: string; name: string }>;
}

export type InstagramTrendMediaKind = "reel" | "video" | "image" | "carousel";
export type InstagramTrendSort = "meta" | "likes" | "comments";
export type InstagramTrendMediaTypeFilter = "all" | InstagramTrendMediaKind;

export interface InstagramTrendMedia {
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

export interface InstagramTrendPage {
  hashtag: { id: string; displayTag: string; normalizedTag: string };
  source: "cache" | "meta";
  refreshed: boolean;
  refreshedAt: string | null;
  lastErrorCode: string | null;
  page: number;
  pageSize: 20;
  total: number;
  items: InstagramTrendMedia[];
}

export interface InstagramTrendSearchHistory {
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

export interface InstagramTrendSaveSource {
  source: SourceUrl;
  alreadySaved: boolean;
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
  decision: DmDecision | null;
  createdAt: string;
}

export type DmConversationFilter = "all" | "attention" | "complaint" | "unanswered" | "error";
export type DmAutomationStatus = "active" | "paused";
export type DmAttentionStatus = "none" | "open" | "resolved";

export interface DmParticipant {
  instagramScopedId: string;
  displayName: string | null;
  username: string | null;
  profileImageUrl: string | null;
}

export interface DmConversationSummary {
  id: string;
  participant: DmParticipant;
  lastMessage: {
    body: string | null;
    direction: "inbound" | "outbound";
    createdAt: string;
  } | null;
  automationStatus: DmAutomationStatus;
  attentionStatus: DmAttentionStatus;
  openAttentionTypes: DmAttentionType[];
  unreadCount: number;
}

export interface DmConversationPage {
  items: DmConversationSummary[];
  nextCursor: string | null;
}

export interface DmConversationMessage {
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

export interface DmAttentionItem {
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

export interface DmConversationDetail extends DmConversationSummary {
  messages: DmConversationMessage[];
  attentionItems: DmAttentionItem[];
}

export interface WikiVersionSummary {
  id: string;
  status: "building" | "active" | "failed";
  version: number | string;
  sourceCount: number;
  documentCount: number;
  knowledgeEntryCount: number;
  chunkCount: number;
  activatedAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
}

export interface WikiStatus {
  activeVersion: WikiVersionSummary | null;
  latestFailedVersion: WikiVersionSummary | null;
  importStats: {
    total: number;
    succeeded: number;
    failed: number;
    faqRows: number;
    productRows: number;
  };
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

export type PublishArtifactKind = "image_gallery" | "image" | "video" | "html" | "text" | "unknown";

export interface PublishArtifactAsset {
  url: string;
  fileName: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
}

export interface PublishArtifact {
  queueId: string;
  kind: PublishArtifactKind;
  deliveryFormat: string | null;
  assets: PublishArtifactAsset[];
  posterUrl: string | null;
  html: string | null;
  text: string | null;
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
