begin;

alter table channel_credentials
  add column if not exists auth_mode text not null default 'facebook_login';

alter table channel_credentials
  drop constraint if exists channel_credentials_auth_mode_check;
alter table channel_credentials
  add constraint channel_credentials_auth_mode_check
  check (auth_mode in ('facebook_login', 'instagram_login'));

commit;
