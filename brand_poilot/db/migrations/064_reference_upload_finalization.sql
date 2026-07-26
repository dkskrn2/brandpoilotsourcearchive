-- Two-phase reference upload cancellation and fair expiry finalization.
-- Reference reservations intentionally use a receipt independent from avatar uploads.
-- Depends on: 063_avatar_upload_finalization.sql.

create table if not exists reference_upload_cancellation_receipts (
  session_id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  created_by_user_id uuid not null,
  storage_path text null,
  storage_path_prefix text not null,
  token_expires_at timestamptz not null,
  reason text not null check (reason in ('user', 'expired')),
  status text not null default 'pending'
    check (status in ('pending', 'completed')),
  cancelled_at timestamptz not null default now(),
  completed_at timestamptz null,
  next_attempt_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text null,
  constraint reference_upload_cancellation_receipts_brand_fk
    foreign key (brand_id, workspace_id)
    references brands(id, workspace_id) on delete cascade,
  constraint reference_upload_cancellation_receipts_actor_fk
    foreign key (workspace_id, created_by_user_id)
    references workspace_members(workspace_id, user_id) on delete restrict
);

create index if not exists reference_upload_cancellation_receipts_due_idx
  on reference_upload_cancellation_receipts
    (next_attempt_at, token_expires_at, session_id)
  where status = 'pending';

create index if not exists reference_upload_sessions_reference_expiry_cleanup_idx
  on reference_upload_sessions (expires_at, id)
  where storage_path_prefix like '%/asset-library/references/%'
    and confirmed_at is null
    and cancelled_at is null;
