create table if not exists channel_connection_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  status text not null default 'draft',
  instagram_handle text null,
  instagram_profile_url text null,
  facebook_page_url text null,
  meta_business_name text null,
  threads_profile_url text null,
  contact_name text null,
  contact_email text null,
  has_admin_access boolean not null default false,
  request_note text null,
  submitted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_connection_requests_brand_unique unique (brand_id),
  constraint channel_connection_requests_status_check check (
    status in ('draft', 'submitted', 'in_review', 'needs_attention', 'connected')
  )
);

create index if not exists channel_connection_requests_workspace_status_idx
  on channel_connection_requests(workspace_id, status, updated_at desc);

drop trigger if exists channel_connection_requests_set_updated_at on channel_connection_requests;

create trigger channel_connection_requests_set_updated_at
  before update on channel_connection_requests
  for each row execute function set_updated_at();
