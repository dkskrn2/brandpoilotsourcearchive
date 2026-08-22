begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table publish_calendar_slots
  add column idempotency_key text null;

alter table publish_calendar_slots
  add constraint publish_calendar_slots_idempotency_key_check
  check (
    idempotency_key is null
    or (char_length(idempotency_key) between 1 and 200 and idempotency_key = btrim(idempotency_key))
  );

create unique index publish_calendar_slots_brand_idempotency_unique
  on publish_calendar_slots(brand_id,idempotency_key)
  where idempotency_key is not null;

create unique index publish_calendar_slots_generation_output_unique
  on publish_calendar_slots(brand_id,generation_output_id)
  where generation_output_id is not null and status <> 'cancelled';

commit;
