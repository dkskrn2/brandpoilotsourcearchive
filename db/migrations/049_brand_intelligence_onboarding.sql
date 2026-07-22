begin;

create table if not exists brand_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  status text not null default 'queued',
  input_json jsonb not null default '{}'::jsonb,
  evidence_json jsonb not null default '[]'::jsonb,
  result_json jsonb null,
  edited_result_json jsonb null,
  idempotency_key text not null,
  is_active boolean not null default false,
  leased_by text null,
  lease_token uuid null,
  lease_expires_at timestamptz null,
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  error_code text null,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  confirmed_at timestamptz null,
  constraint brand_analysis_runs_status_check check (
    status in ('queued', 'extracting', 'analyzing', 'review_ready', 'confirmed', 'failed')
  ),
  constraint brand_analysis_runs_input_object_check check (jsonb_typeof(input_json) = 'object'),
  constraint brand_analysis_runs_evidence_array_check check (jsonb_typeof(evidence_json) = 'array'),
  constraint brand_analysis_runs_result_object_check check (
    result_json is null or jsonb_typeof(result_json) = 'object'
  ),
  constraint brand_analysis_runs_edited_result_object_check check (
    edited_result_json is null or jsonb_typeof(edited_result_json) = 'object'
  ),
  constraint brand_analysis_runs_attempt_count_check check (attempt_count >= 0),
  constraint brand_analysis_runs_active_confirmed_check check (
    not is_active or status = 'confirmed'
  ),
  constraint brand_analysis_runs_lease_check check (
    (leased_by is null and lease_token is null and lease_expires_at is null)
    or (leased_by is not null and lease_token is not null and lease_expires_at is not null)
  ),
  constraint brand_analysis_runs_brand_ownership_fk
    foreign key (brand_id, workspace_id)
    references brands(id, workspace_id)
    on delete cascade,
  constraint brand_analysis_runs_brand_idempotency_unique unique (brand_id, idempotency_key),
  constraint brand_analysis_runs_tenant_identity_unique unique (id, workspace_id, brand_id)
);

create table if not exists brand_analysis_uploads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  analysis_id uuid null,
  file_name text not null,
  mime_type text not null,
  byte_size bigint not null,
  checksum text not null,
  storage_path text not null,
  storage_url text not null,
  parsing_status text not null default 'uploaded',
  error_code text null,
  created_at timestamptz not null default now(),
  parsed_at timestamptz null,
  cleanup_after timestamptz null,
  deleted_at timestamptz null,
  constraint brand_analysis_uploads_size_check check (byte_size > 0 and byte_size <= 10485760),
  constraint brand_analysis_uploads_parsing_status_check check (
    parsing_status in ('uploaded', 'parsing', 'parsed', 'failed')
  ),
  constraint brand_analysis_uploads_brand_ownership_fk
    foreign key (brand_id, workspace_id)
    references brands(id, workspace_id)
    on delete cascade,
  constraint brand_analysis_uploads_analysis_ownership_fk
    foreign key (analysis_id, workspace_id, brand_id)
    references brand_analysis_runs(id, workspace_id, brand_id)
    on delete cascade,
  constraint brand_analysis_uploads_storage_path_unique unique (storage_path),
  constraint brand_analysis_uploads_tenant_identity_unique unique (id, workspace_id, brand_id)
);

alter table brand_profiles
  add column if not exists active_brand_analysis_id uuid null;

alter table brand_profiles
  drop constraint if exists brand_profiles_active_brand_analysis_fk;

alter table brand_profiles
  add constraint brand_profiles_active_brand_analysis_fk
  foreign key (active_brand_analysis_id, workspace_id, brand_id)
  references brand_analysis_runs(id, workspace_id, brand_id)
  deferrable initially deferred;

create unique index if not exists brand_analysis_runs_one_active_per_brand_uq
  on brand_analysis_runs(brand_id)
  where is_active;

create index if not exists brand_analysis_runs_claim_idx
  on brand_analysis_runs(available_at, created_at)
  where status in ('queued', 'extracting', 'analyzing');

create index if not exists brand_analysis_runs_workspace_brand_idx
  on brand_analysis_runs(workspace_id, brand_id, created_at desc);

create index if not exists brand_analysis_uploads_analysis_idx
  on brand_analysis_uploads(analysis_id, workspace_id, brand_id);

drop trigger if exists brand_analysis_runs_set_updated_at on brand_analysis_runs;
create trigger brand_analysis_runs_set_updated_at
before update on brand_analysis_runs
for each row execute function set_updated_at();

commit;
