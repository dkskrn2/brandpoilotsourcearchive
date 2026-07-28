-- Avatar upload cancellation receipts and exact blob identity.
-- Depends on: 058_avatar_and_reference_libraries.sql and
-- 061_avatar_image_checksum_uniqueness.sql. Migrations 059/060 remain reserved.

alter table reference_upload_sessions
  add column if not exists file_name text null,
  add column if not exists storage_path text null;

create table if not exists avatar_upload_cancellation_receipts (
  session_id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  avatar_id uuid not null,
  created_by_user_id uuid not null,
  storage_path text not null,
  reason text not null check (reason in ('user', 'expired')),
  cancelled_at timestamptz not null default now(),
  constraint avatar_upload_cancellation_receipts_brand_fk
    foreign key (brand_id, workspace_id)
    references brands(id, workspace_id) on delete cascade,
  constraint avatar_upload_cancellation_receipts_actor_fk
    foreign key (workspace_id, created_by_user_id)
    references workspace_members(workspace_id, user_id) on delete restrict
);

create index if not exists reference_upload_sessions_avatar_expiry_cleanup_idx
  on reference_upload_sessions (expires_at, id)
  where storage_path_prefix like '%/asset-library/avatars/%';
