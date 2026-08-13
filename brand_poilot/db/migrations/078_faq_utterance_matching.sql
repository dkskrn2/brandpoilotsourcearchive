begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table knowledge_entries
  add column manual_aliases text[] not null default '{}',
  add constraint knowledge_entries_manual_aliases_count_check
    check (cardinality(manual_aliases) between 0 and 8),
  add constraint knowledge_entries_tenant_identity_unique
    unique (id, workspace_id, brand_id);

alter table faq_suggestion_items
  add column example_utterances text[] not null default '{}',
  add constraint faq_suggestion_items_example_utterances_count_check
    check (cardinality(example_utterances) = 0 or cardinality(example_utterances) between 3 and 8);

alter table faq_suggestion_runs
  add column run_kind text not null default 'full_faq',
  add column target_knowledge_entry_id uuid null,
  add column target_knowledge_entry_updated_at timestamptz null,
  add constraint faq_suggestion_runs_kind_check
    check (run_kind in ('full_faq', 'alias_only')),
  add constraint faq_suggestion_runs_target_state_check
    check (
      (
        run_kind = 'full_faq'
        and target_knowledge_entry_id is null
        and target_knowledge_entry_updated_at is null
      )
      or (
        run_kind = 'alias_only'
        and target_knowledge_entry_id is not null
        and target_knowledge_entry_updated_at is not null
      )
    ),
  add constraint faq_suggestion_runs_target_knowledge_entry_fk
    foreign key (target_knowledge_entry_id, workspace_id, brand_id)
    references knowledge_entries(id, workspace_id, brand_id)
    on delete cascade;

drop index if exists faq_suggestion_runs_one_active_per_brand_uq;

create unique index faq_suggestion_runs_one_active_full_per_brand_uq
  on faq_suggestion_runs(workspace_id, brand_id)
  where run_kind = 'full_faq' and status in ('queued', 'running');

create unique index faq_suggestion_runs_one_active_alias_per_entry_uq
  on faq_suggestion_runs(workspace_id, brand_id, target_knowledge_entry_id)
  where run_kind = 'alias_only' and status in ('queued', 'running');

create table faq_alias_suggestion_results (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  run_id uuid not null,
  knowledge_entry_id uuid not null,
  example_utterances text[] not null,
  created_at timestamptz not null default now(),
  constraint faq_alias_suggestion_results_run_unique unique (run_id),
  constraint faq_alias_suggestion_results_run_fk
    foreign key (run_id, workspace_id, brand_id)
    references faq_suggestion_runs(id, workspace_id, brand_id)
    on delete cascade,
  constraint faq_alias_suggestion_results_entry_fk
    foreign key (knowledge_entry_id, workspace_id, brand_id)
    references knowledge_entries(id, workspace_id, brand_id)
    on delete cascade,
  constraint faq_alias_suggestion_results_count_check
    check (cardinality(example_utterances) between 3 and 8)
);

create table dm_faq_confirmations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  conversation_id uuid not null,
  inbound_message_id text not null,
  knowledge_entry_id uuid not null,
  prompt_job_id uuid null,
  status text not null default 'pending_prompt',
  confidence double precision not null,
  expires_at timestamptz not null,
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dm_faq_confirmations_inbound_unique
    unique (workspace_id, brand_id, inbound_message_id),
  constraint dm_faq_confirmations_tenant_identity_unique
    unique (id, workspace_id, brand_id, conversation_id),
  constraint dm_faq_confirmations_conversation_fk
    foreign key (conversation_id, workspace_id, brand_id)
    references instagram_dm_conversations(id, workspace_id, brand_id)
    on delete cascade,
  constraint dm_faq_confirmations_entry_fk
    foreign key (knowledge_entry_id, workspace_id, brand_id)
    references knowledge_entries(id, workspace_id, brand_id)
    on delete cascade,
  constraint dm_faq_confirmations_prompt_job_fk
    foreign key (prompt_job_id, workspace_id, brand_id)
    references jobs(id, workspace_id, brand_id)
    on delete set null (prompt_job_id),
  constraint dm_faq_confirmations_status_check
    check (status in (
      'pending_prompt', 'awaiting_answer', 'confirmed',
      'rejected', 'expired', 'cancelled'
    )),
  constraint dm_faq_confirmations_confidence_check
    check (confidence between 0 and 1),
  constraint dm_faq_confirmations_inbound_message_check
    check (length(trim(inbound_message_id)) > 0),
  constraint dm_faq_confirmations_expiry_check
    check (expires_at > created_at),
  constraint dm_faq_confirmations_resolution_check
    check (
      (
        status in ('pending_prompt', 'awaiting_answer')
        and resolved_at is null
      )
      or (
        status in ('confirmed', 'rejected', 'expired', 'cancelled')
        and resolved_at is not null
      )
    )
);

create unique index dm_faq_confirmations_one_active_per_conversation_uq
  on dm_faq_confirmations(workspace_id, brand_id, conversation_id)
  where status in ('pending_prompt', 'awaiting_answer');

create index dm_faq_confirmations_expiry_idx
  on dm_faq_confirmations(expires_at)
  where status in ('pending_prompt', 'awaiting_answer');

drop trigger if exists dm_faq_confirmations_set_updated_at on dm_faq_confirmations;
create trigger dm_faq_confirmations_set_updated_at
before update on dm_faq_confirmations
for each row execute function set_updated_at();

alter table dm_delivery_attempts
  drop constraint dm_delivery_attempts_reason_code_check,
  add constraint dm_delivery_attempts_reason_code_check
    check (reason_code in (
      'direct_faq', 'wiki_answer', 'faq_clarification', 'restricted_action',
      'complaint', 'knowledge_gap', 'low_confidence', 'processing_error', 'system_event'
    ));

alter table instagram_dm_messages
  drop constraint instagram_dm_messages_reason_code_check,
  add constraint instagram_dm_messages_reason_code_check
    check (reason_code is null or reason_code in (
      'direct_faq', 'wiki_answer', 'faq_clarification', 'restricted_action',
      'complaint', 'knowledge_gap', 'low_confidence', 'processing_error', 'system_event'
    ));

do $$
declare
  schema_owner_role_name name;
  application_role_name name;
begin
  select bootstrap.schema_owner_role_name, bootstrap.application_role_name
    into strict schema_owner_role_name, application_role_name
    from public.ai_content_bootstrap_state bootstrap
   where bootstrap.singleton;

  execute format(
    'alter table public.faq_alias_suggestion_results owner to %I',
    schema_owner_role_name
  );
  execute format(
    'alter table public.dm_faq_confirmations owner to %I',
    schema_owner_role_name
  );
  execute 'revoke all on table public.faq_alias_suggestion_results, public.dm_faq_confirmations from public';
  execute format(
    'grant select, insert, update, delete on table public.faq_alias_suggestion_results to %I',
    application_role_name
  );
  execute format(
    'grant select, insert, update, delete on table public.dm_faq_confirmations to %I',
    application_role_name
  );
end
$$;

commit;
