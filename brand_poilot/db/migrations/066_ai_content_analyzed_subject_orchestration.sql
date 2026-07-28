begin;

alter table ai_content_proposal_jobs
  add column if not exists completion_lease_owner text,
  add column if not exists completion_lease_token uuid;

alter table ai_content_generations
  add column if not exists created_by_user_id uuid,
  add column if not exists updated_by_user_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='ai_content_generations_created_actor_membership_fk'
  ) then
    alter table ai_content_generations
      add constraint ai_content_generations_created_actor_membership_fk
      foreign key (workspace_id,created_by_user_id)
      references workspace_members(workspace_id,user_id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname='ai_content_generations_updated_actor_membership_fk'
  ) then
    alter table ai_content_generations
      add constraint ai_content_generations_updated_actor_membership_fk
      foreign key (workspace_id,updated_by_user_id)
      references workspace_members(workspace_id,user_id) on delete restrict;
  end if;
end;
$$;

create or replace function ai_content_analyzed_subject_snapshot_is_valid(value jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce((
    jsonb_typeof(value) = 'object'
    and value->>'contractVersion' = 'analyzed-subject-snapshot.v1'
    and value ?& array[
      'snapshotId','analysisId','analysisVersion','analysisContractVersion',
      'subjectType','source','facts','research','analysisResult','selectedImages',
      'capturedAt'
    ]
    and value->>'snapshotId' ~* '^[0-9a-f-]{36}$'
    and value->>'analysisId' ~* '^[0-9a-f-]{36}$'
    and jsonb_typeof(value->'analysisVersion') = 'number'
    and (value->>'analysisVersion')::integer > 0
    and value->>'analysisContractVersion' in ('subject-analysis.v1','subject-analysis.v2')
    and value->>'subjectType' in ('product','service')
    and jsonb_typeof(value->'source') = 'object'
    and jsonb_typeof(value->'source'->'input') = 'object'
    and jsonb_typeof(value->'facts') = 'array'
    and jsonb_typeof(value->'research') = 'object'
    and jsonb_typeof(value->'analysisResult') = 'object'
    and jsonb_typeof(value->'selectedImages') = 'array'
    and value->>'capturedAt'
      ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
  ), false);
$$;

create table if not exists ai_content_analyzed_subject_snapshots (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete restrict,
  brand_id uuid not null,
  analysis_id uuid not null,
  snapshot_json jsonb not null
    check (ai_content_analyzed_subject_snapshot_is_valid(snapshot_json)),
  created_at timestamptz not null default now(),
  constraint ai_content_analyzed_subject_snapshots_analysis_fk
    foreign key (analysis_id,workspace_id,brand_id)
    references ai_content_subject_analyses(id,workspace_id,brand_id) on delete restrict,
  constraint ai_content_analyzed_subject_snapshots_json_identity_check check (
    snapshot_json->>'snapshotId'=id::text
    and snapshot_json->>'analysisId'=analysis_id::text
  ),
  constraint ai_content_analyzed_subject_snapshots_tenant_identity_unique
    unique (id,workspace_id,brand_id),
  constraint ai_content_analyzed_subject_snapshots_analysis_unique
    unique (analysis_id)
);

create or replace function reject_ai_content_analyzed_subject_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception using errcode='55000',message='analyzed_subject_snapshot_immutable';
end;
$$;

drop trigger if exists ai_content_analyzed_subject_snapshots_immutable
  on ai_content_analyzed_subject_snapshots;
create trigger ai_content_analyzed_subject_snapshots_immutable
before update or delete on ai_content_analyzed_subject_snapshots
for each row execute function reject_ai_content_analyzed_subject_snapshot_mutation();

create or replace function ai_content_orchestration_snapshot_is_valid(value jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce((
    jsonb_typeof(value) = 'object'
    and value->>'contractVersion' = 'generation-brief.v1'
    and value ?& array[
      'proposalId','approvedProposalVersionId','approvedProposalSnapshot',
      'brandCoreVersionId','ruleSetVersionId','subject','wikiSnapshots',
      'references','avatar','outputFormat','channels','promptDefinitionVersions'
    ]
    and jsonb_typeof(value->'proposalId') = 'string'
    and jsonb_typeof(value->'approvedProposalVersionId') = 'string'
    and ai_content_approved_proposal_snapshot_is_valid(value->'approvedProposalSnapshot')
    and jsonb_typeof(value->'brandCoreVersionId') = 'string'
    and jsonb_typeof(value->'ruleSetVersionId') = 'string'
    and jsonb_typeof(value->'subject') = 'object'
    and (
      (
        value->'subject'->>'kind' = 'brand_topic'
        and jsonb_typeof(value->'subject'->'topic') = 'string'
        and jsonb_typeof(value->'subject'->'brandCoreEvidenceIds') = 'array'
      )
      or (
        value->'subject'->>'kind' = 'approved_product_service'
        and jsonb_typeof(value->'subject'->'itemId') = 'string'
        and ai_content_versioned_snapshot_is_valid(value->'subject'->'version','product_service')
      )
      or (
        value->'subject'->>'kind' = 'analyzed_subject'
        and jsonb_typeof(value->'subject'->'analysisId') = 'string'
        and jsonb_typeof(value->'subject'->'snapshotId') = 'string'
        and ai_content_analyzed_subject_snapshot_is_valid(value->'subject'->'snapshot')
        and value->'subject'->>'analysisId'
          = value->'subject'->'snapshot'->>'analysisId'
        and value->'subject'->>'snapshotId'
          = value->'subject'->'snapshot'->>'snapshotId'
      )
    )
    and jsonb_typeof(value->'wikiSnapshots') = 'array'
    and (
      select count(*) = count(distinct wiki.item->>'id')
      from jsonb_array_elements(value->'wikiSnapshots') wiki(item)
    )
    and not exists (
      select 1 from jsonb_array_elements(value->'wikiSnapshots') wiki(item)
      where jsonb_typeof(wiki.item) is distinct from 'object'
         or not ai_content_versioned_snapshot_is_valid(wiki.item,'wiki')
    )
    and jsonb_typeof(value->'references') = 'array'
    and jsonb_array_length(value->'references') between 0 and 5
    and (
      select count(*) = count(distinct reference.item->>'itemId')
      from jsonb_array_elements(value->'references') reference(item)
    )
    and not exists (
      select 1 from jsonb_array_elements(value->'references') reference(item)
      where jsonb_typeof(reference.item) is distinct from 'object'
         or jsonb_typeof(reference.item->'itemId') is distinct from 'string'
         or jsonb_typeof(reference.item->'snapshotId') is distinct from 'string'
         or jsonb_typeof(reference.item->'patternVersionId') is distinct from 'string'
         or not ai_content_reference_roles_are_valid(reference.item->'roles')
    )
    and jsonb_typeof(value->'avatar') in ('object','null')
    and (
      jsonb_typeof(value->'avatar') = 'null'
      or (
        jsonb_typeof(value->'avatar'->'id') = 'string'
        and jsonb_typeof(value->'avatar'->'assetVersionId') = 'string'
        and value->'avatar'->>'objectHash' ~ '^[0-9a-f]{64}$'
        and value->'avatar'->>'mime' in ('image/png','image/jpeg','image/webp')
        and value->'avatar'->>'provenance' in ('library','upload_and_save','one_time')
      )
    )
    and value->>'outputFormat' in ('card_news','blog','single_image','channel_text')
    and jsonb_typeof(value->'channels') = 'array'
    and (
      select count(*) = count(distinct channel)
      from jsonb_array_elements_text(value->'channels') selected(channel)
    )
    and jsonb_typeof(value->'promptDefinitionVersions') = 'object'
    and exists (select 1 from jsonb_each(value->'promptDefinitionVersions'))
    and not exists (
      select 1 from jsonb_each(value->'promptDefinitionVersions') definition(name,version)
      where length(trim(definition.name))=0
         or jsonb_typeof(definition.version)<>'string'
         or length(trim(definition.version #>> '{}'))=0
    )
  ),false);
$$;

do $migration$
declare
  definition text;
  original_definition text;
begin
  select pg_get_functiondef(function.oid)
    into definition
    from pg_proc function
    join pg_namespace namespace on namespace.oid=function.pronamespace
   where namespace.nspname=current_schema()
     and function.proname='start_ai_content_orchestration'
     and pg_get_function_identity_arguments(function.oid)
       = 'target_generation_id uuid, target_workspace_id uuid, target_brand_id uuid, frozen_orchestration_snapshot jsonb, frozen_avatar_snapshot jsonb, actor_user_id uuid';

  if definition is null then
    raise exception 'start_ai_content_orchestration_missing';
  end if;
  if position('analyzed_subject_snapshot_invalid' in definition)>0
     and position('generation_subject_mode_mismatch' in definition)>0
     and position('not in (''brand_topic'',''analyzed_subject'')' in definition)>0 then
    return;
  end if;
  original_definition := definition;

  definition := replace(
    definition,
    $needle$if target_generation.product_service_id is null then
    if frozen_orchestration_snapshot->'subject'->>'kind' <> 'brand_topic'
       or snapshot_product_version_id is not null then$needle$,
    $replacement$if target_generation.product_service_id is null then
    if frozen_orchestration_snapshot->'subject'->>'kind'
         not in ('brand_topic','analyzed_subject')
       or snapshot_product_version_id is not null then$replacement$
  );

  definition := replace(
    definition,
    $needle$  snapshot_product_version_id := null;$needle$,
    $replacement$  if (
    target_generation.subject_mode='brand_topic'
    and frozen_orchestration_snapshot->'subject'->>'kind'<>'brand_topic'
  ) or (
    target_generation.subject_mode='product_service'
    and frozen_orchestration_snapshot->'subject'->>'kind'<>'approved_product_service'
  ) or (
    target_generation.subject_mode='new_subject'
    and frozen_orchestration_snapshot->'subject'->>'kind'<>'analyzed_subject'
  ) then
    raise exception using errcode='23514',message='generation_subject_mode_mismatch';
  end if;

  if frozen_orchestration_snapshot->'subject'->>'kind' = 'analyzed_subject'
     and not exists (
       select 1
       from ai_content_analyzed_subject_snapshots sealed
       join ai_content_subject_analyses analysis
         on analysis.id=sealed.analysis_id
        and analysis.workspace_id=sealed.workspace_id
        and analysis.brand_id=sealed.brand_id
       where sealed.id=(frozen_orchestration_snapshot->'subject'->>'snapshotId')::uuid
         and sealed.analysis_id=(frozen_orchestration_snapshot->'subject'->>'analysisId')::uuid
         and sealed.workspace_id=target_workspace_id
         and sealed.brand_id=target_brand_id
         and sealed.snapshot_json=frozen_orchestration_snapshot->'subject'->'snapshot'
         and analysis.status in ('ready','partial')
         and analysis.superseded_at is null
         and analysis.analysis_version=(sealed.snapshot_json->>'analysisVersion')::integer
         and analysis.contract_version=sealed.snapshot_json->>'analysisContractVersion'
         and analysis.subject_type=sealed.snapshot_json->>'subjectType'
         and coalesce(analysis.source_url,'')=coalesce(sealed.snapshot_json->'source'->>'sourceUrl','')
         and coalesce(analysis.normalized_url,'')=coalesce(sealed.snapshot_json->'source'->>'normalizedUrl','')
         and analysis.input_json=sealed.snapshot_json->'source'->'input'
         and analysis.facts_json=sealed.snapshot_json->'facts'
         and analysis.research_json=sealed.snapshot_json->'research'
         and analysis.analysis_result_json=sealed.snapshot_json->'analysisResult'
         and coalesce(analysis.completed_at,analysis.updated_at)
           =(sealed.snapshot_json->>'capturedAt')::timestamptz
         and not exists (
           select 1
           from jsonb_array_elements(sealed.snapshot_json->'selectedImages') image(item)
           where not exists (
             select 1 from ai_content_subject_images stored
              where stored.id=(image.item->>'id')::uuid
                and stored.analysis_id=analysis.id
                and stored.workspace_id=analysis.workspace_id
                and stored.brand_id=analysis.brand_id
                and stored.deleted_at is null
           )
         )
     ) then
    raise exception using errcode='23514',message='analyzed_subject_snapshot_invalid';
  end if;

  snapshot_product_version_id := null;$replacement$
  );

  if definition=original_definition
     or position('analyzed_subject_snapshot_invalid' in definition)=0
     or position('generation_subject_mode_mismatch' in definition)=0
     or position('not in (''brand_topic'',''analyzed_subject'')' in definition)=0 then
    raise exception 'start_ai_content_orchestration_patch_failed';
  end if;
  execute definition;
end;
$migration$;

alter table ai_content_generations
  drop constraint if exists ai_content_generations_orchestration_snapshot_check,
  add constraint ai_content_generations_orchestration_snapshot_check
    check (
      orchestration_snapshot is null
      or ai_content_orchestration_snapshot_is_valid(orchestration_snapshot)
    );

alter table ai_content_generation_briefs
  drop constraint if exists ai_content_generation_briefs_brief_json_check,
  add constraint ai_content_generation_briefs_brief_json_check
    check (ai_content_orchestration_snapshot_is_valid(brief_json));

commit;
