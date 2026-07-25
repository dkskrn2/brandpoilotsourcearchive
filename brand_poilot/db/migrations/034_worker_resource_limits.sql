create table worker_resource_leases (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null,
  workload_type text not null,
  worker_id text not null,
  lease_token uuid not null default gen_random_uuid(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worker_resource_leases_resource_check check (resource_type in ('codex_cli')),
  constraint worker_resource_leases_workload_check check (workload_type in ('dm', 'wiki', 'content')),
  constraint worker_resource_leases_worker_check check (length(trim(worker_id)) > 0),
  unique (resource_type, worker_id)
);

create index worker_resource_leases_expiry_idx
  on worker_resource_leases(resource_type, expires_at);

drop trigger if exists worker_resource_leases_set_updated_at on worker_resource_leases;
create trigger worker_resource_leases_set_updated_at
before update on worker_resource_leases
for each row execute function set_updated_at();
