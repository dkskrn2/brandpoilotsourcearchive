import type { Pool, PoolClient } from "pg";
import type { AiContentManifest, AiContentType, CardNewsContent, MarketingContent } from "./aiContentContracts.js";
import { buildImageRenderJobPayload } from "./imageRenderJobs.js";
import { deliveryFormatToRenderJobType } from "./instagramFormats.js";
import { parseAiContentManifest } from "./aiContentManifest.js";
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
  status: "rendering" | "scheduled" | "publishing" | "published" | "failed";
  publishedUrl: string | null;
  errorCode: string | null;
}

export interface PreparedAiContentPublishResult {
  publishGroupId: string;
  targets: AiContentPublishTargetResult[];
}

export interface AiContentPublishRepository {
  prepareAiContentPublish(input: BrandOutputScope & AiContentPublishRequest): Promise<PreparedAiContentPublishResult>;
  getAiContentPublishQueueResult(input: QueueScope): Promise<AiContentPublishTargetResult>;
  sendAiContentToPublish(input: BrandOutputScope): Promise<{ publishGroupId: string; channelOutputId: string }>;
}

interface OutputRow {
  id: string;
  status: string;
  artifact_manifest_json: unknown;
  manifest_url: unknown;
  type: AiContentType;
  title: string;
  draft_json: unknown;
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
  if (value === "publishing" || value === "published" || value === "failed") return value;
  return "scheduled";
}

function outputCopy(manifest: AiContentManifest) {
  if (manifest.type === "card_news") {
    const content = manifest.content as CardNewsContent;
    return {
      angle: text(content.caption) || manifest.title,
      previewBody: `카드뉴스 ${manifest.assets.length}장`,
      draft: { title: manifest.title, caption: content.caption, hashtags: content.hashtags, cta: content.cta },
      output: { caption: content.caption, hashtags: content.hashtags, cta: content.cta },
    };
  }
  if (manifest.type === "marketing") {
    const content = manifest.content as MarketingContent;
    return {
      angle: text(content.body) || content.headline,
      previewBody: content.body,
      draft: { title: manifest.title, headline: content.headline, body: content.body, cta: content.cta, concept: content.concept },
      output: {
        caption: [content.headline, content.body, content.cta].filter(Boolean).join("\n\n"),
        hashtags: [],
        cta: content.cta,
        headline: content.headline,
        body: content.body,
        concept: content.concept,
      },
    };
  }
  throw new Error("ai_content_publish_type_not_supported");
}

function legacyAssets(manifest: AiContentManifest, target: AiContentPublishTarget) {
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
    width: asset.width,
    height: asset.height,
  }));
}

async function getOrCreatePublishContext(
  client: PoolClient,
  input: BrandOutputScope,
  manifest: AiContentManifest,
): Promise<PublishContext> {
  const existing = await client.query(
    `select topic.id as content_topic_id, master.id as master_draft_id, topic_group.id as publish_group_id
       from content_topics topic
       join master_drafts master on master.content_topic_id = topic.id
       join topic_publish_groups topic_group on topic_group.content_topic_id = topic.id
      where topic.workspace_id = $1 and topic.brand_id = $2
        and topic.source_context ->> 'aiContentOutputId' = $3
      limit 1
      for update of topic`,
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

  const copy = outputCopy(manifest);
  const topic = await client.query(
    `insert into content_topics (workspace_id, brand_id, title, angle, status, source_context, generated_at)
     values ($1, $2, $3, $4, 'generated', $5::jsonb, now()) returning id`,
    [input.workspaceId, input.brandId, manifest.title, copy.angle, JSON.stringify({ source: "ai_content_studio", aiContentOutputId: input.outputId })],
  );
  const topicId = String(topic.rows[0].id);
  const master = await client.query(
    `insert into master_drafts (workspace_id, brand_id, content_topic_id, status, prompt_version, draft_json, source_snapshot_refs)
     values ($1, $2, $3, 'generated', 'ai-content.v1', $4::jsonb, '[]'::jsonb) returning id`,
    [input.workspaceId, input.brandId, topicId, JSON.stringify(copy.draft)],
  );
  const group = await client.query(
    `insert into topic_publish_groups (workspace_id, brand_id, content_topic_id, status, scheduled_for)
     values ($1, $2, $3, 'scheduled', now()) returning id`,
    [input.workspaceId, input.brandId, topicId],
  );
  return {
    topicId,
    masterDraftId: String(master.rows[0].id),
    publishGroupId: String(group.rows[0].id),
  };
}

async function storeManifestArtifact(client: PoolClient, input: BrandOutputScope, manifestUrlValue: unknown) {
  const manifestUrl = vercelBlobUrl(manifestUrlValue);
  const artifactPath = decodeURIComponent(manifestUrl.pathname).replace(/^\/+/, "");
  const artifact = await client.query(
    `insert into storage_artifacts (workspace_id, brand_id, artifact_type, bucket, path, public_url, mime_type, byte_size)
     values ($1, $2, 'generated_manifest', 'vercel-blob', $3, $4, 'application/json', 0)
     on conflict (bucket, path) do update set public_url = excluded.public_url
     returning id`,
    [input.workspaceId, input.brandId, artifactPath, String(manifestUrlValue)],
  );
  return String(artifact.rows[0].id);
}

async function enqueueReelRenderJob(
  client: PoolClient,
  input: BrandOutputScope,
  context: PublishContext,
  channelOutputId: string,
  manifest: AiContentManifest,
) {
  const brandResult = await client.query(
    `select brand.name as brand_name, profile.industry, profile.primary_customer,
            profile.description, profile.tone, profile.brand_color
       from brands brand
       join brand_profiles profile on profile.brand_id = brand.id
      where brand.id = $1 and brand.workspace_id = $2 and brand.deleted_at is null`,
    [input.brandId, input.workspaceId],
  );
  if (!brandResult.rowCount) throw new Error("brand_profile_not_found");
  const brand = brandResult.rows[0];
  const copy = outputCopy(manifest);
  const jobId = crypto.randomUUID();
  const payload = {
    ...buildImageRenderJobPayload({
      deliveryFormat: "instagram_reel",
      topic: {
        title: manifest.title,
        angle: copy.angle,
        targetCustomer: text(brand.primary_customer) || null,
        region: null,
        season: null,
        notes: "AI 콘텐츠 스튜디오 결과의 핵심 메시지를 유지해 릴스용 세로형 영상으로 변환합니다.",
      },
      brand: {
        name: text(brand.brand_name),
        categoryContext: text(brand.industry) || null,
        primaryCustomer: text(brand.primary_customer) || null,
        description: text(brand.description) || null,
        tone: text(brand.tone) || null,
        brandColor: text(brand.brand_color) || null,
      },
    }),
    contentTopicId: context.topicId,
    storagePrefix: `brands/${input.brandId}/topics/${context.topicId}/instagram_reel/${jobId}`,
  };
  await client.query(
    `insert into jobs (id, workspace_id, brand_id, channel_output_id, job_type, status, payload_json)
     values ($1, $2, $3, $4, $5, 'queued', $6::jsonb)
     on conflict (channel_output_id)
       where job_type in ('instagram_feed_render', 'instagram_story_render', 'instagram_reel_render')
         and status in ('queued', 'running')
       do nothing`,
    [
      jobId,
      input.workspaceId,
      input.brandId,
      channelOutputId,
      deliveryFormatToRenderJobType("instagram_reel"),
      JSON.stringify(payload),
    ],
  );
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
  result: AiContentPublishTargetResult | null;
} | null> {
  const targetIdempotencyKey = `ai-content:${outputId}:${target.channel}:${target.deliveryFormat}:${requestIdempotencyKey}`;
  const result = await client.query(
    `select channel_output.id as channel_output_id, pq.id as queue_id, pq.status as queue_status,
            pq.idempotency_key, pq.last_error, latest_attempt.external_url as published_url
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
  const queueIsActiveOrPublished = row.queue_status === "scheduled"
    || row.queue_status === "publishing"
    || row.queue_status === "published";
  return {
    channelOutputId,
    queueId: row.queue_id ? String(row.queue_id) : null,
    queueStatus: text(row.queue_status) || null,
    result: row.queue_id && (queueMatchesRequest || queueIsActiveOrPublished) ? {
      channel: target.channel,
      deliveryFormat: target.deliveryFormat,
      channelOutputId,
      queueId: String(row.queue_id),
      status: normalizeQueueStatus(row.queue_status),
      publishedUrl: text(row.published_url) || null,
      errorCode: text(row.last_error) || null,
    } : null,
  };
}

export function createAiContentPublishRepository(pool: Pool): AiContentPublishRepository {
  async function prepareAiContentPublish(
    input: BrandOutputScope & AiContentPublishRequest,
  ): Promise<PreparedAiContentPublishResult> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const outputResult = await client.query(
        `select output.id, output.status, output.artifact_manifest_json, output.manifest_url,
                generation.type, generation.title, generation.draft_json
           from ai_content_generation_outputs output
           join ai_content_generations generation on generation.id = output.generation_id
          where output.id = $1 and output.workspace_id = $2 and output.brand_id = $3
          for update of output`,
        [input.outputId, input.workspaceId, input.brandId],
      );
      const output = outputResult.rows[0] as OutputRow | undefined;
      if (!output) throw new Error("ai_content_output_not_found");
      if (output.status !== "completed") throw new Error("ai_content_output_not_completed");

      const manifest = parseAiContentManifest(output.type, output.artifact_manifest_json);
      const normalizedTargets = input.targets.map((target) => {
        const resolution = resolveAiContentPublishTarget({ type: output.type, assetCount: manifest.assets.length }, target);
        if (!resolution.supported) throw new Error(resolution.reason);
        return resolution.target;
      });
      vercelBlobUrl(output.manifest_url);

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

      const context = await getOrCreatePublishContext(client, input, manifest);
      const artifactId = await storeManifestArtifact(client, input, output.manifest_url);
      const copy = outputCopy(manifest);
      const targets: AiContentPublishTargetResult[] = [];

      for (const target of normalizedTargets) {
        const existing = await findExistingTarget(client, input.outputId, target, input.idempotencyKey);
        if (existing?.result) {
          targets.push(existing.result);
          continue;
        }
        if (target.deliveryFormat === "instagram_reel" && existing) {
          targets.push({
            channel: target.channel,
            deliveryFormat: target.deliveryFormat,
            channelOutputId: existing.channelOutputId,
            queueId: null,
            status: "rendering",
            publishedUrl: null,
            errorCode: null,
          });
          continue;
        }
        const assets = legacyAssets(manifest, target);
        const outputJson = {
          ...copy.output,
          deliveryFormat: target.deliveryFormat,
          promptVersion: "ai-content.v1",
          generationState: "completed",
          artifactStatus: "ready",
          cards: assets,
          story: target.deliveryFormat === "instagram_story" ? assets[0] : undefined,
          publishRequestIdempotencyKey: input.idempotencyKey,
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
        if (target.deliveryFormat === "instagram_reel") {
          await enqueueReelRenderJob(client, input, context, channelOutputId, manifest);
          targets.push({
            channel: target.channel,
            deliveryFormat: target.deliveryFormat,
            channelOutputId,
            queueId: null,
            status: "rendering",
            publishedUrl: null,
            errorCode: null,
          });
          continue;
        }
        const queueIdempotencyKey = `ai-content:${input.outputId}:${target.channel}:${target.deliveryFormat}:${input.idempotencyKey}`;
        const queue = existing?.queueId && (existing.queueStatus === "failed" || existing.queueStatus === "cancelled")
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
             ) values ($1, $2, $3, $4, $5, $6, 'scheduled', 'manual', now(), $7)
             returning id, status`,
            [
              input.workspaceId,
              input.brandId,
              channelOutputId,
              connectedChannels.get(target.channel),
              target.channel,
              context.publishGroupId,
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
          publishedUrl: null,
          errorCode: null,
        });
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
    return {
      channel: row.channel as Channel,
      deliveryFormat: row.delivery_format as AiContentPublishDeliveryFormat,
      channelOutputId: String(row.channel_output_id),
      queueId: String(row.queue_id),
      status: normalizeQueueStatus(row.status),
      publishedUrl: text(row.published_url) || null,
      errorCode: text(row.last_error) || null,
    };
  }

  return {
    prepareAiContentPublish,
    getAiContentPublishQueueResult,
    async sendAiContentToPublish(input) {
      const output = await pool.query(
        `select generation.type, jsonb_array_length(output.artifact_manifest_json -> 'assets') as asset_count
           from ai_content_generation_outputs output
           join ai_content_generations generation on generation.id = output.generation_id
          where output.id = $1 and output.workspace_id = $2 and output.brand_id = $3`,
        [input.outputId, input.workspaceId, input.brandId],
      );
      if (!output.rowCount) throw new Error("ai_content_output_not_found");
      const deliveryFormat: AiContentPublishDeliveryFormat = Number(output.rows[0].asset_count) > 1
        ? "instagram_feed_carousel"
        : "instagram_feed_single";
      const prepared = await prepareAiContentPublish({
        ...input,
        idempotencyKey: crypto.randomUUID(),
        targets: [{ channel: "instagram", deliveryFormat }],
      });
      return {
        publishGroupId: prepared.publishGroupId,
        channelOutputId: prepared.targets[0].channelOutputId,
      };
    },
  };
}
