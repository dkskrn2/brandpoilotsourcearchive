begin;

create or replace function search_brand_wiki_v2(
  p_workspace_id uuid,
  p_brand_id uuid,
  p_query_embedding vector(1536),
  p_query text,
  p_limit integer default 8
)
returns table (
  chunk_id uuid,
  wiki_document_id uuid,
  knowledge_entry_id uuid,
  source_kind text,
  title text,
  content text,
  direct_answer text,
  cosine_similarity double precision,
  keyword_match double precision,
  rrf_score double precision
)
language sql
stable
as $$
  with scored as (
    select
      chunk.id as chunk_id,
      document.id as wiki_document_id,
      document.knowledge_entry_id,
      document.source_kind,
      document.title,
      chunk.content,
      case
        when entry.entry_type = 'faq' and entry.enabled and entry.direct_reply_enabled
          then entry.answer
        else null
      end as direct_answer,
      (chunk.embedding <=> p_query_embedding)::double precision as distance,
      ts_rank_cd(
        chunk.search_vector,
        websearch_to_tsquery('simple', coalesce(p_query, ''))
      )::double precision as keyword_match
    from wiki_chunks chunk
    join wiki_documents document on document.id = chunk.wiki_document_id
    join wiki_versions version on version.id = document.wiki_version_id
    left join knowledge_entries entry
      on entry.id = document.knowledge_entry_id
     and entry.workspace_id = p_workspace_id
     and entry.brand_id = p_brand_id
    where chunk.workspace_id = p_workspace_id
      and chunk.brand_id = p_brand_id
      and document.workspace_id = p_workspace_id
      and document.brand_id = p_brand_id
      and version.workspace_id = p_workspace_id
      and version.brand_id = p_brand_id
      and version.status = 'active'
      and chunk.enabled
      and chunk.embedding is not null
  ), ranked as (
    select
      scored.*,
      row_number() over (order by distance, chunk_id) as vector_rank,
      row_number() over (order by keyword_match desc, chunk_id) as keyword_rank
    from scored
  ), results as (
    select
      chunk_id,
      wiki_document_id,
      knowledge_entry_id,
      source_kind,
      title,
      content,
      direct_answer,
      (1 - distance)::double precision as cosine_similarity,
      keyword_match,
      (
        0.7 / (60 + vector_rank)
        + 0.3 / (60 + keyword_rank)
      )::double precision as rrf_score
    from ranked
  )
  select *
  from results
  order by rrf_score desc, chunk_id
  limit greatest(1, least(coalesce(p_limit, 8), 8));
$$;

create or replace function find_direct_faq_exact(
  p_workspace_id uuid,
  p_brand_id uuid,
  p_query text
)
returns table (
  knowledge_entry_id uuid,
  conflict_marker text
)
language sql
stable
as $$
  with normalized_input as (
    select lower(regexp_replace(trim(coalesce(p_query, '')), '\s+', ' ', 'g')) as value
  ), matches as (
    select entry.id
    from knowledge_entries entry
    cross join normalized_input input
    where entry.workspace_id = p_workspace_id
      and entry.brand_id = p_brand_id
      and entry.entry_type = 'faq'
      and entry.enabled
      and entry.direct_reply_enabled
      and (
        entry.normalized_question = input.value
        or exists (
          select 1
          from unnest(entry.keywords) keyword
          where lower(regexp_replace(trim(keyword), '\s+', ' ', 'g')) = input.value
        )
        or exists (
          select 1
          from unnest(entry.aliases) alias
          where lower(regexp_replace(trim(alias), '\s+', ' ', 'g')) = input.value
        )
      )
  ), summary as (
    select count(*) as match_count, (array_agg(id order by id::text))[1] as matched_id
    from matches
  )
  select
    case when match_count = 1 then matched_id else null end as knowledge_entry_id,
    case when match_count > 1 then 'knowledge_conflict' else null end as conflict_marker
  from summary;
$$;

commit;
