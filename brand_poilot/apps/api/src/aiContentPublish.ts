import type { Pool, PoolClient } from "pg";
import type {
  AiContentManifestV3,
  ContentPurpose,
  ContentStudioOutputFormat,
  SocialManifestContent,
} from "@brand-pilot/content-contracts";
import { parseActiveAiContentManifestV3 } from "./aiContentManifest.js";
import {
  resolveAiContentPublishTarget,
  type AiContentPublishDeliveryFormat,
  type AiContentPublishRequest,
  type AiContentPublishTarget,
} from "./aiContentPublishTargets.js";
import type { Channel } from "./types.js";

interface BrandOutputScope {
  workspaceId: string;
  brandId: string;
  outputId: string;
}

interface QueueScope {
  workspaceId: string;
  brandId: string;
  queueId: string;
}

export interface AiContentPublishTargetResult {
  channel: Channel;
  deliveryFormat: AiContentPublishDeliveryFormat;
  channelOutputId: string;
  queueId: string | null;
  status: "queued" | "scheduled" | "publishing" | "published" | "failed";
  dispatchAllowed: boolean;
  publishedUrl: string | null;
  errorCode: string | null;
  recovery?: {
    action: "none" | "retry" | "reconcile";
    retryAllowed: boolean;
    retryReason: string;
    cancelAllowed: boolean;
    cancelReason: string | null;
  };
}

export interface PreparedAiContentPublishResult {
  publishGroupId: string;
  targets: AiContentPublishTargetResult[];
}

export interface AiContentPublishRepository {
  prepareAiContentPublish(input: BrandOutputScope & AiContentPublishRequest): Promise<PreparedAiContentPublishResult>;
  getAiContentPublishQueueResult(input: QueueScope): Promise<AiContentPublishTargetResult>;
  prepareCompletedCalendarPublish(
    input: BrandOutputScope & { preparationEnabled?: boolean },
  ): Promise<PreparedAiContentPublishResult | null>;
}

interface OutputRow {
  id: string;
  generation_id: string;
  status: string;
  artifact_manifest_json: unknown;
  manifest_url: unknown;
  output_format: ContentStudioOutputFormat;
  purpose: ContentPurpose;
  title: string;
  draft_json: unknown;
}

interface CalendarSlotRow {
  id: string;
  scheduled_for: Date | string;
  assignment_mode: "automatic" | "manual";
  status: string;
  content_format: ContentStudioOutputFormat;
  channels: Channel[];
}

interface PublishContext {
  topicId: string;
  masterDraftId: string;
  publishGroupId: string;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function vercelBlobUrl(value: unknown) {
  const raw = text(value);
  if (!raw) throw new Error("ai_content_manifest_url_missing");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("ai_content_manifest_url_invalid");
  }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".public.blob.vercel-storage.com")) {
    throw new Error("ai_content_manifest_url_invalid");
  }
  return url;
}

function normalizeQueueStatus(value: unknown): AiContentPublishTargetResult["status"] {
  if (value === "queued") return value;
  if (value === "publishing" || value === "published" || value === "failed") return value;
  return "scheduled";
}

function publishRecovery(status: AiContentPublishTargetResult["status"], errorCode: string | null) {
  const resultUnknown = status === "failed" && errorCode === "publish_delivery_unknown";
  const retryAllowed = status === "failed"
    && (errorCode === "oauth_required" || errorCode === "provider_not_implemented");
  const cancelAllowed = status === "queued" || status === "scheduled";
  return {
    action: resultUnknown ? "reconcile" as const : retryAllowed ? "retry" as const : "none" as const,
    retryAllowed,
    retryReason: errorCode ?? (status === "failed" ? "publish_queue_not_retryable" : "publish_not_failed"),
    cancelAllowed,
    cancelReason: cancelAllowed ? null : status === "publishing" || status === "published" || status === "failed"
      ? "publish_already_attempted"
      : "publish_not_cancellable",
  };
}

function outputCopy(manifest: AiContentManifestV3) {
  if ((manifest.outputFormat !== "card_news" && manifest.outputFormat !== "reel") || !("caption" in manifest.content)) {
    throw new Error("ai_content_publish_type_not_supported");
  }
  const content = manifest.content as SocialManifestContent;
  return {
    angle: text(content.caption) || manifest.title,
    previewBody: manifest.outputFormat === "reel"
      ? "완성된 릴스 영상"
      : `카드뉴스 ${manifest.assets.length}장`,
    draft: { title: manifest.title, caption: content.caption, hashtags: content.hashtags, cta: content.cta },
    output: { caption: content.caption, hashtags: content.hashtags, cta: content.cta },
  };
}

function assertPublishableManifest(manifest: AiContentManifestV3) {
  if (manifest.outputFormat === "card_news") {
    if (manifest.assets.some((asset) => asset.role !== "slide" || asset.mimeType !== "image/png")) {
      throw new Error("ai_content_publish_type_not_supported");
    }
    return;
  }
  if (manifest.outputFormat === "reel") {
    const videos = manifest.assets.filter((asset) => asset.role === "video" && asset.mimeType === "video/mp4");
    if (videos.length !== 1) throw new Error("ai_content_publish_reel_video_invalid");
    return;
  }
  throw new Error("ai_content_publish_type_not_supported");
}

function manifestVideo(manifest: AiContentManifestV3) {
  const videos = manifest.assets.filter((asset) => asset.role === "video" && asset.mimeType === "video/mp4");
  if (manifest.outputFormat !== "reel" || videos.length !== 1) {
    throw new Error("ai_content_publish_reel_video_invalid");
  }
  const video = videos[0];
  if (!("durationSeconds" in video)) {
    throw new Error("ai_content_publish_reel_video_invalid");
  }
  return {
    index: video.index,
    role: video.role,
    url: video.url,
    fileName: video.fileName,
    mimeType: video.mimeType,
    width: video.width,
    height: video.height,
    durationSeconds: video.durationSeconds,
    videoCodec: video.videoCodec,
    fps: video.fps,
    audioCodec: video.audioCodec,
  };
}

function manifestAssets(manifest: AiContentManifestV3, target: AiContentPublishTarget) {
  if (manifest.outputFormat !== "card_news") {
    throw new Error("ai_content_publish_type_not_supported");
  }
  const assets = target.deliveryFormat === "instagram_story" || target.deliveryFormat === "instagram_feed_single"
    ? manifest.assets.slice(0, 1)
    : manifest.assets;
  return assets.map((asset) => ({
    index: asset.index,
    role: asset.role,
    embeddedText: "",
    url: asset.url,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    width: "width" in asset ? asset.width : undefined,
    height: "height" in asset ? asset.height : undefined,
  }));
}

async function findPublishContext(
  client: PoolClient,
  input: BrandOutputScope,
): Promise<PublishContext | null> {
  const existing = await client.query(
    `select topic.id as content_topic_id, master.id as master_draft_id, topic_group.id as publish_group_id
       from content_topics topic
       join master_drafts master on master.content_topic_id = topic.id
       join topic_publish_groups topic_group on topic_group.content_topic_id = topic.id
      where topic.workspace_id = $1 and topic.brand_id = $2
        and topic.source_context ->> 'aiContentOutputId' = $3
      limit 1`,
    [input.workspaceId, input.brandId, input.outputId],
  );
  if (existing.rowCount) {
    const row = existing.rows[0];
    return {
      topicId: String(row.content_topic_id),
      masterDraftId: String(row.master_draft_id),
      publishGroupId: String(row.publish_group_id),
    };
  }
  return null;
}

async function getOrCreatePublishContext(
  client: PoolClient,
  input: BrandOutputScope,
  manifest: AiContentManifestV3,
  existing: PublishContext | null,
  calendarLinked: boolean,
): Promise<PublishContext> {
  if (existing) {
    if (calendarLinked) {
      await client.query(
        `update topic_publish_groups
            set status='waiting', scheduled_for=null
          where id=$1 and workspace_id=$2 and brand_id=$3`,
        [existing.publishGroupId, input.workspaceId, input.brandId],
      );
    }
    return existing;
  }

  const copy = outputCopy(manifest);
  const topic = await client.query(
    `insert into content_topics (workspace_id, brand_id, title, angle, status, source_context, generated_at)
     values ($1, $2, $3, $4, 'generated', $5::jsonb, now()) returning id`,
    [input.workspaceId, input.brandId, manifest.title, copy.angle, JSON.stringify({ source: "ai_content_studio", aiContentOutputId: input.outputId })],
  );
  const topicId = String(topic.rows[0].id);
  const master = await client.query(
    `insert into master_drafts (workspace_id, brand_id, content_topic_id, status, prompt_version, draft_json, source_snapshot_refs)
     values ($1, $2, $3, 'generated', 'ai-content.v3', $4::jsonb, '[]'::jsonb) returning id`,
    [input.workspaceId, input.brandId, topicId, JSON.stringify(copy.draft)],
  );
  const group = await client.query(
    `insert into topic_publish_groups (workspace_id, brand_id, content_topic_id, status, scheduled_for)
     values ($1, $2, $3, $4, case when $4='waiting' then null else now() end) returning id`,
    [input.workspaceId, input.brandId, topicId, calendarLinked ? "waiting" : "scheduled"],
  );
  return {
    topicId,
    masterDraftId: String(master.rows[0].id),
    publishGroupId: String(group.rows[0].id),
  };
}

async function findActiveCalendarSlot(
  client: PoolClient,
  input: BrandOutputScope,
  output: OutputRow,
  context: PublishContext | null,
): Promise<CalendarSlotRow | null> {
  const result = await client.query(
    `select id,scheduled_for,assignment_mode,status,content_format,channels
       from publish_calendar_slots
      where workspace_id=$1 and brand_id=$2 and status<>'cancelled'
        and (
          generation_output_id=$3
          or (
            generation_id=$4
            and generation_output_id is null
            and $3::uuid=(
              select candidate.id
                from ai_content_generation_outputs candidate
               where candidate.generation_id=$4
                 and candidate.workspace_id=$1 and candidate.brand_id=$2
               order by candidate.output_index,candidate.id
               limit 1
            )
          )
          or ($5::uuid is not null and topic_publish_group_id=$5::uuid)
        )
      order by id
      for update`,
    [input.workspaceId, input.brandId, input.outputId, output.generation_id, context?.publishGroupId ?? null],
  );
  if (result.rows.length > 1) throw new Error("publish_calendar_slot_ambiguous");
  return result.rows[0] as CalendarSlotRow | undefined ?? null;
}

function calendarTargets(slot: CalendarSlotRow, manifest: AiContentManifestV3): AiContentPublishTarget[] {
  if (slot.content_format !== manifest.outputFormat) throw new Error("publish_calendar_content_format_mismatch");
  const deliveryFormat: AiContentPublishDeliveryFormat = manifest.outputFormat === "card_news"
    ? "instagram_feed_carousel"
    : manifest.outputFormat === "reel"
      ? "instagram_reel"
      : (() => { throw new Error("ai_content_publish_type_not_supported"); })();
  return slot.channels.map((channel) => {
    if (channel !== "instagram") throw new Error("ai_content_publish_target_unsupported");
    return { channel, deliveryFormat };
  });
}

function assertCalendarRequestTargets(
  requested: readonly AiContentPublishTarget[],
  derived: readonly AiContentPublishTarget[],
): void {
  const requestedChannels = [...new Set(requested.map(({ channel }) => channel))].sort();
  const slotChannels = [...new Set(derived.map(({ channel }) => channel))].sort();
  if (
    requested.length !== derived.length
    || requestedChannels.length !== slotChannels.length
    || requestedChannels.some((channel, index) => channel !== slotChannels[index])
    || requested.some((target) => !derived.some((candidate) => (
      candidate.channel === target.channel && candidate.deliveryFormat === target.deliveryFormat
    )))
  ) {
    throw new Error("publish_calendar_targets_mismatch");
  }
}

function stableCalendarPreparationError(error: unknown): string {
  const raw = error instanceof Error ? error.message.trim() : "unknown";
  const allowed = new Set([
    "channel_oauth_not_connected",
    "ai_content_publish_target_unsupported",
    "publish_calendar_content_format_mismatch",
    "publish_calendar_targets_mismatch",
    "publish_calendar_slot_ambiguous",
    "publish_calendar_queue_already_attempted",
    "publish_calendar_advanced_slot_link_invalid",
    "publish_calendar_slot_conflict",
    "publishing_disabled",
  ]);
  const code = allowed.has(raw) ? raw : "publish_calendar_prepare_failed";
  return `calendar_publish_prepare_failed:${code}`;
}

async function recordCalendarPreparationDelay(pool: Pool, input: BrandOutputScope, error: unknown): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const candidates = await client.query(
      `select slot.id
         from publish_calendar_slots slot
        where slot.workspace_id=$1 and slot.brand_id=$2
          and slot.status in ('proposal_assigned','generation_pending','content_assigned','publish_delayed','quota_blocked')
          and (
            slot.generation_output_id=$3
            or (
              slot.generation_output_id is null
              and slot.generation_id=(
                select output.generation_id from ai_content_generation_outputs output
                 where output.id=$3 and output.workspace_id=$1 and output.brand_id=$2
              )
              and $3::uuid=(
                select candidate.id
                  from ai_content_generation_outputs current_output
                  join ai_content_generation_outputs candidate
                    on candidate.generation_id=current_output.generation_id
                   and candidate.workspace_id=current_output.workspace_id
                   and candidate.brand_id=current_output.brand_id
                 where current_output.id=$3
                   and current_output.workspace_id=$1 and current_output.brand_id=$2
                 order by candidate.output_index,candidate.id
                 limit 1
              )
            )
            or slot.topic_publish_group_id in (
              select topic_group.id
                from topic_publish_groups topic_group
                join content_topics topic on topic.id=topic_group.content_topic_id
               where topic.workspace_id=$1 and topic.brand_id=$2
                  and topic.source_context->>'aiContentOutputId'=$3::text
            )
          )
        order by slot.id
        for update of slot`,
      [input.workspaceId, input.brandId, input.outputId],
    );
    const candidateIds = candidates.rows.map((row) => String(row.id));
    if (candidateIds.length) {
      await client.query(
        `update publish_calendar_slots slot
            set status='publish_delayed',last_error=$2,updated_at=now()
          where slot.id=any($1::uuid[])
            and slot.status in ('proposal_assigned','generation_pending','content_assigned','publish_delayed','quota_blocked')
            and not exists (
              select 1
                from publish_queue queue
               where queue.topic_publish_group_id=slot.topic_publish_group_id
                 and queue.status in ('queued','scheduled','publishing','published','deferred')
            )`,
        [candidateIds, stableCalendarPreparationError(error)],
      );
    }
    await client.query("COMMIT");
  } catch (recordError) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw recordError;
  } finally {
    client.release();
  }
}

export async function storeManifestArtifact(client: PoolClient, input: BrandOutputScope, manifestUrlValue: unknown) {
  const manifestUrl = vercelBlobUrl(manifestUrlValue);
  const artifactPath = decodeURIComponent(manifestUrl.pathname).replace(/^\/+/, "");
  await client.query(
    `insert into storage_artifacts (workspace_id, brand_id, artifact_type, bucket, path, public_url, mime_type, byte_size)
     values ($1, $2, 'generated_manifest', 'vercel-blob', $3, $4, 'application/json', 0)
     on conflict (bucket, path) do nothing`,
    [input.workspaceId, input.brandId, artifactPath, String(manifestUrlValue)],
  );
  const artifact = await client.query(
    `select id, workspace_id, brand_id
       from storage_artifacts
      where bucket = $1 and path = $2`,
    ["vercel-blob", artifactPath],
  );
  const row = artifact.rows[0];
  if (
    !row
    || String(row.workspace_id).toLowerCase() !== input.workspaceId.toLowerCase()
    || String(row.brand_id).toLowerCase() !== input.brandId.toLowerCase()
  ) {
    throw new Error("ai_content_manifest_artifact_ownership_conflict");
  }
  return String(row.id);
}

async function findExistingTarget(
  client: PoolClient,
  outputId: string,
  target: AiContentPublishTarget,
  requestIdempotencyKey: string,
): Promise<{
  channelOutputId: string;
  queueId: string | null;
  queueStatus: string | null;
  hasAttempt: boolean;
  result: AiContentPublishTargetResult | null;
} | null> {
  const targetIdempotencyKey = `ai-content:${outputId}:${target.channel}:${target.deliveryFormat}:${requestIdempotencyKey}`;
  const result = await client.query(
    `select channel_output.id as channel_output_id, pq.id as queue_id, pq.status as queue_status,
            pq.idempotency_key, pq.last_error, latest_attempt.external_url as published_url,
            exists(select 1 from publish_attempts attempt where attempt.publish_queue_id=pq.id) as has_attempt
       from channel_outputs channel_output
       left join lateral (
         select queue.*
           from publish_queue queue
          where queue.channel_output_id = channel_output.id
          order by case
            when queue.idempotency_key = $4 then 0
            when queue.status in ('scheduled', 'publishing', 'published') then 1
            else 2
          end, queue.created_at desc
          limit 1
       ) pq on true
       left join lateral (
         select attempt.external_url
           from publish_attempts attempt
          where attempt.publish_queue_id = pq.id and attempt.status = 'succeeded'
          order by attempt.finished_at desc nulls last, attempt.created_at desc
          limit 1
       ) latest_attempt on true
      where channel_output.ai_content_generation_output_id = $1
        and channel_output.delivery_format = $2
        and channel_output.channel = $3
      limit 1`,
    [outputId, target.deliveryFormat, target.channel, targetIdempotencyKey],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  const channelOutputId = String(row.channel_output_id);
  const queueMatchesRequest = text(row.idempotency_key) === targetIdempotencyKey;
  const queueIsActiveOrPublished = row.queue_status === "queued"
    || row.queue_status === "scheduled"
    || row.queue_status === "publishing"
    || row.queue_status === "published";
  return {
    channelOutputId,
    queueId: row.queue_id ? String(row.queue_id) : null,
    queueStatus: text(row.queue_status) || null,
    hasAttempt: row.has_attempt === true,
    result: row.queue_id && (queueMatchesRequest || queueIsActiveOrPublished) ? {
      channel: target.channel,
      deliveryFormat: target.deliveryFormat,
      channelOutputId,
      queueId: String(row.queue_id),
      status: normalizeQueueStatus(row.queue_status),
      dispatchAllowed: !requestIdempotencyKey.startsWith("calendar-ai-content:"),
      publishedUrl: text(row.published_url) || null,
      errorCode: text(row.last_error) || null,
    } : null,
  };
}

export function createAiContentPublishRepository(pool: Pool): AiContentPublishRepository {
  async function prepareAiContentPublishInternal(
    input: BrandOutputScope & Partial<AiContentPublishRequest>,
    requireCalendarSlot: boolean,
  ): Promise<PreparedAiContentPublishResult | null> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const outputResult = await client.query(
        `select output.id, output.generation_id, output.status, output.artifact_manifest_json, output.manifest_url,
                generation.output_format, generation.purpose, generation.title, generation.draft_json
           from ai_content_generation_outputs output
           join ai_content_generations generation on generation.id = output.generation_id
          where output.id = $1 and output.workspace_id = $2 and output.brand_id = $3
          for update of output`,
        [input.outputId, input.workspaceId, input.brandId],
      );
      const output = outputResult.rows[0] as OutputRow | undefined;
      if (!output) throw new Error("ai_content_output_not_found");
      if (output.status !== "completed") throw new Error("ai_content_output_not_completed");

      let manifest: AiContentManifestV3;
      try {
        manifest = parseActiveAiContentManifestV3(output.artifact_manifest_json);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (
          output.output_format === "reel"
          && ["ai_content_reel_asset_invalid", "ai_content_reel_video_metadata_invalid"].includes(message)
        ) {
          throw new Error("ai_content_publish_reel_video_invalid");
        }
        throw error;
      }
      if (manifest.outputFormat !== output.output_format || manifest.purpose !== output.purpose) {
        throw new Error("ai_content_publish_manifest_mismatch");
      }
      assertPublishableManifest(manifest);
      const existingContext = await findPublishContext(client, input);
      const calendarSlot = await findActiveCalendarSlot(client, input, output, existingContext);
      if (requireCalendarSlot && !calendarSlot) {
        await client.query("COMMIT");
        return null;
      }
      const derivedCalendarTargets = calendarSlot ? calendarTargets(calendarSlot, manifest) : null;
      if (calendarSlot && input.targets) assertCalendarRequestTargets(input.targets, derivedCalendarTargets!);
      const calendarSlotAlreadyAdvanced = calendarSlot
        ? ["ready", "scheduled", "published"].includes(calendarSlot.status)
        : false;
      if (calendarSlotAlreadyAdvanced && !existingContext) {
        throw new Error("publish_calendar_advanced_slot_link_invalid");
      }
      const requestedTargets = derivedCalendarTargets ?? input.targets ?? [];
      const normalizedTargets = requestedTargets.map((target) => {
        const resolution = resolveAiContentPublishTarget({ outputFormat: manifest.outputFormat, assetCount: manifest.assets.length }, target);
        if (!resolution.supported) throw new Error(resolution.reason);
        return resolution.target;
      });
      const requestIdempotencyKey = calendarSlot
        ? `calendar-ai-content:${calendarSlot.id}:${input.outputId}`
        : String(input.idempotencyKey);
      vercelBlobUrl(output.manifest_url);
      if (calendarSlotAlreadyAdvanced) {
        const targets: AiContentPublishTargetResult[] = [];
        for (const target of normalizedTargets) {
          const existing = await findExistingTarget(client, input.outputId, target, requestIdempotencyKey);
          if (!existing?.result) throw new Error("publish_calendar_advanced_slot_link_invalid");
          targets.push({ ...existing.result, dispatchAllowed: false });
        }
        await client.query("COMMIT");
        return { publishGroupId: existingContext!.publishGroupId, targets };
      }

      const requestedChannels = [...new Set(normalizedTargets.map((target) => target.channel))];
      const channelResult = await client.query(
        `select channel.id, channel.channel
           from brand_channels channel
          where channel.workspace_id = $1 and channel.brand_id = $2
            and channel.channel = any($3::text[])
            and channel.status = 'connected' and channel.enabled = true and channel.deleted_at is null
            and exists (
              select 1 from channel_credentials credential
                where credential.brand_channel_id = channel.id
                  and credential.status = 'active' and credential.revoked_at is null
                  and (credential.expires_at is null or credential.expires_at > now())
             )`,
        [input.workspaceId, input.brandId, requestedChannels],
      );
      const connectedChannels = new Map<Channel, string>(
        channelResult.rows.map((row) => [row.channel as Channel, String(row.id)]),
      );
      if (requestedChannels.some((channel) => !connectedChannels.has(channel))) {
        throw new Error("channel_oauth_not_connected");
      }

      const context = await getOrCreatePublishContext(
        client,
        input,
        manifest,
        existingContext,
        Boolean(calendarSlot) && !calendarSlotAlreadyAdvanced,
      );
      const artifactId = await storeManifestArtifact(client, input, output.manifest_url);
      const copy = outputCopy(manifest);
      const targets: AiContentPublishTargetResult[] = [];

      for (const target of normalizedTargets) {
        const existing = await findExistingTarget(client, input.outputId, target, requestIdempotencyKey);
        if (calendarSlot && existing?.queueId && existing.queueStatus === "scheduled") {
          if (existing.hasAttempt) throw new Error("publish_calendar_queue_already_attempted");
          const converted = await client.query(
            `update publish_queue
                set status='queued',approval_type=$2,scheduled_for=null,
                    idempotency_key=$3,last_error=null,updated_at=now()
              where id=$1 and status='scheduled'
                and not exists(select 1 from publish_attempts attempt where attempt.publish_queue_id=publish_queue.id)
              returning id,status`,
            [
              existing.queueId,
              calendarSlot.assignment_mode === "automatic" ? "auto" : "manual",
              `ai-content:${input.outputId}:${target.channel}:${target.deliveryFormat}:${requestIdempotencyKey}`,
            ],
          );
          if (!converted.rowCount) throw new Error("publish_calendar_queue_already_attempted");
          targets.push({
            channel: target.channel,
            deliveryFormat: target.deliveryFormat,
            channelOutputId: existing.channelOutputId,
            queueId: existing.queueId,
            status: "queued",
            dispatchAllowed: false,
            publishedUrl: null,
            errorCode: null,
          });
          continue;
        }
        if (calendarSlot && existing?.queueId && existing.queueStatus !== "queued") {
          throw new Error("publish_calendar_queue_already_attempted");
        }
        if (existing?.result) {
          targets.push(existing.result);
          continue;
        }
        const assets = manifest.outputFormat === "card_news" ? manifestAssets(manifest, target) : [];
        const video = manifest.outputFormat === "reel" ? manifestVideo(manifest) : undefined;
        const outputJson = {
          ...copy.output,
          deliveryFormat: target.deliveryFormat,
          promptVersion: "ai-content.v3",
          generationState: "completed",
          artifactStatus: "ready",
          cards: assets,
          story: target.deliveryFormat === "instagram_story" ? assets[0] : undefined,
          video,
          publishRequestIdempotencyKey: requestIdempotencyKey,
        };
        const channelOutput = existing ? null : await client.query(
          `insert into channel_outputs (
             workspace_id, brand_id, content_topic_id, master_draft_id, channel, delivery_format, status,
             title, preview_title, preview_body, output_json, rendered_artifact_id, source_summary,
             block_reasons, ai_content_generation_output_id, approved_at
           ) values ($1, $2, $3, $4, $5, $6, 'approved', $7, $7, $8, $9::jsonb, $10,
             'AI 콘텐츠 스튜디오 생성 결과', '[]'::jsonb, $11, now())
           returning id`,
          [
            input.workspaceId,
            input.brandId,
            context.topicId,
            context.masterDraftId,
            target.channel,
            target.deliveryFormat,
            manifest.title,
            copy.previewBody,
            JSON.stringify(outputJson),
            artifactId,
            input.outputId,
          ],
        );
        const channelOutputId = existing?.channelOutputId ?? String(channelOutput?.rows[0].id);
        const queueIdempotencyKey = `ai-content:${input.outputId}:${target.channel}:${target.deliveryFormat}:${requestIdempotencyKey}`;
        const queue = !calendarSlot && existing?.queueId && (existing.queueStatus === "failed" || existing.queueStatus === "cancelled")
          ? await client.query(
            `update publish_queue
                set status = 'scheduled', scheduled_for = now(), queued_at = now(),
                    publishing_started_at = null, published_at = null, failed_at = null,
                    deferred_until = null, idempotency_key = $2, last_error = null, updated_at = now()
              where id = $1 and status in ('failed', 'cancelled')
              returning id, status`,
            [existing.queueId, queueIdempotencyKey],
          )
          : await client.query(
            `insert into publish_queue (
               workspace_id, brand_id, channel_output_id, brand_channel_id, channel,
               topic_publish_group_id, status, approval_type, scheduled_for, idempotency_key
             ) values ($1, $2, $3, $4, $5, $6, $7, $8, case when $7='queued' then null else now() end, $9)
             returning id, status`,
            [
              input.workspaceId,
              input.brandId,
              channelOutputId,
              connectedChannels.get(target.channel),
              target.channel,
              context.publishGroupId,
              calendarSlot ? "queued" : "scheduled",
              calendarSlot?.assignment_mode === "automatic" ? "auto" : "manual",
              queueIdempotencyKey,
            ],
          );
        if (!queue.rowCount) throw new Error("publish_queue_retry_conflict");
        targets.push({
          channel: target.channel,
          deliveryFormat: target.deliveryFormat,
          channelOutputId,
          queueId: String(queue.rows[0].id),
          status: normalizeQueueStatus(queue.rows[0].status),
          dispatchAllowed: !calendarSlot,
          publishedUrl: null,
          errorCode: null,
        });
      }

      if (calendarSlot && !calendarSlotAlreadyAdvanced) {
        const linked = await client.query(
          `update publish_calendar_slots
              set generation_id=$2,generation_output_id=$3,topic_publish_group_id=$4,
                  status='content_assigned',last_error=null,updated_at=now()
            where id=$1 and workspace_id=$5 and brand_id=$6 and status<>'cancelled'
            returning id`,
          [calendarSlot.id, output.generation_id, input.outputId, context.publishGroupId, input.workspaceId, input.brandId],
        );
        if (!linked.rowCount) throw new Error("publish_calendar_slot_conflict");
      }

      await client.query("COMMIT");
      return { publishGroupId: context.publishGroupId, targets };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function prepareAiContentPublish(
    input: BrandOutputScope & AiContentPublishRequest,
  ): Promise<PreparedAiContentPublishResult> {
    const result = await prepareAiContentPublishInternal(input, false);
    if (!result) throw new Error("ai_content_publish_calendar_slot_required");
    return result;
  }

  async function getAiContentPublishQueueResult(input: QueueScope): Promise<AiContentPublishTargetResult> {
    const result = await pool.query(
      `select pq.id as queue_id, pq.channel, pq.channel_output_id, channel_output.delivery_format, pq.status, pq.last_error,
              latest_attempt.external_url as published_url
         from publish_queue pq
         join channel_outputs channel_output on channel_output.id = pq.channel_output_id
         left join lateral (
           select attempt.external_url
             from publish_attempts attempt
            where attempt.publish_queue_id = pq.id and attempt.status = 'succeeded'
            order by attempt.finished_at desc nulls last, attempt.created_at desc
            limit 1
         ) latest_attempt on true
        where pq.id = $1 and pq.workspace_id = $2 and pq.brand_id = $3`,
      [input.queueId, input.workspaceId, input.brandId],
    );
    if (!result.rowCount) throw new Error("publish_queue_not_found");
    const row = result.rows[0];
    const status = normalizeQueueStatus(row.status);
    const errorCode = text(row.last_error) || null;
    return {
      channel: row.channel as Channel,
      deliveryFormat: row.delivery_format as AiContentPublishDeliveryFormat,
      channelOutputId: String(row.channel_output_id),
      queueId: String(row.queue_id),
      status,
      dispatchAllowed: false,
      publishedUrl: text(row.published_url) || null,
      errorCode,
      recovery: publishRecovery(status, errorCode),
    };
  }

  return {
    prepareAiContentPublish,
    getAiContentPublishQueueResult,
    async prepareCompletedCalendarPublish(input) {
      if (input.preparationEnabled === false) {
        await recordCalendarPreparationDelay(pool, input, new Error("publishing_disabled")).catch(() => undefined);
        return null;
      }
      try {
        return await prepareAiContentPublishInternal(input, true);
      } catch (error) {
        await recordCalendarPreparationDelay(pool, input, error).catch(() => undefined);
        return null;
      }
    },
  };
}
