-- Two-phase avatar upload cancellation and fair expiry finalization.
-- Depends on: 062_avatar_upload_cancellation.sql.

alter table reference_upload_sessions
  add column if not exists cancelled_at timestamptz null;

alter table avatar_upload_cancellation_receipts
  alter column storage_path drop not null,
  add column if not exists storage_path_prefix text null,
  add column if not exists token_expires_at timestamptz null,
  add column if not exists status text not null default 'pending',
  add column if not exists completed_at timestamptz null,
  add column if not exists next_attempt_at timestamptz null,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_error text null;

update avatar_upload_cancellation_receipts
set storage_path_prefix = regexp_replace(storage_path, '[^/]+$', ''),
    token_expires_at = cancelled_at + interval '10 minutes',
    next_attempt_at = cancelled_at + interval '11 minutes',
    status = 'pending'
where storage_path_prefix is null
   or token_expires_at is null
   or next_attempt_at is null;

alter table avatar_upload_cancellation_receipts
  alter column storage_path_prefix set not null,
  alter column token_expires_at set not null,
  alter column next_attempt_at set not null;

alter table avatar_upload_cancellation_receipts
  drop constraint if exists avatar_upload_cancellation_receipts_status_check,
  add constraint avatar_upload_cancellation_receipts_status_check
    check (status in ('pending', 'completed')),
  drop constraint if exists avatar_upload_cancellation_receipts_attempt_count_check,
  add constraint avatar_upload_cancellation_receipts_attempt_count_check
    check (attempt_count >= 0);

create index if not exists avatar_upload_cancellation_receipts_due_idx
  on avatar_upload_cancellation_receipts (next_attempt_at, token_expires_at, session_id)
  where status = 'pending';
