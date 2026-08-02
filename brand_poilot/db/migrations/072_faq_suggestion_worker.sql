begin;

create table if not exists faq_suggestion_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  status text not null default 'queued',
  input_fingerprint text not null,
  source_snapshot_json jsonb not null,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  available_at timestamptz not null default now(),
  lease_owner text null,
  lease_token uuid null,
  lease_expires_at timestamptz null,
  error_code text null,
  created_by_user_id uuid not null,
  started_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint faq_suggestion_runs_tenant_identity_unique
    unique (id, workspace_id, brand_id),
  constraint faq_suggestion_runs_brand_fk
    foreign key (brand_id, workspace_id)
    references brands(id, workspace_id) on delete cascade,
  constraint faq_suggestion_runs_creator_membership_fk
    foreign key (workspace_id, created_by_user_id)
    references workspace_members(workspace_id, user_id) on delete restrict,
  constraint faq_suggestion_runs_status_check
    check (status in (
      'queued', 'running', 'review_ready', 'partial', 'failed', 'completed'
    )),
  constraint faq_suggestion_runs_input_fingerprint_check
    check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint faq_suggestion_runs_source_snapshot_check
    check (
      jsonb_typeof(source_snapshot_json) = 'object'
      and source_snapshot_json->>'contractVersion' = 'faq-suggestion-sources.v1'
      and jsonb_typeof(source_snapshot_json->'sources') = 'array'
      and jsonb_array_length(source_snapshot_json->'sources') > 0
    ),
  constraint faq_suggestion_runs_attempts_check
    check (
      max_attempts between 1 and 10
      and attempt_count between 0 and max_attempts
    ),
  constraint faq_suggestion_runs_lease_check
    check (
      (
        status = 'running'
        and lease_owner is not null
        and length(trim(lease_owner)) > 0
        and lease_token is not null
        and lease_expires_at is not null
      )
      or (
        status <> 'running'
        and lease_owner is null
        and lease_token is null
        and lease_expires_at is null
      )
    ),
  constraint faq_suggestion_runs_completion_check
    check (
      (status in ('review_ready', 'partial', 'failed', 'completed') and completed_at is not null)
      or (status in ('queued', 'running') and completed_at is null)
    )
);

create unique index if not exists faq_suggestion_runs_one_active_per_brand_uq
  on faq_suggestion_runs(workspace_id, brand_id)
  where status in ('queued', 'running');

create index if not exists faq_suggestion_runs_claim_idx
  on faq_suggestion_runs(available_at, created_at)
  where status in ('queued', 'running');

create index if not exists faq_suggestion_runs_brand_created_idx
  on faq_suggestion_runs(workspace_id, brand_id, created_at desc);

create table if not exists faq_suggestion_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  run_id uuid not null,
  position integer not null,
  category text not null,
  question text not null,
  answer text not null,
  evidence_json jsonb not null,
  confidence double precision not null,
  status text not null default 'review',
  duplicate_of_knowledge_entry_id uuid null references knowledge_entries(id) on delete restrict,
  approved_knowledge_entry_id uuid null references knowledge_entries(id) on delete restrict,
  reviewed_by_user_id uuid null references app_users(id) on delete set null,
  reviewed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint faq_suggestion_items_run_position_unique unique (run_id, position),
  constraint faq_suggestion_items_run_fk
    foreign key (run_id, workspace_id, brand_id)
    references faq_suggestion_runs(id, workspace_id, brand_id) on delete cascade,
  constraint faq_suggestion_items_position_check check (position >= 0),
  constraint faq_suggestion_items_category_check check (category in (
    'service', 'product', 'price_payment', 'location_visit', 'hours',
    'shipping', 'exchange_refund', 'reservation_usage',
    'account_membership', 'other'
  )),
  constraint faq_suggestion_items_question_check
    check (char_length(trim(question)) between 1 and 500),
  constraint faq_suggestion_items_answer_check
    check (char_length(trim(answer)) between 1 and 2000),
  constraint faq_suggestion_items_evidence_check
    check (
      jsonb_typeof(evidence_json) = 'array'
      and jsonb_array_length(evidence_json) between 1 and 5
    ),
  constraint faq_suggestion_items_confidence_check
    check (confidence between 0 and 1),
  constraint faq_suggestion_items_status_check
    check (status in ('review', 'approved', 'dismissed', 'duplicate')),
  constraint faq_suggestion_items_review_state_check
    check (
      (
        status = 'review'
        and duplicate_of_knowledge_entry_id is null
        and approved_knowledge_entry_id is null
        and reviewed_by_user_id is null
        and reviewed_at is null
      )
      or (
        status = 'approved'
        and duplicate_of_knowledge_entry_id is null
        and approved_knowledge_entry_id is not null
        and reviewed_by_user_id is not null
        and reviewed_at is not null
      )
      or (
        status = 'dismissed'
        and duplicate_of_knowledge_entry_id is null
        and approved_knowledge_entry_id is null
        and reviewed_by_user_id is not null
        and reviewed_at is not null
      )
      or (
        status = 'duplicate'
        and duplicate_of_knowledge_entry_id is not null
        and approved_knowledge_entry_id is null
        and reviewed_by_user_id is not null
        and reviewed_at is not null
      )
    )
);

create index if not exists faq_suggestion_items_run_position_idx
  on faq_suggestion_items(workspace_id, brand_id, run_id, position);

alter table worker_instances
  drop constraint if exists worker_instances_type_check;

alter table worker_instances
  add constraint worker_instances_type_check
  check (worker_type in ('image', 'dm', 'faq'));

alter table worker_resource_leases
  drop constraint if exists worker_resource_leases_workload_check;

alter table worker_resource_leases
  add constraint worker_resource_leases_workload_check
  check (workload_type in ('dm', 'wiki', 'content', 'onboarding', 'faq'));

drop trigger if exists faq_suggestion_runs_set_updated_at on faq_suggestion_runs;
create trigger faq_suggestion_runs_set_updated_at
before update on faq_suggestion_runs
for each row execute function set_updated_at();

drop trigger if exists faq_suggestion_items_set_updated_at on faq_suggestion_items;
create trigger faq_suggestion_items_set_updated_at
before update on faq_suggestion_items
for each row execute function set_updated_at();

commit;
