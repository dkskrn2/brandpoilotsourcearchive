alter table jobs
  add column if not exists channel_output_id uuid null references channel_outputs(id) on delete cascade,
  add column if not exists lease_token uuid null,
  add column if not exists result_json jsonb not null default '{}'::jsonb;

create index if not exists jobs_image_render_output_idx
  on jobs(channel_output_id, created_at desc)
  where job_type = 'instagram_render';

create unique index if not exists jobs_active_instagram_render_output_unique
  on jobs(channel_output_id)
  where job_type = 'instagram_render' and status in ('queued', 'running');
