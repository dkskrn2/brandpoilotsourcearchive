import "server-only";

import { randomUUID } from "node:crypto";

export type BrandPilotBrandStatus = "active" | "paused" | "disabled";

export interface BrandPilotOverview {
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

export interface BrandPilotBrand {
  id: string;
  workspaceId: string;
  workspaceName: string;
  name: string;
  status: BrandPilotBrandStatus;
  createdAt: string;
  lastActivityAt: string | null;
  owner: { displayName: string | null; email: string | null };
  category: { primary: { code: string; name: string } | null; subcategories: string[] };
  onboardingCompleted: boolean;
  connectedChannelCount: number;
  dmEnabled: boolean;
}

export interface BrandPilotBrandDetail extends BrandPilotBrand {
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

export interface BrandPilotChannel {
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

export interface BrandPilotWorker {
  workerId: string;
  workerType: string;
  status: "online" | "stale" | "offline";
  lastHeartbeatAt: string;
  metadata: Record<string, unknown>;
}

export interface BrandPilotSystemHealth {
  database: "ok";
  checkedAt: string;
  queueCounts: Record<string, number>;
  workers: BrandPilotWorker[];
  leases: Array<{ resourceType: string; workloadType: string; workerId: string; expiresAt: string }>;
  schedulers: Array<{ type: string; status: string; startedAt: string; finishedAt: string | null }>;
}

export interface BrandPilotAuditEvent {
  id: string;
  createdAt: string;
  actorType: string;
  actorId: string | null;
  eventType: string;
  brandId: string | null;
  entityType: string;
  entityId: string | null;
  reason: string | null;
}

export interface BrandPilotPublishingItem {
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

export interface BrandPilotPublishingDetail extends BrandPilotPublishingItem {
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

interface DataEnvelope<T> { data: T; requestId: string }
interface PageEnvelope<T> { data: T[]; page: { nextCursor: string | null; hasMore: boolean }; requestId: string }

export class BrandPilotAdminApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
  }
}

function configuration() {
  const baseUrl = process.env.BRAND_PILOT_ADMIN_API_URL?.trim().replace(/\/$/, "") ?? "";
  const token = process.env.BRAND_PILOT_ADMIN_API_TOKEN?.trim() ?? "";
  if (!baseUrl || !token) throw new BrandPilotAdminApiError("not_configured", "Brand Pilot 관리자 API가 설정되지 않았습니다.", 503);
  return { baseUrl, token };
}

export function isBrandPilotAdminConfigured() {
  return Boolean(process.env.BRAND_PILOT_ADMIN_API_URL?.trim() && process.env.BRAND_PILOT_ADMIN_API_TOKEN?.trim());
}

async function request<T>(path: string, actorId: string, init?: RequestInit) {
  const { baseUrl, token } = configuration();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Admin-Actor-Id": actorId,
      "X-Request-Id": randomUUID(),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
  if (!response.ok) {
    throw new BrandPilotAdminApiError(body?.error?.code ?? "request_failed", body?.error?.message ?? "Brand Pilot API 요청에 실패했습니다.", response.status);
  }
  return body as T;
}

function queryString(input: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => { if (value) query.set(key, value); });
  const text = query.toString();
  return text ? `?${text}` : "";
}

export async function getBrandPilotOverview(actorId: string) {
  return (await request<DataEnvelope<BrandPilotOverview>>("/admin/v1/overview", actorId)).data;
}

export async function listBrandPilotBrands(actorId: string, filters: { q?: string; status?: string } = {}) {
  return request<PageEnvelope<BrandPilotBrand>>(`/admin/v1/brands${queryString(filters)}`, actorId);
}

export async function getBrandPilotBrand(actorId: string, brandId: string) {
  return (await request<DataEnvelope<BrandPilotBrandDetail>>(`/admin/v1/brands/${encodeURIComponent(brandId)}`, actorId)).data;
}

export async function updateBrandPilotBrandStatus(actorId: string, input: { brandId: string; status: "active" | "paused"; reason: string }) {
  return (await request<DataEnvelope<{ id: string; status: "active" | "paused"; updatedAt: string; replayed: boolean }>>(`/admin/v1/brands/${encodeURIComponent(input.brandId)}/status`, actorId, {
    method: "PATCH",
    headers: { "Idempotency-Key": randomUUID() },
    body: JSON.stringify({ status: input.status, reason: input.reason }),
  })).data;
}

export async function listBrandPilotChannels(actorId: string, filters: { q?: string; status?: string; channel?: string } = {}) {
  return request<PageEnvelope<BrandPilotChannel>>(`/admin/v1/channels${queryString(filters)}`, actorId);
}

export async function listBrandPilotPublishing(actorId: string, filters: { q?: string; status?: string; channel?: string } = {}) {
  return request<PageEnvelope<BrandPilotPublishingItem>>(`/admin/v1/publishing${queryString(filters)}`, actorId);
}

export async function getBrandPilotPublishing(actorId: string, queueId: string) {
  return (await request<DataEnvelope<BrandPilotPublishingDetail>>(`/admin/v1/publishing/${encodeURIComponent(queueId)}`, actorId)).data;
}

export async function updateBrandPilotPublishing(actorId: string, input: { queueId: string; action: "retry" | "cancel"; reason: string }) {
  return (await request<DataEnvelope<{ id: string; status: string; updatedAt: string; replayed: boolean }>>(`/admin/v1/publishing/${encodeURIComponent(input.queueId)}/${input.action}`, actorId, {
    method: "POST",
    headers: { "Idempotency-Key": randomUUID() },
    body: JSON.stringify({ reason: input.reason }),
  })).data;
}

export async function getBrandPilotSystemHealth(actorId: string) {
  return (await request<DataEnvelope<BrandPilotSystemHealth>>("/admin/v1/system/health", actorId)).data;
}

export async function listBrandPilotAuditEvents(actorId: string, filters: { eventType?: string; brandId?: string } = {}) {
  return request<PageEnvelope<BrandPilotAuditEvent>>(`/admin/v1/audit-events${queryString(filters)}`, actorId);
}
