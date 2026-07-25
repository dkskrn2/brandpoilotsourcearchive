begin;

alter table dm_delivery_attempts
  add column origin text not null default 'auto';

alter table dm_delivery_attempts
  alter column job_id drop not null,
  add constraint dm_delivery_attempts_origin_check
    check (origin in ('auto', 'manual')),
  add constraint dm_delivery_attempts_origin_job_check
    check (
      (origin = 'auto' and job_id is not null)
      or (origin = 'manual' and job_id is null)
    );

commit;
