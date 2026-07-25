create table automation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  run_type text not null,
  run_key text not null,
  scheduled_date date not null,
  status text not null default 'running',
  result_json jsonb not null default '{}'::jsonb,
  error_message text null,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint automation_runs_type_check check (run_type in ('daily_generation')),
  constraint automation_runs_status_check check (status in ('running', 'succeeded', 'partial', 'failed')),
  constraint automation_runs_result_object_check check (jsonb_typeof(result_json) = 'object'),
  constraint automation_runs_run_key_unique unique (run_key)
);

create index automation_runs_brand_date_idx
  on automation_runs(brand_id, scheduled_date desc);
