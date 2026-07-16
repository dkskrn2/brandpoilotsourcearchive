-- requires: pgvector

alter table wiki_page_chunks
  add column embedding vector(1536) null;

create index wiki_page_chunks_embedding_hnsw_idx
  on wiki_page_chunks using hnsw (embedding vector_cosine_ops)
  where enabled and embedding is not null;

create or replace function search_brand_compiled_wiki(
  p_workspace_id uuid,
  p_brand_id uuid,
  p_wiki_version_id uuid,
  p_query_embedding vector(1536),
  p_query text,
  p_limit integer default 3
)
returns table (
  page_chunk_id uuid,
  wiki_page_id uuid,
  page_type text,
  title text,
  content text,
  source_link_ids uuid[],
  cosine_similarity double precision,
  keyword_match double precision,
  rrf_score double precision
)
language sql
stable
as $$
  with target_version as (
    select version.id
    from wiki_versions version
    where version.id = p_wiki_version_id
      and version.workspace_id = p_workspace_id
      and version.brand_id = p_brand_id
      and version.status in ('ready', 'active')
  ), scored as (
    select
      chunk.id as page_chunk_id,
      page.id as wiki_page_id,
      page.page_type,
      page.title,
      chunk.content,
      coalesce((
        select array_agg(source.id order by source.id::text)
        from wiki_page_sources source
        where source.workspace_id = p_workspace_id
          and source.brand_id = p_brand_id
          and source.wiki_version_id = p_wiki_version_id
          and source.wiki_page_id = page.id
      ), '{}'::uuid[]) as source_link_ids,
      (chunk.embedding <=> p_query_embedding)::double precision as distance,
      ts_rank_cd(
        chunk.search_vector,
        websearch_to_tsquery('simple', coalesce(p_query, ''))
      )::double precision as keyword_match
    from target_version version
    join wiki_page_chunks chunk on chunk.wiki_version_id = version.id
    join wiki_pages page
      on page.id = chunk.wiki_page_id
     and page.wiki_version_id = version.id
    where chunk.workspace_id = p_workspace_id
      and chunk.brand_id = p_brand_id
      and page.workspace_id = p_workspace_id
      and page.brand_id = p_brand_id
      and chunk.enabled
      and chunk.embedding is not null
  ), ranked as (
    select
      scored.*,
      row_number() over (order by distance, page_chunk_id) as vector_rank,
      row_number() over (order by keyword_match desc, page_chunk_id) as keyword_rank
    from scored
  )
  select
    page_chunk_id,
    wiki_page_id,
    page_type,
    title,
    content,
    source_link_ids,
    (1 - distance)::double precision as cosine_similarity,
    keyword_match,
    (
      0.7 / (60 + vector_rank)
      + 0.3 / (60 + keyword_rank)
    )::double precision as rrf_score
  from ranked
  order by rrf_score desc, page_chunk_id
  limit greatest(1, least(coalesce(p_limit, 3), 3));
$$;

create or replace function activate_compiled_wiki_version(p_wiki_version_id uuid)
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

  if target_version.status <> 'ready' then
    return false;
  end if;

  if not exists (
    select 1
    from wiki_compilation_items item
    where item.wiki_version_id = p_wiki_version_id
  ) then
    failure_reason := 'wiki_compilation_items_missing';
  elsif exists (
    select 1
    from wiki_compilation_items item
    where item.wiki_version_id = p_wiki_version_id
      and item.status <> 'succeeded'
  ) then
    failure_reason := 'wiki_compilation_items_incomplete';
  elsif not exists (
    select 1 from wiki_pages page
    where page.wiki_version_id = p_wiki_version_id
      and page.page_type = 'brand_overview'
  ) then
    failure_reason := 'wiki_brand_overview_missing';
  elsif not exists (
    select 1 from wiki_pages page
    where page.wiki_version_id = p_wiki_version_id
      and page.page_type = 'catalog'
  ) then
    failure_reason := 'wiki_catalog_missing';
  elsif exists (
    select 1
    from wiki_pages page
    where page.wiki_version_id = p_wiki_version_id
      and jsonb_array_length(page.content_json -> 'sections') = 0
  ) then
    failure_reason := 'wiki_page_sections_missing';
  elsif exists (
    select 1
    from wiki_pages page
    cross join lateral jsonb_array_elements(page.content_json -> 'sections') as section(value)
    where page.wiki_version_id = p_wiki_version_id
      and case
        when jsonb_typeof(section.value) is distinct from 'object' then true
        when jsonb_typeof(section.value -> 'sourceUnitIds') is distinct from 'array' then true
        when jsonb_array_length(section.value -> 'sourceUnitIds') = 0 then true
        else exists (
          select 1
          from jsonb_array_elements_text(section.value -> 'sourceUnitIds') listed_source(source_unit_id)
          where not exists (
            select 1
            from wiki_page_sources source
            where source.wiki_page_id = page.id
              and source.section_key = section.value ->> 'sectionKey'
              and source.wiki_source_unit_id::text = listed_source.source_unit_id
          )
        )
      end
  ) then
    failure_reason := 'wiki_page_sources_missing';
  elsif exists (
    select 1
    from wiki_pages page
    where page.wiki_version_id = p_wiki_version_id
      and not exists (
        select 1
        from wiki_page_chunks chunk
        where chunk.wiki_page_id = page.id
          and chunk.enabled
          and chunk.embedding is not null
      )
  ) then
    failure_reason := 'wiki_page_chunks_missing';
  elsif exists (
    select 1
    from wiki_page_chunks chunk
    where chunk.wiki_version_id = p_wiki_version_id
      and chunk.enabled
      and chunk.embedding is null
  ) then
    failure_reason := 'wiki_page_chunks_missing';
  end if;

  if failure_reason is not null then
    update wiki_versions
    set status = 'failed',
        error_message = failure_reason,
        completed_at = now(),
        updated_at = now()
    where id = p_wiki_version_id;
    return false;
  end if;

  perform id
  from wiki_versions
  where workspace_id = target_version.workspace_id
    and brand_id = target_version.brand_id
    and status = 'active'
  for update;

  update wiki_pages
  set is_active = false,
      updated_at = now()
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

  update wiki_pages
  set is_active = true,
      updated_at = now()
  where wiki_version_id = p_wiki_version_id;

  update wiki_versions
  set status = 'active',
      build_stage = null,
      source_count = (
        select count(*)::integer
        from wiki_source_units unit
        where unit.wiki_version_id = p_wiki_version_id
      ),
      document_count = (
        select count(*)::integer
        from wiki_pages page
        where page.wiki_version_id = p_wiki_version_id
      ),
      chunk_count = (
        select count(*)::integer
        from wiki_page_chunks chunk
        where chunk.wiki_version_id = p_wiki_version_id and chunk.enabled
      ),
      error_message = null,
      completed_at = now(),
      activated_at = now(),
      updated_at = now()
  where id = p_wiki_version_id;

  return true;
end;
$$;
