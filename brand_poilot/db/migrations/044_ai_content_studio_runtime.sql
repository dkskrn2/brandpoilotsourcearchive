begin;

create table ai_content_generations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  type text not null,
  title text not null,
  status text not null default 'draft',
  current_stage text null,
  draft_json jsonb not null default '{}'::jsonb,
  analysis_json jsonb not null default '{}'::jsonb,
  analysis_idempotency_key text not null,
  generation_idempotency_key text null,
  error_code text null,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint ai_content_generations_type_check check (
    type in ('card_news', 'blog', 'marketing')
  ),
  constraint ai_content_generations_status_check check (
    status in (
      'draft',
      'analyzing',
      'analysis_ready',
      'queued',
      'planning',
      'generating',
      'completed',
      'partial_failed',
      'failed'
    )
  ),
  constraint ai_content_generations_draft_json_object_check check (
    jsonb_typeof(draft_json) = 'object'
  ),
  constraint ai_content_generations_analysis_json_object_check check (
    jsonb_typeof(analysis_json) = 'object'
  ),
  constraint ai_content_generations_brand_ownership_fk
    foreign key (brand_id, workspace_id)
    references brands(id, workspace_id)
    on delete cascade,
  constraint ai_content_generations_brand_analysis_key_unique
    unique (brand_id, analysis_idempotency_key),
  constraint ai_content_generations_tenant_identity_unique
    unique (id, workspace_id, brand_id)
);

create unique index uq_ai_content_generation_key
  on ai_content_generations (brand_id, generation_idempotency_key)
  where generation_idempotency_key is not null;

create table ai_content_generation_outputs (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  output_index integer not null,
  title text null,
  status text not null default 'queued',
  content_json jsonb not null default '{}'::jsonb,
  artifact_manifest_json jsonb not null default '{}'::jsonb,
  manifest_url text null,
  failure_code text null,
  failure_message text null,
  downloaded_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint ai_content_generation_outputs_index_check check (output_index > 0),
  constraint ai_content_generation_outputs_status_check check (
    status in ('queued', 'planning', 'generating', 'completed', 'failed')
  ),
  constraint ai_content_generation_outputs_content_json_object_check check (
    jsonb_typeof(content_json) = 'object'
  ),
  constraint ai_content_generation_outputs_artifact_manifest_json_object_check check (
    jsonb_typeof(artifact_manifest_json) = 'object'
  ),
  constraint ai_content_generation_outputs_generation_ownership_fk
    foreign key (generation_id, workspace_id, brand_id)
    references ai_content_generations(id, workspace_id, brand_id)
    on delete cascade,
  constraint ai_content_generation_outputs_generation_index_unique
    unique (generation_id, output_index),
  constraint ai_content_generation_outputs_tenant_identity_unique
    unique (id, workspace_id, brand_id),
  constraint ai_content_generation_outputs_generation_tenant_identity_unique
    unique (id, generation_id, workspace_id, brand_id)
);

create table ai_content_generation_attachments (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  role text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  checksum text not null,
  storage_url text not null,
  storage_path text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint ai_content_generation_attachments_role_check check (
    role in ('product', 'person', 'scale', 'visual_reference', 'document')
  ),
  constraint ai_content_generation_attachments_size_check check (size_bytes > 0),
  constraint ai_content_generation_attachments_generation_ownership_fk
    foreign key (generation_id, workspace_id, brand_id)
    references ai_content_generations(id, workspace_id, brand_id)
    on delete cascade,
  constraint ai_content_generation_attachments_path_unique
    unique (generation_id, storage_path)
);

create table ai_content_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null,
  output_id uuid null,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  job_type text not null,
  content_type text not null,
  status text not null default 'queued',
  payload_json jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  available_at timestamptz not null default now(),
  worker_id text null,
  lease_token text null,
  lease_expires_at timestamptz null,
  last_heartbeat_at timestamptz null,
  error_code text null,
  error_message text null,
  skill_version text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint ai_content_generation_jobs_type_check check (
    job_type in ('analyze', 'generate')
  ),
  constraint ai_content_generation_jobs_content_type_check check (
    content_type in ('card_news', 'blog', 'marketing')
  ),
  constraint ai_content_generation_jobs_status_check check (
    status in ('queued', 'processing', 'succeeded', 'failed')
  ),
  constraint ai_content_generation_jobs_attempts_check check (
    attempt_count >= 0 and max_attempts > 0 and attempt_count <= max_attempts
  ),
  constraint ai_content_generation_jobs_payload_json_object_check check (
    jsonb_typeof(payload_json) = 'object'
  ),
  constraint ai_content_generation_jobs_output_check check (
    (job_type = 'analyze' and output_id is null)
    or (job_type = 'generate' and output_id is not null)
  ),
  constraint ai_content_generation_jobs_generation_ownership_fk
    foreign key (generation_id, workspace_id, brand_id)
    references ai_content_generations(id, workspace_id, brand_id)
    on delete cascade,
  constraint ai_content_generation_jobs_output_ownership_fk
    foreign key (output_id, generation_id, workspace_id, brand_id)
    references ai_content_generation_outputs(id, generation_id, workspace_id, brand_id)
    on delete cascade
);

create unique index uq_ai_content_active_analyze_job
  on ai_content_generation_jobs (generation_id)
  where job_type = 'analyze' and status in ('queued', 'processing');

create unique index uq_ai_content_active_generate_job
  on ai_content_generation_jobs (output_id)
  where job_type = 'generate' and status in ('queued', 'processing');

create index ai_content_generation_jobs_claim_idx
  on ai_content_generation_jobs (content_type, status, available_at, created_at);

create table ai_content_generation_references (
  generation_id uuid not null,
  reference_id uuid not null,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  position integer not null,
  reference_snapshot_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ai_content_generation_references_position_check check (position > 0),
  constraint ai_content_generation_references_snapshot_json_object_check check (
    jsonb_typeof(reference_snapshot_json) = 'object'
  ),
  constraint ai_content_generation_references_generation_ownership_fk
    foreign key (generation_id, workspace_id, brand_id)
    references ai_content_generations(id, workspace_id, brand_id)
    on delete cascade,
  constraint ai_content_generation_references_pkey
    primary key (generation_id, reference_id),
  constraint ai_content_generation_references_generation_position_unique
    unique (generation_id, position)
);

create table ai_content_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  generation_id uuid not null,
  output_id uuid null,
  usage_type text not null,
  quantity integer not null,
  usage_date date not null default current_date,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint ai_content_usage_ledger_type_check check (
    usage_type in ('generation', 'new_download', 'reversal')
  ),
  constraint ai_content_usage_ledger_quantity_check check (
    quantity != 0
    and (
      (usage_type = 'reversal' and quantity < 0)
      or (usage_type != 'reversal' and quantity > 0)
    )
  ),
  constraint ai_content_usage_ledger_generation_ownership_fk
    foreign key (generation_id, workspace_id, brand_id)
    references ai_content_generations(id, workspace_id, brand_id)
    on delete cascade,
  constraint ai_content_usage_ledger_output_ownership_fk
    foreign key (output_id, generation_id, workspace_id, brand_id)
    references ai_content_generation_outputs(id, generation_id, workspace_id, brand_id)
    on delete cascade
);

create unique index ai_content_usage_ledger_idempotency_unique
  on ai_content_usage_ledger (brand_id, idempotency_key);

create table brand_audiences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  name text not null,
  situation text not null,
  problem text not null,
  motivation text not null,
  use_count integer not null default 0,
  last_used_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_audiences_use_count_check check (use_count >= 0),
  constraint brand_audiences_brand_ownership_fk
    foreign key (brand_id, workspace_id)
    references brands(id, workspace_id)
    on delete cascade,
  constraint brand_audiences_brand_name_unique unique (brand_id, name)
);

create table brand_appeals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  title text not null,
  description text not null,
  evidence_type text not null,
  use_count integer not null default 0,
  last_used_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_appeals_evidence_type_check check (
    evidence_type in ('fact', 'benefit', 'price', 'trust', 'emotion')
  ),
  constraint brand_appeals_use_count_check check (use_count >= 0),
  constraint brand_appeals_brand_ownership_fk
    foreign key (brand_id, workspace_id)
    references brands(id, workspace_id)
    on delete cascade,
  constraint brand_appeals_brand_title_unique unique (brand_id, title)
);

alter table channel_outputs
  add column ai_content_generation_output_id uuid null;

alter table channel_outputs
  add constraint channel_outputs_ai_content_generation_output_ownership_fk
    foreign key (ai_content_generation_output_id, workspace_id, brand_id)
    references ai_content_generation_outputs(id, workspace_id, brand_id)
    on delete restrict;

create unique index uq_channel_outputs_ai_content_generation_output
  on channel_outputs (ai_content_generation_output_id)
  where ai_content_generation_output_id is not null;

create trigger ai_content_generations_set_updated_at
before update on ai_content_generations
for each row execute function set_updated_at();

create trigger ai_content_generation_outputs_set_updated_at
before update on ai_content_generation_outputs
for each row execute function set_updated_at();

create trigger ai_content_generation_jobs_set_updated_at
before update on ai_content_generation_jobs
for each row execute function set_updated_at();

create trigger brand_audiences_set_updated_at
before update on brand_audiences
for each row execute function set_updated_at();

create trigger brand_appeals_set_updated_at
before update on brand_appeals
for each row execute function set_updated_at();

commit;
