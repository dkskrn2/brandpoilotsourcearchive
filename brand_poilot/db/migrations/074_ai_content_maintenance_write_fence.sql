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
  previous_event_sha256 text null check (previous_event_sha256 is null or previous_event_sha256 ~ '^[0-9a-f]{64}$'),
  event_sha256 text not null unique check (event_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (cutover_id, sequence_number)
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
  created_at timestamptz not null default now(),
  constraint ai_content_bootstrap_provider_evidence_pair_check check (
    (provider_attestation_json is null and provider_attestation_sha256 is null and attestation_consumed_at is null
      and revocation_request_json is null and revocation_request_sha256 is null
      and event_trigger_catalog_after_sha256 is null and event_trigger_catalog_after_count is null)
    or (provider_attestation_json is not null and provider_attestation_sha256 is not null and attestation_consumed_at is not null
      and revocation_request_json is not null and revocation_request_sha256 is not null
      and event_trigger_catalog_after_sha256 is not null and event_trigger_catalog_after_count is not null)
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
    'ai_content_generated_artifact','ai_content_scheduled_publish','daily_generation_automation'
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

create function ai_content_cutover_bypass_allowed() returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare cutover uuid;
declare supplied_token text;
begin
  cutover := nullif(current_setting('app.ai_content_cutover_id', true), '')::uuid;
  supplied_token := nullif(current_setting('app.ai_content_cutover_token', true), '');
  if cutover is null or supplied_token is null then return false; end if;
  return exists (
    select 1
      from public.ai_content_cutovers c
      join public.ai_content_maintenance_state m on m.singleton and m.enabled and m.cutover_id=c.id
     where c.id=cutover and c.status='maintenance_verified'
       and c.migration_role_name=session_user
       and c.bypass_token_sha256=encode(digest(supplied_token,'sha256'),'hex')
       and not exists (select 1 from public.schema_migrations where id='075_ai_content_three_format_cutover.sql')
  );
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

create function enforce_ai_content_ddl_allowlist() returns event_trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare command record;
declare expected_migration text;
declare bootstrap public.ai_content_bootstrap_state%rowtype;
begin
  select * into strict bootstrap from public.ai_content_bootstrap_state where singleton;
  if session_user<>bootstrap.migration_role_name::text
     and current_user<>bootstrap.schema_owner_role_name::text then
    return;
  end if;
  if session_user<>bootstrap.migration_role_name::text
     or current_user<>bootstrap.schema_owner_role_name::text then
    raise exception 'ai_content_ddl_role_edge_invalid';
  end if;
  expected_migration := nullif(current_setting('app.ai_content_migration_id', true), '');
  if tg_event<>'ddl_command_end'
     or expected_migration<>'075_ai_content_three_format_cutover.sql'
     or not public.ai_content_cutover_bypass_allowed() then
    raise exception 'ai_content_ddl_not_authorized';
  end if;
  for command in select * from pg_event_trigger_ddl_commands()
  loop
    if not exists (
      select 1 from public.ai_content_ddl_allowlist allowed
       where allowed.migration_id=expected_migration
         and allowed.command_tag=command.command_tag
         and command.object_identity like allowed.object_identity_pattern
    ) then
      raise exception 'ai_content_ddl_not_allowlisted:%:%',command.command_tag,command.object_identity;
    end if;
  end loop;
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
    else should_fence := exists (select 1 from public.channel_outputs output where output.id=old.channel_output_id and output.ai_content_generation_output_id is not null)
      or exists (select 1 from public.channel_outputs output where output.id=new.channel_output_id and output.ai_content_generation_output_id is not null); end if;
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
  p_preflight_transfer_sha256 text,
  p_intended_release_sha text,
  p_evidence_sha256 text
) returns text
language plpgsql security definer set search_path=pg_catalog,public as $$
declare event_hash text;
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
  event_hash := encode(digest(concat_ws('|',p_cutover_id::text,'0','', 'prepared',
    p_evidence_sha256,p_schema_owner::text,p_application_role::text,p_operator_role::text,
    p_migration_role::text,p_cleanup_role::text,p_bypass_token_sha256,p_cleanup_token_sha256,
    p_role_catalog_sha256),'sha256'),'hex');
  insert into public.ai_content_cutovers (
    id,status,migration_id,schema_owner_role_name,application_role_name,operator_role_name,
    migration_role_name,cleanup_role_name,bypass_token_sha256,cleanup_token_sha256,
    database_role_catalog_sha256,provider_backup_id,provider_snapshot_created_at,
    incident_bundle_sha256,preserved_data_manifest_sha256,proposal_preflight_transfer_sha256,
    intended_release_sha,latest_status_event_sha256
  ) values (
    p_cutover_id,'prepared','075_ai_content_three_format_cutover.sql',p_schema_owner,p_application_role,
    p_operator_role,p_migration_role,p_cleanup_role,p_bypass_token_sha256,p_cleanup_token_sha256,
    p_role_catalog_sha256,p_provider_backup_id,p_provider_snapshot_created_at,p_incident_bundle_sha256,
    p_preserved_manifest_sha256,p_preflight_transfer_sha256,p_intended_release_sha,event_hash
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
  p_cleanup_revocation_sha256 text default null
) returns text
language plpgsql security definer set search_path=pg_catalog,public as $$
declare current_row public.ai_content_cutovers%rowtype;
declare previous_event public.ai_content_cutover_status_events%rowtype;
declare next_sequence integer;
declare next_hash text;
declare marker_present boolean;
begin
  select * into strict current_row from public.ai_content_cutovers where id=p_cutover_id for update;
  if current_row.status<>p_from_status then
    select event_sha256 into next_hash from public.ai_content_cutover_status_events
     where cutover_id=p_cutover_id and from_status=p_from_status and to_status=p_to_status
       and evidence_sha256=p_evidence_sha256;
    if next_hash is not null and current_row.status=p_to_status then return next_hash; end if;
    raise exception 'ai_content_cutover_status_conflict';
  end if;
  select * into strict previous_event from public.ai_content_cutover_status_events
   where cutover_id=p_cutover_id and event_sha256=current_row.latest_status_event_sha256 for update;
  marker_present := exists (select 1 from public.schema_migrations where id='075_ai_content_three_format_cutover.sql');
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
    p_evidence_sha256,previous_event.event_sha256),'sha256'),'hex');
  insert into public.ai_content_cutover_status_events (
    cutover_id,sequence_number,from_status,to_status,evidence_sha256,previous_event_sha256,event_sha256
  ) values (p_cutover_id,next_sequence,p_from_status,p_to_status,p_evidence_sha256,previous_event.event_sha256,next_hash);
  update public.ai_content_cutovers set status=p_to_status, latest_status_event_sha256=next_hash,
    status_changed_at=now(), abandoned_reason=p_abandoned_reason, successor_cutover_id=p_successor_cutover_id,
    cleanup_credential_revoked_at=p_cleanup_revoked_at,
    cleanup_revocation_evidence_sha256=p_cleanup_revocation_sha256
  where id=p_cutover_id;
  return next_hash;
end;
$$;

create function verify_ai_content_write_fence_catalog() returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare mismatch integer;
declare catalog_hash text;
begin
  select encode(digest(string_agg(
           concat_ws('|',relation_name,relation_class,row_classifier), E'\n'
           order by relation_name
         ),'sha256'),'hex')
    into catalog_hash
    from public.ai_content_write_fence_catalog;
  if catalog_hash<>'4a36aebb9b4e56e19ab35ec08e45b3e3f625bb4a87f98359ca08658a4e6e132b' then
    raise exception 'ai_content_write_fence_catalog_exact_mismatch';
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
  return true;
end;
$$;

-- The Supabase platform postgres stage creates the sole DDL event trigger later.
-- This migration intentionally contains no CREATE/ALTER EVENT TRIGGER statement.
revoke all on table ai_content_cutovers,ai_content_cutover_status_events,
  ai_content_maintenance_state,ai_content_bootstrap_state,ai_content_ddl_allowlist,
  ai_content_write_fence_catalog from public;
revoke execute on function ai_content_cutover_bypass_allowed(),assert_ai_content_writable(),
  enforce_ai_content_write_fence(),enforce_ai_content_ddl_allowlist(),ai_content_fence_trigger_name(text),
  forbid_ai_content_cutover_event_mutation(),prepare_ai_content_cutover(uuid,name,name,name,name,name,text,text,text,text,timestamptz,text,text,text,text,text),
  set_ai_content_maintenance(uuid,boolean),
  transition_ai_content_cutover_status(uuid,text,text,text,text,uuid,timestamptz,text),
  verify_ai_content_write_fence_catalog() from public;
select verify_ai_content_write_fence_catalog();

commit;
