alter table channel_outputs
  add constraint channel_outputs_performance_identity_unique
    unique (id, workspace_id, brand_id, channel);

alter table publish_queue
  add constraint publish_queue_performance_identity_unique
    unique (id, channel_output_id, workspace_id, brand_id, channel);

create table content_performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  brand_id uuid not null references brands(id),
  channel text not null,
  publish_queue_id uuid not null references publish_queue(id) on delete cascade,
  channel_output_id uuid not null references channel_outputs(id) on delete cascade,
  external_post_id text not null,
  snapshot_date date not null,
  exposure_count bigint null,
  raw_metrics jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_performance_snapshots_channel_check check (
    channel in ('instagram', 'threads', 'x', 'linkedin', 'youtube', 'tiktok', 'webflow')
  ),
  constraint content_performance_snapshots_exposure_count_check check (
    exposure_count is null or exposure_count >= 0
  ),
  constraint content_performance_snapshots_raw_metrics_object_check check (
    jsonb_typeof(raw_metrics) = 'object'
  ),
  constraint content_performance_snapshots_publish_queue_owner_fkey
    foreign key (publish_queue_id, channel_output_id, workspace_id, brand_id, channel)
    references publish_queue(id, channel_output_id, workspace_id, brand_id, channel)
    on delete cascade,
  constraint content_performance_snapshots_channel_output_owner_fkey
    foreign key (channel_output_id, workspace_id, brand_id, channel)
    references channel_outputs(id, workspace_id, brand_id, channel)
    on delete cascade,
  unique (publish_queue_id, snapshot_date)
);

create index content_performance_brand_channel_date_idx
  on content_performance_snapshots (brand_id, channel, snapshot_date desc);

create table performance_sync_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  brand_id uuid not null references brands(id),
  channel text not null,
  run_date date not null,
  status text not null,
  target_count integer not null default 0,
  success_count integer not null default 0,
  failure_count integer not null default 0,
  error_summary text null,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint performance_sync_runs_channel_check check (
    channel in ('instagram', 'threads', 'x', 'linkedin', 'youtube', 'tiktok', 'webflow')
  ),
  constraint performance_sync_runs_status_check check (
    status in ('running', 'completed', 'partially_failed', 'failed', 'not_configured')
  ),
  constraint performance_sync_runs_counts_check check (
    target_count >= 0
    and success_count >= 0
    and failure_count >= 0
    and success_count::bigint + failure_count::bigint <= target_count
  ),
  unique (brand_id, channel, run_date)
);

create trigger content_performance_snapshots_set_updated_at
before update on content_performance_snapshots
for each row execute function set_updated_at();

create trigger performance_sync_runs_set_updated_at
before update on performance_sync_runs
for each row execute function set_updated_at();
