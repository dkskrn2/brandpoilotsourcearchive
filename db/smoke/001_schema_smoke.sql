do $$
declare
  expected_tables text[] := array[
    'app_users',
    'workspaces',
    'workspace_members',
    'brands',
    'brand_profiles',
    'storage_artifacts',
    'source_urls',
    'source_content_items',
    'source_snapshots',
    'topic_uploads',
    'topic_rows',
    'brand_channels',
    'channel_credentials',
    'jobs',
    'content_topics',
    'master_drafts',
    'channel_outputs',
    'auto_approval_checks',
    'llm_runs',
    'review_events',
    'regeneration_requests',
    'publish_slots',
    'publish_queue',
    'publish_attempts',
    'support_requests',
    'audit_events',
    'source_crawl_runs'
  ];
  expected_table text;
  missing_table_count int;
  expected_indexes text[] := array[
    'brands_workspace_name_active_unique',
    'source_urls_brand_type_hash_active_unique',
    'source_content_items_brand_url_hash_active_unique',
    'content_topics_source_url_content_hash_active_unique',
    'topic_rows_brand_topic_key_active_unique',
    'brand_channels_brand_channel_active_unique',
    'channel_credentials_one_unrevoked_per_channel_unique',
    'channel_outputs_current_master_channel_unique',
    'publish_queue_idempotency_key_unique',
    'source_crawl_runs_run_key_unique',
    'source_crawl_runs_one_running_per_source_unique',
    'source_crawl_runs_retry_due_idx'
  ];
  index_name text;
  missing_index_count int;
  expected_constraints text[] := array[
    'brand_profiles_brand_id_fkey',
    'source_content_items_source_url_id_fkey',
    'source_snapshots_source_url_id_fkey',
    'topic_rows_topic_upload_id_fkey',
    'channel_outputs_master_draft_id_fkey',
    'publish_attempts_publish_queue_id_fkey',
    'support_requests_brand_id_fkey',
    'channel_outputs_status_check',
    'jobs_status_check',
    'publish_queue_status_check',
    'support_requests_status_check'
  ];
  constraint_name text;
  missing_constraint_count int;
begin
  foreach expected_table in array expected_tables loop
    select count(*)
    into missing_table_count
    from information_schema.tables
    where table_schema = 'public'
      and information_schema.tables.table_name = expected_table;

    if missing_table_count = 0 then
      raise exception 'Missing expected table: %', expected_table;
    end if;
  end loop;

  foreach index_name in array expected_indexes loop
    select count(*)
    into missing_index_count
    from pg_indexes
    where schemaname = 'public'
      and indexname = index_name;

    if missing_index_count = 0 then
      raise exception 'Missing expected index: %', index_name;
    end if;
  end loop;

  foreach constraint_name in array expected_constraints loop
    select count(*)
    into missing_constraint_count
    from pg_constraint
    where conname = constraint_name;

    if missing_constraint_count = 0 then
      raise exception 'Missing expected constraint: %', constraint_name;
    end if;
  end loop;
end;
$$;

select count(*) as table_count
from information_schema.tables
where table_schema = 'public'
  and table_type = 'BASE TABLE';

select count(*) as trigger_count
from information_schema.triggers
where trigger_schema = 'public'
  and trigger_name like '%_set_updated_at';

select 'schema smoke check passed' as result;
