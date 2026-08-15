begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists meta_ad_library_ads (
  id uuid primary key default gen_random_uuid(),
  provider_ad_id text not null unique,
  page_id text null,
  page_name text null,
  creative_body text null,
  creative_title text null,
  creative_caption text null,
  creative_description text null,
  snapshot_url text null,
  publisher_platforms text[] not null default '{}',
  delivery_started_at timestamptz null,
  delivery_stopped_at timestamptz null,
  active_status text not null default 'ACTIVE'
    check (active_status in ('ACTIVE','INACTIVE','UNKNOWN')),
  reached_countries text[] not null default '{}',
  raw_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(raw_metadata) = 'object'),
  first_fetched_at timestamptz not null default now(),
  last_fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meta_ad_library_ads_page_idx
  on meta_ad_library_ads(page_id,last_fetched_at desc)
  where page_id is not null;

create table if not exists brand_meta_ad_searches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  mode text not null check (mode in ('keyword','page')),
  query_text text null,
  page_ids text[] not null default '{}',
  country text not null default 'KR' check (country ~ '^[A-Z]{2}$'),
  active_status text not null default 'ACTIVE' check (active_status = 'ACTIVE'),
  query_hash text not null,
  status text not null default 'pending'
    check (status in ('pending','fresh','stale','failed')),
  last_error_code text null,
  refreshed_at timestamptz null,
  refresh_lease_until timestamptz null,
  refresh_lease_owner text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_meta_ad_searches_mode_value_check check (
    (mode='keyword' and query_text is not null and length(query_text) between 2 and 100 and cardinality(page_ids)=0)
    or (mode='page' and query_text is null and cardinality(page_ids) between 1 and 10)
  ),
  constraint brand_meta_ad_searches_brand_fk
    foreign key(brand_id,workspace_id) references brands(id,workspace_id) on delete cascade,
  constraint brand_meta_ad_searches_tenant_identity_unique unique(id,workspace_id,brand_id),
  constraint brand_meta_ad_searches_contract_unique unique(workspace_id,brand_id,query_hash)
);

create table if not exists brand_meta_ad_search_results (
  workspace_id uuid not null,
  brand_id uuid not null,
  search_id uuid not null,
  meta_ad_id uuid not null references meta_ad_library_ads(id) on delete cascade,
  provider_rank integer not null check (provider_rank >= 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key(workspace_id,brand_id,search_id,meta_ad_id),
  constraint brand_meta_ad_search_results_search_fk
    foreign key(search_id,workspace_id,brand_id)
    references brand_meta_ad_searches(id,workspace_id,brand_id) on delete cascade
);

create index if not exists brand_meta_ad_search_results_page_idx
  on brand_meta_ad_search_results(workspace_id,brand_id,search_id,provider_rank,meta_ad_id);

create table if not exists brand_meta_ad_saved (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  meta_ad_id uuid not null references meta_ad_library_ads(id) on delete restrict,
  created_by_user_id uuid null,
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint brand_meta_ad_saved_brand_fk
    foreign key(brand_id,workspace_id) references brands(id,workspace_id) on delete cascade,
  constraint brand_meta_ad_saved_creator_fk
    foreign key(workspace_id,created_by_user_id)
    references workspace_members(workspace_id,user_id) on delete restrict,
  constraint brand_meta_ad_saved_tenant_identity_unique unique(id,workspace_id,brand_id),
  constraint brand_meta_ad_saved_ad_unique unique(workspace_id,brand_id,meta_ad_id)
);

alter table reference_items
  add column if not exists saved_meta_ad_id uuid null;

alter table reference_items
  drop constraint if exists reference_items_kind_check,
  drop constraint if exists reference_items_exactly_one_origin_check,
  drop constraint if exists reference_items_kind_origin_check,
  drop constraint if exists reference_items_saved_meta_ad_ownership_fk;

alter table reference_items
  add constraint reference_items_kind_check check (
    kind in ('saved_brand','saved_content','trend','meta_ad','external_url','upload','owned_performance')
  ),
  add constraint reference_items_exactly_one_origin_check check (
    num_nonnulls(
      reference_brand_id,source_url_id,saved_trend_id,saved_meta_ad_id,
      channel_output_id,storage_artifact_id
    ) = 1
  ),
  add constraint reference_items_kind_origin_check check (
    (kind='saved_brand' and reference_brand_id is not null)
    or (kind in ('saved_content','external_url') and source_url_id is not null)
    or (kind='trend' and saved_trend_id is not null)
    or (kind='meta_ad' and saved_meta_ad_id is not null)
    or (kind='upload' and storage_artifact_id is not null)
    or (kind='owned_performance' and channel_output_id is not null)
  ),
  add constraint reference_items_saved_meta_ad_ownership_fk
    foreign key(saved_meta_ad_id,workspace_id,brand_id)
    references brand_meta_ad_saved(id,workspace_id,brand_id) on delete restrict;

create unique index if not exists reference_items_saved_meta_ad_origin_unique
  on reference_items(workspace_id,brand_id,saved_meta_ad_id)
  where saved_meta_ad_id is not null;

alter table jobs drop constraint if exists jobs_type_check;
alter table jobs add constraint jobs_type_check check (
  job_type in (
    'daily_generation_enqueue','source_crawl','topic_select','master_draft_generate',
    'channel_output_generate','auto_approval_check','instagram_feed_render',
    'instagram_story_render','instagram_reel_render','threads_text_render',
    'artifact_upload','instagram_publish','threads_publish','token_health_check',
    'storage_cleanup','wiki_refresh','instagram_dm_reply','instagram_dm_profile_refresh',
    'reference_brand_refresh','meta_ad_page_refresh'
  )
);

create unique index if not exists jobs_meta_ad_page_refresh_daily_unique
  on jobs(job_type,dedupe_key)
  where job_type='meta_ad_page_refresh' and dedupe_key is not null;

create unique index if not exists jobs_meta_ad_page_refresh_active_page_unique
  on jobs(brand_id,(payload_json->>'pageId'))
  where job_type='meta_ad_page_refresh'
    and status in ('queued','running')
    and payload_json->>'pageId' is not null;

do $$
declare
  schema_owner_role_name name;
  application_role_name name;
begin
  select bootstrap.schema_owner_role_name, bootstrap.application_role_name
    into strict schema_owner_role_name, application_role_name
    from public.ai_content_bootstrap_state bootstrap
   where bootstrap.singleton;

  execute format('alter table public.meta_ad_library_ads owner to %I', schema_owner_role_name);
  execute format('alter table public.brand_meta_ad_searches owner to %I', schema_owner_role_name);
  execute format('alter table public.brand_meta_ad_search_results owner to %I', schema_owner_role_name);
  execute format('alter table public.brand_meta_ad_saved owner to %I', schema_owner_role_name);

  execute 'revoke all on table public.meta_ad_library_ads, public.brand_meta_ad_searches, public.brand_meta_ad_search_results, public.brand_meta_ad_saved from public';
  execute format('grant select, insert, update, delete on table public.meta_ad_library_ads to %I', application_role_name);
  execute format('grant select, insert, update, delete on table public.brand_meta_ad_searches to %I', application_role_name);
  execute format('grant select, insert, update, delete on table public.brand_meta_ad_search_results to %I', application_role_name);
  execute format('grant select, insert, update, delete on table public.brand_meta_ad_saved to %I', application_role_name);
end
$$;

commit;
