begin;

alter table brands
  add column if not exists company_name_state text null,
  add column if not exists company_name_confirmed_at timestamptz null;

alter table brands
  drop constraint if exists brands_company_name_state_check;

alter table brands
  add constraint brands_company_name_state_check
  check (company_name_state in ('provisional', 'legacy_unknown', 'confirmed'));

update brands b
set company_name_state = case
      when b.name in ('내 브랜드', 'Brand', '모종') then 'provisional'
      when exists (
        select 1
        from brand_profiles p
        join brand_analysis_runs r on r.id = p.active_brand_analysis_id
        where p.brand_id = b.id
          and p.workspace_id = b.workspace_id
          and r.status = 'confirmed'
      ) then 'confirmed'
      else 'legacy_unknown'
    end,
    company_name_confirmed_at = case
      when b.name not in ('내 브랜드', 'Brand', '모종')
       and exists (
         select 1
         from brand_profiles p
         join brand_analysis_runs r on r.id = p.active_brand_analysis_id
         where p.brand_id = b.id
           and p.workspace_id = b.workspace_id
           and r.status = 'confirmed'
       ) then coalesce(b.company_name_confirmed_at, now())
      else b.company_name_confirmed_at
    end
where b.company_name_state is null;

alter table brands
  alter column company_name_state set default 'provisional',
  alter column company_name_state set not null;

alter table brand_analysis_runs
  add column if not exists pipeline_version integer not null default 1,
  add column if not exists contract_version text not null default 'brand-intelligence-result.v1',
  add column if not exists current_stage text null,
  add column if not exists state_version integer not null default 0,
  add column if not exists active_started_at timestamptz null,
  add column if not exists deadline_at timestamptz null,
  add column if not exists queue_expires_at timestamptz null,
  add column if not exists cancel_requested_at timestamptz null,
  add column if not exists purged_at timestamptz null,
  add column if not exists tombstone_expires_at timestamptz null,
  add column if not exists retention_expires_at timestamptz null,
  add column if not exists upload_expires_at timestamptz null,
  add column if not exists superseded_by_run_id uuid null references brand_analysis_runs(id) on delete set null,
  add column if not exists start_idempotency_key text null,
  add column if not exists start_request_hash text null,
  add column if not exists retry_idempotency_key text null,
  add column if not exists retry_request_hash text null,
  add column if not exists completion_idempotency_key text null,
  add column if not exists completion_request_hash text null,
  add column if not exists confirm_idempotency_key text null,
  add column if not exists confirm_request_hash text null,
  add column if not exists logical_call_count integer not null default 0,
  add column if not exists retry_call_count integer not null default 0,
  add column if not exists physical_cli_count integer not null default 0,
  add column if not exists selected_page_count integer not null default 0,
  add column if not exists successful_page_count integer not null default 0,
  add column if not exists failed_page_count integer not null default 0,
  add column if not exists required_page_count integer not null default 0,
  add column if not exists external_page_count integer not null default 0,
  add column if not exists offering_count integer not null default 0,
  add column if not exists completed_cli_stage_count integer not null default 0,
  add column if not exists total_cli_stage_count integer not null default 8,
  add column if not exists cleanup_status text not null default 'none',
  add column if not exists request_hash text null;

alter table brand_analysis_runs
  drop constraint if exists brand_analysis_runs_status_check,
  drop constraint if exists brand_analysis_runs_pipeline_version_check,
  drop constraint if exists brand_analysis_runs_call_count_check,
  drop constraint if exists brand_analysis_runs_page_count_check;

alter table brand_analysis_runs
  add constraint brand_analysis_runs_status_check check (
    status in (
      'queued', 'extracting', 'analyzing',
      'accepting_uploads', 'waiting_for_resource', 'running', 'finalizing',
      'review_ready', 'confirmed', 'failed', 'cancel_requested', 'purging', 'cancelled'
    )
  ),
  add constraint brand_analysis_runs_pipeline_version_check
    check (pipeline_version in (1, 2)),
  add constraint brand_analysis_runs_call_count_check check (
    logical_call_count between 0 and 8
    and retry_call_count between 0 and 2
    and physical_cli_count between 0 and 10
  ),
  add constraint brand_analysis_runs_page_count_check check (
    selected_page_count between 0 and 20
    and successful_page_count between 0 and selected_page_count
    and failed_page_count between 0 and selected_page_count
    and successful_page_count + failed_page_count <= selected_page_count
    and required_page_count between 0 and 10
    and external_page_count between 0 and 10
    and offering_count between 0 and 5
    and completed_cli_stage_count between 0 and total_cli_stage_count
    and total_cli_stage_count between 0 and 8
  );

create table if not exists brand_analysis_stage_runs (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references brand_analysis_runs(id) on delete cascade,
  stage_code text not null,
  stage_instance_key text not null,
  attempt integer not null default 1,
  batch_index integer null,
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  duration_ms integer null,
  input_count integer not null default 0,
  success_count integer not null default 0,
  failed_count integer not null default 0,
  error_code text null,
  error_fingerprint text null,
  created_at timestamptz not null default now(),
  unique (analysis_id, stage_instance_key),
  check (batch_index is null or batch_index between 0 and 3),
  check (attempt between 1 and 3),
  check (input_count >= 0 and success_count >= 0 and failed_count >= 0),
  check (status in ('running', 'succeeded', 'failed', 'cancelled'))
);

create table if not exists brand_offerings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  source_analysis_id uuid not null,
  offering_type text not null,
  name text not null,
  description text null,
  target_customer text null,
  benefit text null,
  price_text text null,
  purchase_url text null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_offerings_brand_ownership_fk
    foreign key (brand_id, workspace_id) references brands(id, workspace_id) on delete cascade,
  constraint brand_offerings_analysis_ownership_fk
    foreign key (source_analysis_id, workspace_id, brand_id)
    references brand_analysis_runs(id, workspace_id, brand_id) on delete cascade,
  constraint brand_offerings_type_check check (offering_type in ('product', 'service')),
  constraint brand_offerings_sort_order_check check (sort_order between 0 and 4),
  constraint brand_offerings_name_check check (char_length(btrim(name)) between 1 and 300),
  unique (source_analysis_id, sort_order)
);

create index if not exists brand_offerings_active_lookup_idx
  on brand_offerings(workspace_id, brand_id, sort_order);

create table if not exists brand_analysis_cli_calls (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references brand_analysis_runs(id) on delete cascade,
  stage_run_id uuid not null references brand_analysis_stage_runs(id) on delete cascade,
  logical_call_key text not null,
  logical_index integer not null,
  status text not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz null,
  unique (analysis_id, logical_call_key),
  unique (analysis_id, logical_index),
  check (logical_index between 1 and 8),
  check (status in ('pending', 'running', 'succeeded', 'failed', 'cancelled'))
);

create table if not exists brand_analysis_cli_attempts (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references brand_analysis_cli_calls(id) on delete cascade,
  physical_attempt integer not null,
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  duration_ms integer null,
  error_code text null,
  error_fingerprint text null,
  unique (call_id, physical_attempt),
  check (physical_attempt between 1 and 3),
  check (status in ('running', 'succeeded', 'failed', 'cancelled'))
);

alter table brand_analysis_uploads
  alter column storage_path drop not null,
  alter column storage_url drop not null,
  add column if not exists upload_status text not null default 'intent',
  add column if not exists upload_attempt_count integer not null default 0,
  add column if not exists upload_expires_at timestamptz null,
  add column if not exists upload_completed_at timestamptz null,
  add column if not exists cleanup_status text not null default 'none';

update brand_analysis_uploads
set upload_status = 'uploaded',
    upload_completed_at = coalesce(upload_completed_at, created_at)
where storage_path is not null and storage_url is not null and deleted_at is null;

update brand_analysis_uploads
set upload_status = 'deleted',
    cleanup_status = 'completed'
where deleted_at is not null;

alter table brand_analysis_uploads
  drop constraint if exists brand_analysis_uploads_upload_status_check,
  drop constraint if exists brand_analysis_uploads_cleanup_status_check,
  drop constraint if exists brand_analysis_uploads_upload_attempt_count_check,
  drop constraint if exists brand_analysis_uploads_state_fields_check,
  drop constraint if exists brand_analysis_uploads_cleanup_fields_check;

alter table brand_analysis_uploads
  add constraint brand_analysis_uploads_upload_status_check check (
    upload_status in ('intent', 'uploading', 'uploaded', 'failed', 'delete_pending', 'deleted')
  ),
  add constraint brand_analysis_uploads_cleanup_status_check check (
    cleanup_status in ('none', 'pending', 'deleting', 'failed', 'completed')
  ),
  add constraint brand_analysis_uploads_upload_attempt_count_check check (
    upload_attempt_count between 0 and 3
  ),
  add constraint brand_analysis_uploads_state_fields_check check (
    (upload_status in ('intent', 'failed')
      and storage_path is null and storage_url is null and upload_completed_at is null)
    or
    (upload_status = 'uploading'
      and storage_path is not null and storage_url is null and upload_completed_at is null)
    or
    (upload_status in ('uploaded', 'delete_pending')
      and storage_path is not null and storage_url is not null and upload_completed_at is not null)
    or
    (upload_status = 'deleted' and deleted_at is not null)
  ),
  add constraint brand_analysis_uploads_cleanup_fields_check check (
    cleanup_status <> 'completed' or deleted_at is not null
  );

create table if not exists brand_analysis_upload_attempts (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references brand_analysis_uploads(id) on delete cascade,
  analysis_id uuid not null references brand_analysis_runs(id) on delete cascade,
  attempt_number integer not null,
  storage_path text not null,
  storage_url text null,
  status text not null,
  lease_expires_at timestamptz null,
  completed_at timestamptz null,
  deleted_at timestamptz null,
  error_code text null,
  created_at timestamptz not null default now(),
  unique (upload_id, attempt_number),
  check (attempt_number between 1 and 3),
  check (status in ('uploading', 'succeeded', 'failed', 'delete_pending', 'deleted')),
  check (
    (status = 'uploading' and lease_expires_at is not null and completed_at is null)
    or
    (status = 'succeeded' and lease_expires_at is null and storage_url is not null and completed_at is not null)
    or
    (status in ('failed', 'delete_pending') and lease_expires_at is null)
    or
    (status = 'deleted' and lease_expires_at is null and deleted_at is not null)
  )
);

create unique index if not exists brand_analysis_upload_attempts_one_stream_per_run_uq
  on brand_analysis_upload_attempts(analysis_id)
  where status = 'uploading';

update brand_analysis_runs
set status = 'failed',
    error_code = 'migration_superseded',
    completed_at = coalesce(completed_at, now())
where id in (
  select id from (
    select id,
      row_number() over (
        partition by brand_id
        order by created_at desc, id desc
      ) as position
    from brand_analysis_runs
    where status in (
      'queued', 'extracting', 'analyzing', 'accepting_uploads',
      'waiting_for_resource', 'running', 'finalizing', 'review_ready',
      'cancel_requested', 'purging'
    )
  ) ranked
  where position > 1
);

drop index if exists brand_analysis_runs_one_open_per_brand_uq;
create unique index brand_analysis_runs_one_open_per_brand_uq
  on brand_analysis_runs(brand_id)
  where status in (
    'queued', 'extracting', 'analyzing', 'accepting_uploads',
    'waiting_for_resource', 'running', 'finalizing', 'review_ready',
    'cancel_requested', 'purging'
  );

drop index if exists brand_analysis_runs_claim_idx;
create index brand_analysis_runs_claim_idx
  on brand_analysis_runs(available_at, created_at)
  where status in ('queued', 'extracting', 'analyzing', 'waiting_for_resource');

alter table worker_resource_leases
  drop constraint if exists worker_resource_leases_workload_check;

alter table worker_resource_leases
  add constraint worker_resource_leases_workload_check
  check (workload_type in ('dm', 'wiki', 'content', 'onboarding'));

commit;
