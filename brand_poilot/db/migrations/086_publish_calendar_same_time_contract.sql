begin;

set local lock_timeout = '5s';

drop index publish_calendar_slots_active_brand_time_unique;

drop index publish_calendar_slots_generation_unique;

create unique index publish_calendar_slots_generation_unique
  on publish_calendar_slots(brand_id,generation_id)
  where generation_id is not null and generation_output_id is null and status <> 'cancelled';

commit;
