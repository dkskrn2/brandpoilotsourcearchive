create unique index source_urls_brand_owned_single_active_unique
  on source_urls (brand_id)
  where source_type = 'owned' and deleted_at is null;
