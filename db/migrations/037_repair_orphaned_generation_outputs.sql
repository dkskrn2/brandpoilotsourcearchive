with generation_repairs as (
  select co.id,
         case
           when co.channel not in ('instagram', 'threads') then 'generation_adapter_not_configured'
           else 'generation_job_unavailable'
         end as failure_code
  from channel_outputs co
  where co.status in ('generating', 'regenerating')
    and (
      co.channel not in ('instagram', 'threads')
      or not exists (
        select 1
        from jobs active_job
        where active_job.channel_output_id = co.id
          and active_job.status in ('queued', 'running')
      )
      or exists (
        select 1
        from jobs terminal_job
        where terminal_job.channel_output_id = co.id
          and terminal_job.status in ('failed', 'cancelled')
          and not exists (
            select 1
            from jobs newer_job
            where newer_job.channel_output_id = co.id
              and newer_job.created_at > terminal_job.created_at
          )
      )
    )
)
update channel_outputs co
set status = 'generation_failed',
    output_json = jsonb_set(
      jsonb_set(coalesce(co.output_json, '{}'::jsonb), '{generationState}', '"failed"'::jsonb, true),
      '{generationError}',
      jsonb_build_object(
        'code', repairs.failure_code,
        'message', '콘텐츠 생성 작업을 계속할 수 없습니다.',
        'failedAt', now()
      ),
      true
    ),
    block_reasons = case
      when coalesce(co.block_reasons, '[]'::jsonb) ? repairs.failure_code
        then coalesce(co.block_reasons, '[]'::jsonb)
      else coalesce(co.block_reasons, '[]'::jsonb) || jsonb_build_array(repairs.failure_code)
    end,
    updated_at = now()
from generation_repairs repairs
where co.id = repairs.id;
