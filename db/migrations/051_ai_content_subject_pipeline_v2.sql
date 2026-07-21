begin;

alter table ai_content_subject_analyses
  add column if not exists generation_id uuid null,
  add column if not exists contract_version text not null default 'subject-analysis.v1',
  add column if not exists attachment_ids_json jsonb not null default '[]'::jsonb,
  add column if not exists analysis_result_json jsonb not null default '{}'::jsonb;

alter table ai_content_subject_analyses
  alter column source_url drop not null,
  alter column normalized_url drop not null;

alter table ai_content_subject_analyses
  drop constraint if exists ai_content_subject_generation_ownership_fk,
  drop constraint if exists ai_content_subject_analyses_contract_version_check,
  drop constraint if exists ai_content_subject_analyses_attachment_ids_json_array_check,
  drop constraint if exists ai_content_subject_analyses_analysis_result_json_object_check,
  drop constraint if exists ai_content_subject_analyses_status_check,
  drop constraint if exists ai_content_subject_analyses_version_unique;

alter table ai_content_subject_analyses
  add constraint ai_content_subject_generation_ownership_fk
    foreign key (generation_id, workspace_id, brand_id)
    references ai_content_generations(id, workspace_id, brand_id)
    on delete cascade,
  add constraint ai_content_subject_analyses_contract_version_check check (
    contract_version in ('subject-analysis.v1', 'subject-analysis.v2')
  ),
  add constraint ai_content_subject_analyses_attachment_ids_json_array_check check (
    jsonb_typeof(attachment_ids_json) = 'array'
  ),
  add constraint ai_content_subject_analyses_analysis_result_json_object_check check (
    jsonb_typeof(analysis_result_json) = 'object'
  ),
  add constraint ai_content_subject_analyses_status_check check (
    status in (
      'queued',
      'extracting',
      'researching',
      'analyzing',
      'generating_appeals',
      'ready',
      'partial',
      'failed'
    )
  );

drop index if exists ai_content_subject_active_cache_uq;

create unique index ai_content_subject_legacy_active_cache_uq
  on ai_content_subject_analyses (brand_id, subject_type, normalized_url)
  where generation_id is null and superseded_at is null;

create unique index ai_content_subject_legacy_version_uq
  on ai_content_subject_analyses (
    brand_id,
    subject_type,
    normalized_url,
    analysis_version
  )
  where generation_id is null;

create unique index ai_content_subject_generation_active_uq
  on ai_content_subject_analyses (generation_id)
  where generation_id is not null and superseded_at is null;

create index ai_content_subject_generation_idx
  on ai_content_subject_analyses (generation_id)
  where generation_id is not null;

drop index if exists ai_content_subject_claim_idx;

create index ai_content_subject_claim_idx
  on ai_content_subject_analyses (available_at, created_at)
  where status in (
    'queued',
    'extracting',
    'researching',
    'analyzing',
    'generating_appeals'
  );

commit;
