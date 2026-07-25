create table if not exists support_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  category text not null,
  title text not null,
  message text not null,
  contact_email text null,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint support_requests_category_check check (category in ('bug', 'feature', 'channel', 'account', 'other')),
  constraint support_requests_status_check check (status in ('new', 'in_progress', 'resolved')),
  constraint support_requests_title_not_blank check (length(trim(title)) > 0),
  constraint support_requests_message_not_blank check (length(trim(message)) > 0)
);

create index if not exists support_requests_brand_created_idx
  on support_requests(brand_id, created_at desc)
  where deleted_at is null;

drop trigger if exists support_requests_set_updated_at on support_requests;
create trigger support_requests_set_updated_at
  before update on support_requests
  for each row execute function set_updated_at();
