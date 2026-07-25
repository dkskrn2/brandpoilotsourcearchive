import type { Pool, PoolClient } from "pg";
import type {
  AdminAuditEventDto,
  AdminBrandDetailDto,
  AdminBrandListItemDto,
  AdminChannelListItemDto,
  AdminFeedbackListItemDto,
  AdminListInput,
  AdminOverviewDto,
  AdminPage,
  AdminPublishingDetailDto,
  AdminPublishingListItemDto,
  AdminRepository,
  AdminSystemHealthDto,
  AdminSupportRequestListItemDto,
} from "./adminTypes.js";

type Queryable = Pick<Pool, "query" | "connect">;

export class AdminStateConflictError extends Error {
  constructor(message = "state_conflict") {
    super(message);
  }
}

export class AdminIdempotencyConflictError extends Error {
  constructor() {
    super("idempotency_conflict");
  }
}

function count(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

const sensitiveMetadataKey = /(?:authorization|cookie|credential|encrypted|password|secret|token)/i;
const retryablePublishErrors = new Set(["oauth_required", "provider_not_implemented"]);
const cancellablePublishStatuses = new Set(["queued", "scheduled", "deferred"]);

function sanitizeMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeMetadata);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !sensitiveMetadataKey.test(key))
    .map(([key, item]) => [key, sanitizeMetadata(item)]));
}

function encodeCursor(createdAt: string, id: string) {
  return Buffer.from(JSON.stringify({ createdAt, id }), "utf8").toString("base64url");
}

function decodeCursor(cursor?: string): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof value.createdAt !== "string" || typeof value.id !== "string") throw new Error();
    return { createdAt: value.createdAt, id: value.id };
  } catch {
    throw new Error("admin_cursor_invalid");
  }
}

function pageFromRows<T extends { id: string; createdAt: string }>(rows: T[], limit: number): AdminPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return { items, nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null };
}

function mapBrand(row: Record<string, unknown>): AdminBrandListItemDto {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    workspaceName: String(row.workspace_name),
    name: String(row.name),
    status: row.status as AdminBrandListItemDto["status"],
    createdAt: iso(row.created_at)!,
    lastActivityAt: iso(row.last_activity_at),
    owner: {
      displayName: row.owner_display_name === null || row.owner_display_name === undefined ? null : String(row.owner_display_name),
      email: row.owner_email === null || row.owner_email === undefined ? null : String(row.owner_email),
    },
    category: {
      primary: row.primary_category_code && row.primary_category_name
        ? { code: String(row.primary_category_code), name: String(row.primary_category_name) }
        : null,
      subcategories: arrayValue<unknown>(row.subcategories).map(String),
    },
    onboardingCompleted: Boolean(row.onboarding_completed),
    connectedChannelCount: count(row.connected_channel_count),
    dmEnabled: Boolean(row.dm_enabled),
  };
}

function mapChannel(row: Record<string, unknown>): AdminChannelListItemDto {
  return {
    id: String(row.id),
    brandId: String(row.brand_id),
    brandName: String(row.brand_name),
    channel: String(row.channel),
    enabled: Boolean(row.enabled),
    status: String(row.status),
    authMode: row.auth_mode ? String(row.auth_mode) : null,
    accountLabel: row.account_label ? String(row.account_label) : null,
    externalAccountIdMasked: row.external_account_id_masked ? String(row.external_account_id_masked) : null,
    scopes: arrayValue<unknown>(row.scopes).map(String),
    expiresAt: iso(row.expires_at),
    lastHealthyAt: iso(row.last_healthy_at),
    lastPublishedAt: iso(row.last_published_at),
    lastErrorCode: row.last_error_code ? String(row.last_error_code) : null,
    lastErrorMessage: row.last_error_message ? String(row.last_error_message) : null,
  };
}

function mapFeedback(row: Record<string, unknown>): AdminFeedbackListItemDto {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    workspaceName: String(row.workspace_name),
    brandId: String(row.brand_id),
    brandName: String(row.brand_name),
    message: String(row.message),
    status: row.status as AdminFeedbackListItemDto["status"],
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!
  };
}

function mapSupportRequest(row: Record<string, unknown>): AdminSupportRequestListItemDto {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    workspaceName: String(row.workspace_name),
    brandId: String(row.brand_id),
    brandName: String(row.brand_name),
    category: row.category as AdminSupportRequestListItemDto["category"],
    title: String(row.title),
    message: String(row.message),
    contactPhone: row.contact_phone ? String(row.contact_phone) : null,
    contactEmail: row.contact_email ? String(row.contact_email) : null,
    status: row.status as AdminSupportRequestListItemDto["status"],
    responseMessage: row.response_message ? String(row.response_message) : null,
    respondedAt: iso(row.responded_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!
  };
}

function mapPublishing(row: Record<string, unknown>): AdminPublishingListItemDto {
  const queueStatus = String(row.status);
  const lastError = row.last_error ? String(row.last_error) : null;
  return {
    id: String(row.id),
    brandId: String(row.brand_id),
    brandName: String(row.brand_name),
    contentTitle: String(row.content_title),
    topicTitle: row.topic_title ? String(row.topic_title) : null,
    channel: String(row.channel),
    deliveryFormat: row.delivery_format ? String(row.delivery_format) : null,
    outputStatus: String(row.output_status),
    queueStatus,
    approvalType: String(row.approval_type),
    scheduledFor: iso(row.scheduled_for),
    publishedAt: iso(row.published_at),
    queuedAt: iso(row.queued_at)!,
    createdAt: iso(row.created_at)!,
    lastError,
    attemptCount: count(row.attempt_count),
    externalUrl: row.external_url ? String(row.external_url) : null,
    artifact: row.artifact_public_url ? {
      publicUrl: String(row.artifact_public_url),
      mimeType: row.artifact_mime_type ? String(row.artifact_mime_type) : null,
    } : null,
    canRetry: queueStatus === "failed" && Boolean(lastError && retryablePublishErrors.has(lastError)),
    canCancel: cancellablePublishStatuses.has(queueStatus),
  };
}

const brandSelect = `
  select
    b.id, b.workspace_id, w.name as workspace_name,
    b.name,
    b.status, b.created_at,
    greatest(b.updated_at, coalesce(activity.last_activity_at, b.updated_at)) as last_activity_at,
    owner.display_name as owner_display_name, owner.email as owner_email,
    category.code as primary_category_code, category.name as primary_category_name,
    coalesce(subcategories.names, '[]'::jsonb) as subcategories,
    (
      bp.id is not null
      and exists (select 1 from source_urls source where source.brand_id = b.id and source.source_type = 'owned' and source.deleted_at is null)
      and exists (select 1 from topic_rows topic where topic.brand_id = b.id)
    ) as onboarding_completed,
    (select count(*) from brand_channels channel where channel.brand_id = b.id and channel.deleted_at is null and channel.status = 'connected') as connected_channel_count,
    coalesce(dm.enabled, false) as dm_enabled
  from brands b
  join workspaces w on w.id = b.workspace_id
  left join brand_profiles bp on bp.brand_id = b.id
  left join content_categories category on category.id = bp.primary_category_id
  left join instagram_dm_settings dm on dm.brand_id = b.id
  left join lateral (
    select user_account.display_name, user_account.email
    from workspace_members member
    join app_users user_account on user_account.id = member.user_id
    where member.workspace_id = b.workspace_id and member.role = 'owner' and member.status = 'active'
    order by member.created_at asc limit 1
  ) owner on true
  left join lateral (
    select jsonb_agg(coalesce(subcategory.name, item.custom_name) order by coalesce(subcategory.sort_order, 999), coalesce(subcategory.name, item.custom_name)) as names
    from brand_profile_subcategories item
    left join content_subcategories subcategory on subcategory.id = item.subcategory_id
    where item.brand_profile_id = bp.id
  ) subcategories on true
  left join lateral (
    select max(value) as last_activity_at
    from (values
      ((select max(updated_at) from brand_channels where brand_id = b.id)),
      ((select max(updated_at) from publish_queue where brand_id = b.id)),
      ((select max(last_message_at) from instagram_dm_conversations where brand_id = b.id))
    ) recent(value)
  ) activity on true
`;

export function createAdminRepository(pool: Queryable): AdminRepository {
  return {
    async getOverview(): Promise<AdminOverviewDto> {
      const result = await pool.query(`
        select
          (select count(*) from brands where status = 'active' and deleted_at is null) as active_brands,
          (select count(*) from brands where status = 'paused' and deleted_at is null) as paused_brands,
          (select count(*) from brands where status = 'disabled' and deleted_at is null) as disabled_brands,
          (select count(*) from brand_channels where status = 'connected' and deleted_at is null) as connected_channels,
          (select count(*) from brand_channels where status in ('needs_attention', 'expired', 'insufficient_permissions', 'publish_failed') and deleted_at is null) as attention_channels,
          (select count(*) from channel_outputs where generated_at >= now() - interval '24 hours' and status <> 'generation_failed') as generation_succeeded_24h,
          (select count(*) from channel_outputs where generated_at >= now() - interval '24 hours' and status = 'generation_failed') as generation_failed_24h,
          (select count(*) from channel_outputs where status in ('pending_review', 'auto_approval_blocked')) as pending_review,
          (select count(*) from publish_queue where status in ('queued', 'scheduled', 'deferred')) as scheduled_publish,
          (select count(*) from publish_queue where status = 'publishing') as publishing,
          (select count(*) from publish_queue where status = 'failed') as failed_publish,
          (select count(*) from instagram_dm_messages where direction = 'inbound' and created_at >= now() - interval '24 hours') as dm_received_24h,
          (select count(*) from instagram_dm_messages where direction = 'outbound' and created_at >= now() - interval '24 hours') as dm_replied_24h,
          (select count(*) from instagram_dm_messages where direction = 'outbound' and decision = 'fallback' and created_at >= now() - interval '24 hours') as dm_fallback_24h,
          (select count(*) from jobs where job_type = 'instagram_dm_reply' and status in ('failed', 'dead') and created_at >= now() - interval '24 hours') as dm_failed_24h,
          (select count(*) from wiki_versions where status = 'active' and activated_at >= now() - interval '24 hours') as wiki_succeeded_24h,
          (select count(*) from wiki_versions where status = 'failed' and created_at >= now() - interval '24 hours') as wiki_failed_24h,
          (select count(*) from worker_instances where last_heartbeat_at >= now() - interval '90 seconds') as online_workers,
          (select count(*) from worker_instances where last_heartbeat_at < now() - interval '90 seconds') as stale_workers,
          coalesce((
            select jsonb_agg(error_row order by error_row."occurredAt" desc)
            from (
              select 'publish' as source, id::text, coalesce(last_error, 'publish_failed') as code, updated_at as "occurredAt"
              from publish_queue where status = 'failed'
              union all
              select 'job' as source, id::text, coalesce(last_error, 'job_failed') as code, updated_at as "occurredAt"
              from jobs where status in ('failed', 'dead')
              order by "occurredAt" desc limit 10
            ) error_row
          ), '[]'::jsonb) as recent_errors
      `);
      const row = result.rows[0] as Record<string, unknown>;
      return {
        generatedAt: new Date().toISOString(),
        brands: { active: count(row.active_brands), paused: count(row.paused_brands), disabled: count(row.disabled_brands) },
        channels: { connected: count(row.connected_channels), needsAttention: count(row.attention_channels) },
        generation24h: { succeeded: count(row.generation_succeeded_24h), failed: count(row.generation_failed_24h) },
        publishing: { pendingReview: count(row.pending_review), scheduled: count(row.scheduled_publish), publishing: count(row.publishing), failed: count(row.failed_publish) },
        dm24h: { received: count(row.dm_received_24h), replied: count(row.dm_replied_24h), fallback: count(row.dm_fallback_24h), failed: count(row.dm_failed_24h) },
        wiki24h: { succeeded: count(row.wiki_succeeded_24h), failed: count(row.wiki_failed_24h) },
        workers: { online: count(row.online_workers), stale: count(row.stale_workers) },
        recentErrors: arrayValue<AdminOverviewDto["recentErrors"][number]>(row.recent_errors),
      };
    },

    async listBrands(input): Promise<AdminPage<AdminBrandListItemDto>> {
      const cursor = decodeCursor(input.cursor);
      const result = await pool.query(`${brandSelect}
        where b.deleted_at is null
          and ($1::text is null or b.name ilike '%' || $1 || '%' or owner.email ilike '%' || $1 || '%')
          and ($2::text is null or b.status = $2)
          and ($3::timestamptz is null or (b.created_at, b.id) < ($3::timestamptz, $4::uuid))
        order by b.created_at desc, b.id desc
        limit $5
      `, [input.q?.trim() || null, input.status || null, cursor?.createdAt ?? null, cursor?.id ?? null, input.limit + 1]);
      return pageFromRows(result.rows.map((row) => mapBrand(row as Record<string, unknown>)), input.limit);
    },

    async getBrand(brandId): Promise<AdminBrandDetailDto | null> {
      const result = await pool.query(`${brandSelect}
        where b.id = $1 and b.deleted_at is null
      `, [brandId]);
      const raw = result.rows[0] as Record<string, unknown> | undefined;
      if (!raw) return null;
      const base = mapBrand(raw);
      const details = await pool.query(`
        select
          bp.primary_customer, bp.description, bp.tone, bp.default_cta, bp.main_link, bp.auto_approval_enabled,
          source.id as source_id, source.url as source_url, source.status as source_status, source.last_crawled_at,
          coalesce(sum(case when usage.usage_type = 'generation' then usage.quantity else 0 end), 0) as generation_count,
          coalesce(sum(case when usage.usage_type = 'new_download' then usage.quantity else 0 end), 0) as download_count
        from brand_profiles bp
        left join source_urls source on source.brand_id = bp.brand_id and source.source_type = 'owned' and source.deleted_at is null
        left join ai_content_usage_ledger usage on usage.brand_id = bp.brand_id and usage.usage_date = current_date
        where bp.brand_id = $1
        group by bp.id, source.id
        limit 1
      `, [brandId]);
      const row = details.rows[0] as Record<string, unknown> | undefined;
      return {
        ...base,
        profile: {
          primaryCustomer: row?.primary_customer ? String(row.primary_customer) : null,
          description: row?.description ? String(row.description) : null,
          tone: row?.tone ? String(row.tone) : null,
          defaultCta: row?.default_cta ? String(row.default_cta) : null,
          mainLink: row?.main_link ? String(row.main_link) : null,
          autoApprovalEnabled: Boolean(row?.auto_approval_enabled),
        },
        ownedSource: row?.source_id ? {
          id: String(row.source_id), url: String(row.source_url), status: String(row.source_status), lastCrawledAt: iso(row.last_crawled_at),
        } : null,
        aiContentUsageToday: { generationCount: count(row?.generation_count), downloadCount: count(row?.download_count) },
      };
    },

    async listChannels(input): Promise<AdminPage<AdminChannelListItemDto>> {
      const cursor = decodeCursor(input.cursor);
      const result = await pool.query(`
        select
          channel.id, channel.brand_id, brand.name as brand_name,
          channel.channel, channel.enabled, channel.status, credential.auth_mode,
          channel.account_label,
          case
            when channel.external_account_id is null then null
            when length(channel.external_account_id) <= 8 then repeat('*', length(channel.external_account_id))
            else left(channel.external_account_id, 4) || '...' || right(channel.external_account_id, 4)
          end as external_account_id_masked,
          coalesce(credential.scopes, array[]::text[]) as scopes,
          credential.expires_at, channel.last_healthy_at, channel.last_published_at,
          null::text as last_error_code, channel.last_error as last_error_message,
          channel.created_at
        from brand_channels channel
        join brands brand on brand.id = channel.brand_id
        left join channel_credentials credential on credential.brand_channel_id = channel.id and credential.revoked_at is null
        where channel.deleted_at is null and brand.deleted_at is null
          and ($1::text is null or brand.name ilike '%' || $1 || '%' or channel.account_label ilike '%' || $1 || '%')
          and ($2::uuid is null or channel.brand_id = $2)
          and ($3::text is null or channel.channel = $3)
          and ($4::text is null or channel.status = $4)
          and ($5::timestamptz is null or (channel.created_at, channel.id) < ($5::timestamptz, $6::uuid))
        order by channel.created_at desc, channel.id desc
        limit $7
      `, [input.q?.trim() || null, input.brandId || null, input.channel || null, input.status || null, cursor?.createdAt ?? null, cursor?.id ?? null, input.limit + 1]);
      const mapped = result.rows.map((row) => ({ ...mapChannel(row as Record<string, unknown>), createdAt: iso((row as Record<string, unknown>).created_at)! }));
      const page = pageFromRows(mapped, input.limit);
      return { items: page.items.map(({ createdAt: _createdAt, ...item }) => item), nextCursor: page.nextCursor };
    },

    async listFeedback(input): Promise<AdminPage<AdminFeedbackListItemDto>> {
      const cursor = decodeCursor(input.cursor);
      const result = await pool.query(`
        select feedback.id, feedback.workspace_id, workspace.name as workspace_name,
          feedback.brand_id, brand.name as brand_name, feedback.message, feedback.status,
          feedback.created_at, feedback.updated_at
        from feedback_submissions feedback
        join workspaces workspace on workspace.id = feedback.workspace_id
        join brands brand on brand.id = feedback.brand_id and brand.deleted_at is null
        where feedback.deleted_at is null
          and ($1::text is null or feedback.message ilike '%' || $1 || '%'
            or brand.name ilike '%' || $1 || '%' or workspace.name ilike '%' || $1 || '%')
          and ($2::uuid is null or feedback.brand_id = $2)
          and ($3::text is null or feedback.status = $3)
          and ($4::timestamptz is null or (feedback.created_at, feedback.id) < ($4::timestamptz, $5::uuid))
        order by feedback.created_at desc, feedback.id desc
        limit $6
      `, [input.q?.trim() || null, input.brandId || null, input.status || null,
        cursor?.createdAt ?? null, cursor?.id ?? null, input.limit + 1]);
      return pageFromRows(result.rows.map((row) => mapFeedback(row as Record<string, unknown>)), input.limit);
    },

    async listSupportRequests(input): Promise<AdminPage<AdminSupportRequestListItemDto>> {
      const cursor = decodeCursor(input.cursor);
      const result = await pool.query(`
        select support.id, support.workspace_id, workspace.name as workspace_name,
          support.brand_id, brand.name as brand_name, support.category, support.title,
          support.message, support.contact_phone, support.contact_email, support.status,
          support.response_message, support.responded_at, support.created_at, support.updated_at
        from support_requests support
        join workspaces workspace on workspace.id = support.workspace_id
        join brands brand on brand.id = support.brand_id and brand.deleted_at is null
        where support.deleted_at is null
          and ($1::text is null or support.title ilike '%' || $1 || '%'
            or support.message ilike '%' || $1 || '%' or brand.name ilike '%' || $1 || '%'
            or support.contact_email ilike '%' || $1 || '%')
          and ($2::uuid is null or support.brand_id = $2)
          and ($3::text is null or support.status = $3)
          and ($4::timestamptz is null or (support.created_at, support.id) < ($4::timestamptz, $5::uuid))
        order by support.created_at desc, support.id desc
        limit $6
      `, [input.q?.trim() || null, input.brandId || null, input.status || null,
        cursor?.createdAt ?? null, cursor?.id ?? null, input.limit + 1]);
      return pageFromRows(result.rows.map((row) => mapSupportRequest(row as Record<string, unknown>)), input.limit);
    },

    async listPublishing(input): Promise<AdminPage<AdminPublishingListItemDto>> {
      const cursor = decodeCursor(input.cursor);
      const result = await pool.query(`
        select pq.id, pq.brand_id, brand.name as brand_name,
          co.title as content_title, topic.title as topic_title,
          pq.channel, co.delivery_format, co.status as output_status,
          pq.status, pq.approval_type, pq.scheduled_for, pq.published_at,
          pq.queued_at, pq.created_at, pq.last_error,
          coalesce(attempts.attempt_count, 0) as attempt_count,
          attempts.external_url,
          artifact.public_url as artifact_public_url, artifact.mime_type as artifact_mime_type
        from publish_queue pq
        join brands brand on brand.id = pq.brand_id and brand.deleted_at is null
        join channel_outputs co on co.id = pq.channel_output_id
        left join content_topics topic on topic.id = co.content_topic_id
        left join storage_artifacts artifact on artifact.id = co.rendered_artifact_id and artifact.deleted_at is null
        left join lateral (
          select count(*)::int as attempt_count,
            (array_agg(pa.external_url order by pa.created_at desc) filter (where pa.external_url is not null))[1] as external_url
          from publish_attempts pa where pa.publish_queue_id = pq.id
        ) attempts on true
        where ($1::text is null or brand.name ilike '%' || $1 || '%'
          or co.title ilike '%' || $1 || '%' or topic.title ilike '%' || $1 || '%')
          and ($2::uuid is null or pq.brand_id = $2)
          and ($3::text is null or pq.channel = $3)
          and ($4::text is null or pq.status = $4)
          and ($5::timestamptz is null or (pq.created_at, pq.id) < ($5::timestamptz, $6::uuid))
        order by pq.created_at desc, pq.id desc limit $7
      `, [input.q?.trim() || null, input.brandId || null, input.channel || null, input.status || null,
        cursor?.createdAt ?? null, cursor?.id ?? null, input.limit + 1]);
      return pageFromRows(result.rows.map((row) => mapPublishing(row as Record<string, unknown>)), input.limit);
    },

    async getPublishing(queueId): Promise<AdminPublishingDetailDto | null> {
      const result = await pool.query(`
        select pq.id, pq.workspace_id, pq.brand_id, brand.name as brand_name,
          pq.channel_output_id, co.title as content_title, co.preview_title, co.preview_body,
          co.source_summary, co.output_json, co.block_reasons,
          topic.title as topic_title, topic.angle as topic_angle,
          topic_row.reference_url, source_refs.source_urls,
          pq.channel, co.delivery_format, co.status as output_status,
          pq.status, pq.approval_type, pq.scheduled_for, pq.published_at, pq.failed_at,
          pq.queued_at, pq.created_at, pq.last_error,
          (select count(*) from publish_attempts pa where pa.publish_queue_id = pq.id) as attempt_count,
          latest_attempt.external_url,
          artifact.id as artifact_id, artifact.artifact_type, artifact.public_url as artifact_public_url,
          artifact.mime_type as artifact_mime_type, artifact.byte_size as artifact_byte_size
        from publish_queue pq
        join brands brand on brand.id = pq.brand_id and brand.deleted_at is null
        join channel_outputs co on co.id = pq.channel_output_id
        left join content_topics topic on topic.id = co.content_topic_id
        left join topic_rows topic_row on topic_row.id = topic.topic_row_id
        left join storage_artifacts artifact on artifact.id = co.rendered_artifact_id and artifact.deleted_at is null
        left join lateral (
          select pa.external_url from publish_attempts pa
          where pa.publish_queue_id = pq.id and pa.external_url is not null
          order by pa.created_at desc limit 1
        ) latest_attempt on true
        left join lateral (
          select coalesce(array_agg(distinct coalesce(item.content_url, source.url)
            order by coalesce(item.content_url, source.url)), '{}'::text[]) as source_urls
          from jsonb_array_elements_text(
            case when topic.source_context ? 'sourceSnapshotId'
              then jsonb_build_array(topic.source_context ->> 'sourceSnapshotId')
              else coalesce(topic.source_context -> 'sourceSnapshotIds', '[]'::jsonb) end
          ) snapshot_ref(id)
          join source_snapshots snapshot on snapshot.id = snapshot_ref.id::uuid
          join source_urls source on source.id = snapshot.source_url_id
          left join source_content_items item on item.id = snapshot.source_content_item_id and item.deleted_at is null
          where snapshot.source_content_item_id is null or item.id is not null
        ) source_refs on true
        where pq.id = $1
      `, [queueId]);
      const raw = result.rows[0] as Record<string, unknown> | undefined;
      if (!raw) return null;
      const base = mapPublishing(raw);
      const attemptsResult = await pool.query(`
        select id, attempt_number, status, response_metadata, external_post_id, external_url,
          error_code, error_message, started_at, finished_at
        from publish_attempts where publish_queue_id = $1
        order by attempt_number desc
      `, [queueId]);
      const reviewsResult = await pool.query(`
        select review.id, review.event_type, review.actor_type, review.reason, review.created_at
        from review_events review
        where review.channel_output_id = $1
        order by review.created_at desc
      `, [String(raw.channel_output_id)]);
      return {
        ...base,
        workspaceId: String(raw.workspace_id),
        channelOutputId: String(raw.channel_output_id),
        previewTitle: raw.preview_title ? String(raw.preview_title) : null,
        previewBody: raw.preview_body ? String(raw.preview_body) : null,
        sourceSummary: raw.source_summary ? String(raw.source_summary) : null,
        output: sanitizeMetadata(objectValue(raw.output_json)) as Record<string, unknown>,
        blockReasons: arrayValue(raw.block_reasons),
        failedAt: iso(raw.failed_at),
        topic: {
          title: raw.topic_title ? String(raw.topic_title) : null,
          angle: raw.topic_angle ? String(raw.topic_angle) : null,
          referenceUrl: raw.reference_url ? String(raw.reference_url) : null,
          sourceUrls: arrayValue<unknown>(raw.source_urls).map(String),
        },
        artifact: raw.artifact_id && raw.artifact_public_url ? {
          id: String(raw.artifact_id), type: String(raw.artifact_type), publicUrl: String(raw.artifact_public_url),
          mimeType: raw.artifact_mime_type ? String(raw.artifact_mime_type) : null,
          byteSize: raw.artifact_byte_size === null || raw.artifact_byte_size === undefined ? null : count(raw.artifact_byte_size),
        } : null,
        attempts: attemptsResult.rows.map((attemptRaw) => {
          const attempt = attemptRaw as Record<string, unknown>;
          return {
            id: String(attempt.id), attemptNumber: count(attempt.attempt_number), status: String(attempt.status),
            responseMetadata: sanitizeMetadata(objectValue(attempt.response_metadata)) as Record<string, unknown>,
            externalPostId: attempt.external_post_id ? String(attempt.external_post_id) : null,
            externalUrl: attempt.external_url ? String(attempt.external_url) : null,
            errorCode: attempt.error_code ? String(attempt.error_code) : null,
            errorMessage: attempt.error_message ? String(attempt.error_message) : null,
            startedAt: iso(attempt.started_at)!, finishedAt: iso(attempt.finished_at),
          };
        }),
        reviews: reviewsResult.rows.map((reviewRaw) => {
          const review = reviewRaw as Record<string, unknown>;
          return {
            id: String(review.id), eventType: String(review.event_type), actorType: String(review.actor_type),
            reason: review.reason ? String(review.reason) : null, createdAt: iso(review.created_at)!,
          };
        }),
      };
    },

    async updatePublishingStatus(input) {
      const client = await pool.connect() as PoolClient;
      try {
        await client.query("begin");
        await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`${input.actorId}:${input.idempotencyKey}`]);
        const replay = await client.query(`
          select request_hash, response_json from admin_idempotency_keys
          where actor_external_id = $1 and idempotency_key = $2
        `, [input.actorId, input.idempotencyKey]);
        if (replay.rowCount) {
          const row = replay.rows[0] as { request_hash: string; response_json: { id: string; status: string; updatedAt: string } };
          if (row.request_hash !== input.requestHash) throw new AdminIdempotencyConflictError();
          await client.query("commit");
          return { ...row.response_json, replayed: true };
        }

        const current = await client.query(`
          select pq.id, pq.workspace_id, pq.brand_id, pq.topic_publish_group_id,
            pq.status, pq.last_error, tpg.status as group_status,
            tpg.slot_date, tpg.slot_number, tpg.scheduled_for
          from publish_queue pq
          join topic_publish_groups tpg on tpg.id = pq.topic_publish_group_id
          where pq.id = $1 for update of pq, tpg
        `, [input.queueId]);
        if (!current.rowCount) throw new Error("admin_publish_not_found");
        const before = current.rows[0] as {
          id: string; workspace_id: string; brand_id: string; topic_publish_group_id: string;
          status: string; last_error: string | null; group_status: string;
          slot_date: Date | string | null; slot_number: number | null; scheduled_for: Date | string | null;
        };

        let updated;
        if (input.action === "retry") {
          if (before.status !== "failed" || !before.last_error || !retryablePublishErrors.has(before.last_error)) {
            throw new AdminStateConflictError();
          }
          const keepSchedule = ["scheduled", "partially_published"].includes(before.group_status) && before.scheduled_for;
          const nextStatus = keepSchedule ? "scheduled" : "queued";
          updated = await client.query(`
            update publish_queue set status = $2,
              slot_date = $3, slot_number = $4, scheduled_for = $5,
              failed_at = null, publishing_started_at = null, last_error = null, updated_at = now()
            where id = $1 returning id, status, updated_at
          `, [input.queueId, nextStatus, keepSchedule ? before.slot_date : null,
            keepSchedule ? before.slot_number : null, keepSchedule ? before.scheduled_for : null]);
          if (nextStatus === "queued") {
            await client.query(`
              update topic_publish_groups set status = 'waiting', slot_date = null,
                slot_number = null, scheduled_for = null, updated_at = now()
              where id = $1
            `, [before.topic_publish_group_id]);
          }
        } else {
          if (!cancellablePublishStatuses.has(before.status)) throw new AdminStateConflictError();
          updated = await client.query(`
            update publish_queue set status = 'cancelled', deferred_until = null,
              publishing_started_at = null, updated_at = now()
            where id = $1 returning id, status, updated_at
          `, [input.queueId]);
          await client.query(`
            update topic_publish_groups tpg set
              status = case
                when exists (select 1 from publish_queue pq where pq.topic_publish_group_id = tpg.id and pq.status = 'failed') then 'failed'
                when exists (select 1 from publish_queue pq where pq.topic_publish_group_id = tpg.id and pq.status = 'published') then 'published'
                else 'cancelled' end,
              slot_date = null, slot_number = null, scheduled_for = null, updated_at = now()
            where tpg.id = $1
              and not exists (
                select 1 from publish_queue pq where pq.topic_publish_group_id = tpg.id
                  and pq.status in ('queued', 'scheduled', 'publishing', 'deferred')
              )
          `, [before.topic_publish_group_id]);
        }

        const changed = updated.rows[0] as { id: string; status: string; updated_at: Date | string };
        const response = { id: changed.id, status: changed.status, updatedAt: iso(changed.updated_at)! };
        const eventType = input.action === "retry" ? "admin.publish_retried" : "admin.publish_cancelled";
        await client.query(`
          insert into audit_events (
            workspace_id, brand_id, actor_type, actor_external_id, event_type, entity_type, entity_id,
            before_json, after_json, metadata
          ) values ($1, $2, 'admin', $3, $4, 'publish_queue', $5, $6::jsonb, $7::jsonb, $8::jsonb)
        `, [before.workspace_id, before.brand_id, input.actorId, eventType, input.queueId,
          JSON.stringify({ status: before.status, lastError: before.last_error }), JSON.stringify({ status: changed.status }),
          JSON.stringify({ reason: input.reason, requestId: input.requestId, idempotencyKey: input.idempotencyKey })]);
        const path = `/admin/v1/publishing/${input.queueId}/${input.action}`;
        await client.query(`
          insert into admin_idempotency_keys (
            actor_external_id, idempotency_key, method, path, request_hash, response_status, response_json
          ) values ($1, $2, 'POST', $3, $4, 200, $5::jsonb)
        `, [input.actorId, input.idempotencyKey, path, input.requestHash, JSON.stringify(response)]);
        await client.query("commit");
        return { ...response, replayed: false };
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async getSystemHealth(): Promise<AdminSystemHealthDto> {
      const result = await pool.query(`
        select
          coalesce((select jsonb_object_agg(status, total) from (select status, count(*)::int as total from jobs group by status) queue), '{}'::jsonb) as queue_counts,
          coalesce((select jsonb_agg(jsonb_build_object(
            'workerId', worker_id, 'workerType', worker_type,
            'status', case when last_heartbeat_at >= now() - interval '90 seconds' then 'online' when last_heartbeat_at >= now() - interval '10 minutes' then 'stale' else 'offline' end,
            'lastHeartbeatAt', last_heartbeat_at, 'metadata', metadata
          ) order by worker_id) from worker_instances), '[]'::jsonb) as workers,
          coalesce((select jsonb_agg(jsonb_build_object(
            'resourceType', resource_type, 'workloadType', workload_type, 'workerId', worker_id, 'expiresAt', expires_at
          ) order by expires_at) from worker_resource_leases where expires_at > now()), '[]'::jsonb) as leases,
          coalesce((select jsonb_agg(run_row order by run_row."startedAt" desc) from (
            select run_type as type, status, started_at as "startedAt", finished_at as "finishedAt"
            from automation_runs order by started_at desc limit 10
          ) run_row), '[]'::jsonb) as schedulers
      `);
      const row = result.rows[0] as Record<string, unknown>;
      const queueCounts = Object.fromEntries(Object.entries(objectValue(row.queue_counts)).map(([key, value]) => [key, count(value)]));
      return {
        database: "ok",
        checkedAt: new Date().toISOString(),
        queueCounts,
        workers: arrayValue<AdminSystemHealthDto["workers"][number]>(row.workers),
        leases: arrayValue<AdminSystemHealthDto["leases"][number]>(row.leases),
        schedulers: arrayValue<AdminSystemHealthDto["schedulers"][number]>(row.schedulers),
      };
    },

    async listAuditEvents(input): Promise<AdminPage<AdminAuditEventDto>> {
      const cursor = decodeCursor(input.cursor);
      const result = await pool.query(`
        select id, created_at, actor_type, actor_external_id, event_type, brand_id, entity_type, entity_id,
          metadata->>'reason' as reason, before_json, after_json,
          metadata->>'requestId' as request_id, metadata->>'idempotencyKey' as idempotency_key
        from audit_events
        where ($1::uuid is null or brand_id = $1)
          and ($2::text is null or event_type = $2)
          and ($3::timestamptz is null or (created_at, id) < ($3::timestamptz, $4::uuid))
        order by created_at desc, id desc limit $5
      `, [input.brandId || null, input.status || null, cursor?.createdAt ?? null, cursor?.id ?? null, input.limit + 1]);
      const rows = result.rows.map((raw) => {
        const row = raw as Record<string, unknown>;
        return {
          id: String(row.id), createdAt: iso(row.created_at)!, actorType: String(row.actor_type),
          actorId: row.actor_external_id ? String(row.actor_external_id) : null,
          eventType: String(row.event_type), brandId: row.brand_id ? String(row.brand_id) : null,
          entityType: String(row.entity_type), entityId: row.entity_id ? String(row.entity_id) : null,
          reason: row.reason ? String(row.reason) : null,
          before: row.before_json ? objectValue(row.before_json) : null,
          after: row.after_json ? objectValue(row.after_json) : null,
          requestId: row.request_id ? String(row.request_id) : null,
          idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
        } satisfies AdminAuditEventDto;
      });
      return pageFromRows(rows, input.limit);
    },

    async updateBrandStatus(input) {
      const client = await pool.connect() as PoolClient;
      try {
        await client.query("begin");
        await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`${input.actorId}:${input.idempotencyKey}`]);
        const replay = await client.query(`
          select request_hash, response_json
          from admin_idempotency_keys
          where actor_external_id = $1 and idempotency_key = $2
        `, [input.actorId, input.idempotencyKey]);
        if (replay.rowCount) {
          const row = replay.rows[0] as { request_hash: string; response_json: { id: string; status: "active" | "paused"; updatedAt: string } };
          if (row.request_hash !== input.requestHash) throw new AdminIdempotencyConflictError();
          await client.query("commit");
          return { ...row.response_json, replayed: true };
        }

        const current = await client.query(`
          select id, workspace_id, status from brands where id = $1 and deleted_at is null for update
        `, [input.brandId]);
        if (!current.rowCount) throw new Error("admin_brand_not_found");
        const before = current.rows[0] as { id: string; workspace_id: string; status: string };
        if (!["active", "paused"].includes(before.status) || before.status === input.status) throw new AdminStateConflictError();

        const updated = await client.query(`
          update brands set status = $2, updated_at = now() where id = $1 returning id, status, updated_at
        `, [input.brandId, input.status]);
        const changed = updated.rows[0] as { id: string; status: "active" | "paused"; updated_at: Date | string };
        const response = { id: changed.id, status: changed.status, updatedAt: iso(changed.updated_at)! };
        const eventType = input.status === "paused" ? "admin.brand_paused" : "admin.brand_reactivated";

        await client.query(`
          insert into audit_events (
            workspace_id, brand_id, actor_type, actor_external_id, event_type, entity_type, entity_id,
            before_json, after_json, metadata
          ) values ($1, $2, 'admin', $3, $4, 'brand', $2, $5::jsonb, $6::jsonb, $7::jsonb)
        `, [before.workspace_id, input.brandId, input.actorId, eventType,
          JSON.stringify({ status: before.status }), JSON.stringify({ status: input.status }),
          JSON.stringify({ reason: input.reason, requestId: input.requestId, idempotencyKey: input.idempotencyKey })]);

        await client.query(`
          insert into admin_idempotency_keys (
            actor_external_id, idempotency_key, method, path, request_hash, response_status, response_json
          ) values ($1, $2, 'PATCH', $3, $4, 200, $5::jsonb)
        `, [input.actorId, input.idempotencyKey, `/admin/v1/brands/${input.brandId}/status`, input.requestHash, JSON.stringify(response)]);
        await client.query("commit");
        return { ...response, replayed: false };
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
