import crypto from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { decryptCredential, encryptCredential } from "./credentialCrypto.js";
import { buildPublishedResultsPackage, fetchRemoteBuffer, type PublishedResultRecord } from "./downloadPackage.js";
import {
  buildImageRenderJobPayload,
  isImageRenderJobResultValidationError,
  parseImageRenderJobResult,
  validateImageRenderJobResultAssets,
  type InstagramWorkerJobResult
} from "./imageRenderJobs.js";
import { formatInstagramCaption } from "./instagramCaption.js";
import { evaluateInstagramStoryCapability, sanitizeInstagramCapabilityMetadata } from "./instagramCapabilities.js";
import { dmFixedMessages, inspectDmAnswer, routeDmMessage } from "./dmPolicy.js";
import { classifyInstagramDmSendError, sendInstagramDirectMessage } from "./instagramMessaging.js";
import { fetchInstagramMessagingProfile } from "./instagramLoginGraph.js";
import { fetchInstagramHashtagTopMedia } from "./instagramTrendMeta.js";
import { createInstagramTrendRepository } from "./instagramTrendRepository.js";
import { deliveryFormatToRenderJobType } from "./instagramFormats.js";
import { kstDateKey, nextAvailablePolicySlot } from "./publishSchedule.js";
import { classifyMetaGraphPublishError } from "./metaGraph.js";
import {
  publishInstagramCarouselWithMeta,
  publishInstagramOutput as publishInstagramOutputWithMeta,
  type InstagramPublishInput
} from "./instagramPublisher.js";
import { crawlSourceUrl, discoverContentUrls, isLikelyContentPage } from "./sourceCrawler.js";
import { nextRetryAt, scheduledRunKey } from "./sourceCrawlSchedule.js";
import { hashSourceUrl } from "./sourceUrl.js";
import { formatBrandCategoryContext, normalizeCustomSubcategory } from "./brandCategory.js";
import { buildThreadsRenderJobPayload, parseThreadsRenderJobResult } from "./textRenderJobs.js";
import { brandPolicyDateKey, dailyTopicCapacity, determineGenerationReadiness, runDailyTopicGeneration } from "./topicPublishGroups.js";
import { parseKnowledgeUpload } from "./knowledgeImport.js";
import { normalizePublishArtifact } from "./publishArtifacts.js";
import { channelCatalog } from "./channelCatalog.js";
import { createPublishAdapterRegistry, type PublishAdapterResult } from "./publishAdapters.js";
import {
  createPerformanceAdapterRegistry,
  exposureDelta,
  isPerformanceSyncDue,
  performanceRunDate,
  type PerformanceAdapter,
  type PerformanceChannel
} from "./contentPerformance.js";
import type {
  ApiRepository,
  AutomaticCrawlResult,
  BillingSummaryDto,
  BrandContentFormatDto,
  BrandUiStatusDto,
  BrandProfileDto,
  BrandProfileInput,
  Channel,
  ChannelConnectionRequestDto,
  ChannelConnectionRequestInput,
  ChannelDto,
  ContentOutputDto,
  ContentOutputStatus,
  CredentialInput,
  DailyGenerationRunResult,
  DashboardDto,
  DeliveryFormat,
  DmAttentionItemDto,
  DmConversationDetailDto,
  DmConversationFilter,
  DmConversationPageDto,
  DmConversationSummaryDto,
  DmProfileRefreshJobDto,
  DmProfileRefreshJobInput,
  DmReplyJobCompletionInput,
  DmReplyJobDto,
  ImageRenderJobCompletionInput,
  ImageRenderJobDto,
  InstagramDeliveryFormat,
  InstagramDmHistoryDto,
  InstagramDmSettingsDto,
  InstagramFormatSettingsDto,
  InstagramFormatSettingsInput,
  InstagramWebhookMessageInput,
  InstagramWebhookReceiveResult,
  KnowledgeImportDto,
  KnowledgeImportInput,
  PublishQueueDto,
  PublishResultDto,
  PipelineRunResult,
  PerformanceSyncStatus,
  SourceCrawlRunDto,
  SourceCrawlRunStatus,
  SourceCrawlTrigger,
  SourceDto,
  SourceSnapshotDto,
  SourceInput,
  SourceUpdateInput,
  SupportRequestDto,
  SupportRequestInput,
  SupportRequestStatus,
  TextRenderJobCompletionInput,
  TextRenderJobDto,
  TopicRowDto,
  TopicUploadDto,
  TopicUploadInput,
  WikiStatusDto
} from "./types.js";
import { resolveWorkerResourceLimits, type WorkerResourceLimits } from "./workerResources.js";

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function dmParticipantFallback(externalId: string) {
  return `사용자-${externalId.slice(-6)}`;
}

function decodeDmCursor(cursor: string | undefined) {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof parsed.lastMessageAt !== "string" || Number.isNaN(Date.parse(parsed.lastMessageAt)) || typeof parsed.id !== "string") {
      throw new Error("dm_cursor_invalid");
    }
    return { lastMessageAt: parsed.lastMessageAt, id: parsed.id };
  } catch {
    throw new Error("dm_cursor_invalid");
  }
}

function encodeDmCursor(row: Record<string, unknown>) {
  return Buffer.from(JSON.stringify({
    lastMessageAt: toIso(row.last_message_at as Date | string),
    id: String(row.id),
  }), "utf8").toString("base64url");
}

function mapDmConversationSummary(row: Record<string, any>): DmConversationSummaryDto {
  const externalId = String(row.external_participant_id);
  return {
    id: String(row.id),
    participant: {
      instagramScopedId: externalId,
      displayName: row.participant_name ?? row.participant_username ?? dmParticipantFallback(externalId),
      username: row.participant_username ?? null,
      profileImageUrl: row.participant_profile_url ?? null,
    },
    lastMessage: row.last_message_created_at ? {
      body: row.last_message_body ?? null,
      direction: row.last_message_direction,
      createdAt: toIso(row.last_message_created_at)!,
    } : null,
    automationStatus: row.automation_status,
    attentionStatus: row.attention_status,
    openAttentionTypes: Array.isArray(row.open_attention_types) ? row.open_attention_types : [],
    unreadCount: Number(row.unread_count ?? 0),
  };
}

function mapDmAttentionItem(row: Record<string, any>): DmAttentionItemDto {
  const deliveryStatus = row.auto_reply_delivery_status;
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    type: row.attention_type,
    status: row.status,
    originalMessage: row.original_message ?? null,
    reason: row.detail_json?.reason ?? row.detail_json?.error ?? row.reason_code ?? null,
    autoReplyStatus: deliveryStatus === "sent" ? "sent" : deliveryStatus ? "unknown" : "not_sent",
    createdAt: toIso(row.created_at)!,
    resolvedAt: toIso(row.resolved_at),
  };
}

function toDateKey(value: Date | string | null): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const dateOnly = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    if (dateOnly) return dateOnly;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : kstDateKey(date);
}

function normalizeDomain(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function normalizeSourceUrl(url: string) {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("unsupported_protocol");
    }
    return trimmed;
  } catch {
    throw new Error("source_url_invalid");
  }
}

const maxReferenceSourceUrls = 10;

type Queryable = {
  query(sql: string, values?: unknown[]): Promise<any>;
};

async function ensureInstagramFormatDefaults(queryable: Queryable, brandId: string) {
  await queryable.query(
    `insert into brand_content_formats (
       workspace_id, brand_id, format, enabled, rotation_order, capability_status
     )
     select b.workspace_id, b.id, defaults.format, defaults.enabled, defaults.rotation_order, defaults.capability_status
     from brands b
     cross join (
       values
         ('instagram_feed_carousel', true, 1, 'available'),
         ('instagram_story', false, 2, 'unchecked'),
         ('instagram_reel', false, 3, 'unchecked')
     ) as defaults(format, enabled, rotation_order, capability_status)
     where b.id = $1 and b.deleted_at is null
     on conflict (brand_id, format) do nothing`,
    [brandId]
  );
}

interface LockedInstagramStoryContext {
  story: Record<string, unknown>;
  channel: Record<string, unknown> | null;
  credential: Record<string, unknown> | null;
}

async function lockInstagramStoryContext(
  queryable: Queryable,
  brandId: string
): Promise<LockedInstagramStoryContext> {
  const story = await queryable.query(
    `select bcf.enabled, bcf.capability_status, bcf.capability_metadata
     from brand_content_formats bcf
     join brands b on b.id = bcf.brand_id
     where bcf.brand_id = $1
       and bcf.format = 'instagram_story'
       and b.deleted_at is null
     for update of bcf`,
    [brandId]
  );
  if (!story.rowCount) throw new Error("brand_profile_not_found");

  const channel = await queryable.query(
    `select id, workspace_id, status, external_account_id
     from brand_channels
     where brand_id = $1 and channel = 'instagram' and deleted_at is null
     for update`,
    [brandId]
  );
  if (!channel.rowCount) {
    return { story: story.rows[0], channel: null, credential: null };
  }

  const credential = await queryable.query(
    `select id, status, scopes, expires_at
     from channel_credentials
     where brand_channel_id = $1 and revoked_at is null
     order by created_at desc
     limit 1
     for update`,
    [channel.rows[0].id]
  );
  return {
    story: story.rows[0],
    channel: channel.rows[0],
    credential: credential.rows[0] ?? null
  };
}

function evaluateLockedInstagramStory(context: LockedInstagramStoryContext) {
  return evaluateInstagramStoryCapability({
    channelStatus: typeof context.channel?.status === "string" ? context.channel.status : null,
    externalAccountId: typeof context.channel?.external_account_id === "string" ? context.channel.external_account_id : null,
    credentialId: typeof context.credential?.id === "string" ? context.credential.id : null,
    credentialStatus: typeof context.credential?.status === "string" ? context.credential.status : null,
    credentialExpiresAt: context.credential?.expires_at instanceof Date || typeof context.credential?.expires_at === "string"
      ? context.credential.expires_at
      : null,
    scopes: Array.isArray(context.credential?.scopes) ? context.credential.scopes as string[] : [],
    apiVersion: process.env.META_GRAPH_VERSION || "v20.0",
    capabilityMetadata: sourceContextObject(context.story.capability_metadata)
  });
}

function localInstagramChannelState(context: LockedInstagramStoryContext): {
  status: "connected" | "needs_attention" | "expired";
  lastError: string | null;
} {
  const externalAccountId = typeof context.channel?.external_account_id === "string"
    ? context.channel.external_account_id.trim()
    : "";
  if (!externalAccountId) return { status: "needs_attention", lastError: "professional_account_required" };
  if (!context.credential) return { status: "needs_attention", lastError: "credential_missing" };

  const credentialStatus = context.credential.status;
  const expiresAtValue = context.credential.expires_at;
  const expiresAt = expiresAtValue instanceof Date || typeof expiresAtValue === "string"
    ? new Date(expiresAtValue)
    : null;
  const expirationInvalid = expiresAt !== null && !Number.isFinite(expiresAt.getTime());
  const expired = credentialStatus === "expired" || (
    credentialStatus === "active" &&
    expiresAt !== null &&
    !expirationInvalid &&
    expiresAt.getTime() <= Date.now()
  );
  if (expired) return { status: "expired", lastError: "credential_expired" };
  if (credentialStatus !== "active" || expirationInvalid) {
    return { status: "needs_attention", lastError: "credential_invalid" };
  }
  return { status: "connected", lastError: null };
}

async function invalidateLockedInstagramStory(queryable: Queryable, brandId: string, reason: string) {
  await queryable.query(
    `update brand_content_formats
     set enabled = false,
         capability_status = 'unchecked',
         capability_checked_at = null,
         capability_metadata = jsonb_build_object(
           'scopesVerified', false,
           'storyPublishVerified', false,
           'verifiedCredentialId', null
         ),
         last_error = $2
     where brand_id = $1 and format = 'instagram_story'`,
    [brandId, reason]
  );
}

export class StoryCapabilityRequiredError extends Error {
  readonly code = "story_capability_required";

  constructor() {
    super("story_capability_required");
    this.name = "StoryCapabilityRequiredError";
  }
}

function mockPublishedUrl(channel: Channel, outputId: string) {
  return `mock://${channel}/${outputId}`;
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function normalizeTopicKey(title: string, angle: string) {
  const normalize = (value: string) => value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  return `${normalize(title)}::${normalize(angle)}`;
}

function malformedTopicTextErrors(fields: Record<string, string | null | undefined>) {
  const errors: string[] = [];
  for (const [field, value] of Object.entries(fields)) {
    if (!value) continue;
    if (value.includes("\uFFFD") || /\?{2,}/.test(value)) {
      errors.push(`${field}_malformed_text`);
    }
  }
  return errors;
}

function parseTopicCsv(input: TopicUploadInput) {
  const lines = input.csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error("topic_upload_invalid_csv");
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  if (!headers.includes("topic_title") || !headers.includes("topic_angle")) {
    throw new Error("topic_upload_invalid_csv");
  }
  return lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] ?? ""]));
    const topicTitle = row.topic_title?.trim() ?? "";
    const topicAngle = row.topic_angle?.trim() ?? "";
    const targetCustomer = row.target_customer?.trim() || null;
    const region = row.region?.trim() || null;
    const season = row.season?.trim() || null;
    const notes = row.notes?.trim() || null;
    const validationErrors = [
      ...(topicTitle ? [] : ["topic_title_required"]),
      ...(topicAngle ? [] : ["topic_angle_required"]),
      ...malformedTopicTextErrors({
        topic_title: topicTitle,
        topic_angle: topicAngle,
        target_customer: targetCustomer,
        region,
        season,
        notes
      })
    ];
    return {
      rowNumber: index + 2,
      topicTitle,
      topicAngle,
      targetCustomer,
      region,
      season,
      referenceUrl: row.reference_url?.trim() || null,
      priority: Number.parseInt(row.priority ?? "0", 10) || 0,
      notes,
      topicKey: normalizeTopicKey(topicTitle, topicAngle),
      validationErrors
    };
  });
}

function categoryProfileFromRow(row: any) {
  const subcategories = Array.isArray(row.subcategories) ? row.subcategories : [];
  return {
    primaryCategory: row.category_code && row.category_name
      ? { code: String(row.category_code), name: String(row.category_name) }
      : null,
    subcategories: subcategories.map((item: any) => ({
      type: item.type === "custom" ? "custom" as const : "system" as const,
      code: item.type === "custom" ? null : item.code ?? null,
      name: String(item.name ?? "")
    }))
  };
}

function mapProfile(row: any): BrandProfileDto {
  const category = categoryProfileFromRow(row);
  return {
    id: row.profile_id,
    brandId: row.brand_id,
    name: row.brand_name,
    ...category,
    primaryCustomer: row.primary_customer ?? "",
    description: row.description ?? "",
    tone: row.tone ?? "",
    defaultCta: row.default_cta ?? "",
    mainLink: row.main_link ?? "",
    autoApprovalEnabled: row.auto_approval_enabled ?? false,
    logoUrl: row.logo_url ?? null
  };
}

function mapKnowledgeImport(row: any): KnowledgeImportDto {
  const result = sourceContextObject(row.result_json);
  return {
    id: row.id,
    entryType: result.entryType === "product" ? "product" : "faq",
    fileName: row.file_name,
    status: row.status,
    totalRows: Number(result.totalRows ?? 0),
    validRows: Number(result.validRows ?? 0),
    duplicateRows: Number(result.duplicateRows ?? 0),
    invalidRows: Number(result.invalidRows ?? 0),
    updatedRows: Number(result.updatedRows ?? 0),
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
  };
}

function decodeBase64Upload(value: string) {
  const normalized = value.replace(/\s+/g, "");
  const maxBase64Length = Math.ceil((1024 * 1024) / 3) * 4 + 4;
  if (
    !normalized ||
    normalized.length > maxBase64Length ||
    !/^[a-z0-9+/]*={0,2}$/i.test(normalized) ||
    normalized.length % 4 !== 0
  ) {
    throw new Error("faq_upload_invalid_file");
  }
  return Buffer.from(normalized, "base64");
}

function mapChannel(row: any): ChannelDto {
  const hasActiveCredentials = row.has_active_credentials === undefined
    ? row.status === "connected"
    : Boolean(row.has_active_credentials);
  const status = row.status === "connected" && !hasActiveCredentials ? "not_connected" : row.status;
  const oauthState = hasActiveCredentials
    ? status === "connected" ? "connected" : "needs_attention"
    : status === "not_connected" ? "not_connected" : "needs_attention";
  return {
    channel: row.channel,
    enabled: Boolean(row.enabled),
    oauthState,
    status,
    accountLabel: row.account_label ?? null,
    lastHealthyAt: toIso(row.last_healthy_at),
    lastPublishedAt: toIso(row.last_published_at),
    lastError: row.last_error
  };
}

function mapBrandContentFormat(row: any): BrandContentFormatDto {
  return {
    format: row.format,
    enabled: Boolean(row.enabled),
    rotationOrder: Number(row.rotation_order),
    capabilityStatus: row.capability_status,
    capabilityCheckedAt: toIso(row.capability_checked_at),
    capabilityMetadata: sanitizeInstagramCapabilityMetadata(row.capability_metadata),
    lastError: row.last_error ?? null
  };
}

function mapInstagramFormatSettings(rows: any[]): InstagramFormatSettingsDto {
  const orderedRows = [...rows].sort((left, right) => Number(left.rotation_order) - Number(right.rotation_order));
  return {
    brandId: orderedRows[0].brand_id,
    brandColor: orderedRows[0].brand_color ?? null,
    formats: orderedRows.map(mapBrandContentFormat)
  };
}

async function readInstagramFormatSettings(queryable: Queryable, brandId: string, lock = false) {
  const result = await queryable.query(
    `select bp.brand_color,
            b.id as brand_id,
            bcf.format,
            bcf.enabled,
            bcf.rotation_order,
            bcf.capability_status,
            bcf.capability_checked_at,
            bcf.capability_metadata,
            bcf.last_error
     from brands b
     join brand_profiles bp on bp.brand_id = b.id
     join brand_content_formats bcf on bcf.brand_id = b.id
     where b.id = $1 and b.deleted_at is null
     order by bcf.rotation_order${lock ? "\n     for update of bp, bcf" : ""}`,
    [brandId]
  );
  if (!result.rowCount) throw new Error("brand_profile_not_found");
  return mapInstagramFormatSettings(result.rows);
}

function mapChannelConnectionRequest(row: any | null, brandId: string): ChannelConnectionRequestDto {
  return {
    id: row?.id ?? null,
    brandId,
    status: row?.status ?? "draft",
    instagramHandle: row?.instagram_handle ?? null,
    instagramProfileUrl: row?.instagram_profile_url ?? null,
    facebookPageUrl: row?.facebook_page_url ?? null,
    metaBusinessName: row?.meta_business_name ?? null,
    threadsProfileUrl: row?.threads_profile_url ?? null,
    contactName: row?.contact_name ?? null,
    contactEmail: row?.contact_email ?? null,
    hasAdminAccess: Boolean(row?.has_admin_access ?? false),
    requestNote: row?.request_note ?? null,
    submittedAt: toIso(row?.submitted_at ?? null),
    updatedAt: toIso(row?.updated_at ?? null)
  };
}

function mapSupportRequest(row: any): SupportRequestDto {
  return {
    id: row.id,
    brandId: row.brand_id,
    workspaceId: row.workspace_id,
    category: row.category,
    title: row.title,
    message: row.message,
    contactEmail: row.contact_email,
    status: row.status,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!
  };
}

function mapSource(row: any): SourceDto {
  return {
    id: row.id,
    brandId: row.brand_id,
    sourceType: row.source_type,
    url: row.url,
    title: row.title,
    status: row.status,
    enabled: row.enabled,
    lastCrawledAt: toIso(row.last_crawled_at),
    lastError: row.last_error
  };
}

function mapSourceCrawlRun(row: any): SourceCrawlRunDto {
  return {
    id: row.id,
    brandId: row.brand_id,
    sourceUrlId: row.source_url_id,
    trigger: row.trigger,
    status: row.status,
    attempt: Number(row.attempt ?? 0),
    processed: Number(row.processed_count ?? 0),
    created: Number(row.created_count ?? 0),
    updated: Number(row.updated_count ?? 0),
    failed: Number(row.failed_count ?? 0),
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    nextRetryAt: toIso(row.next_retry_at),
    lastError: row.last_error ?? null
  };
}

function mapSourceSnapshot(row: any): SourceSnapshotDto {
  const snapshot: SourceSnapshotDto = {
    id: row.id,
    sourceUrlId: row.source_url_id,
    sourceType: row.source_type,
    url: row.url,
    title: row.title,
    status: row.status,
    fetchedAt: toIso(row.fetched_at)!,
    summary: row.summary,
    errorMessage: row.error_message
  };
  if (row.source_content_item_id !== undefined) {
    snapshot.contentItemId = row.source_content_item_id;
  }
  return snapshot;
}

function publishQueueSourceType(row: any): PublishQueueDto["sourceType"] {
  const hasTopic = Boolean(row.topic_title);
  const hasSource = Boolean(row.reference_url || row.source_summary || publishQueueSourceUrls(row).length > 0);
  if (hasTopic && hasSource) return "mixed";
  if (hasTopic) return "topic_table";
  if (hasSource) return "source_url";
  return "unknown";
}

function publishQueueSourceLabel(row: any) {
  if (row.topic_title) return row.topic_title;
  if (row.reference_url) return row.reference_url;
  if (publishQueueSourceUrls(row).length > 0) return "크롤링 근거";
  if (row.source_summary) return "크롤링 근거";
  return "근거 없음";
}

function publishQueueSourceDetail(row: any) {
  const parts = [row.topic_angle, row.reference_url, row.source_summary].filter((part) => typeof part === "string" && part.trim().length > 0);
  return parts.length > 0 ? parts.join(" | ") : null;
}

function publishQueueSourceUrls(row: any): string[] {
  const sourceUrls: unknown[] = Array.isArray(row.source_urls) ? row.source_urls : [];
  return sourceUrls.filter((url): url is string => typeof url === "string" && url.trim().length > 0);
}

function sourceContextObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return {};
}

async function enqueueSourceContentTopic(queryable: Queryable, input: {
  workspaceId: string;
  brandId: string;
  sourceContentItemId: string;
  sourceSnapshotId: string;
  contentUrl: string;
  contentHash: string;
  title: string | null;
}) {
  const sourceContext = {
    source: "source_url",
    sourceContentItemId: input.sourceContentItemId,
    sourceSnapshotId: input.sourceSnapshotId,
    contentUrl: input.contentUrl,
    contentHash: input.contentHash
  };
  await queryable.query(
    `insert into content_topics (workspace_id, brand_id, topic_row_id, title, angle, status, source_context)
     select $1, $2, null, $3, 'source_url', 'selected', $4::jsonb
     where not exists (
       select 1
       from content_topics ct
       where ct.brand_id = $2
         and ct.source_context ->> 'source' = 'source_url'
         and ct.source_context ->> 'sourceContentItemId' = $5
         and ct.source_context ->> 'contentHash' = $6
         and ct.status in ('selected', 'generating', 'generated')
     )
     on conflict do nothing`,
    [
      input.workspaceId,
      input.brandId,
      input.title?.trim() || "크롤링 소스 기반 콘텐츠",
      JSON.stringify(sourceContext),
      input.sourceContentItemId,
      input.contentHash
    ]
  );
}

async function enqueueLatestSourceContentTopics(queryable: Queryable, brandId: string) {
  await queryable.query(
    `with latest_source_snapshots as (
       select distinct on (ss.source_content_item_id)
              ss.workspace_id,
              ss.brand_id,
              ss.id as source_snapshot_id,
              ss.source_content_item_id,
              ss.content_hash,
              coalesce(nullif(ss.extracted_title, ''), nullif(sci.title, ''), '크롤링 소스 기반 콘텐츠') as title,
              coalesce(sci.content_url, su.url) as content_url
       from source_snapshots ss
       join source_urls su on su.id = ss.source_url_id
       join source_content_items sci on sci.id = ss.source_content_item_id and sci.deleted_at is null
       where ss.brand_id = $1
         and ss.status = 'succeeded'
         and ss.source_content_item_id is not null
         and ss.content_hash is not null
         and nullif(ss.extracted_text, '') is not null
         and su.deleted_at is null
         and su.enabled = true
       order by ss.source_content_item_id, ss.fetched_at desc
     )
     insert into content_topics (workspace_id, brand_id, topic_row_id, title, angle, status, source_context)
     select lss.workspace_id,
            lss.brand_id,
            null,
            lss.title,
            'source_url',
            'selected',
            jsonb_build_object(
              'source', 'source_url',
              'sourceContentItemId', lss.source_content_item_id::text,
              'sourceSnapshotId', lss.source_snapshot_id::text,
              'contentUrl', lss.content_url,
              'contentHash', lss.content_hash
            )
     from latest_source_snapshots lss
     where lss.content_url is not null
       and not exists (
         select 1
         from content_topics ct
         where ct.brand_id = lss.brand_id
           and ct.source_context ->> 'source' = 'source_url'
           and ct.source_context ->> 'sourceContentItemId' = lss.source_content_item_id::text
           and ct.source_context ->> 'contentHash' = lss.content_hash
           and ct.status in ('selected', 'generating', 'generated')
       )
     on conflict do nothing`,
    [brandId]
  );
}

function mapPublishResults(rows: any[]): PublishResultDto[] {
  const results = new Map<string, PublishResultDto>();

  for (const row of rows) {
    const contentId = row.content_id;
    const existing = results.get(contentId);
    const generatedAt = toIso(row.generated_at)!;
    const nextChannel = {
      queueId: row.queue_id,
      channelOutputId: row.channel_output_id,
      channel: row.channel,
      status: row.status,
      publishedAt: toIso(row.published_at),
      failedAt: toIso(row.failed_at),
      title: row.channel_title,
      previewTitle: row.preview_title,
      previewBody: row.preview_body,
      outputJson: row.output_json ?? {},
      artifactPublicUrl: row.artifact_public_url,
      externalPostId: row.external_post_id,
      externalUrl: row.external_url,
      lastError: row.attempt_error_message ?? row.last_error,
      sourceSummary: row.source_summary
    };

    if (!existing) {
      results.set(contentId, {
        contentId,
        title: row.content_title,
        generatedAt,
        sourceType: publishQueueSourceType(row),
        sourceLabel: publishQueueSourceLabel(row),
        sourceDetail: publishQueueSourceDetail(row),
        sourceUrls: publishQueueSourceUrls(row),
        channels: [nextChannel]
      });
      continue;
    }

    if (new Date(generatedAt).getTime() > new Date(existing.generatedAt).getTime()) {
      existing.generatedAt = generatedAt;
    }
    existing.channels.push(nextChannel);
  }

  const channelOrder = new Map([["instagram", 1], ["threads", 2], ["tiktok", 3], ["youtube", 4], ["x", 5]]);
  return [...results.values()]
    .map((result) => ({
      ...result,
      channels: result.channels.sort((left, right) => (channelOrder.get(left.channel) ?? 99) - (channelOrder.get(right.channel) ?? 99))
    }))
    .sort((left, right) => new Date(right.generatedAt).getTime() - new Date(left.generatedAt).getTime());
}

function countFromDb(value: unknown) {
  return Number(value ?? 0);
}

async function ensureReferenceSourceCapacity(pool: Pool, brandId: string, excludedSourceId?: string) {
  const result = await pool.query(
    `select count(*) as count
     from source_urls
     where brand_id = $1
       and source_type = 'reference'
       and enabled = true
       and deleted_at is null
       and ($2::uuid is null or id <> $2::uuid)`,
    [brandId, excludedSourceId ?? null]
  );
  if (countFromDb(result.rows[0]?.count) >= maxReferenceSourceUrls) {
    throw new Error("source_reference_limit_exceeded");
  }
}

function optionalText(value: string | null | undefined) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

function doneStatus(done: boolean, fallback: "needs_attention" | "pending" = "needs_attention") {
  return done ? "completed" : fallback;
}

function buildBrandUiStatus(row: any): BrandUiStatusDto {
  const brandProfileDone = Boolean(
    row.brand_name &&
    row.primary_category_id &&
    row.primary_customer &&
    row.description
  );
  const ownedSourceDone = countFromDb(row.owned_source_count) > 0;
  const referenceSourceDone = countFromDb(row.reference_source_count) > 0;
  const topicTableDone = countFromDb(row.topic_row_count) > 0;
  const contentInputDone = ownedSourceDone || referenceSourceDone || topicTableDone;
  const instagramDone = row.instagram_status === "connected";
  const threadsDone = row.threads_status === "connected";
  const firstContentDone = countFromDb(row.content_output_count) > 0;

  const steps: BrandUiStatusDto["onboarding"]["steps"] = [
    {
      id: "brand-profile",
      title: "브랜드 정보",
      description: "브랜드명, 대표 분야, 고객, 서비스 설명을 입력합니다.",
      actionLabel: "설정",
      path: "/brand-settings",
      status: doneStatus(brandProfileDone)
    },
    {
      id: "owned-url",
      title: "자사 URL",
      description: "홈페이지, 상품 페이지, FAQ 등 브랜드 근거 URL을 등록합니다.",
      actionLabel: "소스",
      path: "/sources",
      status: ownedSourceDone ? "completed" : contentInputDone ? "pending" : "needs_attention"
    },
    {
      id: "reference-url",
      title: "참고 URL",
      description: "외부 사례와 업종 참고 URL을 콘텐츠 참고 자료로 준비합니다.",
      actionLabel: "소스",
      path: "/sources",
      status: doneStatus(referenceSourceDone, "pending")
    },
    {
      id: "topic-table",
      title: "주제표",
      description: "CSV/Excel 주제표를 업로드해 생성 후보를 준비합니다.",
      actionLabel: "주제표",
      path: "/sources",
      status: doneStatus(topicTableDone, "pending")
    },
    {
      id: "instagram",
      title: "Instagram 연결",
      description: "정방형 카드뉴스 업로드 권한을 확인합니다.",
      actionLabel: "확인",
      path: "/channels",
      status: doneStatus(instagramDone)
    },
    {
      id: "threads",
      title: "Threads 연결",
      description: "계정 토큰과 텍스트 게시 권한을 확인합니다.",
      actionLabel: "연결",
      path: "/channels",
      status: doneStatus(threadsDone, "pending")
    },
    {
      id: "first-content",
      title: "첫 콘텐츠 생성",
      description: "주제표와 소스 URL을 바탕으로 첫 콘텐츠를 생성합니다.",
      actionLabel: "생성 요청",
      path: "/publish-queue",
      status: doneStatus(firstContentDone, "pending")
    }
  ];
  const completedCount = steps.filter((step) => step.status === "completed").length;
  const totalCount = steps.length;
  const remainingCount = steps.filter((step) => step.status === "needs_attention").length;

  return {
    brandId: row.brand_id,
    brandName: row.brand_name,
    logoUrl: row.logo_url ?? null,
    lastGeneratedAt: toIso(row.last_generated_at),
    navigation: {
      onboardingRemaining: remainingCount,
      contentReview: countFromDb(row.content_review_count),
      publishIssues: countFromDb(row.publish_issue_count),
      channelIssues: countFromDb(row.channel_issue_count)
    },
    onboarding: {
      completedCount,
      totalCount,
      remainingCount,
      steps
    }
  };
}


interface RepositoryInstagramPublishOptions {
  enabled?: boolean;
}

interface RepositoryOptions {
  artifactStorageDir?: string;
  fetchPublishArtifact?: typeof fetch;
  publishArtifactFetchTimeoutMs?: number;
  publishArtifactMaxBytes?: number;
  publishAssetMaxBytes?: number;
  publishArtifactAllowedOrigins?: readonly string[];
  instagramPublish?: RepositoryInstagramPublishOptions;
  imageRenderCooldownMs?: number;
  fetchInstagramImageManifest?: typeof fetchInstagramImageManifest;
  fetchImageAsset?: typeof fetch;
  publishInstagramOutput?: typeof publishInstagramOutputWithMeta;
  publishInstagramCarousel?: typeof publishInstagramCarouselWithMeta;
  sendInstagramDirectMessage?: typeof sendInstagramDirectMessage;
  fetchInstagramMessagingProfile?: typeof fetchInstagramMessagingProfile;
  fetchInstagramHashtagTopMedia?: typeof fetchInstagramHashtagTopMedia;
  trendNow?: () => Date;
  performanceAdapters?: Partial<Record<PerformanceChannel, PerformanceAdapter>>;
  workerResourceLimits?: Pick<WorkerResourceLimits, "total" | "dmReserved">;
}

function repositoryWorkerResourceLimits(options?: RepositoryOptions) {
  return resolveWorkerResourceLimits(options?.workerResourceLimits ?? {
    total: Number(process.env.WORKER_CODEX_MAX_CONCURRENCY ?? "2"),
    dmReserved: Number(process.env.WORKER_CODEX_DM_RESERVED_SLOTS ?? "1"),
  });
}

function resolvePublishArtifactAllowedOrigins(options?: RepositoryOptions) {
  const configured = options?.publishArtifactAllowedOrigins
    ?? (process.env.PUBLISH_ARTIFACT_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const values = [...configured];
  if (process.env.SUPABASE_URL) values.push(process.env.SUPABASE_URL);
  return [...new Set(values.flatMap((value) => {
    try { return [new URL(value).origin]; } catch { return []; }
  }))];
}

function resolveInstagramPublishOptions(options?: RepositoryOptions) {
  return {
    enabled: options?.instagramPublish?.enabled ?? process.env.INSTAGRAM_PUBLISH_ENABLED === "true"
  };
}

function resolveImageRenderCooldownMs(options?: RepositoryOptions) {
  const configured = options?.imageRenderCooldownMs ?? Number(process.env.IMAGE_JOB_COOLDOWN_MS ?? "60000");
  if (!Number.isFinite(configured)) return 60_000;
  return Math.max(0, Math.min(Math.floor(configured), 60 * 60 * 1000));
}

function extractManifestImageUrls(manifest: unknown) {
  const record = typeof manifest === "object" && manifest !== null && !Array.isArray(manifest) ? manifest as Record<string, unknown> : {};
  const images = Array.isArray(record.cards) ? record.cards : Array.isArray(record.images) ? record.images : [];
  return images
    .map((image) => typeof image === "object" && image !== null && !Array.isArray(image) ? ((image as Record<string, unknown>).url ?? (image as Record<string, unknown>).publicUrl) : null)
    .filter((url): url is string => typeof url === "string" && url.length > 0);
}

function extractManifestAssetUrl(value: unknown) {
  const record = recordValue(value);
  return nullableText(record.url ?? record.publicUrl);
}

function formatInstagramReelCaption(caption: unknown, hashtags: unknown) {
  const text = nullableText(caption) ?? "";
  const tags = Array.isArray(hashtags)
    ? hashtags.filter((tag): tag is string => typeof tag === "string" && /^#[^\s#]+$/.test(tag.trim())).map((tag) => tag.trim())
    : [];
  return [text, tags.join(" ")].filter(Boolean).join("\n\n");
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nullableText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dashboardAttentionMessage(type: DashboardDto["attentionItems"][number]["type"]) {
  const messages: Record<DashboardDto["attentionItems"][number]["type"], string> = {
    publish_failed: "게시 처리에 실패했습니다. 채널 연결과 게시 설정을 확인해 주세요.",
    channel_error: "채널 연결 상태를 확인해 주세요.",
    sync_failed: "채널 성과 일부를 수집하지 못했습니다.",
    stale_sync: "채널 성과 수집 상태를 확인해 주세요."
  };
  return messages[type];
}

function safeWorkerFailureMessage(value: string) {
  const sanitized = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").trim();
  return (sanitized || "worker_generation_failed").slice(0, 2000);
}

async function markChannelOutputsGenerationFailed(
  client: Pick<PoolClient, "query">,
  channelOutputIds: string[],
  code: string,
  message: string
) {
  if (channelOutputIds.length === 0) return;
  await client.query(
    `update channel_outputs
     set status = 'generation_failed',
         output_json = jsonb_set(
           coalesce(output_json, '{}'::jsonb),
           '{generationError}',
           jsonb_build_object('code', $2, 'message', $3, 'failedAt', now()),
           true
         ),
         block_reasons = case
           when block_reasons ? 'generation_failed' then block_reasons
           else coalesce(block_reasons, '[]'::jsonb) || '["generation_failed"]'::jsonb
         end,
         updated_at = now()
     where id = any($1::uuid[])`,
    [channelOutputIds, code, safeWorkerFailureMessage(message)]
  );
}

async function fetchInstagramImageManifest(manifestUrl: string, fetchImpl = fetch) {
  const response = await fetchImpl(manifestUrl);
  if (!response.ok) throw new Error(`instagram_manifest_fetch_failed:${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}

export function createRepository(pool: Pool, options: RepositoryOptions = {}): ApiRepository {
  const instagramPublish = resolveInstagramPublishOptions(options);
  const imageRenderCooldownMs = resolveImageRenderCooldownMs(options);
  const workerResourceLimits = repositoryWorkerResourceLimits(options);
  const fetchInstagramManifest = options.fetchInstagramImageManifest ?? fetchInstagramImageManifest;
  const fetchImageAsset = options.fetchImageAsset ?? fetch;
  const fetchPublishArtifact = options.fetchPublishArtifact ?? fetch;
  const publishArtifactFetchTimeoutMs = Math.max(1, Math.min(options.publishArtifactFetchTimeoutMs ?? 5_000, 30_000));
  const publishArtifactMaxBytes = Math.max(1, options.publishArtifactMaxBytes ?? 2 * 1024 * 1024);
  const publishAssetMaxBytes = Math.max(1, options.publishAssetMaxBytes ?? 100 * 1024 * 1024);
  const publishArtifactAllowedOrigins = resolvePublishArtifactAllowedOrigins(options);
  const publishInstagramCarousel = options.publishInstagramCarousel ?? publishInstagramCarouselWithMeta;
  const sendDm = options.sendInstagramDirectMessage ?? sendInstagramDirectMessage;
  const fetchDmProfile = options.fetchInstagramMessagingProfile ?? fetchInstagramMessagingProfile;
  const instagramTrendRepository = createInstagramTrendRepository({
    pool,
    decryptCredential,
    fetchTopMedia: options.fetchInstagramHashtagTopMedia ?? fetchInstagramHashtagTopMedia,
    now: options.trendNow,
  });
  const performanceAdapters = {
    ...createPerformanceAdapterRegistry(),
    ...options.performanceAdapters
  };
  const publishInstagramOutput = options.publishInstagramOutput ?? (
    options.publishInstagramCarousel
      ? async (input: InstagramPublishInput) => input.deliveryFormat === "instagram_feed_carousel"
        ? publishInstagramCarousel(input)
        : publishInstagramOutputWithMeta(input)
      : publishInstagramOutputWithMeta
  );

  async function findPublishResultRecord(queueId: string) {
    const result = await pool.query(
      `select pq.id,
              pq.channel,
              pq.published_at,
              co.title,
              co.delivery_format,
              co.preview_title,
              co.preview_body,
              co.source_summary,
              co.output_json,
              sa.public_url as artifact_public_url,
              sa.bucket as artifact_bucket,
              sa.path as artifact_path,
              latest_attempt.external_url
       from publish_queue pq
       join channel_outputs co on co.id = pq.channel_output_id
       left join storage_artifacts sa on sa.id = co.rendered_artifact_id
       left join lateral (
         select pa.external_url
         from publish_attempts pa
         where pa.publish_queue_id = pq.id
         order by pa.finished_at desc nulls last, pa.created_at desc
         limit 1
       ) latest_attempt on true
       where pq.id = $1`,
      [queueId]
    );
    const row = result.rows[0];
    if (!row) throw new Error("publish_queue_not_found");
    return row;
  }

  function publishedResultRecord(row: any): PublishedResultRecord {
    return {
      id: row.id,
      channel: row.channel,
      publishedAt: row.published_at,
      title: row.title,
      previewTitle: row.preview_title,
      previewBody: row.preview_body,
      sourceSummary: row.source_summary,
      outputJson: row.output_json,
      artifactPublicUrl: row.artifact_public_url,
      artifactBucket: row.artifact_bucket,
      artifactPath: row.artifact_path,
      externalUrl: row.external_url
    };
  }

  function outputWithDeliveryFormat(row: any) {
    const output = recordValue(row.output_json);
    if (!row.delivery_format || output.deliveryFormat || output.delivery_format) return row.output_json;
    return { ...output, deliveryFormat: row.delivery_format };
  }

  async function createImageRenderJob(client: Pick<Pool, "query">, input: {
    workspaceId: string;
    brandId: string;
    contentTopicId: string;
    channelOutputId: string;
    deliveryFormat: InstagramDeliveryFormat;
    topic: {
      title: string;
      angle: string;
      targetCustomer: string | null;
      region: string | null;
      season: string | null;
      notes: string | null;
    };
    brand: Record<string, unknown>;
    crawlContentUrl: string | null;
    referenceUrl: string | null;
  }) {
    const jobId = crypto.randomUUID();
    const payload = {
      ...buildImageRenderJobPayload({
        deliveryFormat: input.deliveryFormat,
        topic: input.topic,
        brand: {
          name: String(input.brand.brand_name ?? ""),
          categoryContext: formatBrandCategoryContext(categoryProfileFromRow(input.brand)),
          primaryCustomer: nullableText(input.brand.primary_customer),
          description: nullableText(input.brand.description),
          tone: nullableText(input.brand.tone),
          brandColor: nullableText(input.brand.brand_color)
        },
        crawlContentUrl: input.crawlContentUrl,
        referenceUrl: input.referenceUrl
      }),
      contentTopicId: input.contentTopicId,
      storagePrefix: `brands/${input.brandId}/topics/${input.contentTopicId}/${input.deliveryFormat}/${jobId}`
    };
    const jobType = deliveryFormatToRenderJobType(input.deliveryFormat);
    await client.query(
      `insert into jobs (id, workspace_id, brand_id, channel_output_id, job_type, status, payload_json)
       values ($1, $2, $3, $4, $5, 'queued', $6)
       on conflict (channel_output_id) where job_type in ('instagram_feed_render', 'instagram_story_render', 'instagram_reel_render') and status in ('queued', 'running') do nothing`,
      [jobId, input.workspaceId, input.brandId, input.channelOutputId, jobType, JSON.stringify(payload)]
    );
  }

  async function createThreadsRenderJob(client: Pick<Pool, "query">, input: {
    workspaceId: string;
    brandId: string;
    channelOutputId: string;
    topic: {
      title: string;
      angle: string;
      targetCustomer: string | null;
      region: string | null;
      season: string | null;
      notes: string | null;
    };
    brand: Record<string, unknown>;
    crawlContentUrl: string | null;
    referenceUrl: string | null;
  }) {
    const payload = buildThreadsRenderJobPayload({
      topic: input.topic,
      brand: {
        name: String(input.brand.brand_name ?? ""),
        categoryContext: formatBrandCategoryContext(categoryProfileFromRow(input.brand)),
        primaryCustomer: nullableText(input.brand.primary_customer),
        description: nullableText(input.brand.description),
        tone: nullableText(input.brand.tone),
        brandColor: nullableText(input.brand.brand_color)
      },
      crawlContentUrl: input.crawlContentUrl,
      referenceUrl: input.referenceUrl
    });
    await client.query(
      `insert into jobs (id, workspace_id, brand_id, channel_output_id, job_type, status, payload_json)
       values ($1, $2, $3, $4, 'threads_text_render', 'queued', $5)
       on conflict (channel_output_id) where job_type = 'threads_text_render' and status in ('queued', 'running') do nothing`,
      [crypto.randomUUID(), input.workspaceId, input.brandId, input.channelOutputId, JSON.stringify(payload)]
    );
  }

  async function publishQueueItemInternal(queueId: string) {
    const result = await pool.query(
      `with selected as (
         select pq.id
         from publish_queue pq
         where pq.id = $1 and pq.status = 'scheduled'
       ), claimed as (
         update publish_queue pq
         set status = 'publishing',
             publishing_started_at = now(),
             failed_at = null,
             last_error = null,
             updated_at = now()
         from selected
         where pq.id = selected.id and pq.status = 'scheduled'
         returning pq.*
       ), queue_context as (
         select pq.id, pq.workspace_id, pq.brand_id, pq.channel, pq.channel_output_id,
               co.delivery_format, co.output_json,
               sa.public_url as rendered_manifest_url,
               bc.external_account_id,
               cc.id as credential_id, cc.encrypted_payload, cc.auth_mode,
               bcf.capability_status, bcf.capability_metadata,
               coalesce((select max(pa.attempt_number) from publish_attempts pa where pa.publish_queue_id = pq.id), 0) + 1 as attempt_number
         from claimed pq
         join channel_outputs co on co.id = pq.channel_output_id
         left join storage_artifacts sa on sa.id = co.rendered_artifact_id
         left join brand_channels bc on bc.brand_id = pq.brand_id and bc.channel = pq.channel and bc.deleted_at is null
         left join channel_credentials cc on cc.brand_channel_id = bc.id and cc.status = 'active' and cc.revoked_at is null
         left join brand_content_formats bcf on bcf.brand_id = pq.brand_id and bcf.format = co.delivery_format
       ), attempt as (
         insert into publish_attempts (
           workspace_id, brand_id, publish_queue_id, attempt_number, status, request_metadata
         )
         select workspace_id, brand_id, id, attempt_number, 'running',
                jsonb_build_object('channel', channel, 'mode', 'preparing')
         from queue_context
         returning id, attempt_number
       )
       select queue_context.*, attempt.id as attempt_id
       from queue_context
       cross join attempt`,
      [queueId]
    );
    if (!result.rowCount) throw new Error("publish_queue_not_publishable");
    const queue = result.rows[0];
    let externalPostId = `mock_${queue.channel_output_id}`;
    let publishedUrl: string | null = mockPublishedUrl(queue.channel, queue.channel_output_id);
    let requestMetadata: Record<string, unknown> = { mode: "mock", channel: queue.channel };
    let responseMetadata: Record<string, unknown> = { publishedUrl };
    let externalPublishSucceeded = false;
    let deferredProviderFailure: Extract<PublishAdapterResult, { status: "blocked" }> | null = null;

    try {
      if (queue.channel !== "instagram") {
        const adapters = createPublishAdapterRegistry({
          publishInstagram: async () => {
            throw new Error("instagram_adapter_boundary_unreachable");
          }
        });
        const adapter = adapters[queue.channel as Channel];
        if (!adapter) throw new Error("publish_adapter_not_found");
        const adapterResult = await adapter.publish({
          channel: queue.channel,
          credentialState: queue.encrypted_payload && queue.external_account_id ? "connected" : "not_connected",
          queueId,
          outputJson: recordValue(queue.output_json)
        });
        if (adapterResult.status === "blocked") {
          deferredProviderFailure = adapterResult;
          throw new Error(adapterResult.errorCode);
        }
        externalPublishSucceeded = true;
        externalPostId = adapterResult.externalPostId;
        publishedUrl = adapterResult.externalUrl;
        requestMetadata = { mode: "provider_adapter", channel: queue.channel };
        responseMetadata = { publishedUrl, externalPostId };
      }
      if (queue.channel === "instagram" && instagramPublish.enabled) {
        if (!queue.rendered_manifest_url) throw new Error("instagram_rendered_manifest_required");
        if (!queue.external_account_id) throw new Error("instagram_business_account_id_required");
        if (!queue.encrypted_payload) throw new Error("instagram_access_token_required");
        const manifest = await fetchInstagramManifest(queue.rendered_manifest_url);
        const manifestRecord = recordValue(manifest);
        const deliveryFormat = nullableText(queue.delivery_format)
          ?? nullableText(queue.output_json?.deliveryFormat)
          ?? "instagram_feed_carousel";
        if (
          deliveryFormat !== "instagram_feed_carousel"
          && deliveryFormat !== "instagram_story"
          && deliveryFormat !== "instagram_reel"
        ) {
          throw new Error("instagram_manifest_delivery_format_mismatch");
        }
        const manifestDeliveryFormat = nullableText(manifestRecord.deliveryFormat);
        if (manifestDeliveryFormat && manifestDeliveryFormat !== deliveryFormat) {
          throw new Error("instagram_manifest_delivery_format_mismatch");
        }
        const graphHost: "graph.facebook.com" | "graph.instagram.com" = queue.auth_mode === "instagram_login"
          ? "graph.instagram.com"
          : "graph.facebook.com";
        const baseInput = {
          accessToken: decryptCredential(queue.encrypted_payload),
          instagramBusinessAccountId: queue.external_account_id,
          graphHost
        };
        let publishInput: InstagramPublishInput;
        let assetCount: number;
        switch (deliveryFormat) {
          case "instagram_feed_carousel": {
            const imageUrls = extractManifestImageUrls(manifestRecord);
            if (imageUrls.length === 0) throw new Error("instagram_rendered_images_required");
            const caption = formatInstagramCaption(
              typeof queue.output_json?.caption === "string" ? queue.output_json.caption : "",
              queue.output_json?.hashtags
            );
            assetCount = imageUrls.length;
            publishInput = { ...baseInput, deliveryFormat, imageUrls, caption };
            break;
          }
          case "instagram_story": {
            const imageUrl = extractManifestAssetUrl(manifestRecord.story);
            if (!imageUrl) throw new Error("instagram_rendered_story_required");
            assetCount = 1;
            publishInput = {
              ...baseInput,
              deliveryFormat,
              imageUrl,
              storyCapability: {
                capabilityStatus: nullableText(queue.capability_status),
                capabilityMetadata: recordValue(queue.capability_metadata),
                credentialId: nullableText(queue.credential_id)
              }
            };
            break;
          }
          case "instagram_reel": {
            const videoUrl = extractManifestAssetUrl(manifestRecord.video);
            if (!videoUrl) throw new Error("reel_video_required");
            const caption = formatInstagramReelCaption(
              queue.output_json?.caption ?? manifestRecord.caption,
              queue.output_json?.hashtags ?? manifestRecord.hashtags
            );
            assetCount = 1;
            publishInput = { ...baseInput, deliveryFormat, videoUrl, caption };
            break;
          }
        }
        requestMetadata = {
          mode: "meta_graph",
          channel: queue.channel,
          manifestUrl: queue.rendered_manifest_url,
          deliveryFormat,
          assetCount
        };
        const publishResult = await publishInstagramOutput(publishInput);
        externalPublishSucceeded = true;
        externalPostId = publishResult.externalPostId;
        publishedUrl = publishResult.publishedUrl;
        responseMetadata = { publishedUrl, externalPostId };
      }

      const completedAttempt = await pool.query(
        `update publish_attempts
         set status = 'succeeded', request_metadata = $3, response_metadata = $4,
             external_post_id = $5, external_url = $6, finished_at = coalesce(finished_at, now())
         where id = $1 and publish_queue_id = $2 and status in ('running', 'succeeded')
         returning id`,
        [
          queue.attempt_id,
          queueId,
          JSON.stringify(requestMetadata),
          JSON.stringify(responseMetadata),
          externalPostId,
          publishedUrl,
        ],
      );
      if (!completedAttempt.rowCount) throw new Error("publish_attempt_checkpoint_failed");
      const updated = await pool.query(
        `with completed_queue as (
           update publish_queue
           set status = 'published',
               published_at = now(),
               last_error = null,
               updated_at = now()
           where id = $1 and status in ('publishing', 'published')
             and exists (
               select 1 from publish_attempts
               where id = $2 and publish_queue_id = $1 and status = 'succeeded'
             )
           returning id, status
         ), updated_channel as (
           update brand_channels
           set last_published_at = now(), status = 'connected', last_error = null
           where brand_id = $3 and channel = $4 and exists (select 1 from completed_queue)
           returning id
         )
         select id, status from completed_queue`,
        [
          queueId,
          queue.attempt_id,
          queue.brand_id,
          queue.channel
        ]
      );
      if (!updated.rowCount) throw new Error("publish_queue_finalize_failed");
      return { id: updated.rows[0].id, status: updated.rows[0].status, publishedUrl };
    } catch (error) {
      if (externalPublishSucceeded) {
        await pool.query(
          `with completed_queue as (
             update publish_queue
             set status = 'published', published_at = coalesce(published_at, now()),
                 last_error = null, updated_at = now()
             where id = $1 and status = 'publishing'
               and exists (
                 select 1 from publish_attempts
                 where id = $2 and publish_queue_id = $1 and status = 'succeeded'
               )
             returning id
           )
           update brand_channels
           set last_published_at = now(), status = 'connected', last_error = null
           where brand_id = $3 and channel = $4 and exists (select 1 from completed_queue)`,
          [queueId, queue.attempt_id, queue.brand_id, queue.channel],
        ).catch(() => undefined);
      } else {
        const classification = deferredProviderFailure
          ? {
              errorCode: deferredProviderFailure.errorCode,
              retryable: deferredProviderFailure.retryable,
              channelNeedsAttention: deferredProviderFailure.errorCode === "oauth_required"
            }
          : classifyMetaGraphPublishError(error);
        await pool.query(
          `with failed_attempt as (
             update publish_attempts
             set status = 'failed', error_code = $3, error_message = $3,
                 response_metadata = jsonb_build_object('retryable', $4::boolean), finished_at = now()
             where id = $1 and publish_queue_id = $2 and status = 'running'
             returning id
           ), failed_queue as (
             update publish_queue
             set status = case when $4::boolean then 'scheduled' else 'failed' end,
                 scheduled_for = case when $4::boolean then now() + interval '5 minutes' else scheduled_for end,
                 failed_at = case when $4::boolean then null else now() end,
                 last_error = $3, updated_at = now()
             where id = $2 and status = 'publishing' and exists (select 1 from failed_attempt)
             returning id
           ), attention_channel as (
             update brand_channels
             set status = 'needs_attention', last_error = $3
             where brand_id = $6 and channel = $7 and $5::boolean
               and exists (select 1 from failed_queue)
             returning id
           )
           select id from failed_queue`,
          [
            queue.attempt_id,
            queueId,
            classification.errorCode,
            classification.retryable,
            classification.channelNeedsAttention,
            queue.brand_id,
            queue.channel
          ]
        ).catch(() => undefined);
      }
      throw error;
    }
  }

  return {
    ...instagramTrendRepository,
    async health() {
      await pool.query("select 1");
      return { database: "ok" };
    },

    async getBillingSummary(brandId) {
      const brand = await pool.query(
        "select id from brands where id = $1 and deleted_at is null",
        [brandId]
      );
      if (!brand.rowCount) throw new Error("brand_billing_not_found");

      return {
        configured: false,
        subscription: {
          status: "none",
          planName: null,
          monthlyAmount: null,
          currency: "KRW",
          currentPeriodEnd: null,
          nextBillingAt: null,
          cancelAtPeriodEnd: false,
          suspensionReason: null
        },
        entitlement: { active: false, source: null, expiresAt: null },
        paymentMethod: null,
        payments: []
      } satisfies BillingSummaryDto;
    },

    async getBrandUiStatus(brandId) {
      const result = await pool.query(
        `select b.id as brand_id,
                b.name as brand_name,
                bp.primary_category_id,
                bp.primary_customer,
                bp.description,
                bp.tone,
                bp.default_cta,
                bp.main_link,
                bp.auto_approval_enabled,
                bp.logo_url,
                (select count(*) from source_urls su where su.brand_id = b.id and su.source_type = 'owned' and su.enabled = true and su.deleted_at is null) as owned_source_count,
                (select count(*) from source_urls su where su.brand_id = b.id and su.source_type = 'reference' and su.enabled = true and su.deleted_at is null) as reference_source_count,
                (select count(*) from topic_rows tr where tr.brand_id = b.id and tr.status in ('uploaded', 'queued', 'used')) as topic_row_count,
                coalesce((select bc.status from brand_channels bc where bc.brand_id = b.id and bc.channel = 'instagram' and bc.deleted_at is null limit 1), 'not_connected') as instagram_status,
                coalesce((select bc.status from brand_channels bc where bc.brand_id = b.id and bc.channel = 'threads' and bc.deleted_at is null limit 1), 'not_connected') as threads_status,
                (select count(*) from channel_outputs co where co.brand_id = b.id and co.status <> 'regenerated') as content_output_count,
                (select count(*) from channel_outputs co where co.brand_id = b.id and co.status in ('pending_review', 'auto_approval_blocked', 'generation_failed')) as content_review_count,
                (select count(*) from publish_queue pq where pq.brand_id = b.id and pq.status = 'failed') as publish_issue_count,
                (select count(*) from brand_channels bc where bc.brand_id = b.id and bc.channel in ('instagram', 'threads', 'x', 'linkedin', 'youtube', 'tiktok') and bc.deleted_at is null and bc.status != 'connected') as channel_issue_count,
                (select max(co.generated_at) from channel_outputs co where co.brand_id = b.id) as last_generated_at
         from brands b
         left join brand_profiles bp on bp.brand_id = b.id
         where b.id = $1 and b.deleted_at is null`,
        [brandId]
      );
      if (!result.rowCount) throw new Error("brand_ui_status_not_found");
      return buildBrandUiStatus(result.rows[0]);
    },

    async getBrandProfile(brandId) {
      const result = await pool.query(
        `select bp.id as profile_id, bp.workspace_id, b.id as brand_id, b.name as brand_name,
                category.code as category_code, category.name as category_name,
                bp.description, bp.primary_customer, bp.tone, bp.default_cta, bp.main_link,
                bp.auto_approval_enabled, bp.logo_url,
                coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'type', case when selected.subcategory_id is null then 'custom' else 'system' end,
                      'code', subcategory.code,
                      'name', coalesce(subcategory.name, selected.custom_name),
                      'createdAt', selected.created_at
                    )
                    order by selected.created_at, coalesce(subcategory.name, selected.custom_name), selected.id
                  )
                  from brand_profile_subcategories selected
                  left join content_subcategories subcategory on subcategory.id = selected.subcategory_id
                  where selected.brand_profile_id = bp.id
                ), '[]'::jsonb) as subcategories
         from brands b
         join brand_profiles bp on bp.brand_id = b.id
         left join content_categories category on category.id = bp.primary_category_id
         where b.id = $1 and b.deleted_at is null`,
        [brandId]
      );
      if (!result.rowCount) throw new Error("brand_profile_not_found");
      return mapProfile(result.rows[0]);
    },

    async updateBrandProfile(brandId, input: BrandProfileInput) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const locked = await client.query(
          `select bp.id as profile_id, bp.workspace_id, bp.brand_id, bp.primary_category_id
           from brand_profiles bp
           join brands b on b.id = bp.brand_id and b.deleted_at is null
           where bp.brand_id = $1
           for update of bp`,
          [brandId]
        );
        if (!locked.rowCount) throw new Error("brand_profile_not_found");
        const profile = locked.rows[0];
        let primaryCategoryId = profile.primary_category_id as string | null;
        if (input.primaryCategoryCode !== undefined) {
          if (input.primaryCategoryCode === null) {
            primaryCategoryId = null;
          } else {
            const category = await client.query(
              `select id, code, name from content_categories where code = $1 and active = true`,
              [input.primaryCategoryCode]
            );
            if (!category.rowCount) throw new Error("invalid_primary_category");
            primaryCategoryId = category.rows[0].id;
          }
        }

        if (input.subcategories !== undefined || input.primaryCategoryCode !== undefined) {
          const selectedSubcategories = input.subcategories ?? [];
          if (!primaryCategoryId && selectedSubcategories.length > 0) throw new Error("invalid_primary_category");
          if (selectedSubcategories.length > 5) throw new Error("too_many_subcategories");
          const systemInputs = selectedSubcategories.filter((item) => item.type === "system");
          const customInputs = selectedSubcategories.filter((item) => item.type === "custom");
          const normalizedCustom = customInputs.map((item) => normalizeCustomSubcategory(item.name));
          if (normalizedCustom.some((item) => item.name.length < 1 || Array.from(item.name).length > 30)) {
            throw new Error("brand_subcategory_too_long");
          }
          const customKeys = normalizedCustom.map((item) => item.key);
          if (new Set(customKeys).size !== customKeys.length) throw new Error("duplicate_subcategory");

          const systemCodes = systemInputs.map((item) => item.code);
          if (new Set(systemCodes).size !== systemCodes.length) throw new Error("duplicate_subcategory");
          let systemRows: any[] = [];
          if (systemCodes.length > 0) {
            const system = await client.query(
              `select id, category_id, code, name
               from content_subcategories
               where code = any($1::text[]) and active = true`,
              [systemCodes]
            );
            systemRows = system.rows;
            if (new Set(systemRows.map((row) => row.code)).size !== new Set(systemCodes).size) {
              throw new Error("invalid_subcategory");
            }
            if (systemRows.some((row) => row.category_id !== primaryCategoryId)) {
              throw new Error("subcategory_category_mismatch");
            }
          }
          const displayKeys = [
            ...systemRows.map((row) => String(row.name).normalize("NFKC").trim().toLocaleLowerCase("ko-KR")),
            ...customKeys
          ];
          if (new Set(displayKeys).size !== displayKeys.length) throw new Error("duplicate_subcategory");

          await client.query(`delete from brand_profile_subcategories where brand_profile_id = $1`, [profile.profile_id]);
          for (const row of systemRows) {
            await client.query(
              `insert into brand_profile_subcategories
                 (workspace_id, brand_id, brand_profile_id, subcategory_id)
               values ($1, $2, $3, $4)`,
              [profile.workspace_id, brandId, profile.profile_id, row.id]
            );
          }
          for (const item of normalizedCustom) {
            await client.query(
              `insert into brand_profile_subcategories
                 (workspace_id, brand_id, brand_profile_id, custom_name, custom_key)
               values ($1, $2, $3, $4, $5)`,
              [profile.workspace_id, brandId, profile.profile_id, item.name, item.key]
            );
          }
        }
        if (input.name !== undefined) {
          await client.query("update brands set name = $2 where id = $1", [brandId, input.name]);
        }
        await client.query(
          `update brand_profiles
           set primary_category_id = $2,
               primary_customer = coalesce($3, primary_customer),
               description = coalesce($4, description),
               tone = coalesce($5, tone),
               default_cta = coalesce($6, default_cta),
               main_link = coalesce($7, main_link),
               auto_approval_enabled = coalesce($8, auto_approval_enabled)
           where brand_id = $1`,
          [
            brandId,
            primaryCategoryId,
            input.primaryCustomer,
            input.description,
            input.tone,
            input.defaultCta,
            input.mainLink,
            input.autoApprovalEnabled
          ]
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
      return this.getBrandProfile(brandId);
    },

    async listInstagramFormats(brandId) {
      await ensureInstagramFormatDefaults(pool, brandId);
      return readInstagramFormatSettings(pool, brandId);
    },

    async updateInstagramFormats(brandId, input: InstagramFormatSettingsInput) {
      const brandColor = input.brandColor === undefined
        ? undefined
        : input.brandColor?.trim() || null;
      if (brandColor !== undefined && brandColor !== null && brandColor.length > 30) {
        throw new Error("brand_color_too_long");
      }

      const client = await pool.connect();
      let gateRejected = false;
      let updatedSettings: InstagramFormatSettingsDto | undefined;
      try {
        await client.query("begin");
        await ensureInstagramFormatDefaults(client, brandId);
        const storyContext = await lockInstagramStoryContext(client, brandId);
        const enablesStory = input.formats?.some((item) => item.format === "instagram_story" && item.enabled) ?? false;
        if (enablesStory) {
          const capability = evaluateLockedInstagramStory(storyContext);
          if (capability.status !== "available") {
            const invalidated = await client.query(
              `update brand_content_formats
               set enabled = case when $3 = 'available' then enabled else false end,
                   capability_status = $3,
                   capability_checked_at = now(),
                   capability_metadata = $4::jsonb,
                   last_error = $5
               where brand_id = $1 and format = $2`,
              [brandId, "instagram_story", capability.status, JSON.stringify(capability.metadata), capability.reason]
            );
            if (!invalidated.rowCount) throw new Error("brand_profile_not_found");
            await client.query("commit");
            gateRejected = true;
          }
        }
        if (!gateRejected) {
          await readInstagramFormatSettings(client, brandId, true);

          if (brandColor !== undefined) {
            await client.query(
              "update brand_profiles set brand_color = $2 where brand_id = $1",
              [brandId, brandColor]
            );
          }
          for (const format of input.formats ?? []) {
            await client.query(
              `update brand_content_formats
               set enabled = $3
               where brand_id = $1 and format = $2`,
              [brandId, format.format, format.enabled]
            );
          }
          updatedSettings = await readInstagramFormatSettings(client, brandId);
          await client.query("commit");
        }
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
      if (gateRejected) throw new StoryCapabilityRequiredError();
      return updatedSettings!;
    },

    async checkInstagramCapability(brandId, format: InstagramDeliveryFormat) {
      if (format !== "instagram_story") {
        throw new Error("instagram_capability_check_not_supported");
      }
      const client = await pool.connect();
      try {
        await client.query("begin");
        await ensureInstagramFormatDefaults(client, brandId);
        const context = await lockInstagramStoryContext(client, brandId);
        const capability = evaluateLockedInstagramStory(context);
        const updated = await client.query(
          `update brand_content_formats
           set enabled = case when $3 = 'available' then enabled else false end,
               capability_status = $3,
               capability_checked_at = now(),
               capability_metadata = $4::jsonb,
               last_error = $5
           where brand_id = $1 and format = $2
           returning format, enabled, rotation_order, capability_status,
                     capability_checked_at, capability_metadata, last_error`,
          [brandId, format, capability.status, JSON.stringify(capability.metadata), capability.reason]
        );
        if (!updated.rowCount) throw new Error("brand_profile_not_found");
        await client.query("commit");
        return mapBrandContentFormat(updated.rows[0]);
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async listSources(brandId) {
      const result = await pool.query(
        `select id, brand_id, source_type, url, title, status, enabled, last_crawled_at, last_error
         from source_urls
         where brand_id = $1 and deleted_at is null
         order by created_at desc`,
        [brandId]
      );
      return result.rows.map(mapSource);
    },

    async listSourceSnapshots(brandId) {
      const result = await pool.query(
        `select ss.id,
                ss.source_url_id,
                ss.source_content_item_id,
                su.source_type,
                coalesce(sci.content_url, su.url) as url,
                coalesce(ss.extracted_title, sci.title, su.title) as title,
                ss.status,
                ss.fetched_at,
                ss.summary,
                ss.error_message
         from source_snapshots ss
         join source_urls su on su.id = ss.source_url_id
         left join source_content_items sci on sci.id = ss.source_content_item_id and sci.deleted_at is null
         where ss.brand_id = $1
           and su.deleted_at is null
           and ss.source_content_item_id is not null
           and sci.id is not null
         order by ss.fetched_at desc
         limit 100`,
        [brandId]
      );
      return result.rows.map(mapSourceSnapshot);
    },

    async listSourceCrawlRuns(brandId) {
      const result = await pool.query(
        `select id, brand_id, source_url_id, trigger, status, attempt,
                processed_count, created_count, updated_count, failed_count,
                started_at, finished_at, next_retry_at, last_error
         from source_crawl_runs
         where brand_id = $1
         order by created_at desc
         limit 50`,
        [brandId]
      );
      return result.rows.map(mapSourceCrawlRun);
    },

    async createSource(brandId, input: SourceInput) {
      const normalizedUrl = normalizeSourceUrl(input.url);
      const brand = await pool.query("select workspace_id from brands where id = $1", [brandId]);
      if (!brand.rowCount) throw new Error("brand_not_found");
      if (input.sourceType === "reference") {
        await ensureReferenceSourceCapacity(pool, brandId);
      }

      const result = await pool.query(
        `insert into source_urls (workspace_id, brand_id, source_type, url, url_hash, domain, status)
         values ($1, $2, $3, $4, $5, $6, 'active')
         returning id, brand_id, source_type, url, title, status, enabled, last_crawled_at, last_error`,
        [brand.rows[0].workspace_id, brandId, input.sourceType, normalizedUrl, hashSourceUrl(normalizedUrl), normalizeDomain(normalizedUrl)]
      );
      return mapSource(result.rows[0]);
    },

    async createSourceWithInitialCrawl(brandId, input: SourceInput) {
      const source = await this.createSource(brandId, input);
      const initialCrawl = await this.crawlSingleSource(brandId, source.id, "new_source");
      return { source, initialCrawl };
    },

    async updateSource(sourceId, input: SourceUpdateInput) {
      if (!input.sourceType && !input.url?.trim() && input.enabled === undefined) throw new Error("source_update_required");
      const trimmedUrl = input.url?.trim();
      const normalizedUrl = trimmedUrl ? normalizeSourceUrl(trimmedUrl) : null;
      if (input.sourceType === "reference") {
        const source = await pool.query("select brand_id from source_urls where id = $1", [sourceId]);
        if (!source.rowCount) throw new Error("source_not_found");
        await ensureReferenceSourceCapacity(pool, source.rows[0].brand_id, sourceId);
      }
      const result = await pool.query(
        `update source_urls
         set source_type = coalesce($2, source_type),
             url = coalesce($3, url),
             url_hash = case when $3 is null then url_hash else $4 end,
             domain = case when $3 is null then domain else $5 end,
             enabled = coalesce($6, enabled),
             status = case
               when $6 = false then 'disabled'
               when $6 = true then 'active'
               when $3 is not null then 'active'
               else status
             end,
             disabled_at = case when $6 = false then now() when $6 = true then null else disabled_at end,
             last_crawled_at = case when $3 is null then last_crawled_at else null end,
             last_error = case when $6 = true or $3 is not null then null else last_error end
         where id = $1 and deleted_at is null
         returning id, brand_id, source_type, url, title, status, enabled, last_crawled_at, last_error`,
        [sourceId, input.sourceType ?? null, normalizedUrl, normalizedUrl ? hashSourceUrl(normalizedUrl) : null, normalizedUrl ? normalizeDomain(normalizedUrl) : null, input.enabled ?? null]
      );
      if (!result.rowCount) throw new Error("source_not_found");
      return mapSource(result.rows[0]);
    },

    async deleteSource(sourceId) {
      const result = await pool.query(
        `update source_urls
         set deleted_at = now(),
             enabled = false,
             status = 'disabled'
         where id = $1 and deleted_at is null
         returning id`,
        [sourceId]
      );
      if (!result.rowCount) throw new Error("source_not_found");
      return { id: result.rows[0].id };
    },

    async listChannels(brandId) {
      const result = await pool.query(
        `select bc.channel, bc.enabled, bc.status, bc.account_label, bc.last_healthy_at, bc.last_published_at, bc.last_error,
                exists (
                  select 1
                  from channel_credentials cc
                  where cc.brand_channel_id = bc.id
                    and cc.status = 'active'
                    and cc.revoked_at is null
                    and (cc.expires_at is null or cc.expires_at > now())
                ) as has_active_credentials
         from brand_channels bc
         where bc.brand_id = $1 and bc.deleted_at is null`,
        [brandId]
      );
      const rowsByChannel = new Map(result.rows.map((row) => [row.channel, row]));
      return channelCatalog.map(({ channel }) => mapChannel(rowsByChannel.get(channel) ?? {
        channel,
        enabled: false,
        status: "not_connected",
        has_active_credentials: false,
        account_label: null,
        last_healthy_at: null,
        last_published_at: null,
        last_error: null
      }));
    },

    async updateChannelEnabled(brandId, channel, enabled) {
      const result = await pool.query(
        `update brand_channels bc
         set enabled = $3
         where bc.brand_id = $1 and bc.channel = $2 and bc.deleted_at is null
         returning bc.channel, bc.enabled, bc.status, bc.account_label, bc.last_healthy_at, bc.last_published_at, bc.last_error,
                   exists (
                     select 1
                     from channel_credentials cc
                     where cc.brand_channel_id = bc.id
                       and cc.status = 'active'
                       and cc.revoked_at is null
                       and (cc.expires_at is null or cc.expires_at > now())
                   ) as has_active_credentials`,
        [brandId, channel, enabled]
      );
      if (!result.rowCount) throw new Error("channel_not_found");
      return mapChannel(result.rows[0]);
    },

    async getChannelConnectionRequest(brandId) {
      const result = await pool.query(
        `select id,
                brand_id,
                status,
                instagram_handle,
                instagram_profile_url,
                facebook_page_url,
                meta_business_name,
                threads_profile_url,
                contact_name,
                contact_email,
                has_admin_access,
                request_note,
                submitted_at,
                updated_at
         from channel_connection_requests
         where brand_id = $1`,
        [brandId]
      );
      return mapChannelConnectionRequest(result.rows[0] ?? null, brandId);
    },

    async updateChannelConnectionRequest(brandId, input: ChannelConnectionRequestInput) {
      const brand = await pool.query("select workspace_id from brands where id = $1 and deleted_at is null", [brandId]);
      if (!brand.rowCount) throw new Error("brand_not_found");

      const status = input.submit ? "submitted" : "draft";
      const result = await pool.query(
        `insert into channel_connection_requests (
           workspace_id,
           brand_id,
           instagram_handle,
           instagram_profile_url,
           facebook_page_url,
           meta_business_name,
           threads_profile_url,
           contact_name,
           contact_email,
           has_admin_access,
           request_note,
           status,
           submitted_at
         )
         values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
           case when $12 = 'submitted' then now() else null end
         )
         on conflict (brand_id)
         do update set
           instagram_handle = excluded.instagram_handle,
           instagram_profile_url = excluded.instagram_profile_url,
           facebook_page_url = excluded.facebook_page_url,
           meta_business_name = excluded.meta_business_name,
           threads_profile_url = excluded.threads_profile_url,
           contact_name = excluded.contact_name,
           contact_email = excluded.contact_email,
           has_admin_access = excluded.has_admin_access,
           request_note = excluded.request_note,
           status = excluded.status,
           submitted_at = case
             when excluded.status = 'submitted' then coalesce(channel_connection_requests.submitted_at, now())
             else channel_connection_requests.submitted_at
           end
         returning id,
                   brand_id,
                   status,
                   instagram_handle,
                   instagram_profile_url,
                   facebook_page_url,
                   meta_business_name,
                   threads_profile_url,
                   contact_name,
                   contact_email,
                   has_admin_access,
                   request_note,
                   submitted_at,
                   updated_at`,
        [
          brand.rows[0].workspace_id,
          brandId,
          optionalText(input.instagramHandle),
          optionalText(input.instagramProfileUrl),
          optionalText(input.facebookPageUrl),
          optionalText(input.metaBusinessName),
          optionalText(input.threadsProfileUrl),
          optionalText(input.contactName),
          optionalText(input.contactEmail),
          input.hasAdminAccess ?? false,
          optionalText(input.requestNote),
          status
        ]
      );
      return mapChannelConnectionRequest(result.rows[0], brandId);
    },

    async saveChannelCredentials(brandId, channel: Channel, input: CredentialInput) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const connectionStatus = input.connectionStatus ?? "needs_attention";
        const lastError = connectionStatus === "connected" ? null : "연결 확인이 필요합니다.";
        let brandChannel: Record<string, unknown>;
        if (channel === "instagram") {
          await ensureInstagramFormatDefaults(client, brandId);
          const storyContext = await lockInstagramStoryContext(client, brandId);
          if (!storyContext.channel) throw new Error("channel_not_found");
          brandChannel = storyContext.channel;
        } else {
          const channelResult = await client.query(
            `select id, workspace_id
             from brand_channels
             where brand_id = $1 and channel = $2 and deleted_at is null
             for update`,
            [brandId, channel]
          );
          if (!channelResult.rowCount) throw new Error("channel_not_found");
          brandChannel = channelResult.rows[0];
          await client.query(
            `select id
             from channel_credentials
             where brand_channel_id = $1 and revoked_at is null
             order by created_at desc
             limit 1
             for update`,
            [brandChannel.id]
          );
        }
        await client.query(
          `update channel_credentials
           set status = 'revoked', revoked_at = now()
           where brand_channel_id = $1 and revoked_at is null`,
          [brandChannel.id]
        );
        await client.query(
          `insert into channel_credentials (
             workspace_id, brand_id, brand_channel_id, provider, credential_type, encrypted_payload,
             masked_display, scopes, expires_at, status, auth_mode
           )
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10)
           returning id`,
          [
            brandChannel.workspace_id,
            brandId,
            brandChannel.id,
            input.provider ?? "meta",
            input.credentialType ?? "oauth",
            encryptCredential(input.secretValue),
            input.maskedDisplay ?? null,
            input.scopes ?? [],
            input.expiresAt ?? null,
            input.authMode ?? "facebook_login"
          ]
        );
        await client.query(
          `update brand_channels
           set status = $5,
               account_label = coalesce($3, account_label),
               external_account_id = coalesce($4, external_account_id),
               last_error = $6,
               last_healthy_at = case when $5 = 'connected' then now() else last_healthy_at end
           where brand_id = $1 and channel = $2`,
          [brandId, channel, input.accountLabel ?? null, input.externalAccountId ?? null, connectionStatus, lastError]
        );
        if (channel === "instagram") {
          await invalidateLockedInstagramStory(client, brandId, "credential_changed");
        }
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
      const channels = await this.listChannels(brandId);
      return channels.find((item) => item.channel === channel)!;
    },

    async checkChannel(brandId, channel: Channel) {
      if (channel !== "instagram") {
        const result = await pool.query(
          `with credential_state as (
             select exists (
               select 1
               from brand_channels bc_inner
               join channel_credentials cc on cc.brand_channel_id = bc_inner.id
               where bc_inner.brand_id = $1
                 and bc_inner.channel = $2
                 and bc_inner.deleted_at is null
                 and cc.status = 'active'
                 and cc.revoked_at is null
                 and (cc.expires_at is null or cc.expires_at > now())
             ) as has_active_credentials
           )
           update brand_channels bc
           set status = case
                 when credential_state.has_active_credentials then 'needs_attention'
                 when bc.status in ('needs_attention', 'expired', 'insufficient_permissions', 'mapping_required', 'publish_failed') then 'needs_attention'
                 else 'not_connected'
               end,
               last_healthy_at = bc.last_healthy_at,
               last_error = case
                 when credential_state.has_active_credentials then 'provider_check_not_implemented'
                 else coalesce(bc.last_error, 'credential_missing')
               end
           from credential_state
           where bc.brand_id = $1 and bc.channel = $2 and bc.deleted_at is null
           returning bc.channel, bc.enabled, bc.status, bc.account_label, bc.last_healthy_at, bc.last_published_at, bc.last_error,
                     credential_state.has_active_credentials`,
          [brandId, channel]
        );
        if (!result.rowCount) throw new Error("channel_not_found");
        return mapChannel(result.rows[0]);
      }

      const client = await pool.connect();
      try {
        await client.query("begin");
        await ensureInstagramFormatDefaults(client, brandId);
        const context = await lockInstagramStoryContext(client, brandId);
        if (!context.channel) throw new Error("channel_not_found");
        const channelState = localInstagramChannelState(context);
        await invalidateLockedInstagramStory(client, brandId, "channel_changed");
        const result = await client.query(
          `update brand_channels
           set status = $3, last_error = $4
           where brand_id = $1 and channel = $2
           returning channel, enabled, status, account_label, last_healthy_at, last_published_at, last_error`,
          [brandId, channel, channelState.status, channelState.lastError]
        );
        if (!result.rowCount) throw new Error("channel_not_found");
        await client.query("commit");
        return mapChannel({ ...result.rows[0], has_active_credentials: Boolean(context.credential) });
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async createSupportRequest(brandId: string, input: SupportRequestInput) {
      const brand = await pool.query("select workspace_id from brands where id = $1 and deleted_at is null", [brandId]);
      if (!brand.rowCount) throw new Error("brand_not_found");
      const result = await pool.query(
        `insert into support_requests (workspace_id, brand_id, category, title, message, contact_email, status)
         values ($1, $2, $3, $4, $5, $6, 'new')
         returning id, workspace_id, brand_id, category, title, message, contact_email, status, created_at, updated_at`,
        [
          brand.rows[0].workspace_id,
          brandId,
          input.category,
          input.title.trim(),
          input.message.trim(),
          optionalText(input.contactEmail ?? null)
        ]
      );
      return mapSupportRequest(result.rows[0]);
    },

    async listSupportRequests(brandId: string) {
      const result = await pool.query(
        `select id, workspace_id, brand_id, category, title, message, contact_email, status, created_at, updated_at
         from support_requests
         where brand_id = $1 and deleted_at is null
         order by created_at desc`,
        [brandId]
      );
      return result.rows.map(mapSupportRequest);
    },

    async updateSupportRequestStatus(requestId: string, status: SupportRequestStatus) {
      const result = await pool.query(
        `update support_requests
         set status = $2
         where id = $1 and deleted_at is null
         returning id, workspace_id, brand_id, category, title, message, contact_email, status, created_at, updated_at`,
        [requestId, status]
      );
      if (!result.rowCount) throw new Error("support_request_not_found");
      return mapSupportRequest(result.rows[0]);
    },

    async listContentOutputs(brandId) {
      const result = await pool.query(
        `select id, master_draft_id as content_id, title, channel, delivery_format, status, preview_title, preview_body,
                output_json, source_summary, block_reasons, generated_at
         from channel_outputs
         where brand_id = $1
           and status <> 'regenerated'
         order by generated_at desc`,
        [brandId]
      );
      return result.rows.map((row): ContentOutputDto => ({
        id: row.id,
        contentId: row.content_id,
        title: row.title,
        channel: row.channel,
        deliveryFormat: row.delivery_format,
        status: row.status,
        previewTitle: row.preview_title,
        previewBody: row.preview_body,
        sourceSummary: row.source_summary,
        outputJson: row.output_json ?? {},
        sourceMode: nullableText(row.output_json?.sourceMode),
        blockReasons: row.block_reasons ?? [],
        generatedAt: toIso(row.generated_at)!
      }));
    },

    async reviewContentOutput(outputId, action, reason) {
      const status = action === "approve" ? "approved" : action === "reject" ? "rejected" : "regenerating";
      const reviewableStatuses = action === "approve"
        ? ["pending_review", "auto_approval_blocked"]
        : ["pending_review", "auto_approval_blocked", "generation_failed"];
      const client = await pool.connect();
      try {
        await client.query("begin");
        if (action === "regenerate") {
          const capability = await client.query(
            `select channel from channel_outputs
             where id = $1 and status = any($2::text[])
             for update`,
            [outputId, reviewableStatuses]
          );
          const capabilityRow = capability.rows[0];
          if (!capability.rowCount || !capabilityRow) throw new Error("content_output_not_reviewable");
          if (capabilityRow.channel !== "instagram" && capabilityRow.channel !== "threads") {
            throw new Error("content_output_regeneration_not_supported");
          }
        }
        const result = await client.query(
          `with updated as (
             update channel_outputs
             set status = $2,
                 approved_at = case when $2 = 'approved' then now() else approved_at end,
                 rejected_at = case when $2 = 'rejected' then now() else rejected_at end
             where id = $1
               and status = any($3::text[])
             returning id, status, workspace_id, brand_id, content_topic_id, master_draft_id,
                       channel, delivery_format, title, output_json, source_summary, rendered_artifact_id
           )
             select updated.*, bc.id as brand_channel_id, tpg.id as topic_publish_group_id,
                    b.name as brand_name, category.code as category_code, category.name as category_name,
                    coalesce((select jsonb_agg(jsonb_build_object(
                      'type', case when selected.subcategory_id is null then 'custom' else 'system' end,
                      'code', subcategory.code,
                      'name', coalesce(subcategory.name, selected.custom_name)
                    ) order by selected.created_at, coalesce(subcategory.name, selected.custom_name), selected.id)
                    from brand_profile_subcategories selected
                    left join content_subcategories subcategory on subcategory.id = selected.subcategory_id
                    where selected.brand_profile_id = bp.id), '[]'::jsonb) as subcategories,
                    bp.primary_customer, bp.description, bp.tone, bp.brand_color,
                    md.draft_json, ct.title as topic_title, ct.angle as topic_angle,
                    tr.target_customer, tr.region, tr.season, tr.reference_url, tr.notes,
                    (
                      select sci.content_url
                      from source_snapshots ss
                      join source_content_items sci on sci.id = ss.source_content_item_id and sci.deleted_at is null
                      where ss.id::text = coalesce(
                        ct.source_context ->> 'sourceSnapshotId',
                        ct.source_context -> 'sourceSnapshotIds' ->> 0
                      )
                      limit 1
                    ) as crawl_content_url
            from updated
            join brands b on b.id = updated.brand_id and b.deleted_at is null
            join brand_channels bc on bc.brand_id = updated.brand_id and bc.channel = updated.channel and bc.deleted_at is null
            join topic_publish_groups tpg on tpg.content_topic_id = updated.content_topic_id
            join brand_profiles bp on bp.brand_id = updated.brand_id
            left join content_categories category on category.id = bp.primary_category_id
            join master_drafts md on md.id = updated.master_draft_id
            join content_topics ct on ct.id = updated.content_topic_id
            left join topic_rows tr on tr.id = ct.topic_row_id`,
          [outputId, status, reviewableStatuses]
        );
        if (!result.rowCount) throw new Error("content_output_not_reviewable");
        const output = result.rows[0];
        const outputJson = recordValue(output.output_json);
        let response = { id: output.id as string, status: output.status as string };
        if (
          action === "approve"
          && (nullableText(outputJson.generationState) === "pending" || nullableText(outputJson.artifactStatus) === "pending")
        ) {
          throw new Error("content_output_artifact_not_ready");
        }
        await client.query(
          `insert into review_events (workspace_id, brand_id, channel_output_id, actor_type, event_type, reason)
           values ($1, $2, $3, 'user', $4, $5)`,
          [output.workspace_id, output.brand_id, outputId, action === "approve" ? "approved" : action === "reject" ? "rejected" : "regenerate_requested", reason ?? null]
        );
        if (action === "regenerate") {
          await client.query(
            `update channel_outputs
             set status = 'regenerated', updated_at = now()
             where id = $1`,
            [outputId]
          );
          const resetGroup = await client.query(
            `update topic_publish_groups
             set status = 'waiting', slot_date = null, slot_number = null,
                 scheduled_for = null, updated_at = now()
             where id = $1 and status <> 'publishing'
             returning id`,
            [output.topic_publish_group_id]
          );
          if (!resetGroup.rowCount) throw new Error("content_output_regeneration_publish_in_progress");
          const draft = recordValue(output.draft_json);
          const topicTitle = nullableText(output.topic_title)
            ?? nullableText(draft.title)
            ?? nullableText(output.title)
            ?? "";
          const topicAngle = nullableText(output.topic_angle)
            ?? nullableText(draft.contentTheme)
            ?? topicTitle;
          const topicContext = {
            title: topicTitle,
            angle: topicAngle,
            targetCustomer: nullableText(output.target_customer),
            region: nullableText(output.region),
            season: nullableText(output.season),
            notes: nullableText(output.notes)
          };
          if (output.channel === "instagram") {
            const deliveryFormat = output.delivery_format as InstagramDeliveryFormat;
            if (!["instagram_feed_carousel", "instagram_story", "instagram_reel"].includes(deliveryFormat)) {
              throw new Error("instagram_delivery_format_invalid");
            }
            const regenerated = await client.query(
              `insert into channel_outputs (
                 workspace_id, brand_id, content_topic_id, master_draft_id, channel, delivery_format, status,
                 title, preview_title, preview_body, output_json, source_summary, block_reasons
               )
               values ($1, $2, $3, $4, $5, $6, 'generating', $7, $8, $9, $10, $11, $12)
               returning id`,
              [
                output.workspace_id,
                output.brand_id,
                output.content_topic_id,
                output.master_draft_id,
                output.channel,
                deliveryFormat,
                output.title,
                output.title,
                "작업자 아티팩트 생성 대기 중",
                JSON.stringify({ deliveryFormat, topic: { title: topicTitle, angle: topicAngle }, artifactStatus: "pending" }),
                output.source_summary,
                JSON.stringify([])
              ]
            );
            const regeneratedOutputId = regenerated.rows[0]?.id;
            if (!regeneratedOutputId) throw new Error("content_output_regeneration_failed");
            response = { id: regeneratedOutputId, status: "generating" };
            await createImageRenderJob(client as any, {
              workspaceId: output.workspace_id,
              brandId: output.brand_id,
              contentTopicId: output.content_topic_id,
              channelOutputId: regeneratedOutputId,
              deliveryFormat,
              topic: topicContext,
              brand: output,
              crawlContentUrl: nullableText(output.crawl_content_url),
              referenceUrl: nullableText(output.reference_url)
            });
          } else {
            const threadsCatalog = channelCatalog.find((entry) => entry.channel === "threads")!;
            const representativeUrl = nullableText(outputJson.representativeUrl)
              ?? nullableText(output.crawl_content_url)
              ?? nullableText(output.reference_url);
            const regenerated = await client.query(
              `insert into channel_outputs (
                 workspace_id, brand_id, content_topic_id, master_draft_id, channel, delivery_format, status,
                 title, preview_title, preview_body, output_json, source_summary, block_reasons
               )
               values ($1, $2, $3, $4, $5, $6, 'generating', $7, $8, $9, $10, $11, $12)
               returning id`,
              [
                output.workspace_id,
                output.brand_id,
                output.content_topic_id,
                output.master_draft_id,
                "threads",
                "threads_text",
                output.title,
                output.title,
                "Threads 콘텐츠 생성 대기 중",
                JSON.stringify({
                  deliveryFormat: "threads_text",
                  topic: { title: topicTitle, angle: topicAngle },
                  representativeUrl,
                  artifactKind: "text",
                  generationState: "pending",
                  channelConstraints: threadsCatalog.generationConstraints
                }),
                output.source_summary,
                JSON.stringify([])
              ]
            );
            const regeneratedOutputId = regenerated.rows[0]?.id;
            if (!regeneratedOutputId) throw new Error("content_output_regeneration_failed");
            response = { id: regeneratedOutputId, status: "generating" };
            await createThreadsRenderJob(client as any, {
              workspaceId: output.workspace_id,
              brandId: output.brand_id,
              channelOutputId: regeneratedOutputId,
              topic: topicContext,
              brand: output,
              crawlContentUrl: nullableText(output.crawl_content_url),
              referenceUrl: nullableText(output.reference_url)
            });
          }
        }
        if (action === "approve" && (output.channel !== "instagram" || output.rendered_artifact_id)) {
          await client.query(
            `insert into publish_queue (
               workspace_id, brand_id, channel_output_id, topic_publish_group_id, brand_channel_id, channel, approval_type, idempotency_key
             )
             values ($1, $2, $3, $4, $5, $6, 'manual', $7)
             on conflict (channel_output_id) do nothing`,
            [
              output.workspace_id,
              output.brand_id,
              outputId,
              output.topic_publish_group_id,
              output.brand_channel_id,
              output.channel,
              `manual:${outputId}`
            ]
          );
        }
        await client.query("commit");
        return response;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async listPublishQueue(brandId) {
      const result = await pool.query(
        `select pq.id,
                co.title,
                pq.channel,
                pq.status,
                pq.approval_type,
                pq.topic_publish_group_id,
                pq.slot_date,
                pq.slot_number,
                pq.scheduled_for,
                pq.last_error,
                pq.queued_at,
                tr.topic_title,
                tr.topic_angle,
                tr.reference_url,
                co.source_summary,
                (select j.status from jobs j where j.channel_output_id = co.id and j.job_type in ('instagram_feed_render', 'instagram_story_render', 'instagram_reel_render') order by j.created_at desc limit 1) as render_status,
                source_refs.source_urls
         from publish_queue pq
         join channel_outputs co on co.id = pq.channel_output_id
         left join content_topics ct on ct.id = co.content_topic_id
         left join topic_rows tr on tr.id = ct.topic_row_id
         left join lateral (
           select coalesce(array_agg(distinct coalesce(sci.content_url, su.url) order by coalesce(sci.content_url, su.url)), '{}'::text[]) as source_urls
           from jsonb_array_elements_text(
             case
               when ct.source_context ? 'sourceSnapshotId' then jsonb_build_array(ct.source_context ->> 'sourceSnapshotId')
               else coalesce(ct.source_context -> 'sourceSnapshotIds', '[]'::jsonb)
             end
           ) snapshot_ref(id)
           join source_snapshots ss on ss.id = snapshot_ref.id::uuid
           join source_urls su on su.id = ss.source_url_id
           left join source_content_items sci on sci.id = ss.source_content_item_id and sci.deleted_at is null
           where ss.source_content_item_id is null or sci.id is not null
         ) source_refs on true
         where pq.brand_id = $1
         order by pq.scheduled_for nulls last, pq.queued_at desc`,
        [brandId]
      );
      const waitingResult = await pool.query(
        `select ('topic:' || ct.id::text) as id,
                ct.title,
                'instagram'::text as channel,
                'empty'::text as status,
                'empty'::text as approval_type,
                null::uuid as topic_publish_group_id,
                null::date as slot_date,
                null::int as slot_number,
                null::timestamptz as scheduled_for,
                ct.error_message as last_error,
                ct.selected_at as queued_at,
                tr.topic_title,
                tr.topic_angle,
                tr.reference_url,
                null::text as source_summary,
                null::text as render_status,
                source_refs.source_urls
         from content_topics ct
         left join topic_rows tr on tr.id = ct.topic_row_id
         left join lateral (
           select coalesce(array_agg(distinct coalesce(sci.content_url, su.url) order by coalesce(sci.content_url, su.url)), '{}'::text[]) as source_urls
           from jsonb_array_elements_text(
             case
               when ct.source_context ? 'sourceSnapshotId' then jsonb_build_array(ct.source_context ->> 'sourceSnapshotId')
               else coalesce(ct.source_context -> 'sourceSnapshotIds', '[]'::jsonb)
             end
           ) snapshot_ref(id)
           join source_snapshots ss on ss.id = snapshot_ref.id::uuid
           join source_urls su on su.id = ss.source_url_id
           left join source_content_items sci on sci.id = ss.source_content_item_id and sci.deleted_at is null
           where ss.source_content_item_id is null or sci.id is not null
         ) source_refs on true
         where ct.brand_id = $1
           and ct.status = 'selected'
         order by ct.selected_at asc, ct.created_at asc`,
        [brandId]
      );
      return [...waitingResult.rows, ...result.rows].map((row): PublishQueueDto => ({
        id: row.id,
        title: row.title,
        channel: row.channel,
        status: row.status,
        approvalType: row.approval_type,
        topicPublishGroupId: row.topic_publish_group_id ?? null,
        slotDate: toDateKey(row.slot_date),
        slotNumber: row.slot_number === null || row.slot_number === undefined ? null : Number(row.slot_number),
        scheduledFor: toIso(row.scheduled_for),
        lastError: row.last_error,
        sourceType: publishQueueSourceType(row),
        sourceLabel: publishQueueSourceLabel(row),
        sourceDetail: publishQueueSourceDetail(row),
        sourceUrls: publishQueueSourceUrls(row),
        queuedAt: toIso(row.queued_at)!,
        renderStatus: row.render_status ?? null
      }));
    },

    async listPublishResults(brandId) {
      const result = await pool.query(
        `select co.master_draft_id as content_id,
                co.title as content_title,
                co.generated_at,
                pq.id as queue_id,
                co.id as channel_output_id,
                pq.channel,
                pq.status,
                pq.published_at,
                pq.failed_at,
                pq.last_error,
                co.title as channel_title,
                co.preview_title,
                co.preview_body,
                co.output_json,
                co.source_summary,
                sa.public_url as artifact_public_url,
                tr.topic_title,
                tr.topic_angle,
                tr.reference_url,
                source_refs.source_urls,
                latest_attempt.external_post_id,
                latest_attempt.external_url,
                latest_attempt.error_message as attempt_error_message
         from publish_queue pq
         join channel_outputs co on co.id = pq.channel_output_id
         left join storage_artifacts sa on sa.id = co.rendered_artifact_id
         left join content_topics ct on ct.id = co.content_topic_id
         left join topic_rows tr on tr.id = ct.topic_row_id
         left join lateral (
           select coalesce(array_agg(distinct coalesce(sci.content_url, su.url) order by coalesce(sci.content_url, su.url)), '{}'::text[]) as source_urls
           from jsonb_array_elements_text(
             case
               when ct.source_context ? 'sourceSnapshotId' then jsonb_build_array(ct.source_context ->> 'sourceSnapshotId')
               else coalesce(ct.source_context -> 'sourceSnapshotIds', '[]'::jsonb)
             end
           ) snapshot_ref(id)
           join source_snapshots ss on ss.id = snapshot_ref.id::uuid
           join source_urls su on su.id = ss.source_url_id
           left join source_content_items sci on sci.id = ss.source_content_item_id and sci.deleted_at is null
           where ss.source_content_item_id is null or sci.id is not null
         ) source_refs on true
         left join lateral (
            select pa.external_post_id, pa.external_url, pa.error_message
           from publish_attempts pa
           where pa.publish_queue_id = pq.id
           order by pa.finished_at desc nulls last, pa.created_at desc
           limit 1
         ) latest_attempt on true
         where pq.brand_id = $1
         order by co.generated_at desc, co.master_draft_id, pq.channel`,
        [brandId]
      );
      return mapPublishResults(result.rows);
    },

    async downloadPublishedResults(brandId) {
      const result = await pool.query(
        `select pq.id,
                pq.channel,
                pq.published_at,
                co.title,
                co.preview_title,
                co.preview_body,
                co.source_summary,
                co.output_json,
                sa.public_url as artifact_public_url,
                sa.bucket as artifact_bucket,
                sa.path as artifact_path,
                latest_attempt.external_url
         from publish_queue pq
         join channel_outputs co on co.id = pq.channel_output_id
         left join storage_artifacts sa on sa.id = co.rendered_artifact_id
         left join lateral (
           select pa.external_url
           from publish_attempts pa
           where pa.publish_queue_id = pq.id and pa.status = 'succeeded'
           order by pa.finished_at desc nulls last, pa.created_at desc
           limit 1
         ) latest_attempt on true
         where pq.brand_id = $1 and pq.status = 'published'
         order by pq.published_at desc nulls last, pq.queued_at desc`,
        [brandId]
      );
      return buildPublishedResultsPackage(result.rows.map((row) => ({
        id: row.id,
        channel: row.channel,
        publishedAt: row.published_at,
        title: row.title,
        previewTitle: row.preview_title,
        previewBody: row.preview_body,
        sourceSummary: row.source_summary,
        outputJson: row.output_json,
        artifactPublicUrl: row.artifact_public_url,
        artifactBucket: row.artifact_bucket,
        artifactPath: row.artifact_path,
        externalUrl: row.external_url
      })), {
        storageDir: options.artifactStorageDir ?? process.env.GENERATED_ASSET_DIR ?? "storage",
        fetchImpl: fetchPublishArtifact,
        fetchTimeoutMs: publishArtifactFetchTimeoutMs,
        maxRemoteManifestBytes: publishArtifactMaxBytes,
        maxRemoteFileBytes: publishAssetMaxBytes,
        allowedRemoteOrigins: publishArtifactAllowedOrigins
      });
    },

    async getPublishArtifact(queueId) {
      const row = await findPublishResultRecord(queueId);
      let manifest: unknown = null;
      if (row.artifact_public_url) {
        try {
          const buffer = await fetchRemoteBuffer(row.artifact_public_url, {
            fetchImpl: fetchPublishArtifact,
            timeoutMs: publishArtifactFetchTimeoutMs,
            maxBytes: publishArtifactMaxBytes,
            allowedOrigins: publishArtifactAllowedOrigins
          });
          manifest = JSON.parse(buffer.toString("utf8"));
        } catch {
          throw new Error("publish_artifact_manifest_unavailable");
        }
      }
      return {
        queueId: row.id,
        ...normalizePublishArtifact({
          manifest,
          outputJson: outputWithDeliveryFormat(row),
          fallbackTitle: row.preview_title ?? row.title ?? "Result",
          manifestUrl: row.artifact_public_url,
          allowedRemoteOrigins: publishArtifactAllowedOrigins
        })
      };
    },

    async downloadPublishResult(queueId) {
      const row = await findPublishResultRecord(queueId);
      const packageResult = await buildPublishedResultsPackage([publishedResultRecord(row)], {
        storageDir: options.artifactStorageDir ?? process.env.GENERATED_ASSET_DIR ?? "storage",
        fetchImpl: fetchPublishArtifact,
        fetchTimeoutMs: publishArtifactFetchTimeoutMs,
        maxRemoteManifestBytes: publishArtifactMaxBytes,
        maxRemoteFileBytes: publishAssetMaxBytes,
        allowedRemoteOrigins: publishArtifactAllowedOrigins
      });
      const safeQueueId = queueId.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "result";
      return { ...packageResult, fileName: `brand-pilot-publish-result-${safeQueueId}.zip` };
    },

    async listTopicRows(brandId, status) {
      const result = await pool.query(
        `select id, topic_upload_id, row_number, status, topic_title, topic_angle,
                target_customer, region, season, reference_url, priority, notes,
                validation_errors, created_at, used_at
         from topic_rows
         where brand_id = $1
           and ($2::text is null or status = $2)
         order by
           case status
             when 'uploaded' then 1
             when 'queued' then 2
             when 'invalid' then 3
             when 'skipped' then 4
             when 'failed' then 5
             when 'used' then 6
             else 7
           end,
           priority desc,
           created_at asc,
           row_number asc`,
        [brandId, status ?? null]
      );
      return result.rows.map((row): TopicRowDto => ({
        id: row.id,
        uploadId: row.topic_upload_id,
        rowNumber: row.row_number,
        status: row.status,
        topicTitle: row.topic_title,
        topicAngle: row.topic_angle,
        targetCustomer: row.target_customer,
        region: row.region,
        season: row.season,
        referenceUrl: row.reference_url,
        priority: row.priority,
        notes: row.notes,
        validationErrors: row.validation_errors ?? [],
        createdAt: toIso(row.created_at)!,
        usedAt: toIso(row.used_at)
      }));
    },

    async crawlSingleSource(
      brandId,
      sourceId,
      trigger,
      context?: { attempt?: number; parentRunId?: string; now?: Date }
    ) {
      const sourceResult = await pool.query(
        `select id, workspace_id, brand_id, url
         from source_urls
         where id = $1 and brand_id = $2
           and enabled = true
           and deleted_at is null
           and status != 'disabled'`,
        [sourceId, brandId]
      );
      if (!sourceResult.rowCount) throw new Error("source_not_found");
      const source = sourceResult.rows[0];
      const now = context?.now ?? new Date();
      const attempt = context?.attempt ?? 0;
      const runKey = trigger === "scheduled"
        ? scheduledRunKey(sourceId, now)
        : trigger === "new_source"
          ? `new_source:${sourceId}`
          : `${trigger}:${sourceId}:${crypto.randomUUID()}`;

      let started;
      try {
        started = await pool.query(
          `insert into source_crawl_runs (
             workspace_id, brand_id, source_url_id, parent_run_id, trigger, status, run_key, attempt, started_at
           ) values ($1, $2, $3, $4, $5, 'running', $6, $7, now())
           on conflict (run_key) do nothing
           returning id`,
          [source.workspace_id, source.brand_id, source.id, context?.parentRunId ?? null, trigger, runKey, attempt]
        );
      } catch (error) {
        if ((error as { code?: string }).code !== "23505") throw error;
        started = { rowCount: 0, rows: [] };
      }

      if (!started.rowCount) {
        const existing = await pool.query(
          `select id, brand_id, source_url_id, trigger, status, attempt,
                  processed_count, created_count, updated_count, failed_count,
                  started_at, finished_at, next_retry_at, last_error
           from source_crawl_runs
           where run_key = $1 or (source_url_id = $2 and status = 'running')
           order by created_at desc
           limit 1`,
          [runKey, sourceId]
        );
        if (!existing.rowCount) throw new Error("source_crawl_already_running");
        return mapSourceCrawlRun(existing.rows[0]);
      }

      const result = await (this.crawlSources as unknown as (
        brandId: string,
        sourceId?: string
      ) => Promise<PipelineRunResult>)(brandId, sourceId);
      const status: SourceCrawlRunStatus = result.failed === 0
        ? "succeeded"
        : result.created + result.updated > 0
          ? "partial"
          : attempt >= 3
            ? "abandoned"
            : "failed";
      const retryAt = status === "failed" || status === "partial"
        ? nextRetryAt(attempt + 1, now)
        : null;
      const lastError = result.failed > 0 ? "source_crawl_failed" : null;
      await pool.query(
        `update source_crawl_runs
         set status = $2,
             processed_count = $3,
             created_count = $4,
             updated_count = $5,
             failed_count = $6,
             finished_at = now(),
             next_retry_at = $7,
             last_error = $8
         where id = $1`,
        [started.rows[0].id, status, result.processed, result.created, result.updated, result.failed, retryAt, lastError]
      );
      return {
        id: started.rows[0].id,
        brandId,
        sourceUrlId: sourceId,
        trigger,
        status,
        attempt,
        ...result,
        startedAt: now.toISOString(),
        finishedAt: new Date().toISOString(),
        nextRetryAt: retryAt?.toISOString() ?? null,
        lastError
      };
    },

    async crawlDueSources(now = new Date()) {
      const batchSize = Math.max(1, Number(process.env.SOURCE_CRAWL_BATCH_SIZE) || 5);
      const timeBudgetMs = Math.max(1, Number(process.env.SOURCE_CRAWL_TIME_BUDGET_MS) || 45_000);
      const deadline = Date.now() + timeBudgetMs;

      await pool.query(
        `update source_crawl_runs
         set status = 'failed', finished_at = $1, last_error = 'crawl_run_stale', next_retry_at = $1
         where status = 'running' and started_at < $1::timestamptz - interval '30 minutes'`,
        [now]
      );
      const due = await pool.query(
        `select su.id, su.workspace_id, su.brand_id, su.url,
                0 as attempt, null::uuid as parent_run_id, 'scheduled'::text as run_trigger
         from source_urls su
         join lateral (
           select max(ss.fetched_at) as last_success_at
           from source_snapshots ss
           where ss.source_url_id = su.id and ss.status = 'succeeded'
         ) latest on true
         where su.enabled = true
           and su.deleted_at is null
           and su.status != 'disabled'
           and latest.last_success_at <= $1::timestamptz - interval '72 hours'
           and not exists (
             select 1 from source_crawl_runs running
             where running.source_url_id = su.id and running.status = 'running'
           )
           and not exists (
             select 1 from source_crawl_runs abandoned
             where abandoned.source_url_id = su.id
               and abandoned.status = 'abandoned'
               and abandoned.created_at > latest.last_success_at
           )
         order by latest.last_success_at asc
         limit $2`,
        [now, batchSize]
      );
      const retries = await pool.query(
        `select su.id, su.workspace_id, su.brand_id, su.url,
                failed.attempt + 1 as attempt, failed.id as parent_run_id, 'retry'::text as run_trigger
         from source_crawl_runs failed
         join source_urls su on su.id = failed.source_url_id
         where failed.status in ('failed', 'partial')
           and failed.next_retry_at <= $1
           and failed.attempt < 3
           and su.enabled = true
           and su.deleted_at is null
           and not exists (
             select 1 from source_crawl_runs newer
             where newer.source_url_id = failed.source_url_id
               and newer.created_at > failed.created_at
           )
         order by failed.next_retry_at asc
         limit $2`,
        [now, batchSize]
      );
      const selected = [...retries.rows, ...due.rows]
        .filter((row, index, rows) => rows.findIndex((candidate) => candidate.id === row.id) === index)
        .slice(0, batchSize);
      const aggregate: AutomaticCrawlResult = {
        brandsSelected: new Set(selected.map((row) => row.brand_id)).size,
        runsStarted: 0,
        processed: 0,
        created: 0,
        updated: 0,
        failed: 0,
        status: "succeeded"
      };
      for (const source of selected) {
        if (Date.now() >= deadline) break;
        const run = await (this.crawlSingleSource as unknown as (
          brandId: string,
          sourceId: string,
          trigger: SourceCrawlTrigger,
          context?: { attempt?: number; parentRunId?: string; now?: Date }
        ) => Promise<SourceCrawlRunDto>)(source.brand_id, source.id, source.run_trigger, {
          attempt: Number(source.attempt),
          parentRunId: source.parent_run_id ?? undefined,
          now
        });
        if (run.status === "running") continue;
        aggregate.runsStarted += 1;
        aggregate.processed += run.processed;
        aggregate.created += run.created;
        aggregate.updated += run.updated;
        aggregate.failed += run.failed;
      }
      aggregate.status = aggregate.failed === 0 ? "succeeded" : aggregate.created + aggregate.updated > 0 ? "partial" : "failed";
      return aggregate;
    },

    async crawlSources(brandId, sourceId?: string) {
      const sources = sourceId
        ? await pool.query(
          `select id, workspace_id, brand_id, url
           from source_urls
           where id = $1 and brand_id = $2
             and enabled = true
             and deleted_at is null
             and status != 'disabled'`,
          [sourceId, brandId]
        )
        : await pool.query(
          `select id, workspace_id, brand_id, url
           from source_urls
           where brand_id = $1
             and enabled = true
             and deleted_at is null
             and status != 'disabled'
           order by created_at asc`,
          [brandId]
        );
      let created = 0;
      let updated = 0;
      let failed = 0;
      for (const source of sources.rows) {
        const before = { created, updated, failed };
        const manualRun = sourceId ? null : await pool.query(
          `insert into source_crawl_runs (
             workspace_id, brand_id, source_url_id, trigger, status, run_key, attempt, started_at
           ) values ($1, $2, $3, 'manual', 'running', $4, 0, now())
           returning id`,
          [source.workspace_id, source.brand_id, source.id, `manual:${source.id}:${crypto.randomUUID()}`]
        );
        await pool.query("update source_urls set status = 'crawling', last_error = null where id = $1", [source.id]);
        try {
          const seedSnapshot = await crawlSourceUrl(source.url);
          const discoveryLimit = Math.max(1, Number(process.env.SOURCE_CRAWL_DISCOVERY_LIMIT) || 20);
          const discoveredUrls = discoverContentUrls(source.url, seedSnapshot.rawText).slice(0, discoveryLimit);
          let sourceSuccessCount = 0;
          let sourceFailureCount = 0;

          for (const discoveredUrl of discoveredUrls) {
            let contentItemId: string | null = null;
            try {
              const snapshot = await crawlSourceUrl(discoveredUrl.url);
              if (!isLikelyContentPage(discoveredUrl.url, snapshot.rawText, snapshot)) {
                continue;
              }
              const contentItem = await pool.query(
                `insert into source_content_items (
                   workspace_id, brand_id, source_url_id, url_hash, content_url, canonical_url,
                   domain, discovery_method, link_text, status, first_discovered_at, last_seen_at
                 )
                 values ($1, $2, $3, $4, $5, null, $6, $7, $8, 'discovered', now(), now())
                 on conflict (brand_id, url_hash) where deleted_at is null
                 do update set source_url_id = excluded.source_url_id,
                               discovery_method = excluded.discovery_method,
                               link_text = coalesce(excluded.link_text, source_content_items.link_text),
                               last_seen_at = now(),
                               deleted_at = null,
                               updated_at = now()
                 returning id, content_url, latest_content_hash`,
                [
                  source.workspace_id,
                  source.brand_id,
                  source.id,
                  hashSourceUrl(discoveredUrl.url),
                  discoveredUrl.url,
                  normalizeDomain(discoveredUrl.url),
                  discoveredUrl.discoveryMethod,
                  discoveredUrl.linkText
                ]
              );
              contentItemId = contentItem.rows[0].id;
              if (!contentItemId) throw new Error("source_content_item_missing");
              const existingSnapshot = await pool.query(
                `select id
                 from source_snapshots
                 where source_content_item_id = $1
                   and content_hash = $2
                   and status = 'succeeded'
                   and nullif(extracted_text, '') is not null
                 limit 1`,
                [contentItemId, snapshot.contentHash]
              );
              const itemStatus = existingSnapshot.rowCount ? "unchanged" : "crawled";
              if (!existingSnapshot.rowCount) {
                const insertedSnapshot = await pool.query(
                  `insert into source_snapshots (
                     workspace_id, brand_id, source_url_id, source_content_item_id, status, http_status, content_hash,
                     raw_text, extracted_title, extracted_text, summary, metadata
                   )
                   values ($1, $2, $3, $4, 'succeeded', $5, $6, $7, $8, $9, $10, $11)
                   returning id`,
                  [
                    source.workspace_id,
                    source.brand_id,
                    source.id,
                    contentItemId,
                    snapshot.httpStatus,
                    snapshot.contentHash,
                    null,
                    snapshot.title,
                    snapshot.text,
                    snapshot.metaDescription || snapshot.text.slice(0, 500),
                    JSON.stringify({
                      crawler: "brand-pilot-api",
                      seedUrl: source.url,
                      contentUrl: discoveredUrl.url,
                      discoveryMethod: discoveredUrl.discoveryMethod,
                      metaDescription: snapshot.metaDescription,
                      canonicalUrl: snapshot.canonicalUrl
                    })
                  ]
                );
                const sourceSnapshotId = insertedSnapshot.rows[0]?.id;
                if (sourceSnapshotId) {
                  await enqueueSourceContentTopic(pool, {
                    workspaceId: source.workspace_id,
                    brandId: source.brand_id,
                    sourceContentItemId: contentItemId,
                    sourceSnapshotId,
                    contentUrl: discoveredUrl.url,
                    contentHash: snapshot.contentHash,
                    title: snapshot.title
                  });
                }
                created += 1;
              } else {
                await enqueueSourceContentTopic(pool, {
                  workspaceId: source.workspace_id,
                  brandId: source.brand_id,
                  sourceContentItemId: contentItemId,
                  sourceSnapshotId: existingSnapshot.rows[0].id,
                  contentUrl: discoveredUrl.url,
                  contentHash: snapshot.contentHash,
                  title: snapshot.title
                });
              }
              await pool.query(
                `update source_content_items
                 set canonical_url = coalesce($2, canonical_url),
                     title = coalesce($3, title),
                     status = $4,
                     last_crawled_at = now(),
                     last_error = null,
                     latest_content_hash = $5,
                     updated_at = now()
                 where id = $1`,
                [contentItemId, snapshot.canonicalUrl, snapshot.title, itemStatus, snapshot.contentHash]
              );
              sourceSuccessCount += 1;
              updated += 1;
            } catch (error) {
              const message = error instanceof Error ? error.message : "content_crawl_failed";
              await pool.query(
                `insert into source_snapshots (
                   workspace_id, brand_id, source_url_id, source_content_item_id, status, error_message, metadata
                 )
                 values ($1, $2, $3, $4, 'failed', $5, $6)`,
                [
                  source.workspace_id,
                  source.brand_id,
                  source.id,
                  contentItemId,
                  message,
                  JSON.stringify({
                    crawler: "brand-pilot-api",
                    seedUrl: source.url,
                    contentUrl: discoveredUrl.url,
                    discoveryMethod: discoveredUrl.discoveryMethod
                  })
                ]
              );
              if (contentItemId) {
                await pool.query(
                  `update source_content_items
                   set status = 'crawl_failed',
                       last_crawled_at = now(),
                       last_error = $2,
                       updated_at = now()
                   where id = $1`,
                  [contentItemId, message]
                );
              }
              sourceFailureCount += 1;
              failed += 1;
            }
          }

          if (sourceSuccessCount === 0 && sourceFailureCount === 0) {
            throw new Error("no_content_urls_discovered");
          }
          await pool.query(
            `update source_urls
             set title = coalesce($2, title),
                 meta_description = coalesce($3, meta_description),
                 status = case when $4::int > 0 and $5::int = 0 then 'crawl_failed' else 'crawled' end,
                 last_crawled_at = now(),
                 last_error = case when $4::int > 0 and $5::int = 0 then 'all_content_crawls_failed' else null end
             where id = $1`,
            [source.id, seedSnapshot.title, seedSnapshot.metaDescription, sourceFailureCount, sourceSuccessCount]
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "crawl_failed";
          await pool.query(
            `insert into source_snapshots (workspace_id, brand_id, source_url_id, status, error_message, metadata)
             values ($1, $2, $3, 'failed', $4, $5)`,
            [source.workspace_id, source.brand_id, source.id, message, JSON.stringify({ crawler: "brand-pilot-api", seedUrl: source.url })]
          );
          await pool.query(
            `update source_urls
             set status = 'crawl_failed', last_crawled_at = now(), last_error = $2
             where id = $1`,
            [source.id, message]
          );
          failed += 1;
        }
        const manualRunId = manualRun?.rows[0]?.id;
        if (manualRunId) {
          const sourceResult = {
            processed: 1,
            created: created - before.created,
            updated: updated - before.updated,
            failed: failed - before.failed
          };
          const status: SourceCrawlRunStatus = sourceResult.failed === 0
            ? "succeeded"
            : sourceResult.created + sourceResult.updated > 0
              ? "partial"
              : "failed";
          await pool.query(
            `update source_crawl_runs
             set status = $2, processed_count = $3, created_count = $4,
                 updated_count = $5, failed_count = $6, finished_at = now(),
                 next_retry_at = $7, last_error = $8
             where id = $1`,
            [
              manualRunId,
              status,
              sourceResult.processed,
              sourceResult.created,
              sourceResult.updated,
              sourceResult.failed,
              status === "failed" || status === "partial" ? nextRetryAt(1) : null,
              sourceResult.failed > 0 ? "source_crawl_failed" : null
            ]
          );
        }
      }
      await enqueueLatestSourceContentTopics(pool, brandId);
      if (created > 0 && sources.rowCount) {
        const source = sources.rows[0];
        await pool.query(
          `insert into wiki_build_requests (
             workspace_id, brand_id, requested_revision, status, quiet_until
           ) values ($1::uuid, $2::uuid, 1, 'pending', now() + interval '2 minutes')
           on conflict (workspace_id, brand_id)
           where status in ('pending', 'building')
           do update set
             requested_revision = wiki_build_requests.requested_revision + 1,
             rebuild_requested = wiki_build_requests.rebuild_requested or wiki_build_requests.status = 'building',
             quiet_until = case when wiki_build_requests.status = 'pending'
               then now() + interval '2 minutes' else wiki_build_requests.quiet_until end,
             updated_at = now()`,
          [source.workspace_id, brandId],
        );
      }
      return { processed: sources.rows.length, created, updated, failed };
    },

    async generateContent(brandId, now = new Date()) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const brandResult = await client.query(
          `select b.workspace_id, b.name as brand_name, b.timezone,
                  category.code as category_code, category.name as category_name,
                  coalesce((select jsonb_agg(jsonb_build_object(
                    'type', case when selected.subcategory_id is null then 'custom' else 'system' end,
                    'code', subcategory.code,
                    'name', coalesce(subcategory.name, selected.custom_name)
                  ) order by selected.created_at, coalesce(subcategory.name, selected.custom_name), selected.id)
                  from brand_profile_subcategories selected
                  left join content_subcategories subcategory on subcategory.id = selected.subcategory_id
                  where selected.brand_profile_id = bp.id), '[]'::jsonb) as subcategories,
                  bp.primary_customer, bp.description, bp.tone, bp.default_cta, bp.auto_approval_enabled, bp.brand_color
           from brands b
           join brand_profiles bp on bp.brand_id = b.id
           left join content_categories category on category.id = bp.primary_category_id
           where b.id = $1 and b.deleted_at is null
           for update of b`,
          [brandId]
        );
        if (!brandResult.rowCount) throw new Error("brand_not_found");
        const brand = brandResult.rows[0];
        const enabledChannelResult = await client.query(
          `select channel
           from brand_channels
           where brand_id = $1
             and enabled = true
             and deleted_at is null`,
          [brandId]
        );
        const enabledChannels = enabledChannelResult.rows
          .map((row) => row.channel)
          .filter((channel): channel is Channel => channelCatalog.some((entry) => entry.channel === channel));
        let enabledInstagramFormats: InstagramDeliveryFormat[] = [];
        let lastSelectedInstagramFormat: InstagramDeliveryFormat | null = null;
        if (enabledChannels.includes("instagram")) {
          await client.query(
            `insert into brand_format_rotation_states (brand_id, workspace_id)
             values ($1, $2)
             on conflict (brand_id) do nothing`,
            [brandId, brand.workspace_id]
          );
          const enabledFormatResult = await client.query(
            `select format
             from brand_content_formats
             where brand_id = $1 and enabled = true
             order by rotation_order asc
             for update`,
            [brandId]
          );
          enabledInstagramFormats = enabledFormatResult.rows
            .map((row) => row.format)
            .filter((format): format is InstagramDeliveryFormat =>
              format === "instagram_feed_carousel" || format === "instagram_story" || format === "instagram_reel"
            );
          const rotationStateResult = await client.query(
            `select last_selected_format
             from brand_format_rotation_states
             where brand_id = $1
             for update`,
            [brandId]
          );
          const storedFormat = rotationStateResult.rows[0]?.last_selected_format;
          lastSelectedInstagramFormat = storedFormat === "instagram_feed_carousel" || storedFormat === "instagram_story" || storedFormat === "instagram_reel"
            ? storedFormat
            : null;
        }
        const generationReadyChannels = enabledChannels.filter((channel) =>
          channelCatalog.some((entry) => entry.channel === channel && entry.generationReady)
        );
        const readiness = determineGenerationReadiness(generationReadyChannels, enabledInstagramFormats, lastSelectedInstagramFormat);
        if (!readiness.canProduce) {
          await client.query("commit");
          return { processed: 0, created: 0, updated: 0, failed: 0, reason: "no_producible_channel" };
        }
        const policyDate = brandPolicyDateKey(now, brand.timezone || "Asia/Seoul");
        const dailyTopicCountResult = await client.query(
          `select count(*) as topic_count
           from content_topics
           where brand_id = $1
             and (generated_at at time zone $2)::date = $3::date`,
          [brandId, brand.timezone || "Asia/Seoul", policyDate]
        );
        if (dailyTopicCapacity(Number(dailyTopicCountResult.rows[0]?.topic_count ?? 0)) === 0) {
          await client.query("commit");
          return { processed: 0, created: 0, updated: 0, failed: 0, reason: "daily_topic_limit" };
        }
        const selectedTopicResult = await client.query(
          `select ct.id,
                  ct.topic_row_id,
                  ct.title,
                  ct.angle,
                  ct.source_context,
                  tr.topic_title,
                  tr.topic_angle,
                  tr.target_customer,
                  tr.region,
                  tr.season,
                  tr.reference_url,
                  tr.notes
           from content_topics ct
           left join topic_rows tr on tr.id = ct.topic_row_id
           where ct.brand_id = $1
             and ct.status = 'selected'
           order by ct.selected_at asc, ct.created_at asc
           limit 1
           for update of ct skip locked`,
          [brandId]
        );
        const selectedTopic = selectedTopicResult.rowCount ? selectedTopicResult.rows[0] : null;
        let topic: any | null = null;
        let sourceMaterials: { sourceType: "owned" | "reference"; contentUrl: string; content: string }[] = [];
        let sourceSnapshotIds: string[] = [];
        let sourceContext: Record<string, unknown>;
        let contentTopicId: string | null = selectedTopic?.id ?? null;
        if (selectedTopic) {
          sourceContext = sourceContextObject(selectedTopic.source_context);
          if (sourceContext.source === "topic_table") {
            topic = {
              id: selectedTopic.topic_row_id,
              topic_title: selectedTopic.topic_title ?? selectedTopic.title,
              topic_angle: selectedTopic.topic_angle ?? selectedTopic.angle,
              target_customer: selectedTopic.target_customer,
              region: selectedTopic.region,
              season: selectedTopic.season,
              reference_url: selectedTopic.reference_url,
              notes: selectedTopic.notes
            };
          } else if (sourceContext.source === "source_url") {
            const sourceSnapshotId = typeof sourceContext.sourceSnapshotId === "string" ? sourceContext.sourceSnapshotId : null;
            if (!sourceSnapshotId) {
              await client.query("update content_topics set status = 'failed', error_message = 'source_snapshot_missing', updated_at = now() where id = $1", [selectedTopic.id]);
              await client.query("commit");
              return { processed: 1, created: 0, updated: 0, failed: 1 };
            }
            const snapshotResult = await client.query(
              `select ss.id,
                      ss.source_content_item_id,
                      ss.content_hash,
                      ss.extracted_text as content,
                      su.source_type,
                      coalesce(sci.content_url, su.url) as content_url,
                      sci.content_url as representative_url
               from source_snapshots ss
               join source_urls su on su.id = ss.source_url_id
               join source_content_items sci on sci.id = ss.source_content_item_id and sci.deleted_at is null
               where ss.id = $1
                 and ss.brand_id = $2
                 and ss.status = 'succeeded'
                 and nullif(ss.extracted_text, '') is not null
                 and su.deleted_at is null
                 and su.enabled = true
               limit 1`,
              [sourceSnapshotId, brandId]
            );
            const source = snapshotResult.rows[0];
            sourceMaterials = source ? [{
              sourceType: source.source_type,
              contentUrl: source.content_url,
              content: source.content
            }].filter((material) => (material.sourceType === "owned" || material.sourceType === "reference") && material.contentUrl) : [];
            if (sourceMaterials.length === 0) {
              await client.query("update content_topics set status = 'failed', error_message = 'source_snapshot_unavailable', updated_at = now() where id = $1", [selectedTopic.id]);
              await client.query("commit");
              return { processed: 1, created: 0, updated: 0, failed: 1 };
            }
            sourceSnapshotIds = [source.id];
            sourceContext = {
              source: "source_url",
              sourceContentItemId: source.source_content_item_id,
              sourceSnapshotId: source.id,
              contentUrl: source.content_url,
              representativeUrl: source.representative_url,
              contentHash: source.content_hash
            };
          }
          await client.query(
            "update content_topics set status = 'generating', selected_instagram_format = $2, error_message = null, updated_at = now() where id = $1",
            [selectedTopic.id, readiness.instagramFormat]
          );
        } else {
          const topicResult = await client.query(
            `select id, topic_title, topic_angle, target_customer, region, season, reference_url, notes
             from topic_rows
             where brand_id = $1 and status = 'uploaded'
             order by priority desc, created_at asc, row_number asc
             limit 1
             for update skip locked`,
            [brandId]
          );
          topic = topicResult.rowCount ? topicResult.rows[0] : null;
          if (topic) {
          sourceContext = {
            source: "topic_table",
            topicRowId: topic.id
          };
          } else {
          const snapshotResult = await client.query(
            `with latest_snapshots as (
             select distinct on (ss.source_content_item_id)
                    ss.id,
                    ss.source_content_item_id,
                    ss.content_hash,
                    ss.extracted_text as content,
                    ss.fetched_at,
                    su.source_type,
                    coalesce(sci.content_url, su.url) as content_url,
                    sci.content_url as representative_url
             from source_snapshots ss
             join source_urls su on su.id = ss.source_url_id
             join source_content_items sci on sci.id = ss.source_content_item_id and sci.deleted_at is null
             where ss.brand_id = $1 and ss.status = 'succeeded'
               and ss.source_content_item_id is not null
               and nullif(ss.extracted_text, '') is not null
               and su.deleted_at is null
               and su.enabled = true
             order by ss.source_content_item_id, ss.fetched_at desc
           )
           select id, source_content_item_id, content_hash, source_type, content_url, representative_url, content
           from latest_snapshots
           where content_url is not null
             and source_type in ('owned', 'reference')
             and not exists (
               select 1
               from content_topics ct
               where ct.brand_id = $1
                 and ct.status in ('generating', 'generated')
                 and (
                   (
                     ct.source_context ->> 'sourceContentItemId' = latest_snapshots.source_content_item_id::text
                     and ct.source_context ->> 'contentHash' = latest_snapshots.content_hash
                   )
                   or ct.source_context ->> 'sourceSnapshotId' = latest_snapshots.id::text
                   or (ct.source_context -> 'sourceSnapshotIds') ? latest_snapshots.id::text
                 )
             )
           order by fetched_at desc
           limit 1`,
            [brandId]
          );
          const source = snapshotResult.rows[0];
          if (!source) {
            await client.query("commit");
            return { processed: 0, created: 0, updated: 0, failed: 0 };
          }
          sourceMaterials = [{
            sourceType: source.source_type,
            contentUrl: source.content_url,
            content: source.content
          }].filter((material) => (material.sourceType === "owned" || material.sourceType === "reference") && material.contentUrl);
          if (sourceMaterials.length === 0) {
            await client.query("commit");
            return { processed: 0, created: 0, updated: 0, failed: 0 };
          }
          sourceSnapshotIds = [source.id];
          sourceContext = {
            source: "source_url",
            sourceContentItemId: source.source_content_item_id,
            sourceSnapshotId: source.id,
            contentUrl: source.content_url,
            representativeUrl: source.representative_url,
            contentHash: source.content_hash
          };
          }
        }
        if (!contentTopicId) {
          const contentTopic = await client.query(
            `insert into content_topics (
               workspace_id, brand_id, topic_row_id, title, angle, status, source_context,
               selected_instagram_format
             )
             values ($1, $2, $3, $4, $5, 'generating', $6, $7)
             returning id`,
            [
              brand.workspace_id,
              brandId,
              topic?.id ?? null,
              topic?.topic_title ?? "크롤링 소스 기반 콘텐츠",
              topic?.topic_angle ?? "source_url",
              JSON.stringify(sourceContext),
              readiness.instagramFormat
            ]
          );
          contentTopicId = contentTopic.rows[0].id;
        }
        if (!contentTopicId) throw new Error("content_topic_not_selected");
        const publishGroup = await client.query(
          `insert into topic_publish_groups (workspace_id, brand_id, content_topic_id, status)
           values ($1, $2, $3, 'waiting')
           on conflict (content_topic_id) do update set content_topic_id = excluded.content_topic_id
           returning id`,
          [brand.workspace_id, brandId, contentTopicId]
        );
        const topicPublishGroupId = publishGroup.rows[0]?.id;
        if (!topicPublishGroupId) throw new Error("topic_publish_group_not_created");
        if (topic) {
          await client.query("update topic_rows set status = 'used', used_at = now() where id = $1", [topic.id]);
        }
        await client.query(
          "update content_topics set status = 'generated', generated_at = $2, error_message = null, updated_at = $2 where id = $1",
          [contentTopicId, now]
        );
        const masterDraft = await client.query(
          `insert into master_drafts (workspace_id, brand_id, content_topic_id, status, prompt_version, draft_json, source_snapshot_refs)
           values ($1, $2, $3, 'generated', $4, $5, $6)
           returning id`,
          [
            brand.workspace_id,
            brandId,
            contentTopicId,
            "source.direct.v1",
            JSON.stringify({
              title: topic?.topic_title ?? selectedTopic?.title ?? "크롤링 소스 기반 콘텐츠",
              angle: topic?.topic_angle ?? selectedTopic?.angle ?? "source_url",
              representativeUrl: typeof sourceContext.representativeUrl === "string"
                ? sourceContext.representativeUrl
                : topic?.reference_url ?? selectedTopic?.reference_url ?? null,
              source: sourceContext.source ?? "topic_table"
            }),
            JSON.stringify(sourceSnapshotIds)
          ]
        );
        const outputTitle = topic?.topic_title ?? selectedTopic?.title ?? "크롤링 소스 기반 콘텐츠";
        const outputAngle = topic?.topic_angle ?? selectedTopic?.angle ?? "source_url";
        const representativeUrl = typeof sourceContext.representativeUrl === "string"
          ? sourceContext.representativeUrl
          : topic?.reference_url ?? selectedTopic?.reference_url ?? null;
        const outputs: Array<{
          channel: Channel;
          deliveryFormat: DeliveryFormat;
          status: ContentOutputStatus;
          title: string;
          previewTitle: string;
          previewBody: string;
          outputJson: Record<string, unknown>;
          sourceSummary: string;
          blockReasons: string[];
        }> = [];
        const sourceSummary = representativeUrl
          ? `대표 URL: ${representativeUrl}`
          : "주제와 브랜드 정보를 워커에 전달합니다.";
        for (const catalogEntry of channelCatalog) {
          if (!enabledChannels.includes(catalogEntry.channel)) continue;
          const deliveryFormat = catalogEntry.channel === "instagram"
            ? readiness.instagramFormat
            : catalogEntry.defaultDeliveryFormat;
          if (!deliveryFormat) continue;
          const artifactKind = catalogEntry.channel === "instagram" && deliveryFormat === "instagram_reel"
            ? "video"
            : catalogEntry.artifactKind;
          const generationReady = catalogEntry.generationReady;
          outputs.push({
            channel: catalogEntry.channel,
            deliveryFormat,
            status: generationReady ? "generating" : "generation_failed",
            title: outputTitle,
            previewTitle: outputTitle,
            previewBody: `${catalogEntry.label.en} 콘텐츠 생성 대기 중`,
            outputJson: {
              deliveryFormat,
              topic: { title: outputTitle, angle: outputAngle },
              representativeUrl,
              artifactKind,
              generationState: generationReady ? "pending" : "failed",
              ...(!generationReady ? {
                generationError: {
                  code: "generation_adapter_not_configured",
                  message: "이 채널의 콘텐츠 생성 기능은 아직 준비되지 않았습니다.",
                  failedAt: now.toISOString()
                }
              } : {}),
              channelConstraints: catalogEntry.generationConstraints
            },
            sourceSummary,
            blockReasons: generationReady ? [] : ["generation_adapter_not_configured"]
          });
        }
        for (const output of outputs) {
          const inserted = await client.query(
            `insert into channel_outputs (
               workspace_id, brand_id, content_topic_id, master_draft_id, channel, delivery_format, status,
               title, preview_title, preview_body, output_json, source_summary, block_reasons,
               approved_at
             )
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, case when $7 = 'auto_approved' then now() else null end)
             returning id`,
            [
              brand.workspace_id,
              brandId,
              contentTopicId,
              masterDraft.rows[0].id,
              output.channel,
              output.deliveryFormat,
              output.status,
              output.title,
              output.previewTitle,
              output.previewBody,
              JSON.stringify(output.outputJson),
              output.sourceSummary,
              JSON.stringify(output.blockReasons)
            ]
          );
          if (output.channel === "instagram" && inserted.rows[0]?.id) {
            await createImageRenderJob(client as any, {
              workspaceId: brand.workspace_id,
              brandId,
              contentTopicId,
              channelOutputId: inserted.rows[0].id,
              deliveryFormat: output.deliveryFormat as InstagramDeliveryFormat,
              topic: {
                title: outputTitle,
                angle: outputAngle,
                targetCustomer: topic?.target_customer ?? null,
                region: topic?.region ?? null,
                season: topic?.season ?? null,
                notes: topic?.notes ?? null
              },
              brand,
              crawlContentUrl: typeof sourceContext.representativeUrl === "string"
                ? sourceContext.representativeUrl
                : null,
              referenceUrl: topic?.reference_url ?? selectedTopic?.reference_url ?? null
            });
            await client.query(
              `update brand_format_rotation_states
               set last_selected_format = $2, updated_at = now()
               where brand_id = $1`,
              [brandId, output.deliveryFormat]
            );
          }
          if (output.channel === "threads" && inserted.rows[0]?.id) {
            await createThreadsRenderJob(client as any, {
              workspaceId: brand.workspace_id,
              brandId,
              channelOutputId: inserted.rows[0].id,
              topic: {
                title: outputTitle,
                angle: outputAngle,
                targetCustomer: topic?.target_customer ?? null,
                region: topic?.region ?? null,
                season: topic?.season ?? null,
                notes: topic?.notes ?? null
              },
              brand,
              crawlContentUrl: typeof sourceContext.representativeUrl === "string"
                ? sourceContext.representativeUrl
                : null,
              referenceUrl: topic?.reference_url ?? selectedTopic?.reference_url ?? null
            });
          }
        }
        await client.query("commit");
        return {
          processed: 1,
          created: outputs.length,
          updated: 1,
          failed: outputs.filter((output) => output.status === "generation_failed").length
        };
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async runDailyGeneration(now = new Date()) {
      const brands = await pool.query(
        `select b.id, b.workspace_id
         from brands b
         join brand_profiles bp on bp.brand_id = b.id
         where b.status = 'active' and b.deleted_at is null`
      );
      const aggregate: DailyGenerationRunResult = { brandsSelected: brands.rows.length, runsStarted: 0, processed: 0, created: 0, updated: 0, failed: 0, status: "succeeded" };
      const dateKey = kstDateKey(now);
      for (const brand of brands.rows) {
        const runKey = `daily_generation:${brand.id}:${dateKey}`;
        const started = await pool.query(
          `insert into automation_runs (workspace_id, brand_id, run_type, run_key, scheduled_date, status, started_at)
           values ($1, $2, 'daily_generation', $3, $4::date, 'running', now())
           on conflict (run_key) do nothing
           returning id`,
          [brand.workspace_id, brand.id, runKey, dateKey]
        );
        if (!started.rowCount) continue;
        aggregate.runsStarted += 1;
        try {
          const result = await runDailyTopicGeneration(() => this.generateContent(brand.id, now));
          aggregate.processed += result.processed;
          aggregate.created += result.created;
          aggregate.updated += result.updated;
          aggregate.failed += result.failed;
          const status = result.failed === 0 ? "succeeded" : result.created + result.updated > 0 ? "partial" : "failed";
          await pool.query(
            `update automation_runs set status = $2, result_json = $3::jsonb, finished_at = now() where id = $1`,
            [started.rows[0].id, status, JSON.stringify(result)]
          );
        } catch (error) {
          aggregate.failed += 1;
          const message = error instanceof Error ? error.message.slice(0, 2000) : "daily_generation_failed";
          await pool.query(
            `update automation_runs set status = 'failed', error_message = $2, finished_at = now() where id = $1`,
            [started.rows[0].id, message]
          );
        }
      }
      aggregate.status = aggregate.failed === 0 ? "succeeded" : aggregate.created + aggregate.updated > 0 ? "partial" : "failed";
      return aggregate;
    },

    async runDailyPerformanceSync(now = new Date()) {
      const runDate = performanceRunDate(now);
      const summary = {
        runDate,
        status: "completed" as PerformanceSyncStatus | "not_due",
        channelsSelected: 0,
        runsStarted: 0,
        targetCount: 0,
        successCount: 0,
        failureCount: 0
      };
      if (!isPerformanceSyncDue(now)) return { ...summary, status: "not_due" as const };

      const channels = await pool.query(
        `select b.id as brand_id, b.workspace_id, bc.channel,
                credential.encrypted_payload, credential.auth_mode
         from brands b
         join brand_channels bc on bc.brand_id = b.id
         left join lateral (
           select cc.encrypted_payload, cc.auth_mode
           from channel_credentials cc
           where cc.brand_channel_id = bc.id
             and cc.status = 'active'
             and cc.revoked_at is null
             and (cc.expires_at is null or cc.expires_at > $1)
           order by cc.updated_at desc, cc.id desc
           limit 1
         ) credential on true
         where b.status = 'active' and b.deleted_at is null
           and bc.enabled = true and bc.deleted_at is null
         order by b.id, bc.channel`,
        [now]
      );
      summary.channelsSelected = channels.rows.length;
      const runStatuses: PerformanceSyncStatus[] = [];

      for (const channelRow of channels.rows) {
        const channel = channelRow.channel as PerformanceChannel;
        const claimed = await pool.query(
          `insert into performance_sync_runs (
             workspace_id, brand_id, channel, run_date, status, started_at
           ) values ($1, $2, $3, $4::date, 'running', $5)
           on conflict (brand_id, channel, run_date) do update
           set status = 'running', started_at = excluded.started_at, completed_at = null,
               target_count = 0, success_count = 0, failure_count = 0,
               error_summary = null, updated_at = excluded.started_at
           where performance_sync_runs.status = 'running'
             and performance_sync_runs.started_at <= excluded.started_at - interval '30 minutes'
           returning id`,
          [channelRow.workspace_id, channelRow.brand_id, channel, runDate, now]
        );
        if (!claimed.rowCount) continue;
        summary.runsStarted += 1;
        const runId = claimed.rows[0].id;

        if (!channelRow.encrypted_payload) {
          await pool.query(
            `update performance_sync_runs
             set status = $2, target_count = $3, success_count = $4, failure_count = $5,
                 error_summary = $6, completed_at = now(), updated_at = now()
             where id = $1`,
            [runId, "not_configured", 0, 0, 0, "active_credential_missing"]
          );
          runStatuses.push("not_configured");
          continue;
        }

        const targets = await pool.query(
          `select pq.id as publish_queue_id, pq.channel_output_id, latest_attempt.external_post_id
           from publish_queue pq
           join channel_outputs co on co.id = pq.channel_output_id
           join lateral (
             select pa.external_post_id
             from publish_attempts pa
             where pa.publish_queue_id = pq.id
               and pa.status = 'succeeded'
               and pa.external_post_id is not null
             order by pa.finished_at desc nulls last, pa.created_at desc, pa.id desc
             limit 1
           ) latest_attempt on true
           where pq.brand_id = $1 and pq.channel = $2
             and pq.status = 'published'
             and pq.published_at >= (($3::date - interval '29 days')::timestamp at time zone 'Asia/Seoul')
             and pq.published_at < (($3::date + interval '1 day')::timestamp at time zone 'Asia/Seoul')
           order by pq.published_at asc, pq.id asc`,
          [channelRow.brand_id, channel, runDate]
        );

        let accessToken: string | null = null;
        let credentialError: string | null = null;
        try {
          accessToken = decryptCredential(channelRow.encrypted_payload);
        } catch (error) {
          credentialError = error instanceof Error ? error.message : "credential_decryption_failed";
        }

        let successCount = 0;
        let failureCount = 0;
        let notConfiguredCount = 0;
        const errors: string[] = [];
        for (const target of targets.rows) {
          try {
            if (credentialError) throw new Error(credentialError);
            const result = await performanceAdapters[channel].collect({
              channel,
              accessToken,
              graphHost: channelRow.auth_mode === "instagram_login" ? "graph.instagram.com" : "graph.facebook.com",
              externalPostId: target.external_post_id
            });
            if (result.status === "not_configured") {
              notConfiguredCount += 1;
              continue;
            }
            if (result.status === "failed") {
              failureCount += 1;
              errors.push(result.error ?? "performance_collection_failed");
              continue;
            }
            await pool.query(
              `insert into content_performance_snapshots (
                 workspace_id, brand_id, channel, publish_queue_id, channel_output_id,
                 external_post_id, snapshot_date, exposure_count, raw_metrics, collected_at
               ) values ($1, $2, $3, $4, $5, $6, $7::date, $8, $9::jsonb, $10)
               on conflict (publish_queue_id, snapshot_date)
               do update set exposure_count = excluded.exposure_count,
                             raw_metrics = excluded.raw_metrics,
                             collected_at = excluded.collected_at,
                             updated_at = now()`,
              [
                channelRow.workspace_id,
                channelRow.brand_id,
                channel,
                target.publish_queue_id,
                target.channel_output_id,
                target.external_post_id,
                runDate,
                result.exposureCount,
                JSON.stringify(result.rawMetrics),
                now
              ]
            );
            successCount += 1;
          } catch (error) {
            failureCount += 1;
            errors.push(error instanceof Error ? error.message : "performance_collection_failed");
          }
        }

        const targetCount = targets.rows.length;
        const status: PerformanceSyncStatus = failureCount > 0
          ? successCount > 0 || notConfiguredCount > 0 ? "partially_failed" : "failed"
          : notConfiguredCount > 0 ? "not_configured" : "completed";
        const errorSummary = errors.length > 0 ? [...new Set(errors)].join("; ").slice(0, 2000) : null;
        await pool.query(
          `update performance_sync_runs
           set status = $2, target_count = $3, success_count = $4, failure_count = $5,
               error_summary = $6, completed_at = now(), updated_at = now()
           where id = $1`,
          [runId, status, targetCount, successCount, failureCount, errorSummary]
        );
        runStatuses.push(status);
        summary.targetCount += targetCount;
        summary.successCount += successCount;
        summary.failureCount += failureCount;
      }

      summary.status = runStatuses.includes("failed")
        ? summary.successCount > 0 ? "partially_failed" : "failed"
        : runStatuses.includes("partially_failed")
          ? "partially_failed"
          : runStatuses.length > 0 && runStatuses.every((status) => status === "not_configured")
            ? "not_configured"
            : "completed";
      return summary;
    },

    async getDashboard(brandId) {
      const generatedAt = new Date();
      const runDate = performanceRunDate(generatedAt);
      const workflowResult = await pool.query(
        `/* dashboard_workflow */
         select
           (select count(*) from topic_rows where brand_id = $1 and status = 'uploaded') as queued_topics,
           (select count(*) from channel_outputs where brand_id = $1 and status in ('generating', 'regenerating')) as generating,
           (select count(*) from channel_outputs where brand_id = $1 and status in ('pending_review', 'auto_approval_blocked', 'generation_failed')) as pending_review,
           (select count(*) from publish_queue where brand_id = $1 and status in ('scheduled', 'publishing', 'published')
             and coalesce(published_at, scheduled_for, updated_at) >= (($2::date - interval '29 days')::timestamp at time zone 'Asia/Seoul')
             and coalesce(published_at, scheduled_for, updated_at) < (($2::date + interval '1 day')::timestamp at time zone 'Asia/Seoul')) as scheduled_or_published,
           (select count(*) from channel_outputs where brand_id = $1 and status in ('pending_review', 'auto_approval_blocked', 'generation_failed')) as pending_review_count,
           (select count(*) from publish_queue where brand_id = $1 and status = 'failed'
             and coalesce(failed_at, updated_at) >= (($2::date - interval '29 days')::timestamp at time zone 'Asia/Seoul')) as failed_publish_count`,
        [brandId, runDate]
      );
      const publishedResult = await pool.query(
        `/* dashboard_published_items */
         select pq.id as publish_queue_id, co.title, pq.channel, co.delivery_format, pq.published_at,
                latest_snapshot.exposure_count, latest_snapshot.collected_at, latest_attempt.external_url
         from publish_queue pq
         join channel_outputs co on co.id = pq.channel_output_id
         left join lateral (
           select cps.exposure_count, cps.collected_at
           from content_performance_snapshots cps
           where cps.publish_queue_id = pq.id
             and cps.snapshot_date >= $2::date - 29
           order by cps.snapshot_date desc, cps.collected_at desc, cps.id desc
           limit 1
         ) latest_snapshot on true
         left join lateral (
           select pa.external_url
           from publish_attempts pa
           where pa.publish_queue_id = pq.id and pa.status = 'succeeded'
           order by pa.finished_at desc nulls last, pa.created_at desc, pa.id desc
           limit 1
         ) latest_attempt on true
         where pq.brand_id = $1 and pq.status = 'published'
           and pq.published_at >= (($2::date - interval '29 days')::timestamp at time zone 'Asia/Seoul')
           and pq.published_at < (($2::date + interval '1 day')::timestamp at time zone 'Asia/Seoul')
         order by latest_snapshot.exposure_count desc nulls last, pq.published_at desc, pq.id`,
        [brandId, runDate]
      );
      const snapshotsResult = await pool.query(
        `/* dashboard_snapshots */
         with window_snapshots as (
           select publish_queue_id, channel, snapshot_date, exposure_count, collected_at, id
           from content_performance_snapshots
           where brand_id = $1 and snapshot_date >= $2::date - 29 and snapshot_date <= $2::date
         ), boundary_predecessors as (
           select distinct on (publish_queue_id)
                  publish_queue_id, channel, snapshot_date, exposure_count, collected_at, id
           from content_performance_snapshots
           where brand_id = $1 and snapshot_date < $2::date - 29
             and publish_queue_id in (select publish_queue_id from window_snapshots)
           order by publish_queue_id, snapshot_date desc, collected_at desc, id desc
         )
         select publish_queue_id, channel, snapshot_date, exposure_count
         from (
           select * from boundary_predecessors
           union all
           select * from window_snapshots
         ) dashboard_snapshot_rows
         order by publish_queue_id, snapshot_date, collected_at, id`,
        [brandId, runDate]
      );
      const channelsResult = await pool.query(
        `/* dashboard_channels */
         with recent_published as (
           select id, channel
           from publish_queue
           where brand_id = $1 and status = 'published'
             and published_at >= (($2::date - interval '29 days')::timestamp at time zone 'Asia/Seoul')
         ), latest_snapshots as (
           select distinct on (cps.publish_queue_id)
                  cps.publish_queue_id, cps.exposure_count, cps.collected_at
           from content_performance_snapshots cps
           join recent_published rp on rp.id = cps.publish_queue_id
           where cps.snapshot_date >= $2::date - 29
           order by cps.publish_queue_id, cps.snapshot_date desc, cps.collected_at desc, cps.id desc
         )
         select bc.channel, bc.status,
                count(rp.id) as published_count,
                case when count(ls.publish_queue_id) = 0 then null else sum(ls.exposure_count) end as exposure_count,
                max(ls.collected_at) as last_collected_at,
                latest_run.status as sync_status,
                bc.last_error
         from brand_channels bc
         left join recent_published rp on rp.channel = bc.channel
         left join latest_snapshots ls on ls.publish_queue_id = rp.id
         left join lateral (
           select psr.status
           from performance_sync_runs psr
           where psr.brand_id = bc.brand_id and psr.channel = bc.channel
           order by psr.run_date desc, psr.started_at desc, psr.id desc
           limit 1
         ) latest_run on true
         where bc.brand_id = $1 and bc.deleted_at is null
         group by bc.id, latest_run.status
         order by bc.channel`,
        [brandId, runDate]
      );
      const attentionResult = await pool.query(
        `/* dashboard_attention */
         select 'publish_failed' as type, pq.channel
         from publish_queue pq
         where pq.brand_id = $1 and pq.status = 'failed'
           and coalesce(pq.failed_at, pq.updated_at) >= (($2::date - interval '29 days')::timestamp at time zone 'Asia/Seoul')
         union all
         select 'channel_error', bc.channel
         from brand_channels bc
         where bc.brand_id = $1 and bc.deleted_at is null
           and bc.status in ('needs_attention', 'expired', 'insufficient_permissions', 'mapping_required', 'publish_failed')
         union all
         select 'sync_failed', psr.channel
         from performance_sync_runs psr
         where psr.brand_id = $1 and psr.run_date >= $2::date - 29
           and psr.status in ('failed', 'partially_failed')
         union all
         select 'stale_sync', bc.channel
         from brand_channels bc
         where bc.brand_id = $1 and bc.enabled = true and bc.deleted_at is null
           and not exists (
             select 1 from performance_sync_runs psr
             where psr.brand_id = bc.brand_id and psr.channel = bc.channel
               and psr.run_date >= $2::date - 1 and psr.status <> 'running'
           )`,
        [brandId, runDate]
      );

      const workflow = workflowResult.rows[0] ?? {};
      const numberOrNull = (value: unknown) => value === null || value === undefined ? null : Number(value);
      const windowStart = new Date(`${runDate}T00:00:00.000Z`);
      windowStart.setUTCDate(windowStart.getUTCDate() - 29);
      const windowStartDate = windowStart.toISOString().slice(0, 10);
      const dailyByDate = new Map<string, Partial<Record<Channel, number>>>();
      const previousByQueue = new Map<string, number | null>();
      for (const row of snapshotsResult.rows) {
        const queueId = String(row.publish_queue_id);
        const current = numberOrNull(row.exposure_count);
        if (!previousByQueue.has(queueId)) {
          previousByQueue.set(queueId, current);
          continue;
        }
        const delta = exposureDelta(current, previousByQueue.get(queueId) ?? null);
        previousByQueue.set(queueId, current);
        if (delta === null) continue;
        const date = toDateKey(row.snapshot_date);
        if (!date || date < windowStartDate || date > runDate) continue;
        const channel = row.channel as Channel;
        const channels = dailyByDate.get(date) ?? {};
        channels[channel] = (channels[channel] ?? 0) + delta;
        dailyByDate.set(date, channels);
      }

      const collectedDates = publishedResult.rows
        .map((row) => toIso(row.collected_at))
        .filter((value): value is string => value !== null);
      const exposureValues = publishedResult.rows
        .map((row) => numberOrNull(row.exposure_count))
        .filter((value): value is number => value !== null);
      const dashboard: DashboardDto = {
        period: "30d",
        generatedAt: generatedAt.toISOString(),
        lastCollectedAt: collectedDates.sort().at(-1) ?? null,
        summary: {
          publishedCount: publishedResult.rows.length,
          exposureCount: exposureValues.length > 0 ? exposureValues.reduce((sum, value) => sum + value, 0) : null,
          pendingReviewCount: countFromDb(workflow.pending_review_count),
          failedPublishCount: countFromDb(workflow.failed_publish_count)
        },
        workflow: {
          queuedTopics: countFromDb(workflow.queued_topics),
          generating: countFromDb(workflow.generating),
          pendingReview: countFromDb(workflow.pending_review),
          scheduledOrPublished: countFromDb(workflow.scheduled_or_published)
        },
        dailyExposure: [...dailyByDate.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([date, channels]) => ({ date, channels })),
        channelPerformance: channelsResult.rows.map((row) => ({
          channel: row.channel as Channel,
          connectionStatus: row.status,
          publishedCount: countFromDb(row.published_count),
          exposureCount: numberOrNull(row.exposure_count),
          lastCollectedAt: toIso(row.last_collected_at),
          syncStatus: row.sync_status ?? null
        })),
        topContents: publishedResult.rows.slice(0, 10).map((row) => ({
          publishQueueId: String(row.publish_queue_id),
          title: String(row.title),
          channel: row.channel as Channel,
          deliveryFormat: row.delivery_format ?? null,
          publishedAt: toIso(row.published_at)!,
          exposureCount: numberOrNull(row.exposure_count),
          externalUrl: row.external_url ?? null
        })),
        attentionItems: attentionResult.rows.map((row) => ({
          type: row.type,
          channel: row.channel ?? null,
          message: dashboardAttentionMessage(row.type)
        }))
      };
      return dashboard;
    },

    async schedulePublishQueue(brandId, now = new Date()) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const brand = await client.query(
          `select id from brands where id = $1 and deleted_at is null for update`,
          [brandId]
        );
        if (!brand.rowCount) throw new Error("brand_not_found");

        await client.query(
          `with latest_render_jobs as (
             select distinct on (j.channel_output_id) j.channel_output_id, j.status
             from jobs j
             where j.job_type in ('instagram_feed_render', 'instagram_story_render', 'instagram_reel_render')
             order by j.channel_output_id, j.created_at desc, j.id desc
           ), readiness as (
             select tpg.id,
                    count(co.id) > 0
                    and bool_and(
                      co.status = 'rejected'
                      or latest_render.status = 'failed'
                      or (
                        co.status not in ('pending_review', 'auto_approval_blocked', 'regenerating')
                        and co.status <> 'regenerated'
                        and not coalesce(latest_render.status in ('queued', 'running'), false)
                        and pq.id is not null
                      )
                    ) as terminal_decided,
                    count(pq.id) filter (where pq.status = 'queued') > 0 as has_queued_output
             from topic_publish_groups tpg
             join channel_outputs co on co.content_topic_id = tpg.content_topic_id and co.status <> 'regenerated'
             left join publish_queue pq on pq.channel_output_id = co.id
             left join latest_render_jobs latest_render on latest_render.channel_output_id = co.id
             where tpg.brand_id = $1 and tpg.status in ('waiting', 'ready')
             group by tpg.id
           )
           update topic_publish_groups tpg
           set status = case when readiness.terminal_decided and readiness.has_queued_output then 'ready' else 'waiting' end,
               updated_at = now()
           from readiness
           where tpg.id = readiness.id
             and tpg.status in ('waiting', 'ready')`,
          [brandId]
        );

        const occupied = await client.query(
          `select slot_date, slot_number
           from topic_publish_groups
           where brand_id = $1
             and status in ('scheduled', 'partially_published')
             and slot_date >= $2::date
             and slot_number is not null`,
          [brandId, kstDateKey(now)]
        );
        const occupiedSlotKeys = new Set<string>(occupied.rows.flatMap((row) => {
          const slotDate = toDateKey(row.slot_date);
          return slotDate ? [`${slotDate}:${row.slot_number}`] : [];
        }));
        const readyGroups = await client.query(
          `select id
           from topic_publish_groups
           where brand_id = $1 and status = 'ready'
             and exists (
               select 1 from publish_queue pq
               where pq.topic_publish_group_id = topic_publish_groups.id and pq.status = 'queued'
             )
           order by created_at asc, id asc
           for update`,
          [brandId]
        );

        let processed = 0;
        let updated = 0;
        for (const group of readyGroups.rows) {
          const slot = nextAvailablePolicySlot(now, group.id, occupiedSlotKeys);
          const claimed = await client.query(
            `update topic_publish_groups
             set status = 'scheduled', slot_date = $2::date, slot_number = $3,
                 scheduled_for = $4, updated_at = now()
             where id = $1 and status = 'ready' and slot_date is null and slot_number is null
             returning id`,
            [group.id, slot.slotDate, slot.slotNumber, slot.scheduledFor]
          );
          if (!claimed.rowCount) continue;
          const queueRows = await client.query(
            `update publish_queue
             set status = 'scheduled', slot_date = $2::date, slot_number = $3,
                 scheduled_for = $4, updated_at = now()
             where topic_publish_group_id = $1 and status = 'queued'`,
            [group.id, slot.slotDate, slot.slotNumber, slot.scheduledFor]
          );
          occupiedSlotKeys.add(slot.key);
          processed += 1;
          updated += queueRows.rowCount ?? 0;
        }
        await client.query("commit");
        return { processed, created: 0, updated, failed: 0 };
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async runDuePublishing(now = new Date()) {
      await pool.query(
        `with recovered as (
           update publish_queue pq
           set status = 'published', published_at = coalesce(
                 pq.published_at,
                 (select max(pa.finished_at) from publish_attempts pa where pa.publish_queue_id = pq.id and pa.status = 'succeeded'),
                 now()
               ),
               last_error = null, updated_at = now()
           where pq.status = 'publishing'
             and exists (
               select 1 from publish_attempts pa
               where pa.publish_queue_id = pq.id and pa.status = 'succeeded'
             )
           returning pq.id, pq.brand_id, pq.channel
         ), recovered_channels as (
           update brand_channels channel
           set last_published_at = now(), status = 'connected', last_error = null
           from recovered
           where channel.brand_id = recovered.brand_id and channel.channel = recovered.channel
           returning channel.id
         ), abandoned as (
           update publish_queue pq
           set status = 'failed', failed_at = now(), last_error = 'publish_delivery_unknown', updated_at = now()
           where pq.status = 'publishing'
             and pq.publishing_started_at < now() - interval '30 minutes'
             and not exists (
               select 1 from publish_attempts pa
               where pa.publish_queue_id = pq.id and pa.status = 'succeeded'
             )
             and pq.id not in (select id from recovered)
           returning pq.id
         )
         update publish_attempts pa
         set status = 'failed', error_code = 'publish_delivery_unknown',
             error_message = 'publish_delivery_unknown', finished_at = now()
         where pa.status = 'running'
           and pa.publish_queue_id in (select id from abandoned)`,
      );
      const brands = await pool.query("select id from brands where status = 'active' and deleted_at is null");
      let processed = 0;
      let created = 0;
      let updated = 0;
      let failed = 0;
      for (const brand of brands.rows) {
        const scheduled = await this.schedulePublishQueue(brand.id, now);
        processed += scheduled.processed;
        updated += scheduled.updated;
      }
      const due = await pool.query(
        `select id from publish_queue
         where status = 'scheduled' and scheduled_for <= $1
         order by scheduled_for asc, queued_at asc
         limit 50`,
        [now]
      );
      for (const queue of due.rows) {
        try {
          await publishQueueItemInternal(queue.id);
          processed += 1;
          updated += 1;
        } catch {
          processed += 1;
          failed += 1;
        }
      }
      return { processed, created, updated, failed };
    },

    async publishQueueItem(queueId) {
      return publishQueueItemInternal(queueId);
    },

    async retryPublishQueueItem(queueId) {
      const result = await pool.query(
        `with target as (
           select pq.id, pq.topic_publish_group_id,
                  tpg.status as group_status, tpg.slot_date, tpg.slot_number, tpg.scheduled_for
           from publish_queue pq
           join topic_publish_groups tpg on tpg.id = pq.topic_publish_group_id
           where pq.id = $1 and pq.status = 'failed'
             and pq.last_error in ('oauth_required', 'provider_not_implemented')
           for update of pq, tpg
         ), retried as (
           update publish_queue pq
           set status = case
                 when target.group_status in ('scheduled', 'partially_published')
                   and target.scheduled_for is not null then 'scheduled'
                 else 'queued'
               end,
               slot_date = case when target.group_status in ('scheduled', 'partially_published') then target.slot_date else null end,
               slot_number = case when target.group_status in ('scheduled', 'partially_published') then target.slot_number else null end,
               scheduled_for = case when target.group_status in ('scheduled', 'partially_published') then target.scheduled_for else null end,
               failed_at = null, publishing_started_at = null, last_error = null, updated_at = now()
           from target
           where pq.id = target.id
           returning pq.id, pq.status, pq.topic_publish_group_id
         ), reset_group as (
           update topic_publish_groups tpg
           set status = 'waiting', slot_date = null, slot_number = null,
               scheduled_for = null, updated_at = now()
           from retried
           where tpg.id = retried.topic_publish_group_id and retried.status = 'queued'
           returning tpg.id
         )
         select id, status from retried`,
        [queueId]
      );
      if (!result.rowCount) throw new Error("publish_queue_not_retryable");
      return { id: result.rows[0].id, status: result.rows[0].status as "queued" | "scheduled" };
    },

    async claimDmReplyJob(workerId) {
      await pool.query(
        `with recovered as (
           update dm_delivery_attempts attempt
           set status = 'unknown', error = 'worker_lease_expired', updated_at = now()
           from jobs job
           where attempt.job_id = job.id
             and attempt.status = 'sending'
             and job.status = 'running'
             and job.locked_until < now()
           returning attempt.id, attempt.workspace_id, attempt.brand_id, attempt.conversation_id,
                     attempt.job_id, job.payload_json
         ), attention as (
           insert into dm_attention_items (
             workspace_id, brand_id, conversation_id, trigger_message_id, trigger_turn_id,
             attention_type, reason_code, detail_json
           )
           select workspace_id, brand_id, conversation_id,
                  (payload_json->>'messageId')::uuid, (payload_json->>'turnId')::uuid,
                  'delivery_unknown', 'processing_error', jsonb_build_object('error', 'worker_lease_expired')
           from recovered
           returning conversation_id
         ), paused as (
           update instagram_dm_conversations conversation
           set automation_status = 'paused', attention_status = 'open', updated_at = now()
           where conversation.id in (select conversation_id from attention)
           returning conversation.id
         )
         update jobs job
         set status = 'failed', last_error = 'dm_delivery_unknown', finished_at = now(),
             locked_by = null, locked_until = null, lease_token = null, updated_at = now()
         from recovered
         where job.id = recovered.job_id`,
      );
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("select pg_advisory_xact_lock($1, $2)", [4242, 2]);
        const result = await client.query(
          `with candidate as (
           select job.id from jobs job
           where job.job_type = 'instagram_dm_reply'
             and job.attempt_count < job.max_attempts and job.run_at <= now()
             and (job.status = 'queued' or (job.status = 'running' and job.locked_until < now()))
             and not exists (
               select 1 from jobs active
               where active.job_type = 'instagram_dm_reply'
                 and active.brand_id = job.brand_id
                 and active.status = 'running'
                 and active.locked_until >= now()
             )
           order by priority desc, created_at asc for update skip locked limit 1
         ), claimed as (
           update jobs job
           set status = 'running', locked_by = $1, locked_until = now() + interval '30 seconds',
               lease_token = gen_random_uuid(), attempt_count = attempt_count + 1,
               started_at = coalesce(started_at, now()), updated_at = now()
           from candidate where job.id = candidate.id
           returning job.id, job.workspace_id, job.brand_id, job.lease_token, job.payload_json, job.attempt_count
         ), marked_turn as (
           update dm_turns turn
           set status = 'processing', closed_at = coalesce(turn.closed_at, now()), updated_at = now()
           from claimed
           where turn.id = (claimed.payload_json->>'turnId')::uuid
           returning turn.id, turn.aggregated_text
         )
         select claimed.id, claimed.workspace_id, claimed.brand_id, claimed.lease_token,
                jsonb_set(claimed.payload_json, '{question}', to_jsonb(marked_turn.aggregated_text), true) as payload_json,
                claimed.attempt_count
         from claimed
         join dm_turns turn on turn.id = (claimed.payload_json->>'turnId')::uuid
         join marked_turn on marked_turn.id = turn.id`,
          [workerId],
        );
        await client.query("commit");
        if (!result.rowCount) return null;
        const row = result.rows[0];
        return {
          id: row.id,
          workspaceId: row.workspace_id,
          brandId: row.brand_id,
          leaseToken: row.lease_token,
          payload: row.payload_json,
          attemptCount: Number(row.attempt_count),
        } satisfies DmReplyJobDto;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async heartbeatDmReplyJob(jobId, workerId, leaseToken) {
      const result = await pool.query(
        `update jobs set locked_until = now() + interval '30 seconds', updated_at = now()
         where id = $1 and job_type = 'instagram_dm_reply' and status = 'running'
           and locked_by = $2 and lease_token = $3::uuid and locked_until > now()
         returning id, status`,
        [jobId, workerId, leaseToken],
      );
      if (!result.rowCount) throw new Error("dm_reply_job_lease_invalid");
      return { id: result.rows[0].id, status: result.rows[0].status };
    },

    async completeDmReplyJob(jobId, input: DmReplyJobCompletionInput) {
      const client = await pool.connect();
      let prepared: {
        attemptId: string;
        workspaceId: string;
        brandId: string;
        conversationId: string;
        brandChannelId: string;
        turnId: string;
        triggerMessageId: string;
        recipientId: string;
        externalAccountId: string;
        accessToken: string;
        body: string;
        result: DmReplyJobCompletionInput["result"];
        attentionType: "restricted_action" | "complaint" | "knowledge_gap" | "processing_error" | null;
      } | null = null;
      try {
        await client.query("begin");
        const job = await client.query(
          `select job.id, job.workspace_id, job.brand_id, job.payload_json, job.status as job_status,
                  job.locked_by, job.lease_token::text, (job.locked_until > now()) as locked_until_valid,
                  conversation.id as conversation_id, conversation.brand_channel_id,
                  channel.external_account_id, credential.encrypted_payload, credential.auth_mode,
                  settings.error_message, attempt.id as attempt_id, attempt.status as attempt_status,
                  attempt.decision as attempt_decision
           from jobs job
           join instagram_dm_conversations conversation on conversation.id = (job.payload_json->>'conversationId')::uuid
           join brand_channels channel on channel.id = conversation.brand_channel_id
           join channel_credentials credential on credential.brand_channel_id = channel.id
             and credential.status = 'active' and credential.revoked_at is null
           join instagram_dm_settings settings on settings.brand_id = job.brand_id
           left join dm_delivery_attempts attempt on attempt.job_id = job.id
           where job.id = $1 and job.job_type = 'instagram_dm_reply'
           for update of job`,
          [jobId],
        );
        if (!job.rowCount) throw new Error("dm_reply_job_lease_invalid");
        const row = job.rows[0];
        const terminalAttempt = row.attempt_status === "sent" || row.attempt_status === "unknown" || row.attempt_status === "failed" || row.attempt_status === "sending";
        if (terminalAttempt) {
          await client.query("commit");
          client.release();
          return {
            id: jobId,
            status: row.attempt_status === "sent" ? "succeeded" : "failed",
            decision: row.attempt_decision ?? (row.payload_json.route === "fixed_fallback" ? "fallback" : input.result.decision),
          };
        }
        if (row.job_status !== "running" || row.locked_by !== input.workerId || row.lease_token !== input.leaseToken || !row.locked_until_valid) {
          throw new Error("dm_reply_job_lease_invalid");
        }

        const policyReasonCode = row.payload_json.policyReasonCode;
        let effectiveResult: DmReplyJobCompletionInput["result"];
        if (row.payload_json.route === "fixed_fallback") {
          const fixedReason = policyReasonCode === "complaint"
            ? "complaint"
            : policyReasonCode === "knowledge_gap"
              ? "knowledge_gap"
              : "restricted_action";
          effectiveResult = {
            decision: "fallback", answer: null, wikiChunkIds: [], knowledgeEntryId: null,
            confidence: null, reasonCode: fixedReason,
            needsAttention: true,
            reason: `server_policy:${policyReasonCode}`,
          };
        } else if (input.result.decision === "answer" && input.result.reasonCode === "direct_faq") {
          const entry = await client.query(
            `select id, answer from knowledge_entries
             where id = $1 and workspace_id = $2 and brand_id = $3
               and entry_type = 'faq' and enabled and direct_reply_enabled`,
            [input.result.knowledgeEntryId, row.workspace_id, row.brand_id],
          );
          if (!entry.rowCount) throw new Error("dm_knowledge_entry_not_owned");
          effectiveResult = inspectDmAnswer({ ...input.result, answer: entry.rows[0].answer });
        } else {
          effectiveResult = inspectDmAnswer(input.result);
        }
        let verifiedDestinationLinks: Array<{ label: string; url: string }> = [];
        if (effectiveResult.decision === "answer") {
          if (effectiveResult.wikiChunkIds.length) {
            const sources = await client.query(
              `select chunk.id
               from wiki_page_chunks chunk
               join wiki_versions version on version.id = chunk.wiki_version_id
               where chunk.workspace_id = $1 and chunk.brand_id = $2
                 and version.status = 'active' and chunk.enabled
                 and chunk.id = any($3::uuid[])`,
              [row.workspace_id, row.brand_id, effectiveResult.wikiChunkIds],
            );
            if (sources.rowCount !== effectiveResult.wikiChunkIds.length) throw new Error("dm_wiki_chunk_not_owned");
          }
          const destinationUrlIds = effectiveResult.destinationUrlIds ?? [];
          if (destinationUrlIds.length) {
            const destinations = await client.query(
              `select source.id, coalesce(page.title, unit.title) as label, source.destination_url as url
               from wiki_page_sources source
               join wiki_pages page on page.id = source.wiki_page_id
               join wiki_source_units unit on unit.id = source.wiki_source_unit_id
               join wiki_versions version on version.id = source.wiki_version_id
               where source.workspace_id = $1 and source.brand_id = $2
                 and version.status = 'active' and source.destination_url is not null
                 and source.id = any($3::uuid[])
               order by array_position($3::uuid[], source.id)`,
              [row.workspace_id, row.brand_id, destinationUrlIds],
            );
            if (destinations.rowCount !== destinationUrlIds.length) throw new Error("dm_destination_url_not_owned");
            verifiedDestinationLinks = destinations.rows.map((destination) => ({
              label: destination.label,
              url: destination.url,
            }));
          }
          if (effectiveResult.knowledgeEntryId && effectiveResult.reasonCode !== "direct_faq") {
            const entry = await client.query(
              `select id from knowledge_entries where id = $1 and brand_id = $2 and enabled`,
              [effectiveResult.knowledgeEntryId, row.brand_id],
            );
            if (!entry.rowCount) throw new Error("dm_knowledge_entry_not_owned");
          }
        }
        const fallbackReason = effectiveResult.reasonCode === "complaint"
          ? "complaint"
          : effectiveResult.reasonCode === "restricted_action"
            ? "restricted_action"
            : "knowledge_gap";
        const text = effectiveResult.decision === "answer"
          ? [
            effectiveResult.answer,
            ...verifiedDestinationLinks.map((link) => `${link.label}\n${link.url}`),
          ].filter(Boolean).join("\n\n")
          : effectiveResult.decision === "fallback"
            ? dmFixedMessages[fallbackReason]
            : effectiveResult.decision === "error"
              ? row.error_message
              : null;
        if (!text) {
          await client.query(
            `update jobs set status = 'succeeded', result_json = $2::jsonb, locked_by = null,
               locked_until = null, lease_token = null, finished_at = now(), updated_at = now() where id = $1`,
            [jobId, JSON.stringify(effectiveResult)],
          );
          await client.query("update dm_turns set status = 'completed', updated_at = now() where id = $1", [row.payload_json.turnId]);
          await client.query("commit");
          client.release();
          return { id: jobId, status: "succeeded", decision: effectiveResult.decision };
        }
        if (row.auth_mode !== "instagram_login") throw new Error("instagram_dm_auth_mode_required");
        const attempt = await client.query(
          `insert into dm_delivery_attempts (
             workspace_id, brand_id, conversation_id, job_id, dedupe_key, recipient_id,
             body, decision, reason_code, status
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'prepared')
           on conflict (job_id) do nothing returning id, status`,
          [row.workspace_id, row.brand_id, row.conversation_id, jobId, `dm:${jobId}`, row.payload_json.senderId, text, effectiveResult.decision, effectiveResult.reasonCode],
        );
        const attemptId = attempt.rows[0]?.id ?? row.attempt_id;
        if (!attemptId) throw new Error("dm_delivery_attempt_missing");
        const attentionType = row.payload_json.forceAttentionType
          ?? (effectiveResult.reasonCode === "complaint" ? "complaint"
            : effectiveResult.reasonCode === "restricted_action" ? "restricted_action"
              : effectiveResult.decision === "fallback" ? "knowledge_gap"
                : effectiveResult.decision === "error" || effectiveResult.needsAttention ? "processing_error" : null);
        prepared = {
          attemptId, workspaceId: row.workspace_id, brandId: row.brand_id,
          conversationId: row.conversation_id, brandChannelId: row.brand_channel_id,
          turnId: row.payload_json.turnId, triggerMessageId: row.payload_json.messageId,
          recipientId: row.payload_json.senderId, externalAccountId: row.external_account_id,
          accessToken: decryptCredential(row.encrypted_payload), body: text,
          result: effectiveResult, attentionType,
        };
        await client.query("commit");
      } catch (error) {
        try {
          await client.query("rollback");
        } finally {
          client.release();
        }
        throw error;
      }

      try {
        if (!prepared) throw new Error("dm_delivery_not_prepared");
        const sending = await pool.query(
          `update dm_delivery_attempts set status = 'sending', sending_at = now(), updated_at = now()
           where id = $1 and status = 'prepared' returning id`,
          [prepared.attemptId],
        );
        if (!sending.rowCount) return { id: jobId, status: "failed", decision: prepared.result.decision };
        let externalMessageId: string;
        try {
          const sent = await sendDm({
            accessToken: prepared.accessToken,
            instagramBusinessAccountId: prepared.externalAccountId,
            recipientId: prepared.recipientId,
            text: prepared.body,
          });
          externalMessageId = sent.externalMessageId;
        } catch (error) {
          const classification = classifyInstagramDmSendError(error);
          await client.query("begin");
          await client.query(
            `update dm_delivery_attempts set status = '${classification.status}', error = $2, updated_at = now()
             where id = $1 and status = 'sending' returning id`,
            [prepared.attemptId, classification.errorCode],
          );
          await client.query(
            `update jobs set status = 'failed', last_error = $2, locked_by = null, locked_until = null,
               lease_token = null, finished_at = now(), updated_at = now() where id = $1`,
            [jobId, classification.errorCode],
          );
          await client.query("update dm_turns set status = 'completed', updated_at = now() where id = $1", [prepared.turnId]);
          if (classification.status === "unknown") {
            await client.query(
              `insert into dm_attention_items (
                 workspace_id, brand_id, conversation_id, trigger_message_id, trigger_turn_id,
                 attention_type, reason_code, detail_json
               ) values ($1, $2, $3, $4, $5, 'delivery_unknown', 'processing_error', $6::jsonb)`,
              [prepared.workspaceId, prepared.brandId, prepared.conversationId, prepared.triggerMessageId, prepared.turnId, JSON.stringify({ error: classification.errorCode })],
            );
            await client.query(
              `update instagram_dm_conversations set automation_status = 'paused', attention_status = 'open', updated_at = now()
               where id = $1`,
              [prepared.conversationId],
            );
          }
          await client.query("commit");
          return { id: jobId, status: "failed", decision: prepared.result.decision };
        }

        await client.query("begin");
        await client.query(
          `update dm_delivery_attempts set status = 'sent', provider_message_id = $2, sent_at = now(), updated_at = now()
           where id = $1 and status = 'sending' returning id`,
          [prepared.attemptId, externalMessageId],
        );
        await client.query(
          `insert into instagram_dm_messages (
             workspace_id, brand_id, brand_channel_id, conversation_id, turn_id, external_message_id,
             direction, message_type, body, raw_payload, decision, reason_code, delivery_attempt_id
           ) values ($1, $2, $3, $4, $5, $6, 'outbound', 'text', $7, '{}'::jsonb, $8, $9, $10)
           on conflict (brand_channel_id, external_message_id) do nothing`,
          [prepared.workspaceId, prepared.brandId, prepared.brandChannelId, prepared.conversationId, prepared.turnId, externalMessageId, prepared.body, prepared.result.decision, prepared.result.reasonCode, prepared.attemptId],
        );
        await client.query(
          `update jobs set status = 'succeeded', result_json = $2::jsonb, locked_by = null, locked_until = null,
             lease_token = null, finished_at = now(), updated_at = now() where id = $1`,
          [jobId, JSON.stringify({ ...prepared.result, externalMessageId })],
        );
        await client.query("update dm_turns set status = 'completed', updated_at = now() where id = $1", [prepared.turnId]);
        if (prepared.attentionType) {
          await client.query(
            `insert into dm_attention_items (
               workspace_id, brand_id, conversation_id, trigger_message_id, trigger_turn_id,
               attention_type, reason_code, detail_json
             ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
            [prepared.workspaceId, prepared.brandId, prepared.conversationId, prepared.triggerMessageId, prepared.turnId, prepared.attentionType, prepared.result.reasonCode, JSON.stringify({ reason: prepared.result.reason })],
          );
          if (prepared.attentionType === "restricted_action" || prepared.attentionType === "knowledge_gap") {
            await client.query(
              `update instagram_dm_conversations set attention_status = 'open', updated_at = now()
               where id = $1`,
              [prepared.conversationId],
            );
          } else {
            await client.query(
              `update instagram_dm_conversations set automation_status = 'paused', attention_status = 'open', updated_at = now()
               where id = $1`,
              [prepared.conversationId],
            );
          }
        }
        await client.query("commit");
        return { id: jobId, status: "succeeded", decision: prepared.result.decision };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    async failDmReplyJob(jobId, input) {
      const retryAfterMs = input.retryable ? Math.max(1000, Math.min(input.retryAfterMs, 60 * 60 * 1000)) : 0;
      const result = await pool.query(
        `update jobs
         set status = case when $5::boolean and attempt_count < max_attempts then 'queued' else 'failed' end,
             run_at = case when $5::boolean and attempt_count < max_attempts then now() + ($6::bigint * interval '1 millisecond') else run_at end,
             locked_by = null, locked_until = null, lease_token = null, last_error = $4,
             finished_at = case when $5::boolean and attempt_count < max_attempts then null else now() end,
             updated_at = now()
         where id = $1 and job_type = 'instagram_dm_reply' and status = 'running'
           and locked_by = $2 and lease_token = $3::uuid
         returning id, status`,
        [jobId, input.workerId, input.leaseToken, input.error.slice(0, 2000), input.retryable, retryAfterMs],
      );
      if (!result.rowCount) throw new Error("dm_reply_job_lease_invalid");
      return { id: result.rows[0].id, status: result.rows[0].status };
    },

    async claimDmProfileRefreshJob(workerId) {
      const result = await pool.query(
        `with candidate as (
           select id from jobs
           where job_type = 'instagram_dm_profile_refresh'
             and attempt_count < max_attempts and run_at <= now()
             and (status = 'queued' or (status = 'running' and locked_until < now()))
           order by priority desc, created_at asc for update skip locked limit 1
         )
         update jobs job
         set status = 'running', locked_by = $1, locked_until = now() + interval '30 seconds',
             lease_token = gen_random_uuid(), attempt_count = attempt_count + 1,
             started_at = coalesce(started_at, now()), updated_at = now()
         from candidate where job.id = candidate.id
         returning job.id, job.workspace_id, job.brand_id, job.lease_token, job.payload_json, job.attempt_count`,
        [workerId],
      );
      if (!result.rowCount) return null;
      const row = result.rows[0];
      return {
        id: row.id,
        workspaceId: row.workspace_id,
        brandId: row.brand_id,
        leaseToken: row.lease_token,
        payload: row.payload_json,
        attemptCount: Number(row.attempt_count),
      } satisfies DmProfileRefreshJobDto;
    },

    async runDmProfileRefreshJob(jobId, input: DmProfileRefreshJobInput) {
      const claimed = await pool.query(
        `select job.workspace_id, job.brand_id, job.payload_json,
                credential.encrypted_payload
         from jobs job
         join instagram_dm_conversations conversation
           on conversation.id = (job.payload_json->>'conversationId')::uuid
          and conversation.workspace_id = job.workspace_id and conversation.brand_id = job.brand_id
         join brand_channels channel on channel.id = conversation.brand_channel_id
         join channel_credentials credential on credential.brand_channel_id = channel.id
          and credential.status = 'active' and credential.revoked_at is null
         where job.id = $1 and job.job_type = 'instagram_dm_profile_refresh'
           and job.status = 'running' and job.locked_by = $2
           and job.lease_token = $3::uuid and job.locked_until > now()`,
        [jobId, input.workerId, input.leaseToken],
      );
      if (!claimed.rowCount) throw new Error("dm_profile_job_lease_invalid");
      const row = claimed.rows[0];
      const profile = await fetchDmProfile({
        accessToken: decryptCredential(row.encrypted_payload),
        senderId: row.payload_json.senderId,
      });
      const completed = await pool.query(
        `with updated_profile as (
           update instagram_dm_conversations
           set participant_name = $4, participant_username = $5,
               participant_profile_url = $6, profile_fetched_at = now(), updated_at = now()
           where id = ($7::jsonb->>'conversationId')::uuid
             and workspace_id = $8 and brand_id = $9
           returning id
         )
         update jobs
         set status = 'succeeded', result_json = jsonb_build_object('profileRefreshed', true),
             locked_by = null, locked_until = null, lease_token = null,
             finished_at = now(), updated_at = now()
         where id = $1 and job_type = 'instagram_dm_profile_refresh'
           and status = 'running' and locked_by = $2 and lease_token = $3::uuid
           and exists (select 1 from updated_profile)
         returning id, status`,
        [jobId, input.workerId, input.leaseToken, profile.name, profile.username, profile.profilePictureUrl,
          JSON.stringify(row.payload_json), row.workspace_id, row.brand_id],
      );
      if (!completed.rowCount) throw new Error("dm_profile_job_lease_invalid");
      return { id: completed.rows[0].id, status: completed.rows[0].status };
    },

    async failDmProfileRefreshJob(jobId, input) {
      const retryAfterMs = input.retryable ? Math.max(1000, Math.min(input.retryAfterMs, 60 * 60 * 1000)) : 0;
      const result = await pool.query(
        `update jobs
         set status = case when $5::boolean and attempt_count < max_attempts then 'queued' else 'failed' end,
             run_at = case when $5::boolean and attempt_count < max_attempts then now() + ($6::bigint * interval '1 millisecond') else run_at end,
             locked_by = null, locked_until = null, lease_token = null, last_error = $4,
             finished_at = case when $5::boolean and attempt_count < max_attempts then null else now() end,
             updated_at = now()
         where id = $1 and job_type = 'instagram_dm_profile_refresh' and status = 'running'
           and locked_by = $2 and lease_token = $3::uuid
         returning id, status`,
        [jobId, input.workerId, input.leaseToken, input.error.slice(0, 2000), input.retryable, retryAfterMs],
      );
      if (!result.rowCount) throw new Error("dm_profile_job_lease_invalid");
      return { id: result.rows[0].id, status: result.rows[0].status };
    },

    async heartbeatDmWorker(workerId) {
      await pool.query(
        `insert into worker_instances (worker_id, worker_type, last_heartbeat_at)
         values ($1, 'dm', now())
         on conflict (worker_id) do update set worker_type = 'dm', last_heartbeat_at = now(), updated_at = now()`,
        [workerId],
      );
      return { workerId };
    },

    async acquireWorkerResourceLease(resourceType, workerId, workload) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("select pg_advisory_xact_lock($1, $2)", [4242, 99]);
        await client.query(
          `delete from worker_resource_leases where resource_type = $1 and expires_at <= now()`,
          [resourceType],
        );
        const result = await client.query(
          `with active as (
             select workload_type
             from worker_resource_leases
             where resource_type = $1 and expires_at > now()
           ), capacity as (
             select count(*)::integer as active_total,
                    count(*) filter (where workload_type <> 'dm')::integer as active_non_dm
             from active
           )
           insert into worker_resource_leases (
             resource_type, worker_id, workload_type, expires_at
           )
           select $1, $2, $3, now() + interval '45 seconds'
           from capacity
           where active_total < $4
             and ($3 = 'dm' or active_non_dm < $5)
           on conflict (resource_type, worker_id) do nothing
           returning id, lease_token, expires_at`,
          [resourceType, workerId, workload, workerResourceLimits.total, workerResourceLimits.nonDm],
        );
        await client.query("commit");
        if (!result.rowCount) return null;
        return {
          id: result.rows[0].id,
          leaseToken: result.rows[0].lease_token,
          expiresAt: toIso(result.rows[0].expires_at)!,
        };
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async heartbeatWorkerResourceLease(id, workerId, leaseToken) {
      const result = await pool.query(
        `update worker_resource_leases
         set expires_at = now() + interval '45 seconds', updated_at = now()
         where id = $1::uuid and worker_id = $2 and lease_token = $3::uuid and expires_at > now()
         returning id, lease_token, expires_at`,
        [id, workerId, leaseToken],
      );
      if (!result.rowCount) throw new Error("worker_resource_lease_invalid");
      return {
        id: result.rows[0].id,
        leaseToken: result.rows[0].lease_token,
        expiresAt: toIso(result.rows[0].expires_at)!,
      };
    },

    async releaseWorkerResourceLease(id, workerId, leaseToken) {
      const result = await pool.query(
        `delete from worker_resource_leases
         where id = $1::uuid and worker_id = $2 and lease_token = $3::uuid
         returning id`,
        [id, workerId, leaseToken],
      );
      if (!result.rowCount) throw new Error("worker_resource_lease_invalid");
      return { id: result.rows[0].id };
    },

    async claimImageRenderJob(workerId) {
      const client = await pool.connect();
      let transactionClosed = false;
      try {
        await client.query("begin");
        await client.query("select pg_advisory_xact_lock($1, $2)", [4242, 1]);
        const exhausted = await client.query(
          `update jobs
           set status = 'failed', last_error = 'image_render_job_attempts_exhausted',
               locked_by = null, locked_until = null, lease_token = null,
               finished_at = now(), updated_at = now()
           where job_type in ('instagram_feed_render', 'instagram_story_render', 'instagram_reel_render')
             and status = 'running' and locked_until < now() and attempt_count >= max_attempts
           returning channel_output_id`,
        );
        await markChannelOutputsGenerationFailed(
          client,
          exhausted.rows.map((row) => String(row.channel_output_id)),
          "image_render_job_attempts_exhausted",
          "image_render_job_attempts_exhausted"
        );
        const result = await client.query(
          `with candidate as (
             select queued.id from jobs queued
             where queued.job_type in ('instagram_feed_render', 'instagram_story_render', 'instagram_reel_render')
               and queued.attempt_count < queued.max_attempts and queued.run_at <= now()
               and (queued.status = 'queued' or (queued.status = 'running' and queued.locked_until < now()))
               and not exists (
                 select 1 from jobs active
                 where active.job_type in ('instagram_feed_render', 'instagram_story_render', 'instagram_reel_render')
                   and active.status = 'running' and active.locked_until >= now()
               )
               and not exists (
                 select 1 from jobs recent
                 where recent.job_type in ('instagram_feed_render', 'instagram_story_render', 'instagram_reel_render')
                   and recent.attempt_count > 0
                   and recent.status in ('queued', 'succeeded', 'failed')
                   and recent.updated_at > now() - ($2::bigint * interval '1 millisecond')
               )
             order by queued.priority desc, queued.created_at asc for update of queued skip locked limit 1
           )
           update jobs job
           set status = 'running', locked_by = $1, locked_until = now() + interval '15 minutes',
               lease_token = gen_random_uuid(), attempt_count = attempt_count + 1,
               started_at = coalesce(started_at, now()), updated_at = now()
           from candidate where job.id = candidate.id
           returning job.id, job.workspace_id, job.brand_id, job.channel_output_id, job.lease_token, job.payload_json, job.attempt_count`,
          [workerId, imageRenderCooldownMs]
        );
        await client.query("commit");
        transactionClosed = true;
        if (!result.rowCount) return null;
        const row = result.rows[0];
        return {
          id: row.id,
          workspaceId: row.workspace_id,
          brandId: row.brand_id,
          channelOutputId: row.channel_output_id,
          leaseToken: row.lease_token,
          payload: row.payload_json,
          attemptCount: Number(row.attempt_count)
        } satisfies ImageRenderJobDto;
      } catch (error) {
        if (!transactionClosed) await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async heartbeatImageRenderJob(jobId, workerId, leaseToken) {
      const result = await pool.query(
        `update jobs set locked_until = now() + interval '15 minutes', updated_at = now()
         where id = $1 and job_type in ('instagram_feed_render', 'instagram_story_render', 'instagram_reel_render') and status = 'running'
           and locked_by = $2 and lease_token = $3::uuid and locked_until > now()
         returning id, status`,
        [jobId, workerId, leaseToken]
      );
      if (!result.rowCount) throw new Error("image_render_job_lease_invalid");
      return { id: result.rows[0].id, status: result.rows[0].status };
    },

    async completeImageRenderJob(jobId, input: ImageRenderJobCompletionInput) {
      const client = await pool.connect();
      let transactionClosed = false;
      try {
        await client.query("begin");
        const job = await client.query(
          `select job.id, job.workspace_id, job.brand_id, job.channel_output_id, job.payload_json,
                  co.output_json, co.title as output_title, co.status as output_status,
                  tpg.id as topic_publish_group_id, bc.id as brand_channel_id,
                  bp.auto_approval_enabled
           from jobs job
           join channel_outputs co on co.id = job.channel_output_id
           join topic_publish_groups tpg on tpg.content_topic_id = co.content_topic_id
           join brand_channels bc on bc.brand_id = co.brand_id and bc.channel = 'instagram' and bc.deleted_at is null
           join brand_profiles bp on bp.brand_id = co.brand_id
           where job.id = $1 and job.job_type in ('instagram_feed_render', 'instagram_story_render', 'instagram_reel_render') and job.status = 'running'
             and job.locked_by = $2 and job.lease_token = $3::uuid and job.locked_until > now()
           for update of job, co`,
          [jobId, input.workerId, input.leaseToken]
        );
        if (!job.rowCount) throw new Error("image_render_job_lease_invalid");
        const row = job.rows[0];
        const deliveryFormat = row.payload_json?.deliveryFormat as InstagramDeliveryFormat | undefined;
        if (!deliveryFormat || ![
          "instagram_feed_carousel",
          "instagram_story",
          "instagram_reel"
        ].includes(deliveryFormat)) {
          throw new Error("image_render_job_delivery_format_missing");
        }
        const storagePrefix = typeof row.payload_json?.storagePrefix === "string" ? row.payload_json.storagePrefix : null;
        if (!storagePrefix) throw new Error("image_render_job_storage_prefix_missing");
        let manifest: InstagramWorkerJobResult;
        try {
          manifest = parseImageRenderJobResult(await fetchInstagramManifest(input.manifestUrl), {
            jobId,
            channelOutputId: row.channel_output_id,
            deliveryFormat
          });
          await validateImageRenderJobResultAssets({
            manifestUrl: input.manifestUrl,
            storagePrefix,
            result: manifest,
            fetchImpl: fetchImageAsset
          });
        } catch (error) {
          if (!isImageRenderJobResultValidationError(error)) throw error;
          const errorMessage = safeWorkerFailureMessage(error.message);
          await client.query(
            `update jobs
             set status = 'failed', last_error = $2, locked_by = null, locked_until = null,
                 lease_token = null, finished_at = now(), updated_at = now()
             where id = $1`,
            [jobId, errorMessage]
          );
          await markChannelOutputsGenerationFailed(
            client,
            [row.channel_output_id],
            "image_render_validation_failed",
            errorMessage
          );
          await client.query("commit");
          transactionClosed = true;
          throw error;
        }
        const artifactPath = new URL(input.manifestUrl).pathname.replace(/^\/+/, "");
        const artifact = await client.query(
          `insert into storage_artifacts (workspace_id, brand_id, artifact_type, bucket, path, public_url, mime_type, byte_size)
           values ($1, $2, 'generated_manifest', 'vercel-blob', $3, $4, 'application/json', 0) returning id`,
          [row.workspace_id, row.brand_id, artifactPath, input.manifestUrl]
        );
        const commonOutput = {
          ...recordValue(row.output_json),
          deliveryFormat: manifest.deliveryFormat,
          generationState: "completed",
          artifactStatus: "ready",
          sourceMode: manifest.sourceMode,
          fetchStatus: manifest.fetchStatus,
          selectedAssetCount: manifest.selectedAssetCount,
          validation: manifest.validation
        };
        let finalOutput: Record<string, unknown>;
        let title = manifest.title ?? nullableText(row.output_title) ?? "";
        let previewTitle = title;
        let previewBody: string;
        const outputStatus = nullableText(row.output_status) ?? "generating";
        const nextOutputStatus = outputStatus === "generating"
          ? row.auto_approval_enabled ? "auto_approved" : "pending_review"
          : outputStatus;
        switch (manifest.deliveryFormat) {
          case "instagram_feed_carousel":
            finalOutput = {
              ...commonOutput,
              cards: manifest.cards,
              caption: manifest.caption,
              hashtags: manifest.hashtags
            };
            previewBody = `정방형 카드뉴스 ${manifest.cards.length}장 구성`;
            break;
          case "instagram_story":
            finalOutput = { ...commonOutput, story: manifest.story };
            previewBody = "세로형 스토리 1장 구성";
            break;
          case "instagram_reel":
            finalOutput = {
              ...commonOutput,
              scenes: manifest.scenes,
              cover: manifest.cover,
              video: manifest.video,
              ...(manifest.caption ? { caption: manifest.caption } : {}),
              ...(manifest.hashtags.length ? { hashtags: manifest.hashtags } : {})
            };
            previewBody = `세로형 릴 ${manifest.scenes.length}개 장면 구성`;
            break;
        }
        await client.query(
          `update channel_outputs
           set title = $1, preview_title = $2, preview_body = $3, output_json = $4::jsonb,
               rendered_artifact_id = $5, status = $6,
               approved_at = case when status = 'generating' and $6 = 'auto_approved' then now() else approved_at end,
               block_reasons = coalesce(block_reasons, '[]'::jsonb),
               updated_at = now()
          where id = $7`,
          [
            title,
            previewTitle,
            previewBody,
            JSON.stringify(finalOutput),
            artifact.rows[0].id,
            nextOutputStatus,
            row.channel_output_id
          ]
        );
        const approvalType = outputStatus === "approved"
          ? "manual"
          : outputStatus === "generating" && row.auto_approval_enabled
            ? "auto"
            : null;
        if (approvalType) {
          await client.query(
            `insert into publish_queue (
               workspace_id, brand_id, channel_output_id, topic_publish_group_id, brand_channel_id, channel, approval_type, idempotency_key
             )
             values ($1, $2, $3, $4, $5, 'instagram', $6, $7)
             on conflict (channel_output_id) do nothing`,
            [
              row.workspace_id,
              row.brand_id,
              row.channel_output_id,
              row.topic_publish_group_id,
              row.brand_channel_id,
              approvalType,
              `${approvalType}:${row.channel_output_id}`
            ]
          );
        }
        await client.query(
          `update jobs set status = 'succeeded', result_json = $2, last_error = null,
               locked_until = null, finished_at = now(), updated_at = now()
           where id = $1`,
          [jobId, JSON.stringify({
            manifestUrl: input.manifestUrl,
            model: manifest.model,
            deliveryFormat: manifest.deliveryFormat,
            selectedAssetCount: manifest.selectedAssetCount,
            sourceMode: manifest.sourceMode
          })]
        );
        await client.query("commit");
        transactionClosed = true;
        return { id: jobId, status: "succeeded", artifactId: artifact.rows[0].id };
      } catch (error) {
        if (!transactionClosed) await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async failImageRenderJob(jobId, input) {
      const retryAfterMs = input.retryable ? Math.max(1000, Math.min(input.retryAfterMs, 60 * 60 * 1000)) : 0;
      const errorMessage = safeWorkerFailureMessage(input.error);
      const client = await pool.connect();
      let transactionClosed = false;
      try {
        await client.query("begin");
        const result = await client.query(
          `update jobs
           set status = case when $5::boolean and attempt_count < max_attempts then 'queued' else 'failed' end,
               run_at = case when $5::boolean and attempt_count < max_attempts then now() + ($6::bigint * interval '1 millisecond') else run_at end,
               locked_by = null, locked_until = null, lease_token = null, last_error = $4,
               finished_at = case when $5::boolean and attempt_count < max_attempts then null else now() end,
               updated_at = now()
           where id = $1 and job_type in ('instagram_feed_render', 'instagram_story_render', 'instagram_reel_render')
             and status = 'running' and locked_by = $2 and lease_token = $3::uuid and locked_until > now()
           returning id, status, channel_output_id`,
          [jobId, input.workerId, input.leaseToken, errorMessage, input.retryable, retryAfterMs]
        );
        if (!result.rowCount) throw new Error("image_render_job_lease_invalid");
        const row = result.rows[0];
        if (row.status === "failed") {
          await markChannelOutputsGenerationFailed(client, [row.channel_output_id], "image_render_failed", errorMessage);
        }
        await client.query("commit");
        transactionClosed = true;
        return { id: row.id, status: row.status };
      } catch (error) {
        if (!transactionClosed) await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async claimTextRenderJob(workerId) {
      const client = await pool.connect();
      let transactionClosed = false;
      try {
        await client.query("begin");
        const exhausted = await client.query(
          `update jobs
           set status = 'failed', last_error = 'text_render_job_attempts_exhausted',
               locked_by = null, locked_until = null, lease_token = null,
               finished_at = now(), updated_at = now()
           where job_type = 'threads_text_render'
             and status = 'running' and locked_until < now() and attempt_count >= max_attempts
           returning channel_output_id`
        );
        await markChannelOutputsGenerationFailed(
          client,
          exhausted.rows.map((row) => String(row.channel_output_id)),
          "text_render_job_attempts_exhausted",
          "text_render_job_attempts_exhausted"
        );
        const result = await client.query(
          `with candidate as (
             select id from jobs
             where job_type = 'threads_text_render'
               and attempt_count < max_attempts and run_at <= now()
               and (status = 'queued' or (status = 'running' and locked_until < now()))
             order by priority desc, created_at asc for update skip locked limit 1
           )
           update jobs job
           set status = 'running', locked_by = $1, locked_until = now() + interval '15 minutes',
               lease_token = gen_random_uuid(), attempt_count = attempt_count + 1,
               started_at = coalesce(started_at, now()), updated_at = now()
           from candidate where job.id = candidate.id
           returning job.id, job.workspace_id, job.brand_id, job.channel_output_id, job.lease_token, job.payload_json, job.attempt_count`,
          [workerId]
        );
        await client.query("commit");
        transactionClosed = true;
        if (!result.rowCount) return null;
        const row = result.rows[0];
        return {
          id: row.id,
          workspaceId: row.workspace_id,
          brandId: row.brand_id,
          channelOutputId: row.channel_output_id,
          leaseToken: row.lease_token,
          payload: row.payload_json,
          attemptCount: Number(row.attempt_count)
        } satisfies TextRenderJobDto;
      } catch (error) {
        if (!transactionClosed) await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async heartbeatTextRenderJob(jobId, workerId, leaseToken) {
      const result = await pool.query(
        `update jobs set locked_until = now() + interval '15 minutes', updated_at = now()
         where id = $1 and job_type = 'threads_text_render' and status = 'running'
           and locked_by = $2 and lease_token = $3::uuid and locked_until > now()
         returning id, status`,
        [jobId, workerId, leaseToken]
      );
      if (!result.rowCount) throw new Error("text_render_job_lease_invalid");
      return { id: result.rows[0].id, status: result.rows[0].status };
    },

    async completeTextRenderJob(jobId, input: TextRenderJobCompletionInput) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const job = await client.query(
          `select job.id, job.workspace_id, job.brand_id, job.channel_output_id,
                  co.status as output_status, tpg.id as topic_publish_group_id,
                  bc.id as brand_channel_id, bp.auto_approval_enabled
           from jobs job
           join channel_outputs co on co.id = job.channel_output_id and co.channel = 'threads'
           join topic_publish_groups tpg on tpg.content_topic_id = co.content_topic_id
           join brand_channels bc on bc.brand_id = co.brand_id and bc.channel = 'threads' and bc.deleted_at is null
           join brand_profiles bp on bp.brand_id = co.brand_id
           where job.id = $1 and job.job_type = 'threads_text_render' and job.status = 'running'
             and job.locked_by = $2 and job.lease_token = $3::uuid and job.locked_until > now()
           for update of job, co`,
          [jobId, input.workerId, input.leaseToken]
        );
        if (!job.rowCount) throw new Error("text_render_job_lease_invalid");
        const row = job.rows[0];
        const rendered = parseThreadsRenderJobResult(input.result, {
          jobId,
          channelOutputId: row.channel_output_id
        });
        const outputStatus = nullableText(row.output_status) ?? "generating";
        const nextOutputStatus = outputStatus === "generating"
          ? row.auto_approval_enabled ? "auto_approved" : "pending_review"
          : outputStatus;
        const outputJson = {
          deliveryFormat: "threads_text",
          artifactStatus: "ready",
          text: rendered.text,
          sourceMode: rendered.sourceMode,
          fetchStatus: rendered.fetchStatus,
          model: rendered.model
        };
        await client.query(
          `update channel_outputs
           set title = $1, preview_title = $1, preview_body = $2, output_json = $3::jsonb,
               status = $4,
               approved_at = case when status = 'generating' and $4 = 'auto_approved' then now() else approved_at end,
               block_reasons = coalesce(block_reasons, '[]'::jsonb),
               updated_at = now()
           where id = $5`,
          [rendered.title, rendered.text, JSON.stringify(outputJson), nextOutputStatus, row.channel_output_id]
        );
        const approvalType = outputStatus === "approved"
          ? "manual"
          : outputStatus === "generating" && row.auto_approval_enabled
            ? "auto"
            : null;
        if (approvalType) {
          await client.query(
            `insert into publish_queue (
               workspace_id, brand_id, channel_output_id, topic_publish_group_id, brand_channel_id, channel, approval_type, idempotency_key
             )
             values ($1, $2, $3, $4, $5, 'threads', $6, $7)
             on conflict (channel_output_id) do nothing`,
            [
              row.workspace_id,
              row.brand_id,
              row.channel_output_id,
              row.topic_publish_group_id,
              row.brand_channel_id,
              approvalType,
              `${approvalType}:${row.channel_output_id}`
            ]
          );
        }
        await client.query(
          `update jobs
           set status = 'succeeded', result_json = $2, locked_by = null, locked_until = null,
               lease_token = null, finished_at = now(), updated_at = now()
           where id = $1`,
          [jobId, JSON.stringify(rendered)]
        );
        await client.query("commit");
        return { id: jobId, status: "succeeded" };
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async failTextRenderJob(jobId, input) {
      const retryAfterMs = input.retryable ? Math.max(1000, Math.min(input.retryAfterMs, 60 * 60 * 1000)) : 0;
      const errorMessage = safeWorkerFailureMessage(input.error);
      const client = await pool.connect();
      let transactionClosed = false;
      try {
        await client.query("begin");
        const result = await client.query(
          `update jobs
           set status = case when $5::boolean and attempt_count < max_attempts then 'queued' else 'failed' end,
               run_at = case when $5::boolean and attempt_count < max_attempts then now() + ($6::bigint * interval '1 millisecond') else run_at end,
               locked_by = null, locked_until = null, lease_token = null, last_error = $4,
               finished_at = case when $5::boolean and attempt_count < max_attempts then null else now() end,
               updated_at = now()
           where id = $1 and job_type = 'threads_text_render'
             and status = 'running' and locked_by = $2 and lease_token = $3::uuid and locked_until > now()
           returning id, status, channel_output_id`,
          [jobId, input.workerId, input.leaseToken, errorMessage, input.retryable, retryAfterMs]
        );
        if (!result.rowCount) throw new Error("text_render_job_lease_invalid");
        const row = result.rows[0];
        if (row.status === "failed") {
          await markChannelOutputsGenerationFailed(client, [row.channel_output_id], "text_render_failed", errorMessage);
        }
        await client.query("commit");
        transactionClosed = true;
        return { id: row.id, status: row.status };
      } catch (error) {
        if (!transactionClosed) await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async createKnowledgeImport(brandId, input: KnowledgeImportInput) {
      const entryType = input.entryType ?? "faq";
      const parsed = await parseKnowledgeUpload({
        entryType,
        fileName: input.fileName,
        bytes: decodeBase64Upload(input.fileBase64),
      });
      const finalRows = new Map<string, typeof parsed.validRows[number]>();
      for (const row of parsed.validRows) finalRows.set(row.normalizedKey, row);
      const uniqueRows = [...finalRows.values()];
      const client = await pool.connect();
      try {
        await client.query("begin");
        const brand = await client.query(
          "select workspace_id from brands where id = $1 and deleted_at is null",
          [brandId],
        );
        if (!brand.rowCount) throw new Error("brand_not_found");
        const workspaceId = brand.rows[0].workspace_id;
        const resultJson = {
          entryType,
          totalRows: parsed.rows.length,
          validRows: parsed.validRows.length,
          duplicateRows: parsed.validRows.length - uniqueRows.length,
          invalidRows: parsed.invalidRows.length,
          updatedRows: uniqueRows.length,
        };
        const imported = await client.query(
          `insert into knowledge_imports (workspace_id, brand_id, file_name, source_rows, result_json, status)
           values ($1, $2, $3, $4::jsonb, $5::jsonb, 'succeeded')
           returning id, file_name, status, result_json, created_at`,
          [
            workspaceId,
            brandId,
            input.fileName.trim(),
            JSON.stringify(parsed.rows),
            JSON.stringify(resultJson),
          ],
        );
        for (const row of uniqueRows) {
          await client.query(
            `insert into knowledge_entries (
               workspace_id, brand_id, entry_type, normalized_question, question, answer,
               title, content, category, keywords, aliases, structured_data,
               priority, direct_reply_enabled, enabled, last_import_id
             ) values (
               $1, $2, $3, $4, $5, $6,
               $7, $8, $9, $10::text[], $11::text[], $12::jsonb,
               $13, $14, true, $15
             )
             on conflict (brand_id, normalized_question) do update
             set entry_type = excluded.entry_type,
                 question = excluded.question,
                 answer = excluded.answer,
                 title = excluded.title,
                 content = excluded.content,
                 category = excluded.category,
                 keywords = excluded.keywords,
                 aliases = excluded.aliases,
                 structured_data = excluded.structured_data,
                 priority = excluded.priority,
                 direct_reply_enabled = excluded.direct_reply_enabled,
                 enabled = excluded.enabled,
                 last_import_id = excluded.last_import_id,
                 updated_at = now()`,
            [
              workspaceId,
              brandId,
              row.entryType,
              row.normalizedKey,
              row.question,
              row.answer,
              row.title,
              row.content,
              row.category,
              row.keywords,
              row.aliases,
              JSON.stringify(row.structuredData),
              row.priority,
              row.directReplyEnabled,
              imported.rows[0].id,
            ],
          );
        }
        if (uniqueRows.length > 0) {
          await client.query(
            `insert into wiki_build_requests (
               workspace_id, brand_id, requested_revision, status, quiet_until
             ) values ($1::uuid, $2::uuid, 1, 'pending', now() + interval '2 minutes')
             on conflict (workspace_id, brand_id)
             where status in ('pending', 'building')
             do update set
               requested_revision = wiki_build_requests.requested_revision + 1,
               rebuild_requested = wiki_build_requests.rebuild_requested or wiki_build_requests.status = 'building',
               quiet_until = case when wiki_build_requests.status = 'pending'
                 then now() + interval '2 minutes' else wiki_build_requests.quiet_until end,
               updated_at = now()
             returning id, status`,
            [workspaceId, brandId],
          );
        }
        await client.query("commit");
        return mapKnowledgeImport(imported.rows[0]);
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async listKnowledgeImports(brandId) {
      const result = await pool.query(
        `select id, file_name, status, result_json, created_at
         from knowledge_imports
         where brand_id = $1
         order by created_at desc
         limit 20`,
        [brandId],
      );
      return result.rows.map(mapKnowledgeImport);
    },

    async enqueueWikiRefresh(brandId) {
      const brand = await pool.query(
        "select workspace_id from brands where id = $1 and deleted_at is null",
        [brandId],
      );
      if (!brand.rowCount) throw new Error("brand_not_found");
      const result = await pool.query(
        `insert into wiki_build_requests (
           workspace_id, brand_id, requested_revision, status, quiet_until
         ) values ($1::uuid, $2::uuid, 1, 'pending', now())
         on conflict (workspace_id, brand_id)
         where status in ('pending', 'building')
         do update set
           requested_revision = wiki_build_requests.requested_revision + 1,
           rebuild_requested = wiki_build_requests.rebuild_requested or wiki_build_requests.status = 'building',
           quiet_until = now(), updated_at = now()
         returning id, status`,
        [brand.rows[0].workspace_id, brandId],
      );
      return { id: result.rows[0].id, status: result.rows[0].status };
    },

    async getInstagramDmSettings(brandId) {
      const result = await pool.query(
        `select settings.enabled, settings.fallback_message, settings.error_message,
                exists(
                  select 1 from wiki_versions version
                  join wiki_page_chunks chunk on chunk.wiki_version_id = version.id
                  where version.brand_id = brand.id and version.status = 'active'
                    and chunk.enabled and chunk.embedding is not null
                ) as wiki_ready,
                exists(
                  select 1 from brand_channels channel
                  join channel_credentials credential on credential.brand_channel_id = channel.id
                  where channel.brand_id = brand.id and channel.channel = 'instagram' and channel.deleted_at is null
                    and credential.status = 'active' and credential.revoked_at is null
                    and credential.auth_mode = 'instagram_login'
                    and 'instagram_business_manage_messages' = any(credential.scopes)
                ) as message_permission_ready,
                (select bool_or(last_heartbeat_at > now() - interval '30 seconds') from worker_instances where worker_type = 'dm') as worker_online
         from brands brand
         left join instagram_dm_settings settings on settings.brand_id = brand.id
         where brand.id = $1 and brand.deleted_at is null`,
        [brandId],
      );
      if (!result.rowCount) throw new Error("brand_not_found");
      const row = result.rows[0];
      return {
        brandId,
        enabled: Boolean(row.enabled),
        fallbackMessage: row.fallback_message ?? "현재 확인 가능한 안내 자료가 부족합니다. 담당자가 확인 후 안내드리겠습니다.",
        errorMessage: row.error_message ?? "답변을 준비하는 중 문제가 발생했습니다. 잠시 후 다시 문의해 주세요.",
        wikiReady: Boolean(row.wiki_ready),
        messagePermissionReady: Boolean(row.message_permission_ready),
        webhookStatus: "unchecked",
        workerStatus: row.worker_online === true ? "online" : row.worker_online === false ? "worker_offline" : "unknown",
      } satisfies InstagramDmSettingsDto;
    },

    async updateInstagramDmSettings(brandId, input) {
      const current = await this.getInstagramDmSettings(brandId);
      const enabled = input.enabled ?? current.enabled;
      if (enabled && (!current.wikiReady || !current.messagePermissionReady || current.workerStatus !== "online")) {
        throw new Error("dm_activation_blocked");
      }
      const brand = await pool.query("select workspace_id from brands where id = $1 and deleted_at is null", [brandId]);
      if (!brand.rowCount) throw new Error("brand_not_found");
      await pool.query(
        `insert into instagram_dm_settings (workspace_id, brand_id, enabled, fallback_message, error_message)
         values ($1, $2, $3, $4, $5)
         on conflict (brand_id) do update set enabled = excluded.enabled,
           fallback_message = excluded.fallback_message, error_message = excluded.error_message, updated_at = now()`,
        [brand.rows[0].workspace_id, brandId, enabled, input.fallbackMessage?.trim() || current.fallbackMessage, input.errorMessage?.trim() || current.errorMessage],
      );
      return this.getInstagramDmSettings(brandId);
    },

    async listInstagramDmHistory(brandId) {
      const result = await pool.query(
        `select message.id, message.direction, message.message_type, message.body,
                message.raw_payload->>'decision' as decision, message.created_at
         from instagram_dm_messages message
         where message.brand_id = $1
         order by message.created_at desc
         limit 50`,
        [brandId],
      );
      return result.rows.map((row) => ({
        id: row.id,
        direction: row.direction,
        messageType: row.message_type,
        body: row.body,
        decision: row.decision ?? null,
        createdAt: toIso(row.created_at)!,
      })) as InstagramDmHistoryDto[];
    },

    async receiveInstagramWebhookMessage(input: InstagramWebhookMessageInput): Promise<InstagramWebhookReceiveResult> {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const channel = await client.query(
          `select channel.id, channel.workspace_id, channel.brand_id
           from brand_channels channel
           where channel.channel = 'instagram'
             and channel.deleted_at is null
             and channel.external_account_id = $1
             and exists (
               select 1 from channel_credentials credential
               where credential.brand_channel_id = channel.id
                 and credential.status = 'active'
                 and credential.revoked_at is null
             )
           for update of channel`,
          [input.recipientId],
        );
        if (channel.rowCount !== 1) {
          await client.query("commit");
          return { status: "unknown_recipient", brandId: null, conversationId: null, jobId: null };
        }
        const channelRow = channel.rows[0];
        if (input.isEcho || input.senderId === input.recipientId) {
          await client.query("commit");
          return { status: "ignored", brandId: channelRow.brand_id, conversationId: null, jobId: null };
        }
        const conversation = await client.query(
          `insert into instagram_dm_conversations (
             workspace_id, brand_id, brand_channel_id, external_participant_id, last_message_at
           ) values ($1, $2, $3, $4, now())
           on conflict (brand_channel_id, external_participant_id) do update
           set last_message_at = excluded.last_message_at, updated_at = now()
           returning id, automation_status, profile_fetched_at`,
          [channelRow.workspace_id, channelRow.brand_id, channelRow.id, input.senderId],
        );
        await client.query(
          `insert into jobs (workspace_id, brand_id, job_type, status, payload_json, dedupe_key)
           select $1, $2, 'instagram_dm_profile_refresh', 'queued', $3::jsonb, $4
           where $5::timestamptz is null
              or $5::timestamptz < now() - ($6::double precision * interval '1 hour')
           on conflict (job_type, dedupe_key)
           where job_type = 'instagram_dm_profile_refresh' and dedupe_key is not null and status in ('queued', 'running')
           do nothing`,
          [
            channelRow.workspace_id,
            channelRow.brand_id,
            JSON.stringify({ conversationId: conversation.rows[0].id, senderId: input.senderId }),
            conversation.rows[0].id,
            conversation.rows[0].profile_fetched_at,
            Math.max(1, Number(process.env.DM_PROFILE_REFRESH_AFTER_HOURS ?? 24)),
          ],
        );
        const messageType = input.text ? "text" : "unsupported_media";
        const message = await client.query(
          `insert into instagram_dm_messages (
             workspace_id, brand_id, brand_channel_id, conversation_id, external_message_id,
             direction, message_type, body, raw_payload
           ) values ($1, $2, $3, $4, $5, 'inbound', $6, $7, $8::jsonb)
           on conflict (brand_channel_id, external_message_id) do nothing
           returning id`,
          [
            channelRow.workspace_id,
            channelRow.brand_id,
            channelRow.id,
            conversation.rows[0].id,
            input.messageId,
            messageType,
            input.text,
            JSON.stringify(input.rawPayload),
          ],
        );
        if (!message.rowCount) {
          await client.query("commit");
          return { status: "duplicate", brandId: channelRow.brand_id, conversationId: conversation.rows[0].id, jobId: null };
        }
        await client.query(
          `update instagram_dm_conversations
           set unread_count = unread_count + 1, updated_at = now()
           where id = $1`,
          [conversation.rows[0].id],
        );
        if (!input.text) {
          await client.query("commit");
          return {
            status: conversation.rows[0].automation_status === "paused" ? "paused" : "unsupported_media",
            brandId: channelRow.brand_id,
            conversationId: conversation.rows[0].id,
            jobId: null,
          };
        }
        await client.query(
          `update dm_turns
           set status = 'queued', closed_at = coalesce(closed_at, now()), updated_at = now()
           where conversation_id = $1 and status = 'collecting' and closes_at <= now()`,
          [conversation.rows[0].id],
        );
        const turn = await client.query(
          `insert into dm_turns (workspace_id, brand_id, conversation_id, aggregated_text, closes_at)
           values ($1, $2, $3, $4, now() + interval '3 seconds')
           on conflict (conversation_id) where status = 'collecting'
           do update set aggregated_text = dm_turns.aggregated_text || E'\\n' || excluded.aggregated_text,
                         closes_at = now() + interval '3 seconds', updated_at = now()
           where dm_turns.closes_at > now()
           returning id, aggregated_text`,
          [channelRow.workspace_id, channelRow.brand_id, conversation.rows[0].id, input.text],
        );
        await client.query(
          `update instagram_dm_messages set turn_id = $2 where id = $1`,
          [message.rows[0].id, turn.rows[0].id],
        );
        if (conversation.rows[0].automation_status === "paused") {
          await client.query("commit");
          return { status: "paused", brandId: channelRow.brand_id, conversationId: conversation.rows[0].id, jobId: null };
        }
        const settings = await client.query(
          `select enabled from instagram_dm_settings where brand_id = $1 for update`,
          [channelRow.brand_id],
        );
        if (!settings.rowCount || !settings.rows[0].enabled) {
          await client.query("commit");
          return { status: "disabled", brandId: channelRow.brand_id, conversationId: conversation.rows[0].id, jobId: null };
        }
        const policy = routeDmMessage(turn.rows[0].aggregated_text);
        let jobRoute = policy.route;
        let jobReasonCode = policy.reasonCode;
        let forceAttentionType = policy.forceAttentionType;
        let exactFaqId: string | null = null;
        let exactFaqConflict: string | null = null;
        if (policy.route === "knowledge") {
          const exactFaq = await client.query(
            `select knowledge_entry_id, conflict_marker
             from find_direct_faq_exact($1, $2, $3)`,
            [channelRow.workspace_id, channelRow.brand_id, turn.rows[0].aggregated_text],
          );
          exactFaqId = exactFaq.rows[0]?.knowledge_entry_id ?? null;
          exactFaqConflict = exactFaq.rows[0]?.conflict_marker ?? null;
          if (exactFaqConflict) {
            jobRoute = "fixed_fallback";
            jobReasonCode = "knowledge_gap";
            forceAttentionType = "knowledge_gap";
            exactFaqId = null;
          } else if (!exactFaqId) {
            const wiki = await client.query(
              `select exists(
                 select 1
                 from wiki_versions version
                 join wiki_page_chunks chunk on chunk.wiki_version_id = version.id
                 where version.brand_id = $1 and version.status = 'active'
                   and chunk.enabled and chunk.embedding is not null
               ) as ready`,
              [channelRow.brand_id],
            );
            if (!wiki.rows[0]?.ready) {
              await client.query("commit");
              return { status: "wiki_not_ready", brandId: channelRow.brand_id, conversationId: conversation.rows[0].id, jobId: null };
            }
          }
        }
        const limits = await client.query(
          `select
             count(*) filter (where conversation_id = $1) as participant_count,
             count(*) as brand_count
           from instagram_dm_messages
           where brand_id = $2
             and direction = 'inbound'
             and created_at >= (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')`,
          [conversation.rows[0].id, channelRow.brand_id],
        );
        if (Number(limits.rows[0]?.participant_count ?? 0) > 20 || Number(limits.rows[0]?.brand_count ?? 0) > 500) {
          await client.query("commit");
          return { status: "rate_limited", brandId: channelRow.brand_id, conversationId: conversation.rows[0].id, jobId: null };
        }
        if (exactFaqConflict) {
          await client.query(
            `insert into dm_attention_items (
               workspace_id, brand_id, conversation_id, trigger_message_id, trigger_turn_id,
               attention_type, reason_code, detail_json
             ) values ($1, $2, $3, $4, $5, 'knowledge_gap', 'knowledge_gap', $6::jsonb)`,
            [
              channelRow.workspace_id,
              channelRow.brand_id,
              conversation.rows[0].id,
              message.rows[0].id,
              turn.rows[0].id,
              JSON.stringify({ reason: exactFaqConflict }),
            ],
          );
          await client.query(
            `update instagram_dm_conversations
             set attention_status = 'open', updated_at = now()
             where id = $1`,
            [conversation.rows[0].id],
          );
        }
        const job = await client.query(
          `insert into jobs (workspace_id, brand_id, job_type, status, run_at, payload_json, dedupe_key)
           values ($1, $2, 'instagram_dm_reply', 'queued', now() + interval '3 seconds', $3::jsonb, $4)
           on conflict (job_type, dedupe_key)
           where job_type = 'instagram_dm_reply' and dedupe_key is not null and status in ('queued', 'running')
           do update set payload_json = case
               when jobs.payload_json->>'route' = 'fixed_fallback' then
                 jobs.payload_json || jsonb_build_object(
                   'messageId', excluded.payload_json->>'messageId',
                   'question', excluded.payload_json->>'question'
                 )
               else excluded.payload_json
             end,
             run_at = case when jobs.status = 'queued' then excluded.run_at else jobs.run_at end,
             updated_at = now()
           returning id`,
          [
            channelRow.workspace_id,
            channelRow.brand_id,
            JSON.stringify({
              conversationId: conversation.rows[0].id,
              turnId: turn.rows[0].id,
              senderId: input.senderId,
              messageId: message.rows[0].id,
              question: turn.rows[0].aggregated_text,
              route: jobRoute,
              policyReasonCode: jobReasonCode,
              forceAttentionType,
              ...(exactFaqId ? { exactFaqId } : {}),
            }),
            turn.rows[0].id,
          ],
        );
        await client.query("commit");
        return { status: "queued", brandId: channelRow.brand_id, conversationId: conversation.rows[0].id, jobId: job.rows[0].id };
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async listDmConversations(brandId, input: { filter: DmConversationFilter; cursor?: string; limit: number }) {
      const cursor = decodeDmCursor(input.cursor);
      const limit = Math.max(1, Math.min(input.limit, 100));
      const result = await pool.query(
        `select conversation.id, conversation.external_participant_id,
                conversation.participant_name, conversation.participant_username,
                conversation.participant_profile_url, conversation.last_message_at,
                conversation.automation_status, conversation.attention_status, conversation.unread_count,
                last_message.body as last_message_body,
                last_message.direction as last_message_direction,
                last_message.created_at as last_message_created_at,
                coalesce(attention.open_attention_types, '{}'::text[]) as open_attention_types
         from instagram_dm_conversations conversation
         left join lateral (
           select message.body, message.direction, message.created_at
           from instagram_dm_messages message
           where message.conversation_id = conversation.id
           order by message.created_at desc, message.id desc
           limit 1
         ) last_message on true
         left join lateral (
           select array_agg(distinct item.attention_type order by item.attention_type) as open_attention_types
           from dm_attention_items item
           where item.conversation_id = conversation.id and item.status = 'open'
         ) attention on true
         where conversation.brand_id = $1
           and ($2::timestamptz is null or (conversation.last_message_at, conversation.id) < ($2::timestamptz, $3::uuid))
           and (
             $4::text = 'all'
             or ($4 = 'attention' and exists (
               select 1 from dm_attention_items item where item.conversation_id = conversation.id and item.status = 'open'
             ))
             or ($4 = 'complaint' and exists (
               select 1 from dm_attention_items item where item.conversation_id = conversation.id and item.status = 'open' and item.attention_type = 'complaint'
             ))
             or ($4 = 'unanswered' and (
               exists (select 1 from dm_attention_items item where item.conversation_id = conversation.id and item.status = 'open' and item.attention_type = 'knowledge_gap')
               or exists (select 1 from unanswered_questions question where question.conversation_id = conversation.id and question.resolved_at is null)
             ))
             or ($4 = 'error' and exists (
               select 1 from dm_attention_items item where item.conversation_id = conversation.id and item.status = 'open'
                 and item.attention_type in ('delivery_unknown', 'processing_error')
             ))
           )
         order by conversation.last_message_at desc, conversation.id desc
         limit $5`,
        [brandId, cursor?.lastMessageAt ?? null, cursor?.id ?? null, input.filter, limit + 1],
      );
      const hasMore = result.rows.length > limit;
      const visibleRows = hasMore ? result.rows.slice(0, limit) : result.rows;
      return {
        items: visibleRows.map(mapDmConversationSummary),
        nextCursor: hasMore ? encodeDmCursor(visibleRows[visibleRows.length - 1]) : null,
      } satisfies DmConversationPageDto;
    },

    async getDmConversation(brandId, conversationId) {
      const conversation = await pool.query(
        `select conversation.id, conversation.external_participant_id,
                conversation.participant_name, conversation.participant_username,
                conversation.participant_profile_url, conversation.last_message_at,
                conversation.automation_status, conversation.attention_status, conversation.unread_count,
                last_message.body as last_message_body,
                last_message.direction as last_message_direction,
                last_message.created_at as last_message_created_at,
                coalesce(attention.open_attention_types, '{}'::text[]) as open_attention_types
         from instagram_dm_conversations conversation
         left join lateral (
           select message.body, message.direction, message.created_at
           from instagram_dm_messages message
           where message.conversation_id = conversation.id
           order by message.created_at desc, message.id desc limit 1
         ) last_message on true
         left join lateral (
           select array_agg(distinct item.attention_type order by item.attention_type) as open_attention_types
           from dm_attention_items item where item.conversation_id = conversation.id and item.status = 'open'
         ) attention on true
         where conversation.id = $1 and conversation.brand_id = $2`,
        [conversationId, brandId],
      );
      if (!conversation.rowCount) throw new Error("dm_conversation_not_found");

      const messages = await pool.query(
        `select message.id, message.direction, message.message_type, message.body,
                message.decision, message.reason_code, message.created_at,
                attempt.status as delivery_status,
                nullif(job.result_json->>'confidence', '')::double precision as confidence
         from instagram_dm_messages message
         left join dm_delivery_attempts attempt on attempt.id = message.delivery_attempt_id
         left join jobs job on job.id = attempt.job_id
         where message.conversation_id = $1 and message.brand_id = $2
         order by message.created_at asc, message.id asc`,
        [conversationId, brandId],
      );
      const attention = await pool.query(
        `select item.*, trigger.body as original_message, delivery.status as auto_reply_delivery_status
         from dm_attention_items item
         left join instagram_dm_messages trigger on trigger.id = item.trigger_message_id
         left join lateral (
           select attempt.status
           from jobs job
           join dm_delivery_attempts attempt on attempt.job_id = job.id
           where item.trigger_turn_id is not null and job.payload_json->>'turnId' = item.trigger_turn_id::text
           order by attempt.created_at desc limit 1
         ) delivery on true
         where item.conversation_id = $1 and item.brand_id = $2
         order by item.created_at desc, item.id desc`,
        [conversationId, brandId],
      );
      return {
        ...mapDmConversationSummary(conversation.rows[0]),
        messages: messages.rows.map((row) => ({
          id: String(row.id),
          direction: row.direction,
          messageType: row.message_type,
          body: row.body ?? null,
          decision: row.decision ?? null,
          reasonCode: row.reason_code ?? null,
          sourceLabel: row.reason_code === "direct_faq" ? "FAQ" : row.reason_code === "wiki_answer" ? "Wiki" : null,
          confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
          deliveryStatus: row.delivery_status ?? null,
          createdAt: toIso(row.created_at)!,
        })),
        attentionItems: attention.rows.map(mapDmAttentionItem),
      } satisfies DmConversationDetailDto;
    },

    async listDmAttentionItems(brandId, type) {
      const result = await pool.query(
        `select item.*, trigger.body as original_message, delivery.status as auto_reply_delivery_status
         from dm_attention_items item
         left join instagram_dm_messages trigger on trigger.id = item.trigger_message_id
         left join lateral (
           select attempt.status
           from jobs job
           join dm_delivery_attempts attempt on attempt.job_id = job.id
           where item.trigger_turn_id is not null and job.payload_json->>'turnId' = item.trigger_turn_id::text
           order by attempt.created_at desc limit 1
         ) delivery on true
         where item.brand_id = $1 and item.status = 'open'
           and ($2::text is null or item.attention_type = $2)
         order by item.created_at desc, item.id desc`,
        [brandId, type ?? null],
      );
      return result.rows.map(mapDmAttentionItem);
    },

    async resolveDmAttentionItem(attentionId) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const target = await client.query(
          `select id, conversation_id from dm_attention_items where id = $1 for update`,
          [attentionId],
        );
        if (!target.rowCount) throw new Error("dm_attention_item_not_found");
        const conversationId = target.rows[0].conversation_id;
        await client.query(
          `update dm_attention_items
           set status = 'resolved', resolved_at = now(), updated_at = now()
           where conversation_id = $1 and status = 'open'`,
          [conversationId],
        );
        const open = await client.query(
          `select count(*)::integer as count from dm_attention_items where conversation_id = $1 and status = 'open'`,
          [conversationId],
        );
        if (Number(open.rows[0].count) !== 0) throw new Error("dm_attention_resolution_incomplete");
        await client.query(
          `update instagram_dm_conversations
           set automation_status = 'active', attention_status = 'resolved', unread_count = 0, updated_at = now()
           where id = $1`,
          [conversationId],
        );
        await client.query("commit");
        return { conversationId: String(conversationId), automationStatus: "active", attentionStatus: "resolved" } as const;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async getWikiStatus(brandId) {
      const versions = await pool.query(
        `select version.id, version.status, version.build_stage, version.source_count, version.document_count, version.chunk_count,
                version.activated_at, version.completed_at as failed_at, version.error_message, version.created_at,
                ((select count(*)::integer from wiki_source_units unit where unit.wiki_version_id = version.id)
                  + (select count(*)::integer from wiki_documents document
                     where document.wiki_version_id = version.id and document.knowledge_entry_id is not null))
                  as knowledge_entry_count
         from wiki_versions version
         where version.brand_id = $1 and version.status in ('building', 'ready', 'active', 'failed')
         order by case
           when version.status in ('building', 'ready') then 0
           when version.status = 'active' then 1
           else 2 end, version.created_at desc`,
        [brandId],
      );
      const imports = await pool.query(
        `select count(*)::integer as total,
                count(*) filter (where status = 'succeeded')::integer as succeeded,
                count(*) filter (where status = 'failed')::integer as failed,
                coalesce(sum(case when result_json->>'entryType' = 'faq' then (result_json->>'validRows')::integer else 0 end), 0)::integer as faq_rows,
                coalesce(sum(case when result_json->>'entryType' = 'product' then (result_json->>'validRows')::integer else 0 end), 0)::integer as product_rows
         from knowledge_imports where brand_id = $1`,
        [brandId],
      );
      const mapVersion = (row: Record<string, any> | undefined) => row ? ({
        id: String(row.id),
        status: row.status,
        buildStage: row.build_stage ?? null,
        version: toIso(row.created_at)!,
        sourceCount: Number(row.source_count ?? 0),
        documentCount: Number(row.document_count ?? 0),
        knowledgeEntryCount: Number(row.knowledge_entry_count ?? 0),
        chunkCount: Number(row.chunk_count ?? 0),
        activatedAt: toIso(row.activated_at),
        failedAt: row.status === "failed" ? toIso(row.failed_at) : null,
        errorMessage: row.error_message ?? null,
      }) : null;
      const active = versions.rows.find((row) => row.status === "active");
      const current = versions.rows.find((row) => row.status === "building" || row.status === "ready");
      const failed = versions.rows.find((row) => row.status === "failed");
      const stats = imports.rows[0] ?? {};
      return {
        activeVersion: mapVersion(active),
        currentVersion: mapVersion(current),
        latestFailedVersion: mapVersion(failed),
        importStats: {
          total: Number(stats.total ?? 0),
          succeeded: Number(stats.succeeded ?? 0),
          failed: Number(stats.failed ?? 0),
          faqRows: Number(stats.faq_rows ?? 0),
          productRows: Number(stats.product_rows ?? 0),
        },
      } satisfies WikiStatusDto;
    },

    async createTopicUpload(brandId, input: TopicUploadInput) {
      const rows = parseTopicCsv(input);
      const topicKeys = [...new Set(rows.map((row) => row.topicKey).filter((key) => key !== "::"))];
      const preparedRows = rows.map((row) => {
        return {
          ...row,
          status: row.validationErrors.length > 0 ? "invalid" : "uploaded",
          validationErrors: row.validationErrors
        };
      });
      const client = await pool.connect();
      try {
        await client.query("begin");
        const brand = await client.query("select workspace_id from brands where id = $1 and deleted_at is null", [brandId]);
        if (!brand.rowCount) throw new Error("brand_not_found");
        const workspaceId = brand.rows[0].workspace_id;
        const existing = topicKeys.length > 0
          ? await client.query(
            `select topic_key
             from topic_rows
             where brand_id = $1
               and topic_key = any($2::text[])
               and status not in ('invalid', 'disabled', 'skipped')`,
            [brandId, topicKeys]
          )
          : { rows: [] };
        const existingKeys = new Set(existing.rows.map((row) => row.topic_key));
        const rowsToInsert = preparedRows.map((row) => {
          if (row.status === "uploaded" && existingKeys.has(row.topicKey)) {
            return {
              ...row,
              status: "skipped",
              validationErrors: ["duplicate_existing_topic"]
            };
          }
          return row;
        });
        const validRows = rowsToInsert.filter((row) => row.status === "uploaded").length;
        const duplicateRows = rowsToInsert.filter((row) => row.status === "skipped").length;
        const invalidRows = rowsToInsert.filter((row) => row.status === "invalid").length;
        const upload = await client.query(
          `insert into topic_uploads (workspace_id, brand_id, file_name, file_mime_type, status, total_rows, valid_rows, duplicate_rows, invalid_rows)
           values ($1, $2, $3, 'text/csv', 'validated', $4, $5, $6, $7)
           returning id, file_name, status, total_rows, valid_rows, duplicate_rows, invalid_rows`,
          [workspaceId, brandId, input.fileName, rowsToInsert.length, validRows, duplicateRows, invalidRows]
        );
        for (const row of rowsToInsert) {
          await client.query(
            `insert into topic_rows (
               workspace_id, brand_id, topic_upload_id, row_number, status, topic_title, topic_angle,
               target_customer, region, season, reference_url, priority, notes, topic_key, validation_errors
             )
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            [
              workspaceId,
              brandId,
              upload.rows[0].id,
              row.rowNumber,
              row.status,
              row.topicTitle,
              row.topicAngle,
              row.targetCustomer,
              row.region,
              row.season,
              row.referenceUrl,
              row.priority,
              row.notes,
              row.topicKey,
              JSON.stringify(row.validationErrors)
            ]
          );
        }
        await client.query("commit");
        const created = upload.rows[0];
        return {
          id: created.id,
          fileName: created.file_name,
          status: created.status,
          totalRows: created.total_rows,
          validRows: created.valid_rows,
          duplicateRows: created.duplicate_rows,
          invalidRows: created.invalid_rows
        } satisfies TopicUploadDto;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    }
  };
}
