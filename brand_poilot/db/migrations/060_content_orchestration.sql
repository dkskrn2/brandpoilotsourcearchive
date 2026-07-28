begin;

create or replace function ai_content_reference_roles_are_valid(value jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce((
    jsonb_typeof(value) = 'array'
    and jsonb_array_length(value) between 1 and 3
    and (
      select count(*) = count(distinct role)
      from jsonb_array_elements_text(value) as selected(role)
    )
    and not exists (
      select 1
      from jsonb_array_elements_text(value) as selected(role)
      where selected.role not in ('planning', 'copy_pattern', 'visual_composition')
    )
  ), false);
$$;

create or replace function ai_content_source_snapshots_are_valid(value jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce((
    jsonb_typeof(value) = 'array'
    and not exists (
      select 1
      from jsonb_array_elements(value) as snapshot(item)
      where jsonb_typeof(snapshot.item) is distinct from 'object'
         or jsonb_typeof(snapshot.item->'sourceId') is distinct from 'string'
         or length(trim(snapshot.item->>'sourceId')) = 0
         or jsonb_typeof(snapshot.item->'url') is distinct from 'string'
         or snapshot.item->>'url' !~ '^https://'
         or jsonb_typeof(snapshot.item->'crawledAt') is distinct from 'string'
         or length(trim(snapshot.item->>'crawledAt')) = 0
         or jsonb_typeof(snapshot.item->'contentHash') is distinct from 'string'
         or snapshot.item->>'contentHash' !~ '^[0-9a-f]{64}$'
         or jsonb_typeof(snapshot.item->'summary') is distinct from 'string'
    )
  ), false);
$$;

create or replace function ai_content_approved_proposal_snapshot_is_valid(value jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce((
    jsonb_typeof(value) = 'object'
    and value->>'contractVersion' = 'approved-proposal.v1'
    and value ?& array[
      'sourceProposalId',
      'revision',
      'effectiveProposal',
      'editPatch',
      'validationResultId',
      'approvedBy',
      'approvedAt'
    ]
    and jsonb_typeof(value->'sourceProposalId') = 'string'
    and jsonb_typeof(value->'revision') = 'number'
    and (value->>'revision')::integer > 0
    and jsonb_typeof(value->'effectiveProposal') = 'object'
    and jsonb_typeof(value->'editPatch') = 'array'
    and jsonb_typeof(value->'validationResultId') = 'string'
    and jsonb_typeof(value->'approvedBy') = 'string'
    and jsonb_typeof(value->'approvedAt') = 'string'
  ), false);
$$;

create or replace function ai_content_orchestration_snapshot_is_valid(value jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce((
    jsonb_typeof(value) = 'object'
    and value->>'contractVersion' = 'generation-brief.v1'
    and value ?& array[
      'proposalId',
      'approvedProposalVersionId',
      'approvedProposalSnapshot',
      'brandCoreVersionId',
      'ruleSetVersionId',
      'subject',
      'wikiSnapshots',
      'references',
      'avatar',
      'outputFormat',
      'channels',
      'promptDefinitionVersions'
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
        and jsonb_typeof(value->'subject'->'version') = 'object'
        and jsonb_typeof(value->'subject'->'version'->'id') = 'string'
      )
    )
    and jsonb_typeof(value->'wikiSnapshots') = 'array'
    and (
      select count(*) = count(distinct wiki.item->>'id')
      from jsonb_array_elements(value->'wikiSnapshots') as wiki(item)
    )
    and not exists (
      select 1
      from jsonb_array_elements(value->'wikiSnapshots') as wiki(item)
      where jsonb_typeof(wiki.item) is distinct from 'object'
         or jsonb_typeof(wiki.item->'id') is distinct from 'string'
    )
    and jsonb_typeof(value->'references') = 'array'
    and jsonb_array_length(value->'references') between 0 and 5
    and (
      select count(*) = count(distinct reference.item->>'itemId')
      from jsonb_array_elements(value->'references') as reference(item)
    )
    and not exists (
      select 1
      from jsonb_array_elements(value->'references') as reference(item)
      where jsonb_typeof(reference.item) is distinct from 'object'
         or jsonb_typeof(reference.item->'itemId') is distinct from 'string'
         or jsonb_typeof(reference.item->'snapshotId') is distinct from 'string'
         or jsonb_typeof(reference.item->'patternVersionId') is distinct from 'string'
         or not ai_content_reference_roles_are_valid(reference.item->'roles')
    )
    and jsonb_typeof(value->'avatar') in ('object', 'null')
    and (
      jsonb_typeof(value->'avatar') = 'null'
      or (
        jsonb_typeof(value->'avatar'->'id') = 'string'
        and jsonb_typeof(value->'avatar'->'assetVersionId') = 'string'
        and value->'avatar'->>'objectHash' ~ '^[0-9a-f]{64}$'
        and value->'avatar'->>'mime' in ('image/png', 'image/jpeg', 'image/webp')
        and value->'avatar'->>'provenance' in ('library', 'upload_and_save', 'one_time')
      )
    )
    and value->>'outputFormat' in ('card_news', 'blog', 'single_image', 'channel_text')
    and jsonb_typeof(value->'channels') = 'array'
    and (
      select count(*) = count(distinct channel)
      from jsonb_array_elements_text(value->'channels') as selected(channel)
    )
    and jsonb_typeof(value->'promptDefinitionVersions') = 'object'
    and exists (
      select 1 from jsonb_each(value->'promptDefinitionVersions')
    )
    and not exists (
      select 1
      from jsonb_each(value->'promptDefinitionVersions') as definition(name, version)
      where length(trim(definition.name)) = 0
         or jsonb_typeof(definition.version) <> 'string'
         or length(trim(definition.version #>> '{}')) = 0
    )
  ), false);
$$;

alter table ai_content_generations
  add column if not exists content_family text,
  add column if not exists output_format text,
  add column if not exists subject_mode text,
  add column if not exists product_service_id uuid,
  add column if not exists orchestration_snapshot jsonb,
  add column if not exists avatar_snapshot jsonb;

update ai_content_generations
set content_family = coalesce(content_family, case
      when type = 'card_news' then 'informational'
      when type = 'blog' then 'informational'
      when type = 'marketing' then 'marketing'
    end),
    output_format = coalesce(output_format, case
      when type = 'card_news' then 'card_news'
      when type = 'blog' then 'blog'
      when type = 'marketing' then 'single_image'
    end)
where content_family is null
   or output_format is null;

alter table ai_content_generations
  drop constraint if exists ai_content_generations_content_family_check,
  drop constraint if exists ai_content_generations_output_format_check,
  drop constraint if exists ai_content_generations_subject_mode_check,
  drop constraint if exists ai_content_generations_orchestration_snapshot_check,
  drop constraint if exists ai_content_generations_avatar_snapshot_check,
  drop constraint if exists ai_content_generations_product_subject_check,
  add constraint ai_content_generations_content_family_check
    check (content_family is null or content_family in ('informational', 'marketing')),
  add constraint ai_content_generations_output_format_check
    check (
      output_format is null
      or output_format in ('card_news', 'blog', 'single_image', 'channel_text')
    ),
  add constraint ai_content_generations_subject_mode_check
    check (
      subject_mode is null
      or subject_mode in ('brand_topic', 'product_service', 'new_subject')
    ),
  add constraint ai_content_generations_orchestration_snapshot_check
    check (
      orchestration_snapshot is null
      or ai_content_orchestration_snapshot_is_valid(orchestration_snapshot)
    ),
  add constraint ai_content_generations_avatar_snapshot_check
    check (avatar_snapshot is null or jsonb_typeof(avatar_snapshot) = 'object'),
  add constraint ai_content_generations_product_subject_check
    check (product_service_id is null or subject_mode = 'product_service');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_content_generations_product_service_ownership_fk'
  ) then
    alter table ai_content_generations
      add constraint ai_content_generations_product_service_ownership_fk
      foreign key (product_service_id, workspace_id, brand_id)
      references product_services(id, workspace_id, brand_id) on delete restrict;
  end if;
end;
$$;

alter table ai_content_generation_references
  add column if not exists reference_item_id uuid,
  add column if not exists reference_snapshot_id uuid,
  add column if not exists pattern_version_id uuid,
  add column if not exists roles_json jsonb;

alter table ai_content_generation_references
  drop constraint if exists ai_content_generation_references_canonical_check,
  add constraint ai_content_generation_references_canonical_check
    check (
      reference_item_id is null
      or (
        position between 1 and 5
        and reference_snapshot_id is not null
        and pattern_version_id is not null
        and reference_snapshot_json->>'snapshotId' = reference_snapshot_id::text
        and reference_snapshot_json->>'contentHash' ~ '^[0-9a-f]{64}$'
        and jsonb_typeof(reference_snapshot_json->'capturedAt') = 'string'
        and jsonb_typeof(reference_snapshot_json->'sourceUrl') = 'string'
        and ai_content_reference_roles_are_valid(roles_json)
      )
    );

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_content_generation_references_reference_item_ownership_fk'
  ) then
    alter table ai_content_generation_references
      add constraint ai_content_generation_references_reference_item_ownership_fk
      foreign key (reference_item_id, workspace_id, brand_id)
      references reference_items(id, workspace_id, brand_id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_content_generation_references_pattern_ownership_fk'
  ) then
    alter table ai_content_generation_references
      add constraint ai_content_generation_references_pattern_ownership_fk
      foreign key (pattern_version_id, workspace_id, brand_id)
      references reference_patterns(id, workspace_id, brand_id) on delete restrict;
  end if;
end;
$$;

create unique index if not exists ai_content_generation_references_canonical_item_unique
  on ai_content_generation_references (generation_id, reference_item_id)
  where reference_item_id is not null;

create table if not exists ai_content_generation_reference_migration_audits (
  generation_id uuid primary key,
  workspace_id uuid not null,
  brand_id uuid not null,
  reference_count integer not null check (reference_count >= 0),
  exceeds_canonical_limit boolean not null,
  audited_at timestamptz not null default now(),
  constraint ai_content_generation_reference_migration_audits_generation_fk
    foreign key (generation_id, workspace_id, brand_id)
    references ai_content_generations(id, workspace_id, brand_id) on delete cascade
);

insert into ai_content_generation_reference_migration_audits (
  generation_id,
  workspace_id,
  brand_id,
  reference_count,
  exceeds_canonical_limit,
  audited_at
)
select
  generation_id,
  workspace_id,
  brand_id,
  count(*)::integer,
  count(*) > 5,
  now()
from ai_content_generation_references
group by generation_id, workspace_id, brand_id
on conflict (generation_id) do update
set reference_count = excluded.reference_count,
    exceeds_canonical_limit = excluded.exceeds_canonical_limit,
    audited_at = excluded.audited_at;

create index if not exists source_urls_content_purpose_idx
  on source_urls (workspace_id, brand_id, content_purpose, source_type, created_at desc);

create index if not exists reference_items_brand_purpose_active_idx
  on reference_items (workspace_id, brand_id, content_purpose, kind, created_at desc)
  where archived_at is null;

create table if not exists ai_content_proposal_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  origin text not null check (origin in ('manual', 'scheduled_crawl')),
  content_family text not null check (content_family in ('informational', 'marketing')),
  request_json jsonb not null check (jsonb_typeof(request_json) = 'object'),
  source_snapshot_json jsonb not null
    check (ai_content_source_snapshots_are_valid(source_snapshot_json)),
  status text not null default 'queued'
    check (status in ('queued', 'building', 'ready', 'failed')),
  idempotency_key text not null check (length(trim(idempotency_key)) > 0),
  created_by_user_id uuid null references app_users(id) on delete set null,
  error_code text null,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_content_proposal_batches_brand_ownership_fk
    foreign key (brand_id, workspace_id)
    references brands(id, workspace_id) on delete cascade,
  constraint ai_content_proposal_batches_tenant_identity_unique
    unique (id, workspace_id, brand_id),
  constraint ai_content_proposal_batches_idempotency_unique
    unique (workspace_id, brand_id, idempotency_key),
  constraint ai_content_proposal_batches_failure_check check (
    (status = 'failed' and error_code is not null)
    or (status <> 'failed' and error_code is null and error_message is null)
  )
);

create index if not exists ai_content_proposal_batches_brand_status_idx
  on ai_content_proposal_batches (workspace_id, brand_id, status, created_at desc);

create table if not exists ai_content_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  batch_id uuid not null,
  position integer not null check (position between 1 and 3),
  proposal_json jsonb not null check (jsonb_typeof(proposal_json) = 'object'),
  status text not null default 'suggested'
    check (status in ('suggested', 'selected', 'dismissed')),
  generation_id uuid null,
  selected_by_user_id uuid null references app_users(id) on delete restrict,
  selected_at timestamptz null,
  dismissed_by_user_id uuid null references app_users(id) on delete restrict,
  dismissed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_content_proposals_batch_ownership_fk
    foreign key (batch_id, workspace_id, brand_id)
    references ai_content_proposal_batches(id, workspace_id, brand_id) on delete cascade,
  constraint ai_content_proposals_generation_ownership_fk
    foreign key (generation_id, workspace_id, brand_id)
    references ai_content_generations(id, workspace_id, brand_id) on delete restrict,
  constraint ai_content_proposals_tenant_identity_unique
    unique (id, workspace_id, brand_id),
  constraint ai_content_proposals_batch_position_unique
    unique (batch_id, position),
  constraint ai_content_proposals_selection_state_check check (
    (
      status = 'selected'
      and selected_by_user_id is not null
      and selected_at is not null
      and dismissed_by_user_id is null
      and dismissed_at is null
    )
    or (
      status = 'dismissed'
      and selected_by_user_id is null
      and selected_at is null
      and generation_id is null
      and dismissed_by_user_id is not null
      and dismissed_at is not null
    )
    or (
      status = 'suggested'
      and selected_by_user_id is null
      and selected_at is null
      and generation_id is null
      and dismissed_by_user_id is null
      and dismissed_at is null
    )
  )
);

create unique index if not exists ai_content_proposals_one_selected_per_batch
  on ai_content_proposals (batch_id)
  where status = 'selected';

create unique index if not exists ai_content_proposals_generation_unique
  on ai_content_proposals (generation_id)
  where generation_id is not null;

create table if not exists ai_content_approved_proposal_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  proposal_id uuid not null,
  revision integer not null check (revision > 0),
  approved_proposal_snapshot jsonb not null
    check (ai_content_approved_proposal_snapshot_is_valid(approved_proposal_snapshot)),
  validation_result_id text not null check (length(trim(validation_result_id)) > 0),
  approved_by_user_id uuid not null references app_users(id) on delete restrict,
  approved_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint ai_content_approved_proposal_versions_proposal_ownership_fk
    foreign key (proposal_id, workspace_id, brand_id)
    references ai_content_proposals(id, workspace_id, brand_id) on delete restrict,
  constraint ai_content_approved_proposal_versions_tenant_identity_unique
    unique (id, workspace_id, brand_id),
  constraint ai_content_approved_proposal_versions_proposal_revision_unique
    unique (proposal_id, revision)
);

create or replace function reject_ai_content_approved_proposal_version_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception using errcode = '55000', message = 'approved_proposal_version_immutable';
end;
$$;

drop trigger if exists ai_content_approved_proposal_versions_immutable
  on ai_content_approved_proposal_versions;
create trigger ai_content_approved_proposal_versions_immutable
before update or delete on ai_content_approved_proposal_versions
for each row execute function reject_ai_content_approved_proposal_version_mutation();

create table if not exists ai_content_generation_briefs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  generation_id uuid not null,
  approved_proposal_version_id uuid not null,
  brief_json jsonb not null
    check (ai_content_orchestration_snapshot_is_valid(brief_json)),
  created_by_user_id uuid not null references app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint ai_content_generation_briefs_generation_ownership_fk
    foreign key (generation_id, workspace_id, brand_id)
    references ai_content_generations(id, workspace_id, brand_id) on delete restrict,
  constraint ai_content_generation_briefs_approved_proposal_ownership_fk
    foreign key (approved_proposal_version_id, workspace_id, brand_id)
    references ai_content_approved_proposal_versions(id, workspace_id, brand_id) on delete restrict,
  constraint ai_content_generation_briefs_tenant_identity_unique
    unique (id, workspace_id, brand_id),
  constraint ai_content_generation_briefs_generation_unique
    unique (generation_id)
);

create or replace function reject_ai_content_generation_brief_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception using errcode = '55000', message = 'generation_brief_immutable';
end;
$$;

drop trigger if exists ai_content_generation_briefs_immutable
  on ai_content_generation_briefs;
create trigger ai_content_generation_briefs_immutable
before update or delete on ai_content_generation_briefs
for each row execute function reject_ai_content_generation_brief_mutation();

create table if not exists ai_content_proposal_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  batch_id uuid not null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  available_at timestamptz not null default now(),
  lease_owner text null,
  lease_token uuid null,
  lease_started_at timestamptz null,
  lease_expires_at timestamptz null,
  error_code text null,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint ai_content_proposal_jobs_batch_ownership_fk
    foreign key (batch_id, workspace_id, brand_id)
    references ai_content_proposal_batches(id, workspace_id, brand_id) on delete cascade,
  constraint ai_content_proposal_jobs_tenant_identity_unique
    unique (id, workspace_id, brand_id),
  constraint ai_content_proposal_jobs_attempts_check check (
    attempt_count between 0 and max_attempts
    and max_attempts between 1 and 10
  ),
  constraint ai_content_proposal_jobs_lease_check check (
    (
      status = 'processing'
      and length(trim(lease_owner)) > 0
      and lease_token is not null
      and lease_started_at is not null
      and lease_expires_at > lease_started_at
      and lease_expires_at <= lease_started_at + interval '15 minutes'
    )
    or (
      status <> 'processing'
      and lease_owner is null
      and lease_token is null
      and lease_started_at is null
      and lease_expires_at is null
    )
  ),
  constraint ai_content_proposal_jobs_terminal_check check (
    (status = 'failed' and error_code is not null and completed_at is not null)
    or (status = 'completed' and error_code is null and error_message is null and completed_at is not null)
    or (status in ('queued', 'processing') and error_code is null and error_message is null and completed_at is null)
  )
);

create unique index if not exists ai_content_proposal_jobs_active_batch_unique
  on ai_content_proposal_jobs (batch_id)
  where status in ('queued', 'processing');

create index if not exists ai_content_proposal_jobs_claim_idx
  on ai_content_proposal_jobs (status, available_at, created_at)
  where status = 'queued';

create table if not exists ai_content_create_idempotency_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  actor_user_id uuid not null,
  operation text not null
    check (operation in ('proposal_batch', 'generation_brief', 'generation_start')),
  client_request_id text not null check (length(trim(client_request_id)) > 0),
  normalized_payload_hash text not null
    check (normalized_payload_hash ~ '^[0-9a-f]{64}$'),
  resource_type text not null check (length(trim(resource_type)) > 0),
  resource_id uuid not null,
  response_json jsonb not null default '{}'::jsonb
    check (jsonb_typeof(response_json) = 'object'),
  created_at timestamptz not null default now(),
  constraint ai_content_create_idempotency_records_brand_ownership_fk
    foreign key (brand_id, workspace_id)
    references brands(id, workspace_id) on delete cascade,
  constraint ai_content_create_idempotency_records_actor_membership_fk
    foreign key (workspace_id, actor_user_id)
    references workspace_members(workspace_id, user_id) on delete restrict,
  constraint ai_content_create_idempotency_records_tenant_identity_unique
    unique (id, workspace_id, brand_id),
  constraint ai_content_create_idempotency_records_scope_unique
    unique (workspace_id, actor_user_id, operation, client_request_id)
);

create or replace function reserve_ai_content_create_idempotency(
  target_workspace_id uuid,
  target_brand_id uuid,
  target_actor_user_id uuid,
  target_operation text,
  target_client_request_id text,
  target_normalized_payload_hash text,
  target_resource_type text,
  target_resource_id uuid,
  target_response_json jsonb
)
returns ai_content_create_idempotency_records
language plpgsql
as $$
declare
  existing_record ai_content_create_idempotency_records%rowtype;
  inserted_record ai_content_create_idempotency_records%rowtype;
begin
  insert into ai_content_create_idempotency_records (
    workspace_id,
    brand_id,
    actor_user_id,
    operation,
    client_request_id,
    normalized_payload_hash,
    resource_type,
    resource_id,
    response_json
  ) values (
    target_workspace_id,
    target_brand_id,
    target_actor_user_id,
    target_operation,
    target_client_request_id,
    target_normalized_payload_hash,
    target_resource_type,
    target_resource_id,
    target_response_json
  )
  on conflict (workspace_id, actor_user_id, operation, client_request_id)
  do nothing
  returning * into inserted_record;

  if inserted_record.id is not null then
    return inserted_record;
  end if;

  select record.*
  into existing_record
  from ai_content_create_idempotency_records record
  where record.workspace_id = target_workspace_id
    and record.actor_user_id = target_actor_user_id
    and record.operation = target_operation
    and record.client_request_id = target_client_request_id
  for update;

  if existing_record.brand_id <> target_brand_id
     or existing_record.normalized_payload_hash <> target_normalized_payload_hash
     or existing_record.resource_type <> target_resource_type
     or existing_record.resource_id <> target_resource_id then
    raise exception using errcode = '23505', message = 'idempotency_conflict';
  end if;

  return existing_record;
end;
$$;

create or replace function select_ai_content_proposal(
  target_proposal_id uuid,
  target_workspace_id uuid,
  target_brand_id uuid,
  actor_user_id uuid
)
returns uuid
language plpgsql
as $$
declare
  target_batch_id uuid;
  target_status text;
  already_selected_id uuid;
begin
  if not exists (
    select 1
    from workspace_members member
    where member.workspace_id = target_workspace_id
      and member.user_id = actor_user_id
  ) then
    raise exception using errcode = '42501', message = 'proposal_selection_actor_forbidden';
  end if;

  select proposal.batch_id
  into target_batch_id
  from ai_content_proposals proposal
  where proposal.id = target_proposal_id
    and proposal.workspace_id = target_workspace_id
    and proposal.brand_id = target_brand_id;

  if target_batch_id is null then
    raise exception using errcode = 'P0002', message = 'proposal_not_found';
  end if;

  perform 1
  from ai_content_proposal_batches batch
  where batch.id = target_batch_id
    and batch.workspace_id = target_workspace_id
    and batch.brand_id = target_brand_id
    and batch.status = 'ready'
  for update;
  if not found then
    raise exception using errcode = '23514', message = 'proposal_batch_not_ready';
  end if;

  select proposal.status
  into target_status
  from ai_content_proposals proposal
  where proposal.id = target_proposal_id
  for update;

  select proposal.id
  into already_selected_id
  from ai_content_proposals proposal
  where proposal.batch_id = target_batch_id
    and proposal.status = 'selected'
  limit 1;

  if already_selected_id = target_proposal_id then
    return target_proposal_id;
  end if;
  if already_selected_id is not null then
    raise exception using errcode = '23505', message = 'proposal_already_selected';
  end if;
  if target_status <> 'suggested' then
    raise exception using errcode = '23514', message = 'proposal_not_selectable';
  end if;

  update ai_content_proposals
  set status = 'dismissed',
      dismissed_by_user_id = actor_user_id,
      dismissed_at = now(),
      updated_at = now()
  where batch_id = target_batch_id
    and id <> target_proposal_id
    and status = 'suggested';

  update ai_content_proposals
  set status = 'selected',
      selected_by_user_id = actor_user_id,
      selected_at = now(),
      updated_at = now()
  where id = target_proposal_id;

  return target_proposal_id;
end;
$$;

create or replace function start_ai_content_orchestration(
  target_generation_id uuid,
  target_workspace_id uuid,
  target_brand_id uuid,
  frozen_orchestration_snapshot jsonb,
  frozen_avatar_snapshot jsonb,
  actor_user_id uuid
)
returns uuid
language plpgsql
as $$
declare
  target_generation ai_content_generations%rowtype;
  selected_proposal ai_content_proposals%rowtype;
  approved_proposal_version ai_content_approved_proposal_versions%rowtype;
  snapshot_product_version_id uuid;
  snapshot_avatar_id uuid;
  snapshot_avatar_image_id uuid;
  selected_reference_count integer;
  brief_reference_count integer;
begin
  select generation.*
  into target_generation
  from ai_content_generations generation
  where generation.id = target_generation_id
    and generation.workspace_id = target_workspace_id
    and generation.brand_id = target_brand_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'generation_not_found';
  end if;

  if target_generation.orchestration_snapshot is not null then
    if target_generation.orchestration_snapshot is not distinct from frozen_orchestration_snapshot
       and target_generation.avatar_snapshot is not distinct from (
         case
           when jsonb_typeof(frozen_avatar_snapshot) = 'null' then null
           else frozen_avatar_snapshot
         end
       ) then
      return target_generation_id;
    end if;
    raise exception using errcode = '23505', message = 'generation_already_started';
  end if;

  if not exists (
    select 1
    from workspace_members member
    where member.workspace_id = target_workspace_id
      and member.user_id = actor_user_id
  ) then
    raise exception using errcode = '42501', message = 'generation_start_actor_forbidden';
  end if;
  if not ai_content_orchestration_snapshot_is_valid(frozen_orchestration_snapshot) then
    raise exception using errcode = '23514', message = 'generation_brief_invalid';
  end if;
  if frozen_avatar_snapshot is distinct from frozen_orchestration_snapshot->'avatar' then
    raise exception using errcode = '23514', message = 'avatar_snapshot_mismatch';
  end if;
  if target_generation.output_format <> frozen_orchestration_snapshot->>'outputFormat' then
    raise exception using errcode = '23514', message = 'generation_output_format_mismatch';
  end if;

  if not exists (
    select 1
    from brand_profiles profile
    join brand_core_versions core
      on core.id = profile.active_brand_core_id
     and core.workspace_id = profile.workspace_id
     and core.brand_id = profile.brand_id
     and core.status = 'approved'
    join brand_rule_sets rules
      on rules.id = profile.active_brand_rule_set_id
     and rules.workspace_id = profile.workspace_id
     and rules.brand_id = profile.brand_id
     and rules.status = 'approved'
    where profile.workspace_id = target_workspace_id
      and profile.brand_id = target_brand_id
      and core.id = (frozen_orchestration_snapshot->>'brandCoreVersionId')::uuid
      and rules.id = (frozen_orchestration_snapshot->>'ruleSetVersionId')::uuid
  ) then
    raise exception using errcode = '23514', message = 'brand_versions_not_active_approved';
  end if;

  select proposal.*
  into selected_proposal
  from ai_content_proposals proposal
  where proposal.id = (frozen_orchestration_snapshot->>'proposalId')::uuid
    and proposal.workspace_id = target_workspace_id
    and proposal.brand_id = target_brand_id
    and proposal.status = 'selected'
  for update;
  if not found then
    raise exception using errcode = '23514', message = 'proposal_not_selected';
  end if;
  if selected_proposal.generation_id is not null
     and selected_proposal.generation_id <> target_generation_id then
    raise exception using errcode = '23505', message = 'proposal_generation_already_started';
  end if;

  select approved.*
  into approved_proposal_version
  from ai_content_approved_proposal_versions approved
  where approved.id = (frozen_orchestration_snapshot->>'approvedProposalVersionId')::uuid
    and approved.workspace_id = target_workspace_id
    and approved.brand_id = target_brand_id
    and approved.proposal_id = selected_proposal.id;
  if not found
     or approved_proposal_version.approved_proposal_snapshot
        is distinct from frozen_orchestration_snapshot->'approvedProposalSnapshot' then
    raise exception using errcode = '23514', message = 'approved_proposal_version_invalid';
  end if;

  snapshot_product_version_id := null;
  if frozen_orchestration_snapshot->'subject'->>'kind' = 'approved_product_service' then
    snapshot_product_version_id :=
      (frozen_orchestration_snapshot->'subject'->'version'->>'id')::uuid;
  end if;
  if target_generation.product_service_id is null then
    if frozen_orchestration_snapshot->'subject'->>'kind' <> 'brand_topic'
       or snapshot_product_version_id is not null then
      raise exception using errcode = '23514', message = 'product_snapshot_unexpected';
    end if;
  elsif frozen_orchestration_snapshot->'subject'->>'kind' <> 'approved_product_service'
     or (frozen_orchestration_snapshot->'subject'->>'itemId')::uuid
        <> target_generation.product_service_id
     or not exists (
    select 1
    from product_services product
    join product_service_versions version
      on version.id = product.active_version_id
     and version.product_service_id = product.id
     and version.workspace_id = product.workspace_id
     and version.brand_id = product.brand_id
     and version.status = 'approved'
    where product.id = target_generation.product_service_id
      and product.workspace_id = target_workspace_id
      and product.brand_id = target_brand_id
      and product.status = 'active'
      and version.id = snapshot_product_version_id
  ) then
    raise exception using errcode = '23514', message = 'product_version_not_active_approved';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(frozen_orchestration_snapshot->'wikiSnapshots') wiki(item)
    where not exists (
      select 1
      from wiki_versions version
      where version.id = (wiki.item->>'id')::uuid
        and version.workspace_id = target_workspace_id
        and version.brand_id = target_brand_id
        and version.status = 'active'
    )
  ) then
    raise exception using errcode = '23514', message = 'wiki_version_not_active';
  end if;

  if frozen_avatar_snapshot is not null
     and jsonb_typeof(frozen_avatar_snapshot) <> 'null' then
    snapshot_avatar_id := (frozen_avatar_snapshot->>'id')::uuid;
    snapshot_avatar_image_id := (frozen_avatar_snapshot->>'assetVersionId')::uuid;
    if not exists (
      select 1
      from brand_avatars avatar
      join brand_avatar_images image
        on image.avatar_id = avatar.id
       and image.workspace_id = avatar.workspace_id
       and image.brand_id = avatar.brand_id
      where avatar.id = snapshot_avatar_id
        and avatar.workspace_id = target_workspace_id
        and avatar.brand_id = target_brand_id
        and avatar.status = 'active'
        and image.id = snapshot_avatar_image_id
        and image.checksum = frozen_avatar_snapshot->>'objectHash'
        and image.mime_type = frozen_avatar_snapshot->>'mime'
    ) then
      raise exception using errcode = '23514', message = 'avatar_not_active_owned';
    end if;
  end if;

  select count(*)::integer
  into selected_reference_count
  from ai_content_generation_references selected
  where selected.generation_id = target_generation_id
    and selected.workspace_id = target_workspace_id
    and selected.brand_id = target_brand_id
    and selected.reference_item_id is not null;

  brief_reference_count :=
    jsonb_array_length(frozen_orchestration_snapshot->'references');
  if selected_reference_count <> brief_reference_count then
    raise exception using errcode = '23514', message = 'reference_snapshot_set_mismatch';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(frozen_orchestration_snapshot->'references') reference(item)
    where not exists (
      select 1
      from ai_content_generation_references selected
      join reference_items item
        on item.id = selected.reference_item_id
       and item.workspace_id = selected.workspace_id
       and item.brand_id = selected.brand_id
       and item.archived_at is null
      join reference_patterns pattern
        on pattern.id = selected.pattern_version_id
       and pattern.workspace_id = selected.workspace_id
       and pattern.brand_id = selected.brand_id
       and pattern.reference_item_id = selected.reference_item_id
      where selected.generation_id = target_generation_id
        and selected.workspace_id = target_workspace_id
        and selected.brand_id = target_brand_id
        and selected.reference_item_id = (reference.item->>'itemId')::uuid
        and selected.reference_snapshot_id = (reference.item->>'snapshotId')::uuid
        and selected.pattern_version_id = (reference.item->>'patternVersionId')::uuid
        and selected.roles_json = reference.item->'roles'
    )
  ) then
    raise exception using errcode = '23514', message = 'reference_snapshot_set_mismatch';
  end if;

  insert into ai_content_generation_briefs (
    workspace_id,
    brand_id,
    generation_id,
    approved_proposal_version_id,
    brief_json,
    created_by_user_id
  ) values (
    target_workspace_id,
    target_brand_id,
    target_generation_id,
    approved_proposal_version.id,
    frozen_orchestration_snapshot,
    actor_user_id
  );

  update ai_content_proposals
  set generation_id = target_generation_id,
      updated_at = now()
  where id = selected_proposal.id;

  update ai_content_generations
  set orchestration_snapshot = frozen_orchestration_snapshot,
      avatar_snapshot = case
        when jsonb_typeof(frozen_avatar_snapshot) = 'null' then null
        else frozen_avatar_snapshot
      end,
      updated_at = now()
  where id = target_generation_id;

  return target_generation_id;
end;
$$;

commit;
