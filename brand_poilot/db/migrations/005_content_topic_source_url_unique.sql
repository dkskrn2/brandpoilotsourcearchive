create unique index if not exists content_topics_source_url_content_hash_active_unique
  on content_topics (
    brand_id,
    (source_context ->> 'sourceContentItemId'),
    (source_context ->> 'contentHash')
  )
  where source_context ->> 'source' = 'source_url'
    and source_context ? 'sourceContentItemId'
    and source_context ? 'contentHash'
    and status in ('selected', 'generating', 'generated');
