alter table audit_events
  add column actor_external_id text null;

alter table audit_events
  drop constraint if exists audit_events_actor_type_check;

alter table audit_events
  add constraint audit_events_actor_type_check
  check (actor_type in ('user', 'system', 'worker', 'admin'));

alter table audit_events
  add constraint audit_events_actor_external_id_check
  check (actor_external_id is null or length(trim(actor_external_id)) between 1 and 200);

create index audit_events_actor_external_created_idx
  on audit_events(actor_external_id, created_at desc)
  where actor_external_id is not null;

create table admin_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  actor_external_id text not null,
  idempotency_key uuid not null,
  method text not null,
  path text not null,
  request_hash text not null,
  response_status integer not null,
  response_json jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  constraint admin_idempotency_keys_actor_check
    check (length(trim(actor_external_id)) between 1 and 200),
  constraint admin_idempotency_keys_method_check
    check (method in ('POST', 'PATCH', 'DELETE')),
  constraint admin_idempotency_keys_path_check
    check (length(trim(path)) between 1 and 500),
  constraint admin_idempotency_keys_request_hash_check
    check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint admin_idempotency_keys_response_status_check
    check (response_status between 200 and 599),
  constraint admin_idempotency_keys_response_json_check
    check (jsonb_typeof(response_json) = 'object'),
  unique (actor_external_id, idempotency_key)
);

create index admin_idempotency_keys_expiry_idx
  on admin_idempotency_keys(expires_at);
