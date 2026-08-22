import type { Pool } from "pg";

import { aggregatePublishState } from "./publishItemState.js";
import type { Channel, PublishItemDto, PublishItemReviewTargetDto, PublishItemTargetDto } from "./types.js";

type BrandScope = { workspaceId: string; brandId: string };
type Queryable = Pick<Pool, "query">;

export interface PublishItemsRepository {
  listPublishItems(input: BrandScope): Promise<PublishItemDto[]>;
}

const ACTIVE_SLOT_STATUSES = new Set([
  "proposal_assigned", "generation_pending", "content_assigned", "ready",
  "scheduled", "publish_delayed", "quota_blocked",
]);
const ACTIVE_GROUP_STATUSES = new Set(["ready", "scheduled", "partially_published"]);
const CHANNELS = new Set<Channel>(["instagram", "threads", "x", "linkedin", "youtube", "tiktok"]);

/*
 * This is intentionally one tenant-scoped read boundary. Each source CTE and
 * relationship repeats workspace + brand predicates so UUID equality can never
 * cross a tenant boundary.
 */
export const PUBLISH_ITEMS_SQL = `
with scoped_topics as (
  select topic.*,row.topic_title,row.topic_angle,row.reference_url
    from content_topics topic
    left join topic_rows row
      on row.id=topic.topic_row_id
     and row.workspace_id=topic.workspace_id and row.brand_id=topic.brand_id
   where topic.workspace_id=$1::uuid and topic.brand_id=$2::uuid
), topic_source_urls as (
  select topic.id as content_topic_id,
         coalesce(array_agg(distinct coalesce(item.content_url,source.url)
           order by coalesce(item.content_url,source.url)) filter (
             where (snapshot.source_content_item_id is null or item.id is not null)
               and coalesce(item.content_url,source.url) is not null
           ),array[]::text[]) as source_urls
    from scoped_topics topic
    left join lateral jsonb_array_elements_text(
      case when jsonb_typeof(topic.source_context->'sourceSnapshotId')='string'
           then jsonb_build_array(topic.source_context->>'sourceSnapshotId')
           when jsonb_typeof(topic.source_context->'sourceSnapshotIds')='array'
           then topic.source_context->'sourceSnapshotIds'
           else '[]'::jsonb end
    ) snapshot_ref(id) on true
    left join source_snapshots snapshot
      on snapshot.id=case
           when snapshot_ref.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           then snapshot_ref.id::uuid else null::uuid end
     and snapshot.workspace_id=topic.workspace_id and snapshot.brand_id=topic.brand_id
    left join source_urls source
      on source.id=snapshot.source_url_id
     and source.workspace_id=topic.workspace_id and source.brand_id=topic.brand_id
    left join source_content_items item
      on item.id=snapshot.source_content_item_id
     and item.workspace_id=topic.workspace_id and item.brand_id=topic.brand_id and item.deleted_at is null
   group by topic.id
), scoped_generations as (
  select generation.*
    from ai_content_generations generation
   where generation.workspace_id=$1::uuid and generation.brand_id=$2::uuid
), scoped_outputs as (
  select output.*
    from ai_content_generation_outputs output
   where output.workspace_id=$1::uuid and output.brand_id=$2::uuid
), scoped_groups as (
  select publish_group.*
    from topic_publish_groups publish_group
   where publish_group.workspace_id=$1::uuid and publish_group.brand_id=$2::uuid
), scoped_slots as (
  select slot.*
    from publish_calendar_slots slot
   where slot.workspace_id=$1::uuid and slot.brand_id=$2::uuid
), scoped_channel_outputs as (
  select output.*
    from channel_outputs output
   where output.workspace_id=$1::uuid and output.brand_id=$2::uuid
), scoped_queues as (
  select queue.*
    from publish_queue queue
   where queue.workspace_id=$1::uuid and queue.brand_id=$2::uuid
), review_rows as (
  select coalesce(
           case when output.ai_content_generation_output_id is not null
                then 'output:' || output.ai_content_generation_output_id::text end,
           case when nullif(topic.source_context->>'aiContentOutputId','') is not null
                then 'output:' || (topic.source_context->>'aiContentOutputId') end,
           case when output.content_topic_id is not null then 'topic:' || output.content_topic_id::text end,
           case when output.master_draft_id is not null then 'draft:' || output.master_draft_id::text end,
           'channel-output:' || output.id::text
         ) as item_key,
         output.id as review_channel_output_id,output.channel as review_channel,
         output.delivery_format as review_delivery_format,output.status as review_status,
         output.preview_title as review_preview_title,output.preview_body as review_preview_body,
         output.output_json as review_output_json,output.source_summary as review_source_summary,
         output.block_reasons as review_block_reasons,output.generated_at as review_generated_at,
         output.workspace_id,output.brand_id,output.content_topic_id,output.master_draft_id,
         output.ai_content_generation_output_id,output.title
    from scoped_channel_outputs output
    left join scoped_topics topic
      on topic.id=output.content_topic_id
     and topic.workspace_id=output.workspace_id and topic.brand_id=output.brand_id
   where output.status<>'regenerated'
), source_units as (
  select 'topic:' || topic.id::text as item_key,
         topic.workspace_id,topic.brand_id,topic.title,topic.created_at,
         case
           when topic.selected_instagram_format='instagram_reel' then 'reel'
           when topic.selected_instagram_format in ('instagram_feed_carousel','instagram_feed_single') then 'card_news'
         end as content_format,
         case
           when topic.status='selected' then 'pre_generation'
           when topic.status='generating' then 'generating'
           when topic.status='generated' then 'completed'
           else 'failed'
         end as content_status,
         topic.id as content_topic_id,null::uuid as proposal_id,
         null::uuid as generation_id,null::uuid as generation_output_id,
         topic.source_context,
         case when topic.topic_title is not null
                    and (topic.reference_url is not null or cardinality(source_refs.source_urls)>0) then 'mixed'
              when topic.topic_title is not null then 'topic_table'
              when topic.reference_url is not null or cardinality(source_refs.source_urls)>0 then 'source_url'
              else 'unknown' end as source_type,
         coalesce(topic.topic_title,topic.reference_url,
                  case when cardinality(source_refs.source_urls)>0 then '크롤링 근거' end,
                  topic.title,'근거 없음') as source_label,
         nullif(concat_ws(' | ',nullif(topic.topic_angle,''),nullif(topic.reference_url,''),nullif(topic.angle,'')),'') as source_detail,
         array_cat(case when topic.reference_url is null then array[]::text[] else array[topic.reference_url]::text[] end,
                   source_refs.source_urls) as source_urls,
         topic.status in ('selected','generating','generated') as base_schedulable
    from scoped_topics topic
    join topic_source_urls source_refs on source_refs.content_topic_id=topic.id
   where nullif(topic.source_context->>'aiContentOutputId','') is null
  union all
  select 'generation:' || generation.id::text,generation.workspace_id,generation.brand_id,
         generation.title,generation.created_at,
         case when generation.output_format in ('card_news','reel') then generation.output_format end,
         case when generation.status in ('completed') then 'completed'
              when generation.status in ('failed','partial_failed') then 'failed'
              when generation.status in ('draft','analyzing','analysis_ready','queued','planning','generating') then 'generating'
              else 'pre_generation' end,
         null::uuid,null::uuid,generation.id,null::uuid,generation.draft_json,
         'unknown','근거 없음',null::text,array[]::text[],
         generation.status in ('draft','analyzing','analysis_ready','queued','planning','generating','completed')
    from scoped_generations generation
   where not exists (
     select 1 from scoped_outputs output
      where output.generation_id=generation.id
        and output.workspace_id=generation.workspace_id and output.brand_id=generation.brand_id
        and output.status='completed'
   )
  union all
  select 'output:' || output.id::text,output.workspace_id,output.brand_id,
         coalesce(nullif(output.title,''),generation.title),output.created_at,
         case when generation.output_format in ('card_news','reel') then generation.output_format end,
         case when output.status='completed' then 'completed' else 'failed' end,
         null::uuid,null::uuid,generation.id,output.id,generation.draft_json,
         'unknown','근거 없음',null::text,array[]::text[],output.status='completed'
    from scoped_outputs output
    join scoped_generations generation
      on generation.id=output.generation_id
     and generation.workspace_id=output.workspace_id and generation.brand_id=output.brand_id
   where output.status='completed'
), queue_rows as (
  select coalesce(
           case when output.ai_content_generation_output_id is not null
                then 'output:' || output.ai_content_generation_output_id::text end,
           case when nullif(topic.source_context->>'aiContentOutputId','') is not null
                then 'output:' || (topic.source_context->>'aiContentOutputId') end,
           case when output.content_topic_id is not null then 'topic:' || output.content_topic_id::text end,
           case when queue.topic_publish_group_id is not null then 'group:' || queue.topic_publish_group_id::text end,
           case when output.master_draft_id is not null then 'draft:' || output.master_draft_id::text end,
           'channel-output:' || output.id::text,
           'queue:' || queue.id::text
         ) as item_key,
         queue.id as queue_id,output.id as channel_output_id,queue.channel,queue.status,
         queue.scheduled_for,case when queue.status='deferred' then queue.deferred_until else queue.scheduled_for end as effective_scheduled_for,
         queue.published_at,queue.failed_at,queue.last_error,attempt.external_post_id,attempt.external_url,
         output.preview_title,output.preview_body,output.output_json,artifact.public_url as artifact_public_url,
         output.source_summary,topic.reference_url as queue_reference_url,topic_sources.source_urls as queue_source_urls,
         queue.topic_publish_group_id,output.content_topic_id,output.ai_content_generation_output_id,
         output.title,output.created_at,output.delivery_format
    from scoped_queues queue
    join scoped_channel_outputs output
      on output.id=queue.channel_output_id
     and output.workspace_id=queue.workspace_id and output.brand_id=queue.brand_id
    left join scoped_topics topic
      on topic.id=output.content_topic_id
     and topic.workspace_id=output.workspace_id and topic.brand_id=output.brand_id
    left join topic_source_urls topic_sources on topic_sources.content_topic_id=topic.id
    left join storage_artifacts artifact
      on artifact.id=output.rendered_artifact_id
     and artifact.workspace_id=output.workspace_id and artifact.brand_id=output.brand_id
    left join lateral (
      select publish_attempt.external_post_id,publish_attempt.external_url
        from publish_attempts publish_attempt
       where publish_attempt.publish_queue_id=queue.id
         and publish_attempt.workspace_id=queue.workspace_id and publish_attempt.brand_id=queue.brand_id
       order by publish_attempt.finished_at desc nulls last,publish_attempt.created_at desc,publish_attempt.id desc
       limit 1
    ) attempt on true
), slot_rows as (
  select coalesce(
           case when slot.generation_output_id is not null then 'output:' || slot.generation_output_id::text end,
           case when inferred_output.id is not null then 'output:' || inferred_output.id::text end,
           case when slot.generation_id is not null then 'generation:' || slot.generation_id::text end,
           case when nullif(topic.source_context->>'aiContentOutputId','') is not null
                then 'output:' || (topic.source_context->>'aiContentOutputId') end,
           case when publish_group.content_topic_id is not null then 'topic:' || publish_group.content_topic_id::text end,
           case when slot.topic_publish_group_id is not null then 'group:' || slot.topic_publish_group_id::text end,
           case when slot.proposal_id is not null then 'proposal:' || slot.proposal_id::text end,
           case when slot.content_suggestion_id is not null then 'suggestion:' || slot.content_suggestion_id::text end,
           'slot:' || slot.id::text
         ) as item_key,
         slot.id as calendar_slot_id,slot.scheduled_for,slot.assignment_mode,slot.status as slot_status,
         slot.content_format,slot.channels,slot.title,slot.last_error,slot.created_at,slot.content_suggestion_id,
         slot.proposal_id,slot.generation_id,coalesce(slot.generation_output_id,inferred_output.id) as generation_output_id,
         slot.topic_publish_group_id,
         publish_group.status as group_status,publish_group.content_topic_id
    from scoped_slots slot
    left join lateral (
      select output.id
        from scoped_outputs output
       where slot.generation_output_id is null and output.generation_id=slot.generation_id
         and output.workspace_id=slot.workspace_id and output.brand_id=slot.brand_id
         and output.status='completed'
       order by output.output_index,output.created_at,output.id
       limit 1
    ) inferred_output on true
    left join scoped_groups publish_group
      on publish_group.id=slot.topic_publish_group_id
     and publish_group.workspace_id=slot.workspace_id and publish_group.brand_id=slot.brand_id
    left join scoped_topics topic
      on topic.id=publish_group.content_topic_id
     and topic.workspace_id=publish_group.workspace_id and topic.brand_id=publish_group.brand_id
), selected_slot_rows as (
  select distinct on (slot.item_key) slot.*
    from slot_rows slot
   order by slot.item_key,(slot.slot_status<>'cancelled') desc,slot.scheduled_for desc,slot.calendar_slot_id desc
), group_rows as (
  select distinct on (item_key) item_key,group_id,group_status,content_topic_id
    from (
      select coalesce(
               case when nullif(topic.source_context->>'aiContentOutputId','') is not null
                    then 'output:' || (topic.source_context->>'aiContentOutputId') end,
               'topic:' || publish_group.content_topic_id::text,
               'group:' || publish_group.id::text
             ) as item_key,
             publish_group.id as group_id,publish_group.status as group_status,
             publish_group.content_topic_id,publish_group.created_at
        from scoped_groups publish_group
        left join scoped_topics topic
          on topic.id=publish_group.content_topic_id
         and topic.workspace_id=publish_group.workspace_id and topic.brand_id=publish_group.brand_id
    ) grouped
   order by item_key,created_at desc,group_id desc
), orphan_units as (
  select queue.item_key,$1::uuid,$2::uuid,queue.title,queue.created_at,
         queue.content_format,'completed',queue.content_topic_id,null::uuid,null::uuid,
         queue.ai_content_generation_output_id,'{}'::jsonb,'unknown','근거 없음',
         null::text,array[]::text[],false
    from (
      select distinct on (candidate.item_key) candidate.*,
             case when candidate.delivery_format='instagram_reel' then 'reel'
                  when candidate.delivery_format in ('instagram_feed_carousel','instagram_feed_single') then 'card_news' end as content_format
        from queue_rows candidate
       where not exists (select 1 from source_units source where source.item_key=candidate.item_key)
       order by candidate.item_key,candidate.created_at,candidate.queue_id
    ) queue
  union all
  select slot.item_key,$1::uuid,$2::uuid,coalesce(slot.title,'예약 콘텐츠'),slot.created_at,
         slot.content_format,'pre_generation',slot.content_topic_id,slot.proposal_id,
         slot.generation_id,slot.generation_output_id,'{}'::jsonb,
         'unknown','근거 없음',null::text,array[]::text[],false
    from (
      select distinct on (candidate.item_key) candidate.*
        from slot_rows candidate
       where not exists (select 1 from source_units source where source.item_key=candidate.item_key)
         and not exists (select 1 from queue_rows queue where queue.item_key=candidate.item_key)
         and not (candidate.content_suggestion_id is null and candidate.proposal_id is null
           and candidate.generation_id is null and candidate.generation_output_id is null
           and candidate.topic_publish_group_id is null)
       order by candidate.item_key,candidate.created_at,candidate.calendar_slot_id
    ) slot
  union all
  select review.item_key,review.workspace_id,review.brand_id,review.title,review.review_generated_at,
         case when review.review_delivery_format='instagram_reel' then 'reel'
              when review.review_delivery_format in ('instagram_feed_carousel','instagram_feed_single') then 'card_news' end,
         case when review.review_status in ('generating','regenerating') then 'generating'
              when review.review_status='generation_failed' then 'failed' else 'completed' end,
         review.content_topic_id,null::uuid,null::uuid,review.ai_content_generation_output_id,
         '{}'::jsonb,'unknown',coalesce(review.review_source_summary,'근거 없음'),review.review_source_summary,
         array[]::text[],false
    from (
      select distinct on (candidate.item_key) candidate.*
        from review_rows candidate
       where not exists (select 1 from source_units source where source.item_key=candidate.item_key)
         and not exists (select 1 from queue_rows queue where queue.item_key=candidate.item_key)
         and not exists (select 1 from slot_rows slot where slot.item_key=candidate.item_key)
       order by candidate.item_key,candidate.review_generated_at,candidate.review_channel_output_id
    ) review
), units as (
  select * from source_units
  union all
  select * from orphan_units
)
select unit.*,
       slot.calendar_slot_id,slot.scheduled_for as slot_scheduled_for,slot.assignment_mode,
       slot.slot_status,coalesce(slot.group_status,publish_group.group_status) as group_status,
       slot.topic_publish_group_id as slot_group_id,publish_group.group_id as source_group_id,
       publish_group.content_topic_id as group_content_topic_id,
       slot.channels as slot_channels,slot.content_format as slot_content_format,slot.last_error as slot_last_error,
       slot.proposal_id as slot_proposal_id,
       queue.queue_id,queue.channel_output_id,queue.channel,queue.status as queue_status,
       queue.scheduled_for as queue_scheduled_for,queue.effective_scheduled_for,
       queue.published_at,queue.failed_at,queue.last_error,queue.external_post_id,queue.external_url,queue.preview_title,queue.preview_body,
       queue.output_json,queue.artifact_public_url,queue.source_summary as queue_source_summary,queue.queue_reference_url,queue.queue_source_urls,
       queue.topic_publish_group_id as queue_group_id,
       queue.content_topic_id as queue_content_topic_id,
       review.review_channel_output_id,review.review_channel,review.review_delivery_format,review.review_status,
       review.review_preview_title,review.review_preview_body,review.review_output_json,
       review.review_source_summary,review.review_block_reasons,review.review_generated_at
  from units unit
  left join selected_slot_rows slot on slot.item_key=unit.item_key
  left join group_rows publish_group on publish_group.item_key=unit.item_key
  left join queue_rows queue on queue.item_key=unit.item_key
  left join review_rows review on review.item_key=unit.item_key
 order by unit.created_at desc,unit.item_key,queue.queue_id
`;

function iso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return new Date(value as string | number | Date).toISOString();
}

function record(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return {};
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0))];
}

function channel(value: unknown): Channel | null {
  return CHANNELS.has(value as Channel) ? value as Channel : null;
}

function contentFormat(value: unknown): "card_news" | "reel" | null {
  if (value === "card_news" || value === "reel") return value;
  if (value === "instagram_reel") return "reel";
  if (value === "instagram_feed_carousel" || value === "instagram_feed_single") return "card_news";
  return null;
}

export function createPublishItemsRepository(pool: Queryable): PublishItemsRepository {
  return {
    async listPublishItems(input) {
      const result = await pool.query(PUBLISH_ITEMS_SQL, [input.workspaceId, input.brandId]);
      const grouped = new Map<string, Record<string, unknown>[]>();
      for (const row of result.rows as Record<string, unknown>[]) {
        const key = String(row.item_key);
        const rows = grouped.get(key) ?? [];
        rows.push(row);
        grouped.set(key, rows);
      }

      const items = [...grouped.entries()].map(([itemKey, rows]): PublishItemDto => {
        const first = rows[0]!;
        const targetRows = new Map<string, Record<string, unknown>>();
        const reviewRows = new Map<string, Record<string, unknown>>();
        for (const row of rows) {
          if (row.queue_id) targetRows.set(String(row.queue_id), row);
          if (row.review_channel_output_id) reviewRows.set(String(row.review_channel_output_id), row);
        }
        const targets: PublishItemTargetDto[] = [...targetRows.values()].map((row) => ({
          queueId: String(row.queue_id),
          channelOutputId: row.channel_output_id ? String(row.channel_output_id) : null,
          channel: channel(row.channel) ?? "instagram",
          status: row.queue_status as PublishItemTargetDto["status"],
          scheduledFor: iso(row.queue_scheduled_for),
          publishedAt: iso(row.published_at),
          failedAt: iso(row.failed_at),
          lastError: row.last_error ? String(row.last_error) : null,
          externalPostId: row.external_post_id ? String(row.external_post_id) : null,
          externalUrl: row.external_url ? String(row.external_url) : null,
          previewTitle: row.preview_title ? String(row.preview_title) : null,
          previewBody: row.preview_body ? String(row.preview_body) : null,
          outputJson: record(row.output_json),
          artifactPublicUrl: row.artifact_public_url ? String(row.artifact_public_url) : null,
          sourceSummary: row.queue_source_summary ? String(row.queue_source_summary) : null,
        }));
        const reviewTargets: PublishItemReviewTargetDto[] = [...reviewRows.values()].map((row) => ({
          channelOutputId: String(row.review_channel_output_id),
          channel: channel(row.review_channel) ?? "instagram",
          deliveryFormat: String(row.review_delivery_format) as PublishItemReviewTargetDto["deliveryFormat"],
          status: String(row.review_status) as PublishItemReviewTargetDto["status"],
          previewTitle: row.review_preview_title ? String(row.review_preview_title) : null,
          previewBody: row.review_preview_body ? String(row.review_preview_body) : null,
          outputJson: record(row.review_output_json),
          sourceSummary: row.review_source_summary ? String(row.review_source_summary) : null,
          blockReasons: strings(row.review_block_reasons),
          generatedAt: iso(row.review_generated_at)!,
        }));
        const slot = rows.find((row) => row.calendar_slot_id) ?? null;
        const slotStatus = slot?.slot_status ? String(slot.slot_status) : null;
        const stateTargets = [...targetRows.values()].map((row) => ({
          status: String(row.queue_status) as PublishItemTargetDto["status"],
          scheduledFor: iso(row.queue_scheduled_for),
          effectiveScheduledFor: iso(row.effective_scheduled_for),
          publishedAt: iso(row.published_at),
          lastError: row.last_error ? String(row.last_error) : null,
        }));
        if (stateTargets.length === 0 && slotStatus === "cancelled") {
          stateTargets.push({
            status: "cancelled", scheduledFor: null, effectiveScheduledFor: null,
            publishedAt: null, lastError: slot?.slot_last_error ? String(slot.slot_last_error) : null,
          });
        }
        const groupStatus = (slot?.group_status ?? first.group_status) ? String(slot?.group_status ?? first.group_status) : null;
        const hasActiveReservation = Boolean(slot && slotStatus && ACTIVE_SLOT_STATUSES.has(slotStatus))
          || Boolean(groupStatus && ACTIVE_GROUP_STATUSES.has(groupStatus));
        const baseSchedulable = first.base_schedulable === true;
        const groupBlocksScheduling = Boolean(groupStatus && groupStatus !== "waiting");
        const reviewBlocksScheduling = reviewTargets.some((target) => !["approved", "auto_approved"].includes(target.status));
        const schedulable = baseSchedulable && targets.length === 0 && !slot && !groupBlocksScheduling && !reviewBlocksScheduling;
        const contentStatus = reviewTargets.some((target) => target.status === "generation_failed") ? "failed"
          : reviewTargets.some((target) => target.status === "generating" || target.status === "regenerating") ? "generating"
          : first.content_status as "pre_generation" | "generating" | "completed" | "failed";
        const state = aggregatePublishState(stateTargets, {
          contentStatus,
          groupStatus,
          hasActiveReservation,
          scheduledFor: iso(slot?.slot_scheduled_for),
          effectiveScheduledFor: iso(slot?.slot_scheduled_for),
          schedulable,
        });
        const channels = [...new Set([
          ...targets.map((target) => target.channel),
          ...strings(slot?.slot_channels).map(channel).filter((value): value is Channel => value !== null),
        ])];
        const lastError = targets.find((target) => target.lastError)?.lastError
          ?? (slot?.slot_last_error ? String(slot.slot_last_error) : null);
        const sourceEvidence = rows.find((row) => row.queue_source_summary || row.review_source_summary || row.queue_reference_url
          || strings(row.queue_source_urls).length > 0) ?? null;
        const sourceUrls = strings([
          ...strings(first.source_urls),
          ...strings(sourceEvidence?.queue_source_urls),
          ...(sourceEvidence?.queue_reference_url ? [String(sourceEvidence.queue_reference_url)] : []),
        ]);
        const baseSourceType = first.source_type as PublishItemDto["source"]["type"];
        const sourceType = baseSourceType === "unknown" && sourceEvidence ? "source_url" : baseSourceType;
        const sourceDetailParts = [first.source_detail, sourceEvidence?.queue_reference_url, sourceEvidence?.queue_source_summary, sourceEvidence?.review_source_summary]
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0);

        return {
          itemKey,
          workspaceId: String(first.workspace_id),
          brandId: String(first.brand_id),
          title: String(first.title ?? "게시 콘텐츠"),
          createdAt: iso(first.created_at)!,
          contentFormat: contentFormat(first.content_format ?? slot?.slot_content_format),
          channels,
          source: {
            type: sourceType,
            label: baseSourceType === "unknown" && sourceEvidence
              ? String(sourceEvidence.queue_reference_url ?? "크롤링 근거")
              : String(first.source_label ?? "근거 없음"),
            detail: sourceDetailParts.length > 0 ? [...new Set(sourceDetailParts)].join(" | ") : null,
            urls: sourceUrls,
          },
          targets,
          reviewTargets,
          contentStatus,
          publishStatus: state.publishStatus,
          status: state.status,
          groupStatus,
          publicationProgress: state.publicationProgress,
          scheduledFor: state.scheduledFor,
          effectiveScheduledFor: state.effectiveScheduledFor,
          publishedAt: state.publishedAt,
          calendarDate: state.calendarDate,
          calendarPlacement: state.calendarPlacement,
          assignmentMode: slot?.assignment_mode
            ? slot.assignment_mode as "automatic" | "manual"
            : targets.length > 0 ? "direct" : null,
          sourceRefs: {
            contentTopicId: (first.content_topic_id ?? first.group_content_topic_id ?? first.queue_content_topic_id)
              ? String(first.content_topic_id ?? first.group_content_topic_id ?? first.queue_content_topic_id)
              : null,
            proposalId: (slot?.slot_proposal_id ?? first.proposal_id) ? String(slot?.slot_proposal_id ?? first.proposal_id) : null,
            generationId: first.generation_id ? String(first.generation_id) : null,
            generationOutputId: first.generation_output_id ? String(first.generation_output_id) : null,
            calendarSlotId: slot?.calendar_slot_id ? String(slot.calendar_slot_id) : null,
            topicPublishGroupId: (slot?.slot_group_id ?? first.source_group_id ?? first.topic_publish_group_id ?? first.queue_group_id)
              ? String(slot?.slot_group_id ?? first.source_group_id ?? first.topic_publish_group_id ?? first.queue_group_id)
              : null,
            queueIds: targets.map((target) => target.queueId),
          },
          schedulable,
          scheduleBlockedReason: schedulable ? null : hasActiveReservation || targets.length > 0
            ? "already_scheduled"
            : "content_not_schedulable",
          lastError,
        };
      });

      return items.sort((left, right) => {
        if (left.calendarDate && right.calendarDate) return right.calendarDate.localeCompare(left.calendarDate);
        if (left.calendarDate) return -1;
        if (right.calendarDate) return 1;
        return right.createdAt.localeCompare(left.createdAt) || left.itemKey.localeCompare(right.itemKey);
      });
    },
  };
}
