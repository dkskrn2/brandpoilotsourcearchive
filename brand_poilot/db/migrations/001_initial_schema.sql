create extension if not exists pgcrypto;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table app_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid null,
  email text not null,
  display_name text null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint app_users_status_check check (status in ('active', 'invited', 'disabled')),
  constraint app_users_email_unique unique (email),
  constraint app_users_auth_user_id_unique unique (auth_user_id)
);

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  status text not null default 'active',
  created_by_user_id uuid null references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint workspaces_status_check check (status in ('active', 'suspended', 'disabled')),
  constraint workspaces_slug_unique unique (slug)
);

create table workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  role text not null default 'member',
  status text not null default 'active',
  invited_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint workspace_members_role_check check (role in ('owner', 'admin', 'member')),
  constraint workspace_members_status_check check (status in ('active', 'invited', 'disabled')),
  constraint workspace_members_workspace_user_unique unique (workspace_id, user_id)
);

create table brands (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  status text not null default 'active',
  timezone text not null default 'Asia/Seoul',
  created_by_user_id uuid null references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint brands_status_check check (status in ('active', 'paused', 'disabled'))
);

create unique index brands_workspace_name_active_unique
  on brands(workspace_id, name)
  where deleted_at is null;

create table brand_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  industry text null,
  primary_customer text null,
  description text null,
  tone text null,
  forbidden_terms jsonb not null default '[]'::jsonb,
  default_cta text null,
  main_link text null,
  auto_approval_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_profiles_brand_unique unique (brand_id),
  constraint brand_profiles_forbidden_terms_array_check check (jsonb_typeof(forbidden_terms) = 'array')
);

create table storage_artifacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid null references brands(id) on delete cascade,
  artifact_type text not null,
  bucket text not null,
  path text not null,
  public_url text null,
  mime_type text null,
  byte_size bigint null,
  checksum text null,
  expires_at timestamptz null,
  created_by_user_id uuid null references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint storage_artifacts_type_check check (
    artifact_type in ('topic_upload', 'brand_asset', 'rendered_image', 'generated_manifest', 'cover_image', 'source_archive')
  ),
  constraint storage_artifacts_bucket_path_unique unique (bucket, path)
);

create table source_urls (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  source_type text not null,
  url text not null,
  url_hash text not null,
  domain text null,
  title text null,
  meta_description text null,
  status text not null default 'active',
  enabled boolean not null default true,
  last_crawled_at timestamptz null,
  last_error text null,
  disabled_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint source_urls_source_type_check check (source_type in ('owned', 'reference')),
  constraint source_urls_status_check check (status in ('active', 'crawling', 'crawled', 'crawl_failed', 'disabled'))
);

create unique index source_urls_brand_type_hash_active_unique
  on source_urls(brand_id, source_type, url_hash)
  where deleted_at is null;

create index source_urls_brand_type_status_idx on source_urls(brand_id, source_type, status);
create index source_urls_brand_enabled_idx on source_urls(brand_id, enabled);

create table source_content_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  source_url_id uuid not null references source_urls(id) on delete cascade,
  url_hash text not null,
  content_url text not null,
  canonical_url text null,
  domain text null,
  title text null,
  status text not null default 'discovered',
  discovery_method text not null default 'seed_self',
  link_text text null,
  first_discovered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_crawled_at timestamptz null,
  latest_content_hash text null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint source_content_items_status_check check (status in ('discovered', 'crawled', 'unchanged', 'crawl_failed', 'disabled')),
  constraint source_content_items_discovery_method_check check (discovery_method in ('seed_self', 'canonical', 'og_url', 'anchor'))
);

create unique index source_content_items_brand_url_hash_active_unique
  on source_content_items(brand_id, url_hash)
  where deleted_at is null;

create index source_content_items_source_seen_idx on source_content_items(source_url_id, last_seen_at desc);
create index source_content_items_brand_status_idx on source_content_items(brand_id, status);

create table source_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  source_url_id uuid not null references source_urls(id) on delete cascade,
  source_content_item_id uuid null references source_content_items(id) on delete set null,
  status text not null,
  fetched_at timestamptz not null default now(),
  http_status int null,
  content_hash text null,
  raw_text text null,
  extracted_title text null,
  extracted_text text null,
  summary text null,
  metadata jsonb not null default '{}'::jsonb,
  error_message text null,
  created_at timestamptz not null default now(),
  constraint source_snapshots_status_check check (status in ('succeeded', 'failed')),
  constraint source_snapshots_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create index source_snapshots_source_fetched_idx on source_snapshots(source_url_id, fetched_at desc);
create index source_snapshots_content_item_hash_idx on source_snapshots(source_content_item_id, content_hash);
create index source_snapshots_brand_status_fetched_idx on source_snapshots(brand_id, status, fetched_at desc);

create table topic_uploads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  storage_artifact_id uuid null references storage_artifacts(id) on delete set null,
  file_name text not null,
  file_mime_type text null,
  status text not null default 'uploaded',
  total_rows int not null default 0,
  valid_rows int not null default 0,
  duplicate_rows int not null default 0,
  invalid_rows int not null default 0,
  error_message text null,
  created_by_user_id uuid null references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint topic_uploads_status_check check (status in ('uploaded', 'validating', 'validated', 'applied', 'failed')),
  constraint topic_uploads_row_counts_check check (
    total_rows >= 0 and valid_rows >= 0 and duplicate_rows >= 0 and invalid_rows >= 0
  )
);

create table topic_rows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  topic_upload_id uuid not null references topic_uploads(id) on delete cascade,
  row_number int not null,
  status text not null default 'uploaded',
  topic_title text not null,
  topic_angle text not null,
  target_customer text null,
  region text null,
  season text null,
  reference_url text null,
  priority int not null default 0,
  notes text null,
  topic_key text not null,
  validation_errors jsonb not null default '[]'::jsonb,
  queued_at timestamptz null,
  used_at timestamptz null,
  disabled_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint topic_rows_status_check check (status in ('uploaded', 'queued', 'used', 'skipped', 'invalid', 'failed', 'disabled')),
  constraint topic_rows_row_number_check check (row_number > 0),
  constraint topic_rows_validation_errors_array_check check (jsonb_typeof(validation_errors) = 'array'),
  constraint topic_rows_upload_row_unique unique (topic_upload_id, row_number)
);

create unique index topic_rows_brand_topic_key_active_unique
  on topic_rows(brand_id, topic_key)
  where status in ('queued', 'used');

create index topic_rows_brand_status_priority_idx on topic_rows(brand_id, status, priority desc, created_at asc);
create index topic_rows_brand_used_at_idx on topic_rows(brand_id, used_at desc);

create table brand_channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  channel text not null,
  status text not null default 'not_connected',
  account_label text null,
  external_account_id text null,
  enabled boolean not null default true,
  last_healthy_at timestamptz null,
  last_published_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint brand_channels_channel_check check (channel in ('instagram', 'threads', 'tiktok', 'youtube', 'x')),
  constraint brand_channels_status_check check (
    status in ('not_connected', 'connected', 'needs_attention', 'expired', 'insufficient_permissions', 'mapping_required', 'publish_failed')
  )
);

create unique index brand_channels_brand_channel_active_unique
  on brand_channels(brand_id, channel)
  where deleted_at is null;

create table channel_credentials (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  brand_channel_id uuid not null references brand_channels(id) on delete cascade,
  provider text not null,
  credential_type text not null,
  encrypted_payload text not null,
  masked_display text null,
  scopes text[] not null default '{}'::text[],
  expires_at timestamptz null,
  status text not null default 'active',
  last_checked_at timestamptz null,
  rotated_at timestamptz null,
  revoked_at timestamptz null,
  created_by_user_id uuid null references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_credentials_provider_check check (provider in ('meta')),
  constraint channel_credentials_type_check check (credential_type in ('oauth', 'api_token')),
  constraint channel_credentials_status_check check (status in ('active', 'expired', 'revoked', 'invalid'))
);

create unique index channel_credentials_one_unrevoked_per_channel_unique
  on channel_credentials(brand_channel_id)
  where revoked_at is null;

create index channel_credentials_brand_status_expires_idx on channel_credentials(brand_id, status, expires_at);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid null references workspaces(id) on delete cascade,
  brand_id uuid null references brands(id) on delete cascade,
  job_type text not null,
  status text not null default 'queued',
  payload_json jsonb not null default '{}'::jsonb,
  priority int not null default 0,
  run_at timestamptz not null default now(),
  attempt_count int not null default 0,
  max_attempts int not null default 3,
  locked_until timestamptz null,
  locked_by text null,
  last_error text null,
  started_at timestamptz null,
  finished_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_type_check check (
    job_type in (
      'daily_generation_enqueue',
      'source_crawl',
      'topic_select',
      'master_draft_generate',
      'channel_output_generate',
      'auto_approval_check',
      'instagram_render',
      'artifact_upload',
      'instagram_publish',
      'threads_publish',
      'token_health_check',
      'storage_cleanup'
    )
  ),
  constraint jobs_status_check check (status in ('queued', 'running', 'succeeded', 'failed', 'dead', 'cancelled')),
  constraint jobs_attempts_check check (attempt_count >= 0 and max_attempts > 0),
  constraint jobs_payload_object_check check (jsonb_typeof(payload_json) = 'object')
);

create index jobs_queued_pick_idx
  on jobs(status, run_at, priority desc, created_at asc)
  where status = 'queued';

create index jobs_running_lock_idx
  on jobs(locked_until)
  where status = 'running';

create index jobs_brand_type_status_created_idx on jobs(brand_id, job_type, status, created_at desc);

create table content_topics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  topic_row_id uuid null references topic_rows(id) on delete set null,
  title text not null,
  angle text not null,
  status text not null default 'selected',
  source_context jsonb not null default '{}'::jsonb,
  selected_at timestamptz not null default now(),
  generated_at timestamptz null,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_topics_status_check check (status in ('selected', 'generating', 'generated', 'failed', 'cancelled')),
  constraint content_topics_source_context_object_check check (jsonb_typeof(source_context) = 'object')
);

create index content_topics_brand_status_selected_idx on content_topics(brand_id, status, selected_at desc);

create table master_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  content_topic_id uuid not null references content_topics(id) on delete cascade,
  status text not null default 'generated',
  prompt_version text not null,
  draft_json jsonb not null default '{}'::jsonb,
  source_snapshot_refs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint master_drafts_status_check check (status in ('generated', 'failed', 'superseded')),
  constraint master_drafts_draft_json_object_check check (jsonb_typeof(draft_json) = 'object'),
  constraint master_drafts_source_snapshot_refs_array_check check (jsonb_typeof(source_snapshot_refs) = 'array')
);

create index master_drafts_topic_created_idx on master_drafts(content_topic_id, created_at desc);

create table channel_outputs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  content_topic_id uuid not null references content_topics(id) on delete cascade,
  master_draft_id uuid not null references master_drafts(id) on delete cascade,
  channel text not null,
  status text not null default 'pending_review',
  title text not null,
  preview_title text null,
  preview_body text null,
  output_json jsonb not null default '{}'::jsonb,
  rendered_artifact_id uuid null references storage_artifacts(id) on delete set null,
  source_summary text null,
  block_reasons jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now(),
  approved_at timestamptz null,
  rejected_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_outputs_channel_check check (channel in ('instagram', 'threads', 'tiktok', 'youtube', 'x')),
  constraint channel_outputs_status_check check (
    status in ('pending_review', 'approved', 'auto_approved', 'auto_approval_blocked', 'rejected', 'regenerating', 'regenerated')
  ),
  constraint channel_outputs_output_json_object_check check (jsonb_typeof(output_json) = 'object'),
  constraint channel_outputs_block_reasons_array_check check (jsonb_typeof(block_reasons) = 'array')
);

create unique index channel_outputs_current_master_channel_unique
  on channel_outputs(master_draft_id, channel)
  where status != 'regenerated';

create index channel_outputs_brand_channel_status_generated_idx on channel_outputs(brand_id, channel, status, generated_at desc);
create index channel_outputs_brand_status_generated_idx on channel_outputs(brand_id, status, generated_at desc);

create table auto_approval_checks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  channel_output_id uuid not null references channel_outputs(id) on delete cascade,
  status text not null,
  policy_version text not null,
  reasons jsonb not null default '[]'::jsonb,
  checks_json jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint auto_approval_checks_status_check check (status in ('passed', 'blocked', 'skipped')),
  constraint auto_approval_checks_reasons_array_check check (jsonb_typeof(reasons) = 'array'),
  constraint auto_approval_checks_checks_json_object_check check (jsonb_typeof(checks_json) = 'object')
);

create index auto_approval_checks_output_checked_idx on auto_approval_checks(channel_output_id, checked_at desc);

create table llm_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid null references brands(id) on delete set null,
  job_id uuid null references jobs(id) on delete set null,
  content_topic_id uuid null references content_topics(id) on delete set null,
  channel_output_id uuid null references channel_outputs(id) on delete set null,
  purpose text not null,
  provider text not null,
  model text not null,
  prompt_version text not null,
  status text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  request_metadata jsonb not null default '{}'::jsonb,
  response_metadata jsonb not null default '{}'::jsonb,
  error_message text null,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint llm_runs_purpose_check check (
    purpose in ('source_summary', 'master_draft', 'channel_output', 'regeneration', 'policy_check')
  ),
  constraint llm_runs_status_check check (status in ('succeeded', 'failed')),
  constraint llm_runs_tokens_cost_check check (input_tokens >= 0 and output_tokens >= 0 and cost_usd >= 0),
  constraint llm_runs_request_metadata_object_check check (jsonb_typeof(request_metadata) = 'object'),
  constraint llm_runs_response_metadata_object_check check (jsonb_typeof(response_metadata) = 'object')
);

create index llm_runs_workspace_created_idx on llm_runs(workspace_id, created_at desc);
create index llm_runs_brand_created_idx on llm_runs(brand_id, created_at desc);

create table review_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  channel_output_id uuid not null references channel_outputs(id) on delete cascade,
  actor_user_id uuid null references app_users(id) on delete set null,
  actor_type text not null,
  event_type text not null,
  reason text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint review_events_actor_type_check check (actor_type in ('user', 'system', 'worker')),
  constraint review_events_event_type_check check (
    event_type in (
      'approved',
      'auto_approved',
      'auto_approval_blocked',
      'rejected',
      'regenerate_requested',
      'status_changed',
      'publish_queue_created'
    )
  ),
  constraint review_events_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create index review_events_output_created_idx on review_events(channel_output_id, created_at desc);
create index review_events_brand_created_idx on review_events(brand_id, created_at desc);

create table regeneration_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  channel_output_id uuid not null references channel_outputs(id) on delete cascade,
  requested_by_user_id uuid null references app_users(id) on delete set null,
  reason text not null,
  status text not null default 'queued',
  job_id uuid null references jobs(id) on delete set null,
  replacement_output_id uuid null references channel_outputs(id) on delete set null,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint regeneration_requests_status_check check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);

create index regeneration_requests_output_created_idx on regeneration_requests(channel_output_id, created_at desc);

create table publish_slots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  channel text not null,
  slot_number int not null,
  base_time time not null,
  jitter_minutes int not null default 10,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publish_slots_channel_check check (channel in ('instagram', 'threads', 'tiktok', 'youtube', 'x')),
  constraint publish_slots_slot_number_check check (slot_number between 1 and 4),
  constraint publish_slots_jitter_check check (jitter_minutes >= 0 and jitter_minutes <= 60),
  constraint publish_slots_brand_channel_slot_unique unique (brand_id, channel, slot_number)
);

create table publish_queue (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  channel_output_id uuid not null references channel_outputs(id) on delete cascade,
  brand_channel_id uuid not null references brand_channels(id) on delete cascade,
  channel text not null,
  status text not null default 'queued',
  approval_type text not null,
  priority int not null default 0,
  slot_date date null,
  slot_number int null,
  scheduled_for timestamptz null,
  queued_at timestamptz not null default now(),
  publishing_started_at timestamptz null,
  published_at timestamptz null,
  failed_at timestamptz null,
  deferred_until timestamptz null,
  idempotency_key text not null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publish_queue_channel_check check (channel in ('instagram', 'threads', 'tiktok', 'youtube', 'x')),
  constraint publish_queue_status_check check (status in ('queued', 'scheduled', 'publishing', 'published', 'failed', 'deferred', 'cancelled')),
  constraint publish_queue_approval_type_check check (approval_type in ('manual', 'auto')),
  constraint publish_queue_slot_number_check check (slot_number is null or slot_number between 1 and 4),
  constraint publish_queue_channel_output_unique unique (channel_output_id),
  constraint publish_queue_idempotency_key_unique unique (idempotency_key)
);

create index publish_queue_brand_channel_status_scheduled_idx on publish_queue(brand_id, channel, status, scheduled_for);

create index publish_queue_scheduled_work_idx
  on publish_queue(status, scheduled_for)
  where status in ('scheduled', 'deferred');

create table publish_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  publish_queue_id uuid not null references publish_queue(id) on delete cascade,
  attempt_number int not null,
  status text not null default 'running',
  request_metadata jsonb not null default '{}'::jsonb,
  response_metadata jsonb not null default '{}'::jsonb,
  external_post_id text null,
  external_url text null,
  error_code text null,
  error_message text null,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint publish_attempts_status_check check (status in ('running', 'succeeded', 'failed')),
  constraint publish_attempts_attempt_number_check check (attempt_number > 0),
  constraint publish_attempts_request_metadata_object_check check (jsonb_typeof(request_metadata) = 'object'),
  constraint publish_attempts_response_metadata_object_check check (jsonb_typeof(response_metadata) = 'object'),
  constraint publish_attempts_queue_attempt_unique unique (publish_queue_id, attempt_number)
);

create index publish_attempts_queue_started_idx on publish_attempts(publish_queue_id, started_at desc);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid null references workspaces(id) on delete cascade,
  brand_id uuid null references brands(id) on delete cascade,
  actor_user_id uuid null references app_users(id) on delete set null,
  actor_type text not null,
  event_type text not null,
  entity_type text not null,
  entity_id uuid null,
  before_json jsonb null,
  after_json jsonb null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_actor_type_check check (actor_type in ('user', 'system', 'worker')),
  constraint audit_events_metadata_object_check check (jsonb_typeof(metadata) = 'object'),
  constraint audit_events_before_json_object_check check (before_json is null or jsonb_typeof(before_json) = 'object'),
  constraint audit_events_after_json_object_check check (after_json is null or jsonb_typeof(after_json) = 'object')
);

create index audit_events_workspace_created_idx on audit_events(workspace_id, created_at desc);
create index audit_events_brand_created_idx on audit_events(brand_id, created_at desc);
create index audit_events_entity_created_idx on audit_events(entity_type, entity_id, created_at desc);

create trigger app_users_set_updated_at before update on app_users for each row execute function set_updated_at();
create trigger workspaces_set_updated_at before update on workspaces for each row execute function set_updated_at();
create trigger workspace_members_set_updated_at before update on workspace_members for each row execute function set_updated_at();
create trigger brands_set_updated_at before update on brands for each row execute function set_updated_at();
create trigger brand_profiles_set_updated_at before update on brand_profiles for each row execute function set_updated_at();
create trigger source_urls_set_updated_at before update on source_urls for each row execute function set_updated_at();
create trigger source_content_items_set_updated_at before update on source_content_items for each row execute function set_updated_at();
create trigger topic_uploads_set_updated_at before update on topic_uploads for each row execute function set_updated_at();
create trigger topic_rows_set_updated_at before update on topic_rows for each row execute function set_updated_at();
create trigger brand_channels_set_updated_at before update on brand_channels for each row execute function set_updated_at();
create trigger channel_credentials_set_updated_at before update on channel_credentials for each row execute function set_updated_at();
create trigger jobs_set_updated_at before update on jobs for each row execute function set_updated_at();
create trigger content_topics_set_updated_at before update on content_topics for each row execute function set_updated_at();
create trigger master_drafts_set_updated_at before update on master_drafts for each row execute function set_updated_at();
create trigger channel_outputs_set_updated_at before update on channel_outputs for each row execute function set_updated_at();
create trigger regeneration_requests_set_updated_at before update on regeneration_requests for each row execute function set_updated_at();
create trigger publish_slots_set_updated_at before update on publish_slots for each row execute function set_updated_at();
create trigger publish_queue_set_updated_at before update on publish_queue for each row execute function set_updated_at();
