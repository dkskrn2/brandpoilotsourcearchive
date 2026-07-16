with exhausted_jobs as (
  update jobs
  set status = 'failed',
      finished_at = coalesce(finished_at, now()),
      locked_by = null,
      locked_until = null,
      lease_token = null,
      last_error = coalesce(last_error, 'generation_attempts_exhausted'),
      updated_at = now()
  where job_type in ('instagram_feed_render', 'instagram_story_render', 'instagram_reel_render', 'threads_text_render')
    and status = 'running'
    and locked_until < now()
    and attempt_count >= max_attempts
  returning channel_output_id
)
update channel_outputs co
set status = 'generation_failed',
    output_json = jsonb_set(
      jsonb_set(coalesce(co.output_json, '{}'::jsonb), '{generationState}', '"failed"'::jsonb, true),
      '{generationError}',
      jsonb_build_object(
        'code', 'generation_attempts_exhausted',
        'message', '콘텐츠 생성 재시도 횟수를 초과했습니다.',
        'failedAt', now()
      ),
      true
    ),
    block_reasons = case
      when coalesce(co.block_reasons, '[]'::jsonb) ? 'generation_attempts_exhausted'
        then coalesce(co.block_reasons, '[]'::jsonb)
      else coalesce(co.block_reasons, '[]'::jsonb) || jsonb_build_array('generation_attempts_exhausted')
    end,
    updated_at = now()
where co.id in (select channel_output_id from exhausted_jobs)
  and co.status in ('generating', 'regenerating');
