delete from content_performance_snapshots
where channel = 'webflow';

delete from performance_sync_runs
where channel = 'webflow';

delete from publish_attempts pa
using publish_queue pq
where pa.publish_queue_id = pq.id
  and pq.channel = 'webflow';

delete from publish_queue
where channel = 'webflow';

delete from publish_slots
where channel = 'webflow';

delete from jobs
where channel_output_id in (
  select id
  from channel_outputs
  where channel = 'webflow'
);

delete from review_events
where channel_output_id in (
  select id
  from channel_outputs
  where channel = 'webflow'
);

delete from channel_outputs
where channel = 'webflow';

delete from channel_credentials cc
using brand_channels bc
where cc.brand_channel_id = bc.id
  and bc.channel = 'webflow';

delete from brand_channels
where channel = 'webflow';

alter table brand_channels
  drop constraint if exists brand_channels_channel_check;
alter table brand_channels
  add constraint brand_channels_channel_check
  check (channel in ('instagram', 'threads', 'x', 'linkedin', 'youtube', 'tiktok'));

alter table channel_outputs
  drop constraint if exists channel_outputs_channel_check;
alter table channel_outputs
  add constraint channel_outputs_channel_check
  check (channel in ('instagram', 'threads', 'x', 'linkedin', 'youtube', 'tiktok'));

alter table publish_slots
  drop constraint if exists publish_slots_channel_check;
alter table publish_slots
  add constraint publish_slots_channel_check
  check (channel in ('instagram', 'threads', 'x', 'linkedin', 'youtube', 'tiktok'));

alter table publish_queue
  drop constraint if exists publish_queue_channel_check;
alter table publish_queue
  add constraint publish_queue_channel_check
  check (channel in ('instagram', 'threads', 'x', 'linkedin', 'youtube', 'tiktok'));

alter table content_performance_snapshots
  drop constraint if exists content_performance_snapshots_channel_check;
alter table content_performance_snapshots
  add constraint content_performance_snapshots_channel_check
  check (channel in ('instagram', 'threads', 'x', 'linkedin', 'youtube', 'tiktok'));

alter table performance_sync_runs
  drop constraint if exists performance_sync_runs_channel_check;
alter table performance_sync_runs
  add constraint performance_sync_runs_channel_check
  check (channel in ('instagram', 'threads', 'x', 'linkedin', 'youtube', 'tiktok'));

alter table channel_credentials
  drop constraint if exists channel_credentials_provider_check;
alter table channel_credentials
  add constraint channel_credentials_provider_check
  check (provider in ('meta', 'x', 'linkedin', 'google', 'tiktok'));

alter table channel_outputs
  drop constraint if exists channel_outputs_delivery_format_check;
alter table channel_outputs
  add constraint channel_outputs_delivery_format_check check (
    delivery_format in (
      'instagram_feed_carousel',
      'instagram_story',
      'instagram_reel',
      'threads_text',
      'tiktok_video',
      'youtube_video',
      'youtube_short',
      'x_post',
      'linkedin_post'
    )
  );

alter table channel_outputs
  drop constraint if exists channel_outputs_status_check;

update channel_outputs
set status = 'generating',
    block_reasons = coalesce((
      select jsonb_agg(reason order by position)
      from jsonb_array_elements_text(channel_outputs.block_reasons)
        with ordinality as reasons(reason, position)
      where right(reason, 8) <> '_pending'
    ), '[]'::jsonb),
    updated_at = now()
where status = 'auto_approval_blocked'
  and (
    output_json ->> 'generationState' = 'pending'
    or output_json ->> 'artifactStatus' = 'pending'
    or exists (
      select 1
      from jsonb_array_elements_text(channel_outputs.block_reasons)
        as reasons(reason)
      where right(reason, 8) = '_pending'
    )
  );

alter table channel_outputs
  alter column status set default 'generating';
alter table channel_outputs
  add constraint channel_outputs_status_check check (
    status in (
      'generating',
      'generation_failed',
      'pending_review',
      'approved',
      'auto_approved',
      'auto_approval_blocked',
      'rejected',
      'regenerating',
      'regenerated'
    )
  );
