begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.product_service_versions
  add constraint product_service_versions_import_job_identity_unique
  unique (id,product_service_id,workspace_id,brand_id);

create table public.product_service_image_import_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null,
  product_service_id uuid not null,
  product_service_version_id uuid not null,
  requested_by_user_id uuid null,
  source_urls_json jsonb not null,
  status text not null default 'pending'
    check (status in ('pending','processing','succeeded','failed')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  available_at timestamptz not null default now(),
  lease_owner text null,
  lease_token uuid null,
  lease_expires_at timestamptz null,
  selection_audit_json jsonb null,
  error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint product_service_image_import_jobs_product_fk
    foreign key (product_service_id,workspace_id,brand_id)
    references public.product_services(id,workspace_id,brand_id) on delete cascade,
  constraint product_service_image_import_jobs_version_fk
    foreign key (product_service_version_id,product_service_id,workspace_id,brand_id)
    references public.product_service_versions(id,product_service_id,workspace_id,brand_id) on delete cascade,
  constraint product_service_image_import_jobs_requester_fk
    foreign key (workspace_id,requested_by_user_id)
    references public.workspace_members(workspace_id,user_id) on delete restrict,
  constraint product_service_image_import_jobs_version_unique
    unique (product_service_version_id),
  constraint product_service_image_import_jobs_sources_check
    check (
      jsonb_typeof(source_urls_json)='array'
      and jsonb_array_length(source_urls_json) between 1 and 5
      and not jsonb_path_exists(source_urls_json,'$[*] ? (@.type() != "string")')
      and jsonb_path_query_array(source_urls_json,'$[*] ? (@ like_regex "^https://")')=source_urls_json
    ),
  constraint product_service_image_import_jobs_lease_check
    check (
      (status='processing' and lease_owner is not null and lease_token is not null and lease_expires_at is not null)
      or (status<>'processing' and lease_owner is null and lease_token is null and lease_expires_at is null)
    ),
  constraint product_service_image_import_jobs_completion_check
    check (
      (status in ('succeeded','failed') and completed_at is not null)
      or (status in ('pending','processing') and completed_at is null)
    )
);

create index product_service_image_import_jobs_claim_idx
  on public.product_service_image_import_jobs(available_at,created_at,id)
  where status='pending' and attempt_count<3;

do $$
declare
  schema_owner_role_name text;
  application_role_name text;
begin
  select bootstrap.schema_owner_role_name,bootstrap.application_role_name
    into strict schema_owner_role_name,application_role_name
    from public.ai_content_bootstrap_state bootstrap
   where bootstrap.singleton;

  execute format('alter table public.product_service_image_import_jobs owner to %I',schema_owner_role_name);
  execute 'revoke all on table public.product_service_image_import_jobs from public';
  execute format(
    'grant select,insert,update on table public.product_service_image_import_jobs to %I',
    application_role_name
  );
end
$$;

commit;
