begin;

alter table support_requests
  add column if not exists response_message text null,
  add column if not exists responded_at timestamptz null;

alter table support_requests
  drop constraint if exists support_requests_response_not_blank;

alter table support_requests
  add constraint support_requests_response_not_blank
  check (response_message is null or length(trim(response_message)) > 0);

commit;
