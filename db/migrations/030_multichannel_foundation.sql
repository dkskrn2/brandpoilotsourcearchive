alter table brand_channels drop constraint if exists brand_channels_channel_check;
alter table brand_channels
  add constraint brand_channels_channel_check
  check (channel in ('instagram', 'threads', 'x', 'linkedin', 'youtube', 'tiktok', 'webflow'));

alter table channel_outputs drop constraint if exists channel_outputs_channel_check;
alter table channel_outputs
  add constraint channel_outputs_channel_check
  check (channel in ('instagram', 'threads', 'x', 'linkedin', 'youtube', 'tiktok', 'webflow'));

alter table publish_slots drop constraint if exists publish_slots_channel_check;
alter table publish_slots
  add constraint publish_slots_channel_check
  check (channel in ('instagram', 'threads', 'x', 'linkedin', 'youtube', 'tiktok', 'webflow'));

alter table publish_queue drop constraint if exists publish_queue_channel_check;
alter table publish_queue
  add constraint publish_queue_channel_check
  check (channel in ('instagram', 'threads', 'x', 'linkedin', 'youtube', 'tiktok', 'webflow'));

alter table channel_credentials drop constraint if exists channel_credentials_provider_check;
alter table channel_credentials
  add constraint channel_credentials_provider_check
  check (provider in ('meta', 'x', 'linkedin', 'google', 'tiktok', 'webflow'));

alter table channel_outputs drop constraint if exists channel_outputs_delivery_format_check;
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
      'linkedin_post',
      'webflow_article'
    )
  );

insert into brand_channels (workspace_id, brand_id, channel, status, account_label, enabled)
select b.workspace_id, b.id, catalog.channel, 'not_connected', '연결 전', catalog.enabled
from brands b
cross join (values
  ('instagram', true),
  ('threads', true),
  ('x', false),
  ('linkedin', false),
  ('youtube', false),
  ('tiktok', false),
  ('webflow', false)
) as catalog(channel, enabled)
where b.status = 'active'
  and b.deleted_at is null
on conflict (brand_id, channel) where deleted_at is null do nothing;
