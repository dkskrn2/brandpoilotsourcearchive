begin;

lock table brand_analysis_runs in share row exclusive mode;

with ranked as (
  select id,
         row_number() over (
           partition by brand_id
           order by created_at desc, id desc
         ) as position
    from brand_analysis_runs
   where status in ('queued', 'extracting', 'analyzing', 'review_ready')
)
update brand_analysis_runs run
   set status = 'failed',
       error_code = 'brand_analysis_superseded',
       error_message = 'A newer open brand analysis was preserved.',
       leased_by = null,
       lease_token = null,
       lease_expires_at = null,
       completed_at = coalesce(run.completed_at, now()),
       updated_at = now()
  from ranked
 where run.id = ranked.id
   and ranked.position > 1;

create unique index brand_analysis_runs_one_open_per_brand_uq
  on brand_analysis_runs (brand_id)
  where status in ('queued', 'extracting', 'analyzing', 'review_ready');

commit;
