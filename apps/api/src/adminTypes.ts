export type AdminBrandStatus = "active" | "paused" | "disabled";

export interface AdminPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface AdminOverviewDto {
  generatedAt: string;
  brands: { active: number; paused: number; disabled: number };
  channels: { connected: number; needsAttention: number };
  generation24h: { succeeded: number; failed: number };
  publishing: { pendingReview: number; scheduled: number; publishing: number; failed: number };
  dm24h: { received: number; replied: number; fallback: number; failed: number };
  wiki24h: { succeeded: number; failed: number };
  workers: { online: number; stale: number };
  recentErrors: Array<{ source: string; id: string; code: string; occurredAt: string }>;
}

export interface AdminBrandListItemDto {
  id: string;
  workspaceId: string;
  workspaceName: string;
  name: string;
  status: AdminBrandStatus;
  createdAt: string;
  lastActivityAt: string | null;
  owner: { displayName: string | null; email: string | null };
  category: { primary: { code: string; name: string } | null; subcategories: string[] };
  onboardingCompleted: boolean;
  connectedChannelCount: number;
  dmEnabled: boolean;
}

export interface AdminBrandDetailDto extends AdminBrandListItemDto {
  profile: {
    primaryCustomer: string | null;
    description: string | null;
    tone: string | null;
    defaultCta: string | null;
    mainLink: string | null;
    autoApprovalEnabled: boolean;
  };
  ownedSource: { id: string; url: string; status: string; lastCrawledAt: string | null } | null;
  aiContentUsageToday: { generationCount: number; downloadCount: number };
}

export interface AdminChannelListItemDto {
  id: string;
  brandId: string;
  brandName: string;
  channel: string;
  enabled: boolean;
  status: string;
  authMode: string | null;
  accountLabel: string | null;
  externalAccountIdMasked: string | null;
  scopes: string[];
  expiresAt: string | null;
  lastHealthyAt: string | null;
  lastPublishedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}

export interface AdminFeedbackListItemDto {
  id: string;
  workspaceId: string;
  workspaceName: string;
  brandId: string;
  brandName: string;
  message: string;
  status: "new" | "reviewed" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface AdminSupportRequestListItemDto {
  id: string;
  workspaceId: string;
  workspaceName: string;
  brandId: string;
  brandName: string;
  category: "bug" | "feature" | "channel" | "account" | "other";
  title: string;
  message: string;
  contactPhone: string | null;
  contactEmail: string | null;
  status: "new" | "in_progress" | "resolved";
  responseMessage: string | null;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminWorkerDto {
  workerId: string;
  workerType: string;
  status: "online" | "stale" | "offline";
  lastHeartbeatAt: string;
  metadata: Record<string, unknown>;
}

export interface AdminSystemHealthDto {
  database: "ok";
  checkedAt: string;
  queueCounts: Record<string, number>;
  workers: AdminWorkerDto[];
  leases: Array<{ resourceType: string; workloadType: string; workerId: string; expiresAt: string }>;
  schedulers: Array<{ type: string; status: string; startedAt: string; finishedAt: string | null }>;
}

export interface AdminAuditEventDto {
  id: string;
  createdAt: string;
  actorType: string;
  actorId: string | null;
  eventType: string;
  brandId: string | null;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  requestId: string | null;
  idempotencyKey: string | null;
}

export interface AdminPublishingListItemDto {
  id: string;
  brandId: string;
  brandName: string;
  contentTitle: string;
  topicTitle: string | null;
  channel: string;
  deliveryFormat: string | null;
  outputStatus: string;
  queueStatus: string;
  approvalType: string;
  scheduledFor: string | null;
  publishedAt: string | null;
  queuedAt: string;
  createdAt: string;
  lastError: string | null;
  attemptCount: number;
  externalUrl: string | null;
  artifact: { publicUrl: string; mimeType: string | null } | null;
  canRetry: boolean;
  canCancel: boolean;
}

export interface AdminPublishingDetailDto extends AdminPublishingListItemDto {
  workspaceId: string;
  channelOutputId: string;
  previewTitle: string | null;
  previewBody: string | null;
  sourceSummary: string | null;
  output: Record<string, unknown>;
  blockReasons: unknown[];
  failedAt: string | null;
  topic: {
    title: string | null;
    angle: string | null;
    referenceUrl: string | null;
    sourceUrls: string[];
  };
  artifact: {
    id: string;
    type: string;
    publicUrl: string;
    mimeType: string | null;
    byteSize: number | null;
  } | null;
  attempts: Array<{
    id: string;
    attemptNumber: number;
    status: string;
    responseMetadata: Record<string, unknown>;
    externalPostId: string | null;
    externalUrl: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    startedAt: string;
    finishedAt: string | null;
  }>;
  reviews: Array<{
    id: string;
    eventType: string;
    actorType: string;
    reason: string | null;
    createdAt: string;
  }>;
}

export interface AdminListInput {
  q?: string;
  status?: string;
  brandId?: string;
  channel?: string;
  cursor?: string;
  limit: number;
}

export interface AdminRepository {
  getOverview(): Promise<AdminOverviewDto>;
  listBrands(input: AdminListInput): Promise<AdminPage<AdminBrandListItemDto>>;
  getBrand(brandId: string): Promise<AdminBrandDetailDto | null>;
  listChannels(input: AdminListInput): Promise<AdminPage<AdminChannelListItemDto>>;
  listFeedback(input: AdminListInput): Promise<AdminPage<AdminFeedbackListItemDto>>;
  listSupportRequests(input: AdminListInput): Promise<AdminPage<AdminSupportRequestListItemDto>>;
  listPublishing(input: AdminListInput): Promise<AdminPage<AdminPublishingListItemDto>>;
  getPublishing(queueId: string): Promise<AdminPublishingDetailDto | null>;
  updatePublishingStatus(input: {
    queueId: string;
    action: "retry" | "cancel";
    reason: string;
    actorId: string;
    requestId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<{ id: string; status: string; updatedAt: string; replayed: boolean }>;
  getSystemHealth(): Promise<AdminSystemHealthDto>;
  listAuditEvents(input: AdminListInput): Promise<AdminPage<AdminAuditEventDto>>;
  updateBrandStatus(input: {
    brandId: string;
    status: "active" | "paused";
    reason: string;
    actorId: string;
    requestId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<{ id: string; status: "active" | "paused"; updatedAt: string; replayed: boolean }>;
}
