begin;

-- This migration is an atomic schema change and data backfill. Before applying
-- it on Ubuntu/production, Operations must approve row counts, expected runtime,
-- and a maintenance window; this migration does not claim an online rollout.

alter table ai_content_generations
  add column attachments_locked_at timestamptz null,
  add column generation_input_snapshot jsonb null,
  add column terminal_at timestamptz null,
  add column retryable_until timestamptz null;

alter table ai_content_generations
  add constraint ai_content_generations_input_snapshot_object_check check (
    generation_input_snapshot is null
    or jsonb_typeof(generation_input_snapshot) = 'object'
  ),
  add constraint ai_content_generations_terminal_retention_pair_check check (
    (terminal_at is null and retryable_until is null)
    or (
      terminal_at is not null
      and retryable_until is not null
      and retryable_until > terminal_at
    )
  );

update ai_content_generations
set terminal_at = coalesce(completed_at, updated_at),
    retryable_until = coalesce(completed_at, updated_at) + interval '15 days'
where status in ('completed', 'partial_failed', 'failed')
  and terminal_at is null
  and retryable_until is null;

update ai_content_generations
set generation_input_snapshot = subject_analysis_snapshot
where generation_input_snapshot is null
  and subject_analysis_snapshot is not null
  and jsonb_typeof(subject_analysis_snapshot) = 'object';

create index ai_content_generations_terminal_retention_idx
  on ai_content_generations (retryable_until, id)
  where terminal_at is not null;

create table ai_content_attachment_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  created_by_user_id uuid null,
  nonce uuid not null default gen_random_uuid(),
  role text not null,
  file_name text not null,
  expected_mime_type text not null,
  expected_size_bytes bigint not null,
  expected_checksum text not null,
  storage_url text null,
  storage_path text not null,
  status text not null default 'pending',
  token_expires_at timestamptz not null default (now() + interval '10 minutes'),
  confirmed_at timestamptz null,
  cancelled_at timestamptz null,
  expired_at timestamptz null,
  failed_at timestamptz null,
  confirmed_attachment_id uuid null,
  last_error_code text null,
  is_legacy_backfill boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_content_attachment_upload_sessions_generation_fk
    foreign key (generation_id, workspace_id, brand_id)
    references ai_content_generations(id, workspace_id, brand_id)
    on delete cascade,
  constraint ai_content_attachment_upload_sessions_actor_fk
    foreign key (workspace_id, created_by_user_id)
    references workspace_members(workspace_id, user_id)
    on delete no action
    deferrable initially deferred,
  constraint ai_content_attachment_upload_sessions_role_check check (
    role in ('product', 'person', 'scale', 'visual_reference', 'document')
  ),
  constraint ai_content_attachment_upload_sessions_size_check check (
    expected_size_bytes > 0
  ),
  constraint ai_content_attachment_upload_sessions_expiry_check check (
    token_expires_at = created_at + interval '10 minutes'
  ),
  constraint ai_content_attachment_upload_sessions_error_code_check check (
    last_error_code is null
    or last_error_code ~ '^[a-z0-9_]{1,100}$'
  ),
  constraint ai_content_attachment_upload_sessions_actor_semantics_check check (
    created_by_user_id is not null
    or (
      is_legacy_backfill
      and status = 'confirmed'
      and confirmed_attachment_id is not null
    )
  ),
  constraint ai_content_attachment_upload_sessions_legacy_semantics_check check (
    not is_legacy_backfill
    or (
      created_by_user_id is null
      and status = 'confirmed'
      and confirmed_attachment_id is not null
    )
  ),
  constraint ai_content_attachment_upload_sessions_state_check check (
    (
      status = 'pending'
      and confirmed_at is null
      and cancelled_at is null
      and expired_at is null
      and failed_at is null
      and confirmed_attachment_id is null
      and last_error_code is null
    )
    or (
      status = 'confirmed'
      and confirmed_at is not null
      and cancelled_at is null
      and expired_at is null
      and failed_at is null
      and confirmed_attachment_id is not null
      and last_error_code is null
    )
    or (
      status = 'cancelled'
      and confirmed_at is null
      and cancelled_at is not null
      and expired_at is null
      and failed_at is null
      and confirmed_attachment_id is null
      and last_error_code is null
    )
    or (
      status = 'expired'
      and confirmed_at is null
      and cancelled_at is null
      and expired_at is not null
      and failed_at is null
      and confirmed_attachment_id is null
      and last_error_code is null
    )
    or (
      status = 'failed'
      and confirmed_at is null
      and cancelled_at is null
      and expired_at is null
      and failed_at is not null
      and confirmed_attachment_id is null
      and last_error_code is not null
    )
  ),
  constraint ai_content_attachment_upload_sessions_tenant_identity_unique
    unique (id, workspace_id, brand_id)
);

create unique index ai_content_attachment_upload_sessions_nonce_uq
  on ai_content_attachment_upload_sessions (nonce);

create index ai_content_attachment_upload_sessions_generation_fk_idx
  on ai_content_attachment_upload_sessions (
    generation_id,
    workspace_id,
    brand_id
  );

create index ai_content_attachment_upload_sessions_actor_fk_idx
  on ai_content_attachment_upload_sessions (workspace_id, created_by_user_id)
  where created_by_user_id is not null;

create unique index ai_content_attachment_upload_sessions_storage_path_uq
  on ai_content_attachment_upload_sessions (storage_path)
  where not is_legacy_backfill;

create unique index ai_content_attachment_upload_sessions_attachment_uq
  on ai_content_attachment_upload_sessions (confirmed_attachment_id)
  where confirmed_attachment_id is not null;

create index ai_content_attachment_upload_sessions_pending_expiry_idx
  on ai_content_attachment_upload_sessions (token_expires_at, id)
  where status = 'pending';

create index ai_content_upload_sessions_generation_reservation_idx
  on ai_content_attachment_upload_sessions (generation_id, status, created_at, id)
  where status = 'pending';

create table ai_content_attachment_storage_path_guards (
  storage_path text primary key,
  legacy_session_count bigint not null default 0,
  nonlegacy_session_count integer not null default 0,
  constraint ai_content_attachment_storage_path_guards_counts_check check (
    legacy_session_count >= 0
    and nonlegacy_session_count between 0 and 1
  )
);

create function reserve_ai_content_attachment_storage_path()
returns trigger
language plpgsql
as $$
declare
  reserved_path text;
begin
  insert into ai_content_attachment_storage_path_guards (
    storage_path,
    legacy_session_count,
    nonlegacy_session_count
  )
  values (
    new.storage_path,
    case when new.is_legacy_backfill then 1 else 0 end,
    case when new.is_legacy_backfill then 0 else 1 end
  )
  on conflict (storage_path) do update
  set legacy_session_count =
        ai_content_attachment_storage_path_guards.legacy_session_count
        + excluded.legacy_session_count,
      nonlegacy_session_count =
        ai_content_attachment_storage_path_guards.nonlegacy_session_count
        + excluded.nonlegacy_session_count
  where ai_content_attachment_storage_path_guards.nonlegacy_session_count = 0
    and (
      excluded.nonlegacy_session_count = 0
      or ai_content_attachment_storage_path_guards.legacy_session_count = 0
    )
  returning storage_path into reserved_path;

  if reserved_path is null then
    raise unique_violation
      using constraint =
        'ai_content_attachment_upload_sessions_storage_path_collision',
        message = 'ai_content_attachment_upload_session_storage_path_conflict';
  end if;
  return new;
end;
$$;

create trigger ai_content_attachment_upload_sessions_reserve_storage_path
after insert on ai_content_attachment_upload_sessions
for each row
execute function reserve_ai_content_attachment_storage_path();

create function release_ai_content_attachment_storage_path()
returns trigger
language plpgsql
as $$
begin
  update ai_content_attachment_storage_path_guards
  set legacy_session_count =
        legacy_session_count
        - case when old.is_legacy_backfill then 1 else 0 end,
      nonlegacy_session_count =
        nonlegacy_session_count
        - case when old.is_legacy_backfill then 0 else 1 end
  where storage_path = old.storage_path;

  delete from ai_content_attachment_storage_path_guards
  where storage_path = old.storage_path
    and legacy_session_count = 0
    and nonlegacy_session_count = 0;
  return old;
end;
$$;

create trigger ai_content_attachment_upload_sessions_release_storage_path
after delete on ai_content_attachment_upload_sessions
for each row
execute function release_ai_content_attachment_storage_path();

alter table ai_content_generation_attachments
  add column upload_session_id uuid null,
  add column deletion_reason text null,
  add column physical_delete_status text not null default 'none',
  add column physically_deleted_at timestamptz null;

alter table ai_content_generation_attachments
  add constraint ai_content_generation_attachments_physical_status_check check (
    physical_delete_status in (
      'none', 'pending', 'deleting', 'failed', 'deleted', 'dead_letter'
    )
  ),
  add constraint ai_content_generation_attachments_physically_deleted_check check (
    (physical_delete_status = 'deleted' and physically_deleted_at is not null)
    or (physical_delete_status <> 'deleted' and physically_deleted_at is null)
  ),
  add constraint ai_content_generation_attachments_tenant_identity_unique
    unique (id, workspace_id, brand_id);

alter table ai_content_attachment_upload_sessions
  add constraint ai_content_attachment_upload_sessions_confirmed_attachment_fk
    foreign key (confirmed_attachment_id, workspace_id, brand_id)
    references ai_content_generation_attachments(id, workspace_id, brand_id)
    on delete no action
    deferrable initially deferred;

insert into ai_content_attachment_upload_sessions (
  id,
  generation_id,
  workspace_id,
  brand_id,
  created_by_user_id,
  nonce,
  role,
  file_name,
  expected_mime_type,
  expected_size_bytes,
  expected_checksum,
  storage_url,
  storage_path,
  status,
  token_expires_at,
  confirmed_at,
  confirmed_attachment_id,
  is_legacy_backfill,
  created_at,
  updated_at
)
select
  md5('ai-content-attachment-upload-session:' || attachment.id::text)::uuid,
  attachment.generation_id,
  attachment.workspace_id,
  attachment.brand_id,
  null,
  md5('ai-content-attachment-upload-nonce:' || attachment.id::text)::uuid,
  attachment.role,
  attachment.file_name,
  attachment.mime_type,
  attachment.size_bytes,
  attachment.checksum,
  attachment.storage_url,
  attachment.storage_path,
  'confirmed',
  attachment.created_at + interval '10 minutes',
  attachment.created_at,
  attachment.id,
  true,
  attachment.created_at,
  attachment.created_at
from ai_content_generation_attachments attachment
on conflict do nothing;

update ai_content_generation_attachments attachment
set upload_session_id =
      md5('ai-content-attachment-upload-session:' || attachment.id::text)::uuid,
    deletion_reason = case
      when attachment.deleted_at is not null
        then coalesce(attachment.deletion_reason, 'legacy_deleted')
      else attachment.deletion_reason
    end,
    physical_delete_status = case
      when attachment.deleted_at is not null then 'pending'
      else attachment.physical_delete_status
    end
where attachment.upload_session_id is null;

alter table ai_content_generation_attachments
  add constraint ai_content_generation_attachments_upload_session_unique
    unique (upload_session_id),
  add constraint ai_content_generation_attachments_upload_session_fk
    foreign key (upload_session_id, workspace_id, brand_id)
    references ai_content_attachment_upload_sessions(id, workspace_id, brand_id)
    on delete no action
    deferrable initially deferred;

create table ai_content_attachment_deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  brand_id uuid not null,
  generation_id uuid not null,
  attachment_id uuid null,
  upload_session_id uuid null,
  storage_url text null,
  storage_path text not null,
  reason text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  max_attempts integer not null default 10,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid null,
  lease_expires_at timestamptz null,
  last_error_category text null,
  last_error_message text null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_content_attachment_deletion_jobs_status_check check (
    status in ('pending', 'deleting', 'failed', 'deleted', 'dead_letter')
  ),
  constraint ai_content_attachment_deletion_jobs_attempts_check check (
    attempt_count >= 0
    and max_attempts > 0
    and attempt_count <= max_attempts
  ),
  constraint ai_content_attachment_deletion_jobs_lease_check check (
    (
      status = 'deleting'
      and lease_token is not null
      and lease_expires_at is not null
    )
    or (
      status <> 'deleting'
      and lease_token is null
      and lease_expires_at is null
    )
  ),
  constraint ai_content_attachment_deletion_jobs_completion_check check (
    (status = 'deleted' and completed_at is not null)
    or (status <> 'deleted' and completed_at is null)
  ),
  constraint ai_content_attachment_deletion_jobs_workspace_path_unique
    unique (workspace_id, storage_path)
);

create index ai_content_attachment_deletion_jobs_due_idx
  on ai_content_attachment_deletion_jobs (next_attempt_at, created_at, id)
  where status in ('pending', 'failed');

create index ai_content_attachment_deletion_jobs_expired_lease_idx
  on ai_content_attachment_deletion_jobs (lease_expires_at, id)
  where status = 'deleting';

insert into ai_content_attachment_deletion_jobs (
  id,
  workspace_id,
  brand_id,
  generation_id,
  attachment_id,
  upload_session_id,
  storage_url,
  storage_path,
  reason,
  status,
  next_attempt_at,
  created_at,
  updated_at
)
select
  md5(
    'ai-content-attachment-deletion-job:'
    || attachment.workspace_id::text || ':' || attachment.storage_path
  )::uuid,
  attachment.workspace_id,
  attachment.brand_id,
  attachment.generation_id,
  attachment.id,
  attachment.upload_session_id,
  attachment.storage_url,
  attachment.storage_path,
  coalesce(attachment.deletion_reason, 'legacy_deleted'),
  'pending',
  now(),
  now(),
  now()
from ai_content_generation_attachments attachment
where attachment.deleted_at is not null
  and attachment.physically_deleted_at is null
on conflict (workspace_id, storage_path) do nothing;

update ai_content_generation_jobs job
set payload_json = jsonb_set(
      job.payload_json,
      '{contentGenerationInput}',
      generation.generation_input_snapshot -> 'contentGenerationInput',
      true
    ),
    updated_at = now()
from ai_content_generations generation
where generation.id = job.generation_id
  and generation.workspace_id = job.workspace_id
  and generation.brand_id = job.brand_id
  and job.status in ('queued', 'processing')
  and jsonb_typeof(
    generation.generation_input_snapshot -> 'contentGenerationInput'
  ) is not null;

with requested_attachments as (
  select
    analysis.id as analysis_id,
    requested.requested_id,
    requested.position
  from ai_content_subject_analyses analysis
  cross join lateral jsonb_array_elements_text(
    analysis.attachment_ids_json
  ) with ordinality as requested(requested_id, position)
  where analysis.contract_version = 'subject-analysis.v2'
    and analysis.superseded_at is null
),
snapshots as (
  select
    requested.analysis_id,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', attachment.id,
          'generationId', attachment.generation_id,
          'role', attachment.role,
          'fileName', attachment.file_name,
          'mimeType', attachment.mime_type,
          'sizeBytes', attachment.size_bytes,
          'checksum', attachment.checksum,
          'storageUrl', attachment.storage_url,
          'storagePath', attachment.storage_path,
          'createdAt', to_char(
            attachment.created_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
        )
        order by requested.position
      ) filter (where attachment.id is not null),
      '[]'::jsonb
    ) as attachment_snapshot,
    coalesce(
      jsonb_agg(to_jsonb(requested.requested_id) order by requested.position)
        filter (where attachment.id is null),
      '[]'::jsonb
    ) as missing_ids
  from requested_attachments requested
  join ai_content_subject_analyses analysis
    on analysis.id = requested.analysis_id
  left join ai_content_generation_attachments attachment
    on attachment.id::text = requested.requested_id
   and attachment.generation_id = analysis.generation_id
   and attachment.workspace_id = analysis.workspace_id
   and attachment.brand_id = analysis.brand_id
  group by requested.analysis_id
)
update ai_content_subject_analyses analysis
set input_json = jsonb_set(
      jsonb_set(
        analysis.input_json,
        '{attachmentSnapshot}',
        snapshots.attachment_snapshot,
        true
      ),
      '{attachmentSnapshotMissingIds}',
      snapshots.missing_ids,
      true
    ),
    updated_at = now()
from snapshots
where snapshots.analysis_id = analysis.id;

update ai_content_subject_analyses
set input_json = jsonb_set(
      jsonb_set(
        input_json,
        '{attachmentSnapshot}',
        '[]'::jsonb,
        true
      ),
      '{attachmentSnapshotMissingIds}',
      '[]'::jsonb,
      true
    ),
    updated_at = now()
where contract_version = 'subject-analysis.v2'
  and superseded_at is null
  and jsonb_array_length(attachment_ids_json) = 0;

create function ai_content_attachment_upload_sessions_immutable_metadata()
returns trigger
language plpgsql
as $$
begin
  if new.generation_id is distinct from old.generation_id
    or new.workspace_id is distinct from old.workspace_id
    or new.brand_id is distinct from old.brand_id
    or new.created_by_user_id is distinct from old.created_by_user_id
    or new.nonce is distinct from old.nonce
    or new.role is distinct from old.role
    or new.file_name is distinct from old.file_name
    or new.expected_mime_type is distinct from old.expected_mime_type
    or new.expected_size_bytes is distinct from old.expected_size_bytes
    or new.expected_checksum is distinct from old.expected_checksum
    or new.storage_path is distinct from old.storage_path
    or new.token_expires_at is distinct from old.token_expires_at
    or new.created_at is distinct from old.created_at
  then
    raise exception 'ai_content_attachment_upload_session_metadata_immutable';
  end if;
  return new;
end;
$$;

create trigger ai_content_attachment_upload_sessions_immutable_metadata
before update on ai_content_attachment_upload_sessions
for each row
execute function ai_content_attachment_upload_sessions_immutable_metadata();

create function enforce_ai_content_attachment_upload_session_transition()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'pending'
    and (
      new.status is distinct from old.status
      or new.confirmed_at is distinct from old.confirmed_at
      or new.cancelled_at is distinct from old.cancelled_at
      or new.expired_at is distinct from old.expired_at
      or new.failed_at is distinct from old.failed_at
      or new.confirmed_attachment_id
        is distinct from old.confirmed_attachment_id
      or new.last_error_code is distinct from old.last_error_code
      or new.is_legacy_backfill is distinct from old.is_legacy_backfill
    )
  then
    raise exception
      'ai_content_attachment_upload_session_transition_invalid';
  end if;
  return new;
end;
$$;

create trigger ai_content_attachment_upload_sessions_enforce_transition
before update on ai_content_attachment_upload_sessions
for each row
execute function enforce_ai_content_attachment_upload_session_transition();

create trigger ai_content_attachment_upload_sessions_set_updated_at
before update on ai_content_attachment_upload_sessions
for each row execute function set_updated_at();

create trigger ai_content_attachment_deletion_jobs_set_updated_at
before update on ai_content_attachment_deletion_jobs
for each row execute function set_updated_at();

create function enqueue_ai_content_attachment_deletion()
returns trigger
language plpgsql
as $$
begin
  if old.physical_delete_status <> 'deleted' then
    insert into ai_content_attachment_deletion_jobs (
      id,
      workspace_id,
      brand_id,
      generation_id,
      attachment_id,
      upload_session_id,
      storage_url,
      storage_path,
      reason,
      status,
      next_attempt_at
    )
    values (
      md5(
        'ai-content-attachment-deletion-job:'
        || old.workspace_id::text || ':' || old.storage_path
      )::uuid,
      old.workspace_id,
      old.brand_id,
      old.generation_id,
      old.id,
      old.upload_session_id,
      old.storage_url,
      old.storage_path,
      coalesce(old.deletion_reason, 'attachment_deleted'),
      'pending',
      now()
    )
    on conflict (workspace_id, storage_path) do nothing;
  end if;
  return old;
end;
$$;

create trigger ai_content_generation_attachments_enqueue_deletion
before delete on ai_content_generation_attachments
for each row
execute function enqueue_ai_content_attachment_deletion();

create function enqueue_ai_content_upload_session_deletion()
returns trigger
language plpgsql
as $$
begin
  if old.confirmed_attachment_id is null
    and old.status in ('pending', 'cancelled', 'failed', 'expired')
  then
    insert into ai_content_attachment_deletion_jobs (
      id,
      workspace_id,
      brand_id,
      generation_id,
      attachment_id,
      upload_session_id,
      storage_url,
      storage_path,
      reason,
      status,
      next_attempt_at
    )
    values (
      md5(
        'ai-content-attachment-deletion-job:'
        || old.workspace_id::text || ':' || old.storage_path
      )::uuid,
      old.workspace_id,
      old.brand_id,
      old.generation_id,
      null,
      old.id,
      old.storage_url,
      old.storage_path,
      'upload_session_' || old.status,
      'pending',
      greatest(now(), old.token_expires_at)
    )
    on conflict (workspace_id, storage_path) do nothing;
  end if;
  return old;
end;
$$;

create trigger ai_content_attachment_upload_sessions_enqueue_deletion
before delete on ai_content_attachment_upload_sessions
for each row
execute function enqueue_ai_content_upload_session_deletion();

commit;
