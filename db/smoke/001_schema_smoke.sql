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
    'source_crawl_runs',
    'content_categories',
    'content_subcategories',
    'content_category_hashtags',
    'brand_profile_subcategories',
    'instagram_trend_hashtags',
    'instagram_trend_media',
    'instagram_trend_hashtag_media',
    'brand_trend_searches',
    'instagram_trend_account_hashtags',
    'brand_trend_saved_media',
    'content_performance_snapshots',
    'performance_sync_runs'
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
    'source_crawl_runs_retry_due_idx',
    'content_category_hashtags_unique',
    'brand_profile_subcategories_system_unique',
    'brand_profile_subcategories_custom_unique',
    'brand_profile_subcategories_brand_idx',
    'brand_trend_searches_brand_searched_idx',
    'instagram_trend_account_hashtags_channel_quota_idx',
    'brand_trend_saved_media_brand_idx',
    'content_performance_brand_channel_date_idx'
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
    'brand_channels_channel_check',
    'channel_outputs_channel_check',
    'channel_outputs_delivery_format_check',
    'publish_slots_channel_check',
    'publish_queue_channel_check',
    'jobs_status_check',
    'publish_queue_status_check',
    'support_requests_status_check',
    'brands_tenant_identity_unique',
    'brand_profiles_tenant_identity_unique',
    'brand_channels_tenant_identity_unique',
    'source_urls_tenant_identity_unique',
    'brand_profiles_primary_category_id_fkey',
    'content_categories_code_key',
    'content_subcategories_category_id_code_key',
    'brand_profile_subcategories_mode_check',
    'brand_profile_subcategories_custom_name_check',
    'brand_profile_subcategories_profile_owner_fkey',
    'instagram_trend_media_media_type_check',
    'instagram_trend_media_like_count_check',
    'instagram_trend_media_comments_count_check',
    'instagram_trend_media_raw_metadata_object_check',
    'instagram_trend_hashtags_normalized_tag_key',
    'instagram_trend_media_instagram_media_id_key',
    'instagram_trend_hashtag_media_pkey',
    'instagram_trend_hashtag_media_hashtag_id_meta_rank_key',
    'instagram_trend_hashtag_media_meta_rank_check',
    'brand_trend_searches_brand_id_hashtag_id_key',
    'brand_trend_searches_search_count_check',
    'brand_trend_searches_brand_owner_fkey',
    'instagram_trend_account_hashtags_channel_hashtag_unique',
    'instagram_trend_account_hashtags_channel_owner_fkey',
    'brand_trend_saved_media_brand_id_trend_media_id_key',
    'brand_trend_saved_media_source_url_id_key',
    'brand_trend_saved_media_source_owner_fkey',
    'content_performance_snapshots_channel_check',
    'content_performance_snapshots_exposure_count_check',
    'content_performance_snapshots_raw_metrics_object_check',
    'performance_sync_runs_channel_check',
    'performance_sync_runs_status_check',
    'performance_sync_runs_counts_check',
    'channel_outputs_performance_identity_unique',
    'publish_queue_performance_identity_unique',
    'content_performance_snapshots_publish_queue_owner_fkey',
    'content_performance_snapshots_channel_output_owner_fkey'
  ];
  constraint_name text;
  missing_constraint_count int;
  invalid_multichannel_constraint_count int;
  missing_performance_unique_count int;
  invalid_performance_index_count int;
  invalid_performance_count_check int;
  missing_column_count int;
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

  select count(*)
  into invalid_multichannel_constraint_count
  from pg_constraint
  where conname in (
      'brand_channels_channel_check',
      'channel_outputs_channel_check',
      'publish_slots_channel_check',
      'publish_queue_channel_check'
    )
    and pg_get_constraintdef(oid) like '%linkedin%';

  if invalid_multichannel_constraint_count != 4 then
    raise exception 'Channel constraints do not all include linkedin';
  end if;

  select count(*)
  into invalid_multichannel_constraint_count
  from pg_constraint
  where conname = 'channel_outputs_delivery_format_check'
    and pg_get_constraintdef(oid) like '%linkedin_post%'
    and pg_get_constraintdef(oid) like '%youtube_short%';

  if invalid_multichannel_constraint_count != 1 then
    raise exception 'Delivery format constraint is missing multichannel formats';
  end if;

  select count(*)
  into missing_performance_unique_count
  from pg_constraint
  where conrelid = 'content_performance_snapshots'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) = 'UNIQUE (publish_queue_id, snapshot_date)';

  if missing_performance_unique_count != 1 then
    raise exception 'Missing content performance snapshot uniqueness contract';
  end if;

  select count(*)
  into missing_performance_unique_count
  from pg_constraint
  where conrelid = 'performance_sync_runs'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) = 'UNIQUE (brand_id, channel, run_date)';

  if missing_performance_unique_count != 1 then
    raise exception 'Missing performance sync run uniqueness contract';
  end if;

  select count(*)
  into missing_column_count
  from (
    values
      ('content_performance_snapshots', 'id', 'NO'),
      ('content_performance_snapshots', 'workspace_id', 'NO'),
      ('content_performance_snapshots', 'brand_id', 'NO'),
      ('content_performance_snapshots', 'channel', 'NO'),
      ('content_performance_snapshots', 'publish_queue_id', 'NO'),
      ('content_performance_snapshots', 'channel_output_id', 'NO'),
      ('content_performance_snapshots', 'external_post_id', 'NO'),
      ('content_performance_snapshots', 'snapshot_date', 'NO'),
      ('content_performance_snapshots', 'exposure_count', 'YES'),
      ('content_performance_snapshots', 'raw_metrics', 'NO'),
      ('content_performance_snapshots', 'collected_at', 'NO'),
      ('content_performance_snapshots', 'created_at', 'NO'),
      ('content_performance_snapshots', 'updated_at', 'NO'),
      ('performance_sync_runs', 'id', 'NO'),
      ('performance_sync_runs', 'workspace_id', 'NO'),
      ('performance_sync_runs', 'brand_id', 'NO'),
      ('performance_sync_runs', 'channel', 'NO'),
      ('performance_sync_runs', 'run_date', 'NO'),
      ('performance_sync_runs', 'status', 'NO'),
      ('performance_sync_runs', 'target_count', 'NO'),
      ('performance_sync_runs', 'success_count', 'NO'),
      ('performance_sync_runs', 'failure_count', 'NO'),
      ('performance_sync_runs', 'error_summary', 'YES'),
      ('performance_sync_runs', 'started_at', 'NO'),
      ('performance_sync_runs', 'completed_at', 'YES'),
      ('performance_sync_runs', 'created_at', 'NO'),
      ('performance_sync_runs', 'updated_at', 'NO')
  ) as expected(table_name, column_name, is_nullable)
  left join information_schema.columns actual
    on actual.table_schema = 'public'
   and actual.table_name = expected.table_name
   and actual.column_name = expected.column_name
  where actual.column_name is null
     or actual.is_nullable != expected.is_nullable;

  if missing_column_count != 0 then
    raise exception 'Content performance columns or nullability do not match contract';
  end if;

  select count(*)
  into invalid_performance_index_count
  from (
    select array_agg(attribute.attname::text order by key.ordinality) as columns
    from pg_class index_class
    join pg_index index_data on index_data.indexrelid = index_class.oid
    cross join lateral unnest(index_data.indkey) with ordinality as key(attnum, ordinality)
    join pg_attribute attribute
      on attribute.attrelid = index_data.indrelid
     and attribute.attnum = key.attnum
    where index_class.relname = 'content_performance_brand_channel_date_idx'
    group by index_class.oid
  ) index_contract
  where columns = array['brand_id', 'channel', 'snapshot_date']::text[];

  if invalid_performance_index_count != 1 then
    raise exception 'Content performance index columns do not match contract';
  end if;

  select count(*)
  into invalid_performance_count_check
  from pg_constraint
  where conname = 'performance_sync_runs_counts_check'
    and pg_get_constraintdef(oid) ~ 'success_count.*\+.*failure_count.*<=.*target_count';

  if invalid_performance_count_check != 1 then
    raise exception 'Performance sync counts can exceed target count';
  end if;

  select count(*)
  into missing_column_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'brand_profiles'
    and column_name = 'primary_category_id';

  if missing_column_count = 0 then
    raise exception 'Missing expected column: brand_profiles.primary_category_id';
  end if;
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

begin;

do $$
declare
  runtime_workspace_id uuid;
  runtime_brand_id uuid;
  runtime_generation_id uuid;
  runtime_output_id uuid;
begin
  if to_regclass('public.ai_content_generations') is null then
    return;
  end if;

  insert into workspaces (name, slug)
  values ('AI content schema smoke', 'ai-content-smoke-' || gen_random_uuid()::text)
  returning id into runtime_workspace_id;

  insert into brands (workspace_id, name)
  values (runtime_workspace_id, 'AI content schema smoke brand')
  returning id into runtime_brand_id;

  insert into ai_content_generations
    (workspace_id, brand_id, type, title, status, analysis_idempotency_key)
  values
    (runtime_workspace_id, runtime_brand_id, 'card_news', 'Smoke generation',
     'queued', 'smoke-analysis')
  returning id into runtime_generation_id;

  insert into ai_content_generation_outputs
    (workspace_id, brand_id, generation_id, output_index, title, status)
  values
    (runtime_workspace_id, runtime_brand_id, runtime_generation_id, 1,
     'Smoke output', 'queued')
  returning id into runtime_output_id;

  insert into ai_content_generation_jobs
    (workspace_id, brand_id, generation_id, output_id, job_type, content_type,
     status)
  values
    (runtime_workspace_id, runtime_brand_id, runtime_generation_id,
     runtime_output_id, 'generate', 'card_news', 'queued');

  insert into ai_content_usage_ledger
    (workspace_id, brand_id, generation_id, output_id, usage_type, quantity,
     usage_date, idempotency_key)
  values
    (runtime_workspace_id, runtime_brand_id, runtime_generation_id,
     runtime_output_id, 'generation', 1, current_date, 'smoke-usage');

  if not exists (
    select 1
    from ai_content_generation_jobs jobs
    join ai_content_generation_outputs outputs
      on outputs.id = jobs.output_id
     and outputs.generation_id = jobs.generation_id
     and outputs.workspace_id = jobs.workspace_id
     and outputs.brand_id = jobs.brand_id
    join ai_content_usage_ledger usage
      on usage.output_id = outputs.id
     and usage.generation_id = outputs.generation_id
     and usage.workspace_id = outputs.workspace_id
     and usage.brand_id = outputs.brand_id
    where jobs.generation_id = runtime_generation_id
  ) then
    raise exception 'AI content generation ownership chain failed';
  end if;

  begin
    insert into ai_content_usage_ledger
      (workspace_id, brand_id, generation_id, output_id, usage_type, quantity,
       usage_date, idempotency_key)
    values
      (runtime_workspace_id, runtime_brand_id, runtime_generation_id,
       runtime_output_id, 'preview', 1, current_date, 'invalid-smoke-usage');
    raise exception 'Invalid AI content usage_type was accepted';
  exception
    when check_violation then null;
  end;
end;
$$;

rollback;

begin;

do $$
declare
  subject_workspace_id uuid;
  subject_brand_id uuid;
  subject_analysis_id uuid;
  subject_image_id uuid;
begin
  if to_regclass('public.ai_content_subject_analyses') is null then
    return;
  end if;

  if to_regclass('public.ai_content_subject_images') is null then
    raise exception 'Missing expected table: ai_content_subject_images';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'ai_content_subject_active_cache_uq',
        'ai_content_subject_claim_idx'
      )
    group by schemaname
    having count(*) = 2
  ) then
    raise exception 'Missing subject analysis cache or claim index';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_content_generations'
      and column_name = 'subject_analysis_snapshot'
      and data_type = 'jsonb'
  ) then
    raise exception 'Missing ai_content_generations.subject_analysis_snapshot';
  end if;

  insert into workspaces (name, slug)
  values (
    'Subject analysis schema smoke',
    'subject-analysis-smoke-' || gen_random_uuid()::text
  )
  returning id into subject_workspace_id;

  insert into brands (workspace_id, name)
  values (subject_workspace_id, 'Subject analysis schema smoke brand')
  returning id into subject_brand_id;

  insert into ai_content_subject_analyses
    (workspace_id, brand_id, subject_type, source_url, normalized_url, status,
     idempotency_key)
  values
    (subject_workspace_id, subject_brand_id, 'product',
     'https://example.com/product?utm_source=smoke',
     'https://example.com/product', 'queued', 'subject-analysis-smoke')
  returning id into subject_analysis_id;

  insert into ai_content_subject_images
    (analysis_id, workspace_id, brand_id, source_url, storage_url, storage_path,
     width, height, mime_type, role)
  values
    (subject_analysis_id, subject_workspace_id, subject_brand_id,
     'https://cdn.example.com/product.jpg',
     'https://storage.example.com/product.jpg',
     'subject-analysis/smoke-product.jpg', 1200, 1200, 'image/jpeg',
     'product')
  returning id into subject_image_id;

  update ai_content_subject_analyses
  set selected_image_id = subject_image_id
  where id = subject_analysis_id;

  if not exists (
    select 1
    from ai_content_subject_analyses analyses
    join ai_content_subject_images images
      on images.id = analyses.selected_image_id
     and images.analysis_id = analyses.id
     and images.workspace_id = analyses.workspace_id
     and images.brand_id = analyses.brand_id
    where analyses.id = subject_analysis_id
  ) then
    raise exception 'Subject analysis image ownership chain failed';
  end if;
end;
$$;

rollback;

begin;

do $$
declare
  intelligence_workspace_id uuid;
  intelligence_brand_id uuid;
  intelligence_run_id uuid;
begin
  if to_regclass('public.brand_analysis_runs') is null
    or to_regclass('public.brand_analysis_uploads') is null then
    return;
  end if;

  insert into workspaces (name, slug)
  values ('Brand intelligence smoke', 'brand-intelligence-smoke-' || gen_random_uuid()::text)
  returning id into intelligence_workspace_id;

  insert into brands (workspace_id, name)
  values (intelligence_workspace_id, 'Brand intelligence smoke brand')
  returning id into intelligence_brand_id;

  insert into brand_analysis_runs
    (workspace_id, brand_id, status, input_json, evidence_json, result_json,
     edited_result_json, idempotency_key, is_active, confirmed_at)
  values
    (intelligence_workspace_id, intelligence_brand_id, 'confirmed', '{}'::jsonb,
     '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, 'smoke-analysis', true, now())
  returning id into intelligence_run_id;

  insert into brand_profiles (workspace_id, brand_id, active_brand_analysis_id)
  values (intelligence_workspace_id, intelligence_brand_id, intelligence_run_id);

  if not exists (
    select 1
    from brand_profiles profiles
    join brand_analysis_runs runs
      on runs.id = profiles.active_brand_analysis_id
     and runs.workspace_id = profiles.workspace_id
     and runs.brand_id = profiles.brand_id
    where profiles.brand_id = intelligence_brand_id
      and runs.is_active
  ) then
    raise exception 'Brand intelligence active version ownership chain failed';
  end if;
end;
$$;

rollback;

select 'schema smoke check passed' as result;

begin;

do $$
declare
  pipeline_workspace_id uuid;
  pipeline_brand_id uuid;
  pipeline_generation_id uuid;
  pipeline_analysis_id uuid;
  pipeline_column_count integer;
  pipeline_index_count integer;
begin
  select count(*)
  into pipeline_column_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'ai_content_subject_analyses'
    and column_name in (
      'generation_id',
      'contract_version',
      'attachment_ids_json',
      'analysis_result_json'
    );

  if pipeline_column_count != 4 then
    raise exception 'Missing subject pipeline v2 columns';
  end if;

  if to_regclass('public.ai_content_subject_appeal_regeneration_keys') is null then
    raise exception 'Missing subject appeal regeneration key ledger';
  end if;

  select count(*)
  into pipeline_index_count
  from pg_indexes
  where schemaname = 'public'
    and indexname in (
      'ai_content_subject_legacy_active_cache_uq',
      'ai_content_subject_generation_active_uq',
      'ai_content_subject_generation_idx'
    );

  if pipeline_index_count != 3 then
    raise exception 'Missing subject pipeline v2 indexes';
  end if;

  insert into workspaces (name, slug)
  values (
    'Subject pipeline v2 smoke',
    'subject-pipeline-v2-smoke-' || gen_random_uuid()::text
  )
  returning id into pipeline_workspace_id;

  insert into brands (workspace_id, name)
  values (pipeline_workspace_id, 'Subject pipeline v2 smoke brand')
  returning id into pipeline_brand_id;

  insert into ai_content_generations
    (workspace_id, brand_id, type, title, status, analysis_idempotency_key)
  values
    (pipeline_workspace_id, pipeline_brand_id, 'card_news',
     'Subject pipeline v2 smoke generation', 'draft',
     'subject-pipeline-v2-smoke')
  returning id into pipeline_generation_id;

  insert into ai_content_subject_analyses
    (workspace_id, brand_id, generation_id, contract_version, subject_type,
     source_url, normalized_url, attachment_ids_json, analysis_result_json,
     status, idempotency_key)
  values
    (pipeline_workspace_id, pipeline_brand_id, pipeline_generation_id,
     'subject-analysis.v2', 'product', null, null,
     jsonb_build_array(gen_random_uuid()), '{}'::jsonb, 'analyzing',
     'subject-pipeline-v2-smoke')
  returning id into pipeline_analysis_id;

  insert into ai_content_subject_appeal_regeneration_keys
    (analysis_id, idempotency_key)
  values
    (pipeline_analysis_id, 'subject-pipeline-v2-regenerate');

  begin
    insert into ai_content_subject_appeal_regeneration_keys
      (analysis_id, idempotency_key)
    values
      (pipeline_analysis_id, 'subject-pipeline-v2-regenerate');
    raise exception 'Duplicate subject appeal regeneration key was accepted';
  exception
    when unique_violation then null;
  end;

  begin
    insert into ai_content_subject_analyses
      (workspace_id, brand_id, generation_id, contract_version, subject_type,
       source_url, normalized_url, status, idempotency_key)
    values
      (pipeline_workspace_id, pipeline_brand_id, pipeline_generation_id,
       'subject-analysis.v2', 'product', null, null, 'queued',
       'subject-pipeline-v2-smoke-duplicate');
    raise exception 'Duplicate active generation subject pipeline was accepted';
  exception
    when unique_violation then null;
  end;

  delete from ai_content_generations
  where id = pipeline_generation_id;

  if exists (
    select 1
    from ai_content_subject_analyses
    where id = pipeline_analysis_id
  ) then
    raise exception 'Subject pipeline generation cascade failed';
  end if;

  if exists (
    select 1
    from ai_content_subject_appeal_regeneration_keys
    where analysis_id = pipeline_analysis_id
  ) then
    raise exception 'Subject appeal regeneration key cascade failed';
  end if;
end;
$$;

rollback;

select 'subject pipeline v2 smoke check passed' as result;
