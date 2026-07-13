delete from publish_attempts pa
using publish_queue pq
where pa.publish_queue_id = pq.id
  and pq.channel = 'webflow';

delete from publish_queue
where channel = 'webflow';

delete from publish_slots
where channel = 'webflow';

delete from channel_outputs
where channel = 'webflow';

delete from channel_credentials cc
using brand_channels bc
where cc.brand_channel_id = bc.id
  and bc.channel = 'webflow';

delete from brand_channels
where channel = 'webflow';

drop table if exists webflow_mappings;

alter table if exists channel_connection_requests
  drop column if exists webflow_site_url;

alter table brand_channels
  drop constraint if exists brand_channels_channel_check;
alter table brand_channels
  add constraint brand_channels_channel_check check (channel in ('instagram', 'threads'));

alter table channel_credentials
  drop constraint if exists channel_credentials_provider_check;
alter table channel_credentials
  add constraint channel_credentials_provider_check check (provider in ('meta'));

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
      'instagram_render',
      'artifact_upload',
      'instagram_publish',
      'threads_publish',
      'token_health_check',
      'storage_cleanup'
    )
  );

alter table channel_outputs
  drop constraint if exists channel_outputs_channel_check;
alter table channel_outputs
  add constraint channel_outputs_channel_check check (channel in ('instagram', 'threads'));

alter table publish_slots
  drop constraint if exists publish_slots_channel_check;
alter table publish_slots
  add constraint publish_slots_channel_check check (channel in ('instagram', 'threads'));

alter table publish_queue
  drop constraint if exists publish_queue_channel_check;
alter table publish_queue
  add constraint publish_queue_channel_check check (channel in ('instagram', 'threads'));
