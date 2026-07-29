begin;

create table wiki_refresh_outbox (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  source_kind text not null,
  source_id uuid not null,
  event_type text not null,
  mutation_key text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_owner text null,
  lease_token uuid null,
  lease_expires_at timestamptz null,
  last_error text null,
  succeeded_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wiki_refresh_outbox_brand_ownership_fk
    foreign key (brand_id, workspace_id)
    references brands(id, workspace_id) on delete cascade,
  constraint wiki_refresh_outbox_product_ownership_fk
    foreign key (source_id, workspace_id, brand_id)
    references product_services(id, workspace_id, brand_id) on delete cascade,
  constraint wiki_refresh_outbox_source_kind_check
    check (source_kind = 'product_service'),
  constraint wiki_refresh_outbox_event_type_check
    check (event_type in ('approved', 'archived')),
  constraint wiki_refresh_outbox_mutation_key_check
    check (length(trim(mutation_key)) > 0),
  constraint wiki_refresh_outbox_status_check
    check (status in ('pending', 'processing', 'succeeded')),
  constraint wiki_refresh_outbox_attempt_count_check
    check (attempt_count >= 0),
  constraint wiki_refresh_outbox_lease_check
    check (
      (
        status = 'processing'
        and lease_owner is not null
        and lease_token is not null
        and lease_expires_at is not null
      )
      or (
        status <> 'processing'
        and lease_owner is null
        and lease_token is null
        and lease_expires_at is null
      )
    ),
  constraint wiki_refresh_outbox_success_check
    check (
      (status = 'succeeded' and succeeded_at is not null)
      or (status <> 'succeeded' and succeeded_at is null)
    ),
  constraint wiki_refresh_outbox_mutation_unique
    unique (workspace_id, brand_id, source_kind, source_id, mutation_key)
);

create index wiki_refresh_outbox_due_idx
  on wiki_refresh_outbox(status, next_attempt_at, created_at)
  where status = 'pending';

create index wiki_refresh_outbox_expired_lease_idx
  on wiki_refresh_outbox(lease_expires_at, created_at)
  where status = 'processing';

drop trigger if exists wiki_refresh_outbox_set_updated_at on wiki_refresh_outbox;
create trigger wiki_refresh_outbox_set_updated_at
before update on wiki_refresh_outbox
for each row execute function set_updated_at();

commit;
