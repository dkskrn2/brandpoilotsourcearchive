-- requires: pgvector
begin;

create extension if not exists vector;

alter table wiki_chunks
  add column embedding vector(1536) null,
  add column embedding_model text null,
  add column embedding_version text null;

create index wiki_chunks_embedding_hnsw_idx
  on wiki_chunks using hnsw (embedding vector_cosine_ops)
  where enabled and embedding is not null;

create index wiki_chunks_search_vector_gin_idx
  on wiki_chunks using gin(search_vector);

create or replace function get_wiki_refresh_sources(
  p_workspace_id uuid,
  p_brand_id uuid
)
returns table (
  source_kind text,
  source_id uuid,
  title text,
  content text,
  content_hash text
)
language sql
stable
as $$
  select
    'faq'::text,
    entry.id,
    entry.question,
    concat('질문: ', entry.question, E'\n\n답변: ', entry.answer),
    md5(concat_ws(E'\n', entry.question, entry.answer, coalesce(entry.category, ''), array_to_string(entry.keywords, ',')))
  from knowledge_entries entry
  where entry.workspace_id = p_workspace_id
    and entry.brand_id = p_brand_id
    and entry.enabled
  union all
  select
    'owned_snapshot'::text,
    snapshot.id,
    coalesce(snapshot.extracted_title, source.url),
    coalesce(snapshot.extracted_text, snapshot.raw_text, snapshot.summary, ''),
    coalesce(snapshot.content_hash, md5(coalesce(snapshot.extracted_text, snapshot.raw_text, snapshot.summary, '')))
  from source_urls source
  join lateral (
    select latest.*
    from source_snapshots latest
    where latest.source_url_id = source.id
      and latest.status = 'succeeded'
    order by latest.fetched_at desc
    limit 1
  ) snapshot on true
  where source.workspace_id = p_workspace_id
    and source.brand_id = p_brand_id
    and source.source_type = 'owned'
    and source.enabled;
$$;

create or replace function replace_wiki_refresh_result(
  p_workspace_id uuid,
  p_brand_id uuid,
  p_documents jsonb
)
returns integer
language plpgsql
as $$
declare
  inserted_chunks integer;
begin
  if jsonb_typeof(p_documents) <> 'array' then
    raise exception 'wiki_documents_array_required';
  end if;

  update wiki_documents
  set is_active = false, refreshed_at = now()
  where workspace_id = p_workspace_id
    and brand_id = p_brand_id
    and is_active;

  insert into wiki_documents (
    workspace_id, brand_id, source_kind, knowledge_entry_id, source_snapshot_id, title, content, content_hash, is_active, refreshed_at
  )
  select
    p_workspace_id,
    p_brand_id,
    input.source_kind,
    case when input.source_kind = 'faq' then input.source_id end,
    case when input.source_kind = 'owned_snapshot' then input.source_id end,
    input.title,
    input.content,
    input.content_hash,
    true,
    now()
  from jsonb_to_recordset(p_documents) as input(
    source_kind text,
    source_id uuid,
    title text,
    content text,
    content_hash text,
    chunks jsonb
  );

  insert into wiki_chunks (
    workspace_id, brand_id, wiki_document_id, chunk_index, content, content_hash, search_vector, embedding, embedding_model, embedding_version, enabled
  )
  select
    p_workspace_id,
    p_brand_id,
    document.id,
    chunk.chunk_index,
    chunk.content,
    chunk.content_hash,
    to_tsvector('simple', chunk.content),
    nullif(chunk.embedding, '')::vector,
    nullif(chunk.embedding_model, ''),
    nullif(chunk.embedding_version, ''),
    true
  from jsonb_to_recordset(p_documents) as input(
    source_kind text,
    source_id uuid,
    content_hash text,
    chunks jsonb
  )
  join wiki_documents document
    on document.workspace_id = p_workspace_id
   and document.brand_id = p_brand_id
   and document.is_active
   and document.source_kind = input.source_kind
   and document.content_hash = input.content_hash
   and (
     (input.source_kind = 'faq' and document.knowledge_entry_id = input.source_id)
     or (input.source_kind = 'owned_snapshot' and document.source_snapshot_id = input.source_id)
   )
  cross join lateral jsonb_to_recordset(input.chunks) as chunk(
    chunk_index integer,
    content text,
    content_hash text,
    embedding text,
    embedding_model text,
    embedding_version text
  );

  get diagnostics inserted_chunks = row_count;
  return inserted_chunks;
end;
$$;

create or replace function search_brand_wiki(
  p_workspace_id uuid,
  p_brand_id uuid,
  p_query_embedding vector(1536),
  p_query text,
  p_limit integer default 8
)
returns table (
  id uuid,
  wiki_document_id uuid,
  source_kind text,
  content text,
  score double precision
)
language sql
stable
as $$
  with candidates as (
    select
      chunk.id,
      chunk.wiki_document_id,
      document.source_kind,
      chunk.content,
      row_number() over (order by chunk.embedding <=> p_query_embedding) as vector_rank,
      row_number() over (order by ts_rank_cd(chunk.search_vector, websearch_to_tsquery('simple', p_query)) desc) as keyword_rank
    from wiki_chunks chunk
    join wiki_documents document on document.id = chunk.wiki_document_id
    where chunk.workspace_id = p_workspace_id
      and chunk.brand_id = p_brand_id
      and chunk.enabled
      and document.is_active
      and chunk.embedding is not null
  )
  select
    id,
    wiki_document_id,
    source_kind,
    content,
    (0.7 / (60 + vector_rank) + 0.3 / (60 + keyword_rank))::double precision as score
  from candidates
  order by score desc, id
  limit greatest(1, least(coalesce(p_limit, 8), 8));
$$;

create or replace function get_dm_conversation_history(
  p_workspace_id uuid,
  p_brand_id uuid,
  p_conversation_id uuid,
  p_limit integer default 6
)
returns table (
  direction text,
  message_type text,
  body text,
  created_at timestamptz
)
language sql
stable
as $$
  select message.direction, message.message_type, message.body, message.created_at
  from instagram_dm_messages message
  join instagram_dm_conversations conversation on conversation.id = message.conversation_id
  where message.workspace_id = p_workspace_id
    and message.brand_id = p_brand_id
    and message.conversation_id = p_conversation_id
    and conversation.workspace_id = p_workspace_id
    and conversation.brand_id = p_brand_id
  order by message.created_at desc
  limit greatest(1, least(coalesce(p_limit, 6), 6));
$$;

commit;
