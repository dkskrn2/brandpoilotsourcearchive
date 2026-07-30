alter table wiki_versions
  add column build_stage text null;

alter table wiki_versions
  drop constraint wiki_versions_status_check,
  add constraint wiki_versions_status_check
    check (status in ('building', 'ready', 'active', 'failed', 'superseded')),
  add constraint wiki_versions_build_stage_check
    check (
      build_stage is null
      or build_stage in ('collecting', 'compiling', 'embedding', 'validating')
    );

create table wiki_build_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  requested_revision bigint not null default 1,
  building_revision bigint null,
  status text not null default 'pending',
  rebuild_requested boolean not null default false,
  quiet_until timestamptz not null default now(),
  started_at timestamptz null,
  completed_at timestamptz null,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wiki_build_requests_brand_ownership_fk
    foreign key (brand_id, workspace_id)
    references brands(id, workspace_id) on delete cascade,
  constraint wiki_build_requests_tenant_identity_unique
    unique (id, workspace_id, brand_id),
  constraint wiki_build_requests_status_check
    check (status in ('pending', 'building', 'succeeded', 'failed', 'cancelled')),
  constraint wiki_build_requests_revision_check
    check (
      requested_revision > 0
      and (building_revision is null or building_revision > 0)
    )
);

create unique index wiki_build_requests_brand_active_unique
  on wiki_build_requests(workspace_id, brand_id)
  where status in ('pending', 'building');
create index wiki_build_requests_claim_idx
  on wiki_build_requests(status, quiet_until, created_at)
  where status = 'pending';

create table wiki_source_units (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  wiki_version_id uuid not null,
  source_kind text not null,
  source_id uuid not null,
  unit_type text not null,
  stable_key text not null,
  title text not null,
  content text not null,
  content_hash text not null,
  keywords text[] not null default '{}',
  aliases text[] not null default '{}',
  structured_data jsonb not null default '{}'::jsonb,
  source_url text null,
  destination_url text null,
  source_quote text not null,
  valid_from date null,
  valid_until date null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wiki_source_units_version_ownership_fk
    foreign key (wiki_version_id, workspace_id, brand_id)
    references wiki_versions(id, workspace_id, brand_id) on delete cascade,
  constraint wiki_source_units_tenant_identity_unique
    unique (id, workspace_id, brand_id, wiki_version_id),
  constraint wiki_source_units_version_source_key_unique
    unique (wiki_version_id, source_kind, source_id, stable_key),
  constraint wiki_source_units_source_kind_check
    check (source_kind in ('faq', 'product', 'policy', 'owned_snapshot')),
  constraint wiki_source_units_unit_type_check
    check (unit_type in ('faq', 'product', 'service', 'policy', 'fact', 'guide_section')),
  constraint wiki_source_units_text_check
    check (
      length(trim(stable_key)) > 0
      and length(trim(title)) > 0
      and length(trim(content)) > 0
      and length(trim(source_quote)) > 0
    ),
  constraint wiki_source_units_structured_data_check
    check (jsonb_typeof(structured_data) = 'object'),
  constraint wiki_source_units_validity_check
    check (valid_from is null or valid_until is null or valid_from <= valid_until)
);

create index wiki_source_units_brand_version_idx
  on wiki_source_units(workspace_id, brand_id, wiki_version_id, unit_type, stable_key);
create index wiki_source_units_source_idx
  on wiki_source_units(workspace_id, brand_id, source_kind, source_id);

create table wiki_pages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  wiki_version_id uuid not null,
  page_type text not null,
  stable_key text not null,
  title text not null,
  summary text not null default '',
  content_markdown text not null default '',
  content_json jsonb not null default '{"sections": []}'::jsonb,
  structured_data jsonb not null default '{}'::jsonb,
  content_hash text null,
  prompt_version text null,
  source_count integer not null default 0,
  is_core boolean not null default false,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wiki_pages_version_ownership_fk
    foreign key (wiki_version_id, workspace_id, brand_id)
    references wiki_versions(id, workspace_id, brand_id) on delete cascade,
  constraint wiki_pages_tenant_identity_unique
    unique (id, workspace_id, brand_id, wiki_version_id),
  constraint wiki_pages_version_stable_key_unique
    unique (wiki_version_id, stable_key),
  constraint wiki_pages_page_type_check
    check (page_type in ('brand_overview', 'catalog', 'product', 'service', 'policy', 'faq', 'guide')),
  constraint wiki_pages_text_check
    check (length(trim(stable_key)) > 0 and length(trim(title)) > 0),
  constraint wiki_pages_json_check
    check (
      jsonb_typeof(content_json) = 'object'
      and jsonb_typeof(content_json -> 'sections') = 'array'
      and jsonb_typeof(structured_data) = 'object'
    ),
  constraint wiki_pages_source_count_check check (source_count >= 0)
);

create index wiki_pages_brand_version_idx
  on wiki_pages(workspace_id, brand_id, wiki_version_id, page_type, stable_key);
create index wiki_pages_brand_active_idx
  on wiki_pages(workspace_id, brand_id, page_type, stable_key)
  where is_active;

create table wiki_page_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  wiki_version_id uuid not null,
  wiki_page_id uuid not null,
  wiki_source_unit_id uuid not null,
  section_key text not null,
  source_kind text not null,
  source_id uuid not null,
  source_url text null,
  destination_url text null,
  source_quote text not null,
  created_at timestamptz not null default now(),
  constraint wiki_page_sources_page_ownership_fk
    foreign key (wiki_page_id, workspace_id, brand_id, wiki_version_id)
    references wiki_pages(id, workspace_id, brand_id, wiki_version_id) on delete cascade,
  constraint wiki_page_sources_unit_ownership_fk
    foreign key (wiki_source_unit_id, workspace_id, brand_id, wiki_version_id)
    references wiki_source_units(id, workspace_id, brand_id, wiki_version_id) on delete restrict,
  constraint wiki_page_sources_tenant_identity_unique
    unique (id, workspace_id, brand_id, wiki_version_id),
  constraint wiki_page_sources_section_unit_unique
    unique (wiki_page_id, section_key, wiki_source_unit_id),
  constraint wiki_page_sources_text_check
    check (length(trim(section_key)) > 0 and length(trim(source_quote)) > 0)
);

create index wiki_page_sources_brand_page_idx
  on wiki_page_sources(workspace_id, brand_id, wiki_version_id, wiki_page_id);
create index wiki_page_sources_destination_idx
  on wiki_page_sources(workspace_id, brand_id, destination_url)
  where destination_url is not null;

create table wiki_page_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  wiki_version_id uuid not null,
  from_page_id uuid not null,
  to_page_id uuid not null,
  relation text not null,
  created_at timestamptz not null default now(),
  constraint wiki_page_links_from_ownership_fk
    foreign key (from_page_id, workspace_id, brand_id, wiki_version_id)
    references wiki_pages(id, workspace_id, brand_id, wiki_version_id) on delete cascade,
  constraint wiki_page_links_to_ownership_fk
    foreign key (to_page_id, workspace_id, brand_id, wiki_version_id)
    references wiki_pages(id, workspace_id, brand_id, wiki_version_id) on delete cascade,
  constraint wiki_page_links_version_relation_unique
    unique (wiki_version_id, from_page_id, to_page_id, relation),
  constraint wiki_page_links_no_self_check check (from_page_id <> to_page_id),
  constraint wiki_page_links_relation_check check (length(trim(relation)) > 0)
);

create index wiki_page_links_brand_from_idx
  on wiki_page_links(workspace_id, brand_id, wiki_version_id, from_page_id);

create table wiki_page_chunks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  wiki_version_id uuid not null,
  wiki_page_id uuid not null,
  chunk_index integer not null,
  content text not null,
  content_hash text not null,
  search_vector tsvector generated always as (to_tsvector('simple', content)) stored,
  embedding_model text null,
  embedding_version text null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wiki_page_chunks_page_ownership_fk
    foreign key (wiki_page_id, workspace_id, brand_id, wiki_version_id)
    references wiki_pages(id, workspace_id, brand_id, wiki_version_id) on delete cascade,
  constraint wiki_page_chunks_tenant_identity_unique
    unique (id, workspace_id, brand_id, wiki_version_id),
  constraint wiki_page_chunks_page_index_unique unique (wiki_page_id, chunk_index),
  constraint wiki_page_chunks_index_check check (chunk_index >= 0),
  constraint wiki_page_chunks_content_check check (length(trim(content)) > 0)
);

create index wiki_page_chunks_brand_version_idx
  on wiki_page_chunks(workspace_id, brand_id, wiki_version_id, enabled);
create index wiki_page_chunks_search_idx
  on wiki_page_chunks using gin(search_vector);

create table wiki_compilation_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  wiki_version_id uuid not null,
  item_type text not null,
  stable_key text not null,
  idempotency_key text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  available_at timestamptz not null default now(),
  lease_owner text null,
  lease_token uuid null,
  lease_expires_at timestamptz null,
  payload_json jsonb not null default '{}'::jsonb,
  result_json jsonb not null default '{}'::jsonb,
  error_message text null,
  started_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wiki_compilation_items_version_ownership_fk
    foreign key (wiki_version_id, workspace_id, brand_id)
    references wiki_versions(id, workspace_id, brand_id) on delete cascade,
  constraint wiki_compilation_items_version_key_unique
    unique (wiki_version_id, item_type, stable_key),
  constraint wiki_compilation_items_idempotency_unique
    unique (workspace_id, brand_id, idempotency_key),
  constraint wiki_compilation_items_type_check
    check (item_type in ('brand_core_pages', 'detail_page', 'policy_page', 'faq_guide_page', 'validate')),
  constraint wiki_compilation_items_status_check
    check (status in ('pending', 'processing', 'succeeded', 'failed')),
  constraint wiki_compilation_items_attempts_check
    check (attempt_count >= 0 and max_attempts > 0 and attempt_count <= max_attempts),
  constraint wiki_compilation_items_json_check
    check (jsonb_typeof(payload_json) = 'object' and jsonb_typeof(result_json) = 'object'),
  constraint wiki_compilation_items_lease_check
    check (
      (
        status = 'processing'
        and lease_owner is not null
        and lease_token is not null
        and lease_expires_at is not null
      )
      or (
        status <> 'processing'
        and lease_owner is null
        and lease_token is null
        and lease_expires_at is null
      )
    )
);

create index wiki_compilation_items_claim_idx
  on wiki_compilation_items(status, available_at, created_at)
  where status in ('pending', 'processing');
create index wiki_compilation_items_brand_version_idx
  on wiki_compilation_items(workspace_id, brand_id, wiki_version_id, status);

create table wiki_retrieval_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  wiki_version_id uuid null,
  question text not null,
  selected_page_ids uuid[] not null default '{}',
  selected_chunk_ids uuid[] not null default '{}',
  selected_scores jsonb not null default '[]'::jsonb,
  used_page_ids uuid[] not null default '{}',
  used_destination_url_ids uuid[] not null default '{}',
  route text not null,
  reason_code text null,
  retrieval_latency_ms integer not null default 0,
  total_latency_ms integer not null default 0,
  created_at timestamptz not null default now(),
  constraint wiki_retrieval_runs_version_ownership_fk
    foreign key (wiki_version_id, workspace_id, brand_id)
    references wiki_versions(id, workspace_id, brand_id) on delete restrict,
  constraint wiki_retrieval_runs_brand_ownership_fk
    foreign key (brand_id, workspace_id)
    references brands(id, workspace_id) on delete cascade,
  constraint wiki_retrieval_runs_route_check
    check (route in ('direct_faq', 'wiki_answer', 'fallback')),
  constraint wiki_retrieval_runs_scores_check check (jsonb_typeof(selected_scores) = 'array'),
  constraint wiki_retrieval_runs_latency_check
    check (retrieval_latency_ms >= 0 and total_latency_ms >= 0),
  constraint wiki_retrieval_runs_question_check check (length(trim(question)) > 0)
);

create index wiki_retrieval_runs_brand_created_idx
  on wiki_retrieval_runs(workspace_id, brand_id, created_at desc);
create index wiki_retrieval_runs_gap_idx
  on wiki_retrieval_runs(workspace_id, brand_id, reason_code, created_at desc)
  where reason_code in ('knowledge_gap', 'low_confidence');

create table wiki_maintenance_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  source_wiki_version_id uuid not null,
  target_wiki_version_id uuid null,
  status text not null default 'pending',
  target_question_count integer not null default 0,
  changed_stable_keys text[] not null default '{}',
  issue_count integer not null default 0,
  result_json jsonb not null default '{}'::jsonb,
  error_message text null,
  started_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wiki_maintenance_runs_source_version_fk
    foreign key (source_wiki_version_id, workspace_id, brand_id)
    references wiki_versions(id, workspace_id, brand_id) on delete restrict,
  constraint wiki_maintenance_runs_target_version_fk
    foreign key (target_wiki_version_id, workspace_id, brand_id)
    references wiki_versions(id, workspace_id, brand_id) on delete restrict,
  constraint wiki_maintenance_runs_status_check
    check (status in ('pending', 'processing', 'succeeded', 'failed')),
  constraint wiki_maintenance_runs_counts_check
    check (target_question_count >= 0 and issue_count >= 0),
  constraint wiki_maintenance_runs_result_check check (jsonb_typeof(result_json) = 'object')
);

create index wiki_maintenance_runs_brand_created_idx
  on wiki_maintenance_runs(workspace_id, brand_id, created_at desc);

create table wiki_issues (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  wiki_version_id uuid not null,
  wiki_page_id uuid null,
  issue_type text not null,
  severity text not null default 'warning',
  status text not null default 'open',
  stable_key text null,
  question text null,
  detail_json jsonb not null default '{}'::jsonb,
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wiki_issues_version_ownership_fk
    foreign key (wiki_version_id, workspace_id, brand_id)
    references wiki_versions(id, workspace_id, brand_id) on delete cascade,
  constraint wiki_issues_page_ownership_fk
    foreign key (wiki_page_id, workspace_id, brand_id, wiki_version_id)
    references wiki_pages(id, workspace_id, brand_id, wiki_version_id) on delete cascade,
  constraint wiki_issues_severity_check check (severity in ('info', 'warning', 'error')),
  constraint wiki_issues_status_check check (status in ('open', 'resolved', 'dismissed')),
  constraint wiki_issues_type_check
    check (issue_type in ('knowledge_gap', 'low_confidence', 'source_conflict', 'missing_page', 'broken_link', 'unverified_url', 'validation_error')),
  constraint wiki_issues_detail_check check (jsonb_typeof(detail_json) = 'object')
);

create index wiki_issues_brand_status_idx
  on wiki_issues(workspace_id, brand_id, status, created_at desc);

drop trigger if exists wiki_build_requests_set_updated_at on wiki_build_requests;
create trigger wiki_build_requests_set_updated_at
before update on wiki_build_requests
for each row execute function set_updated_at();

drop trigger if exists wiki_source_units_set_updated_at on wiki_source_units;
create trigger wiki_source_units_set_updated_at
before update on wiki_source_units
for each row execute function set_updated_at();

drop trigger if exists wiki_pages_set_updated_at on wiki_pages;
create trigger wiki_pages_set_updated_at
before update on wiki_pages
for each row execute function set_updated_at();

drop trigger if exists wiki_page_chunks_set_updated_at on wiki_page_chunks;
create trigger wiki_page_chunks_set_updated_at
before update on wiki_page_chunks
for each row execute function set_updated_at();

drop trigger if exists wiki_compilation_items_set_updated_at on wiki_compilation_items;
create trigger wiki_compilation_items_set_updated_at
before update on wiki_compilation_items
for each row execute function set_updated_at();

drop trigger if exists wiki_maintenance_runs_set_updated_at on wiki_maintenance_runs;
create trigger wiki_maintenance_runs_set_updated_at
before update on wiki_maintenance_runs
for each row execute function set_updated_at();

drop trigger if exists wiki_issues_set_updated_at on wiki_issues;
create trigger wiki_issues_set_updated_at
before update on wiki_issues
for each row execute function set_updated_at();
