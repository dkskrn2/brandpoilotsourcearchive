drop index if exists topic_publish_groups_active_brand_slot_unique;

with group_queue_rows as (
  select
    tpg.id as group_id,
    tpg.brand_id,
    tpg.created_at as group_created_at,
    pq.id as queue_id,
    pq.status as queue_status,
    pq.slot_date,
    pq.slot_number,
    pq.scheduled_for,
    pq.queued_at
  from topic_publish_groups tpg
  join channel_outputs co on co.content_topic_id = tpg.content_topic_id
  join publish_queue pq on pq.channel_output_id = co.id
),
group_aggregates as (
  select
    group_id,
    brand_id,
    group_created_at,
    case
      when count(queue_id) = 0 then 'waiting'
      when bool_and(queue_status = 'published') then 'published'
      when bool_and(queue_status = 'cancelled') then 'cancelled'
      when bool_or(queue_status in ('published', 'publishing')) then 'partially_published'
      when bool_or(queue_status in ('scheduled', 'deferred')) then 'scheduled'
      when bool_or(queue_status = 'queued') then 'ready'
      when bool_or(queue_status = 'failed') then 'failed'
      else 'waiting'
    end as aggregate_status
  from group_queue_rows
  group by group_id, brand_id, group_created_at
),
schedule_candidates as (
  select
    group_id,
    slot_date as candidate_slot_date,
    slot_number as candidate_slot_number,
    scheduled_for as candidate_scheduled_for,
    row_number() over (
      partition by group_id
      order by
        scheduled_for nulls last,
        slot_date nulls last,
        slot_number nulls last,
        queued_at,
        queue_id
    ) as schedule_position
  from group_queue_rows
  where queue_status in ('scheduled', 'publishing', 'deferred')
),
candidate_states as (
  select
    aggregate.group_id,
    aggregate.brand_id,
    aggregate.group_created_at,
    aggregate.aggregate_status,
    schedule.candidate_slot_date,
    schedule.candidate_slot_number,
    schedule.candidate_scheduled_for
  from group_aggregates aggregate
  left join schedule_candidates schedule
    on schedule.group_id = aggregate.group_id
   and schedule.schedule_position = 1
),
active_candidate_rankings as (
  select
    group_id,
    row_number() over (
      partition by brand_id, candidate_slot_date, candidate_slot_number
      order by candidate_scheduled_for nulls last, group_created_at, group_id
    ) as slot_position
  from candidate_states
  where aggregate_status in ('scheduled', 'partially_published')
    and candidate_slot_date is not null
    and candidate_slot_number is not null
),
final_states as (
  select
    candidate.group_id,
    case
      when slot_position > 1 and aggregate_status = 'scheduled' then 'waiting'
      else aggregate_status
    end as status,
    case
      when slot_position > 1 then null
      else candidate_slot_date
    end as slot_date,
    case
      when slot_position > 1 then null
      else candidate_slot_number
    end as slot_number,
    case
      when slot_position > 1 then null
      else candidate_scheduled_for
    end as scheduled_for
  from candidate_states candidate
  left join active_candidate_rankings active
    on active.group_id = candidate.group_id
)
update topic_publish_groups tpg
set
  status = final.status,
  slot_date = final.slot_date,
  slot_number = final.slot_number,
  scheduled_for = final.scheduled_for,
  updated_at = now()
from final_states final
where tpg.id = final.group_id
  and (
    tpg.status is distinct from final.status
    or tpg.slot_date is distinct from final.slot_date
    or tpg.slot_number is distinct from final.slot_number
    or tpg.scheduled_for is distinct from final.scheduled_for
  );

create unique index if not exists topic_publish_groups_active_brand_slot_unique
  on topic_publish_groups(brand_id, slot_date, slot_number)
  where status in ('scheduled', 'partially_published')
    and slot_date is not null
    and slot_number is not null;
