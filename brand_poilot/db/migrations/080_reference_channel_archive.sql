begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table reference_brands
  add column if not exists provider_account_id text null,
  add column if not exists refresh_status text not null default 'pending',
  add column if not exists last_refresh_attempted_at timestamptz null,
  add column if not exists last_refresh_error text null;

alter table reference_brands
  drop constraint if exists reference_brands_refresh_status_check;
alter table reference_brands
  add constraint reference_brands_refresh_status_check
  check (refresh_status in ('pending','fresh','stale','ineligible'));

create unique index if not exists reference_brands_provider_account_unique
  on reference_brands(workspace_id,brand_id,lower(platform),provider_account_id)
  where provider_account_id is not null;

create table if not exists reference_brand_media (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  reference_brand_id uuid not null,
  trend_media_id uuid not null references instagram_trend_media(id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reference_brand_media_brand_owner_fkey
    foreign key (brand_id,workspace_id)
    references brands(id,workspace_id) on delete cascade,
  constraint reference_brand_media_channel_owner_fkey
    foreign key (reference_brand_id,workspace_id,brand_id)
    references reference_brands(id,workspace_id,brand_id) on delete cascade,
  constraint reference_brand_media_identity_unique
    unique (workspace_id,brand_id,reference_brand_id,trend_media_id),
  constraint reference_brand_media_seen_order_check
    check (last_seen_at >= first_seen_at)
);

create unique index if not exists reference_brand_media_current_author_unique
  on reference_brand_media(workspace_id,brand_id,trend_media_id)
  where is_current;
create index if not exists reference_brand_media_channel_current_idx
  on reference_brand_media(workspace_id,brand_id,reference_brand_id,last_seen_at desc)
  where is_current;

create table if not exists reference_brand_metric_observations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  reference_brand_id uuid not null,
  observed_date date not null,
  observed_at timestamptz not null default now(),
  followers_count bigint null check (followers_count is null or followers_count >= 0),
  media_count bigint null check (media_count is null or media_count >= 0),
  source text not null default 'business_discovery'
    check (source = 'business_discovery'),
  created_at timestamptz not null default now(),
  constraint reference_brand_metric_observations_channel_owner_fkey
    foreign key (reference_brand_id,workspace_id,brand_id)
    references reference_brands(id,workspace_id,brand_id) on delete cascade,
  constraint reference_brand_metric_observations_daily_unique
    unique (workspace_id,brand_id,reference_brand_id,observed_date)
);

create table if not exists reference_media_metric_observations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  reference_brand_id uuid not null,
  trend_media_id uuid not null references instagram_trend_media(id) on delete cascade,
  observed_date date not null,
  observed_at timestamptz not null default now(),
  view_count bigint null check (view_count is null or view_count >= 0),
  like_count bigint null check (like_count is null or like_count >= 0),
  comments_count bigint null check (comments_count is null or comments_count >= 0),
  source text not null default 'business_discovery'
    check (source = 'business_discovery'),
  created_at timestamptz not null default now(),
  constraint reference_media_metric_observations_relation_fkey
    foreign key (workspace_id,brand_id,reference_brand_id,trend_media_id)
    references reference_brand_media(workspace_id,brand_id,reference_brand_id,trend_media_id)
    on delete cascade,
  constraint reference_media_metric_observations_daily_unique
    unique (workspace_id,brand_id,reference_brand_id,trend_media_id,observed_date)
);

alter table brand_trend_saved_media
  add column if not exists saved_category_id uuid null references content_categories(id) on delete set null,
  add column if not exists saved_hashtag_id uuid null references instagram_trend_hashtags(id) on delete set null,
  add column if not exists discovery_section text null,
  add column if not exists rank_evidence jsonb not null default '{}'::jsonb;

alter table brand_trend_saved_media
  drop constraint if exists brand_trend_saved_media_discovery_section_check,
  drop constraint if exists brand_trend_saved_media_rank_evidence_object_check;
alter table brand_trend_saved_media
  add constraint brand_trend_saved_media_discovery_section_check check (
    discovery_section is null or discovery_section in ('meta','frequent_saves','follower_relative','channel')
  ),
  add constraint brand_trend_saved_media_rank_evidence_object_check
    check (jsonb_typeof(rank_evidence) = 'object');

create table if not exists reference_save_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  trend_media_id uuid not null references instagram_trend_media(id) on delete cascade,
  reference_brand_id uuid null,
  event_type text not null check (event_type in ('saved','unsaved')),
  saved_category_id uuid null references content_categories(id) on delete set null,
  saved_hashtag_id uuid null references instagram_trend_hashtags(id) on delete set null,
  discovery_section text null check (
    discovery_section is null or discovery_section in ('meta','frequent_saves','follower_relative','channel')
  ),
  rank_evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(rank_evidence) = 'object'),
  actor_user_id uuid null,
  occurred_at timestamptz not null default now(),
  constraint reference_save_events_brand_owner_fkey
    foreign key (brand_id,workspace_id)
    references brands(id,workspace_id) on delete cascade,
  constraint reference_save_events_channel_owner_fkey
    foreign key (reference_brand_id,workspace_id,brand_id)
    references reference_brands(id,workspace_id,brand_id)
    on delete set null (reference_brand_id)
);

create index if not exists reference_save_events_media_time_idx
  on reference_save_events(trend_media_id,occurred_at desc);
create index if not exists reference_save_events_tenant_time_idx
  on reference_save_events(workspace_id,brand_id,occurred_at desc);

create table if not exists meta_api_usage_state (
  app_id_hash text primary key check (app_id_hash ~ '^[0-9a-f]{64}$'),
  call_count integer null check (call_count is null or call_count between 0 and 100),
  total_time integer null check (total_time is null or total_time between 0 and 100),
  total_cputime integer null check (total_cputime is null or total_cputime between 0 and 100),
  business_usage jsonb not null default '{}'::jsonb check (jsonb_typeof(business_usage) = 'object'),
  observed_at timestamptz null,
  defer_until timestamptz null,
  probe_lease_until timestamptz null,
  updated_at timestamptz not null default now()
);

alter table jobs drop constraint if exists jobs_type_check;
alter table jobs add constraint jobs_type_check check (
  job_type in (
    'daily_generation_enqueue','source_crawl','topic_select','master_draft_generate',
    'channel_output_generate','auto_approval_check','instagram_feed_render',
    'instagram_story_render','instagram_reel_render','threads_text_render',
    'artifact_upload','instagram_publish','threads_publish','token_health_check',
    'storage_cleanup','wiki_refresh','instagram_dm_reply','instagram_dm_profile_refresh',
    'reference_brand_refresh'
  )
);

create unique index if not exists jobs_reference_brand_refresh_daily_unique
  on jobs(job_type,dedupe_key)
  where job_type='reference_brand_refresh' and dedupe_key is not null;

create unique index if not exists jobs_reference_brand_refresh_active_channel_unique
  on jobs((payload_json->>'referenceBrandId'))
  where job_type='reference_brand_refresh'
    and status in ('queued','running')
    and payload_json->>'referenceBrandId' is not null;

do $$
declare
  schema_owner_role_name name;
  application_role_name name;
begin
  select bootstrap.schema_owner_role_name, bootstrap.application_role_name
    into strict schema_owner_role_name, application_role_name
    from public.ai_content_bootstrap_state bootstrap
   where bootstrap.singleton;

  execute format('alter table public.reference_brand_media owner to %I', schema_owner_role_name);
  execute format('alter table public.reference_brand_metric_observations owner to %I', schema_owner_role_name);
  execute format('alter table public.reference_media_metric_observations owner to %I', schema_owner_role_name);
  execute format('alter table public.reference_save_events owner to %I', schema_owner_role_name);
  execute format('alter table public.meta_api_usage_state owner to %I', schema_owner_role_name);

  execute 'revoke all on table public.reference_brand_media, public.reference_brand_metric_observations, public.reference_media_metric_observations, public.reference_save_events, public.meta_api_usage_state from public';
  execute format('grant select, insert, update, delete on table public.reference_brand_media to %I', application_role_name);
  execute format('grant select, insert, update, delete on table public.reference_brand_metric_observations to %I', application_role_name);
  execute format('grant select, insert, update, delete on table public.reference_media_metric_observations to %I', application_role_name);
  execute format('grant select, insert, update, delete on table public.reference_save_events to %I', application_role_name);
  execute format('grant select, insert, update, delete on table public.meta_api_usage_state to %I', application_role_name);
end
$$;

commit;
