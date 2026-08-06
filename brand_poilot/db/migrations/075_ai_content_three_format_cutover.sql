begin;

-- Existing customer execution rows are intentionally not backfilled. Phase 2 Task 5
-- removes the incompatible graph; nullable compatibility columns keep this schema-only
-- checkpoint forward-only without fabricating operation, reservation, or reversal evidence.

create function reject_ai_content_cutover_record_mutation() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare unresolved_invocation boolean := false;
declare indeterminate_event boolean := false;
begin
  if tg_name='ai_content_generation_operations_initial_state' then
    if new.status is distinct from 'reserved' then
      raise exception 'ai_content_generation_operation_initial_status_invalid';
    end if;
    return new;
  end if;
  if tg_name='automated_content_proposal_runs_initial_state' then
    if new.status is distinct from 'queued' then
      raise exception 'automated_content_proposal_run_initial_status_invalid';
    end if;
    return new;
  end if;
  if tg_name='ai_content_proposal_jobs_contract_required' then
    if not exists (
      select 1 from public.ai_content_proposal_job_contracts contract
       where contract.job_id=new.id and contract.batch_id=new.batch_id
         and contract.workspace_id=new.workspace_id and contract.brand_id=new.brand_id
    ) then raise exception 'ai_content_proposal_job_contract_required'; end if;
    return null;
  end if;
  if tg_name='ai_content_proposal_jobs_invocation_reclaim_guard' then
    if tg_op='UPDATE' and old.status='manual_review_required'
       and old.error_code='invocation_indeterminate' then
      if new is distinct from old then
        raise exception 'proposal_invocation_manual_review_immutable';
      end if;
      return new;
    end if;
    if tg_op='UPDATE' and old.status='processing' and old.active_stage='model'
       and old.lease_expires_at is not null and old.lease_expires_at>clock_timestamp() then
      select exists (
        select 1
          from public.ai_content_proposal_model_attempts attempt
          join public.ai_content_proposal_attempt_events started
            on started.model_attempt_id=attempt.id and started.event_type='invocation_started'
         where attempt.job_id=old.id
           and not exists (
             select 1 from public.ai_content_proposal_attempt_events terminal
              where terminal.model_attempt_id=started.model_attempt_id
                and terminal.invocation_ordinal=started.invocation_ordinal
                and terminal.event_type in (
                  'invocation_completed','invocation_failed','invocation_indeterminate'
                )
           )
      ) into unresolved_invocation;
      if unresolved_invocation and not (
        new.status='processing' and new.active_stage='model'
        and new.lease_owner is not distinct from old.lease_owner
        and new.lease_token is not distinct from old.lease_token
        and new.lease_started_at is not distinct from old.lease_started_at
        and new.lease_expires_at is not null
        and new.lease_expires_at>=old.lease_expires_at
        and new.lease_expires_at<=clock_timestamp()+interval '5 minutes'
        and new.updated_at>=old.updated_at
        and (to_jsonb(new)-'lease_expires_at'-'updated_at')
          is not distinct from (to_jsonb(old)-'lease_expires_at'-'updated_at')
      ) is true then
        raise exception 'proposal_active_invocation_lease_takeover_invalid';
      end if;
    end if;
    if tg_op='UPDATE' and old.status='processing' and old.active_stage='model'
       and old.lease_expires_at is not null and old.lease_expires_at<=clock_timestamp() then
      if not pg_try_advisory_xact_lock(hashtextextended(old.id::text,0)) then
        raise exception 'proposal_invocation_reclaim_serialization_conflict';
      end if;
      select exists (
        select 1
          from public.ai_content_proposal_model_attempts attempt
          join public.ai_content_proposal_attempt_events started
            on started.model_attempt_id=attempt.id and started.event_type='invocation_started'
         where attempt.job_id=old.id
           and not exists (
             select 1 from public.ai_content_proposal_attempt_events terminal
              where terminal.model_attempt_id=started.model_attempt_id
                and terminal.invocation_ordinal=started.invocation_ordinal
                and terminal.event_type in (
                  'invocation_completed','invocation_failed','invocation_indeterminate'
                )
           )
      ) into unresolved_invocation;
      if unresolved_invocation then
        new.status:='manual_review_required';
        new.active_stage:=null;
        new.lease_owner:=null;
        new.lease_token:=null;
        new.lease_started_at:=null;
        new.lease_expires_at:=null;
        new.error_code:='invocation_indeterminate';
        new.error_message:='model invocation outcome is indeterminate';
        new.completed_at:=clock_timestamp();
        new.updated_at:=clock_timestamp();
      end if;
    end if;
    if new.status='manual_review_required' or new.error_code='invocation_indeterminate' then
      select exists (
        select 1
          from public.ai_content_proposal_model_attempts attempt
          join public.ai_content_proposal_attempt_events terminal
            on terminal.model_attempt_id=attempt.id
           and terminal.event_type='invocation_indeterminate'
         where attempt.job_id=new.id
      ) into indeterminate_event;
      if not (
        new.status='manual_review_required' and new.active_stage is null
        and new.lease_owner is null and new.lease_token is null
        and new.lease_started_at is null and new.lease_expires_at is null
        and new.error_code='invocation_indeterminate'
        and new.error_message='model invocation outcome is indeterminate'
        and new.completed_at is not null
        and (unresolved_invocation or indeterminate_event)
      ) is true then
        raise exception 'proposal_invocation_manual_review_evidence_missing';
      end if;
    end if;
    return new;
  end if;
  if tg_name='ai_content_proposal_jobs_invocation_evidence_guard' then
    select exists (
      select 1
        from public.ai_content_proposal_model_attempts attempt
        join public.ai_content_proposal_attempt_events started
          on started.model_attempt_id=attempt.id and started.event_type='invocation_started'
       where attempt.job_id=new.id
         and not exists (
           select 1 from public.ai_content_proposal_attempt_events terminal
            where terminal.model_attempt_id=started.model_attempt_id
              and terminal.invocation_ordinal=started.invocation_ordinal
              and terminal.event_type in (
                'invocation_completed','invocation_failed','invocation_indeterminate'
              )
         )
    ) into unresolved_invocation;
    select exists (
      select 1
        from public.ai_content_proposal_model_attempts attempt
        join public.ai_content_proposal_attempt_events terminal
          on terminal.model_attempt_id=attempt.id
         and terminal.event_type='invocation_indeterminate'
       where attempt.job_id=new.id
    ) into indeterminate_event;
    if new.status='manual_review_required' or new.error_code='invocation_indeterminate' then
      if not (
        new.status='manual_review_required' and new.active_stage is null
        and new.lease_owner is null and new.lease_token is null
        and new.lease_started_at is null and new.lease_expires_at is null
        and new.error_code='invocation_indeterminate'
        and new.error_message='model invocation outcome is indeterminate'
        and new.completed_at is not null
        and (unresolved_invocation or indeterminate_event)
      ) is true then
        raise exception 'proposal_invocation_manual_review_evidence_missing';
      end if;
    elsif unresolved_invocation and (
      new.status is distinct from 'processing' or new.active_stage is distinct from 'model'
    ) then
      raise exception 'proposal_unresolved_invocation_terminal_state_invalid';
    elsif new.status in ('completed','failed') and not exists (
      select 1
        from public.ai_content_proposal_model_attempts attempt
        join public.ai_content_proposal_attempt_events terminal
          on terminal.model_attempt_id=attempt.id and terminal.job_id=attempt.job_id
       where attempt.job_id=new.id
         and terminal.event_type=case new.status
           when 'completed' then 'attempt_succeeded' else 'attempt_failed' end
    ) then
      raise exception 'proposal_job_terminal_event_missing';
    end if;
    return null;
  end if;
  raise exception using errcode='55000',message='ai_content_cutover_record_immutable';
end;
$$;

create table ai_content_generation_operations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete restrict,
  brand_id uuid not null,
  operation_key text not null check (length(trim(operation_key))>0),
  request_fingerprint_sha256 text not null check (request_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  parent_operation_id uuid null,
  generation_id uuid not null,
  status text not null default 'reserved' check (
    status in ('reserved','started','completed','failed','reversed')
  ),
  created_at timestamptz not null default now(),
  constraint ai_content_generation_operations_brand_fk
    foreign key(brand_id,workspace_id) references brands(id,workspace_id) on delete restrict,
  constraint ai_content_generation_operations_scope_unique unique(id,workspace_id,brand_id),
  constraint ai_content_generation_operations_generation_pair_unique unique(id,generation_id,workspace_id,brand_id),
  constraint ai_content_generation_operations_generation_scope_unique unique(generation_id,id,workspace_id,brand_id),
  constraint ai_content_generation_operations_generation_unique unique(generation_id),
  constraint ai_content_generation_operations_key_unique unique(brand_id,operation_key),
  constraint ai_content_generation_operations_parent_fk
    foreign key(parent_operation_id,workspace_id,brand_id)
    references ai_content_generation_operations(id,workspace_id,brand_id) on delete restrict,
  constraint ai_content_generation_operations_retry_check check (
    parent_operation_id is null or parent_operation_id<>id
  )
);

alter table ai_content_generations
  add column operation_id uuid null,
  add column parent_generation_id uuid null,
  add constraint ai_content_generations_operation_fk
    foreign key(operation_id,workspace_id,brand_id)
    references ai_content_generation_operations(id,workspace_id,brand_id) on delete restrict
    deferrable initially deferred,
  add constraint ai_content_generations_parent_fk
    foreign key(parent_generation_id,workspace_id,brand_id)
    references ai_content_generations(id,workspace_id,brand_id) on delete restrict
    deferrable initially deferred;

create unique index ai_content_generations_operation_unique
  on ai_content_generations(operation_id) where operation_id is not null;

alter table ai_content_generation_operations
  add constraint ai_content_generation_operations_generation_fk
    foreign key(generation_id,workspace_id,brand_id)
    references ai_content_generations(id,workspace_id,brand_id) on delete restrict
    deferrable initially deferred;

create function enforce_ai_content_generation_operation_identity() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare generation_row public.ai_content_generations%rowtype;
declare operation_row public.ai_content_generation_operations%rowtype;
declare checked_generation_id uuid;
begin
  if tg_table_name='ai_content_generations' then
    checked_generation_id:=new.id;
  else
    checked_generation_id:=new.generation_id;
  end if;
  select * into strict generation_row from public.ai_content_generations where id=checked_generation_id;
  select * into strict operation_row from public.ai_content_generation_operations
   where id=generation_row.operation_id;
  if operation_row.generation_id<>generation_row.id
     or operation_row.workspace_id<>generation_row.workspace_id
     or operation_row.brand_id<>generation_row.brand_id then
    raise exception 'ai_content_generation_operation_identity_mismatch';
  end if;
  if (operation_row.parent_operation_id is null)<>(generation_row.parent_generation_id is null) then
    raise exception 'ai_content_generation_retry_parent_pair_mismatch';
  end if;
  if operation_row.parent_operation_id is not null and not exists (
    select 1 from public.ai_content_generation_operations parent_operation
    join public.ai_content_generations parent_generation
      on parent_generation.id=parent_operation.generation_id
     and parent_generation.operation_id=parent_operation.id
     and parent_generation.workspace_id=parent_operation.workspace_id
     and parent_generation.brand_id=parent_operation.brand_id
    join public.ai_content_usage_ledger reversal
      on reversal.operation_id=parent_operation.id
     and reversal.generation_id=parent_generation.id
     and reversal.usage_type='reversal'
    where parent_operation.id=operation_row.parent_operation_id
      and parent_generation.id=generation_row.parent_generation_id
      and parent_operation.status='reversed'
  ) then raise exception 'ai_content_generation_retry_parent_invalid'; end if;
  return new;
end;
$$;

create function require_ai_content_generation_operation_on_insert() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin
  if new.operation_id is null then raise exception 'ai_content_generation_operation_required'; end if;
  return new;
end;
$$;
create function freeze_ai_content_generation_operation_identity() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin
  if new.workspace_id is distinct from old.workspace_id or new.brand_id is distinct from old.brand_id
     or new.operation_key is distinct from old.operation_key
     or new.request_fingerprint_sha256 is distinct from old.request_fingerprint_sha256
     or new.parent_operation_id is distinct from old.parent_operation_id
     or new.generation_id is distinct from old.generation_id then
    raise exception 'ai_content_generation_operation_identity_immutable';
  end if;
  return new;
end;
$$;
create function transition_ai_content_generation_operation(
  p_operation_id uuid,p_expected_status text,p_next_status text
) returns public.ai_content_generation_operations
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare transitioned public.ai_content_generation_operations%rowtype;
begin
  if (p_expected_status,p_next_status) not in (
    ('reserved','started'),('reserved','failed'),('reserved','reversed'),
    ('started','completed'),('started','failed'),('started','reversed'),('failed','reversed')
  ) then raise exception 'ai_content_generation_operation_transition_invalid'; end if;
  if p_next_status='reversed' and not exists (
    select 1 from public.ai_content_generation_operations operation
    join public.ai_content_usage_ledger reversal
      on reversal.operation_id=operation.id and reversal.generation_id=operation.generation_id
     and reversal.usage_type='reversal' and reversal.reservation_id=reversal.reversal_of_ledger_id
    where operation.id=p_operation_id
  ) then raise exception 'ai_content_generation_operation_reversal_missing'; end if;
  update public.ai_content_generation_operations set status=p_next_status
   where id=p_operation_id and status=p_expected_status returning * into transitioned;
  if not found then raise exception 'ai_content_generation_operation_transition_conflict'; end if;
  return transitioned;
end;
$$;
create trigger ai_content_generations_operation_required
before insert on ai_content_generations for each row
execute function require_ai_content_generation_operation_on_insert();
create trigger ai_content_generation_operations_identity_immutable
before update of workspace_id,brand_id,operation_key,request_fingerprint_sha256,
  parent_operation_id,generation_id on ai_content_generation_operations
for each row execute function freeze_ai_content_generation_operation_identity();
create trigger ai_content_generation_operations_initial_state
before insert on ai_content_generation_operations for each row
execute function reject_ai_content_cutover_record_mutation();
create constraint trigger ai_content_generations_operation_identity
after insert or update of operation_id,parent_generation_id,workspace_id,brand_id on ai_content_generations
deferrable initially deferred for each row
execute function enforce_ai_content_generation_operation_identity();
create constraint trigger ai_content_generation_operations_generation_identity
after insert or update of generation_id,parent_operation_id,workspace_id,brand_id on ai_content_generation_operations
deferrable initially deferred for each row
execute function enforce_ai_content_generation_operation_identity();

create table ai_content_proposal_performance_audits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete restrict,
  brand_id uuid not null,
  batch_id uuid not null,
  experiment_id uuid not null,
  experiment_definition_json jsonb not null check (jsonb_typeof(experiment_definition_json)='object'),
  evidence_version text not null check (length(trim(evidence_version))>0),
  resolved_input_fingerprint_sha256 text not null check (resolved_input_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  snapshot_audit_json jsonb not null check (jsonb_typeof(snapshot_audit_json)='object'),
  captured_from timestamptz not null,
  captured_to timestamptz not null,
  created_at timestamptz not null default now(),
  constraint ai_content_proposal_performance_audits_capture_check check (captured_to>=captured_from),
  constraint ai_content_proposal_performance_audits_batch_unique unique(batch_id),
  constraint ai_content_proposal_performance_audits_scope_unique unique(id,batch_id,workspace_id,brand_id),
  constraint ai_content_proposal_performance_audits_batch_fk
    foreign key(batch_id,workspace_id,brand_id)
    references ai_content_proposal_batches(id,workspace_id,brand_id) on delete restrict
);

alter table ai_content_proposal_jobs
  add constraint ai_content_proposal_jobs_batch_scope_unique
    unique(id,batch_id,workspace_id,brand_id);
alter table ai_content_proposals
  add constraint ai_content_proposals_batch_scope_unique
    unique(id,batch_id,workspace_id,brand_id),
  add constraint ai_content_proposals_generation_scope_unique
    unique(id,generation_id,workspace_id,brand_id);

create table automated_content_proposal_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete restrict,
  brand_id uuid not null,
  caller_operation_key text not null check (length(trim(caller_operation_key))>0),
  request_fingerprint_sha256 text not null check (request_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  caller_transaction_id uuid not null,
  proposal_batch_id uuid null,
  selected_proposal_id uuid null,
  selected_generation_id uuid null,
  frozen_source_snapshot_ids jsonb not null default '[]'::jsonb
    check (jsonb_typeof(frozen_source_snapshot_ids)='array'),
  status text not null default 'queued',
  error_code text null,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  terminal_at timestamptz null,
  constraint automated_content_proposal_runs_brand_fk
    foreign key(brand_id,workspace_id) references brands(id,workspace_id) on delete restrict,
  constraint automated_content_proposal_runs_operation_unique
    unique(workspace_id,brand_id,caller_operation_key),
  constraint automated_content_proposal_runs_status_check check (
    status in ('queued','ready','failed','selected','dismissed')
  ),
  constraint automated_content_proposal_runs_state_check check ((
    (status='queued' and proposal_batch_id is null and selected_proposal_id is null
      and selected_generation_id is null and error_code is null and error_message is null and terminal_at is null)
    or (status='ready' and proposal_batch_id is not null and selected_proposal_id is null
      and selected_generation_id is null and error_code is null and error_message is null and terminal_at is null)
    or (status='failed' and selected_proposal_id is null and selected_generation_id is null
      and error_code is not null and terminal_at is not null)
    or (status='selected' and proposal_batch_id is not null and selected_proposal_id is not null
      and selected_generation_id is not null and error_code is null and error_message is null and terminal_at is not null)
    or (status='dismissed' and proposal_batch_id is not null and selected_proposal_id is null
      and selected_generation_id is null
      and error_code is null and error_message is null and terminal_at is not null)
  ) is true),
  constraint automated_content_proposal_runs_batch_fk
    foreign key(proposal_batch_id,workspace_id,brand_id)
    references ai_content_proposal_batches(id,workspace_id,brand_id) on delete restrict,
  constraint automated_content_proposal_runs_proposal_fk
    foreign key(selected_proposal_id,proposal_batch_id,workspace_id,brand_id)
    references ai_content_proposals(id,batch_id,workspace_id,brand_id) on delete restrict,
  constraint automated_content_proposal_runs_generation_fk
    foreign key(selected_proposal_id,selected_generation_id,workspace_id,brand_id)
    references ai_content_proposals(id,generation_id,workspace_id,brand_id) on delete restrict
);

create function freeze_automated_content_proposal_run_identity() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin
  if new.workspace_id is distinct from old.workspace_id or new.brand_id is distinct from old.brand_id
     or new.caller_operation_key is distinct from old.caller_operation_key
     or new.request_fingerprint_sha256 is distinct from old.request_fingerprint_sha256
     or new.caller_transaction_id is distinct from old.caller_transaction_id
     or new.frozen_source_snapshot_ids is distinct from old.frozen_source_snapshot_ids then
    raise exception 'automated_content_proposal_run_identity_immutable';
  end if;
  if old.proposal_batch_id is not null
     and new.proposal_batch_id is distinct from old.proposal_batch_id then
    raise exception 'automated_content_proposal_run_batch_immutable';
  end if;
  return new;
end;
$$;
create trigger automated_content_proposal_runs_identity_immutable
before update of workspace_id,brand_id,caller_operation_key,request_fingerprint_sha256,
  caller_transaction_id,frozen_source_snapshot_ids,proposal_batch_id on automated_content_proposal_runs
for each row execute function freeze_automated_content_proposal_run_identity();
create trigger automated_content_proposal_runs_initial_state
before insert on automated_content_proposal_runs for each row
execute function reject_ai_content_cutover_record_mutation();

create function transition_automated_content_proposal_run(
  p_run_id uuid,p_expected_status text,p_next_status text,p_proposal_batch_id uuid,
  p_selected_proposal_id uuid,p_selected_generation_id uuid,p_error_code text,p_error_message text
) returns public.automated_content_proposal_runs
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare transitioned public.automated_content_proposal_runs%rowtype;
declare current_run public.automated_content_proposal_runs%rowtype;
begin
  select * into strict current_run from public.automated_content_proposal_runs
   where id=p_run_id for update;
  if current_run.status is distinct from p_expected_status then
    raise exception 'automated_content_proposal_run_transition_conflict';
  end if;
  if (p_expected_status,p_next_status) not in (
    ('queued','ready'),('queued','failed'),('ready','selected'),
    ('ready','dismissed'),('ready','failed')
  ) then raise exception 'automated_content_proposal_run_transition_invalid'; end if;
  if not (
    (p_expected_status='queued' and p_next_status='ready' and p_proposal_batch_id is not null
      and p_selected_proposal_id is null and p_selected_generation_id is null
      and p_error_code is null and p_error_message is null)
    or (p_expected_status='queued' and p_next_status='failed' and p_proposal_batch_id is null
      and p_selected_proposal_id is null and p_selected_generation_id is null
      and p_error_code is not null)
    or (p_expected_status='ready' and p_next_status='failed'
      and p_proposal_batch_id is not null and p_selected_proposal_id is null
      and p_selected_generation_id is null and p_error_code is not null)
    or (p_expected_status='ready' and p_next_status='selected' and p_proposal_batch_id is not null
      and p_selected_proposal_id is not null and p_selected_generation_id is not null
      and p_error_code is null and p_error_message is null)
    or (p_expected_status='ready' and p_next_status='dismissed' and p_proposal_batch_id is not null
      and p_selected_proposal_id is null and p_selected_generation_id is null
      and p_error_code is null and p_error_message is null)
  ) is true then
    raise exception 'automated_content_proposal_run_transition_arguments_invalid';
  end if;
  if p_expected_status='ready'
     and p_proposal_batch_id is distinct from current_run.proposal_batch_id then
    raise exception 'automated_content_proposal_run_batch_conflict';
  end if;
  update public.automated_content_proposal_runs set
    status=p_next_status,proposal_batch_id=p_proposal_batch_id,
    selected_proposal_id=p_selected_proposal_id,selected_generation_id=p_selected_generation_id,
    error_code=p_error_code,error_message=p_error_message,
    terminal_at=case when p_next_status in ('failed','selected','dismissed') then now() else null end,
    updated_at=now()
  where id=p_run_id and status=p_expected_status returning * into transitioned;
  if not found then raise exception 'automated_content_proposal_run_transition_conflict'; end if;
  return transitioned;
end;
$$;

create table ai_content_proposal_job_contracts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  batch_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  request_contract_version text not null,
  base_input_contract_version text not null,
  research_contract_version text not null,
  proposal_contract_version text not null,
  proposal_prompt_version text not null,
  proposal_output_schema_sha256 text not null check (proposal_output_schema_sha256 ~ '^[0-9a-f]{64}$'),
  proposal_model_id text not null check (proposal_model_id='gpt-5.6-terra'),
  command_descriptor_sha256 text not null check (command_descriptor_sha256 ~ '^[0-9a-f]{64}$'),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  base_input_sha256 text not null check (base_input_sha256 ~ '^[0-9a-f]{64}$'),
  contract_source_sha256 text not null check (contract_source_sha256 ~ '^[0-9a-f]{64}$'),
  catalog_sha256 text not null check (catalog_sha256 ~ '^[0-9a-f]{64}$'),
  enqueue_contract_sha256 text not null check (enqueue_contract_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint ai_content_proposal_job_contracts_job_unique unique(job_id),
  constraint ai_content_proposal_job_contracts_scope_unique unique(id,job_id,workspace_id,brand_id),
  constraint ai_content_proposal_job_contracts_batch_scope_unique unique(id,job_id,batch_id,workspace_id,brand_id),
  constraint ai_content_proposal_job_contracts_versions_check check (
    request_contract_version='content-proposal-request.v2'
    and base_input_contract_version='proposal-base-input.v2'
    and research_contract_version='research-evidence.v1'
    and proposal_contract_version='content-proposal.v2'
    and proposal_prompt_version='proposal.writer.v2'
    and proposal_output_schema_sha256='54bf063cf32926874af6b098272df08d41a9e7d7f578ee6560debe44428cf5f3'
    and contract_source_sha256='f1e754cb2c2664ef21f41597a45b2ed424ebc040b949f5bf4cece251195ab5f8'
    and catalog_sha256='94c6622ce5c5ef74b9d011dd0d35035f0f0b5580160dc2a2264b08030a5724fb'
  ),
  constraint ai_content_proposal_job_contracts_job_fk
    foreign key(job_id,batch_id,workspace_id,brand_id)
    references ai_content_proposal_jobs(id,batch_id,workspace_id,brand_id) on delete restrict,
  constraint ai_content_proposal_job_contracts_batch_fk
    foreign key(batch_id,workspace_id,brand_id)
    references ai_content_proposal_batches(id,workspace_id,brand_id) on delete restrict
);

create constraint trigger ai_content_proposal_jobs_contract_required
after insert on ai_content_proposal_jobs
deferrable initially deferred for each row
execute function reject_ai_content_cutover_record_mutation();

create table ai_content_proposal_compositions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  batch_id uuid not null,
  contract_id uuid not null,
  performance_audit_id uuid null,
  workspace_id uuid not null,
  brand_id uuid not null,
  research_evidence_json jsonb not null check (jsonb_typeof(research_evidence_json)='array'),
  research_evidence_set_sha256 text not null check (research_evidence_set_sha256 ~ '^[0-9a-f]{64}$'),
  composed_contract_version text not null default 'proposal-input.v2'
    check (composed_contract_version='proposal-input.v2'),
  composed_input_json jsonb not null,
  composed_input_sha256 text not null check (composed_input_sha256 ~ '^[0-9a-f]{64}$'),
  final_invocation_aggregate_sha256 text not null check (final_invocation_aggregate_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint ai_content_proposal_compositions_input_contract_check check ((
    jsonb_typeof(composed_input_json)='object'
    and composed_input_json->>'contractVersion'=composed_contract_version
  ) is true),
  constraint ai_content_proposal_compositions_job_unique unique(job_id),
  constraint ai_content_proposal_compositions_contract_unique unique(contract_id),
  constraint ai_content_proposal_compositions_scope_unique unique(id,job_id,workspace_id,brand_id),
  constraint ai_content_proposal_compositions_contract_fk
    foreign key(contract_id,job_id,batch_id,workspace_id,brand_id)
    references ai_content_proposal_job_contracts(id,job_id,batch_id,workspace_id,brand_id) on delete restrict,
  constraint ai_content_proposal_compositions_performance_audit_fk
    foreign key(performance_audit_id,batch_id,workspace_id,brand_id)
    references ai_content_proposal_performance_audits(id,batch_id,workspace_id,brand_id) on delete restrict
);

create table ai_content_proposal_research_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  contract_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  attempt_number integer not null check (attempt_number>0),
  worker_id text not null check (length(trim(worker_id))>0),
  lease_token_sha256 text not null check (lease_token_sha256 ~ '^[0-9a-f]{64}$'),
  enqueue_contract_sha256 text not null check (enqueue_contract_sha256 ~ '^[0-9a-f]{64}$'),
  base_input_sha256 text not null check (base_input_sha256 ~ '^[0-9a-f]{64}$'),
  claimed_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  constraint ai_content_proposal_research_attempts_lease_check check (lease_expires_at>claimed_at),
  constraint ai_content_proposal_research_attempts_job_attempt_unique unique(job_id,attempt_number),
  constraint ai_content_proposal_research_attempts_scope_unique unique(id,job_id,workspace_id,brand_id),
  constraint ai_content_proposal_research_attempts_contract_fk
    foreign key(contract_id,job_id,workspace_id,brand_id)
    references ai_content_proposal_job_contracts(id,job_id,workspace_id,brand_id) on delete restrict
);

create function enforce_ai_content_proposal_research_attempt_contract() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare contract public.ai_content_proposal_job_contracts%rowtype;
declare job public.ai_content_proposal_jobs%rowtype;
declare next_attempt_number integer;
begin
  select * into strict contract from public.ai_content_proposal_job_contracts
   where id=new.contract_id and job_id=new.job_id;
  select * into strict job from public.ai_content_proposal_jobs where id=new.job_id for update;
  select coalesce(max(attempt_number),0)+1 into next_attempt_number
    from public.ai_content_proposal_research_attempts where job_id=new.job_id;
  if job.status is distinct from 'processing' or job.active_stage is distinct from 'research'
     or job.lease_owner is null or job.lease_token is null or job.lease_started_at is null
     or job.lease_expires_at is null or job.lease_expires_at<=clock_timestamp()
     or new.worker_id is distinct from job.lease_owner
     or new.lease_token_sha256 is distinct from encode(digest(job.lease_token::text,'sha256'),'hex')
     or new.enqueue_contract_sha256 is distinct from contract.enqueue_contract_sha256
     or new.base_input_sha256 is distinct from contract.base_input_sha256
     or new.lease_expires_at is distinct from job.lease_expires_at
     or new.claimed_at is null or new.claimed_at<job.lease_started_at or new.claimed_at>clock_timestamp()
     or new.attempt_number is distinct from next_attempt_number then
    raise exception 'proposal_research_attempt_contract_or_lease_mismatch';
  end if;
  return new;
end;
$$;
create trigger ai_content_proposal_research_attempts_contract_guard
before insert on ai_content_proposal_research_attempts for each row
execute function enforce_ai_content_proposal_research_attempt_contract();

create table ai_content_proposal_research_attempt_events (
  id uuid primary key default gen_random_uuid(),
  research_attempt_id uuid not null,
  job_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  event_sequence integer not null check (event_sequence>0),
  event_type text not null check (
    event_type in ('research_started','evidence_committed','attempt_succeeded','attempt_failed')
  ),
  composition_id uuid null,
  evidence_json jsonb null check (evidence_json is null or jsonb_typeof(evidence_json)='array'),
  evidence_sha256 text null check (evidence_sha256 is null or evidence_sha256 ~ '^[0-9a-f]{64}$'),
  composition_sha256 text null check (composition_sha256 is null or composition_sha256 ~ '^[0-9a-f]{64}$'),
  previous_event_sha256 text null check (previous_event_sha256 is null or previous_event_sha256 ~ '^[0-9a-f]{64}$'),
  event_sha256 text not null unique check (event_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint ai_content_proposal_research_attempt_events_sequence_unique
    unique(research_attempt_id,event_sequence),
  constraint ai_content_proposal_research_attempt_events_attempt_fk
    foreign key(research_attempt_id,job_id,workspace_id,brand_id)
    references ai_content_proposal_research_attempts(id,job_id,workspace_id,brand_id) on delete restrict,
  constraint ai_content_proposal_research_attempt_events_composition_fk
    foreign key(composition_id,job_id,workspace_id,brand_id)
    references ai_content_proposal_compositions(id,job_id,workspace_id,brand_id) on delete restrict
);

create function enforce_ai_content_proposal_composition_research_success() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  if new.performance_audit_id is null then
    if not exists (
      select 1 from public.ai_content_proposal_research_attempt_events event
       where event.job_id=new.job_id and event.composition_id=new.id
         and event.event_type='attempt_succeeded'
         and event.evidence_json=new.research_evidence_json
         and event.evidence_sha256=new.research_evidence_set_sha256
         and event.composition_sha256=new.composed_input_sha256
    ) then raise exception 'proposal_composition_research_success_missing'; end if;
  elsif not exists (
    select 1 from public.ai_content_proposal_performance_audits audit
     where audit.id=new.performance_audit_id and audit.batch_id=new.batch_id
       and audit.workspace_id=new.workspace_id and audit.brand_id=new.brand_id
       and new.research_evidence_json=jsonb_build_array(audit.snapshot_audit_json)
       and new.research_evidence_set_sha256=encode(
         digest(jsonb_build_array(audit.snapshot_audit_json)::text,'sha256'),'hex'
       )
  ) or exists (
    select 1 from public.ai_content_proposal_research_attempt_events event
     where event.job_id=new.job_id and event.composition_id=new.id
       and event.event_type='attempt_succeeded'
  ) then raise exception 'proposal_composition_performance_audit_mismatch'; end if;
  return new;
end;
$$;
create constraint trigger ai_content_proposal_compositions_research_success
after insert or update on ai_content_proposal_compositions
deferrable initially deferred for each row
execute function enforce_ai_content_proposal_composition_research_success();

create unique index ai_content_proposal_research_attempt_events_started_uq
  on ai_content_proposal_research_attempt_events(research_attempt_id)
  where event_type='research_started';
create unique index ai_content_proposal_research_attempt_events_evidence_uq
  on ai_content_proposal_research_attempt_events(research_attempt_id)
  where event_type='evidence_committed';
create unique index ai_content_proposal_research_attempt_events_terminal_uq
  on ai_content_proposal_research_attempt_events(research_attempt_id)
  where event_type in ('attempt_succeeded','attempt_failed');

create function append_ai_content_proposal_research_attempt_event(
  p_attempt_id uuid,p_lease_token uuid,p_event_sequence integer,p_event_type text,
  p_composition_id uuid,p_evidence_json jsonb,p_evidence_sha256 text,p_composition_sha256 text
) returns text language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare attempt public.ai_content_proposal_research_attempts%rowtype;
declare previous public.ai_content_proposal_research_attempt_events%rowtype;
declare replay public.ai_content_proposal_research_attempt_events%rowtype;
declare job public.ai_content_proposal_jobs%rowtype;
declare composition public.ai_content_proposal_compositions%rowtype;
declare next_hash text;
begin
  select * into strict attempt from public.ai_content_proposal_research_attempts
   where id=p_attempt_id for update;
  if p_event_type not in ('research_started','evidence_committed','attempt_succeeded','attempt_failed') then
    raise exception 'proposal_research_event_type_invalid';
  end if;
  if (p_event_type='research_started'
       and (p_composition_id is not null or p_evidence_json is not null
         or p_evidence_sha256 is not null or p_composition_sha256 is not null))
     or (p_event_type='evidence_committed'
       and (p_composition_id is not null or p_evidence_json is null
         or jsonb_typeof(p_evidence_json)<>'array' or p_evidence_sha256 !~ '^[0-9a-f]{64}$'
         or p_composition_sha256 is not null))
     or (p_event_type='attempt_succeeded'
       and (p_composition_id is null or p_evidence_json is null or jsonb_typeof(p_evidence_json)<>'array'
         or p_evidence_sha256 !~ '^[0-9a-f]{64}$' or p_composition_sha256 !~ '^[0-9a-f]{64}$'))
     or (p_event_type='attempt_failed'
       and (p_composition_id is not null or p_evidence_json is not null
         or p_evidence_sha256 is not null or p_composition_sha256 is not null)) then
    raise exception 'proposal_research_event_payload_invalid';
  end if;
  if p_evidence_json is not null
     and p_evidence_sha256 is distinct from encode(digest(p_evidence_json::text,'sha256'),'hex') then
    raise exception 'proposal_research_evidence_hash_mismatch';
  end if;
  select * into replay from public.ai_content_proposal_research_attempt_events
   where research_attempt_id=p_attempt_id and event_sequence=p_event_sequence;
  if found then
    if replay.event_type=p_event_type
       and replay.composition_id is not distinct from p_composition_id
       and replay.evidence_json is not distinct from p_evidence_json
       and replay.evidence_sha256 is not distinct from p_evidence_sha256
       and replay.composition_sha256 is not distinct from p_composition_sha256 then
      return replay.event_sha256;
    end if;
    raise exception 'proposal_research_event_replay_conflict';
  end if;
  select * into previous from public.ai_content_proposal_research_attempt_events
   where research_attempt_id=p_attempt_id order by event_sequence desc limit 1 for update;
  if previous.event_type in ('attempt_succeeded','attempt_failed') then
    raise exception 'proposal_research_attempt_terminal';
  end if;
  select * into strict job from public.ai_content_proposal_jobs where id=attempt.job_id for update;
  if job.status is distinct from 'processing' or job.active_stage is distinct from 'research'
     or job.lease_owner is null or job.lease_started_at is null
     or job.lease_token is distinct from p_lease_token
     or job.lease_expires_at is null or job.lease_expires_at<=clock_timestamp()
     or attempt.worker_id is distinct from job.lease_owner
     or attempt.lease_token_sha256 is distinct from encode(digest(p_lease_token::text,'sha256'),'hex') then
    raise exception 'proposal_research_lease_mismatch';
  end if;
  if p_event_sequence<>coalesce(previous.event_sequence,0)+1 then
    raise exception 'proposal_research_event_sequence_invalid';
  end if;
  if (p_event_type='research_started' and previous.id is not null)
     or (p_event_type='evidence_committed' and previous.event_type<>'research_started')
     or (p_event_type='attempt_succeeded' and (
       previous.event_type<>'evidence_committed'
       or previous.evidence_json is distinct from p_evidence_json
       or previous.evidence_sha256 is distinct from p_evidence_sha256
       or previous.composition_sha256 is not null))
     or (p_event_type='attempt_failed' and previous.event_type<>'research_started') then
    raise exception 'proposal_research_event_transition_invalid';
  end if;
  if p_event_type='attempt_succeeded' then
    select * into strict composition from public.ai_content_proposal_compositions
     where id=p_composition_id and job_id=attempt.job_id for update;
    if composition.composed_input_sha256<>p_composition_sha256
       or composition.contract_id<>attempt.contract_id
       or previous.evidence_json is distinct from p_evidence_json
       or previous.evidence_sha256 is distinct from p_evidence_sha256 then
      raise exception 'proposal_research_composition_mismatch';
    end if;
  end if;
  next_hash:=encode(digest(jsonb_build_array(
    p_attempt_id,p_event_sequence,p_event_type,p_composition_id,p_evidence_json,p_evidence_sha256,
    p_composition_sha256,previous.event_sha256
  )::text,'sha256'),'hex');
  insert into public.ai_content_proposal_research_attempt_events(
    research_attempt_id,job_id,workspace_id,brand_id,event_sequence,event_type,composition_id,
    evidence_json,evidence_sha256,composition_sha256,previous_event_sha256,event_sha256
  ) values(
    p_attempt_id,attempt.job_id,attempt.workspace_id,attempt.brand_id,p_event_sequence,p_event_type,p_composition_id,
    p_evidence_json,p_evidence_sha256,p_composition_sha256,previous.event_sha256,next_hash
  );
  if p_event_type in ('attempt_succeeded','attempt_failed') then
    update public.ai_content_proposal_jobs set status='queued',active_stage=null,lease_owner=null,
      lease_token=null,lease_started_at=null,lease_expires_at=null
     where id=attempt.job_id;
  end if;
  return next_hash;
end;
$$;

create function enforce_ai_content_proposal_research_completion_pair() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare attempt public.ai_content_proposal_research_attempts%rowtype;
declare evidence public.ai_content_proposal_research_attempt_events%rowtype;
declare terminal public.ai_content_proposal_research_attempt_events%rowtype;
declare composition public.ai_content_proposal_compositions%rowtype;
declare job public.ai_content_proposal_jobs%rowtype;
begin
  select * into strict attempt from public.ai_content_proposal_research_attempts
   where id=new.research_attempt_id;
  if new.event_type='research_started' then
    if new.composition_id is not null or new.evidence_json is not null
       or new.evidence_sha256 is not null or new.composition_sha256 is not null then
      raise exception 'proposal_research_started_payload_invalid';
    end if;
    return new;
  end if;
  if new.event_type='attempt_failed' then
    if new.composition_id is not null or new.evidence_json is not null
       or new.evidence_sha256 is not null or new.composition_sha256 is not null then
      raise exception 'proposal_research_failed_payload_invalid';
    end if;
    if exists (
      select 1 from public.ai_content_proposal_research_attempt_events event
       where event.research_attempt_id=new.research_attempt_id
         and event.event_type='evidence_committed'
    ) then
      raise exception 'proposal_research_failure_after_evidence_invalid';
    end if;
    return new;
  end if;
  if new.event_type='evidence_committed' then
    if new.composition_id is not null or new.evidence_json is null
       or jsonb_typeof(new.evidence_json)<>'array' or new.evidence_sha256 is null
       or new.evidence_sha256 is distinct from encode(digest(new.evidence_json::text,'sha256'),'hex')
       or new.composition_sha256 is not null then
      raise exception 'proposal_research_evidence_payload_invalid';
    end if;
    select * into terminal from public.ai_content_proposal_research_attempt_events event
     where event.research_attempt_id=new.research_attempt_id
       and event.event_type in ('attempt_succeeded','attempt_failed');
    if terminal.event_type='attempt_failed' then
      raise exception 'proposal_research_failure_after_evidence_invalid';
    end if;
    if terminal.id is null then
      raise exception 'proposal_research_completion_pair_missing';
    end if;
    if terminal.composition_id is null then
      raise exception 'proposal_research_success_composition_missing';
    end if;
    if terminal.event_sequence is distinct from new.event_sequence+1
       or terminal.previous_event_sha256 is distinct from new.event_sha256
       or terminal.evidence_json is distinct from new.evidence_json
       or terminal.evidence_sha256 is distinct from new.evidence_sha256 then
      raise exception 'proposal_research_completion_pair_mismatch';
    end if;
    evidence:=new;
  elsif new.event_type='attempt_succeeded' then
    if new.composition_id is null or new.evidence_json is null
       or jsonb_typeof(new.evidence_json)<>'array' or new.evidence_sha256 is null
       or new.evidence_sha256 is distinct from encode(digest(new.evidence_json::text,'sha256'),'hex')
       or new.composition_sha256 is null then
      raise exception 'proposal_research_success_composition_missing';
    end if;
    select * into evidence from public.ai_content_proposal_research_attempt_events event
     where event.research_attempt_id=new.research_attempt_id
       and event.event_type='evidence_committed';
    if evidence.id is null then
      raise exception 'proposal_research_completion_pair_missing';
    end if;
    if new.event_sequence is distinct from evidence.event_sequence+1
       or new.previous_event_sha256 is distinct from evidence.event_sha256
       or new.evidence_json is distinct from evidence.evidence_json
       or new.evidence_sha256 is distinct from evidence.evidence_sha256 then
      raise exception 'proposal_research_completion_pair_mismatch';
    end if;
  else
    raise exception 'proposal_research_event_type_invalid';
  end if;
  select * into composition from public.ai_content_proposal_compositions
   where id=terminal.composition_id or id=new.composition_id;
  if composition.id is null then
    raise exception 'proposal_research_success_composition_missing';
  end if;
  if composition.job_id is distinct from attempt.job_id
     or composition.contract_id is distinct from attempt.contract_id
     or composition.workspace_id is distinct from attempt.workspace_id
     or composition.brand_id is distinct from attempt.brand_id
     or composition.research_evidence_json is distinct from evidence.evidence_json
     or composition.research_evidence_set_sha256 is distinct from evidence.evidence_sha256
     or composition.composed_input_sha256 is distinct from coalesce(terminal.composition_sha256,new.composition_sha256) then
    raise exception 'proposal_research_completion_composition_mismatch';
  end if;
  select * into strict job from public.ai_content_proposal_jobs where id=attempt.job_id;
  if job.status is distinct from 'queued' or job.active_stage is not null
     or job.lease_owner is not null or job.lease_token is not null
     or job.lease_started_at is not null or job.lease_expires_at is not null then
    raise exception 'proposal_research_completion_job_state_invalid';
  end if;
  return new;
end;
$$;

create constraint trigger ai_content_proposal_research_attempt_events_completion_pair
after insert or update on ai_content_proposal_research_attempt_events
deferrable initially deferred for each row
execute function enforce_ai_content_proposal_research_completion_pair();

create function complete_ai_content_proposal_research(
  p_attempt_id uuid,p_lease_token uuid,p_evidence_json jsonb,p_evidence_sha256 text,
  p_composed_input_json jsonb,p_composed_input_sha256 text,
  p_final_invocation_aggregate_sha256 text
) returns public.ai_content_proposal_compositions
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare attempt public.ai_content_proposal_research_attempts%rowtype;
declare job public.ai_content_proposal_jobs%rowtype;
declare contract public.ai_content_proposal_job_contracts%rowtype;
declare previous public.ai_content_proposal_research_attempt_events%rowtype;
declare sealed public.ai_content_proposal_compositions%rowtype;
begin
  select * into strict attempt from public.ai_content_proposal_research_attempts
   where id=p_attempt_id for update;
  perform pg_advisory_xact_lock(hashtextextended(attempt.job_id::text,0));
  select * into strict job from public.ai_content_proposal_jobs
   where id=attempt.job_id for update;
  select * into strict contract from public.ai_content_proposal_job_contracts
   where id=attempt.contract_id and job_id=attempt.job_id for share;
  if job.status is distinct from 'processing' or job.active_stage is distinct from 'research'
     or job.workspace_id is distinct from attempt.workspace_id
     or job.brand_id is distinct from attempt.brand_id
     or job.batch_id is distinct from contract.batch_id
     or contract.workspace_id is distinct from attempt.workspace_id
     or contract.brand_id is distinct from attempt.brand_id
     or job.lease_owner is null or job.lease_owner is distinct from attempt.worker_id
     or job.lease_token is null or job.lease_token is distinct from p_lease_token
     or job.lease_started_at is null or job.lease_expires_at is null
     or job.lease_expires_at<=clock_timestamp()
     or attempt.lease_token_sha256 is distinct from encode(digest(p_lease_token::text,'sha256'),'hex') then
    raise exception 'proposal_research_completion_lease_mismatch';
  end if;
  select * into previous from public.ai_content_proposal_research_attempt_events
   where research_attempt_id=p_attempt_id order by event_sequence desc limit 1 for update;
  if previous.event_type in ('attempt_succeeded','attempt_failed') then
    raise exception 'proposal_research_completion_already_terminal';
  end if;
  if previous.event_type is distinct from 'research_started' or previous.event_sequence is distinct from 1 then
    raise exception 'proposal_research_completion_state_invalid';
  end if;
  if p_evidence_json is null or jsonb_typeof(p_evidence_json)<>'array'
     or p_evidence_sha256 is null
     or p_evidence_sha256 is distinct from encode(digest(p_evidence_json::text,'sha256'),'hex') then
    raise exception 'proposal_research_evidence_hash_mismatch';
  end if;
  perform public.append_ai_content_proposal_research_attempt_event(
    p_attempt_id,p_lease_token,2,'evidence_committed',null,
    p_evidence_json,p_evidence_sha256,null
  );
  if p_composed_input_json is null or jsonb_typeof(p_composed_input_json)<>'object'
     or p_composed_input_json->>'contractVersion' is distinct from 'proposal-input.v2'
     or p_composed_input_sha256 is null
     or p_composed_input_sha256 is distinct from encode(digest(p_composed_input_json::text,'sha256'),'hex') then
    raise exception 'proposal_research_composed_input_hash_mismatch';
  end if;
  if p_final_invocation_aggregate_sha256 is null
     or p_final_invocation_aggregate_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'proposal_research_aggregate_hash_invalid';
  end if;
  insert into public.ai_content_proposal_compositions(
    job_id,batch_id,contract_id,workspace_id,brand_id,research_evidence_json,
    research_evidence_set_sha256,composed_input_json,composed_input_sha256,
    final_invocation_aggregate_sha256
  ) values(
    attempt.job_id,contract.batch_id,attempt.contract_id,attempt.workspace_id,attempt.brand_id,
    p_evidence_json,p_evidence_sha256,p_composed_input_json,p_composed_input_sha256,
    p_final_invocation_aggregate_sha256
  ) returning * into sealed;
  perform public.append_ai_content_proposal_research_attempt_event(
    p_attempt_id,p_lease_token,3,'attempt_succeeded',sealed.id,
    p_evidence_json,p_evidence_sha256,p_composed_input_sha256
  );
  return sealed;
end;
$$;

create table ai_content_proposal_model_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  contract_id uuid not null,
  composition_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  attempt_number integer not null check (attempt_number>0),
  worker_id text not null check (length(trim(worker_id))>0),
  lease_token_sha256 text not null check (lease_token_sha256 ~ '^[0-9a-f]{64}$'),
  aggregate_contract_sha256 text not null check (aggregate_contract_sha256 ~ '^[0-9a-f]{64}$'),
  model_id text not null check (model_id='gpt-5.6-terra'),
  model_sha256 text not null check (model_sha256 ~ '^[0-9a-f]{64}$'),
  command_descriptor_sha256 text not null check (command_descriptor_sha256 ~ '^[0-9a-f]{64}$'),
  proposal_output_schema_sha256 text not null check (proposal_output_schema_sha256 ~ '^[0-9a-f]{64}$'),
  composed_input_sha256 text not null check (composed_input_sha256 ~ '^[0-9a-f]{64}$'),
  claimed_at timestamptz not null default now(),
  constraint ai_content_proposal_model_attempts_job_attempt_unique unique(job_id,attempt_number),
  constraint ai_content_proposal_model_attempts_scope_unique unique(id,job_id,workspace_id,brand_id),
  constraint ai_content_proposal_model_attempts_contract_fk
    foreign key(contract_id,job_id,workspace_id,brand_id)
    references ai_content_proposal_job_contracts(id,job_id,workspace_id,brand_id) on delete restrict,
  constraint ai_content_proposal_model_attempts_composition_fk
    foreign key(composition_id,job_id,workspace_id,brand_id)
    references ai_content_proposal_compositions(id,job_id,workspace_id,brand_id) on delete restrict
);

create function enforce_ai_content_proposal_model_attempt_contract() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare contract public.ai_content_proposal_job_contracts%rowtype;
declare composition public.ai_content_proposal_compositions%rowtype;
declare job public.ai_content_proposal_jobs%rowtype;
declare next_attempt_number integer;
begin
  select * into strict contract from public.ai_content_proposal_job_contracts
   where id=new.contract_id and job_id=new.job_id;
  select * into strict composition from public.ai_content_proposal_compositions
   where id=new.composition_id and job_id=new.job_id;
  select * into strict job from public.ai_content_proposal_jobs where id=new.job_id for update;
  if exists (
    select 1
      from public.ai_content_proposal_model_attempts prior_attempt
      join public.ai_content_proposal_attempt_events started
        on started.model_attempt_id=prior_attempt.id and started.event_type='invocation_started'
     where prior_attempt.job_id=new.job_id
       and not exists (
         select 1 from public.ai_content_proposal_attempt_events terminal
          where terminal.model_attempt_id=started.model_attempt_id
            and terminal.invocation_ordinal=started.invocation_ordinal
            and terminal.event_type in (
              'invocation_completed','invocation_failed','invocation_indeterminate'
            )
       )
  ) then
    raise exception 'proposal_model_attempt_unresolved_invocation';
  end if;
  select coalesce(max(attempt_number),0)+1 into next_attempt_number
    from public.ai_content_proposal_model_attempts where job_id=new.job_id;
  if new.aggregate_contract_sha256 is distinct from composition.final_invocation_aggregate_sha256
     or new.command_descriptor_sha256 is distinct from contract.command_descriptor_sha256
     or new.proposal_output_schema_sha256 is distinct from contract.proposal_output_schema_sha256
     or new.composed_input_sha256 is distinct from composition.composed_input_sha256
     or new.model_id is distinct from contract.proposal_model_id
     or job.status is distinct from 'processing' or job.active_stage is distinct from 'model'
     or job.lease_owner is null or job.lease_token is null or job.lease_started_at is null
     or job.lease_expires_at is null or job.lease_expires_at<=clock_timestamp()
     or new.worker_id is distinct from job.lease_owner
     or new.lease_token_sha256 is distinct from encode(digest(job.lease_token::text,'sha256'),'hex')
     or new.claimed_at is null or new.claimed_at<job.lease_started_at or new.claimed_at>clock_timestamp()
     or new.attempt_number is distinct from next_attempt_number then
    raise exception 'proposal_model_attempt_contract_or_lease_mismatch';
  end if;
  return new;
end;
$$;
create trigger ai_content_proposal_model_attempts_contract_guard
before insert on ai_content_proposal_model_attempts for each row
execute function enforce_ai_content_proposal_model_attempt_contract();

create table ai_content_proposal_attempt_events (
  id uuid primary key default gen_random_uuid(),
  model_attempt_id uuid not null,
  job_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  event_sequence integer not null check (event_sequence>0),
  event_type text not null check (event_type in (
    'invocation_started','invocation_completed','invocation_failed','invocation_indeterminate',
    'attempt_succeeded','attempt_failed'
  )),
  invocation_ordinal integer not null check (invocation_ordinal between 1 and 2),
  aggregate_contract_sha256 text not null check (aggregate_contract_sha256 ~ '^[0-9a-f]{64}$'),
  model_sha256 text not null check (model_sha256 ~ '^[0-9a-f]{64}$'),
  command_descriptor_sha256 text not null check (command_descriptor_sha256 ~ '^[0-9a-f]{64}$'),
  proposal_output_schema_sha256 text not null check (proposal_output_schema_sha256 ~ '^[0-9a-f]{64}$'),
  composed_input_sha256 text not null check (composed_input_sha256 ~ '^[0-9a-f]{64}$'),
  transcript_sha256 text null check (transcript_sha256 is null or transcript_sha256 ~ '^[0-9a-f]{64}$'),
  output_sha256 text null check (output_sha256 is null or output_sha256 ~ '^[0-9a-f]{64}$'),
  parser_sha256 text null check (parser_sha256 is null or parser_sha256 ~ '^[0-9a-f]{64}$'),
  parser_valid boolean null,
  previous_event_sha256 text null check (previous_event_sha256 is null or previous_event_sha256 ~ '^[0-9a-f]{64}$'),
  event_sha256 text not null unique check (event_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint ai_content_proposal_attempt_events_sequence_unique unique(model_attempt_id,event_sequence),
  constraint ai_content_proposal_attempt_events_attempt_fk
    foreign key(model_attempt_id,job_id,workspace_id,brand_id)
    references ai_content_proposal_model_attempts(id,job_id,workspace_id,brand_id) on delete restrict,
  constraint ai_content_proposal_attempt_events_payload_check check (
    (event_type='invocation_started' and transcript_sha256 is null and output_sha256 is null
      and parser_sha256 is null and parser_valid is null)
    or (event_type='invocation_completed' and output_sha256 is not null
      and parser_sha256 is not null and parser_valid is not null)
    or (event_type in ('invocation_failed','invocation_indeterminate') and output_sha256 is null
      and parser_sha256 is null and parser_valid is null)
    or (event_type='attempt_succeeded' and output_sha256 is not null
      and parser_sha256 is not null and parser_valid=true)
    or (event_type='attempt_failed' and (
      (output_sha256 is not null and parser_sha256 is not null and parser_valid=false)
      or (output_sha256 is null and parser_sha256 is null and parser_valid is null)
    ))
  )
);

create unique index ai_content_proposal_attempt_events_started_uq
  on ai_content_proposal_attempt_events(model_attempt_id,invocation_ordinal)
  where event_type='invocation_started';
create unique index ai_content_proposal_attempt_events_invocation_terminal_uq
  on ai_content_proposal_attempt_events(model_attempt_id,invocation_ordinal)
  where event_type in ('invocation_completed','invocation_failed','invocation_indeterminate');
create unique index ai_content_proposal_attempt_events_attempt_terminal_uq
  on ai_content_proposal_attempt_events(model_attempt_id)
  where event_type in ('attempt_succeeded','attempt_failed');

create function append_ai_content_proposal_attempt_event(
  p_attempt_id uuid,p_lease_token uuid,p_event_sequence integer,p_invocation_ordinal integer,p_event_type text,
  p_aggregate_contract_sha256 text,p_model_sha256 text,p_command_descriptor_sha256 text,
  p_composed_input_sha256 text,p_transcript_sha256 text,p_output_sha256 text,
  p_parser_sha256 text,p_parser_valid boolean default null
) returns text language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare attempt public.ai_content_proposal_model_attempts%rowtype;
declare previous public.ai_content_proposal_attempt_events%rowtype;
declare replay public.ai_content_proposal_attempt_events%rowtype;
declare invocation_terminal public.ai_content_proposal_attempt_events%rowtype;
declare job public.ai_content_proposal_jobs%rowtype;
declare next_hash text;
begin
  select * into strict attempt from public.ai_content_proposal_model_attempts where id=p_attempt_id for update;
  perform pg_advisory_xact_lock(hashtextextended(attempt.job_id::text,0));
  if p_invocation_ordinal not between 1 and 2 then
    raise exception 'proposal_invocation_ordinal_invalid';
  end if;
  if p_event_type not in ('invocation_started','invocation_completed','invocation_failed',
      'invocation_indeterminate','attempt_succeeded','attempt_failed') then
    raise exception 'proposal_attempt_event_type_invalid';
  end if;
  if p_aggregate_contract_sha256 is distinct from attempt.aggregate_contract_sha256
     or p_model_sha256 is distinct from attempt.model_sha256
     or p_command_descriptor_sha256 is distinct from attempt.command_descriptor_sha256
     or p_composed_input_sha256 is distinct from attempt.composed_input_sha256 then
    raise exception 'proposal_attempt_contract_mismatch';
  end if;
  select * into replay from public.ai_content_proposal_attempt_events
   where model_attempt_id=p_attempt_id and event_sequence=p_event_sequence;
  if found then
    if replay.event_type=p_event_type and replay.invocation_ordinal=p_invocation_ordinal
       and replay.aggregate_contract_sha256=p_aggregate_contract_sha256
       and replay.model_sha256=p_model_sha256
       and replay.command_descriptor_sha256=p_command_descriptor_sha256
       and replay.composed_input_sha256=p_composed_input_sha256
       and replay.transcript_sha256 is not distinct from p_transcript_sha256
       and replay.output_sha256 is not distinct from p_output_sha256
       and replay.parser_sha256 is not distinct from p_parser_sha256
       and replay.parser_valid is not distinct from p_parser_valid then
      return replay.event_sha256;
    end if;
    raise exception 'proposal_attempt_event_replay_conflict';
  end if;
  select * into previous from public.ai_content_proposal_attempt_events
   where model_attempt_id=p_attempt_id order by event_sequence desc limit 1 for update;
  if previous.event_type in ('invocation_indeterminate','attempt_succeeded','attempt_failed') then
    raise exception 'proposal_attempt_terminal';
  end if;
  select * into strict job from public.ai_content_proposal_jobs where id=attempt.job_id for update;
  if job.status is distinct from 'processing' or job.active_stage is distinct from 'model'
     or job.lease_owner is null or job.lease_started_at is null
     or job.lease_token is distinct from p_lease_token
     or job.lease_expires_at is null or job.lease_expires_at<=clock_timestamp()
     or attempt.worker_id is distinct from job.lease_owner
     or attempt.lease_token_sha256 is distinct from encode(digest(p_lease_token::text,'sha256'),'hex') then
    raise exception 'proposal_model_lease_mismatch';
  end if;
  if p_event_sequence<>coalesce(previous.event_sequence,0)+1 then
    raise exception 'proposal_attempt_event_sequence_invalid';
  end if;
  if p_event_type='invocation_started' and p_invocation_ordinal=2 and not exists (
    select 1 from public.ai_content_proposal_attempt_events
     where model_attempt_id=p_attempt_id and invocation_ordinal=1
       and event_type='invocation_completed' and parser_valid=false
  ) then raise exception 'proposal_repair_precondition_invalid'; end if;
  if p_event_type<>'invocation_started' and not exists (
    select 1 from public.ai_content_proposal_attempt_events
     where model_attempt_id=p_attempt_id and invocation_ordinal=p_invocation_ordinal
       and event_type='invocation_started'
  ) then raise exception 'proposal_invocation_start_missing'; end if;
  if p_event_type in ('attempt_succeeded','attempt_failed') then
    select * into invocation_terminal from public.ai_content_proposal_attempt_events
     where model_attempt_id=p_attempt_id and invocation_ordinal=p_invocation_ordinal
       and event_type in ('invocation_completed','invocation_failed','invocation_indeterminate');
    if not found then raise exception 'proposal_invocation_terminal_missing'; end if;
    if previous.id is distinct from invocation_terminal.id
       or previous.invocation_ordinal<>p_invocation_ordinal then
      raise exception 'proposal_attempt_latest_invocation_not_terminal';
    end if;
    if invocation_terminal.transcript_sha256 is distinct from p_transcript_sha256
       or invocation_terminal.output_sha256 is distinct from p_output_sha256
       or invocation_terminal.parser_sha256 is distinct from p_parser_sha256
       or invocation_terminal.parser_valid is distinct from p_parser_valid then
      raise exception 'proposal_attempt_terminal_payload_mismatch';
    end if;
    if p_event_type='attempt_succeeded'
       and (invocation_terminal.event_type<>'invocation_completed' or invocation_terminal.parser_valid is not true) then
      raise exception 'proposal_attempt_success_precondition_invalid';
    end if;
    if p_event_type='attempt_failed'
       and not (
         (invocation_terminal.event_type='invocation_completed' and invocation_terminal.parser_valid=false)
         or invocation_terminal.event_type in ('invocation_failed','invocation_indeterminate')
       ) then raise exception 'proposal_attempt_failure_precondition_invalid'; end if;
  end if;
  next_hash:=encode(digest(jsonb_build_array(
    p_attempt_id,p_event_sequence,p_invocation_ordinal,p_event_type,
    p_aggregate_contract_sha256,p_model_sha256,attempt.proposal_output_schema_sha256,
    p_command_descriptor_sha256,p_composed_input_sha256,p_transcript_sha256,
    p_output_sha256,p_parser_sha256,p_parser_valid,previous.event_sha256
  )::text,'sha256'),'hex');
  insert into public.ai_content_proposal_attempt_events(
    model_attempt_id,job_id,workspace_id,brand_id,event_sequence,event_type,invocation_ordinal,
    aggregate_contract_sha256,model_sha256,command_descriptor_sha256,
    proposal_output_schema_sha256,composed_input_sha256,transcript_sha256,output_sha256,
    parser_sha256,parser_valid,previous_event_sha256,event_sha256
  ) values(p_attempt_id,attempt.job_id,attempt.workspace_id,attempt.brand_id,p_event_sequence,
    p_event_type,p_invocation_ordinal,p_aggregate_contract_sha256,p_model_sha256,
    p_command_descriptor_sha256,attempt.proposal_output_schema_sha256,p_composed_input_sha256,
    p_transcript_sha256,p_output_sha256,p_parser_sha256,p_parser_valid,previous.event_sha256,next_hash);
  if p_event_type='invocation_indeterminate' then
    update public.ai_content_proposal_jobs set status='manual_review_required',active_stage=null,
      lease_owner=null,lease_token=null,lease_started_at=null,lease_expires_at=null,
      error_code='invocation_indeterminate',error_message='model invocation outcome is indeterminate',completed_at=now()
     where id=attempt.job_id;
  elsif p_event_type='attempt_succeeded' then
    update public.ai_content_proposal_jobs set status='completed',active_stage=null,
      lease_owner=null,lease_token=null,lease_started_at=null,lease_expires_at=null,
      error_code=null,error_message=null,completed_at=now() where id=attempt.job_id;
  elsif p_event_type='attempt_failed' then
    update public.ai_content_proposal_jobs set status='failed',active_stage=null,
      lease_owner=null,lease_token=null,lease_started_at=null,lease_expires_at=null,
      error_code='model_attempt_failed',error_message='model attempt failed',completed_at=now()
     where id=attempt.job_id;
  end if;
  return next_hash;
end;
$$;

alter table ai_content_proposals
  add column successful_model_attempt_id uuid null,
  add column successful_proposal_job_id uuid null,
  add column final_invocation_ordinal integer null check (final_invocation_ordinal is null or final_invocation_ordinal between 1 and 2),
  add constraint ai_content_proposals_attempt_pair_check check (
    (successful_model_attempt_id is null and successful_proposal_job_id is null and final_invocation_ordinal is null)
    or (successful_model_attempt_id is not null and successful_proposal_job_id is not null and final_invocation_ordinal is not null)
  ),
  add constraint ai_content_proposals_successful_job_batch_fk
    foreign key(successful_proposal_job_id,batch_id,workspace_id,brand_id)
    references ai_content_proposal_jobs(id,batch_id,workspace_id,brand_id) on delete restrict,
  add constraint ai_content_proposals_successful_attempt_fk
    foreign key(successful_model_attempt_id,successful_proposal_job_id,workspace_id,brand_id)
    references ai_content_proposal_model_attempts(id,job_id,workspace_id,brand_id) on delete restrict,
  add constraint ai_content_proposals_successful_binding_scope_unique
    unique(id,generation_id,successful_model_attempt_id,successful_proposal_job_id,final_invocation_ordinal,workspace_id,brand_id);

create function enforce_ai_content_proposal_success_event() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare proposal public.ai_content_proposals%rowtype;
begin
  select * into strict proposal from public.ai_content_proposals where id=new.id;
  if proposal.status='selected' and (
    proposal.successful_model_attempt_id is null
    or proposal.successful_proposal_job_id is null
    or proposal.final_invocation_ordinal is null
  ) then raise exception 'ai_content_proposal_success_binding_required'; end if;
  if proposal.status<>'selected' and (
    proposal.successful_model_attempt_id is not null
    or proposal.successful_proposal_job_id is not null
    or proposal.final_invocation_ordinal is not null
  ) then raise exception 'ai_content_proposal_success_binding_state_invalid'; end if;
  if proposal.successful_model_attempt_id is not null and not exists (
    select 1 from public.ai_content_proposal_attempt_events event
     where event.model_attempt_id=proposal.successful_model_attempt_id
       and event.job_id=proposal.successful_proposal_job_id
       and event.workspace_id=proposal.workspace_id and event.brand_id=proposal.brand_id
       and event.event_type='attempt_succeeded'
       and event.invocation_ordinal=proposal.final_invocation_ordinal
  ) then raise exception 'ai_content_proposal_success_event_missing'; end if;
  return new;
end;
$$;
create constraint trigger ai_content_proposals_success_event
after insert or update of status,successful_model_attempt_id,successful_proposal_job_id,final_invocation_ordinal
on ai_content_proposals deferrable initially deferred for each row
execute function enforce_ai_content_proposal_success_event();

create table ai_content_generation_prompt_bindings (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  selected_proposal_id uuid not null,
  proposal_job_id uuid not null,
  proposal_contract_id uuid not null,
  successful_model_attempt_id uuid not null,
  final_invocation_ordinal integer not null check (final_invocation_ordinal between 1 and 2),
  contract_version text not null check (contract_version='content-prompt-binding.v1'),
  output_format text not null check (output_format in ('card_news','blog','reel')),
  purpose text not null check (purpose in ('informational','marketing')),
  proposal_request_version text not null check (proposal_request_version='content-proposal-request.v2'),
  proposal_base_input_version text not null check (proposal_base_input_version='proposal-base-input.v2'),
  proposal_composed_input_version text not null check (proposal_composed_input_version='proposal-input.v2'),
  proposal_output_version text not null check (proposal_output_version='content-proposal.v2'),
  proposal_prompt_version text not null check (proposal_prompt_version='proposal.writer.v2'),
  proposal_schema_sha256 text not null check (proposal_schema_sha256='54bf063cf32926874af6b098272df08d41a9e7d7f578ee6560debe44428cf5f3'),
  generation_input_version text not null check (generation_input_version='content-generation-input.v3'),
  generation_schema_sha256 text not null check (generation_schema_sha256='9977b52a0b15d581cf529c3c034eb2670c361fd03434f5c3231a798c6f668ffd'),
  plan_contract_version text not null,
  plan_schema_sha256 text not null check (plan_schema_sha256 ~ '^[0-9a-f]{64}$'),
  planner_prompt_version text not null,
  image_prompt_version text not null,
  image_package_version text not null check (image_package_version='image-generation-package.v1'),
  manifest_version text not null check (manifest_version='ai-content.v3'),
  contract_source_hash text not null check (contract_source_hash='f1e754cb2c2664ef21f41597a45b2ed424ebc040b949f5bf4cece251195ab5f8'),
  model text not null check (model='gpt-5.6-terra'),
  binding_json jsonb not null check (jsonb_typeof(binding_json)='object'),
  binding_sha256 text not null check (binding_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint ai_content_generation_prompt_bindings_generation_unique unique(generation_id),
  constraint ai_content_generation_prompt_bindings_generation_fk
    foreign key(generation_id,workspace_id,brand_id)
    references ai_content_generations(id,workspace_id,brand_id) on delete restrict,
  constraint ai_content_generation_prompt_bindings_contract_fk
    foreign key(proposal_contract_id,proposal_job_id,workspace_id,brand_id)
    references ai_content_proposal_job_contracts(id,job_id,workspace_id,brand_id) on delete restrict,
  constraint ai_content_generation_prompt_bindings_attempt_fk
    foreign key(successful_model_attempt_id,proposal_job_id,workspace_id,brand_id)
    references ai_content_proposal_model_attempts(id,job_id,workspace_id,brand_id) on delete restrict,
  constraint ai_content_generation_prompt_bindings_selected_proposal_fk
    foreign key(selected_proposal_id,generation_id,successful_model_attempt_id,proposal_job_id,
      final_invocation_ordinal,workspace_id,brand_id)
    references ai_content_proposals(id,generation_id,successful_model_attempt_id,
      successful_proposal_job_id,final_invocation_ordinal,workspace_id,brand_id) on delete restrict,
  constraint ai_content_generation_prompt_bindings_format_contract_check check (
    (output_format='card_news' and plan_contract_version='card-news-plan.v2'
      and plan_schema_sha256='00efc6f4fad458f598e40add213e5543ac950cd8c8df96323a97821f8238277b'
      and planner_prompt_version=('planner.card_news.'||purpose||'.v1')
      and image_prompt_version=('image.card_news.'||purpose||'.v1'))
    or (output_format='blog' and plan_contract_version='blog-plan.v2'
      and plan_schema_sha256='03ceeed94fdda02f3935a37868a5c159a456d467200486236ecc968163794c82'
      and planner_prompt_version=('planner.blog.'||purpose||'.v1')
      and image_prompt_version=('image.blog.'||purpose||'.v1'))
    or (output_format='reel' and plan_contract_version='reel-plan.v2'
      and plan_schema_sha256='bcefb5d1810d43c8e6d36561000711240783892cb79ac8b62c64936fb49f55aa'
      and planner_prompt_version=('planner.reel.'||purpose||'.v1')
      and image_prompt_version=('image.reel.'||purpose||'.v1'))
  ),
  constraint ai_content_generation_prompt_bindings_json_check check ((
    binding_json ?& array[
      'contractVersion','outputFormat','purpose','proposalRequestVersion','proposalBaseInputVersion',
      'proposalComposedInputVersion','proposalOutputVersion','proposalPromptVersion','proposalSchemaSha256',
      'generationInputVersion','generationSchemaSha256','planContractVersion','planSchemaSha256',
      'plannerPromptVersion','imagePackageVersion','imagePromptVersion','manifestVersion',
      'contractSourceHash','model'
    ]
    and binding_json - array[
      'contractVersion','outputFormat','purpose','proposalRequestVersion','proposalBaseInputVersion',
      'proposalComposedInputVersion','proposalOutputVersion','proposalPromptVersion','proposalSchemaSha256',
      'generationInputVersion','generationSchemaSha256','planContractVersion','planSchemaSha256',
      'plannerPromptVersion','imagePackageVersion','imagePromptVersion','manifestVersion',
      'contractSourceHash','model'
    ] = '{}'::jsonb
    and binding_json->>'contractVersion'=contract_version
    and binding_json->>'outputFormat'=output_format and binding_json->>'purpose'=purpose
    and binding_json->>'proposalRequestVersion'=proposal_request_version
    and binding_json->>'proposalBaseInputVersion'=proposal_base_input_version
    and binding_json->>'proposalComposedInputVersion'=proposal_composed_input_version
    and binding_json->>'proposalOutputVersion'=proposal_output_version
    and binding_json->>'proposalPromptVersion'=proposal_prompt_version
    and binding_json->>'proposalSchemaSha256'=proposal_schema_sha256
    and binding_json->>'generationInputVersion'=generation_input_version
    and binding_json->>'generationSchemaSha256'=generation_schema_sha256
    and binding_json->>'planContractVersion'=plan_contract_version
    and binding_json->>'planSchemaSha256'=plan_schema_sha256
    and binding_json->>'plannerPromptVersion'=planner_prompt_version
    and binding_json->>'imagePackageVersion'=image_package_version
    and binding_json->>'imagePromptVersion'=image_prompt_version
    and binding_json->>'manifestVersion'=manifest_version
    and binding_json->>'contractSourceHash'=contract_source_hash
    and binding_json->>'model'=model
    and binding_sha256=encode(digest(binding_json::text,'sha256'),'hex')
  ) is true)
);

create function enforce_ai_content_prompt_binding_source() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare proposal public.ai_content_proposals%rowtype;
begin
  select * into strict proposal from public.ai_content_proposals
     where id=new.selected_proposal_id for update;
  if proposal.status<>'selected'
     or proposal.proposal_json->>'outputFormat' is distinct from new.output_format
     or proposal.proposal_json#>>'{purposeDetails,kind}' is distinct from new.purpose then
    raise exception 'ai_content_prompt_binding_source_mismatch';
  end if;
  return new;
end;
$$;
create constraint trigger ai_content_generation_prompt_bindings_source
after insert or update on ai_content_generation_prompt_bindings
deferrable initially deferred for each row
execute function enforce_ai_content_prompt_binding_source();

create function create_ai_content_generation_prompt_binding(
  p_generation_id uuid,p_workspace_id uuid,p_brand_id uuid,p_selected_proposal_id uuid,p_proposal_job_id uuid,
  p_proposal_contract_id uuid,p_successful_model_attempt_id uuid,p_binding_json jsonb
) returns uuid language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare created_id uuid;
declare terminal public.ai_content_proposal_attempt_events%rowtype;
declare proposal public.ai_content_proposals%rowtype;
begin
  select * into strict proposal from public.ai_content_proposals
   where id=p_selected_proposal_id for update;
  if proposal.status<>'selected'
     or proposal.proposal_json->>'outputFormat' is distinct from p_binding_json->>'outputFormat'
     or proposal.proposal_json#>>'{purposeDetails,kind}' is distinct from p_binding_json->>'purpose' then
    raise exception 'ai_content_prompt_binding_source_mismatch';
  end if;
  select * into strict terminal from public.ai_content_proposal_attempt_events
   where model_attempt_id=p_successful_model_attempt_id and event_type='attempt_succeeded'
   order by event_sequence desc limit 1;
  insert into public.ai_content_generation_prompt_bindings(
    generation_id,workspace_id,brand_id,selected_proposal_id,proposal_job_id,proposal_contract_id,
    successful_model_attempt_id,final_invocation_ordinal,contract_version,output_format,purpose,
    proposal_request_version,proposal_base_input_version,proposal_composed_input_version,
    proposal_output_version,proposal_prompt_version,proposal_schema_sha256,
    generation_input_version,generation_schema_sha256,plan_contract_version,plan_schema_sha256,
    planner_prompt_version,image_prompt_version,image_package_version,manifest_version,
    contract_source_hash,model,binding_json,binding_sha256
  ) values(
    p_generation_id,p_workspace_id,p_brand_id,p_selected_proposal_id,p_proposal_job_id,p_proposal_contract_id,
    p_successful_model_attempt_id,terminal.invocation_ordinal,p_binding_json->>'contractVersion',p_binding_json->>'outputFormat',
    p_binding_json->>'purpose',p_binding_json->>'proposalRequestVersion',
    p_binding_json->>'proposalBaseInputVersion',p_binding_json->>'proposalComposedInputVersion',
    p_binding_json->>'proposalOutputVersion',p_binding_json->>'proposalPromptVersion',
    p_binding_json->>'proposalSchemaSha256',p_binding_json->>'generationInputVersion',
    p_binding_json->>'generationSchemaSha256',p_binding_json->>'planContractVersion',
    p_binding_json->>'planSchemaSha256',p_binding_json->>'plannerPromptVersion',
    p_binding_json->>'imagePromptVersion',p_binding_json->>'imagePackageVersion',
    p_binding_json->>'manifestVersion',p_binding_json->>'contractSourceHash',
    p_binding_json->>'model',p_binding_json,encode(digest(p_binding_json::text,'sha256'),'hex')
  ) returning id into created_id;
  return created_id;
end;
$$;

alter table topic_uploads
  add column operation_key text null,
  add column request_fingerprint text null,
  add constraint topic_uploads_operation_identity_check check ((
    (operation_key is null and request_fingerprint is null)
    or (operation_key is not null and request_fingerprint is not null
      and length(trim(operation_key))>0 and request_fingerprint ~ '^[0-9a-f]{64}$')
  ) is true);
create unique index topic_uploads_brand_operation_key_uq
  on topic_uploads(brand_id,operation_key) where operation_key is not null;

create function freeze_topic_upload_operation_identity() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin
  if new.operation_key is distinct from old.operation_key
     or new.request_fingerprint is distinct from old.request_fingerprint then
    raise exception 'topic_upload_operation_identity_immutable';
  end if;
  return new;
end;
$$;
create trigger topic_uploads_operation_identity_immutable
before update of operation_key,request_fingerprint on topic_uploads
for each row execute function freeze_topic_upload_operation_identity();

create function create_ai_content_cutover_topic_upload(
  p_workspace_id uuid,p_brand_id uuid,p_created_by_user_id uuid,
  p_operation_key text,p_request_fingerprint text,p_topics jsonb
) returns table(topic_upload_id uuid,topic_row_ids uuid[])
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare existing_upload public.topic_uploads%rowtype;
declare created_upload_id uuid;
declare created_row_id uuid;
declare row_ids uuid[];
declare topic jsonb;
declare ordinal integer;
declare normalized_topics jsonb;
declare stored_topics jsonb;
begin
  if (
    p_operation_key ~ ('^cutover-canary:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:'
      || '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:topics$')
    and p_request_fingerprint ~ '^[0-9a-f]{64}$'
    and case when jsonb_typeof(p_topics)='array'
      then jsonb_array_length(p_topics)=3 else false end
  ) is not true then
    raise exception 'topic_upload_operation_invalid';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_topics) item
     where jsonb_typeof(item)<>'object'
       or length(trim(coalesce(item->>'title','')))=0
       or length(trim(coalesce(item->>'angle','')))=0
  ) then raise exception 'topic_upload_topics_invalid'; end if;
  select jsonb_agg(jsonb_build_object(
    'title',trim(item.value->>'title'),'angle',trim(item.value->>'angle')
  ) order by item.position) into normalized_topics
    from jsonb_array_elements(p_topics) with ordinality item(value,position);

  insert into public.topic_uploads(
    workspace_id,brand_id,file_name,file_mime_type,status,total_rows,valid_rows,
    duplicate_rows,invalid_rows,created_by_user_id,operation_key,request_fingerprint
  ) values(
    p_workspace_id,p_brand_id,'cutover-canary-topics.json','application/json','validated',
    3,3,0,0,p_created_by_user_id,p_operation_key,p_request_fingerprint
  ) on conflict(brand_id,operation_key) where operation_key is not null do nothing
  returning id into created_upload_id;

  if created_upload_id is null then
    select * into strict existing_upload from public.topic_uploads
     where brand_id=p_brand_id and operation_key=p_operation_key for update;
    if existing_upload.workspace_id is distinct from p_workspace_id
       or existing_upload.request_fingerprint is distinct from p_request_fingerprint then
      raise exception 'topic_upload_operation_conflict';
    end if;
    select jsonb_agg(jsonb_build_object(
      'title',row_data.topic_title,'angle',row_data.topic_angle
    ) order by row_data.row_number) into stored_topics
      from public.topic_rows row_data where row_data.topic_upload_id=existing_upload.id;
    if stored_topics is distinct from normalized_topics then
      raise exception 'topic_upload_operation_conflict';
    end if;
    select array_agg(row_data.id order by row_data.row_number) into row_ids
      from public.topic_rows row_data where row_data.topic_upload_id=existing_upload.id;
    if coalesce(array_length(row_ids,1),0)<>3 then
      raise exception 'topic_upload_operation_state_invalid';
    end if;
    return query select existing_upload.id,row_ids;
    return;
  end if;

  ordinal:=0;
  for topic in select value from jsonb_array_elements(normalized_topics) with ordinality items(value,position) order by position
  loop
    ordinal:=ordinal+1;
    insert into public.topic_rows(
      workspace_id,brand_id,topic_upload_id,row_number,status,topic_title,topic_angle,
      topic_key,validation_errors
    ) values(
      p_workspace_id,p_brand_id,created_upload_id,ordinal,'uploaded',trim(topic->>'title'),
      trim(topic->>'angle'),encode(digest(concat_ws('|',p_brand_id::text,p_operation_key,ordinal::text,
        trim(topic->>'title'),trim(topic->>'angle')),'sha256'),'hex'),'[]'::jsonb
    ) returning id into created_row_id;
    row_ids:=array_append(row_ids,created_row_id);
  end loop;
  return query select created_upload_id,row_ids;
end;
$$;

alter table ai_content_usage_ledger
  add column operation_id uuid null,
  add column reservation_id uuid null,
  add column reversal_of_ledger_id uuid null,
  add constraint ai_content_usage_ledger_operation_fk
    foreign key(operation_id,generation_id,workspace_id,brand_id)
    references ai_content_generation_operations(id,generation_id,workspace_id,brand_id) on delete restrict,
  add constraint ai_content_usage_ledger_reversal_fk
    foreign key(reversal_of_ledger_id) references ai_content_usage_ledger(id) on delete restrict,
  add constraint ai_content_usage_ledger_reservation_identity_check check (
    (operation_id is null and reservation_id is null and reversal_of_ledger_id is null)
    or (usage_type='generation' and operation_id is not null and reservation_id=id
      and reversal_of_ledger_id is null)
    or (usage_type='reversal' and operation_id is not null and reservation_id is not null
      and reversal_of_ledger_id is not null)
  ),
  add constraint ai_content_usage_ledger_new_identity_required check (
    usage_type not in ('generation','reversal') or operation_id is not null
  ) not valid;
create unique index ai_content_usage_one_reservation_per_operation_uq
  on ai_content_usage_ledger(operation_id)
  where usage_type='generation' and operation_id is not null;
create unique index ai_content_usage_one_reversal_per_reservation_uq
  on ai_content_usage_ledger(reversal_of_ledger_id)
  where usage_type='reversal' and reversal_of_ledger_id is not null;

create function enforce_ai_content_usage_reversal_identity() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare reservation public.ai_content_usage_ledger%rowtype;
begin
  if new.usage_type<>'reversal' or new.reversal_of_ledger_id is null then return new; end if;
  select * into strict reservation from public.ai_content_usage_ledger
   where id=new.reversal_of_ledger_id for update;
  if reservation.usage_type<>'generation'
     or reservation.workspace_id<>new.workspace_id or reservation.brand_id<>new.brand_id
     or reservation.generation_id<>new.generation_id
     or reservation.operation_id is distinct from new.operation_id
     or reservation.reservation_id is distinct from reservation.id
     or new.reservation_id is distinct from reservation.id
     or reservation.usage_date<>new.usage_date
     or reservation.quantity<>-new.quantity then
    raise exception 'ai_content_usage_reversal_mismatch';
  end if;
  return new;
end;
$$;
create trigger ai_content_usage_reversal_identity
before insert on ai_content_usage_ledger
for each row execute function enforce_ai_content_usage_reversal_identity();

-- 075_USAGE_IMMUTABILITY_BEGIN
create function reject_ai_content_usage_ledger_mutation() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  raise exception using errcode='55000',message='ai_content_usage_ledger_immutable';
end;
$$;
create trigger ai_content_usage_ledger_immutable
before update or delete on ai_content_usage_ledger
for each row execute function reject_ai_content_usage_ledger_mutation();

alter table ai_content_proposal_jobs
  add column active_stage text null check (active_stage is null or active_stage in ('research','model')),
  drop constraint ai_content_proposal_jobs_status_check,
  add constraint ai_content_proposal_jobs_status_check check (
    status in ('queued','processing','completed','failed','manual_review_required')
  ),
  drop constraint ai_content_proposal_jobs_lease_check,
  add constraint ai_content_proposal_jobs_lease_check check ((
    (status='processing' and active_stage is not null and lease_owner is not null
      and length(trim(lease_owner))>0 and lease_token is not null and lease_started_at is not null
      and lease_expires_at is not null
      and lease_expires_at>lease_started_at and lease_expires_at<=lease_started_at+interval '15 minutes')
    or (status<>'processing' and active_stage is null and lease_owner is null and lease_token is null
      and lease_started_at is null and lease_expires_at is null)
  ) is true),
  drop constraint ai_content_proposal_jobs_terminal_check,
  add constraint ai_content_proposal_jobs_terminal_check check (
    (status in ('failed','manual_review_required') and error_code is not null and completed_at is not null)
    or (status='completed' and error_code is null and error_message is null and completed_at is not null)
    or (status in ('queued','processing') and error_code is null and error_message is null and completed_at is null)
  );

create trigger ai_content_proposal_jobs_invocation_reclaim_guard
before insert or update on ai_content_proposal_jobs
for each row execute function reject_ai_content_cutover_record_mutation();
create constraint trigger ai_content_proposal_jobs_invocation_evidence_guard
after insert or update on ai_content_proposal_jobs
deferrable initially deferred for each row
execute function reject_ai_content_cutover_record_mutation();

create table ai_content_cutover_release_adoptions (
  cutover_id uuid not null references ai_content_cutovers(id) on delete restrict,
  adoption_sequence integer not null check (adoption_sequence>0),
  caller_id uuid not null unique,
  parent_release_sha text not null check (parent_release_sha ~ '^[0-9a-f]{40}$'),
  descendant_source_sha text not null check (descendant_source_sha ~ '^[0-9a-f]{40}$'),
  ancestry_provenance_sha256 text not null check (ancestry_provenance_sha256 ~ '^[0-9a-f]{64}$'),
  preflight_transfer_sha256 text not null check (preflight_transfer_sha256 ~ '^[0-9a-f]{64}$'),
  reason text not null check (length(trim(reason))>0),
  operator_identity text not null check (length(trim(operator_identity))>0),
  created_at timestamptz not null default now(),
  primary key(cutover_id,adoption_sequence)
);

create table ai_content_cutover_release_adoption_events (
  cutover_id uuid not null,
  adoption_sequence integer not null,
  event_sequence integer not null check (event_sequence>0),
  stage text not null check (stage in (
    'requested','manifest_sealed','ui_evidence_sealed','runtime_installed',
    'pointer_advanced','completed','abandoned_before_rollout'
  )),
  evidence_json jsonb not null check (jsonb_typeof(evidence_json)='object'),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  previous_event_sha256 text null check (previous_event_sha256 is null or previous_event_sha256 ~ '^[0-9a-f]{64}$'),
  event_sha256 text not null unique check (event_sha256 ~ '^[0-9a-f]{64}$'),
  operator_identity text not null check (length(trim(operator_identity))>0),
  created_at timestamptz not null default now(),
  primary key(cutover_id,adoption_sequence,event_sequence),
  constraint ai_content_cutover_release_adoption_events_adoption_fk
    foreign key(cutover_id,adoption_sequence)
    references ai_content_cutover_release_adoptions(cutover_id,adoption_sequence) on delete restrict
);

create function begin_ai_content_cutover_release_adoption(
  p_cutover_id uuid,p_caller_id uuid,p_parent_release_sha text,p_descendant_source_sha text,
  p_ancestry_provenance_sha256 text,p_preflight_transfer_sha256 text,
  p_reason text,p_operator_identity text
) returns table(adoption_sequence integer,event_sha256 text)
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare cutover public.ai_content_cutovers%rowtype;
declare existing public.ai_content_cutover_release_adoptions%rowtype;
declare expected_parent_sha text;
declare next_sequence integer;
declare requested_evidence jsonb;
declare requested_evidence_sha text;
declare requested_event_sha text;
declare normalized_reason text;
declare normalized_operator_identity text;
begin
  normalized_reason:=trim(p_reason);
  normalized_operator_identity:=trim(p_operator_identity);
  perform pg_advisory_xact_lock(hashtextextended(p_cutover_id::text,0));
  select * into strict cutover from public.ai_content_cutovers where id=p_cutover_id for update;
  if cutover.status not in ('migration_body_complete','backend_verified','completed') then
    raise exception 'ai_content_release_adoption_cutover_state_invalid';
  end if;
  if session_user<>cutover.operator_role_name::text
     or normalized_operator_identity is distinct from session_user then
    raise exception 'ai_content_release_adoption_operator_invalid';
  end if;
  select * into existing from public.ai_content_cutover_release_adoptions where caller_id=p_caller_id;
  if found then
    if existing.cutover_id is distinct from p_cutover_id
       or existing.parent_release_sha is distinct from p_parent_release_sha
       or existing.descendant_source_sha is distinct from p_descendant_source_sha
       or existing.ancestry_provenance_sha256 is distinct from p_ancestry_provenance_sha256
       or existing.preflight_transfer_sha256 is distinct from p_preflight_transfer_sha256
       or existing.reason is distinct from normalized_reason
       or existing.operator_identity is distinct from normalized_operator_identity then
      raise exception 'ai_content_release_adoption_caller_conflict';
    end if;
    return query select existing.adoption_sequence,event.event_sha256
      from public.ai_content_cutover_release_adoption_events event
     where event.cutover_id=existing.cutover_id
       and event.adoption_sequence=existing.adoption_sequence and event.event_sequence=1;
    return;
  end if;
  if exists (
    select 1 from public.ai_content_cutover_release_adoptions adoption
    cross join lateral (
      select event.stage from public.ai_content_cutover_release_adoption_events event
       where event.cutover_id=adoption.cutover_id
         and event.adoption_sequence=adoption.adoption_sequence
       order by event.event_sequence desc limit 1
    ) latest
    where adoption.cutover_id=p_cutover_id
      and latest.stage not in ('completed','abandoned_before_rollout')
  ) then raise exception 'ai_content_release_adoption_in_progress'; end if;
  select adoption.descendant_source_sha into expected_parent_sha
    from public.ai_content_cutover_release_adoptions adoption
    join lateral (
      select event.stage from public.ai_content_cutover_release_adoption_events event
       where event.cutover_id=adoption.cutover_id
         and event.adoption_sequence=adoption.adoption_sequence
       order by event.event_sequence desc limit 1
    ) latest on true
   where adoption.cutover_id=p_cutover_id and latest.stage='completed'
   order by adoption.adoption_sequence desc limit 1;
  expected_parent_sha:=coalesce(expected_parent_sha,cutover.intended_release_sha);
  if p_caller_id is null or p_parent_release_sha is null or p_descendant_source_sha is null
     or p_ancestry_provenance_sha256 is null or p_preflight_transfer_sha256 is null
     or normalized_reason is null or normalized_operator_identity is null
     or p_parent_release_sha is distinct from expected_parent_sha
     or p_descendant_source_sha !~ '^[0-9a-f]{40}$'
     or p_descendant_source_sha=p_parent_release_sha
     or p_ancestry_provenance_sha256 !~ '^[0-9a-f]{64}$'
     or p_preflight_transfer_sha256 is distinct from cutover.proposal_preflight_transfer_sha256
     or length(normalized_reason)=0 or length(normalized_operator_identity)=0 then
    raise exception 'ai_content_release_adoption_request_invalid';
  end if;
  select coalesce(max(adoption.adoption_sequence),0)+1 into next_sequence
    from public.ai_content_cutover_release_adoptions adoption where adoption.cutover_id=p_cutover_id;
  insert into public.ai_content_cutover_release_adoptions(
    cutover_id,adoption_sequence,caller_id,parent_release_sha,descendant_source_sha,
    ancestry_provenance_sha256,preflight_transfer_sha256,reason,operator_identity
  ) values(
    p_cutover_id,next_sequence,p_caller_id,p_parent_release_sha,p_descendant_source_sha,
    p_ancestry_provenance_sha256,p_preflight_transfer_sha256,normalized_reason,normalized_operator_identity
  );
  requested_evidence:=jsonb_build_object(
    'callerId',p_caller_id,'parentReleaseSha',p_parent_release_sha,
    'descendantSourceSha',p_descendant_source_sha,
    'ancestryProvenanceSha256',p_ancestry_provenance_sha256,
    'preflightTransferSha256',p_preflight_transfer_sha256,'reason',normalized_reason
  );
  requested_evidence_sha:=encode(digest(requested_evidence::text,'sha256'),'hex');
  requested_event_sha:=encode(digest(jsonb_build_array(
    p_cutover_id,next_sequence,1,'requested',requested_evidence,
    requested_evidence_sha,null,normalized_operator_identity
  )::text,'sha256'),'hex');
  insert into public.ai_content_cutover_release_adoption_events(
    cutover_id,adoption_sequence,event_sequence,stage,evidence_json,evidence_sha256,
    previous_event_sha256,event_sha256,operator_identity
  ) values(
    p_cutover_id,next_sequence,1,'requested',requested_evidence,requested_evidence_sha,
    null,requested_event_sha,normalized_operator_identity
  );
  return query select next_sequence,requested_event_sha;
end;
$$;

create function append_ai_content_cutover_release_adoption_event(
  p_cutover_id uuid,p_adoption_sequence integer,p_event_sequence integer,
  p_stage text,p_evidence_json jsonb,p_operator_identity text
) returns text language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare adoption public.ai_content_cutover_release_adoptions%rowtype;
declare previous public.ai_content_cutover_release_adoption_events%rowtype;
declare replay public.ai_content_cutover_release_adoption_events%rowtype;
declare manifest_event public.ai_content_cutover_release_adoption_events%rowtype;
declare ui_event public.ai_content_cutover_release_adoption_events%rowtype;
declare runtime_event public.ai_content_cutover_release_adoption_events%rowtype;
declare pointer_event public.ai_content_cutover_release_adoption_events%rowtype;
declare cutover public.ai_content_cutovers%rowtype;
declare next_evidence_sha text;
declare next_event_sha text;
begin
  select * into strict adoption from public.ai_content_cutover_release_adoptions
   where cutover_id=p_cutover_id and adoption_sequence=p_adoption_sequence for update;
  select * into strict cutover from public.ai_content_cutovers where id=p_cutover_id for update;
  if session_user<>cutover.operator_role_name::text
     or trim(p_operator_identity) is distinct from session_user then
    raise exception 'ai_content_release_adoption_operator_invalid';
  end if;
  if p_event_sequence is null or p_stage is null or p_evidence_json is null
     or p_operator_identity is null or jsonb_typeof(p_evidence_json)<>'object'
     or p_evidence_json='{}'::jsonb or length(trim(p_operator_identity))=0 then
    raise exception 'ai_content_release_adoption_event_payload_invalid';
  end if;
  next_evidence_sha:=encode(digest(p_evidence_json::text,'sha256'),'hex');
  select * into replay from public.ai_content_cutover_release_adoption_events
   where cutover_id=p_cutover_id and adoption_sequence=p_adoption_sequence
     and event_sequence=p_event_sequence;
  if found then
    if replay.stage is not distinct from p_stage
       and replay.evidence_json is not distinct from p_evidence_json
       and replay.evidence_sha256 is not distinct from next_evidence_sha
       and replay.operator_identity is not distinct from trim(p_operator_identity)
    then return replay.event_sha256; end if;
    raise exception 'ai_content_release_adoption_event_replay_conflict';
  end if;
  select * into strict previous from public.ai_content_cutover_release_adoption_events
   where cutover_id=p_cutover_id and adoption_sequence=p_adoption_sequence
   order by event_sequence desc limit 1 for update;
  if previous.stage in ('completed','abandoned_before_rollout') then
    raise exception 'ai_content_release_adoption_terminal';
  end if;
  if p_event_sequence<>previous.event_sequence+1 then
    raise exception 'ai_content_release_adoption_event_sequence_invalid';
  end if;
  if not ((previous.stage,p_stage) in (
    ('requested','manifest_sealed'),('manifest_sealed','ui_evidence_sealed'),
    ('ui_evidence_sealed','runtime_installed'),('runtime_installed','pointer_advanced'),
    ('pointer_advanced','completed'),('requested','abandoned_before_rollout'),
    ('manifest_sealed','abandoned_before_rollout'),('ui_evidence_sealed','abandoned_before_rollout')
  )) then raise exception 'ai_content_release_adoption_transition_invalid'; end if;
  if p_stage='manifest_sealed' and (
    p_evidence_json ?& array[
      'manifestSha256','apiImageDigest','contentProposalImageDigest','cardNewsImageDigest',
      'blogImageDigest','reelImageDigest','proposalWorkerSourceSha','proposalWorkerTreeSha',
      'proposalContractSourceSha256','proposalSchemaSha256','proposalCatalogSha256',
      'proposalModelId','proposalCommandDescriptorSha256','migrationSha256',
      'preflightCandidateSha','preflightTransferSha256'
    ]
    and p_evidence_json - array[
      'manifestSha256','apiImageDigest','contentProposalImageDigest','cardNewsImageDigest',
      'blogImageDigest','reelImageDigest','proposalWorkerSourceSha','proposalWorkerTreeSha',
      'proposalContractSourceSha256','proposalSchemaSha256','proposalCatalogSha256',
      'proposalModelId','proposalCommandDescriptorSha256','migrationSha256',
      'preflightCandidateSha','preflightTransferSha256'
    ] = '{}'::jsonb
    and p_evidence_json->>'manifestSha256' ~ '^[0-9a-f]{64}$'
    and p_evidence_json->>'apiImageDigest' ~ '^sha256:[0-9a-f]{64}$'
    and p_evidence_json->>'contentProposalImageDigest' ~ '^sha256:[0-9a-f]{64}$'
    and p_evidence_json->>'cardNewsImageDigest' ~ '^sha256:[0-9a-f]{64}$'
    and p_evidence_json->>'blogImageDigest' ~ '^sha256:[0-9a-f]{64}$'
    and p_evidence_json->>'reelImageDigest' ~ '^sha256:[0-9a-f]{64}$'
    and p_evidence_json->>'proposalWorkerSourceSha' ~ '^[0-9a-f]{40}$'
    and p_evidence_json->>'proposalWorkerTreeSha' ~ '^[0-9a-f]{40}$'
    and p_evidence_json->>'proposalContractSourceSha256' ~ '^[0-9a-f]{64}$'
    and p_evidence_json->>'proposalSchemaSha256' ~ '^[0-9a-f]{64}$'
    and p_evidence_json->>'proposalCatalogSha256' ~ '^[0-9a-f]{64}$'
    and p_evidence_json->>'proposalModelId'='gpt-5.6-terra'
    and p_evidence_json->>'proposalCommandDescriptorSha256' ~ '^[0-9a-f]{64}$'
    and p_evidence_json->>'migrationSha256' ~ '^[0-9a-f]{64}$'
    and p_evidence_json->>'preflightCandidateSha' ~ '^[0-9a-f]{40}$'
    and p_evidence_json->>'preflightTransferSha256'=adoption.preflight_transfer_sha256
    and p_evidence_json->>'contentProposalImageDigest'
      =cutover.proposal_preflight_identity_json->>'contentProposalWorkerImageDigest'
    and p_evidence_json->>'proposalWorkerSourceSha'
      =cutover.proposal_preflight_identity_json->>'proposalWorkerSourceSha'
    and p_evidence_json->>'proposalWorkerTreeSha'
      =cutover.proposal_preflight_identity_json->>'proposalWorkerTreeSha'
    and p_evidence_json->>'proposalContractSourceSha256'
      =cutover.proposal_preflight_identity_json->>'proposalContractSourceSha256'
    and p_evidence_json->>'proposalSchemaSha256'
      =cutover.proposal_preflight_identity_json->>'proposalSchemaSha256'
    and p_evidence_json->>'proposalCatalogSha256'
      =cutover.proposal_preflight_identity_json->>'proposalCatalogSha256'
    and p_evidence_json->>'proposalModelId'
      =cutover.proposal_preflight_identity_json->>'proposalModelId'
    and p_evidence_json->>'proposalCommandDescriptorSha256'
      =cutover.proposal_preflight_identity_json->>'proposalCommandDescriptorSha256'
    and p_evidence_json->>'migrationSha256'
      =cutover.proposal_preflight_identity_json->>'migrationSha256'
    and p_evidence_json->>'preflightCandidateSha'
      =cutover.proposal_preflight_identity_json->>'preflightCandidateSha'
    and exists (select 1 from public.schema_migrations marker
      where marker.id='075_ai_content_three_format_cutover.sql'
        and marker.checksum=p_evidence_json->>'migrationSha256')
  ) is not true then raise exception 'ai_content_release_adoption_manifest_evidence_invalid'; end if;
  if p_stage='ui_evidence_sealed' and (
    p_evidence_json ?& array['customerUiChanged','stagedCustomerUiDeploymentId',
      'currentCustomerUiDeploymentId','customerUiSourceSha','customerUiEvidenceSha256']
    and p_evidence_json - array['customerUiChanged','stagedCustomerUiDeploymentId',
      'currentCustomerUiDeploymentId','customerUiSourceSha','customerUiEvidenceSha256'] = '{}'::jsonb
    and jsonb_typeof(p_evidence_json->'customerUiChanged')='boolean'
    and length(trim(p_evidence_json->>'stagedCustomerUiDeploymentId'))>0
    and length(trim(p_evidence_json->>'currentCustomerUiDeploymentId'))>0
    and p_evidence_json->>'customerUiSourceSha' ~ '^[0-9a-f]{40}$'
    and p_evidence_json->>'customerUiEvidenceSha256' ~ '^[0-9a-f]{64}$'
  ) is not true then raise exception 'ai_content_release_adoption_ui_evidence_invalid'; end if;
  if p_stage='runtime_installed' then
    select * into strict manifest_event from public.ai_content_cutover_release_adoption_events
     where cutover_id=p_cutover_id and adoption_sequence=p_adoption_sequence and stage='manifest_sealed';
    if (
      p_evidence_json ?& array['apiImageDigest','contentProposalImageDigest','cardNewsImageDigest',
        'blogImageDigest','reelImageDigest','runtimeEvidenceSha256']
      and p_evidence_json - array['apiImageDigest','contentProposalImageDigest','cardNewsImageDigest',
        'blogImageDigest','reelImageDigest','runtimeEvidenceSha256'] = '{}'::jsonb
      and p_evidence_json->>'runtimeEvidenceSha256' ~ '^[0-9a-f]{64}$'
      and p_evidence_json->>'apiImageDigest'=manifest_event.evidence_json->>'apiImageDigest'
      and p_evidence_json->>'contentProposalImageDigest'=manifest_event.evidence_json->>'contentProposalImageDigest'
      and p_evidence_json->>'cardNewsImageDigest'=manifest_event.evidence_json->>'cardNewsImageDigest'
      and p_evidence_json->>'blogImageDigest'=manifest_event.evidence_json->>'blogImageDigest'
      and p_evidence_json->>'reelImageDigest'=manifest_event.evidence_json->>'reelImageDigest'
    ) is not true then raise exception 'ai_content_release_adoption_runtime_evidence_invalid'; end if;
  end if;
  if p_stage='pointer_advanced' then
    select * into strict ui_event from public.ai_content_cutover_release_adoption_events
     where cutover_id=p_cutover_id and adoption_sequence=p_adoption_sequence and stage='ui_evidence_sealed';
    if (
      p_evidence_json ?& array['controlEvidenceSha256','currentPointerEvidenceSha256',
        'currentReleaseSha','currentCustomerUiDeploymentId']
      and p_evidence_json - array['controlEvidenceSha256','currentPointerEvidenceSha256',
        'currentReleaseSha','currentCustomerUiDeploymentId'] = '{}'::jsonb
      and p_evidence_json->>'controlEvidenceSha256' ~ '^[0-9a-f]{64}$'
      and p_evidence_json->>'currentPointerEvidenceSha256' ~ '^[0-9a-f]{64}$'
      and p_evidence_json->>'currentReleaseSha'=adoption.descendant_source_sha
      and p_evidence_json->>'currentCustomerUiDeploymentId'=ui_event.evidence_json->>'stagedCustomerUiDeploymentId'
    ) is not true then raise exception 'ai_content_release_adoption_pointer_evidence_invalid'; end if;
  end if;
  if p_stage='abandoned_before_rollout' and (
    p_evidence_json ?& array['reason','abandonmentEvidenceSha256']
    and p_evidence_json - array['reason','abandonmentEvidenceSha256'] = '{}'::jsonb
    and length(trim(p_evidence_json->>'reason'))>0
    and p_evidence_json->>'abandonmentEvidenceSha256' ~ '^[0-9a-f]{64}$'
  ) is not true then raise exception 'ai_content_release_adoption_abandonment_evidence_invalid'; end if;
  if p_stage='completed' then
    select * into strict manifest_event from public.ai_content_cutover_release_adoption_events
     where cutover_id=p_cutover_id and adoption_sequence=p_adoption_sequence and stage='manifest_sealed';
    select * into strict ui_event from public.ai_content_cutover_release_adoption_events
     where cutover_id=p_cutover_id and adoption_sequence=p_adoption_sequence and stage='ui_evidence_sealed';
    select * into strict runtime_event from public.ai_content_cutover_release_adoption_events
     where cutover_id=p_cutover_id and adoption_sequence=p_adoption_sequence and stage='runtime_installed';
    select * into strict pointer_event from public.ai_content_cutover_release_adoption_events
     where cutover_id=p_cutover_id and adoption_sequence=p_adoption_sequence and stage='pointer_advanced';
    if (
      p_evidence_json ?& array[
        'parentReleaseSha','adoptedReleaseSha','ancestryProvenanceSha256','preflightTransferSha256',
        'manifestEvidenceSha256','uiEvidenceSha256','runtimeEvidenceSha256','controlEvidenceSha256',
        'currentPointerEvidenceSha256','manifestSha256','apiImageDigest','contentProposalImageDigest',
        'cardNewsImageDigest','blogImageDigest','reelImageDigest','proposalWorkerSourceSha',
        'proposalWorkerTreeSha','customerUiChanged','stagedCustomerUiDeploymentId',
        'currentCustomerUiDeploymentId','customerUiSourceSha','customerUiEvidenceSha256',
        'proposalContractSourceSha256','proposalSchemaSha256','proposalCatalogSha256','proposalModelId',
        'proposalCommandDescriptorSha256','migrationSha256','preflightCandidateSha','reason'
      ]
      and p_evidence_json - array[
        'parentReleaseSha','adoptedReleaseSha','ancestryProvenanceSha256','preflightTransferSha256',
        'manifestEvidenceSha256','uiEvidenceSha256','runtimeEvidenceSha256','controlEvidenceSha256',
        'currentPointerEvidenceSha256','manifestSha256','apiImageDigest','contentProposalImageDigest',
        'cardNewsImageDigest','blogImageDigest','reelImageDigest','proposalWorkerSourceSha',
        'proposalWorkerTreeSha','customerUiChanged','stagedCustomerUiDeploymentId',
        'currentCustomerUiDeploymentId','customerUiSourceSha','customerUiEvidenceSha256',
        'proposalContractSourceSha256','proposalSchemaSha256','proposalCatalogSha256','proposalModelId',
        'proposalCommandDescriptorSha256','migrationSha256','preflightCandidateSha','reason'
      ] = '{}'::jsonb
      and p_evidence_json->>'parentReleaseSha'=adoption.parent_release_sha
      and p_evidence_json->>'adoptedReleaseSha'=adoption.descendant_source_sha
      and p_evidence_json->>'ancestryProvenanceSha256'=adoption.ancestry_provenance_sha256
      and p_evidence_json->>'preflightTransferSha256'=adoption.preflight_transfer_sha256
      and p_evidence_json->>'manifestEvidenceSha256'=manifest_event.evidence_sha256
      and p_evidence_json->>'uiEvidenceSha256'=ui_event.evidence_sha256
      and p_evidence_json->>'runtimeEvidenceSha256'=runtime_event.evidence_json->>'runtimeEvidenceSha256'
      and p_evidence_json->>'controlEvidenceSha256'=pointer_event.evidence_json->>'controlEvidenceSha256'
      and p_evidence_json->>'currentPointerEvidenceSha256'=pointer_event.evidence_json->>'currentPointerEvidenceSha256'
      and p_evidence_json->>'manifestSha256'=manifest_event.evidence_json->>'manifestSha256'
      and p_evidence_json->>'apiImageDigest'=manifest_event.evidence_json->>'apiImageDigest'
      and p_evidence_json->>'contentProposalImageDigest'=manifest_event.evidence_json->>'contentProposalImageDigest'
      and p_evidence_json->>'cardNewsImageDigest'=manifest_event.evidence_json->>'cardNewsImageDigest'
      and p_evidence_json->>'blogImageDigest'=manifest_event.evidence_json->>'blogImageDigest'
      and p_evidence_json->>'reelImageDigest'=manifest_event.evidence_json->>'reelImageDigest'
      and p_evidence_json->>'proposalWorkerSourceSha'=manifest_event.evidence_json->>'proposalWorkerSourceSha'
      and p_evidence_json->>'proposalWorkerTreeSha'=manifest_event.evidence_json->>'proposalWorkerTreeSha'
      and p_evidence_json->'customerUiChanged'=ui_event.evidence_json->'customerUiChanged'
      and p_evidence_json->>'stagedCustomerUiDeploymentId'=ui_event.evidence_json->>'stagedCustomerUiDeploymentId'
      and p_evidence_json->>'currentCustomerUiDeploymentId'=ui_event.evidence_json->>'stagedCustomerUiDeploymentId'
      and p_evidence_json->>'customerUiSourceSha'=ui_event.evidence_json->>'customerUiSourceSha'
      and p_evidence_json->>'customerUiEvidenceSha256'=ui_event.evidence_json->>'customerUiEvidenceSha256'
      and p_evidence_json->>'proposalContractSourceSha256'=manifest_event.evidence_json->>'proposalContractSourceSha256'
      and p_evidence_json->>'proposalSchemaSha256'=manifest_event.evidence_json->>'proposalSchemaSha256'
      and p_evidence_json->>'proposalCatalogSha256'=manifest_event.evidence_json->>'proposalCatalogSha256'
      and p_evidence_json->>'proposalModelId'=manifest_event.evidence_json->>'proposalModelId'
      and p_evidence_json->>'proposalCommandDescriptorSha256'=manifest_event.evidence_json->>'proposalCommandDescriptorSha256'
      and p_evidence_json->>'migrationSha256'=manifest_event.evidence_json->>'migrationSha256'
      and p_evidence_json->>'preflightCandidateSha'=manifest_event.evidence_json->>'preflightCandidateSha'
      and p_evidence_json->>'reason'=adoption.reason
    ) is not true then raise exception 'ai_content_release_adoption_completion_mismatch'; end if;
  end if;
  next_event_sha:=encode(digest(jsonb_build_array(
    p_cutover_id,p_adoption_sequence,p_event_sequence,p_stage,p_evidence_json,
    next_evidence_sha,previous.event_sha256,trim(p_operator_identity)
  )::text,'sha256'),'hex');
  insert into public.ai_content_cutover_release_adoption_events(
    cutover_id,adoption_sequence,event_sequence,stage,evidence_json,evidence_sha256,
    previous_event_sha256,event_sha256,operator_identity
  ) values(
    p_cutover_id,p_adoption_sequence,p_event_sequence,p_stage,p_evidence_json,next_evidence_sha,
    previous.event_sha256,next_event_sha,trim(p_operator_identity)
  );
  return next_event_sha;
end;
$$;

create table ai_content_storage_cleanup_outbox (
  id uuid primary key default gen_random_uuid(),
  cutover_id uuid not null references ai_content_cutovers(id) on delete restrict,
  workspace_id uuid not null references workspaces(id) on delete restrict,
  processor_kind text not null check (processor_kind='cutover_storage_gc'),
  storage_path text not null,
  object_kind text not null check (length(trim(object_kind))>0),
  source_relation text not null check (length(trim(source_relation))>0),
  source_row_id uuid not null,
  known_checksum_sha256 text null check (
    known_checksum_sha256 is null or known_checksum_sha256 ~ '^[0-9a-f]{64}$'
  ),
  status text not null default 'pending',
  attempt_count integer not null default 0 check (attempt_count>=0),
  available_at timestamptz not null default now(),
  lease_owner text null,
  lease_token uuid null,
  lease_expires_at timestamptz null,
  error_code text null,
  error_message text null,
  retention_evidence_sha256 text null check (retention_evidence_sha256 is null or retention_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  last_transition_request_sha256 text null check (
    last_transition_request_sha256 is null or last_transition_request_sha256 ~ '^[0-9a-f]{64}$'
  ),
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_content_storage_cleanup_outbox_storage_path_check check ((
    storage_path=trim(storage_path) and length(storage_path)>0
  ) is true),
  constraint ai_content_storage_cleanup_outbox_identity_unique unique(cutover_id,workspace_id,storage_path),
  constraint ai_content_storage_cleanup_outbox_status_check check (
    status in ('pending','deleting','failed','deleted','dead_letter','retained_reference')
  ),
  constraint ai_content_storage_cleanup_outbox_state_check check ((
    (status='deleting' and length(trim(lease_owner))>0 and lease_token is not null
      and lease_expires_at is not null and completed_at is null and last_transition_request_sha256 is null)
    or (status in ('pending','failed') and lease_owner is null and lease_token is null
      and lease_expires_at is null and completed_at is null
      and (status='pending' or last_transition_request_sha256 is not null))
    or (status='deleted' and lease_owner is null and lease_token is null
      and lease_expires_at is null and completed_at is not null and retention_evidence_sha256 is null
      and last_transition_request_sha256 is not null)
    or (status='dead_letter' and lease_owner is null and lease_token is null
      and lease_expires_at is null and completed_at is not null and length(trim(error_code))>0
      and last_transition_request_sha256 is not null)
    or (status='retained_reference' and lease_owner is null and lease_token is null
      and lease_expires_at is null and completed_at is not null and retention_evidence_sha256 is not null
      and last_transition_request_sha256 is not null)
  ) is true)
);

create function claim_ai_content_storage_cleanup(
  p_cutover_id uuid,p_workspace_id uuid,p_cleanup_token text,p_lease_owner text,
  p_lease_token uuid,p_limit integer
) returns setof public.ai_content_storage_cleanup_outbox
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare cutover public.ai_content_cutovers%rowtype;
begin
  select * into strict cutover from public.ai_content_cutovers where id=p_cutover_id for update;
  if cutover.cleanup_token_sha256<>encode(digest(p_cleanup_token,'sha256'),'hex')
     or p_cleanup_token is null
     or session_user<>cutover.cleanup_role_name::text
     or nullif(current_setting('app.ai_content_cutover_id',true),'')::uuid is distinct from p_cutover_id
     or nullif(current_setting('app.ai_content_cleanup_token',true),'') is distinct from p_cleanup_token
     or cutover.status not in ('migration_body_complete','backend_verified')
     or p_lease_owner is null or length(trim(p_lease_owner))=0 or p_lease_token is null
     or p_limit is null or p_limit not between 1 and 100
     or not exists (
       select 1 from public.ai_content_maintenance_state
        where singleton and enabled and cutover_id=p_cutover_id
     ) or not exists (
       select 1 from public.schema_migrations
        where id='075_ai_content_three_format_cutover.sql'
     ) then raise exception 'ai_content_storage_cleanup_claim_invalid'; end if;
  update public.ai_content_storage_cleanup_outbox outbox set
    status='dead_letter',lease_owner=null,lease_token=null,lease_expires_at=null,
    error_code='lease_expired',error_message='final cleanup lease expired',completed_at=now(),
    last_transition_request_sha256=encode(digest(jsonb_build_array(
      'lease_expired',outbox.id,outbox.lease_token,outbox.attempt_count
    )::text,'sha256'),'hex'),updated_at=now()
   where outbox.cutover_id=p_cutover_id and outbox.workspace_id=p_workspace_id
     and outbox.processor_kind='cutover_storage_gc' and outbox.status='deleting'
     and outbox.lease_expires_at<=clock_timestamp() and outbox.attempt_count>=10;
  return query
    with candidates as (
      select outbox.id from public.ai_content_storage_cleanup_outbox outbox
       where outbox.cutover_id=p_cutover_id and outbox.workspace_id=p_workspace_id
         and outbox.processor_kind='cutover_storage_gc' and outbox.attempt_count<10
         and (
           (outbox.status in ('pending','failed') and outbox.available_at<=now())
           or (outbox.status='deleting' and outbox.lease_expires_at<=clock_timestamp())
         )
       order by outbox.available_at,outbox.created_at,outbox.id
       for update skip locked limit p_limit
    )
    update public.ai_content_storage_cleanup_outbox outbox set
      status='deleting',attempt_count=outbox.attempt_count+1,lease_owner=trim(p_lease_owner),
      lease_token=p_lease_token,lease_expires_at=now()+interval '5 minutes',
      error_code=null,error_message=null,completed_at=null,last_transition_request_sha256=null,updated_at=now()
    from candidates where outbox.id=candidates.id returning outbox.*;
end;
$$;

create function complete_ai_content_storage_cleanup(
  p_outbox_id uuid,p_cleanup_token text,p_lease_owner text,p_lease_token uuid,p_disposition text,
  p_retention_evidence_sha256 text default null
) returns public.ai_content_storage_cleanup_outbox
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare completed public.ai_content_storage_cleanup_outbox%rowtype;
declare request_hash text;
begin
  request_hash:=encode(digest(jsonb_build_array(
    'complete',p_outbox_id,encode(digest(p_cleanup_token,'sha256'),'hex'),
    trim(p_lease_owner),p_lease_token,
    p_disposition,p_retention_evidence_sha256
  )::text,'sha256'),'hex');
  update public.ai_content_storage_cleanup_outbox outbox set
    status=p_disposition,lease_owner=null,lease_token=null,lease_expires_at=null,
    retention_evidence_sha256=p_retention_evidence_sha256,
    last_transition_request_sha256=request_hash,completed_at=now(),updated_at=now()
  from public.ai_content_cutovers cutover
  where outbox.id=p_outbox_id and outbox.cutover_id=cutover.id and outbox.status='deleting'
    and outbox.processor_kind='cutover_storage_gc'
    and outbox.lease_owner=trim(p_lease_owner) and outbox.lease_token=p_lease_token
    and outbox.lease_expires_at>clock_timestamp()
    and cutover.cleanup_token_sha256=encode(digest(p_cleanup_token,'sha256'),'hex')
    and session_user=cutover.cleanup_role_name::text
    and nullif(current_setting('app.ai_content_cutover_id',true),'')::uuid=cutover.id
    and nullif(current_setting('app.ai_content_cleanup_token',true),'')=p_cleanup_token
    and cutover.status in ('migration_body_complete','backend_verified')
    and exists (select 1 from public.ai_content_maintenance_state maintenance
      where maintenance.singleton and maintenance.enabled and maintenance.cutover_id=cutover.id)
    and exists (select 1 from public.schema_migrations marker
      where marker.id='075_ai_content_three_format_cutover.sql')
    and ((p_disposition='deleted' and p_retention_evidence_sha256 is null)
      or (p_disposition='retained_reference' and p_retention_evidence_sha256 ~ '^[0-9a-f]{64}$'))
  returning outbox.* into completed;
  if not found then
    select outbox.* into completed
      from public.ai_content_storage_cleanup_outbox outbox
      join public.ai_content_cutovers cutover on cutover.id=outbox.cutover_id
     where outbox.id=p_outbox_id and outbox.status in ('deleted','retained_reference')
       and outbox.processor_kind='cutover_storage_gc'
       and outbox.last_transition_request_sha256=request_hash
       and cutover.cleanup_token_sha256=encode(digest(p_cleanup_token,'sha256'),'hex')
       and session_user=cutover.cleanup_role_name::text
       and nullif(current_setting('app.ai_content_cutover_id',true),'')::uuid=cutover.id
       and nullif(current_setting('app.ai_content_cleanup_token',true),'')=p_cleanup_token
       and cutover.status in ('migration_body_complete','backend_verified')
       and exists (select 1 from public.ai_content_maintenance_state maintenance
         where maintenance.singleton and maintenance.enabled and maintenance.cutover_id=cutover.id)
       and exists (select 1 from public.schema_migrations marker
         where marker.id='075_ai_content_three_format_cutover.sql');
    if not found then raise exception 'ai_content_storage_cleanup_complete_conflict'; end if;
  end if;
  return completed;
end;
$$;

create function fail_ai_content_storage_cleanup(
  p_outbox_id uuid,p_cleanup_token text,p_lease_owner text,p_lease_token uuid,
  p_error_code text,p_error_message text
) returns public.ai_content_storage_cleanup_outbox
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare failed public.ai_content_storage_cleanup_outbox%rowtype;
declare request_hash text;
begin
  request_hash:=encode(digest(jsonb_build_array(
    'fail',p_outbox_id,encode(digest(p_cleanup_token,'sha256'),'hex'),
    trim(p_lease_owner),p_lease_token,
    p_error_code,p_error_message
  )::text,'sha256'),'hex');
  update public.ai_content_storage_cleanup_outbox outbox set
    status=case when outbox.attempt_count>=10 then 'dead_letter' else 'failed' end,
    lease_owner=null,lease_token=null,lease_expires_at=null,error_code=p_error_code,
    error_message=p_error_message,
    last_transition_request_sha256=request_hash,
    completed_at=case when outbox.attempt_count>=10 then now() else null end,
    available_at=case when outbox.attempt_count>=10 then outbox.available_at else now()+interval '5 minutes' end,
    updated_at=now()
  from public.ai_content_cutovers cutover
  where outbox.id=p_outbox_id and outbox.cutover_id=cutover.id and outbox.status='deleting'
    and outbox.processor_kind='cutover_storage_gc'
    and outbox.lease_owner=trim(p_lease_owner) and outbox.lease_token=p_lease_token
    and outbox.lease_expires_at>clock_timestamp()
    and cutover.cleanup_token_sha256=encode(digest(p_cleanup_token,'sha256'),'hex')
    and session_user=cutover.cleanup_role_name::text
    and nullif(current_setting('app.ai_content_cutover_id',true),'')::uuid=cutover.id
    and nullif(current_setting('app.ai_content_cleanup_token',true),'')=p_cleanup_token
    and cutover.status in ('migration_body_complete','backend_verified')
    and exists (select 1 from public.ai_content_maintenance_state maintenance
      where maintenance.singleton and maintenance.enabled and maintenance.cutover_id=cutover.id)
    and exists (select 1 from public.schema_migrations marker
      where marker.id='075_ai_content_three_format_cutover.sql')
    and length(trim(p_error_code))>0 and length(trim(p_error_message))>0
  returning outbox.* into failed;
  if not found then
    select outbox.* into failed
      from public.ai_content_storage_cleanup_outbox outbox
      join public.ai_content_cutovers cutover on cutover.id=outbox.cutover_id
     where outbox.id=p_outbox_id and outbox.status in ('failed','dead_letter')
       and outbox.processor_kind='cutover_storage_gc'
       and outbox.last_transition_request_sha256=request_hash
       and cutover.cleanup_token_sha256=encode(digest(p_cleanup_token,'sha256'),'hex')
       and session_user=cutover.cleanup_role_name::text
       and nullif(current_setting('app.ai_content_cutover_id',true),'')::uuid=cutover.id
       and nullif(current_setting('app.ai_content_cleanup_token',true),'')=p_cleanup_token
       and cutover.status in ('migration_body_complete','backend_verified')
       and exists (select 1 from public.ai_content_maintenance_state maintenance
         where maintenance.singleton and maintenance.enabled and maintenance.cutover_id=cutover.id)
       and exists (select 1 from public.schema_migrations marker
         where marker.id='075_ai_content_three_format_cutover.sql');
    if not found then raise exception 'ai_content_storage_cleanup_fail_conflict'; end if;
  end if;
  return failed;
end;
$$;

create function is_ai_content_storage_path_protected(
  p_workspace_id uuid,p_storage_path text
) returns boolean
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare bootstrap public.ai_content_bootstrap_state%rowtype;
declare normalized_storage_path text;
begin
  normalized_storage_path:=trim(p_storage_path);
  select * into strict bootstrap from public.ai_content_bootstrap_state where singleton;
  if session_user<>bootstrap.application_role_name::text
     or p_workspace_id is null or normalized_storage_path is null
     or length(normalized_storage_path)=0 then
    raise exception 'ai_content_storage_path_protection_lookup_invalid';
  end if;
  return exists (
    select 1 from public.ai_content_storage_cleanup_outbox outbox
     where outbox.workspace_id=p_workspace_id
       and outbox.storage_path=normalized_storage_path
       and outbox.status='retained_reference'
  );
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'ai_content_proposal_performance_audits','ai_content_proposal_job_contracts',
    'ai_content_proposal_compositions','ai_content_proposal_research_attempts',
    'ai_content_proposal_research_attempt_events','ai_content_proposal_model_attempts',
    'ai_content_proposal_attempt_events','ai_content_generation_prompt_bindings',
    'ai_content_cutover_release_adoptions','ai_content_cutover_release_adoption_events'
  ] loop
    execute format(
      'create trigger %I before update or delete on %I for each row execute function reject_ai_content_cutover_record_mutation()',
      table_name||'_immutable',table_name
    );
  end loop;
end;
$$;

-- 075_FENCE_REGISTRATION_BEGIN
do $$
declare final_catalog_sha256 text;
begin
  final_catalog_sha256:=register_ai_content_075_fence_relations();
  if final_catalog_sha256 is distinct from '22ebe515247269120f8996bc63f335f27b7f767c36fcf667011312cfb03f3661' then
    raise exception 'ai_content_075_fence_registration_hash_invalid';
  end if;
end;
$$;
-- 075_FENCE_REGISTRATION_END

commit;
