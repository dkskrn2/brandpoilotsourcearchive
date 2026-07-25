alter table support_requests
  add column if not exists contact_phone text null;

alter table support_requests
  drop constraint if exists support_requests_contact_phone_format;

alter table support_requests
  add constraint support_requests_contact_phone_format
  check (contact_phone is null or contact_phone ~ '^010-[0-9]{4}-[0-9]{4}$');
