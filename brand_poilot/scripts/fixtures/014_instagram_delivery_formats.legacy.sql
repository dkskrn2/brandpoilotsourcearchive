alter table brand_profiles
  add column if not exists brand_color text null;

create table if not exists brand_content_formats (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  format text not null,
  enabled boolean not null default false,
  rotation_order int not null,
  capability_status text not null default 'unchecked',
  capability_checked_at timestamptz null,
  capability_metadata jsonb not null default '{}'::jsonb,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_content_formats_format_check check (
    format in ('instagram_feed_carousel', 'instagram_story', 'instagram_reel')
  ),
  constraint brand_content_formats_rotation_order_check check (
    (format = 'instagram_feed_carousel' and rotation_order = 1)
    or (format = 'instagram_story' and rotation_order = 2)
    or (format = 'instagram_reel' and rotation_order = 3)
  ),
  constraint brand_content_formats_capability_status_check check (
    capability_status in ('available', 'unavailable', 'unchecked', 'needs_attention')
  ),
  constraint brand_content_formats_capability_metadata_object_check check (
    jsonb_typeof(capability_metadata) = 'object'
  ),
  constraint brand_content_formats_brand_format_unique unique (brand_id, format)
);

create index if not exists brand_content_formats_brand_enabled_rotation_idx
  on brand_content_formats(brand_id, enabled, rotation_order);

drop trigger if exists brand_content_formats_set_updated_at on brand_content_formats;
create trigger brand_content_formats_set_updated_at
before update on brand_content_formats
for each row execute function set_updated_at();

insert into brand_content_formats (
  workspace_id,
  brand_id,
  format,
  enabled,
  rotation_order,
  capability_status
)
select
  b.workspace_id,
  b.id,
  seed.format,
  seed.enabled,
  seed.rotation_order,
  seed.capability_status
from brands b
cross join (
  values
    ('instagram_feed_carousel', true, 1, 'available'),
    ('instagram_story', false, 2, 'unchecked'),
    ('instagram_reel', false, 3, 'unchecked')
) as seed(format, enabled, rotation_order, capability_status)
where b.status = 'active'
  and b.deleted_at is null
on conflict (brand_id, format) do nothing;

create table if not exists brand_format_rotation_states (
  brand_id uuid primary key references brands(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  last_selected_format text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_format_rotation_states_last_selected_format_check check (
    last_selected_format is null
    or last_selected_format in ('instagram_feed_carousel', 'instagram_story', 'instagram_reel')
  )
);

drop trigger if exists brand_format_rotation_states_set_updated_at on brand_format_rotation_states;
create trigger brand_format_rotation_states_set_updated_at
before update on brand_format_rotation_states
for each row execute function set_updated_at();

insert into brand_format_rotation_states (brand_id, workspace_id)
select b.id, b.workspace_id
from brands b
where b.status = 'active'
  and b.deleted_at is null
on conflict (brand_id) do nothing;

alter table content_topics
  add column if not exists selected_instagram_format text null;

alter table content_topics
  drop constraint if exists content_topics_selected_instagram_format_check;
alter table content_topics
  add constraint content_topics_selected_instagram_format_check check (
    selected_instagram_format is null
    or selected_instagram_format in ('instagram_feed_carousel', 'instagram_story', 'instagram_reel')
  );

alter table channel_outputs
  add column if not exists delivery_format text null;

update channel_outputs
set delivery_format = 'instagram_feed_carousel'
where channel = 'instagram'
  and delivery_format is null;

update channel_outputs
set delivery_format = 'threads_text'
where channel = 'threads'
  and delivery_format is null;

alter table channel_outputs
  alter column delivery_format set not null;

alter table channel_outputs
  drop constraint if exists channel_outputs_delivery_format_check;
alter table channel_outputs
  add constraint channel_outputs_delivery_format_check check (
    delivery_format in (
      'instagram_feed_carousel',
      'instagram_story',
      'instagram_reel',
      'threads_text'
    )
  );

create table if not exists topic_publish_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  content_topic_id uuid not null references content_topics(id) on delete cascade,
  status text not null default 'waiting',
  slot_date date null,
  slot_number int null,
  scheduled_for timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint topic_publish_groups_content_topic_unique unique (content_topic_id),
  constraint topic_publish_groups_status_check check (
    status in (
      'waiting',
      'ready',
      'scheduled',
      'partially_published',
      'published',
      'failed',
      'cancelled'
    )
  ),
  constraint topic_publish_groups_slot_number_check check (
    slot_number is null or slot_number between 1 and 4
  )
);

drop trigger if exists topic_publish_groups_set_updated_at on topic_publish_groups;
create trigger topic_publish_groups_set_updated_at
before update on topic_publish_groups
for each row execute function set_updated_at();

insert into topic_publish_groups (
  workspace_id,
  brand_id,
  content_topic_id,
  status,
  slot_date,
  slot_number,
  scheduled_for
)
select
  ct.workspace_id,
  ct.brand_id,
  ct.id,
  queue_state.status,
  queue_state.slot_date,
  queue_state.slot_number,
  queue_state.scheduled_for
from content_topics ct
cross join lateral (
  select
    case
      when count(pq.id) = 0 then 'waiting'
      when bool_and(pq.status = 'published') then 'published'
      when bool_and(pq.status = 'cancelled') then 'cancelled'
      when bool_or(pq.status in ('published', 'publishing')) then 'partially_published'
      when bool_or(pq.status in ('scheduled', 'deferred')) then 'scheduled'
      when bool_or(pq.status = 'queued') then 'ready'
      when bool_or(pq.status = 'failed') then 'failed'
      else 'waiting'
    end as status,
    min(pq.slot_date) filter (
      where pq.status in ('scheduled', 'publishing', 'deferred')
    ) as slot_date,
    min(pq.slot_number) filter (
      where pq.status in ('scheduled', 'publishing', 'deferred')
    ) as slot_number,
    min(pq.scheduled_for) filter (
      where pq.status in ('scheduled', 'publishing', 'deferred')
    ) as scheduled_for
  from channel_outputs co
  join publish_queue pq on pq.channel_output_id = co.id
  where co.content_topic_id = ct.id
) queue_state
on conflict (content_topic_id) do nothing;

-- Legacy queue rows can occupy a slot independently per channel. Keep those rows
-- unchanged and clear only duplicate scheduling metadata on the new aggregate rows.
with ranked_active_slots as (
  select
    id,
    row_number() over (
      partition by brand_id, slot_date, slot_number
      order by scheduled_for nulls last, created_at, id
    ) as slot_position
  from topic_publish_groups
  where status in ('scheduled', 'partially_published')
    and slot_date is not null
    and slot_number is not null
)
update topic_publish_groups tpg
set
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

create index if not exists topic_publish_groups_ready_idx
  on topic_publish_groups(workspace_id, brand_id, created_at)
  where status = 'ready';

alter table publish_queue
  add column if not exists topic_publish_group_id uuid null
    references topic_publish_groups(id) on delete restrict;

update publish_queue pq
set topic_publish_group_id = tpg.id
from channel_outputs co
join topic_publish_groups tpg on tpg.content_topic_id = co.content_topic_id
where pq.channel_output_id = co.id
  and pq.topic_publish_group_id is distinct from tpg.id;

alter table publish_queue
  alter column topic_publish_group_id set not null;

create index if not exists publish_queue_topic_publish_group_idx
  on publish_queue(topic_publish_group_id, status, scheduled_for);

alter table jobs
  drop constraint if exists jobs_type_check;

update jobs
set job_type = 'instagram_feed_render'
where job_type = 'instagram_render';

alter table jobs
  add constraint jobs_type_check check (
    job_type in (
      'daily_generation_enqueue',
      'source_crawl',
      'topic_select',
      'master_draft_generate',
      'channel_output_generate',
      'auto_approval_check',
      'instagram_feed_render',
      'instagram_story_render',
      'instagram_reel_render',
      'artifact_upload',
      'instagram_publish',
      'threads_publish',
      'token_health_check',
      'storage_cleanup'
    )
  );

drop index if exists jobs_image_render_output_idx;
drop index if exists jobs_active_instagram_render_output_unique;
drop index if exists jobs_render_output_idx;
drop index if exists jobs_active_render_output_unique;

create index jobs_render_output_idx
  on jobs(channel_output_id, created_at desc)
  where job_type in (
    'instagram_feed_render',
    'instagram_story_render',
    'instagram_reel_render'
  );

create unique index jobs_active_render_output_unique
  on jobs(channel_output_id)
  where job_type in (
    'instagram_feed_render',
    'instagram_story_render',
    'instagram_reel_render'
  )
    and status in ('queued', 'running');

alter table storage_artifacts
  drop constraint if exists storage_artifacts_type_check;
alter table storage_artifacts
  add constraint storage_artifacts_type_check check (
    artifact_type in (
      'topic_upload',
      'brand_asset',
      'rendered_image',
      'generated_manifest',
      'cover_image',
      'source_archive',
      'rendered_video',
      'reel_cover'
    )
  );
