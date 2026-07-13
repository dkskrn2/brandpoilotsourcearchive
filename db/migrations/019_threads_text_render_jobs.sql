begin;

alter table jobs
  drop constraint if exists jobs_type_check;

alter table jobs
  add constraint jobs_type_check check (
    job_type in (
      'daily_generation_enqueue',
      'source_crawl',
      'topic_select',
      'master_draft_generate',
      'channel_output_generate',
      'auto_approval_check',
      'instagram_feed_render',
      'instagram_story_render',
      'instagram_reel_render',
      'threads_text_render',
      'artifact_upload',
      'instagram_publish',
      'threads_publish',
      'token_health_check',
      'storage_cleanup'
    )
  );

create index if not exists jobs_threads_text_render_output_idx
  on jobs(channel_output_id, created_at desc)
  where job_type = 'threads_text_render';

create unique index if not exists jobs_active_threads_text_render_output_unique
  on jobs(channel_output_id)
  where job_type = 'threads_text_render'
    and status in ('queued', 'running');

commit;
