begin;

drop index if exists uq_channel_outputs_ai_content_generation_output;
create unique index uq_channel_outputs_ai_content_generation_target
  on channel_outputs (ai_content_generation_output_id, channel, delivery_format)
  where ai_content_generation_output_id is not null;

drop index if exists channel_outputs_current_master_channel_unique;
create unique index channel_outputs_current_master_channel_format_unique
  on channel_outputs (master_draft_id, channel, delivery_format)
  where status != 'regenerated';

alter table channel_outputs
  drop constraint if exists channel_outputs_delivery_format_check;
alter table channel_outputs
  add constraint channel_outputs_delivery_format_check check (
    delivery_format in (
      'instagram_feed_single',
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

commit;
