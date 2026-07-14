begin;

alter table knowledge_entries
  add column entry_type text not null default 'faq',
  add column title text null,
  add column content text null,
  add column aliases text[] not null default '{}',
  add column structured_data jsonb not null default '{}'::jsonb,
  add column direct_reply_enabled boolean not null default true;

update knowledge_entries
set title = question,
    content = answer
where entry_type = 'faq'
  and (title is null or content is null);

alter table knowledge_entries
  drop constraint knowledge_entries_normalized_question_check,
  drop constraint knowledge_entries_question_check,
  drop constraint knowledge_entries_answer_check,
  alter column normalized_question drop not null,
  alter column question drop not null,
  alter column answer drop not null,
  add constraint knowledge_entries_entry_type_check
    check (entry_type in ('faq', 'product', 'policy')),
  add constraint knowledge_entries_normalized_key_check
    check (normalized_question is not null and length(trim(normalized_question)) > 0),
  add constraint knowledge_entries_faq_fields_check
    check (
      entry_type <> 'faq'
      or (
        question is not null and length(trim(question)) > 0
        and answer is not null and length(trim(answer)) > 0
      )
    ),
  add constraint knowledge_entries_item_fields_check
    check (
      entry_type not in ('product', 'policy')
      or (
        title is not null and length(trim(title)) > 0
        and content is not null and length(trim(content)) > 0
      )
    ),
  add constraint knowledge_entries_structured_data_object_check
    check (jsonb_typeof(structured_data) = 'object');

create table wiki_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  status text not null default 'building',
  source_count integer not null default 0,
  document_count integer not null default 0,
  chunk_count integer not null default 0,
  prompt_version text null,
  embedding_model text null,
  embedding_version text null,
  error_message text null,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  activated_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wiki_versions_status_check
    check (status in ('building', 'active', 'failed', 'superseded')),
  constraint wiki_versions_counts_check
    check (source_count >= 0 and document_count >= 0 and chunk_count >= 0),
  constraint wiki_versions_tenant_identity_unique unique (id, workspace_id, brand_id)
);

create unique index wiki_versions_brand_active_unique
  on wiki_versions(brand_id)
  where status = 'active';
create index wiki_versions_brand_created_idx
  on wiki_versions(brand_id, created_at desc);

create table wiki_build_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  wiki_version_id uuid not null,
  source_kind text not null,
  source_id uuid not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  error_message text null,
  started_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wiki_build_items_version_ownership_fk
    foreign key (wiki_version_id, workspace_id, brand_id)
    references wiki_versions(id, workspace_id, brand_id) on delete cascade,
  constraint wiki_build_items_source_kind_check
    check (source_kind in ('faq', 'product', 'policy', 'owned_snapshot')),
  constraint wiki_build_items_status_check
    check (status in ('pending', 'processing', 'succeeded', 'failed')),
  constraint wiki_build_items_attempt_count_check check (attempt_count >= 0),
  constraint wiki_build_items_version_source_unique
    unique (wiki_version_id, source_kind, source_id)
);

create index wiki_build_items_claim_idx
  on wiki_build_items(status, created_at)
  where status in ('pending', 'processing');

alter table wiki_documents
  add column wiki_version_id uuid null,
  add column normalized_json jsonb not null default '{}'::jsonb,
  add column source_url text null,
  add constraint wiki_documents_version_ownership_fk
    foreign key (wiki_version_id, workspace_id, brand_id)
    references wiki_versions(id, workspace_id, brand_id) on delete cascade,
  add constraint wiki_documents_normalized_json_object_check
    check (jsonb_typeof(normalized_json) = 'object');

alter table wiki_documents
  drop constraint wiki_documents_source_kind_check,
  drop constraint wiki_documents_source_reference_check,
  add constraint wiki_documents_source_kind_check
    check (source_kind in ('faq', 'product', 'policy', 'owned_snapshot')),
  add constraint wiki_documents_source_reference_check check (
    (
      source_kind in ('faq', 'product', 'policy')
      and knowledge_entry_id is not null
      and source_snapshot_id is null
    )
    or (
      source_kind = 'owned_snapshot'
      and source_snapshot_id is not null
      and knowledge_entry_id is null
    )
  );

update wiki_documents document
set source_url = source.url
from source_snapshots snapshot
join source_urls source on source.id = snapshot.source_url_id
where document.source_snapshot_id = snapshot.id
  and document.source_url is null;

insert into wiki_versions (
  workspace_id, brand_id, status, source_count, document_count, chunk_count,
  prompt_version, completed_at, activated_at
)
select
  document.workspace_id,
  document.brand_id,
  'active',
  count(distinct document.id)::integer,
  count(distinct document.id)::integer,
  count(distinct chunk.id)::integer,
  'legacy-v1',
  now(),
  now()
from wiki_documents document
left join wiki_chunks chunk on chunk.wiki_document_id = document.id and chunk.enabled
where document.is_active
group by document.workspace_id, document.brand_id;

update wiki_documents document
set wiki_version_id = version.id
from wiki_versions version
where document.workspace_id = version.workspace_id
  and document.brand_id = version.brand_id
  and document.is_active
  and version.status = 'active';

drop index if exists wiki_documents_active_faq_unique;
drop index if exists wiki_documents_active_snapshot_unique;

create unique index wiki_documents_version_knowledge_entry_unique
  on wiki_documents(wiki_version_id, knowledge_entry_id)
  where wiki_version_id is not null and knowledge_entry_id is not null;
create unique index wiki_documents_version_snapshot_unique
  on wiki_documents(wiki_version_id, source_snapshot_id)
  where wiki_version_id is not null and source_snapshot_id is not null;
create index wiki_documents_version_idx
  on wiki_documents(wiki_version_id, created_at);

create or replace function activate_wiki_version(p_wiki_version_id uuid)
returns boolean
language plpgsql
as $$
declare
  target_version wiki_versions%rowtype;
  failure_reason text;
begin
  select *
  into target_version
  from wiki_versions
  where id = p_wiki_version_id
  for update;

  if not found then
    raise exception 'wiki_version_not_found';
  end if;

  if target_version.status <> 'building' then
    return false;
  end if;

  if exists (
    select 1
    from wiki_build_items item
    where item.wiki_version_id = p_wiki_version_id
      and item.status <> 'succeeded'
  ) then
    failure_reason := 'wiki_build_items_incomplete';
  elsif not exists (
    select 1
    from wiki_documents document
    where document.wiki_version_id = p_wiki_version_id
  ) then
    failure_reason := 'wiki_documents_missing';
  elsif not exists (
    select 1
    from wiki_documents document
    join wiki_chunks chunk on chunk.wiki_document_id = document.id
    where document.wiki_version_id = p_wiki_version_id
      and chunk.enabled
  ) then
    failure_reason := 'wiki_chunks_missing';
  end if;

  if failure_reason is not null then
    update wiki_versions
    set status = 'failed',
        error_message = failure_reason,
        completed_at = now(),
        updated_at = now()
    where id = p_wiki_version_id;

    update wiki_documents
    set is_active = false,
        refreshed_at = now()
    where wiki_version_id = p_wiki_version_id;

    return false;
  end if;

  perform id
  from wiki_versions
  where workspace_id = target_version.workspace_id
    and brand_id = target_version.brand_id
    and status = 'active'
  for update;

  update wiki_documents
  set is_active = false,
      refreshed_at = now()
  where workspace_id = target_version.workspace_id
    and brand_id = target_version.brand_id
    and is_active;

  update wiki_versions
  set status = 'superseded',
      completed_at = coalesce(completed_at, now()),
      updated_at = now()
  where workspace_id = target_version.workspace_id
    and brand_id = target_version.brand_id
    and status = 'active';

  update wiki_documents
  set is_active = true,
      refreshed_at = now()
  where wiki_version_id = p_wiki_version_id;

  update wiki_versions
  set status = 'active',
      source_count = (
        select count(*)::integer from wiki_build_items item
        where item.wiki_version_id = p_wiki_version_id
      ),
      document_count = (
        select count(*)::integer from wiki_documents document
        where document.wiki_version_id = p_wiki_version_id
      ),
      chunk_count = (
        select count(*)::integer
        from wiki_documents document
        join wiki_chunks chunk on chunk.wiki_document_id = document.id
        where document.wiki_version_id = p_wiki_version_id and chunk.enabled
      ),
      error_message = null,
      completed_at = now(),
      activated_at = now(),
      updated_at = now()
  where id = p_wiki_version_id;

  return true;
end;
$$;

drop trigger if exists wiki_versions_set_updated_at on wiki_versions;
create trigger wiki_versions_set_updated_at
before update on wiki_versions
for each row execute function set_updated_at();

drop trigger if exists wiki_build_items_set_updated_at on wiki_build_items;
create trigger wiki_build_items_set_updated_at
before update on wiki_build_items
for each row execute function set_updated_at();

commit;
