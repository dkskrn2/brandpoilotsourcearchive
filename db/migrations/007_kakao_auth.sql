alter table app_users alter column email drop not null;
alter table app_users drop constraint if exists app_users_email_unique;
create unique index if not exists app_users_email_active_unique
  on app_users (lower(email))
  where email is not null and deleted_at is null;

create table user_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  provider text not null,
  provider_subject text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_identities_provider_subject_unique unique (provider, provider_subject),
  constraint user_identities_provider_check check (provider in ('kakao'))
);

create table user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz null
);

create index user_sessions_active_token_idx
  on user_sessions(token_hash, expires_at)
  where revoked_at is null;

create trigger user_identities_set_updated_at before update on user_identities for each row execute function set_updated_at();
