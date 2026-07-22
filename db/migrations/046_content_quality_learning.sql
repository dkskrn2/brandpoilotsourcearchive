begin;

alter table instagram_trend_hashtag_media
  add column relevance_score numeric(4,3) not null default 1,
  add column relevance_status text not null default 'relevant',
  add column relevance_reason text null;

alter table instagram_trend_hashtag_media
  add constraint instagram_trend_hashtag_media_relevance_score_check
    check (relevance_score >= 0 and relevance_score <= 1),
  add constraint instagram_trend_hashtag_media_relevance_status_check
    check (relevance_status in ('relevant', 'filtered'));

create index instagram_trend_hashtag_media_relevant_idx
  on instagram_trend_hashtag_media (hashtag_id, meta_rank)
  where relevance_status = 'relevant';

alter table content_performance_snapshots
  add column measurement_window text null,
  add column content_features jsonb not null default '{}'::jsonb;

alter table content_performance_snapshots
  add constraint content_performance_snapshots_measurement_window_check
    check (measurement_window is null or measurement_window in ('24h', '72h', '7d')),
  add constraint content_performance_snapshots_content_features_object_check
    check (jsonb_typeof(content_features) = 'object');

create unique index content_performance_snapshot_milestone_unique
  on content_performance_snapshots (publish_queue_id, measurement_window)
  where measurement_window is not null;

commit;
