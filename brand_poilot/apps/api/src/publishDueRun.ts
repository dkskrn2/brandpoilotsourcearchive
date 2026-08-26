import type { Pool, PoolClient } from "pg";
import type { PublishDuePreviewResult, PublishDueRunResult } from "./types.js";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_CONCURRENCY = 4;

export interface PublishDueClaim<TContext = unknown> {
  queueId: string;
  context: TContext;
}

export interface RunPublishDueInput<TContext = unknown> {
  pool: Pick<Pool, "connect">;
  now?: Date;
  batchSize?: number;
  concurrency?: number;
  claimQueueItem: (
    client: Pick<PoolClient, "query">,
    queueId: string,
  ) => Promise<PublishDueClaim<TContext> | null>;
  dispatchClaim: (claim: PublishDueClaim<TContext>) => Promise<{ status?: string } | void>;
}

export interface PreviewPublishDueInput {
  pool: Pick<Pool, "query">;
  now?: Date;
  batchSize?: number;
}

const zeroCounts = (): Omit<PublishDueRunResult, "acquired"> => ({
  expiredTargets: 0,
  expiredSlots: 0,
  dueQueued: 0,
  published: 0,
  failed: 0,
  resultUnknown: 0,
});

function boundedPositiveInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error("publish_due_run_bounds_invalid");
  }
  return value;
}

export function hasReachedKstReservationExpiry(scheduledFor: Date, now: Date): boolean {
  if (!Number.isFinite(scheduledFor.getTime()) || !Number.isFinite(now.getTime())) return false;
  const local = new Date(scheduledFor.getTime() + KST_OFFSET_MS);
  const cutoffUtc = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    23 - 9,
    59,
    0,
    0,
  );
  return now.getTime() >= cutoffUtc;
}

export function canAutoRetryCalendarPublish(scheduledFor: Date | null, now: Date): boolean {
  if (scheduledFor === null) return true;
  if (!Number.isFinite(scheduledFor.getTime()) || !Number.isFinite(now.getTime())) return false;
  const scheduledKstDate = new Date(scheduledFor.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
  const nowKstDate = new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
  return scheduledKstDate === nowKstDate && !hasReachedKstReservationExpiry(scheduledFor, now);
}

const recoveredQueuePredicate = `queue.status='publishing'
       and exists (
         select 1 from publish_attempts attempt
          where attempt.publish_queue_id=queue.id and attempt.status='succeeded'
       )`;
const resultUnknownQueuePredicate = `queue.status='publishing'
       and queue.publishing_started_at < $1::timestamptz-interval '30 minutes'
       and not exists (
         select 1 from publish_attempts attempt
          where attempt.publish_queue_id=queue.id and attempt.status='succeeded'
       )`;
const expiredSlotPredicate = `slot.status not in ('published','cancelled')
       and $1::timestamptz >= (
         date_trunc('day',slot.scheduled_for at time zone 'Asia/Seoul')
         + interval '23 hours 59 minutes'
       ) at time zone 'Asia/Seoul'`;
const expirableTargetPredicate = `queue.status in ('queued','scheduled','deferred','failed')
       and queue.publishing_started_at is null
       and queue.published_at is null
       and queue.last_error is distinct from 'publish_delivery_unknown'
       and not exists (
         select 1 from publish_attempts attempt where attempt.publish_queue_id=queue.id
       )`;
const calendarReadyPredicate = `slot.status in ('content_assigned','ready','publish_delayed','quota_blocked')
       and publish_group.status in ('waiting','ready')
       and exists (
         select 1 from publish_queue queue
          where queue.topic_publish_group_id=publish_group.id and queue.status='queued'
       )
       and not exists (
         select 1 from publish_queue queue
          where queue.topic_publish_group_id=publish_group.id and queue.status<>'queued'
       )
       and $1::timestamptz < (
         date_trunc('day',slot.scheduled_for at time zone 'Asia/Seoul')
         + interval '23 hours 59 minutes'
       ) at time zone 'Asia/Seoul'`;
const dueQueuePredicate = `brand.status='active' and brand.deleted_at is null
       and (
         (queue.status='scheduled' and queue.scheduled_for<=$1::timestamptz)
         or (queue.status='deferred' and queue.deferred_until<=$1::timestamptz)
       )`;

const expirySql = `/* publish_due_expire */
  with recovered as (
    update publish_queue queue
       set status='published',
           published_at=coalesce(
             queue.published_at,
             (select max(attempt.finished_at)
                from publish_attempts attempt
               where attempt.publish_queue_id=queue.id and attempt.status='succeeded'),
             $1::timestamptz
           ),
           last_error=null,updated_at=$1::timestamptz
     where ${recoveredQueuePredicate}
    returning queue.id,queue.workspace_id,queue.brand_id,queue.channel,queue.topic_publish_group_id
  ), recovered_channels as (
    update brand_channels channel
       set last_published_at=$1::timestamptz,status='connected',last_error=null
      from recovered
     where channel.workspace_id=recovered.workspace_id
       and channel.brand_id=recovered.brand_id
       and channel.channel=recovered.channel
    returning channel.id
  ), recovered_groups as (
    update topic_publish_groups publish_group
       set status=case
             when not exists (
               select 1 from publish_queue pending
                where pending.topic_publish_group_id=publish_group.id
                  and pending.id not in (select recovered_queue.id from recovered recovered_queue)
                  and pending.status<>'published'
             ) then 'published'
             else 'partially_published'
           end,
           updated_at=$1::timestamptz
      from recovered
     where publish_group.id=recovered.topic_publish_group_id
    returning publish_group.id,publish_group.status
  ), recovered_slots as (
    update publish_calendar_slots slot
       set status='published',last_error=null,updated_at=$1::timestamptz
      from recovered_groups
     where slot.topic_publish_group_id=recovered_groups.id
       and recovered_groups.status='published'
    returning slot.id
  ), result_unknown_targets as (
    update publish_queue queue
       set status='failed',failed_at=$1::timestamptz,
           last_error='publish_delivery_unknown',updated_at=$1::timestamptz
     where ${resultUnknownQueuePredicate}
       and queue.id not in (select recovered_queue.id from recovered recovered_queue)
    returning queue.id,queue.topic_publish_group_id
  ), result_unknown_attempts as (
    update publish_attempts attempt
       set status='failed',error_code='publish_delivery_unknown',
           error_message='publish_delivery_unknown',finished_at=$1::timestamptz
     where attempt.status='running'
       and attempt.publish_queue_id in (select id from result_unknown_targets)
    returning attempt.id
  ), result_unknown_slots as (
    update publish_calendar_slots slot
       set status='publish_delayed',last_error='publish_delivery_unknown',updated_at=$1::timestamptz
      from result_unknown_targets
     where slot.topic_publish_group_id=result_unknown_targets.topic_publish_group_id
       and slot.status not in ('published','cancelled')
    returning slot.id
  ), expired_slot_candidates as (
    select slot.id,slot.topic_publish_group_id
      from publish_calendar_slots slot
     where ${expiredSlotPredicate}
     for update of slot
  ), expired_targets as (
    update publish_queue queue
       set status='cancelled',deferred_until=null,
           last_error='reservation_expired_at_2359_kst',updated_at=$1::timestamptz
      from expired_slot_candidates candidate
     where queue.topic_publish_group_id=candidate.topic_publish_group_id
       and ${expirableTargetPredicate}
    returning queue.id,queue.topic_publish_group_id
  ), wholly_unstarted_groups as (
    select distinct candidate.topic_publish_group_id
      from expired_slot_candidates candidate
     where not exists (
       select 1 from publish_queue target
        where target.topic_publish_group_id=candidate.topic_publish_group_id
          and target.status<>'cancelled'
          and not exists (
            select 1 from expired_targets expired_target where expired_target.id=target.id
          )
     )
  ), expired_groups as (
    update topic_publish_groups publish_group
       set status='cancelled',updated_at=$1::timestamptz
      from wholly_unstarted_groups expired_group
     where publish_group.id=expired_group.topic_publish_group_id
    returning publish_group.id
  ), expired_slots as (
    update publish_calendar_slots slot
       set status='cancelled',last_error='reservation_expired_at_2359_kst',updated_at=$1::timestamptz
      from expired_groups expired_group
     where slot.topic_publish_group_id=expired_group.id
    returning slot.id
  )
  select
    (select count(*)::integer from expired_targets) as expired_targets,
    (select count(*)::integer from expired_slots) as expired_slots,
    (select count(*)::integer from recovered) as recovered_published,
    (select count(*)::integer from result_unknown_targets) as result_unknown`;

const queueDelayedSql = `/* publish_due_queue_delayed */
  with calendar_ready as (
    select slot.id as slot_id,slot.topic_publish_group_id,slot.scheduled_for
      from publish_calendar_slots slot
      join topic_publish_groups publish_group
        on publish_group.id=slot.topic_publish_group_id
       and publish_group.workspace_id=slot.workspace_id
       and publish_group.brand_id=slot.brand_id
     where ${calendarReadyPredicate}
     order by slot.scheduled_for,slot.brand_id,slot.id
     for update of slot,publish_group
  ), scheduled_groups as (
    update topic_publish_groups publish_group
       set status='scheduled',scheduled_for=calendar_ready.scheduled_for,
           updated_at=$1::timestamptz
      from calendar_ready
     where publish_group.id=calendar_ready.topic_publish_group_id
    returning publish_group.id
  ), scheduled_targets as (
    update publish_queue queue
       set status=case when calendar_ready.scheduled_for<=$1::timestamptz then 'deferred' else 'scheduled' end,
           scheduled_for=slot.scheduled_for,
           deferred_until=case when calendar_ready.scheduled_for<=$1::timestamptz then $1::timestamptz else null end,
           updated_at=$1::timestamptz
      from calendar_ready
      join publish_calendar_slots slot on slot.id=calendar_ready.slot_id
     where queue.topic_publish_group_id=calendar_ready.topic_publish_group_id
       and queue.status='queued'
    returning queue.id,queue.brand_id,
              coalesce(queue.deferred_until,queue.scheduled_for,queue.queued_at) as effective_at,
              queue.queued_at
  ), scheduled_slots as (
    update publish_calendar_slots slot
       set status='scheduled',last_error=null,updated_at=$1::timestamptz
      from calendar_ready
     where slot.id=calendar_ready.slot_id
       and exists (
         select 1 from scheduled_groups where scheduled_groups.id=calendar_ready.topic_publish_group_id
       )
    returning slot.id
  )
  select count(*)::integer as queued from scheduled_targets`;

const dueCandidatesSql = `/* publish_due_candidates */
  with ranked_due as (
    select queue.id,queue.brand_id,
           coalesce(queue.deferred_until,queue.scheduled_for,queue.queued_at) as effective_at,
           queue.queued_at,
           row_number() over (
             partition by queue.brand_id
             order by coalesce(queue.deferred_until,queue.scheduled_for,queue.queued_at),queue.queued_at,queue.id
           ) as brand_rank
      from publish_queue queue
      join brands brand on brand.id=queue.brand_id and brand.workspace_id=queue.workspace_id
     where ${dueQueuePredicate}
  ), selected_due as (
    select queue.id,queue.brand_id,ranked_due.brand_rank,ranked_due.effective_at,ranked_due.queued_at
      from ranked_due
      join publish_queue queue on queue.id=ranked_due.id
     order by brand_rank,effective_at,queued_at,id
     limit $2::integer
     for update of queue skip locked
  )
  select id,brand_id from selected_due
   order by brand_rank,effective_at,queued_at,id`;

function numberCount(value: unknown): number {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

async function dispatchBounded<TContext>(
  claims: PublishDueClaim<TContext>[],
  concurrency: number,
  dispatchClaim: RunPublishDueInput<TContext>["dispatchClaim"],
  result: PublishDueRunResult,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, claims.length) }, async () => {
    while (cursor < claims.length) {
      const claim = claims[cursor];
      cursor += 1;
      try {
        const outcome = await dispatchClaim(claim!);
        if (outcome?.status === "result_unknown") result.resultUnknown += 1;
        else if (outcome?.status === "failed") result.failed += 1;
        else result.published += 1;
      } catch (error) {
        if (error instanceof Error && error.message === "publish_delivery_unknown") {
          result.resultUnknown += 1;
        } else {
          result.failed += 1;
        }
      }
    }
  });
  await Promise.all(workers);
}

export async function runPublishDue<TContext = unknown>(
  input: RunPublishDueInput<TContext>,
): Promise<PublishDueRunResult> {
  const now = input.now ?? new Date();
  const batchSize = boundedPositiveInteger(input.batchSize, DEFAULT_BATCH_SIZE, 500);
  const concurrency = boundedPositiveInteger(input.concurrency, DEFAULT_CONCURRENCY, 100);
  const result: PublishDueRunResult = { acquired: true, ...zeroCounts() };
  const client = await input.pool.connect();
  const claims: PublishDueClaim<TContext>[] = [];
  try {
    await client.query("begin");
    const lock = await client.query<{ acquired: boolean }>(
      "select pg_try_advisory_xact_lock(hashtextextended($1,0)) as acquired",
      ["publish-due-run:v1"],
    );
    if (lock.rows[0]?.acquired !== true) {
      await client.query("commit");
      return { acquired: false, ...zeroCounts() };
    }

    const expiry = await client.query(expirySql, [now]);
    const expiryRow = expiry.rows[0] ?? {};
    result.expiredTargets = numberCount(expiryRow.expired_targets);
    result.expiredSlots = numberCount(expiryRow.expired_slots);
    result.published = numberCount(expiryRow.recovered_published);
    result.resultUnknown = numberCount(expiryRow.result_unknown);

    await client.query(queueDelayedSql, [now]);
    const due = await client.query(dueCandidatesSql, [now, batchSize]);
    for (const row of due.rows) {
      const claim = await input.claimQueueItem(client, String(row.id));
      if (claim) claims.push(claim);
    }
    result.dueQueued = claims.length;
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  await dispatchBounded(claims, concurrency, input.dispatchClaim, result);
  return result;
}

export const runPublishDueRun = runPublishDue;

const previewSql = `/* publish_due_preview */
  with recovered as (
    select queue.id,queue.topic_publish_group_id
      from publish_queue queue
     where ${recoveredQueuePredicate}
  ), result_unknown as (
    select queue.id,queue.topic_publish_group_id
      from publish_queue queue
     where ${resultUnknownQueuePredicate}
       and queue.id not in (select id from recovered)
  ), expired_slot_candidates as (
    select slot.id,slot.topic_publish_group_id
      from publish_calendar_slots slot
     where ${expiredSlotPredicate}
  ), expired_targets as (
    select queue.id,queue.topic_publish_group_id
      from publish_queue queue
      join expired_slot_candidates candidate
        on candidate.topic_publish_group_id=queue.topic_publish_group_id
     where ${expirableTargetPredicate}
  ), wholly_unstarted_groups as (
    select distinct candidate.topic_publish_group_id
      from expired_slot_candidates candidate
     where not exists (
       select 1 from publish_queue target
        where target.topic_publish_group_id=candidate.topic_publish_group_id
          and target.status<>'cancelled'
          and not exists (
            select 1 from expired_targets expired_target where expired_target.id=target.id
          )
     )
  ), expired_slots as (
    select slot.id
      from publish_calendar_slots slot
      join wholly_unstarted_groups expired_group
        on expired_group.topic_publish_group_id=slot.topic_publish_group_id
  ), calendar_ready as (
    select slot.topic_publish_group_id,slot.scheduled_for
      from publish_calendar_slots slot
      join topic_publish_groups publish_group
        on publish_group.id=slot.topic_publish_group_id
       and publish_group.workspace_id=slot.workspace_id
       and publish_group.brand_id=slot.brand_id
     where ${calendarReadyPredicate}
  ), delayed_targets as (
    select queue.id,queue.brand_id,queue.queued_at,
           case when calendar_ready.scheduled_for<=$1::timestamptz
             then $1::timestamptz else calendar_ready.scheduled_for end as effective_at
      from calendar_ready
      join publish_queue queue on queue.topic_publish_group_id=calendar_ready.topic_publish_group_id
     where queue.status='queued'
  ), effective_due as (
    select queue.id,queue.brand_id,queue.queued_at,
           coalesce(queue.deferred_until,queue.scheduled_for,queue.queued_at) as effective_at
      from publish_queue queue
      join brands brand on brand.id=queue.brand_id and brand.workspace_id=queue.workspace_id
     where ${dueQueuePredicate}
       and queue.id not in (select id from recovered)
       and queue.id not in (select id from result_unknown)
       and queue.id not in (select id from expired_targets)
    union all
    select delayed.id,delayed.brand_id,delayed.queued_at,delayed.effective_at
      from delayed_targets delayed
      join brands brand on brand.id=delayed.brand_id
     where brand.status='active' and brand.deleted_at is null
       and delayed.effective_at<=$1::timestamptz
  ), ranked_due as (
    select due.*,
           row_number() over (
             partition by due.brand_id order by due.effective_at,due.queued_at,due.id
           ) as brand_rank
      from effective_due due
  ), selected_due as (
    select id from ranked_due
     order by brand_rank,effective_at,queued_at,id
     limit $2::integer
  )
  select
    coalesce((select array_agg(id::text order by id) from recovered),array[]::text[])
      as recovered_queue_ids,
    coalesce((select array_agg(id::text order by id) from result_unknown),array[]::text[])
      as result_unknown_queue_ids,
    coalesce((select array_agg(id::text order by id) from expired_targets),array[]::text[])
      as expired_target_queue_ids,
    coalesce((select array_agg(id::text order by id) from expired_slots),array[]::text[])
      as expired_slot_ids,
    coalesce((select array_agg(id::text order by id) from delayed_targets),array[]::text[])
      as delayed_queue_ids,
    coalesce((select array_agg(id::text order by id) from selected_due),array[]::text[])
      as provider_candidate_queue_ids`;

function stringIds(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

export async function previewPublishDue(
  input: PreviewPublishDueInput,
): Promise<PublishDuePreviewResult> {
  const now = input.now ?? new Date();
  const batchSize = boundedPositiveInteger(input.batchSize, DEFAULT_BATCH_SIZE, 500);
  const preview = await input.pool.query(previewSql, [now, batchSize]);
  const row = preview.rows[0] ?? {};
  const publishedQueueIds = stringIds(row.recovered_queue_ids);
  const resultUnknownQueueIds = stringIds(row.result_unknown_queue_ids);
  const targetQueueIds = stringIds(row.expired_target_queue_ids);
  const slotIds = stringIds(row.expired_slot_ids);
  const delayedQueueIds = stringIds(row.delayed_queue_ids);
  const providerCandidateQueueIds = stringIds(row.provider_candidate_queue_ids);
  return {
    observedAt: now.toISOString(),
    counts: {
      recoveredPublished: publishedQueueIds.length,
      resultUnknown: resultUnknownQueueIds.length,
      expiredTargets: targetQueueIds.length,
      expiredSlots: slotIds.length,
      delayedQueued: delayedQueueIds.length,
      providerCandidates: providerCandidateQueueIds.length,
    },
    recovery: {
      publishedQueueIds,
      resultUnknownQueueIds,
    },
    expiry: {
      targetQueueIds,
      slotIds,
    },
    delayedQueueIds,
    providerCandidateQueueIds,
  };
}
