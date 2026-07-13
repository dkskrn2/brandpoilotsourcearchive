alter table channel_outputs
  add column if not exists delivery_format text null;

alter table channel_outputs
  drop constraint if exists channel_outputs_delivery_format_check;

update channel_outputs
set delivery_format = 'instagram_feed_carousel'
where channel = 'instagram'
  and delivery_format is null;

update channel_outputs
set delivery_format = 'threads_text'
where channel = 'threads'
  and delivery_format is null;

update channel_outputs
set delivery_format = 'tiktok_video'
where channel = 'tiktok'
  and delivery_format is null;

update channel_outputs
set delivery_format = 'youtube_video'
where channel = 'youtube'
  and delivery_format is null;

update channel_outputs
set delivery_format = 'x_post'
where channel = 'x'
  and delivery_format is null;

alter table channel_outputs
  alter column delivery_format set not null;

alter table channel_outputs
  add constraint channel_outputs_delivery_format_check check (
    delivery_format in (
      'instagram_feed_carousel',
      'instagram_story',
      'instagram_reel',
      'threads_text',
      'tiktok_video',
      'youtube_video',
      'x_post'
    )
  );
