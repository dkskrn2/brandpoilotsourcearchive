create table source_crawl_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  source_url_id uuid not null references source_urls(id) on delete cascade,
  parent_run_id uuid null references source_crawl_runs(id) on delete set null,
  trigger text not null,
  status text not null default 'queued',
  run_key text not null,
  attempt integer not null default 0,
  processed_count integer not null default 0,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  failed_count integer not null default 0,
  started_at timestamptz null,
  finished_at timestamptz null,
  next_retry_at timestamptz null,
  last_error text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint source_crawl_runs_trigger_check
    check (trigger in ('new_source', 'scheduled', 'manual', 'retry')),
  constraint source_crawl_runs_status_check
    check (status in ('queued', 'running', 'succeeded', 'partial', 'failed', 'abandoned')),
  constraint source_crawl_runs_attempt_check check (attempt between 0 and 3),
  constraint source_crawl_runs_counts_check check (
    processed_count >= 0
    and created_count >= 0
    and updated_count >= 0
    and failed_count >= 0
  )
);

create unique index source_crawl_runs_run_key_unique
  on source_crawl_runs(run_key);

create unique index source_crawl_runs_one_running_per_source_unique
  on source_crawl_runs(source_url_id)
  where status = 'running';

create index source_crawl_runs_brand_created_idx
  on source_crawl_runs(brand_id, created_at desc);

create index source_crawl_runs_retry_due_idx
  on source_crawl_runs(next_retry_at)
  where status in ('failed', 'partial') and next_retry_at is not null;

create trigger source_crawl_runs_set_updated_at
  before update on source_crawl_runs
  for each row execute function set_updated_at();
