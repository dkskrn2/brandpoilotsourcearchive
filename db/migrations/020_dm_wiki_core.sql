begin;

create table knowledge_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  file_name text not null,
  source_rows jsonb not null default '[]'::jsonb,
  result_json jsonb not null default '{}'::jsonb,
  status text not null default 'succeeded',
  created_at timestamptz not null default now(),
  constraint knowledge_imports_status_check check (status in ('processing', 'succeeded', 'failed')),
  constraint knowledge_imports_source_rows_array_check check (jsonb_typeof(source_rows) = 'array'),
  constraint knowledge_imports_result_object_check check (jsonb_typeof(result_json) = 'object')
);

create index knowledge_imports_brand_created_idx on knowledge_imports(brand_id, created_at desc);

create table knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  normalized_question text not null,
  question text not null,
  answer text not null,
  category text null,
  keywords text[] not null default '{}',
  priority int not null default 0,
  enabled boolean not null default true,
  last_import_id uuid not null references knowledge_imports(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_entries_normalized_question_check check (length(trim(normalized_question)) > 0),
  constraint knowledge_entries_question_check check (length(trim(question)) > 0),
  constraint knowledge_entries_answer_check check (length(trim(answer)) > 0),
  unique (brand_id, normalized_question)
);

create index knowledge_entries_brand_enabled_priority_idx
  on knowledge_entries(brand_id, enabled, priority desc, updated_at desc);

create table wiki_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  source_kind text not null,
  knowledge_entry_id uuid null references knowledge_entries(id) on delete cascade,
  source_snapshot_id uuid null references source_snapshots(id) on delete cascade,
  title text null,
  content text not null,
  content_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  refreshed_at timestamptz not null default now(),
  constraint wiki_documents_source_kind_check check (source_kind in ('faq', 'owned_snapshot')),
  constraint wiki_documents_source_reference_check check (
    (source_kind = 'faq' and knowledge_entry_id is not null and source_snapshot_id is null)
    or (source_kind = 'owned_snapshot' and source_snapshot_id is not null and knowledge_entry_id is null)
  )
);

create unique index wiki_documents_active_faq_unique
  on wiki_documents(brand_id, knowledge_entry_id)
  where is_active and knowledge_entry_id is not null;
create unique index wiki_documents_active_snapshot_unique
  on wiki_documents(brand_id, source_snapshot_id)
  where is_active and source_snapshot_id is not null;
create index wiki_documents_brand_active_idx on wiki_documents(brand_id, is_active, refreshed_at desc);

create table wiki_chunks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  wiki_document_id uuid not null references wiki_documents(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  content_hash text not null,
  search_vector tsvector not null default ''::tsvector,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wiki_chunks_index_check check (chunk_index >= 0),
  unique (wiki_document_id, chunk_index)
);

create index wiki_chunks_brand_enabled_idx on wiki_chunks(brand_id, enabled, updated_at desc);

create table instagram_dm_settings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null unique references brands(id) on delete cascade,
  enabled boolean not null default false,
  fallback_message text not null default '현재 확인 가능한 안내 자료가 부족합니다. 담당자가 확인 후 안내드리겠습니다.',
  error_message text not null default '답변을 준비하는 중 문제가 발생했습니다. 잠시 후 다시 문의해 주세요.',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instagram_dm_settings_fallback_message_check check (length(trim(fallback_message)) > 0),
  constraint instagram_dm_settings_error_message_check check (length(trim(error_message)) > 0)
);

create table instagram_dm_conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  brand_channel_id uuid not null references brand_channels(id) on delete cascade,
  external_participant_id text not null,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_channel_id, external_participant_id)
);

create index instagram_dm_conversations_brand_last_message_idx
  on instagram_dm_conversations(brand_id, last_message_at desc);

create table instagram_dm_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  brand_channel_id uuid not null references brand_channels(id) on delete cascade,
  conversation_id uuid not null references instagram_dm_conversations(id) on delete cascade,
  external_message_id text not null,
  direction text not null,
  message_type text not null default 'text',
  body text null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint instagram_dm_messages_direction_check check (direction in ('inbound', 'outbound')),
  constraint instagram_dm_messages_type_check check (message_type in ('text', 'unsupported_media', 'system')),
  constraint instagram_dm_messages_payload_object_check check (jsonb_typeof(raw_payload) = 'object')
);

create unique index instagram_dm_messages_channel_external_unique
  on instagram_dm_messages(brand_channel_id, external_message_id);
create index instagram_dm_messages_conversation_created_idx
  on instagram_dm_messages(conversation_id, created_at desc);

create table unanswered_questions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  conversation_id uuid null references instagram_dm_conversations(id) on delete set null,
  instagram_dm_message_id uuid null references instagram_dm_messages(id) on delete set null,
  question text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz null
);

create index unanswered_questions_brand_created_idx on unanswered_questions(brand_id, created_at desc);

create table worker_instances (
  worker_id text primary key,
  worker_type text not null,
  last_heartbeat_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worker_instances_type_check check (worker_type in ('image', 'dm')),
  constraint worker_instances_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

alter table jobs add column if not exists dedupe_key text null;
alter table jobs drop constraint if exists jobs_type_check;
alter table jobs add constraint jobs_type_check check (
  job_type in (
    'daily_generation_enqueue', 'source_crawl', 'topic_select', 'master_draft_generate',
    'channel_output_generate', 'auto_approval_check', 'instagram_feed_render',
    'instagram_story_render', 'instagram_reel_render', 'threads_text_render',
    'artifact_upload', 'instagram_publish', 'threads_publish', 'token_health_check',
    'storage_cleanup', 'wiki_refresh', 'instagram_dm_reply'
  )
);

create unique index jobs_active_dm_reply_dedupe_unique
  on jobs(job_type, dedupe_key)
  where job_type = 'instagram_dm_reply'
    and dedupe_key is not null
    and status in ('queued', 'running');
create unique index jobs_active_wiki_refresh_dedupe_unique
  on jobs(job_type, dedupe_key)
  where job_type = 'wiki_refresh'
    and dedupe_key is not null
    and status in ('queued', 'running');

alter table llm_runs drop constraint if exists llm_runs_purpose_check;
alter table llm_runs add constraint llm_runs_purpose_check check (
  purpose in ('source_summary', 'master_draft', 'channel_output', 'regeneration', 'policy_check', 'wiki_refresh', 'embedding', 'dm_reply')
);
alter table llm_runs drop constraint if exists llm_runs_status_check;
alter table llm_runs add constraint llm_runs_status_check check (status in ('running', 'succeeded', 'failed'));

drop trigger if exists knowledge_entries_set_updated_at on knowledge_entries;
create trigger knowledge_entries_set_updated_at before update on knowledge_entries for each row execute function set_updated_at();
drop trigger if exists wiki_chunks_set_updated_at on wiki_chunks;
create trigger wiki_chunks_set_updated_at before update on wiki_chunks for each row execute function set_updated_at();
drop trigger if exists instagram_dm_settings_set_updated_at on instagram_dm_settings;
create trigger instagram_dm_settings_set_updated_at before update on instagram_dm_settings for each row execute function set_updated_at();
drop trigger if exists instagram_dm_conversations_set_updated_at on instagram_dm_conversations;
create trigger instagram_dm_conversations_set_updated_at before update on instagram_dm_conversations for each row execute function set_updated_at();
drop trigger if exists worker_instances_set_updated_at on worker_instances;
create trigger worker_instances_set_updated_at before update on worker_instances for each row execute function set_updated_at();

commit;
