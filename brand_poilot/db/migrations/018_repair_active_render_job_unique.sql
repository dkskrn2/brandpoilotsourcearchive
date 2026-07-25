with ranked_active_jobs as (
  select id,
         row_number() over (
           partition by channel_output_id
           order by created_at desc, id desc
         ) as active_rank
  from jobs
  where job_type in (
    'instagram_feed_render',
    'instagram_story_render',
    'instagram_reel_render'
  )
    and status in ('queued', 'running')
)
update jobs
set status = 'failed',
    last_error = 'superseded_by_migration_018',
    locked_by = null,
    locked_until = null,
    lease_token = null,
    finished_at = now(),
    updated_at = now()
where id in (
  select id
  from ranked_active_jobs
  where active_rank > 1
);

drop index if exists jobs_active_render_output_unique;

create unique index jobs_active_render_output_unique
  on jobs(channel_output_id)
  where job_type in (
    'instagram_feed_render',
    'instagram_story_render',
    'instagram_reel_render'
  )
    and status in ('queued', 'running');
