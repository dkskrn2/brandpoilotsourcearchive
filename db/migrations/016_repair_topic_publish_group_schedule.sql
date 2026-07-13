drop index if exists topic_publish_groups_active_brand_slot_unique;

with repaired_groups as (
  select
    tpg.id,
    queue_state.status,
    selected_schedule.slot_date,
    selected_schedule.slot_number,
    selected_schedule.scheduled_for
  from topic_publish_groups tpg
  cross join lateral (
    select
      count(pq.id) as queue_count,
      case
        when count(pq.id) = 0 then 'waiting'
        when bool_and(pq.status = 'published') then 'published'
        when bool_and(pq.status = 'cancelled') then 'cancelled'
        when bool_or(pq.status in ('published', 'publishing')) then 'partially_published'
        when bool_or(pq.status in ('scheduled', 'deferred')) then 'scheduled'
        when bool_or(pq.status = 'queued') then 'ready'
        when bool_or(pq.status = 'failed') then 'failed'
        else 'waiting'
      end as status
    from channel_outputs co
    join publish_queue pq on pq.channel_output_id = co.id
    where co.content_topic_id = tpg.content_topic_id
  ) queue_state
  left join lateral (
    select
      pq.slot_date,
      pq.slot_number,
      pq.scheduled_for
    from channel_outputs co
    join publish_queue pq on pq.channel_output_id = co.id
    where co.content_topic_id = tpg.content_topic_id
      and pq.status in ('scheduled', 'publishing', 'deferred')
    order by
      pq.scheduled_for nulls last,
      pq.slot_date nulls last,
      pq.slot_number nulls last,
      pq.queued_at,
      pq.id
    limit 1
  ) selected_schedule on true
  where queue_state.queue_count > 0
)
update topic_publish_groups tpg
set
  status = repaired.status,
  slot_date = repaired.slot_date,
  slot_number = repaired.slot_number,
  scheduled_for = repaired.scheduled_for,
  updated_at = now()
from repaired_groups repaired
where tpg.id = repaired.id;

with ranked_active_slots as (
  select
    id,
    row_number() over (
      partition by brand_id, slot_date, slot_number
      order by scheduled_for nulls last, created_at, id
    ) as slot_position
  from topic_publish_groups tpg
  where status in ('scheduled', 'partially_published')
    and slot_date is not null
    and slot_number is not null
    and exists (
      select 1
      from channel_outputs co
      join publish_queue pq on pq.channel_output_id = co.id
      where co.content_topic_id = tpg.content_topic_id
        and pq.slot_date is not distinct from tpg.slot_date
        and pq.slot_number is not distinct from tpg.slot_number
        and pq.scheduled_for is not distinct from tpg.scheduled_for
    )
)
update topic_publish_groups tpg
set
  status = 'waiting',
  slot_date = null,
  slot_number = null,
  scheduled_for = null,
  updated_at = now()
from ranked_active_slots ranked
where tpg.id = ranked.id
  and ranked.slot_position > 1;

create unique index if not exists topic_publish_groups_active_brand_slot_unique
  on topic_publish_groups(brand_id, slot_date, slot_number)
  where status in ('scheduled', 'partially_published')
    and slot_date is not null
    and slot_number is not null;
