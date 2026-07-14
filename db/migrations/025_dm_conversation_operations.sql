begin;

alter table instagram_dm_conversations
  add column automation_status text not null default 'active',
  add column attention_status text not null default 'none',
  add column unread_count integer not null default 0,
  add column participant_name text null,
  add column participant_username text null,
  add column participant_profile_url text null,
  add column profile_fetched_at timestamptz null,
  add constraint instagram_dm_conversations_automation_status_check
    check (automation_status in ('active', 'paused')),
  add constraint instagram_dm_conversations_attention_status_check
    check (attention_status in ('none', 'open', 'resolved')),
  add constraint instagram_dm_conversations_unread_count_check
    check (unread_count >= 0),
  add constraint instagram_dm_conversations_tenant_identity_unique
    unique (id, workspace_id, brand_id);

alter table instagram_dm_messages
  add constraint instagram_dm_messages_tenant_identity_unique
    unique (id, workspace_id, brand_id, conversation_id),
  add constraint instagram_dm_messages_conversation_ownership_fk
    foreign key (conversation_id, workspace_id, brand_id)
    references instagram_dm_conversations(id, workspace_id, brand_id)
    on delete cascade;

alter table jobs
  add constraint jobs_tenant_identity_unique
    unique (id, workspace_id, brand_id);

create table dm_turns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  conversation_id uuid not null,
  aggregated_text text not null,
  status text not null default 'collecting',
  opened_at timestamptz not null default now(),
  closes_at timestamptz not null default (now() + interval '3 seconds'),
  closed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dm_turns_aggregated_text_check check (length(trim(aggregated_text)) > 0),
  constraint dm_turns_status_check
    check (status in ('collecting', 'queued', 'processing', 'completed', 'skipped')),
  constraint dm_turns_closes_at_check check (closes_at >= opened_at),
  constraint dm_turns_closed_at_check check (closed_at is null or closed_at >= opened_at),
  constraint dm_turns_tenant_identity_unique
    unique (id, workspace_id, brand_id, conversation_id),
  constraint dm_turns_conversation_ownership_fk
    foreign key (conversation_id, workspace_id, brand_id)
    references instagram_dm_conversations(id, workspace_id, brand_id)
    on delete cascade
);

create unique index dm_turns_collecting_conversation_unique
  on dm_turns(conversation_id)
  where status = 'collecting';
create index dm_turns_conversation_opened_idx
  on dm_turns(conversation_id, opened_at desc);
create index dm_turns_brand_status_closes_idx
  on dm_turns(brand_id, status, closes_at);

alter table instagram_dm_messages
  add column turn_id uuid null,
  add constraint instagram_dm_messages_turn_ownership_fk
    foreign key (turn_id, workspace_id, brand_id, conversation_id)
    references dm_turns(id, workspace_id, brand_id, conversation_id)
    on delete no action;

create index instagram_dm_messages_turn_created_idx
  on instagram_dm_messages(turn_id, created_at asc)
  where turn_id is not null;

create table dm_attention_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  conversation_id uuid not null,
  trigger_message_id uuid null,
  trigger_turn_id uuid null,
  attention_type text not null,
  reason_code text not null,
  status text not null default 'open',
  detail_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz null,
  updated_at timestamptz not null default now(),
  constraint dm_attention_items_type_check
    check (attention_type in ('restricted_action', 'complaint', 'knowledge_gap', 'delivery_unknown', 'processing_error')),
  constraint dm_attention_items_reason_code_check
    check (reason_code in ('direct_faq', 'wiki_answer', 'restricted_action', 'complaint', 'knowledge_gap', 'low_confidence', 'processing_error', 'system_event')),
  constraint dm_attention_items_status_check check (status in ('open', 'resolved')),
  constraint dm_attention_items_detail_object_check check (jsonb_typeof(detail_json) = 'object'),
  constraint dm_attention_items_resolved_at_check
    check ((status = 'open' and resolved_at is null) or (status = 'resolved' and resolved_at is not null)),
  constraint dm_attention_items_conversation_ownership_fk
    foreign key (conversation_id, workspace_id, brand_id)
    references instagram_dm_conversations(id, workspace_id, brand_id)
    on delete cascade,
  constraint dm_attention_items_trigger_message_ownership_fk
    foreign key (trigger_message_id, workspace_id, brand_id, conversation_id)
    references instagram_dm_messages(id, workspace_id, brand_id, conversation_id)
    on delete no action,
  constraint dm_attention_items_trigger_turn_ownership_fk
    foreign key (trigger_turn_id, workspace_id, brand_id, conversation_id)
    references dm_turns(id, workspace_id, brand_id, conversation_id)
    on delete no action
);

create index dm_attention_items_brand_status_created_idx
  on dm_attention_items(brand_id, status, created_at desc);
create index dm_attention_items_conversation_status_created_idx
  on dm_attention_items(conversation_id, status, created_at desc);
create index dm_attention_items_trigger_turn_idx
  on dm_attention_items(trigger_turn_id)
  where trigger_turn_id is not null;

create table dm_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  conversation_id uuid not null,
  job_id uuid not null,
  dedupe_key text not null,
  recipient_id text not null,
  body text not null,
  decision text not null,
  reason_code text not null,
  status text not null default 'prepared',
  provider_message_id text null,
  error text null,
  prepared_at timestamptz not null default now(),
  sending_at timestamptz null,
  sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dm_delivery_attempts_job_unique unique (job_id),
  constraint dm_delivery_attempts_tenant_identity_unique
    unique (id, workspace_id, brand_id, conversation_id),
  constraint dm_delivery_attempts_recipient_check check (length(trim(recipient_id)) > 0),
  constraint dm_delivery_attempts_body_check check (length(trim(body)) > 0),
  constraint dm_delivery_attempts_decision_check
    check (decision in ('answer', 'fallback', 'ignore', 'error')),
  constraint dm_delivery_attempts_reason_code_check
    check (reason_code in ('direct_faq', 'wiki_answer', 'restricted_action', 'complaint', 'knowledge_gap', 'low_confidence', 'processing_error', 'system_event')),
  constraint dm_delivery_attempts_status_check
    check (status in ('prepared', 'sending', 'sent', 'unknown', 'failed')),
  constraint dm_delivery_attempts_conversation_ownership_fk
    foreign key (conversation_id, workspace_id, brand_id)
    references instagram_dm_conversations(id, workspace_id, brand_id)
    on delete cascade,
  constraint dm_delivery_attempts_job_ownership_fk
    foreign key (job_id, workspace_id, brand_id)
    references jobs(id, workspace_id, brand_id)
    on delete restrict
);

create unique index dm_delivery_attempts_dedupe_unique
  on dm_delivery_attempts(dedupe_key);
create index dm_delivery_attempts_brand_status_created_idx
  on dm_delivery_attempts(brand_id, status, created_at desc);
create index dm_delivery_attempts_conversation_created_idx
  on dm_delivery_attempts(conversation_id, created_at desc);
create index dm_delivery_attempts_provider_message_idx
  on dm_delivery_attempts(provider_message_id)
  where provider_message_id is not null;

alter table instagram_dm_messages
  add column decision text null,
  add column reason_code text null,
  add column delivery_attempt_id uuid null,
  add constraint instagram_dm_messages_decision_check
    check (decision is null or decision in ('answer', 'fallback', 'ignore', 'error')),
  add constraint instagram_dm_messages_reason_code_check
    check (reason_code is null or reason_code in ('direct_faq', 'wiki_answer', 'restricted_action', 'complaint', 'knowledge_gap', 'low_confidence', 'processing_error', 'system_event')),
  add constraint instagram_dm_messages_delivery_ownership_fk
    foreign key (delivery_attempt_id, workspace_id, brand_id, conversation_id)
    references dm_delivery_attempts(id, workspace_id, brand_id, conversation_id)
    on delete no action;

create index instagram_dm_messages_delivery_attempt_idx
  on instagram_dm_messages(delivery_attempt_id)
  where delivery_attempt_id is not null;

alter table jobs drop constraint if exists jobs_type_check;
alter table jobs add constraint jobs_type_check check (
  job_type in (
    'daily_generation_enqueue', 'source_crawl', 'topic_select', 'master_draft_generate',
    'channel_output_generate', 'auto_approval_check', 'instagram_feed_render',
    'instagram_story_render', 'instagram_reel_render', 'threads_text_render',
    'artifact_upload', 'instagram_publish', 'threads_publish', 'token_health_check',
    'storage_cleanup', 'wiki_refresh', 'instagram_dm_reply', 'instagram_dm_profile_refresh'
  )
);

create unique index jobs_active_dm_profile_refresh_dedupe_unique
  on jobs(job_type, dedupe_key)
  where job_type = 'instagram_dm_profile_refresh'
    and dedupe_key is not null
    and status in ('queued', 'running');

create trigger dm_turns_set_updated_at
  before update on dm_turns
  for each row execute function set_updated_at();
create trigger dm_attention_items_set_updated_at
  before update on dm_attention_items
  for each row execute function set_updated_at();
create trigger dm_delivery_attempts_set_updated_at
  before update on dm_delivery_attempts
  for each row execute function set_updated_at();

commit;
