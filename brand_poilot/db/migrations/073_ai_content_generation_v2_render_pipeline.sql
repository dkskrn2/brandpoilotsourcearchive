begin;

create table ai_content_proposal_research_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  brand_id uuid not null,
  batch_id uuid not null,
  evidence_json jsonb not null,
  created_at timestamptz not null default now(),
  constraint ai_content_proposal_research_snapshots_evidence_object_check check (
    jsonb_typeof(evidence_json) = 'object'
  ),
  constraint ai_content_proposal_research_snapshots_batch_unique unique (batch_id),
  constraint ai_content_proposal_research_snapshots_batch_fk
    foreign key (batch_id, workspace_id, brand_id)
    references ai_content_proposal_batches(id, workspace_id, brand_id)
    on delete restrict
);

create table ai_content_generation_input_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  brand_id uuid not null,
  generation_id uuid not null,
  input_json jsonb not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint ai_content_generation_input_snapshots_input_object_check check (
    jsonb_typeof(input_json) = 'object'
  ),
  constraint ai_content_generation_input_snapshots_generation_unique unique (generation_id),
  constraint ai_content_generation_input_snapshots_generation_fk
    foreign key (generation_id, workspace_id, brand_id)
    references ai_content_generations(id, workspace_id, brand_id)
    on delete restrict
);

create table ai_content_output_research_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  brand_id uuid not null,
  generation_id uuid not null,
  output_id uuid not null,
  evidence_json jsonb not null,
  created_at timestamptz not null default now(),
  constraint ai_content_output_research_snapshots_evidence_object_check check (
    jsonb_typeof(evidence_json) = 'object'
  ),
  constraint ai_content_output_research_snapshots_output_unique unique (output_id),
  constraint ai_content_output_research_snapshots_output_fk
    foreign key (output_id, generation_id, workspace_id, brand_id)
    references ai_content_generation_outputs(id, generation_id, workspace_id, brand_id)
    on delete restrict
);

create function ai_content_v2_reject_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception using errcode = '55000', message = 'ai_content_v2_snapshot_immutable';
end;
$$;

create trigger ai_content_v2_proposal_research_snapshots_immutable
before update or delete on ai_content_proposal_research_snapshots
for each row execute function ai_content_v2_reject_snapshot_mutation();

create trigger ai_content_v2_generation_input_snapshots_immutable
before update or delete on ai_content_generation_input_snapshots
for each row execute function ai_content_v2_reject_snapshot_mutation();

create trigger ai_content_v2_output_research_snapshots_immutable
before update or delete on ai_content_output_research_snapshots
for each row execute function ai_content_v2_reject_snapshot_mutation();

create table ai_content_generation_render_jobs (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null,
  output_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  job_kind text not null,
  asset_index integer null,
  status text not null default 'queued',
  payload_json jsonb not null,
  result_json jsonb null,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  available_at timestamptz not null default now(),
  worker_id text null,
  lease_token uuid null,
  lease_expires_at timestamptz null,
  error_code text null,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint ai_content_generation_render_jobs_kind_check check (
    job_kind in ('image_asset', 'package_finalize')
  ),
  constraint ai_content_generation_render_jobs_status_check check (
    status in ('queued', 'processing', 'succeeded', 'failed')
  ),
  constraint ai_content_generation_render_jobs_payload_object_check check (
    jsonb_typeof(payload_json) = 'object'
  ),
  constraint ai_content_generation_render_jobs_result_object_check check (
    result_json is null
    or jsonb_typeof(result_json) = 'object'
  ),
  constraint ai_content_generation_render_jobs_attempts_check check (
    attempt_count >= 0
    and max_attempts > 0
    and attempt_count <= max_attempts
  ),
  constraint ai_content_generation_render_jobs_asset_index_check check (
    (
      job_kind = 'image_asset'
      and asset_index is not null
      and asset_index between 1 and 5
    )
    or (job_kind = 'package_finalize' and asset_index is null)
  ),
  constraint ai_content_generation_render_jobs_output_fk
    foreign key (output_id, generation_id, workspace_id, brand_id)
    references ai_content_generation_outputs(id, generation_id, workspace_id, brand_id)
    on delete cascade
);

create unique index ai_content_generation_render_jobs_image_asset_unique
  on ai_content_generation_render_jobs (output_id, asset_index)
  where job_kind = 'image_asset';

create unique index ai_content_generation_render_jobs_package_finalize_unique
  on ai_content_generation_render_jobs (output_id)
  where job_kind = 'package_finalize';

create function ai_content_v2_freeze_batch_input_snapshot()
returns trigger
language plpgsql
as $$
begin
  if old.input_snapshot_json is not null
    and new.input_snapshot_json is distinct from old.input_snapshot_json
  then
    raise exception using
      errcode = '55000',
      message = 'ai_content_v2_batch_input_snapshot_immutable';
  end if;
  return new;
end;
$$;

create function ai_content_v2_freeze_output_plan()
returns trigger
language plpgsql
as $$
begin
  if old.plan_json is not null
    and new.plan_json is distinct from old.plan_json
  then
    raise exception using
      errcode = '55000',
      message = 'ai_content_v2_output_plan_immutable';
  end if;
  return new;
end;
$$;

alter table ai_content_proposal_batches
  add column input_snapshot_json jsonb null,
  add constraint ai_content_proposal_batches_input_snapshot_json_object_check check (
    input_snapshot_json is null
    or jsonb_typeof(input_snapshot_json) = 'object'
  );

alter table ai_content_generation_outputs
  add column plan_json jsonb null,
  add constraint ai_content_generation_outputs_plan_json_object_check check (
    plan_json is null
    or jsonb_typeof(plan_json) = 'object'
  );

alter table ai_content_generations
  drop constraint ai_content_generations_output_format_check,
  add constraint ai_content_generations_output_format_check check (
    output_format is null
    or output_format in (
      'card_news',
      'blog',
      'single_image',
      'channel_text',
      'reel',
      'marketing_content'
    )
  );

alter table ai_content_generation_attachments
  drop constraint ai_content_generation_attachments_role_check,
  add constraint ai_content_generation_attachments_role_check check (
    role in (
      'product',
      'person',
      'scale',
      'visual_reference',
      'document',
      'product_image',
      'supporting_image'
    )
  );

alter table ai_content_attachment_upload_sessions
  drop constraint ai_content_attachment_upload_sessions_role_check,
  add constraint ai_content_attachment_upload_sessions_role_check check (
    role in (
      'product',
      'person',
      'scale',
      'visual_reference',
      'document',
      'product_image',
      'supporting_image'
    )
  );

create trigger ai_content_v2_batch_input_snapshot_immutable
before update of input_snapshot_json on ai_content_proposal_batches
for each row execute function ai_content_v2_freeze_batch_input_snapshot();

create trigger ai_content_v2_output_plan_immutable
before update of plan_json on ai_content_generation_outputs
for each row execute function ai_content_v2_freeze_output_plan();

commit;
