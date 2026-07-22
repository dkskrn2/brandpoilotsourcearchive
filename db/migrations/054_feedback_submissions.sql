begin;

create table feedback_submissions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  message text not null,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint feedback_submissions_message_length_check
    check (length(trim(message)) between 1 and 2000),
  constraint feedback_submissions_status_check
    check (status in ('new', 'reviewed', 'archived'))
);

create index feedback_submissions_created_idx
  on feedback_submissions(created_at desc, id desc)
  where deleted_at is null;

create index feedback_submissions_brand_created_idx
  on feedback_submissions(brand_id, created_at desc, id desc)
  where deleted_at is null;

create trigger feedback_submissions_set_updated_at
  before update on feedback_submissions
  for each row execute function set_updated_at();

commit;
