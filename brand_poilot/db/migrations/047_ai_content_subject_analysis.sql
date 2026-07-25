begin;

create table if not exists ai_content_subject_analyses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  subject_type text not null,
  source_url text not null,
  normalized_url text not null,
  input_json jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  facts_json jsonb not null default '[]'::jsonb,
  structured_data_json jsonb not null default '{}'::jsonb,
  research_json jsonb not null default '{}'::jsonb,
  targets_json jsonb not null default '[]'::jsonb,
  appeals_json jsonb not null default '{}'::jsonb,
  selected_image_id uuid null,
  analysis_version integer not null default 1,
  idempotency_key text not null,
  leased_by text null,
  lease_token uuid null,
  lease_expires_at timestamptz null,
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  error_code text null,
  error_message text null,
  superseded_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint ai_content_subject_analyses_subject_type_check check (
    subject_type in ('product', 'service')
  ),
  constraint ai_content_subject_analyses_status_check check (
    status in ('queued', 'extracting', 'researching', 'ready', 'partial', 'failed')
  ),
  constraint ai_content_subject_analyses_input_json_object_check check (
    jsonb_typeof(input_json) = 'object'
  ),
  constraint ai_content_subject_analyses_facts_json_array_check check (
    jsonb_typeof(facts_json) = 'array'
  ),
  constraint ai_content_subject_analyses_structured_data_json_object_check check (
    jsonb_typeof(structured_data_json) = 'object'
  ),
  constraint ai_content_subject_analyses_research_json_object_check check (
    jsonb_typeof(research_json) = 'object'
  ),
  constraint ai_content_subject_analyses_targets_json_array_check check (
    jsonb_typeof(targets_json) = 'array'
  ),
  constraint ai_content_subject_analyses_appeals_json_object_check check (
    jsonb_typeof(appeals_json) = 'object'
  ),
  constraint ai_content_subject_analyses_version_check check (
    analysis_version > 0
  ),
  constraint ai_content_subject_analyses_attempt_count_check check (
    attempt_count >= 0
  ),
  constraint ai_content_subject_analyses_lease_check check (
    (leased_by is null and lease_token is null and lease_expires_at is null)
    or
    (leased_by is not null and lease_token is not null and lease_expires_at is not null)
  ),
  constraint ai_content_subject_analyses_brand_ownership_fk
    foreign key (brand_id, workspace_id)
    references brands(id, workspace_id)
    on delete cascade,
  constraint ai_content_subject_analyses_brand_idempotency_key_unique
    unique (brand_id, idempotency_key),
  constraint ai_content_subject_analyses_version_unique
    unique (brand_id, subject_type, normalized_url, analysis_version),
  constraint ai_content_subject_analyses_tenant_identity_unique
    unique (id, workspace_id, brand_id)
);

create table if not exists ai_content_subject_images (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  source_url text not null,
  storage_url text not null,
  storage_path text not null,
  width integer null,
  height integer null,
  mime_type text not null,
  alt_text text null,
  role text not null,
  selection_score numeric not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint ai_content_subject_images_role_check check (
    role in ('product', 'service', 'logo', 'detail', 'unknown')
  ),
  constraint ai_content_subject_images_width_check check (
    width is null or width > 0
  ),
  constraint ai_content_subject_images_height_check check (
    height is null or height > 0
  ),
  constraint ai_content_subject_images_brand_ownership_fk
    foreign key (brand_id, workspace_id)
    references brands(id, workspace_id)
    on delete cascade,
  constraint ai_content_subject_images_analysis_ownership_fk
    foreign key (analysis_id, workspace_id, brand_id)
    references ai_content_subject_analyses(id, workspace_id, brand_id)
    on delete cascade,
  constraint ai_content_subject_images_analysis_source_unique
    unique (analysis_id, source_url),
  constraint ai_content_subject_images_tenant_identity_unique
    unique (id, workspace_id, brand_id),
  constraint ai_content_subject_images_selection_identity_unique
    unique (id, analysis_id, workspace_id, brand_id)
);

alter table ai_content_subject_analyses
  drop constraint if exists ai_content_subject_selected_image_fk;

alter table ai_content_subject_analyses
  add constraint ai_content_subject_selected_image_fk
  foreign key (selected_image_id, id, workspace_id, brand_id)
  references ai_content_subject_images(id, analysis_id, workspace_id, brand_id)
  on delete set null (selected_image_id);

create unique index if not exists ai_content_subject_active_cache_uq
  on ai_content_subject_analyses (brand_id, subject_type, normalized_url)
  where superseded_at is null;

create index if not exists ai_content_subject_analyses_workspace_idx
  on ai_content_subject_analyses (workspace_id);

create index if not exists ai_content_subject_claim_idx
  on ai_content_subject_analyses (available_at, created_at)
  where status in ('queued', 'extracting', 'researching');

create index if not exists ai_content_subject_images_workspace_idx
  on ai_content_subject_images (workspace_id);

create index if not exists ai_content_subject_images_brand_workspace_idx
  on ai_content_subject_images (brand_id, workspace_id);

create index if not exists ai_content_subject_images_analysis_ownership_idx
  on ai_content_subject_images (analysis_id, workspace_id, brand_id);

alter table ai_content_generations
  add column if not exists subject_analysis_snapshot jsonb null;

alter table ai_content_generations
  drop constraint if exists ai_content_generations_subject_analysis_snapshot_object_check;

alter table ai_content_generations
  add constraint ai_content_generations_subject_analysis_snapshot_object_check
  check (
    subject_analysis_snapshot is null
    or jsonb_typeof(subject_analysis_snapshot) = 'object'
  );

drop trigger if exists ai_content_subject_analyses_set_updated_at
  on ai_content_subject_analyses;

create trigger ai_content_subject_analyses_set_updated_at
before update on ai_content_subject_analyses
for each row execute function set_updated_at();

commit;
