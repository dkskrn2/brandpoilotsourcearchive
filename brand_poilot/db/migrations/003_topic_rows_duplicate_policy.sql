drop index if exists topic_rows_brand_topic_key_active_unique;

create unique index topic_rows_brand_topic_key_active_unique
  on topic_rows(brand_id, topic_key)
  where status in ('queued', 'used');
