begin;

create table ai_content_cutovers (
  id uuid primary key,
  status text not null check (status in (
    'prepared','maintenance_verified','migration_body_complete',
    'backend_verified','completed','abandoned_pre_marker'
  )),
  migration_id text not null,
  schema_owner_role_name name not null,
  application_role_name name not null,
  operator_role_name name not null,
  migration_role_name name not null,
  cleanup_role_name name not null,
  bypass_token_sha256 text not null check (bypass_token_sha256 ~ '^[0-9a-f]{64}$'),
  cleanup_token_sha256 text not null check (cleanup_token_sha256 ~ '^[0-9a-f]{64}$'),
  database_role_catalog_sha256 text not null check (database_role_catalog_sha256 ~ '^[0-9a-f]{64}$'),
  provider_backup_id text not null,
  provider_snapshot_created_at timestamptz not null,
  incident_bundle_sha256 text not null check (incident_bundle_sha256 ~ '^[0-9a-f]{64}$'),
  preserved_data_manifest_sha256 text not null check (preserved_data_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  proposal_preflight_identity_json jsonb not null,
  proposal_preflight_identity_sha256 text not null check (proposal_preflight_identity_sha256 ~ '^[0-9a-f]{64}$'),
  proposal_preflight_transfer_sha256 text not null check (proposal_preflight_transfer_sha256 ~ '^[0-9a-f]{64}$'),
  intended_release_sha text not null check (intended_release_sha ~ '^[0-9a-f]{40}$'),
  abandoned_reason text null,
  successor_cutover_id uuid null references ai_content_cutovers(id) on delete restrict deferrable initially deferred,
  cleanup_credential_revoked_at timestamptz null,
  cleanup_revocation_evidence_sha256 text null check (cleanup_revocation_evidence_sha256 is null or cleanup_revocation_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  latest_status_event_sha256 text not null check (latest_status_event_sha256 ~ '^[0-9a-f]{64}$'),
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint ai_content_cutover_abandonment_check check (
    (status = 'abandoned_pre_marker' and abandoned_reason is not null)
    or (status <> 'abandoned_pre_marker' and abandoned_reason is null and successor_cutover_id is null)
  ),
  constraint ai_content_cutover_cleanup_revocation_check check (
    (status = 'completed' and cleanup_credential_revoked_at is not null and cleanup_revocation_evidence_sha256 is not null)
    or (status <> 'completed' and cleanup_credential_revoked_at is null and cleanup_revocation_evidence_sha256 is null)
  ),
  constraint ai_content_cutover_preflight_identity_check check ((
    jsonb_typeof(proposal_preflight_identity_json)='object'
    and proposal_preflight_identity_json ?& array[
      'preflightCandidateSha','contentProposalWorkerImageDigest','proposalWorkerSourceSha',
      'proposalWorkerTreeSha','proposalContractSourceSha256','proposalSchemaSha256',
      'proposalCatalogSha256','proposalModelId','proposalCommandDescriptorSha256','migrationSha256'
    ]
    and proposal_preflight_identity_json - array[
      'preflightCandidateSha','contentProposalWorkerImageDigest','proposalWorkerSourceSha',
      'proposalWorkerTreeSha','proposalContractSourceSha256','proposalSchemaSha256',
      'proposalCatalogSha256','proposalModelId','proposalCommandDescriptorSha256','migrationSha256'
    ] = '{}'::jsonb
    and proposal_preflight_identity_json->>'preflightCandidateSha' ~ '^[0-9a-f]{40}$'
    and proposal_preflight_identity_json->>'contentProposalWorkerImageDigest' ~ '^sha256:[0-9a-f]{64}$'
    and proposal_preflight_identity_json->>'proposalWorkerSourceSha' ~ '^[0-9a-f]{40}$'
    and proposal_preflight_identity_json->>'proposalWorkerTreeSha' ~ '^[0-9a-f]{40}$'
    and proposal_preflight_identity_json->>'proposalContractSourceSha256' ~ '^[0-9a-f]{64}$'
    and proposal_preflight_identity_json->>'proposalSchemaSha256' ~ '^[0-9a-f]{64}$'
    and proposal_preflight_identity_json->>'proposalCatalogSha256' ~ '^[0-9a-f]{64}$'
    and proposal_preflight_identity_json->>'proposalModelId'='gpt-5.6-terra'
    and proposal_preflight_identity_json->>'proposalCommandDescriptorSha256' ~ '^[0-9a-f]{64}$'
    and proposal_preflight_identity_json->>'migrationSha256' ~ '^[0-9a-f]{64}$'
  ) is true),
  constraint ai_content_cutover_roles_distinct_check check (
    schema_owner_role_name <> application_role_name
    and schema_owner_role_name <> operator_role_name
    and schema_owner_role_name <> migration_role_name
    and schema_owner_role_name <> cleanup_role_name
    and application_role_name <> operator_role_name
    and application_role_name <> migration_role_name
    and application_role_name <> cleanup_role_name
    and operator_role_name <> migration_role_name
    and operator_role_name <> cleanup_role_name
    and migration_role_name <> cleanup_role_name
  )
);

create unique index ai_content_cutovers_one_active_idx
  on ai_content_cutovers ((true))
  where status not in ('completed','abandoned_pre_marker');

create table ai_content_cutover_status_events (
  cutover_id uuid not null references ai_content_cutovers(id) on delete restrict,
  sequence_number integer not null check (sequence_number >= 0),
  from_status text null,
  to_status text not null,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  post_075_bootstrap_object_catalog_sha256 text null,
  previous_event_sha256 text null check (previous_event_sha256 is null or previous_event_sha256 ~ '^[0-9a-f]{64}$'),
  event_sha256 text not null unique check (event_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (cutover_id, sequence_number),
  constraint ai_content_cutover_status_events_post_075_object_catalog_check check ((
    (to_status='migration_body_complete'
      and post_075_bootstrap_object_catalog_sha256 ~ '^[0-9a-f]{64}$')
    or (to_status<>'migration_body_complete'
      and post_075_bootstrap_object_catalog_sha256 is null)
  ) is true)
);

create table ai_content_maintenance_state (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  cutover_id uuid null references ai_content_cutovers(id) on delete restrict,
  enabled_at timestamptz null,
  constraint ai_content_maintenance_state_pair_check check (
    (not enabled and cutover_id is null and enabled_at is null)
    or (enabled and cutover_id is not null and enabled_at is not null)
  )
);

insert into ai_content_maintenance_state (singleton, enabled, cutover_id, enabled_at)
values (true, false, null, null)
on conflict (singleton) do nothing;

create table ai_content_bootstrap_state (
  singleton boolean primary key default true check (singleton),
  authorization_request_id text not null,
  authorization_sha256 text not null check (authorization_sha256 ~ '^[0-9a-f]{64}$'),
  migration_role_name name not null,
  schema_owner_role_name name not null,
  application_role_name name not null,
  operator_role_name name not null,
  cleanup_role_name name not null,
  migration_sha256 text not null check (migration_sha256 ~ '^[0-9a-f]{64}$'),
  role_catalog_sha256 text not null check (role_catalog_sha256 ~ '^[0-9a-f]{64}$'),
  object_catalog_sha256 text not null check (object_catalog_sha256 ~ '^[0-9a-f]{64}$'),
  fence_security_catalog_sha256 text not null check (fence_security_catalog_sha256 ~ '^[0-9a-f]{64}$'),
  final_fence_security_catalog_sha256 text null check (final_fence_security_catalog_sha256 is null or final_fence_security_catalog_sha256 ~ '^[0-9a-f]{64}$'),
  event_trigger_catalog_before_json jsonb not null check (jsonb_typeof(event_trigger_catalog_before_json)='object'),
  event_trigger_catalog_before_sha256 text not null check (event_trigger_catalog_before_sha256 ~ '^[0-9a-f]{64}$'),
  event_trigger_catalog_before_count integer not null check (event_trigger_catalog_before_count>=0),
  event_trigger_catalog_after_sha256 text null check (event_trigger_catalog_after_sha256 is null or event_trigger_catalog_after_sha256 ~ '^[0-9a-f]{64}$'),
  event_trigger_catalog_after_count integer null check (event_trigger_catalog_after_count is null or event_trigger_catalog_after_count>=1),
  install_request_json jsonb not null check (jsonb_typeof(install_request_json)='object'),
  install_request_sha256 text not null check (install_request_sha256 ~ '^[0-9a-f]{64}$'),
  provider_attestation_json jsonb null check (provider_attestation_json is null or jsonb_typeof(provider_attestation_json)='object'),
  provider_attestation_sha256 text null check (provider_attestation_sha256 is null or provider_attestation_sha256 ~ '^[0-9a-f]{64}$'),
  attestation_consumed_at timestamptz null,
  revocation_request_json jsonb null check (revocation_request_json is null or jsonb_typeof(revocation_request_json)='object'),
  revocation_request_sha256 text null check (revocation_request_sha256 is null or revocation_request_sha256 ~ '^[0-9a-f]{64}$'),
  cutover_075_fence_registration_xid text null,
  cutover_075_fence_registration_cutover_id uuid null,
  cutover_075_acl_command_tag text null check (
    cutover_075_acl_command_tag is null or cutover_075_acl_command_tag in ('GRANT','REVOKE')
  ),
  cutover_075_acl_object_identity text null,
  cutover_075_acl_grantee text null,
  cutover_075_acl_privileges text null,
  cutover_075_acl_pre_catalog_sha256 text null check (
    cutover_075_acl_pre_catalog_sha256 is null or cutover_075_acl_pre_catalog_sha256 ~ '^[0-9a-f]{64}$'
  ),
  cutover_075_acl_post_catalog_sha256 text null check (
    cutover_075_acl_post_catalog_sha256 is null or cutover_075_acl_post_catalog_sha256 ~ '^[0-9a-f]{64}$'
  ),
  created_at timestamptz not null default now(),
  constraint ai_content_bootstrap_provider_evidence_pair_check check (
    (provider_attestation_json is null and provider_attestation_sha256 is null and attestation_consumed_at is null
      and revocation_request_json is null and revocation_request_sha256 is null
      and event_trigger_catalog_after_sha256 is null and event_trigger_catalog_after_count is null
      and final_fence_security_catalog_sha256 is null)
    or (provider_attestation_json is not null and provider_attestation_sha256 is not null
      and revocation_request_json is not null and revocation_request_sha256 is not null
      and event_trigger_catalog_after_sha256 is not null and event_trigger_catalog_after_count is not null
      and final_fence_security_catalog_sha256 is not null)
  ),
  constraint ai_content_bootstrap_roles_distinct_check
    check (
      schema_owner_role_name<>application_role_name
      and schema_owner_role_name<>operator_role_name
      and schema_owner_role_name<>migration_role_name
      and schema_owner_role_name<>cleanup_role_name
      and application_role_name<>operator_role_name
      and application_role_name<>migration_role_name
      and application_role_name<>cleanup_role_name
      and operator_role_name<>migration_role_name
      and operator_role_name<>cleanup_role_name
      and migration_role_name<>cleanup_role_name
    ),
  constraint ai_content_bootstrap_075_registration_pair_check check (
    (cutover_075_fence_registration_xid is null
      and cutover_075_fence_registration_cutover_id is null)
    or (length(cutover_075_fence_registration_xid)>0
      and cutover_075_fence_registration_cutover_id is not null)
  ),
  constraint ai_content_bootstrap_075_acl_command_pair_check check (
    (cutover_075_acl_command_tag is null and cutover_075_acl_object_identity is null
      and cutover_075_acl_grantee is null and cutover_075_acl_privileges is null
      and cutover_075_acl_pre_catalog_sha256 is null and cutover_075_acl_post_catalog_sha256 is null)
    or (cutover_075_acl_command_tag is not null and length(trim(cutover_075_acl_object_identity))>0
      and length(trim(cutover_075_acl_grantee))>0 and length(trim(cutover_075_acl_privileges))>0
      and cutover_075_acl_pre_catalog_sha256 is not null and cutover_075_acl_post_catalog_sha256 is not null)
  )
);

create table ai_content_ddl_allowlist (
  migration_id text not null,
  command_tag text not null,
  object_identity_pattern text not null,
  primary key (migration_id, command_tag, object_identity_pattern),
  constraint ai_content_ddl_allowlist_migration_check
    check (migration_id='075_ai_content_three_format_cutover.sql')
);

create table ai_content_write_fence_catalog (
  relation_name text primary key,
  relation_class text not null check (relation_class in ('customer_execution','cutover_control')),
  row_classifier text not null check (row_classifier in (
    'whole_relation','legacy_automated_topic','scheduled_proposal_refresh','legacy_content_job',
    'ai_content_generated_artifact','ai_content_scheduled_publish','ai_content_publish_attempt','daily_generation_automation'
  )),
  reviewed_at timestamptz not null default now()
);

insert into ai_content_write_fence_catalog (relation_name, relation_class, row_classifier) values
  ('ai_content_generations','customer_execution','whole_relation'),
  ('ai_content_generation_outputs','customer_execution','whole_relation'),
  ('ai_content_generation_attachments','customer_execution','whole_relation'),
  ('ai_content_generation_jobs','customer_execution','whole_relation'),
  ('ai_content_generation_references','customer_execution','whole_relation'),
  ('ai_content_usage_ledger','customer_execution','whole_relation'),
  ('ai_content_subject_analyses','customer_execution','whole_relation'),
  ('ai_content_subject_images','customer_execution','whole_relation'),
  ('ai_content_subject_appeal_regeneration_keys','customer_execution','whole_relation'),
  ('ai_content_wiki_version_snapshots','customer_execution','whole_relation'),
  ('ai_content_one_time_avatar_receipts','customer_execution','whole_relation'),
  ('ai_content_one_time_avatar_revocations','customer_execution','whole_relation'),
  ('ai_content_generation_reference_migration_audits','customer_execution','whole_relation'),
  ('ai_content_proposal_batches','customer_execution','whole_relation'),
  ('ai_content_proposals','customer_execution','whole_relation'),
  ('ai_content_approved_proposal_versions','customer_execution','whole_relation'),
  ('ai_content_generation_briefs','customer_execution','whole_relation'),
  ('ai_content_proposal_jobs','customer_execution','whole_relation'),
  ('ai_content_create_idempotency_records','customer_execution','whole_relation'),
  ('ai_content_attachment_upload_sessions','customer_execution','whole_relation'),
  ('ai_content_attachment_storage_path_guards','customer_execution','whole_relation'),
  ('ai_content_attachment_deletion_jobs','customer_execution','whole_relation'),
  ('ai_content_analyzed_subject_snapshots','customer_execution','whole_relation'),
  ('ai_content_proposal_research_snapshots','customer_execution','whole_relation'),
  ('ai_content_generation_input_snapshots','customer_execution','whole_relation'),
  ('ai_content_output_research_snapshots','customer_execution','whole_relation'),
  ('ai_content_generation_render_jobs','customer_execution','whole_relation'),
  ('content_topics','customer_execution','whole_relation'),
  ('topic_publish_groups','customer_execution','whole_relation'),
  ('topic_uploads','customer_execution','whole_relation'),
  ('master_drafts','customer_execution','whole_relation'),
  ('channel_outputs','customer_execution','whole_relation'),
  ('auto_approval_checks','customer_execution','whole_relation'),
  ('automation_runs','customer_execution','daily_generation_automation'),
  ('llm_runs','customer_execution','whole_relation'),
  ('review_events','customer_execution','whole_relation'),
  ('regeneration_requests','customer_execution','whole_relation'),
  ('brand_format_rotation_states','customer_execution','whole_relation'),
  ('topic_rows','customer_execution','legacy_automated_topic'),
  ('source_crawl_runs','customer_execution','scheduled_proposal_refresh'),
  ('jobs','customer_execution','legacy_content_job'),
  ('storage_artifacts','customer_execution','ai_content_generated_artifact'),
  ('publish_queue','customer_execution','ai_content_scheduled_publish'),
  ('publish_attempts','customer_execution','ai_content_publish_attempt'),
  ('ai_content_cutovers','cutover_control','whole_relation'),
  ('ai_content_cutover_status_events','cutover_control','whole_relation'),
  ('ai_content_maintenance_state','cutover_control','whole_relation'),
  ('ai_content_bootstrap_state','cutover_control','whole_relation'),
  ('ai_content_ddl_allowlist','cutover_control','whole_relation'),
  ('ai_content_write_fence_catalog','cutover_control','whole_relation');

do $$
declare missing text;
begin
  select string_agg(c.relation_name, ', ' order by c.relation_name)
    into missing
    from ai_content_write_fence_catalog c
   where c.relation_class='customer_execution'
     and to_regclass('public.' || c.relation_name) is null;
  if missing is not null then
    raise exception 'ai_content_write_fence_relation_missing:%', missing;
  end if;
end;
$$;

create function verify_ai_content_cutover_status_chain_locked(p_cutover public.ai_content_cutovers) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare event_row public.ai_content_cutover_status_events%rowtype;
declare previous_hash text;
declare previous_status text;
declare expected_sequence integer := 0;
declare expected_hash text;
begin
  for event_row in
    select * from public.ai_content_cutover_status_events
     where cutover_id=p_cutover.id order by sequence_number for update
  loop
    if event_row.sequence_number<>expected_sequence
       or event_row.previous_event_sha256 is distinct from previous_hash
       or (expected_sequence=0 and (event_row.from_status is not null or event_row.to_status<>'prepared'))
       or (expected_sequence>0 and event_row.from_status is distinct from previous_status) then
      raise exception 'ai_content_cutover_status_chain_invalid';
    end if;
    if expected_sequence=0 then
      expected_hash := encode(digest(concat_ws('|',p_cutover.id::text,'0','', 'prepared',
        event_row.evidence_sha256,p_cutover.schema_owner_role_name::text,
        p_cutover.application_role_name::text,p_cutover.operator_role_name::text,
        p_cutover.migration_role_name::text,p_cutover.cleanup_role_name::text,
        p_cutover.bypass_token_sha256,p_cutover.cleanup_token_sha256,
        p_cutover.database_role_catalog_sha256,p_cutover.proposal_preflight_identity_sha256,
        p_cutover.proposal_preflight_transfer_sha256),'sha256'),'hex');
    else
      expected_hash := encode(digest(concat_ws('|',p_cutover.id::text,event_row.sequence_number::text,
        event_row.from_status,event_row.to_status,event_row.evidence_sha256,
        event_row.post_075_bootstrap_object_catalog_sha256,
        event_row.previous_event_sha256),'sha256'),'hex');
    end if;
    if event_row.event_sha256<>expected_hash then
      raise exception 'ai_content_cutover_status_chain_hash_invalid';
    end if;
    previous_hash := event_row.event_sha256;
    previous_status := event_row.to_status;
    expected_sequence := expected_sequence+1;
  end loop;
  if expected_sequence=0 or p_cutover.latest_status_event_sha256 is distinct from previous_hash
     or p_cutover.status is distinct from previous_status then
    raise exception 'ai_content_cutover_status_chain_pointer_invalid';
  end if;
  return true;
end;
$$;

create function verify_ai_content_cutover_status_chain(p_cutover_id uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare cutover_row public.ai_content_cutovers%rowtype;
begin
  select * into strict cutover_row from public.ai_content_cutovers where id=p_cutover_id for update;
  return public.verify_ai_content_cutover_status_chain_locked(cutover_row);
end;
$$;

create function lock_ai_content_cutover_transaction_state(p_cutover_id uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare bootstrap public.ai_content_bootstrap_state%rowtype;
begin
  select * into strict bootstrap from public.ai_content_bootstrap_state where singleton for share;
  if session_user<>bootstrap.migration_role_name::text then
    raise exception 'ai_content_cutover_lock_identity_invalid';
  end if;
  lock table public.ai_content_ddl_allowlist in share mode;
  perform 1 from public.ai_content_cutovers where id=p_cutover_id for update;
  if not found then raise exception 'ai_content_cutover_lock_missing'; end if;
  perform 1 from public.ai_content_maintenance_state where singleton for share;
  return true;
end;
$$;

create function verify_ai_content_cutover_preflight_identity(
  p_cutover_id uuid,p_identity jsonb,p_identity_sha256 text,p_transfer_sha256 text
) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare bootstrap public.ai_content_bootstrap_state%rowtype;
declare cutover_row public.ai_content_cutovers%rowtype;
declare maintenance public.ai_content_maintenance_state%rowtype;
declare outer_role text;
declare marker_present boolean;
begin
  if p_cutover_id is null or p_identity is null or p_identity_sha256 is null
     or p_transfer_sha256 is null then
    raise exception 'ai_content_cutover_preflight_identity_input_invalid';
  end if;
  select * into strict bootstrap
    from public.ai_content_bootstrap_state where singleton for share;
  outer_role:=coalesce(nullif(current_setting('role',true),'none'),session_user);
  if session_user is distinct from bootstrap.migration_role_name::text
     or outer_role is distinct from bootstrap.migration_role_name::text then
    raise exception 'ai_content_cutover_preflight_identity_role_invalid';
  end if;
  select * into cutover_row
    from public.ai_content_cutovers where id=p_cutover_id for update;
  if not found then
    raise exception 'ai_content_cutover_preflight_identity_state_invalid';
  end if;
  select * into strict maintenance
    from public.ai_content_maintenance_state where singleton for share;
  select exists(
    select 1 from public.schema_migrations
     where id='075_ai_content_three_format_cutover.sql'
  ) into marker_present;
  if cutover_row.migration_id is distinct from '075_ai_content_three_format_cutover.sql'
     or cutover_row.migration_role_name is distinct from bootstrap.migration_role_name
     or cutover_row.schema_owner_role_name is distinct from bootstrap.schema_owner_role_name
     or cutover_row.application_role_name is distinct from bootstrap.application_role_name
     or cutover_row.operator_role_name is distinct from bootstrap.operator_role_name
     or cutover_row.cleanup_role_name is distinct from bootstrap.cleanup_role_name
     or cutover_row.database_role_catalog_sha256 is distinct from bootstrap.role_catalog_sha256
     or maintenance.enabled is distinct from true
     or maintenance.cutover_id is distinct from p_cutover_id
     or ((
       (cutover_row.status='maintenance_verified' and not marker_present)
       or (cutover_row.status='migration_body_complete' and marker_present)
     )) is not true
     or not public.verify_ai_content_cutover_status_chain_locked(cutover_row) then
    raise exception 'ai_content_cutover_preflight_identity_state_invalid';
  end if;
  if p_identity is distinct from cutover_row.proposal_preflight_identity_json
     or p_identity_sha256 is distinct from cutover_row.proposal_preflight_identity_sha256
     or encode(digest(p_identity::text,'sha256'),'hex') is distinct from p_identity_sha256
     or encode(digest(cutover_row.proposal_preflight_identity_json::text,'sha256'),'hex')
       is distinct from cutover_row.proposal_preflight_identity_sha256
     or p_transfer_sha256 is distinct from cutover_row.proposal_preflight_transfer_sha256 then
    raise exception 'ai_content_cutover_preflight_identity_evidence_invalid';
  end if;
  return true;
end;
$$;

create function ai_content_cutover_bypass_allowed() returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare cutover uuid;
declare supplied_token text;
declare cutover_row public.ai_content_cutovers%rowtype;
declare bootstrap public.ai_content_bootstrap_state%rowtype;
declare locked_state record;
begin
  cutover := nullif(current_setting('app.ai_content_cutover_id', true), '')::uuid;
  supplied_token := nullif(current_setting('app.ai_content_cutover_token', true), '');
  if cutover is null or supplied_token is null then return false; end if;
  lock table public.ai_content_ddl_allowlist in share mode;
  select c as cutover_row,b as bootstrap into locked_state
      from public.ai_content_cutovers c
      join public.ai_content_maintenance_state m on m.singleton and m.enabled and m.cutover_id=c.id
      join public.ai_content_bootstrap_state b on b.singleton
     where c.id=cutover
     for update of c for share of m,b;
  if not found then return false; end if;
  cutover_row := locked_state.cutover_row;
  bootstrap := locked_state.bootstrap;
  if cutover_row.status is distinct from 'maintenance_verified'
     or cutover_row.migration_role_name is distinct from session_user
     or cutover_row.schema_owner_role_name is distinct from bootstrap.schema_owner_role_name
     or cutover_row.application_role_name is distinct from bootstrap.application_role_name
     or cutover_row.operator_role_name is distinct from bootstrap.operator_role_name
     or cutover_row.cleanup_role_name is distinct from bootstrap.cleanup_role_name
     or cutover_row.database_role_catalog_sha256 is distinct from bootstrap.role_catalog_sha256
     or cutover_row.bypass_token_sha256 is distinct from encode(digest(supplied_token,'sha256'),'hex')
     or exists (select 1 from public.schema_migrations where id='075_ai_content_three_format_cutover.sql') then
    return false;
  end if;
  return public.verify_ai_content_cutover_status_chain_locked(cutover_row);
end;
$$;

create function assert_ai_content_writable() returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if exists (select 1 from public.ai_content_maintenance_state where singleton and enabled)
     and not public.ai_content_cutover_bypass_allowed() then
    raise exception 'ai_content_maintenance' using errcode='P0001';
  end if;
end;
$$;

create function ai_content_075_acl_catalog(
  p_command_tag text,
  p_object_identity text,
  p_grantee text,
  p_privileges text
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  grantee_oid oid;
  privilege_names text[];
  protected_object_count integer;
begin
  if num_nonnulls(p_command_tag,p_object_identity,p_grantee,p_privileges) not in (0,4) then
    raise exception 'ai_content_075_acl_catalog_projection_invalid';
  end if;
  if p_command_tag is not null then
    if p_command_tag not in ('GRANT','REVOKE')
       or not (p_object_identity like any(array['table:public.%','function:public.%'])) then
      raise exception 'ai_content_075_acl_catalog_projection_invalid';
    end if;
    if p_grantee='PUBLIC' then
      grantee_oid:=0;
    else
      select role.oid into grantee_oid from pg_roles role where role.rolname=p_grantee;
      if grantee_oid is null then raise exception 'ai_content_075_acl_catalog_grantee_invalid'; end if;
    end if;
    if p_command_tag='REVOKE' and p_privileges='ALL' then
      privilege_names:=array[]::text[];
    elsif p_command_tag='GRANT' and p_object_identity like 'table:%'
          and p_privileges in ('SELECT','INSERT,SELECT') then
      privilege_names:=string_to_array(p_privileges,',');
    elsif p_command_tag='GRANT' and p_object_identity like 'function:%'
          and p_privileges='EXECUTE' then
      privilege_names:=array['EXECUTE'];
    else
      raise exception 'ai_content_075_acl_catalog_privileges_invalid';
    end if;
  end if;

  select relation_count+function_count into protected_object_count
    from (
      select
        (select count(*) from unnest(array[
          'ai_content_cutover_release_adoption_events','ai_content_cutover_release_adoptions',
          'ai_content_generation_operations','ai_content_generation_prompt_bindings',
          'ai_content_proposal_attempt_events','ai_content_proposal_compositions',
          'ai_content_proposal_job_contracts','ai_content_proposal_model_attempts',
          'ai_content_proposal_performance_audits','ai_content_proposal_research_attempt_events',
          'ai_content_proposal_research_attempts','ai_content_storage_cleanup_outbox',
          'automated_content_proposal_runs'
        ]) as expected(name) join pg_class relation on relation.oid=to_regclass('public.'||expected.name)
          where relation.relkind='r') relation_count,
        (select count(*) from unnest(array[
          'public.reject_ai_content_cutover_record_mutation()',
          'public.enforce_ai_content_generation_operation_identity()',
          'public.require_ai_content_generation_operation_on_insert()',
          'public.freeze_ai_content_generation_operation_identity()',
          'public.transition_ai_content_generation_operation(uuid,text,text)',
          'public.freeze_automated_content_proposal_run_identity()',
          'public.transition_automated_content_proposal_run(uuid,text,text,uuid,uuid,uuid,text,text)',
          'public.enforce_ai_content_proposal_research_attempt_contract()',
          'public.append_ai_content_proposal_research_attempt_event(uuid,uuid,integer,text,uuid,jsonb,text,text)',
          'public.complete_ai_content_proposal_research(uuid,uuid,jsonb,text,jsonb,text,text)',
          'public.enforce_ai_content_proposal_research_completion_pair()',
          'public.enforce_ai_content_proposal_composition_research_success()',
          'public.enforce_ai_content_proposal_model_attempt_contract()',
          'public.append_ai_content_proposal_attempt_event(uuid,uuid,integer,integer,text,text,text,text,text,text,text,text,boolean)',
          'public.enforce_ai_content_proposal_success_event()',
          'public.enforce_ai_content_prompt_binding_source()',
          'public.create_ai_content_generation_prompt_binding(uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb)',
          'public.freeze_topic_upload_operation_identity()',
          'public.create_ai_content_cutover_topic_upload(uuid,uuid,uuid,text,text,jsonb)',
          'public.enforce_ai_content_usage_reversal_identity()',
          'public.reject_ai_content_usage_ledger_mutation()',
          'public.begin_ai_content_cutover_release_adoption(uuid,uuid,text,text,text,text,text,text)',
          'public.append_ai_content_cutover_release_adoption_event(uuid,integer,integer,text,jsonb,text)',
          'public.claim_ai_content_storage_cleanup(uuid,uuid,text,text,uuid,integer)',
          'public.complete_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)',
          'public.fail_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)',
          'public.is_ai_content_storage_path_protected(uuid,text)',
          'public.ai_content_generation_input_v3_is_valid(jsonb)',
          'public.ai_content_plan_v2_is_valid(jsonb)',
          'public.ai_content_manifest_v3_is_valid(jsonb)',
          'public.enforce_ai_content_three_format_identity()',
          'public.ai_content_cutover_storage_value_to_path(text)',
          'public.ai_content_cutover_storage_candidates()',
          'public.ai_content_cutover_target_ids()',
          'public.start_ai_content_orchestration(uuid,uuid,uuid,jsonb,jsonb,uuid)'
        ]) as expected(identity) join pg_proc function on function.oid=to_regprocedure(expected.identity)) function_count
    ) counts;
  if protected_object_count<>48 then raise exception 'ai_content_075_acl_catalog_object_missing'; end if;

  if p_object_identity is not null and not (
    p_object_identity = any(array[
      'table:public.ai_content_cutover_release_adoption_events','table:public.ai_content_cutover_release_adoptions',
      'table:public.ai_content_generation_operations','table:public.ai_content_generation_prompt_bindings',
      'table:public.ai_content_proposal_attempt_events','table:public.ai_content_proposal_compositions',
      'table:public.ai_content_proposal_job_contracts','table:public.ai_content_proposal_model_attempts',
      'table:public.ai_content_proposal_performance_audits','table:public.ai_content_proposal_research_attempt_events',
      'table:public.ai_content_proposal_research_attempts','table:public.ai_content_storage_cleanup_outbox',
      'table:public.automated_content_proposal_runs',
      'function:public.reject_ai_content_cutover_record_mutation()',
      'function:public.enforce_ai_content_generation_operation_identity()',
      'function:public.require_ai_content_generation_operation_on_insert()',
      'function:public.freeze_ai_content_generation_operation_identity()',
      'function:public.transition_ai_content_generation_operation(uuid,text,text)',
      'function:public.freeze_automated_content_proposal_run_identity()',
      'function:public.transition_automated_content_proposal_run(uuid,text,text,uuid,uuid,uuid,text,text)',
      'function:public.enforce_ai_content_proposal_research_attempt_contract()',
      'function:public.append_ai_content_proposal_research_attempt_event(uuid,uuid,integer,text,uuid,jsonb,text,text)',
      'function:public.complete_ai_content_proposal_research(uuid,uuid,jsonb,text,jsonb,text,text)',
      'function:public.enforce_ai_content_proposal_research_completion_pair()',
      'function:public.enforce_ai_content_proposal_composition_research_success()',
      'function:public.enforce_ai_content_proposal_model_attempt_contract()',
      'function:public.append_ai_content_proposal_attempt_event(uuid,uuid,integer,integer,text,text,text,text,text,text,text,text,boolean)',
      'function:public.enforce_ai_content_proposal_success_event()',
      'function:public.enforce_ai_content_prompt_binding_source()',
      'function:public.create_ai_content_generation_prompt_binding(uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb)',
      'function:public.freeze_topic_upload_operation_identity()',
      'function:public.create_ai_content_cutover_topic_upload(uuid,uuid,uuid,text,text,jsonb)',
      'function:public.enforce_ai_content_usage_reversal_identity()',
      'function:public.reject_ai_content_usage_ledger_mutation()',
      'function:public.begin_ai_content_cutover_release_adoption(uuid,uuid,text,text,text,text,text,text)',
      'function:public.append_ai_content_cutover_release_adoption_event(uuid,integer,integer,text,jsonb,text)',
      'function:public.claim_ai_content_storage_cleanup(uuid,uuid,text,text,uuid,integer)',
      'function:public.complete_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)',
      'function:public.fail_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)',
      'function:public.is_ai_content_storage_path_protected(uuid,text)',
      'function:public.ai_content_generation_input_v3_is_valid(jsonb)',
      'function:public.ai_content_plan_v2_is_valid(jsonb)',
      'function:public.ai_content_manifest_v3_is_valid(jsonb)',
      'function:public.enforce_ai_content_three_format_identity()',
      'function:public.ai_content_cutover_storage_value_to_path(text)',
      'function:public.ai_content_cutover_storage_candidates()',
      'function:public.ai_content_cutover_target_ids()',
      'function:public.start_ai_content_orchestration(uuid,uuid,uuid,jsonb,jsonb,uuid)'
    ])
  ) then raise exception 'ai_content_075_acl_catalog_object_invalid'; end if;

  return (
    with protected_objects as (
      select 'table'::text object_kind,'table:public.'||name object_identity,
             relation.relowner owner_oid,coalesce(relation.relacl,acldefault('r',relation.relowner)) acl
        from unnest(array[
          'ai_content_cutover_release_adoption_events','ai_content_cutover_release_adoptions',
          'ai_content_generation_operations','ai_content_generation_prompt_bindings',
          'ai_content_proposal_attempt_events','ai_content_proposal_compositions',
          'ai_content_proposal_job_contracts','ai_content_proposal_model_attempts',
          'ai_content_proposal_performance_audits','ai_content_proposal_research_attempt_events',
          'ai_content_proposal_research_attempts','ai_content_storage_cleanup_outbox',
          'automated_content_proposal_runs'
        ]) as expected(name) join pg_class relation on relation.oid=to_regclass('public.'||expected.name)
      union all
      select 'function','function:'||identity,function.proowner,
             coalesce(function.proacl,acldefault('f',function.proowner))
        from unnest(array[
          'public.reject_ai_content_cutover_record_mutation()',
          'public.enforce_ai_content_generation_operation_identity()',
          'public.require_ai_content_generation_operation_on_insert()',
          'public.freeze_ai_content_generation_operation_identity()',
          'public.transition_ai_content_generation_operation(uuid,text,text)',
          'public.freeze_automated_content_proposal_run_identity()',
          'public.transition_automated_content_proposal_run(uuid,text,text,uuid,uuid,uuid,text,text)',
          'public.enforce_ai_content_proposal_research_attempt_contract()',
          'public.append_ai_content_proposal_research_attempt_event(uuid,uuid,integer,text,uuid,jsonb,text,text)',
          'public.complete_ai_content_proposal_research(uuid,uuid,jsonb,text,jsonb,text,text)',
          'public.enforce_ai_content_proposal_research_completion_pair()',
          'public.enforce_ai_content_proposal_composition_research_success()',
          'public.enforce_ai_content_proposal_model_attempt_contract()',
          'public.append_ai_content_proposal_attempt_event(uuid,uuid,integer,integer,text,text,text,text,text,text,text,text,boolean)',
          'public.enforce_ai_content_proposal_success_event()',
          'public.enforce_ai_content_prompt_binding_source()',
          'public.create_ai_content_generation_prompt_binding(uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb)',
          'public.freeze_topic_upload_operation_identity()',
          'public.create_ai_content_cutover_topic_upload(uuid,uuid,uuid,text,text,jsonb)',
          'public.enforce_ai_content_usage_reversal_identity()',
          'public.reject_ai_content_usage_ledger_mutation()',
          'public.begin_ai_content_cutover_release_adoption(uuid,uuid,text,text,text,text,text,text)',
          'public.append_ai_content_cutover_release_adoption_event(uuid,integer,integer,text,jsonb,text)',
          'public.claim_ai_content_storage_cleanup(uuid,uuid,text,text,uuid,integer)',
          'public.complete_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)',
          'public.fail_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)',
          'public.is_ai_content_storage_path_protected(uuid,text)',
          'public.ai_content_generation_input_v3_is_valid(jsonb)',
          'public.ai_content_plan_v2_is_valid(jsonb)',
          'public.ai_content_manifest_v3_is_valid(jsonb)',
          'public.enforce_ai_content_three_format_identity()',
          'public.ai_content_cutover_storage_value_to_path(text)',
          'public.ai_content_cutover_storage_candidates()',
          'public.ai_content_cutover_target_ids()',
          'public.start_ai_content_orchestration(uuid,uuid,uuid,jsonb,jsonb,uuid)'
        ]) as expected(identity) join pg_proc function on function.oid=to_regprocedure(expected.identity)
    ), base_acl as (
      select object_kind,object_identity,owner_oid,acl.grantor,acl.grantee,
             acl.privilege_type,acl.is_grantable
        from protected_objects
        cross join lateral aclexplode(protected_objects.acl) acl
    ), retained_acl as (
      select * from base_acl
       where p_object_identity is null
          or object_identity<>p_object_identity
          or grantee<>grantee_oid
          or (p_command_tag='GRANT' and not (privilege_type=any(privilege_names)))
    ), projected_acl as (
      select * from retained_acl
      union all
      select object_kind,object_identity,owner_oid,owner_oid,grantee_oid,requested.privilege_type,
             coalesce((select bool_or(existing.is_grantable) from base_acl existing
                        where existing.object_identity=p_object_identity
                          and existing.grantee=grantee_oid
                          and existing.privilege_type=requested.privilege_type),false)
        from protected_objects
        cross join unnest(privilege_names) requested(privilege_type)
       where p_command_tag='GRANT' and object_identity=p_object_identity
    )
    select jsonb_build_object(
      'contractVersion','ai-content-075-protected-acl-catalog.v1',
      'rows',coalesce(jsonb_agg(jsonb_build_object(
        'objectKind',object_kind,'objectIdentity',object_identity,
        'ownerRoleName',pg_get_userbyid(owner_oid),'grantorRoleName',pg_get_userbyid(grantor),
        'granteeRoleName',case when grantee=0 then 'PUBLIC' else pg_get_userbyid(grantee) end,
        'privilege',privilege_type,'grantable',is_grantable
      ) order by object_identity collate "C",grantee,grantor,privilege_type collate "C"),'[]'::jsonb)
    ) from projected_acl
  );
end;
$$;

create function apply_ai_content_075_acl_command(
  p_command_tag text,
  p_object_identity text,
  p_grantee text,
  p_privileges text
) returns text
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  bootstrap public.ai_content_bootstrap_state%rowtype;
  pre_catalog_sha256 text;
  post_catalog_sha256 text;
  object_name text;
  grantee_sql text;
  command_sql text;
begin
  select * into strict bootstrap from public.ai_content_bootstrap_state where singleton for update;
  if session_user<>bootstrap.migration_role_name::text then
    raise exception 'ai_content_075_acl_session_role_invalid:actual=%:expected=%',
      session_user,bootstrap.migration_role_name;
  end if;
  if nullif(current_setting('role',true),'none') is distinct from bootstrap.schema_owner_role_name::text then
    raise exception 'ai_content_075_acl_effective_role_invalid:actual=%:expected=%',
      coalesce(nullif(current_setting('role',true),'none'),'<NULL>'),bootstrap.schema_owner_role_name;
  end if;
  if bootstrap.cutover_075_fence_registration_xid is distinct from pg_current_xact_id()::text then
    raise exception 'ai_content_075_acl_transaction_slot_invalid:actual=%:expected=%',
      coalesce(bootstrap.cutover_075_fence_registration_xid,'<NULL>'),pg_current_xact_id()::text;
  end if;
  if bootstrap.cutover_075_fence_registration_cutover_id::text is distinct from
     nullif(current_setting('app.ai_content_cutover_id',true),'') then
    raise exception 'ai_content_075_acl_cutover_slot_invalid:actual=%:expected=%',
      coalesce(bootstrap.cutover_075_fence_registration_cutover_id::text,'<NULL>'),
      coalesce(nullif(current_setting('app.ai_content_cutover_id',true),''),'<NULL>');
  end if;
  if current_setting('app.ai_content_075_fence_registration',true) is distinct from 'acl' then
    raise exception 'ai_content_075_acl_mode_invalid:actual=%:expected=acl',
      coalesce(current_setting('app.ai_content_075_fence_registration',true),'<NULL>');
  end if;
  if not exists (
    select 1 from public.ai_content_ddl_allowlist allowed
     where allowed.migration_id='075_ai_content_three_format_cutover.sql'
       and allowed.command_tag=p_command_tag
       and allowed.object_identity_pattern=concat_ws('|',p_object_identity,p_grantee,p_privileges)
  ) then
    raise exception 'ai_content_075_acl_descriptor_invalid:tag=%:descriptor=%',
      coalesce(p_command_tag,'<NULL>'),concat_ws('|',p_object_identity,p_grantee,p_privileges);
  end if;

  pre_catalog_sha256:=encode(digest(
    public.ai_content_075_acl_catalog(null,null,null,null)::text,'sha256'),'hex');
  post_catalog_sha256:=encode(digest(
    public.ai_content_075_acl_catalog(p_command_tag,p_object_identity,p_grantee,p_privileges)::text,'sha256'),'hex');
  update public.ai_content_bootstrap_state
     set cutover_075_acl_command_tag=p_command_tag,
         cutover_075_acl_object_identity=p_object_identity,
         cutover_075_acl_grantee=p_grantee,
         cutover_075_acl_privileges=p_privileges,
         cutover_075_acl_pre_catalog_sha256=pre_catalog_sha256,
         cutover_075_acl_post_catalog_sha256=post_catalog_sha256
   where singleton
     and cutover_075_acl_command_tag is null
     and cutover_075_acl_object_identity is null
     and cutover_075_acl_grantee is null
     and cutover_075_acl_privileges is null
     and cutover_075_acl_pre_catalog_sha256 is null
     and cutover_075_acl_post_catalog_sha256 is null;
  if not found then raise exception 'ai_content_075_acl_slot_busy'; end if;

  grantee_sql:=case when p_grantee='PUBLIC' then 'public' else format('%I',p_grantee) end;
  if p_object_identity like 'table:public.%' then
    object_name:=substring(p_object_identity from length('table:public.')+1);
    if p_command_tag='REVOKE' then
      command_sql:=format('revoke all on table public.%I from %s',object_name,grantee_sql);
    else
      command_sql:=format('grant %s on table public.%I to %s',lower(replace(p_privileges,',',',')),object_name,grantee_sql);
    end if;
  elsif p_object_identity like 'function:public.%' then
    object_name:=substring(p_object_identity from length('function:')+1);
    if p_command_tag='REVOKE' then
      command_sql:=format('revoke all on function %s from %s',object_name,grantee_sql);
    else
      command_sql:=format('grant execute on function %s to %s',object_name,grantee_sql);
    end if;
  else
    raise exception 'ai_content_075_acl_command_object_invalid';
  end if;
  execute command_sql;
  if exists (
    select 1 from public.ai_content_bootstrap_state where singleton
      and (cutover_075_acl_command_tag is not null or cutover_075_acl_object_identity is not null
        or cutover_075_acl_grantee is not null or cutover_075_acl_privileges is not null
        or cutover_075_acl_pre_catalog_sha256 is not null or cutover_075_acl_post_catalog_sha256 is not null)
  ) then raise exception 'ai_content_075_acl_slot_not_consumed'; end if;
  return post_catalog_sha256;
end;
$$;

create function verify_ai_content_075_acl_final_catalog() returns text
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  bootstrap public.ai_content_bootstrap_state%rowtype;
  catalog jsonb;
  catalog_sha256 text;
begin
  select * into strict bootstrap from public.ai_content_bootstrap_state where singleton;
  catalog:=public.ai_content_075_acl_catalog(null,null,null,null);
  catalog_sha256:=encode(digest(catalog::text,'sha256'),'hex');
  if exists (
    with relation_objects as (
      select 'table:public.'||name object_identity,'table'::text object_kind,
             case when name=any(array[
               'ai_content_cutover_release_adoption_events','ai_content_cutover_release_adoptions',
               'ai_content_storage_cleanup_outbox'
             ]) then current_user else bootstrap.schema_owner_role_name::text end owner_role_name
        from unnest(array[
          'ai_content_cutover_release_adoption_events','ai_content_cutover_release_adoptions',
          'ai_content_generation_operations','ai_content_generation_prompt_bindings',
          'ai_content_proposal_attempt_events','ai_content_proposal_compositions',
          'ai_content_proposal_job_contracts','ai_content_proposal_model_attempts',
          'ai_content_proposal_performance_audits','ai_content_proposal_research_attempt_events',
          'ai_content_proposal_research_attempts','ai_content_storage_cleanup_outbox',
          'automated_content_proposal_runs'
        ]) as expected(name)
    ), function_objects as (
      select 'function:'||identity object_identity,'function'::text object_kind,
             case when identity=any(array[
               'public.reject_ai_content_cutover_record_mutation()',
               'public.begin_ai_content_cutover_release_adoption(uuid,uuid,text,text,text,text,text,text)',
               'public.append_ai_content_cutover_release_adoption_event(uuid,integer,integer,text,jsonb,text)',
               'public.claim_ai_content_storage_cleanup(uuid,uuid,text,text,uuid,integer)',
               'public.complete_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)',
               'public.fail_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)',
               'public.is_ai_content_storage_path_protected(uuid,text)'
             ]) then current_user else bootstrap.schema_owner_role_name::text end owner_role_name
        from unnest(array[
          'public.reject_ai_content_cutover_record_mutation()',
          'public.enforce_ai_content_generation_operation_identity()',
          'public.require_ai_content_generation_operation_on_insert()',
          'public.freeze_ai_content_generation_operation_identity()',
          'public.transition_ai_content_generation_operation(uuid,text,text)',
          'public.freeze_automated_content_proposal_run_identity()',
          'public.transition_automated_content_proposal_run(uuid,text,text,uuid,uuid,uuid,text,text)',
          'public.enforce_ai_content_proposal_research_attempt_contract()',
          'public.append_ai_content_proposal_research_attempt_event(uuid,uuid,integer,text,uuid,jsonb,text,text)',
          'public.complete_ai_content_proposal_research(uuid,uuid,jsonb,text,jsonb,text,text)',
          'public.enforce_ai_content_proposal_research_completion_pair()',
          'public.enforce_ai_content_proposal_composition_research_success()',
          'public.enforce_ai_content_proposal_model_attempt_contract()',
          'public.append_ai_content_proposal_attempt_event(uuid,uuid,integer,integer,text,text,text,text,text,text,text,text,boolean)',
          'public.enforce_ai_content_proposal_success_event()',
          'public.enforce_ai_content_prompt_binding_source()',
          'public.create_ai_content_generation_prompt_binding(uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb)',
          'public.freeze_topic_upload_operation_identity()',
          'public.create_ai_content_cutover_topic_upload(uuid,uuid,uuid,text,text,jsonb)',
          'public.enforce_ai_content_usage_reversal_identity()',
          'public.reject_ai_content_usage_ledger_mutation()',
          'public.begin_ai_content_cutover_release_adoption(uuid,uuid,text,text,text,text,text,text)',
          'public.append_ai_content_cutover_release_adoption_event(uuid,integer,integer,text,jsonb,text)',
          'public.claim_ai_content_storage_cleanup(uuid,uuid,text,text,uuid,integer)',
          'public.complete_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)',
          'public.fail_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)',
          'public.is_ai_content_storage_path_protected(uuid,text)',
          'public.ai_content_generation_input_v3_is_valid(jsonb)',
          'public.ai_content_plan_v2_is_valid(jsonb)',
          'public.ai_content_manifest_v3_is_valid(jsonb)',
          'public.enforce_ai_content_three_format_identity()',
          'public.ai_content_cutover_storage_value_to_path(text)',
          'public.ai_content_cutover_storage_candidates()',
          'public.ai_content_cutover_target_ids()',
          'public.start_ai_content_orchestration(uuid,uuid,uuid,jsonb,jsonb,uuid)'
        ]) as expected(identity)
    ), expected_objects as (
      select * from relation_objects union all select * from function_objects
    ), owner_acl as (
      select object_kind,object_identity,owner_role_name grantor_role_name,
             owner_role_name grantee_role_name,privilege,false grantable
        from expected_objects
        cross join lateral unnest(case when object_kind='table' then array[
          'DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE'
        ] else array['EXECUTE'] end) as owner_privilege(privilege)
    ), granted_acl(object_identity,grantee_role_name,privilege) as (
      select 'table:public.'||name,bootstrap.operator_role_name::text,'SELECT'
        from unnest(array['ai_content_cutover_release_adoptions','ai_content_cutover_release_adoption_events']) as expected(name)
      union all select 'table:public.ai_content_storage_cleanup_outbox',bootstrap.cleanup_role_name::text,'SELECT'
      union all
      select 'table:public.'||name,bootstrap.application_role_name::text,privilege
        from unnest(array[
          'ai_content_generation_operations','ai_content_proposal_performance_audits',
          'automated_content_proposal_runs','ai_content_proposal_job_contracts',
          'ai_content_proposal_compositions','ai_content_proposal_research_attempts',
          'ai_content_proposal_model_attempts'
        ]) as expected(name) cross join unnest(array['INSERT','SELECT']) as grant_privilege(privilege)
      union all
      select 'table:public.'||name,bootstrap.application_role_name::text,'SELECT'
        from unnest(array[
          'ai_content_proposal_research_attempt_events','ai_content_proposal_attempt_events',
          'ai_content_generation_prompt_bindings'
        ]) as expected(name)
      union all
      select 'function:'||identity,bootstrap.operator_role_name::text,'EXECUTE'
        from unnest(array[
          'public.begin_ai_content_cutover_release_adoption(uuid,uuid,text,text,text,text,text,text)',
          'public.append_ai_content_cutover_release_adoption_event(uuid,integer,integer,text,jsonb,text)'
        ]) as expected(identity)
      union all
      select 'function:'||identity,bootstrap.cleanup_role_name::text,'EXECUTE'
        from unnest(array[
          'public.claim_ai_content_storage_cleanup(uuid,uuid,text,text,uuid,integer)',
          'public.complete_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)',
          'public.fail_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)'
        ]) as expected(identity)
      union all
      select 'function:'||identity,bootstrap.application_role_name::text,'EXECUTE'
        from unnest(array[
          'public.transition_ai_content_generation_operation(uuid,text,text)',
          'public.transition_automated_content_proposal_run(uuid,text,text,uuid,uuid,uuid,text,text)',
          'public.append_ai_content_proposal_research_attempt_event(uuid,uuid,integer,text,uuid,jsonb,text,text)',
          'public.complete_ai_content_proposal_research(uuid,uuid,jsonb,text,jsonb,text,text)',
          'public.append_ai_content_proposal_attempt_event(uuid,uuid,integer,integer,text,text,text,text,text,text,text,text,boolean)',
          'public.create_ai_content_generation_prompt_binding(uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb)',
          'public.create_ai_content_cutover_topic_upload(uuid,uuid,uuid,text,text,jsonb)',
          'public.is_ai_content_storage_path_protected(uuid,text)'
        ]) as expected(identity)
    ), expected_acl as (
      select * from owner_acl
      union all
      select object.object_kind,grant_row.object_identity,object.owner_role_name,
             grant_row.grantee_role_name,grant_row.privilege,false
        from granted_acl grant_row join expected_objects object using(object_identity)
    ), actual_acl as (
      select row->>'objectKind' object_kind,row->>'objectIdentity' object_identity,
             row->>'grantorRoleName' grantor_role_name,row->>'granteeRoleName' grantee_role_name,
             row->>'privilege' privilege,(row->>'grantable')::boolean grantable
        from jsonb_array_elements(catalog->'rows') row
    ), difference as (
      (select * from expected_acl except select * from actual_acl)
      union all
      (select * from actual_acl except select * from expected_acl)
    )
    select 1 from difference
  ) then raise exception 'ai_content_075_acl_final_catalog_invalid'; end if;
  if exists (
    select 1
      from unnest(array[
        'ai_content_cutover_release_adoption_events','ai_content_cutover_release_adoptions',
        'ai_content_generation_operations','ai_content_generation_prompt_bindings',
        'ai_content_proposal_attempt_events','ai_content_proposal_compositions',
        'ai_content_proposal_job_contracts','ai_content_proposal_model_attempts',
        'ai_content_proposal_performance_audits','ai_content_proposal_research_attempt_events',
        'ai_content_proposal_research_attempts','ai_content_storage_cleanup_outbox',
        'automated_content_proposal_runs'
      ]) as expected(name)
      join pg_class relation on relation.oid=to_regclass('public.'||expected.name)
      join pg_attribute attribute on attribute.attrelid=relation.oid
        and attribute.attnum>0 and not attribute.attisdropped
      cross join lateral aclexplode(attribute.attacl) column_acl
  ) then raise exception 'ai_content_075_acl_final_catalog_invalid'; end if;
  return catalog_sha256;
end;
$$;

create function enforce_ai_content_ddl_allowlist() returns event_trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare command record;
declare expected_migration text;
declare outer_role text;
declare bootstrap public.ai_content_bootstrap_state%rowtype;
declare acl_command_consumed boolean := false;
declare acl_command_count integer := 0;
declare acl_live_catalog_sha256 text;
begin
  select * into strict bootstrap from public.ai_content_bootstrap_state where singleton;
  outer_role := nullif(current_setting('role', true), 'none');
  if session_user<>bootstrap.migration_role_name::text
     and outer_role is distinct from bootstrap.schema_owner_role_name::text then return; end if;
  if session_user<>bootstrap.migration_role_name::text
     or outer_role is distinct from bootstrap.schema_owner_role_name::text then
    raise exception 'ai_content_ddl_role_edge_invalid';
  end if;
  expected_migration := nullif(current_setting('app.ai_content_migration_id', true), '');
  if tg_event<>'ddl_command_end'
     or expected_migration is distinct from '075_ai_content_three_format_cutover.sql'
     or not public.ai_content_cutover_bypass_allowed() then
    raise exception 'ai_content_ddl_not_authorized';
  end if;
  for command in select * from pg_event_trigger_ddl_commands()
  loop
    if command.command_tag in ('GRANT','REVOKE')
       and current_setting('app.ai_content_075_fence_registration',true)='acl'
       and bootstrap.cutover_075_fence_registration_xid=pg_current_xact_id()::text
       and bootstrap.cutover_075_fence_registration_cutover_id::text
         =nullif(current_setting('app.ai_content_cutover_id',true),'')
       and bootstrap.cutover_075_acl_command_tag=command.command_tag
       and bootstrap.cutover_075_acl_pre_catalog_sha256 ~ '^[0-9a-f]{64}$'
       and bootstrap.cutover_075_acl_post_catalog_sha256 ~ '^[0-9a-f]{64}$'
       and length(trim(bootstrap.cutover_075_acl_grantee))>0
       and length(trim(bootstrap.cutover_075_acl_privileges))>0
       and exists (
         select 1 from public.ai_content_ddl_allowlist allowed
          where allowed.migration_id='075_ai_content_three_format_cutover.sql'
            and allowed.command_tag=command.command_tag
            and allowed.object_identity_pattern=concat_ws('|',
              bootstrap.cutover_075_acl_object_identity,
              bootstrap.cutover_075_acl_grantee,
              bootstrap.cutover_075_acl_privileges)
       )
       and (
         bootstrap.cutover_075_acl_object_identity = any(array[
           'table:public.ai_content_cutover_release_adoption_events',
           'table:public.ai_content_cutover_release_adoptions',
           'table:public.ai_content_generation_operations',
           'table:public.ai_content_generation_prompt_bindings',
           'table:public.ai_content_proposal_attempt_events',
           'table:public.ai_content_proposal_compositions',
           'table:public.ai_content_proposal_job_contracts',
           'table:public.ai_content_proposal_model_attempts',
           'table:public.ai_content_proposal_performance_audits',
           'table:public.ai_content_proposal_research_attempt_events',
           'table:public.ai_content_proposal_research_attempts',
           'table:public.ai_content_storage_cleanup_outbox',
           'table:public.automated_content_proposal_runs'
         ])
         or bootstrap.cutover_075_acl_object_identity = any(array[
           'function:public.reject_ai_content_cutover_record_mutation()',
           'function:public.enforce_ai_content_generation_operation_identity()',
           'function:public.require_ai_content_generation_operation_on_insert()',
           'function:public.freeze_ai_content_generation_operation_identity()',
           'function:public.transition_ai_content_generation_operation(uuid,text,text)',
           'function:public.freeze_automated_content_proposal_run_identity()',
           'function:public.transition_automated_content_proposal_run(uuid,text,text,uuid,uuid,uuid,text,text)',
           'function:public.enforce_ai_content_proposal_research_attempt_contract()',
           'function:public.append_ai_content_proposal_research_attempt_event(uuid,uuid,integer,text,uuid,jsonb,text,text)',
           'function:public.complete_ai_content_proposal_research(uuid,uuid,jsonb,text,jsonb,text,text)',
           'function:public.enforce_ai_content_proposal_research_completion_pair()',
           'function:public.enforce_ai_content_proposal_composition_research_success()',
           'function:public.enforce_ai_content_proposal_model_attempt_contract()',
           'function:public.append_ai_content_proposal_attempt_event(uuid,uuid,integer,integer,text,text,text,text,text,text,text,text,boolean)',
           'function:public.enforce_ai_content_proposal_success_event()',
           'function:public.enforce_ai_content_prompt_binding_source()',
           'function:public.create_ai_content_generation_prompt_binding(uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb)',
           'function:public.freeze_topic_upload_operation_identity()',
           'function:public.create_ai_content_cutover_topic_upload(uuid,uuid,uuid,text,text,jsonb)',
           'function:public.enforce_ai_content_usage_reversal_identity()',
           'function:public.reject_ai_content_usage_ledger_mutation()',
           'function:public.begin_ai_content_cutover_release_adoption(uuid,uuid,text,text,text,text,text,text)',
           'function:public.append_ai_content_cutover_release_adoption_event(uuid,integer,integer,text,jsonb,text)',
           'function:public.claim_ai_content_storage_cleanup(uuid,uuid,text,text,uuid,integer)',
           'function:public.complete_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)',
           'function:public.fail_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)',
           'function:public.is_ai_content_storage_path_protected(uuid,text)',
           'function:public.ai_content_generation_input_v3_is_valid(jsonb)',
           'function:public.ai_content_plan_v2_is_valid(jsonb)',
           'function:public.ai_content_manifest_v3_is_valid(jsonb)',
           'function:public.enforce_ai_content_three_format_identity()',
           'function:public.ai_content_cutover_storage_value_to_path(text)',
           'function:public.ai_content_cutover_storage_candidates()',
           'function:public.ai_content_cutover_target_ids()',
           'function:public.start_ai_content_orchestration(uuid,uuid,uuid,jsonb,jsonb,uuid)'
         ])
        )
       and command.object_type=(case when bootstrap.cutover_075_acl_object_identity like 'table:%'
                                     then 'TABLE' else 'FUNCTION' end)
       and command.schema_name is null
       and command.object_identity is null
       and not command.in_extension
       and command.classid is null
       and command.objid is null
       and command.objsubid is null then
      acl_command_consumed:=true;
      acl_command_count:=acl_command_count+1;
      if acl_command_count<>1 then raise exception 'ai_content_075_acl_command_effect_invalid'; end if;
      continue;
    end if;
    if command.command_tag in ('GRANT','REVOKE') then
      raise exception 'ai_content_075_acl_command_effect_invalid';
    end if;
    if not exists (
      select 1 from public.ai_content_ddl_allowlist allowed
       where allowed.migration_id=expected_migration
         and allowed.command_tag=command.command_tag
         and command.object_identity=allowed.object_identity_pattern
    ) then
      raise exception 'ai_content_ddl_not_allowlisted:%:%',command.command_tag,command.object_identity;
    end if;
  end loop;
  if acl_command_consumed then
    if acl_command_count<>1 then raise exception 'ai_content_075_acl_command_effect_invalid'; end if;
    acl_live_catalog_sha256:=encode(digest(
      public.ai_content_075_acl_catalog(null,null,null,null)::text,'sha256'),'hex');
    if acl_live_catalog_sha256 is distinct from bootstrap.cutover_075_acl_post_catalog_sha256 then
      raise exception 'ai_content_075_acl_poststate_invalid';
    end if;
    update public.ai_content_bootstrap_state
       set cutover_075_acl_command_tag=null,cutover_075_acl_object_identity=null,
           cutover_075_acl_grantee=null,cutover_075_acl_privileges=null,
           cutover_075_acl_pre_catalog_sha256=null,cutover_075_acl_post_catalog_sha256=null
     where singleton
       and cutover_075_fence_registration_xid=bootstrap.cutover_075_fence_registration_xid
       and cutover_075_fence_registration_cutover_id=bootstrap.cutover_075_fence_registration_cutover_id
       and cutover_075_acl_command_tag=bootstrap.cutover_075_acl_command_tag
       and cutover_075_acl_object_identity=bootstrap.cutover_075_acl_object_identity
       and cutover_075_acl_grantee=bootstrap.cutover_075_acl_grantee
       and cutover_075_acl_privileges=bootstrap.cutover_075_acl_privileges
       and cutover_075_acl_pre_catalog_sha256=bootstrap.cutover_075_acl_pre_catalog_sha256
       and cutover_075_acl_post_catalog_sha256=bootstrap.cutover_075_acl_post_catalog_sha256;
    if not found then raise exception 'ai_content_075_acl_command_replay'; end if;
  end if;
end;
$$;

create function enforce_ai_content_write_fence() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare classifier text;
declare should_fence boolean := false;
begin
  select c.row_classifier into strict classifier
    from public.ai_content_write_fence_catalog c
   where c.relation_class='customer_execution' and c.relation_name=tg_table_name;
  if classifier='whole_relation' then
    should_fence := true;
  elsif classifier='legacy_automated_topic' then
    if tg_op='INSERT' then should_fence := coalesce(new.status::text,'') in ('uploaded','queued','used');
    elsif tg_op='DELETE' then should_fence := coalesce(old.status::text,'') in ('uploaded','queued','used');
    else should_fence := coalesce(old.status::text,'') in ('uploaded','queued','used')
      or coalesce(new.status::text,'') in ('uploaded','queued','used'); end if;
  elsif classifier='scheduled_proposal_refresh' then
    if tg_op='INSERT' then should_fence := coalesce(new.run_key::text,'') like 'scheduled-proposal-refresh:%';
    elsif tg_op='DELETE' then should_fence := coalesce(old.run_key::text,'') like 'scheduled-proposal-refresh:%';
    else should_fence := coalesce(old.run_key::text,'') like 'scheduled-proposal-refresh:%'
      or coalesce(new.run_key::text,'') like 'scheduled-proposal-refresh:%'; end if;
  elsif classifier='legacy_content_job' then
    if tg_op='INSERT' then should_fence := coalesce(new.job_type::text,'') in ('instagram_feed_render','instagram_story_render','instagram_reel_render','threads_text_render');
    elsif tg_op='DELETE' then should_fence := coalesce(old.job_type::text,'') in ('instagram_feed_render','instagram_story_render','instagram_reel_render','threads_text_render');
    else should_fence := coalesce(old.job_type::text,'') in ('instagram_feed_render','instagram_story_render','instagram_reel_render','threads_text_render')
      or coalesce(new.job_type::text,'') in ('instagram_feed_render','instagram_story_render','instagram_reel_render','threads_text_render'); end if;
  elsif classifier='ai_content_generated_artifact' then
    if tg_op='INSERT' then should_fence := coalesce(new.artifact_type::text,'')='generated_manifest';
    elsif tg_op='DELETE' then should_fence := coalesce(old.artifact_type::text,'')='generated_manifest';
    else should_fence := coalesce(old.artifact_type::text,'')='generated_manifest'
      or coalesce(new.artifact_type::text,'')='generated_manifest'; end if;
  elsif classifier='ai_content_scheduled_publish' then
    if tg_op='INSERT' then should_fence := exists (select 1 from public.channel_outputs output where output.id=new.channel_output_id and output.ai_content_generation_output_id is not null);
    elsif tg_op='DELETE' then should_fence := exists (select 1 from public.channel_outputs output where output.id=old.channel_output_id and output.ai_content_generation_output_id is not null);
    elsif old.channel_output_id is not distinct from new.channel_output_id then
      should_fence := exists (select 1 from public.channel_outputs output where output.id=old.channel_output_id and output.ai_content_generation_output_id is not null);
    else should_fence := exists (select 1 from public.channel_outputs output where output.id=old.channel_output_id and output.ai_content_generation_output_id is not null)
      or exists (select 1 from public.channel_outputs output where output.id=new.channel_output_id and output.ai_content_generation_output_id is not null); end if;
  elsif classifier='ai_content_publish_attempt' then
    if tg_op='INSERT' then should_fence := exists (
      select 1 from public.publish_queue queue join public.channel_outputs output on output.id=queue.channel_output_id
       where queue.id=new.publish_queue_id and output.ai_content_generation_output_id is not null);
    elsif tg_op='DELETE' then should_fence := exists (
      select 1 from public.publish_queue queue join public.channel_outputs output on output.id=queue.channel_output_id
       where queue.id=old.publish_queue_id and output.ai_content_generation_output_id is not null);
    elsif old.publish_queue_id is not distinct from new.publish_queue_id then should_fence := exists (
      select 1 from public.publish_queue queue join public.channel_outputs output on output.id=queue.channel_output_id
       where queue.id=old.publish_queue_id and output.ai_content_generation_output_id is not null);
    else should_fence := exists (
      select 1 from public.publish_queue queue join public.channel_outputs output on output.id=queue.channel_output_id
       where queue.id=old.publish_queue_id and output.ai_content_generation_output_id is not null)
      or exists (
      select 1 from public.publish_queue queue join public.channel_outputs output on output.id=queue.channel_output_id
       where queue.id=new.publish_queue_id and output.ai_content_generation_output_id is not null); end if;
  elsif classifier='daily_generation_automation' then
    if tg_op='INSERT' then should_fence := coalesce(new.run_type::text,'')='daily_generation';
    elsif tg_op='DELETE' then should_fence := coalesce(old.run_type::text,'')='daily_generation';
    else should_fence := coalesce(old.run_type::text,'')='daily_generation'
      or coalesce(new.run_type::text,'')='daily_generation'; end if;
  end if;
  if should_fence then perform public.assert_ai_content_writable(); end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

create function ai_content_fence_trigger_name(p_relation_name text) returns text
language sql immutable strict set search_path=pg_catalog as $$
  select 'ai_content_fence_' || left(p_relation_name, 30) || '_' || left(md5(p_relation_name), 12)
$$;

do $$
declare item record;
begin
  for item in
    select relation_name from ai_content_write_fence_catalog
     where relation_class='customer_execution' order by relation_name
  loop
    execute format(
      'create trigger %I before insert or update or delete on %I for each row execute function enforce_ai_content_write_fence()',
      ai_content_fence_trigger_name(item.relation_name),
      item.relation_name
    );
    execute format('alter table %I enable always trigger %I',
      item.relation_name, ai_content_fence_trigger_name(item.relation_name));
  end loop;
end;
$$;

create function enforce_ai_content_075_registration_seal_cleared() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  registration_xid text;
  registration_cutover_id uuid;
begin
  select cutover_075_fence_registration_xid,
         cutover_075_fence_registration_cutover_id
    into strict registration_xid,registration_cutover_id
    from public.ai_content_bootstrap_state
   where singleton;
  if registration_xid is not null or registration_cutover_id is not null
     or exists (select 1 from public.ai_content_bootstrap_state
       where singleton and (cutover_075_acl_command_tag is not null
         or cutover_075_acl_object_identity is not null or cutover_075_acl_grantee is not null
         or cutover_075_acl_privileges is not null or cutover_075_acl_pre_catalog_sha256 is not null
         or cutover_075_acl_post_catalog_sha256 is not null)) then
    raise exception 'ai_content_075_fence_registration_unfinished';
  end if;
  return null;
end;
$$;

create constraint trigger ai_content_bootstrap_075_registration_must_clear
after insert or update on ai_content_bootstrap_state
deferrable initially deferred
for each row execute function enforce_ai_content_075_registration_seal_cleared();

create function register_ai_content_075_fence_relations() returns text
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  bootstrap public.ai_content_bootstrap_state%rowtype;
  cutover_row public.ai_content_cutovers%rowtype;
  maintenance public.ai_content_maintenance_state%rowtype;
  supplied_cutover uuid;
  supplied_token text;
  supplied_migration text;
  outer_role text;
  catalog_hash text;
  final_acl_catalog_sha256 text;
  missing_relations text;
  seal_trigger_count integer;
  item record;
begin
  supplied_cutover := nullif(current_setting('app.ai_content_cutover_id',true),'')::uuid;
  supplied_token := nullif(current_setting('app.ai_content_cutover_token',true),'');
  supplied_migration := nullif(current_setting('app.ai_content_migration_id',true),'');
  outer_role := nullif(current_setting('role',true),'none');

  select * into strict bootstrap
    from public.ai_content_bootstrap_state where singleton for update;
  if session_user<>bootstrap.migration_role_name::text
     or outer_role is distinct from bootstrap.schema_owner_role_name::text
     or supplied_cutover is null
     or supplied_token is null
     or supplied_migration is distinct from '075_ai_content_three_format_cutover.sql' then
    raise exception 'ai_content_075_fence_registration_identity_invalid';
  end if;

  select * into strict cutover_row
    from public.ai_content_cutovers where id=supplied_cutover for update;
  select * into strict maintenance
    from public.ai_content_maintenance_state where singleton for update;
  if cutover_row.status<>'maintenance_verified'
     or cutover_row.migration_id<>supplied_migration
     or cutover_row.migration_role_name<>bootstrap.migration_role_name
     or cutover_row.schema_owner_role_name<>bootstrap.schema_owner_role_name
     or cutover_row.application_role_name<>bootstrap.application_role_name
     or cutover_row.operator_role_name<>bootstrap.operator_role_name
     or cutover_row.cleanup_role_name<>bootstrap.cleanup_role_name
     or cutover_row.database_role_catalog_sha256<>bootstrap.role_catalog_sha256
     or cutover_row.bypass_token_sha256<>encode(digest(supplied_token,'sha256'),'hex')
     or not maintenance.enabled
     or maintenance.cutover_id<>supplied_cutover
     or exists (
       select 1 from public.schema_migrations
        where id='075_ai_content_three_format_cutover.sql'
     )
     or not public.verify_ai_content_cutover_status_chain_locked(cutover_row) then
    raise exception 'ai_content_075_fence_registration_state_invalid';
  end if;

  select count(*) into seal_trigger_count
    from pg_trigger trigger
    join pg_class relation on relation.oid=trigger.tgrelid
    join pg_namespace namespace on namespace.oid=relation.relnamespace
   where not trigger.tgisinternal
     and namespace.nspname='public'
     and relation.relname in (
       'ai_content_bootstrap_state','ai_content_cutover_status_events','ai_content_cutovers',
       'ai_content_ddl_allowlist','ai_content_maintenance_state','ai_content_write_fence_catalog'
     );
  if seal_trigger_count<>2 or not exists (
    select 1
      from pg_trigger trigger
     where trigger.tgrelid='public.ai_content_bootstrap_state'::regclass
       and trigger.tgname='ai_content_bootstrap_075_registration_must_clear'
       and not trigger.tgisinternal
       and trigger.tgtype=21
       and trigger.tgenabled='O'
       and trigger.tgdeferrable
       and trigger.tginitdeferred
       and trigger.tgfoid='public.enforce_ai_content_075_registration_seal_cleared()'::regprocedure
       and pg_get_triggerdef(trigger.oid,true)=
         'CREATE CONSTRAINT TRIGGER ai_content_bootstrap_075_registration_must_clear AFTER INSERT OR UPDATE ON ai_content_bootstrap_state DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_ai_content_075_registration_seal_cleared()'
  ) or not exists (
    select 1
      from pg_trigger trigger
     where trigger.tgrelid='public.ai_content_cutover_status_events'::regclass
       and trigger.tgname='ai_content_cutover_status_events_immutable'
       and not trigger.tgisinternal
       and trigger.tgtype=27
       and trigger.tgenabled='O'
       and not trigger.tgdeferrable
       and not trigger.tginitdeferred
       and trigger.tgfoid='public.forbid_ai_content_cutover_event_mutation()'::regprocedure
       and pg_get_triggerdef(trigger.oid,true)=
         'CREATE TRIGGER ai_content_cutover_status_events_immutable BEFORE DELETE OR UPDATE ON ai_content_cutover_status_events FOR EACH ROW EXECUTE FUNCTION forbid_ai_content_cutover_event_mutation()'
  ) then
    raise exception 'ai_content_075_registration_seal_trigger_invalid';
  end if;

  update public.ai_content_bootstrap_state
     set cutover_075_fence_registration_xid=pg_current_xact_id()::text,
         cutover_075_fence_registration_cutover_id=supplied_cutover
   where singleton;

  lock table public.ai_content_ddl_allowlist in share mode;
  lock table public.ai_content_write_fence_catalog in share row exclusive mode;
  select encode(digest(coalesce(string_agg(
           concat_ws('|',relation_name,relation_class,row_classifier), E'\n'
           order by relation_name collate "C"
         ),''),'sha256'),'hex')
    into catalog_hash
    from public.ai_content_write_fence_catalog;

  if catalog_hash='22ebe515247269120f8996bc63f335f27b7f767c36fcf667011312cfb03f3661' then
    perform set_config('app.ai_content_075_fence_registration','armed',true);
    perform public.verify_ai_content_write_fence_catalog();
    perform public.verify_ai_content_075_acl_final_catalog();
    return '22ebe515247269120f8996bc63f335f27b7f767c36fcf667011312cfb03f3661';
  end if;
  if catalog_hash<>'0064a071335735af54bc80a84524fed783e5db72bf19055555a6b1c64d398c7a' then
    raise exception 'ai_content_075_fence_registration_catalog_invalid';
  end if;
  perform public.verify_ai_content_write_fence_catalog();

  select string_agg(expected.relation_name,',' order by expected.relation_name)
    into missing_relations
    from (values
      ('ai_content_cutover_release_adoption_events'),
      ('ai_content_cutover_release_adoptions'),
      ('ai_content_generation_operations'),
      ('ai_content_generation_prompt_bindings'),
      ('ai_content_proposal_attempt_events'),
      ('ai_content_proposal_compositions'),
      ('ai_content_proposal_job_contracts'),
      ('ai_content_proposal_model_attempts'),
      ('ai_content_proposal_performance_audits'),
      ('ai_content_proposal_research_attempt_events'),
      ('ai_content_proposal_research_attempts'),
      ('ai_content_storage_cleanup_outbox'),
      ('automated_content_proposal_runs'),
      ('topic_uploads')
    ) expected(relation_name)
   where not exists (
     select 1
       from pg_class relation
       join pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='public'
        and relation.relname=expected.relation_name
        and relation.relkind='r'
        and pg_get_userbyid(relation.relowner)=bootstrap.schema_owner_role_name::text
   );
  if missing_relations is not null then
    raise exception 'ai_content_075_fence_registration_relation_missing:%',missing_relations;
  end if;

  insert into public.ai_content_write_fence_catalog(
    relation_name,relation_class,row_classifier
  ) values
    ('ai_content_cutover_release_adoption_events','cutover_control','whole_relation'),
    ('ai_content_cutover_release_adoptions','cutover_control','whole_relation'),
    ('ai_content_generation_operations','customer_execution','whole_relation'),
    ('ai_content_generation_prompt_bindings','customer_execution','whole_relation'),
    ('ai_content_proposal_attempt_events','customer_execution','whole_relation'),
    ('ai_content_proposal_compositions','customer_execution','whole_relation'),
    ('ai_content_proposal_job_contracts','customer_execution','whole_relation'),
    ('ai_content_proposal_model_attempts','customer_execution','whole_relation'),
    ('ai_content_proposal_performance_audits','customer_execution','whole_relation'),
    ('ai_content_proposal_research_attempt_events','customer_execution','whole_relation'),
    ('ai_content_proposal_research_attempts','customer_execution','whole_relation'),
    ('ai_content_storage_cleanup_outbox','cutover_control','whole_relation'),
    ('automated_content_proposal_runs','customer_execution','whole_relation');

  for item in
    select relation_name
      from public.ai_content_write_fence_catalog
     where relation_name in (
       'ai_content_generation_operations','ai_content_generation_prompt_bindings',
       'ai_content_proposal_attempt_events','ai_content_proposal_compositions',
       'ai_content_proposal_job_contracts','ai_content_proposal_model_attempts',
       'ai_content_proposal_performance_audits','ai_content_proposal_research_attempt_events',
       'ai_content_proposal_research_attempts','automated_content_proposal_runs'
     )
     order by relation_name
  loop
    execute format(
      'create trigger %I before insert or update or delete on public.%I for each row execute function public.enforce_ai_content_write_fence()',
      public.ai_content_fence_trigger_name(item.relation_name),item.relation_name
    );
    execute format(
      'alter table public.%I enable always trigger %I',
      item.relation_name,public.ai_content_fence_trigger_name(item.relation_name)
    );
  end loop;

  perform set_config('app.ai_content_075_fence_registration','acl',true);
  foreach missing_relations in array array[
    'ai_content_cutover_release_adoption_events','ai_content_cutover_release_adoptions',
    'ai_content_generation_operations','ai_content_generation_prompt_bindings',
    'ai_content_proposal_attempt_events','ai_content_proposal_compositions',
    'ai_content_proposal_job_contracts','ai_content_proposal_model_attempts',
    'ai_content_proposal_performance_audits','ai_content_proposal_research_attempt_events',
    'ai_content_proposal_research_attempts','ai_content_storage_cleanup_outbox',
    'automated_content_proposal_runs'
  ] loop
    final_acl_catalog_sha256:=public.apply_ai_content_075_acl_command(
      'REVOKE','table:public.'||missing_relations,'PUBLIC','ALL');
    for item in
      select distinct grantee.rolname
        from pg_class relation
        join pg_namespace namespace on namespace.oid=relation.relnamespace
        cross join lateral aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) acl
        join pg_roles grantee on grantee.oid=acl.grantee
       where namespace.nspname='public' and relation.relname=missing_relations
         and acl.grantee<>relation.relowner
    loop
      final_acl_catalog_sha256:=public.apply_ai_content_075_acl_command(
        'REVOKE','table:public.'||missing_relations,item.rolname,'ALL');
    end loop;
  end loop;

  foreach missing_relations in array array[
    'public.reject_ai_content_cutover_record_mutation()',
    'public.enforce_ai_content_generation_operation_identity()',
    'public.require_ai_content_generation_operation_on_insert()',
    'public.freeze_ai_content_generation_operation_identity()',
    'public.transition_ai_content_generation_operation(uuid,text,text)',
    'public.freeze_automated_content_proposal_run_identity()',
    'public.transition_automated_content_proposal_run(uuid,text,text,uuid,uuid,uuid,text,text)',
    'public.enforce_ai_content_proposal_research_attempt_contract()',
    'public.append_ai_content_proposal_research_attempt_event(uuid,uuid,integer,text,uuid,jsonb,text,text)',
    'public.complete_ai_content_proposal_research(uuid,uuid,jsonb,text,jsonb,text,text)',
    'public.enforce_ai_content_proposal_research_completion_pair()',
    'public.enforce_ai_content_proposal_composition_research_success()',
    'public.enforce_ai_content_proposal_model_attempt_contract()',
    'public.append_ai_content_proposal_attempt_event(uuid,uuid,integer,integer,text,text,text,text,text,text,text,text,boolean)',
    'public.enforce_ai_content_proposal_success_event()',
    'public.enforce_ai_content_prompt_binding_source()',
    'public.create_ai_content_generation_prompt_binding(uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb)',
    'public.freeze_topic_upload_operation_identity()',
    'public.create_ai_content_cutover_topic_upload(uuid,uuid,uuid,text,text,jsonb)',
    'public.enforce_ai_content_usage_reversal_identity()',
    'public.reject_ai_content_usage_ledger_mutation()',
    'public.begin_ai_content_cutover_release_adoption(uuid,uuid,text,text,text,text,text,text)',
    'public.append_ai_content_cutover_release_adoption_event(uuid,integer,integer,text,jsonb,text)',
    'public.claim_ai_content_storage_cleanup(uuid,uuid,text,text,uuid,integer)',
    'public.complete_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)',
    'public.fail_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)',
    'public.is_ai_content_storage_path_protected(uuid,text)',
    'public.ai_content_generation_input_v3_is_valid(jsonb)',
    'public.ai_content_plan_v2_is_valid(jsonb)',
    'public.ai_content_manifest_v3_is_valid(jsonb)',
    'public.enforce_ai_content_three_format_identity()',
    'public.ai_content_cutover_storage_value_to_path(text)',
    'public.ai_content_cutover_storage_candidates()',
    'public.ai_content_cutover_target_ids()',
    'public.start_ai_content_orchestration(uuid,uuid,uuid,jsonb,jsonb,uuid)'
  ] loop
    final_acl_catalog_sha256:=public.apply_ai_content_075_acl_command(
      'REVOKE','function:'||missing_relations,'PUBLIC','ALL');
    for item in
      select distinct grantee.rolname
        from pg_proc function
        cross join lateral aclexplode(coalesce(function.proacl,acldefault('f',function.proowner))) acl
        join pg_roles grantee on grantee.oid=acl.grantee
       where function.oid=to_regprocedure(missing_relations) and acl.grantee<>function.proowner
    loop
      final_acl_catalog_sha256:=public.apply_ai_content_075_acl_command(
        'REVOKE','function:'||missing_relations,item.rolname,'ALL');
    end loop;
  end loop;

  foreach missing_relations in array array[
    'ai_content_cutover_release_adoptions','ai_content_cutover_release_adoption_events',
    'ai_content_storage_cleanup_outbox'
  ] loop
    execute format('alter table public.%I owner to current_user',missing_relations);
    if (select pg_get_userbyid(relation.relowner) from pg_class relation join pg_namespace namespace
      on namespace.oid=relation.relnamespace where namespace.nspname='public'
      and relation.relname=missing_relations)<>current_user then
      raise exception 'ai_content_075_owner_transfer_mismatch:%',missing_relations;
    end if;
    final_acl_catalog_sha256:=public.apply_ai_content_075_acl_command(
      'REVOKE','table:public.'||missing_relations,'PUBLIC','ALL');
    for item in
      select distinct grantee.rolname
        from pg_class relation
        join pg_namespace namespace on namespace.oid=relation.relnamespace
        cross join lateral aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) acl
        join pg_roles grantee on grantee.oid=acl.grantee
       where namespace.nspname='public' and relation.relname=missing_relations
         and acl.grantee<>relation.relowner
    loop
      final_acl_catalog_sha256:=public.apply_ai_content_075_acl_command(
        'REVOKE','table:public.'||missing_relations,item.rolname,'ALL');
    end loop;
  end loop;

  foreach missing_relations in array array[
    'public.reject_ai_content_cutover_record_mutation()',
    'public.begin_ai_content_cutover_release_adoption(uuid,uuid,text,text,text,text,text,text)',
    'public.append_ai_content_cutover_release_adoption_event(uuid,integer,integer,text,jsonb,text)',
    'public.claim_ai_content_storage_cleanup(uuid,uuid,text,text,uuid,integer)',
    'public.complete_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)',
    'public.fail_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)',
    'public.is_ai_content_storage_path_protected(uuid,text)'
  ] loop
    execute format('alter function %s owner to current_user',missing_relations);
    if (select pg_get_userbyid(function.proowner) from pg_proc function
      where function.oid=to_regprocedure(missing_relations))<>current_user then
      raise exception 'ai_content_075_owner_transfer_mismatch:%',missing_relations;
    end if;
    final_acl_catalog_sha256:=public.apply_ai_content_075_acl_command(
      'REVOKE','function:'||missing_relations,'PUBLIC','ALL');
    for item in
      select distinct grantee.rolname
        from pg_proc function
        cross join lateral aclexplode(coalesce(function.proacl,acldefault('f',function.proowner))) acl
        join pg_roles grantee on grantee.oid=acl.grantee
       where function.oid=to_regprocedure(missing_relations) and acl.grantee<>function.proowner
    loop
      final_acl_catalog_sha256:=public.apply_ai_content_075_acl_command(
        'REVOKE','function:'||missing_relations,item.rolname,'ALL');
    end loop;
  end loop;

  foreach missing_relations in array array[
    'ai_content_cutover_release_adoptions','ai_content_cutover_release_adoption_events'
  ] loop
    final_acl_catalog_sha256:=public.apply_ai_content_075_acl_command(
      'GRANT','table:public.'||missing_relations,bootstrap.operator_role_name::text,'SELECT');
  end loop;
  final_acl_catalog_sha256:=public.apply_ai_content_075_acl_command(
    'GRANT','table:public.ai_content_storage_cleanup_outbox',bootstrap.cleanup_role_name::text,'SELECT');

  foreach missing_relations in array array[
    'ai_content_generation_operations','ai_content_proposal_performance_audits',
    'automated_content_proposal_runs','ai_content_proposal_job_contracts',
    'ai_content_proposal_compositions','ai_content_proposal_research_attempts',
    'ai_content_proposal_model_attempts'
  ] loop
    final_acl_catalog_sha256:=public.apply_ai_content_075_acl_command(
      'GRANT','table:public.'||missing_relations,bootstrap.application_role_name::text,'INSERT,SELECT');
  end loop;
  foreach missing_relations in array array[
    'ai_content_proposal_research_attempt_events','ai_content_proposal_attempt_events',
    'ai_content_generation_prompt_bindings'
  ] loop
    final_acl_catalog_sha256:=public.apply_ai_content_075_acl_command(
      'GRANT','table:public.'||missing_relations,bootstrap.application_role_name::text,'SELECT');
  end loop;

  foreach missing_relations in array array[
    'public.begin_ai_content_cutover_release_adoption(uuid,uuid,text,text,text,text,text,text)',
    'public.append_ai_content_cutover_release_adoption_event(uuid,integer,integer,text,jsonb,text)'
  ] loop
    final_acl_catalog_sha256:=public.apply_ai_content_075_acl_command(
      'GRANT','function:'||missing_relations,bootstrap.operator_role_name::text,'EXECUTE');
  end loop;
  foreach missing_relations in array array[
    'public.claim_ai_content_storage_cleanup(uuid,uuid,text,text,uuid,integer)',
    'public.complete_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)',
    'public.fail_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)'
  ] loop
    final_acl_catalog_sha256:=public.apply_ai_content_075_acl_command(
      'GRANT','function:'||missing_relations,bootstrap.cleanup_role_name::text,'EXECUTE');
  end loop;
  foreach missing_relations in array array[
    'public.transition_ai_content_generation_operation(uuid,text,text)',
    'public.transition_automated_content_proposal_run(uuid,text,text,uuid,uuid,uuid,text,text)',
    'public.append_ai_content_proposal_research_attempt_event(uuid,uuid,integer,text,uuid,jsonb,text,text)',
    'public.complete_ai_content_proposal_research(uuid,uuid,jsonb,text,jsonb,text,text)',
    'public.append_ai_content_proposal_attempt_event(uuid,uuid,integer,integer,text,text,text,text,text,text,text,text,boolean)',
    'public.create_ai_content_generation_prompt_binding(uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb)',
    'public.create_ai_content_cutover_topic_upload(uuid,uuid,uuid,text,text,jsonb)',
    'public.is_ai_content_storage_path_protected(uuid,text)'
  ] loop
    final_acl_catalog_sha256:=public.apply_ai_content_075_acl_command(
      'GRANT','function:'||missing_relations,bootstrap.application_role_name::text,'EXECUTE');
  end loop;

  if exists (select 1 from public.ai_content_bootstrap_state where singleton
    and (cutover_075_acl_command_tag is not null or cutover_075_acl_object_identity is not null
      or cutover_075_acl_grantee is not null or cutover_075_acl_privileges is not null
      or cutover_075_acl_pre_catalog_sha256 is not null or cutover_075_acl_post_catalog_sha256 is not null)) then
    raise exception 'ai_content_075_acl_command_not_consumed';
  end if;
  if final_acl_catalog_sha256 is null or final_acl_catalog_sha256 is distinct from encode(digest(
       public.ai_content_075_acl_catalog(null,null,null,null)::text,'sha256'),'hex') then
    raise exception 'ai_content_075_acl_final_catalog_invalid';
  end if;
  if public.verify_ai_content_075_acl_final_catalog() is distinct from final_acl_catalog_sha256 then
    raise exception 'ai_content_075_acl_final_catalog_invalid';
  end if;
  perform set_config('app.ai_content_075_fence_registration','armed',true);
  perform public.verify_ai_content_write_fence_catalog();
  return '22ebe515247269120f8996bc63f335f27b7f767c36fcf667011312cfb03f3661';
end;
$$;

create function forbid_ai_content_cutover_event_mutation() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  raise exception 'ai_content_cutover_event_immutable';
end;
$$;

create trigger ai_content_cutover_status_events_immutable
before update or delete on ai_content_cutover_status_events
for each row execute function forbid_ai_content_cutover_event_mutation();

create function prepare_ai_content_cutover(
  p_cutover_id uuid,
  p_schema_owner name,
  p_application_role name,
  p_operator_role name,
  p_migration_role name,
  p_cleanup_role name,
  p_bypass_token_sha256 text,
  p_cleanup_token_sha256 text,
  p_role_catalog_sha256 text,
  p_provider_backup_id text,
  p_provider_snapshot_created_at timestamptz,
  p_incident_bundle_sha256 text,
  p_preserved_manifest_sha256 text,
  p_preflight_identity_json jsonb,
  p_preflight_transfer_sha256 text,
  p_intended_release_sha text,
  p_evidence_sha256 text
) returns text
language plpgsql security definer set search_path=pg_catalog,public as $$
declare event_hash text;
declare preflight_identity_sha256 text;
declare bootstrap public.ai_content_bootstrap_state%rowtype;
begin
  select * into strict bootstrap from public.ai_content_bootstrap_state where singleton for update;
  if p_schema_owner<>bootstrap.schema_owner_role_name
     or p_application_role<>bootstrap.application_role_name
     or p_operator_role<>bootstrap.operator_role_name
     or p_migration_role<>bootstrap.migration_role_name
     or p_cleanup_role<>bootstrap.cleanup_role_name
     or p_role_catalog_sha256<>bootstrap.role_catalog_sha256 then
    raise exception 'ai_content_cutover_roles_not_sealed';
  end if;
  preflight_identity_sha256:=encode(digest(p_preflight_identity_json::text,'sha256'),'hex');
  event_hash := encode(digest(concat_ws('|',p_cutover_id::text,'0','', 'prepared',
    p_evidence_sha256,p_schema_owner::text,p_application_role::text,p_operator_role::text,
    p_migration_role::text,p_cleanup_role::text,p_bypass_token_sha256,p_cleanup_token_sha256,
    p_role_catalog_sha256,preflight_identity_sha256,p_preflight_transfer_sha256),'sha256'),'hex');
  insert into public.ai_content_cutovers (
    id,status,migration_id,schema_owner_role_name,application_role_name,operator_role_name,
    migration_role_name,cleanup_role_name,bypass_token_sha256,cleanup_token_sha256,
    database_role_catalog_sha256,provider_backup_id,provider_snapshot_created_at,
    incident_bundle_sha256,preserved_data_manifest_sha256,proposal_preflight_identity_json,
    proposal_preflight_identity_sha256,proposal_preflight_transfer_sha256,
    intended_release_sha,latest_status_event_sha256
  ) values (
    p_cutover_id,'prepared','075_ai_content_three_format_cutover.sql',p_schema_owner,p_application_role,
    p_operator_role,p_migration_role,p_cleanup_role,p_bypass_token_sha256,p_cleanup_token_sha256,
    p_role_catalog_sha256,p_provider_backup_id,p_provider_snapshot_created_at,p_incident_bundle_sha256,
    p_preserved_manifest_sha256,p_preflight_identity_json,preflight_identity_sha256,
    p_preflight_transfer_sha256,p_intended_release_sha,event_hash
  );
  insert into public.ai_content_cutover_status_events (
    cutover_id,sequence_number,from_status,to_status,evidence_sha256,previous_event_sha256,event_sha256
  ) values (p_cutover_id,0,null,'prepared',p_evidence_sha256,null,event_hash);
  return event_hash;
end;
$$;

create function set_ai_content_maintenance(p_cutover_id uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare cutover_status text;
begin
  select status into strict cutover_status from public.ai_content_cutovers where id=p_cutover_id for update;
  if p_enabled then
    if cutover_status not in ('prepared','maintenance_verified') then
      raise exception 'ai_content_maintenance_enable_invalid';
    end if;
    update public.ai_content_maintenance_state
       set enabled=true,cutover_id=p_cutover_id,enabled_at=coalesce(enabled_at,now())
     where singleton and (not enabled or cutover_id=p_cutover_id);
    if not found then raise exception 'ai_content_maintenance_cutover_conflict'; end if;
  else
    if cutover_status not in ('completed','abandoned_pre_marker') then
      raise exception 'ai_content_maintenance_disable_invalid';
    end if;
    update public.ai_content_maintenance_state
       set enabled=false,cutover_id=null,enabled_at=null
     where singleton and (not enabled or cutover_id=p_cutover_id);
    if not found then raise exception 'ai_content_maintenance_cutover_conflict'; end if;
  end if;
end;
$$;

create function transition_ai_content_cutover_status(
  p_cutover_id uuid,
  p_from_status text,
  p_to_status text,
  p_evidence_sha256 text,
  p_abandoned_reason text default null,
  p_successor_cutover_id uuid default null,
  p_cleanup_revoked_at timestamptz default null,
  p_cleanup_revocation_sha256 text default null,
  p_post_075_bootstrap_object_catalog_sha256 text default null
) returns text
language plpgsql security definer set search_path=pg_catalog,public as $$
declare current_row public.ai_content_cutovers%rowtype;
declare previous_event public.ai_content_cutover_status_events%rowtype;
declare next_sequence integer;
declare next_hash text;
declare marker_present boolean;
declare bootstrap public.ai_content_bootstrap_state%rowtype;
declare supplied_cutover uuid;
declare supplied_token text;
declare supplied_migration text;
begin
  if not ((
    (p_to_status='migration_body_complete'
      and p_post_075_bootstrap_object_catalog_sha256 ~ '^[0-9a-f]{64}$')
    or (p_to_status<>'migration_body_complete'
      and p_post_075_bootstrap_object_catalog_sha256 is null)
  ) is true) then
    raise exception 'ai_content_cutover_post_075_object_catalog_evidence_invalid';
  end if;
  select * into strict current_row from public.ai_content_cutovers where id=p_cutover_id for update;
  perform public.verify_ai_content_cutover_status_chain(p_cutover_id);
  marker_present := exists (select 1 from public.schema_migrations where id='075_ai_content_three_format_cutover.sql');
  select * into strict bootstrap from public.ai_content_bootstrap_state where singleton;
  if session_user=bootstrap.migration_role_name::text then
    supplied_cutover := nullif(current_setting('app.ai_content_cutover_id',true),'')::uuid;
    supplied_token := nullif(current_setting('app.ai_content_cutover_token',true),'');
    supplied_migration := nullif(current_setting('app.ai_content_migration_id',true),'');
    if p_from_status<>'maintenance_verified' or p_to_status<>'migration_body_complete'
       or p_abandoned_reason is not null or p_successor_cutover_id is not null
       or p_cleanup_revoked_at is not null or p_cleanup_revocation_sha256 is not null
       or supplied_cutover is distinct from p_cutover_id or supplied_token is null
       or supplied_migration is distinct from '075_ai_content_three_format_cutover.sql'
       or current_row.migration_id<>supplied_migration
       or current_row.migration_role_name<>bootstrap.migration_role_name
       or current_row.schema_owner_role_name<>bootstrap.schema_owner_role_name
       or current_row.application_role_name<>bootstrap.application_role_name
       or current_row.operator_role_name<>bootstrap.operator_role_name
       or current_row.cleanup_role_name<>bootstrap.cleanup_role_name
       or current_row.database_role_catalog_sha256<>bootstrap.role_catalog_sha256
       or current_row.bypass_token_sha256<>encode(digest(supplied_token,'sha256'),'hex')
       or not marker_present
       or not exists (
         select 1 from public.ai_content_maintenance_state maintenance
          where maintenance.singleton and maintenance.enabled and maintenance.cutover_id=p_cutover_id
       ) then
      raise exception 'ai_content_cutover_migration_transition_invalid';
    end if;
  end if;
  if current_row.status<>p_from_status then
    select event_sha256 into next_hash from public.ai_content_cutover_status_events
     where cutover_id=p_cutover_id and from_status=p_from_status and to_status=p_to_status
       and evidence_sha256=p_evidence_sha256
       and post_075_bootstrap_object_catalog_sha256
         is not distinct from p_post_075_bootstrap_object_catalog_sha256;
    if next_hash is not null and current_row.status=p_to_status then return next_hash; end if;
    raise exception 'ai_content_cutover_status_conflict';
  end if;
  select * into strict previous_event from public.ai_content_cutover_status_events
   where cutover_id=p_cutover_id and event_sha256=current_row.latest_status_event_sha256 for update;
  if p_to_status='abandoned_pre_marker' then
    if marker_present or p_from_status not in ('prepared','maintenance_verified') or p_abandoned_reason is null then
      raise exception 'ai_content_cutover_transition_invalid';
    end if;
  elsif not ((p_from_status,p_to_status) in (
    ('prepared','maintenance_verified'),('maintenance_verified','migration_body_complete'),
    ('migration_body_complete','backend_verified'),('backend_verified','completed')
  )) then
    raise exception 'ai_content_cutover_transition_invalid';
  end if;
  if p_to_status in ('migration_body_complete','backend_verified','completed') and not marker_present then
    raise exception 'ai_content_cutover_marker_required';
  end if;
  next_sequence := previous_event.sequence_number+1;
  next_hash := encode(digest(concat_ws('|',p_cutover_id::text,next_sequence::text,p_from_status,p_to_status,
    p_evidence_sha256,p_post_075_bootstrap_object_catalog_sha256,
    previous_event.event_sha256),'sha256'),'hex');
  insert into public.ai_content_cutover_status_events (
    cutover_id,sequence_number,from_status,to_status,evidence_sha256,
    post_075_bootstrap_object_catalog_sha256,previous_event_sha256,event_sha256
  ) values (p_cutover_id,next_sequence,p_from_status,p_to_status,p_evidence_sha256,
    p_post_075_bootstrap_object_catalog_sha256,previous_event.event_sha256,next_hash);
  update public.ai_content_cutovers set status=p_to_status, latest_status_event_sha256=next_hash,
    status_changed_at=now(), abandoned_reason=p_abandoned_reason, successor_cutover_id=p_successor_cutover_id,
    cleanup_credential_revoked_at=p_cleanup_revoked_at,
    cleanup_revocation_evidence_sha256=p_cleanup_revocation_sha256
  where id=p_cutover_id;
  if p_from_status='maintenance_verified' and p_to_status='migration_body_complete' then
    update public.ai_content_bootstrap_state
       set cutover_075_fence_registration_xid=null,
           cutover_075_fence_registration_cutover_id=null
     where singleton
       and cutover_075_fence_registration_xid=pg_current_xact_id()::text
       and cutover_075_fence_registration_cutover_id=p_cutover_id;
    if not found then
      raise exception 'ai_content_075_fence_registration_transaction_invalid';
    end if;
  end if;
  return next_hash;
end;
$$;

create function read_ai_content_cutover_migration_body_evidence(p_cutover_id uuid)
returns table (
  evidence_sha256 text,
  post_075_bootstrap_object_catalog_sha256 text,
  event_sha256 text
)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare bootstrap public.ai_content_bootstrap_state%rowtype;
declare cutover_row public.ai_content_cutovers%rowtype;
declare maintenance public.ai_content_maintenance_state%rowtype;
declare body_event public.ai_content_cutover_status_events%rowtype;
declare supplied_cutover uuid;
declare supplied_token text;
declare supplied_migration text;
declare body_event_count integer;
declare outer_role text;
begin
  select * into strict bootstrap
    from public.ai_content_bootstrap_state where singleton for share;
  outer_role:=coalesce(nullif(current_setting('role',true),'none'),session_user);
  if session_user is distinct from bootstrap.migration_role_name::text
     or outer_role is distinct from bootstrap.migration_role_name::text then
    raise exception 'ai_content_cutover_migration_body_evidence_role_invalid';
  end if;
  supplied_cutover:=nullif(current_setting('app.ai_content_cutover_id',true),'')::uuid;
  supplied_token:=nullif(current_setting('app.ai_content_cutover_token',true),'');
  supplied_migration:=nullif(current_setting('app.ai_content_migration_id',true),'');
  lock table public.ai_content_ddl_allowlist in share mode;
  select * into strict cutover_row
    from public.ai_content_cutovers where id=p_cutover_id for update;
  select * into strict maintenance
    from public.ai_content_maintenance_state where singleton for share;
  if supplied_cutover is distinct from p_cutover_id
     or supplied_token is null
     or supplied_migration is distinct from '075_ai_content_three_format_cutover.sql'
     or cutover_row.status<>'migration_body_complete'
     or cutover_row.migration_id<>supplied_migration
     or cutover_row.migration_role_name<>bootstrap.migration_role_name
     or cutover_row.schema_owner_role_name<>bootstrap.schema_owner_role_name
     or cutover_row.application_role_name<>bootstrap.application_role_name
     or cutover_row.operator_role_name<>bootstrap.operator_role_name
     or cutover_row.cleanup_role_name<>bootstrap.cleanup_role_name
     or cutover_row.database_role_catalog_sha256<>bootstrap.role_catalog_sha256
     or cutover_row.bypass_token_sha256<>encode(digest(supplied_token,'sha256'),'hex')
     or not maintenance.enabled
     or maintenance.cutover_id<>p_cutover_id
     or not exists (
       select 1 from public.schema_migrations
        where id='075_ai_content_three_format_cutover.sql'
     ) then
    raise exception 'ai_content_cutover_migration_body_evidence_state_invalid';
  end if;
  perform public.verify_ai_content_cutover_status_chain_locked(cutover_row);
  select count(*) into body_event_count
    from public.ai_content_cutover_status_events event
   where event.cutover_id=p_cutover_id
     and event.from_status='maintenance_verified'
     and event.to_status='migration_body_complete';
  if body_event_count<>1 then
    raise exception 'ai_content_cutover_migration_body_evidence_event_invalid';
  end if;
  select event.* into strict body_event
    from public.ai_content_cutover_status_events event
   where event.cutover_id=p_cutover_id
     and event.from_status='maintenance_verified'
     and event.to_status='migration_body_complete'
   for update;
  if body_event.event_sha256<>cutover_row.latest_status_event_sha256
     or body_event.evidence_sha256 !~ '^[0-9a-f]{64}$'
     or body_event.post_075_bootstrap_object_catalog_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'ai_content_cutover_migration_body_evidence_event_invalid';
  end if;
  return query select body_event.evidence_sha256,
    body_event.post_075_bootstrap_object_catalog_sha256,body_event.event_sha256;
end;
$$;

create function verify_ai_content_write_fence_catalog() returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare mismatch integer;
declare catalog_hash text;
declare marker_present boolean;
declare registration_active boolean;
declare bootstrap public.ai_content_bootstrap_state%rowtype;
begin
  select encode(digest(coalesce(string_agg(
           concat_ws('|',relation_name,relation_class,row_classifier), E'\n'
           order by relation_name collate "C"
         ),''),'sha256'),'hex')
    into catalog_hash
    from public.ai_content_write_fence_catalog;
  if to_regclass('public.schema_migrations') is null then
    marker_present := false;
  elsif has_table_privilege(current_user,'public.schema_migrations','SELECT') then
    select exists (
      select 1 from public.schema_migrations
       where id='075_ai_content_three_format_cutover.sql'
    ) into marker_present;
  elsif catalog_hash='0064a071335735af54bc80a84524fed783e5db72bf19055555a6b1c64d398c7a' then
    marker_present := false;
  else
    raise exception 'ai_content_write_fence_marker_visibility_invalid';
  end if;
  registration_active := false;
  if not marker_present
     and nullif(current_setting('app.ai_content_075_fence_registration',true),'')='armed'
     and nullif(current_setting('app.ai_content_migration_id',true),'')='075_ai_content_three_format_cutover.sql' then
    select * into bootstrap
      from public.ai_content_bootstrap_state where singleton;
    registration_active := found
      and coalesce(
        bootstrap.cutover_075_fence_registration_xid=pg_current_xact_id()::text,
        false
      )
      and coalesce(
        bootstrap.cutover_075_fence_registration_cutover_id
          =nullif(current_setting('app.ai_content_cutover_id',true),'')::uuid,
        false
      )
      and coalesce(public.ai_content_cutover_bypass_allowed(),false);
  end if;
  if (marker_present and catalog_hash<>'22ebe515247269120f8996bc63f335f27b7f767c36fcf667011312cfb03f3661')
     or (not marker_present and registration_active
       and catalog_hash not in (
         '0064a071335735af54bc80a84524fed783e5db72bf19055555a6b1c64d398c7a',
         '22ebe515247269120f8996bc63f335f27b7f767c36fcf667011312cfb03f3661'
       ))
     or (not marker_present and not registration_active
       and catalog_hash<>'0064a071335735af54bc80a84524fed783e5db72bf19055555a6b1c64d398c7a') then
    raise exception 'ai_content_write_fence_catalog_exact_mismatch';
  end if;
  select count(*) into mismatch
    from public.ai_content_write_fence_catalog catalog
    left join pg_class relation
      on relation.oid=to_regclass('public.' || catalog.relation_name)
   where relation.oid is null
      or relation.relkind<>'r'
      or relation.relpersistence<>'p'
      or relation.relreplident<>'d'
      or relation.relispartition
      or relation.relpartbound is not null
      or exists (
        select 1 from pg_inherits inheritance
         where inheritance.inhrelid=relation.oid
      )
      or exists (
        select 1 from pg_trigger internal_trigger
         where internal_trigger.tgrelid=relation.oid
           and internal_trigger.tgisinternal
           and internal_trigger.tgconstraint<>0
           and internal_trigger.tgenabled='D'
      )
      or relation.relrowsecurity
      or relation.relforcerowsecurity
      or exists (
        select 1 from pg_rewrite rule
         where rule.ev_class=relation.oid
           and not (relation.relkind in ('v','m') and rule.rulename='_RETURN')
      )
      or exists (
        select 1 from pg_policy policy where policy.polrelid=relation.oid
      );
  if mismatch<>0 then
    raise exception 'ai_content_write_fence_relation_structure_mismatch';
  end if;
  select count(*) into mismatch
    from public.ai_content_write_fence_catalog c
    left join pg_class rel on rel.oid=to_regclass('public.' || c.relation_name)
    left join pg_trigger t on t.tgrelid=rel.oid
      and t.tgname=public.ai_content_fence_trigger_name(c.relation_name)
      and not t.tgisinternal
   where c.relation_class='customer_execution'
     and (
       t.oid is null
       or t.tgenabled<>'A'
       or t.tgtype<>31
       or t.tgfoid<>'public.enforce_ai_content_write_fence()'::regprocedure
       or pg_get_triggerdef(t.oid,true)<>format(
         'CREATE TRIGGER %I BEFORE INSERT OR DELETE OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION enforce_ai_content_write_fence()',
         public.ai_content_fence_trigger_name(c.relation_name),c.relation_name
       )
     );
  if mismatch<>0 then raise exception 'ai_content_write_fence_catalog_mismatch'; end if;
  select count(*) into mismatch
    from pg_trigger t
   where not t.tgisinternal
     and t.tgfoid='public.enforce_ai_content_write_fence()'::regprocedure
     and not exists (
       select 1 from public.ai_content_write_fence_catalog c
        where c.relation_class='customer_execution'
          and t.tgrelid=to_regclass('public.' || c.relation_name)
          and t.tgname=public.ai_content_fence_trigger_name(c.relation_name)
     );
  if mismatch<>0 then raise exception 'ai_content_write_fence_extra_trigger'; end if;
  select count(*) into mismatch
    from pg_trigger trigger
    join pg_class relation on relation.oid=trigger.tgrelid
    join pg_namespace namespace on namespace.oid=relation.relnamespace
   where not trigger.tgisinternal
     and namespace.nspname='public'
     and relation.relname in (
       'ai_content_bootstrap_state','ai_content_cutover_status_events','ai_content_cutovers',
       'ai_content_ddl_allowlist','ai_content_maintenance_state','ai_content_write_fence_catalog'
     );
  if mismatch<>2 or not exists (
    select 1 from pg_trigger trigger
     where trigger.tgrelid='public.ai_content_bootstrap_state'::regclass
       and trigger.tgname='ai_content_bootstrap_075_registration_must_clear'
       and not trigger.tgisinternal and trigger.tgtype=21 and trigger.tgenabled='O'
       and trigger.tgdeferrable and trigger.tginitdeferred
       and trigger.tgfoid='public.enforce_ai_content_075_registration_seal_cleared()'::regprocedure
       and pg_get_triggerdef(trigger.oid,true)=
         'CREATE CONSTRAINT TRIGGER ai_content_bootstrap_075_registration_must_clear AFTER INSERT OR UPDATE ON ai_content_bootstrap_state DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_ai_content_075_registration_seal_cleared()'
  ) or not exists (
    select 1 from pg_trigger trigger
     where trigger.tgrelid='public.ai_content_cutover_status_events'::regclass
       and trigger.tgname='ai_content_cutover_status_events_immutable'
       and not trigger.tgisinternal and trigger.tgtype=27 and trigger.tgenabled='O'
       and not trigger.tgdeferrable and not trigger.tginitdeferred
       and trigger.tgfoid='public.forbid_ai_content_cutover_event_mutation()'::regprocedure
       and pg_get_triggerdef(trigger.oid,true)=
         'CREATE TRIGGER ai_content_cutover_status_events_immutable BEFORE DELETE OR UPDATE ON ai_content_cutover_status_events FOR EACH ROW EXECUTE FUNCTION forbid_ai_content_cutover_event_mutation()'
  ) then raise exception 'ai_content_write_fence_control_trigger_mismatch'; end if;
  select * into bootstrap
    from public.ai_content_bootstrap_state where singleton;
  if found and bootstrap.provider_attestation_sha256 is not null then
    select count(*) into mismatch
      from aclexplode(coalesce(
        (select relation.relacl from pg_class relation
          where relation.oid='public.ai_content_cutovers'::regclass),
        acldefault('r',(select relation.relowner from pg_class relation
          where relation.oid='public.ai_content_cutovers'::regclass))
      )) acl
      left join pg_roles grantee on grantee.oid=acl.grantee
     where acl.grantee=0
        or (acl.grantee<>(select relation.relowner from pg_class relation
              where relation.oid='public.ai_content_cutovers'::regclass)
          and not (
            grantee.rolname=bootstrap.schema_owner_role_name::text
            and acl.privilege_type='REFERENCES'
            and not acl.is_grantable
          ));
    if mismatch<>0 or not exists (
      select 1
        from aclexplode(coalesce(
          (select relation.relacl from pg_class relation
            where relation.oid='public.ai_content_cutovers'::regclass),
          acldefault('r',(select relation.relowner from pg_class relation
            where relation.oid='public.ai_content_cutovers'::regclass))
        )) acl
        join pg_roles grantee on grantee.oid=acl.grantee
       where grantee.rolname=bootstrap.schema_owner_role_name::text
         and acl.privilege_type='REFERENCES'
         and not acl.is_grantable
    ) then
      raise exception 'ai_content_cutovers_schema_owner_references_acl_invalid';
    end if;
  end if;
  return true;
end;
$$;

create function consume_ai_content_provider_attestation() returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare bootstrap public.ai_content_bootstrap_state%rowtype;
begin
  select * into strict bootstrap from public.ai_content_bootstrap_state where singleton for update;
  if session_user<>bootstrap.migration_role_name::text then
    raise exception 'bootstrap_074_consume_role_invalid';
  end if;
  if bootstrap.provider_attestation_json is null
     or bootstrap.provider_attestation_sha256 is null
     or bootstrap.revocation_request_json is null
     or bootstrap.revocation_request_sha256 is null
     or bootstrap.final_fence_security_catalog_sha256 is null
     or bootstrap.event_trigger_catalog_after_sha256 is null
     or bootstrap.event_trigger_catalog_after_count is null then
    raise exception 'bootstrap_074_provider_evidence_incomplete';
  end if;
  if bootstrap.attestation_consumed_at is not null then return false; end if;
  update public.ai_content_bootstrap_state set attestation_consumed_at=now() where singleton;
  return true;
end;
$$;

-- The Supabase platform postgres stage creates the sole DDL event trigger later.
-- This migration intentionally contains no CREATE/ALTER EVENT TRIGGER statement.
revoke all on table ai_content_cutovers,ai_content_cutover_status_events,
  ai_content_maintenance_state,ai_content_bootstrap_state,ai_content_ddl_allowlist,
  ai_content_write_fence_catalog from public;
revoke execute on function ai_content_cutover_bypass_allowed(),assert_ai_content_writable(),
  lock_ai_content_cutover_transaction_state(uuid),verify_ai_content_cutover_status_chain(uuid),
  verify_ai_content_cutover_preflight_identity(uuid,jsonb,text,text),
  verify_ai_content_cutover_status_chain_locked(ai_content_cutovers),
  enforce_ai_content_write_fence(),enforce_ai_content_ddl_allowlist(),ai_content_fence_trigger_name(text),
  ai_content_075_acl_catalog(text,text,text,text),apply_ai_content_075_acl_command(text,text,text,text),
  verify_ai_content_075_acl_final_catalog(),
  enforce_ai_content_075_registration_seal_cleared(),
  forbid_ai_content_cutover_event_mutation(),prepare_ai_content_cutover(uuid,name,name,name,name,name,text,text,text,text,timestamptz,text,text,jsonb,text,text,text),
  set_ai_content_maintenance(uuid,boolean),
  transition_ai_content_cutover_status(uuid,text,text,text,text,uuid,timestamptz,text,text),
  read_ai_content_cutover_migration_body_evidence(uuid),
  verify_ai_content_write_fence_catalog(),consume_ai_content_provider_attestation() from public;
revoke execute on function register_ai_content_075_fence_relations() from public;
select verify_ai_content_write_fence_catalog();

commit;
