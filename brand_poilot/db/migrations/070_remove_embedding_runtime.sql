begin;

create or replace function search_brand_wiki_lexical(
  p_workspace_id uuid,
  p_brand_id uuid,
  p_query text,
  p_limit integer default 12,
  p_is_offering_question boolean default false,
  p_is_product_question boolean default false,
  p_is_offering_location_question boolean default false
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
  with query_input as (
    select
      lower(
        regexp_replace(
          trim(coalesce(p_query, '')),
          '[[:space:]]+',
          ' ',
          'g'
        )
      ) as value,
      websearch_to_tsquery('simple', coalesce(p_query, '')) as web_query
    where regexp_replace(coalesce(p_query, ''), '[[:space:]]+', '', 'g') <> ''
  ), query_tokens as (
    select distinct token.value
    from query_input query
    cross join lateral regexp_split_to_table(
      query.value,
      '[[:space:]]+'
    ) token(value)
    where token.value <> ''
  ), scored as (
    select
      chunk.id as page_chunk_id,
      page.id as wiki_page_id,
      page.page_type,
      page.title,
      chunk.content,
      page.stable_key,
      chunk.chunk_index,
      case
        when coalesce(p_is_product_question, false)
          and page.page_type = 'product'
          and exists (
            select 1
            from wiki_page_sources source
            where source.workspace_id = p_workspace_id
              and source.brand_id = p_brand_id
              and source.wiki_version_id = version.id
              and source.wiki_page_id = page.id
              and source.source_kind in ('product', 'product_service')
          )
          then 0
        else 1
      end as product_priority,
      case
        when coalesce(p_is_offering_location_question, false)
          then coalesce((
            select min(length(source.destination_url))
            from wiki_page_sources source
            where source.workspace_id = p_workspace_id
              and source.brand_id = p_brand_id
              and source.wiki_version_id = version.id
              and source.wiki_page_id = page.id
              and source.destination_url is not null
          ), 2147483647)
        else 0
      end as location_priority,
      coalesce((
        select array_agg(source.id order by source.id::text)
        from wiki_page_sources source
        where source.workspace_id = p_workspace_id
          and source.brand_id = p_brand_id
          and source.wiki_version_id = version.id
          and source.wiki_page_id = page.id
      ), '{}'::uuid[]) as source_link_ids,
      ts_rank_cd(
        chunk.search_vector,
        query.web_query
      )::double precision as keyword_match,
      lower(
        regexp_replace(trim(chunk.content), '[[:space:]]+', ' ', 'g')
      ) as normalized_content,
      lower(
        regexp_replace(trim(page.title), '[[:space:]]+', ' ', 'g')
      ) as normalized_title,
      lower(
        regexp_replace(
          trim(regexp_replace(page.stable_key, '[-_./]+', ' ', 'g')),
          '[[:space:]]+',
          ' ',
          'g'
        )
      ) as normalized_stable_key,
      case
        when query.value <> ''
          and strpos(
            lower(regexp_replace(trim(chunk.content), '[[:space:]]+', ' ', 'g')),
            query.value
          ) > 0
          then 1::double precision
        else 0::double precision
      end as normalized_phrase_match,
      case
        when query.value <> ''
          and lower(regexp_replace(trim(page.title), '[[:space:]]+', ' ', 'g'))
            = query.value
          then 1::double precision
        when query.value <> ''
          and strpos(
            lower(regexp_replace(trim(page.title), '[[:space:]]+', ' ', 'g')),
            query.value
          ) > 0
          then 0.75::double precision
        else 0::double precision
      end as title_match,
      case
        when query.value <> ''
          and lower(
            regexp_replace(
              trim(regexp_replace(page.stable_key, '[-_./]+', ' ', 'g')),
              '[[:space:]]+',
              ' ',
              'g'
            )
          ) = query.value
          then 1::double precision
        when query.value <> ''
          and strpos(
            lower(
              regexp_replace(
                trim(regexp_replace(page.stable_key, '[-_./]+', ' ', 'g')),
                '[[:space:]]+',
                ' ',
                'g'
              )
            ),
            query.value
          ) > 0
          then 0.75::double precision
        else 0::double precision
      end as stable_key_match,
      coalesce((
        select max(
          case
            when lower(
              regexp_replace(trim(alias.value), '[[:space:]]+', ' ', 'g')
            ) = query.value
              then 1::double precision
            when query.value <> ''
              and strpos(
                lower(
                  regexp_replace(trim(alias.value), '[[:space:]]+', ' ', 'g')
                ),
                query.value
              ) > 0
              then 0.75::double precision
            else 0::double precision
          end
        )
        from wiki_page_sources source
        join wiki_source_units unit
          on unit.id = source.wiki_source_unit_id
         and unit.workspace_id = source.workspace_id
         and unit.brand_id = source.brand_id
         and unit.wiki_version_id = source.wiki_version_id
        cross join lateral unnest(unit.aliases) alias(value)
        where source.workspace_id = p_workspace_id
          and source.brand_id = p_brand_id
          and source.wiki_version_id = version.id
          and source.wiki_page_id = page.id
          and query.value <> ''
      ), 0::double precision) as alias_match,
      coalesce((
        select max(
          case
            when lower(
              regexp_replace(trim(keyword.value), '[[:space:]]+', ' ', 'g')
            ) = query.value
              then 1::double precision
            when query.value <> ''
              and strpos(
                lower(
                  regexp_replace(trim(keyword.value), '[[:space:]]+', ' ', 'g')
                ),
                query.value
              ) > 0
              then 0.75::double precision
            else 0::double precision
          end
        )
        from wiki_page_sources source
        join wiki_source_units unit
          on unit.id = source.wiki_source_unit_id
         and unit.workspace_id = source.workspace_id
         and unit.brand_id = source.brand_id
         and unit.wiki_version_id = source.wiki_version_id
        cross join lateral unnest(unit.keywords) keyword(value)
        where source.workspace_id = p_workspace_id
          and source.brand_id = p_brand_id
          and source.wiki_version_id = version.id
          and source.wiki_page_id = page.id
          and query.value <> ''
      ), 0::double precision) as keyword_array_match
    from wiki_versions version
    join wiki_page_chunks chunk
      on chunk.wiki_version_id = version.id
     and chunk.workspace_id = version.workspace_id
     and chunk.brand_id = version.brand_id
    join wiki_pages page
      on page.id = chunk.wiki_page_id
     and page.wiki_version_id = version.id
     and page.workspace_id = version.workspace_id
     and page.brand_id = version.brand_id
    cross join query_input query
    where version.workspace_id = p_workspace_id
      and version.brand_id = p_brand_id
      and version.status = 'active'
      and chunk.enabled
      and (
        not coalesce(p_is_offering_question, false)
        or (
          page.page_type in ('product', 'service')
          and exists (
            select 1
            from wiki_page_sources source
            where source.workspace_id = p_workspace_id
              and source.brand_id = p_brand_id
              and source.wiki_version_id = version.id
              and source.wiki_page_id = page.id
              and (
                source.source_kind in ('product', 'product_service', 'service')
                or (
                  source.source_kind = 'owned_snapshot'
                  and source.source_url is not null
                  and lower(source.source_url) !~
                    '/(article|articles|blog|content|insight|insights|news|resource|resources)(/|[?]|#|$)'
                )
              )
          )
        )
      )
  ), with_token_overlap as (
    select
      scored.*,
      coalesce((
        select
          count(*) filter (
            where strpos(
              concat_ws(
                ' ',
                scored.normalized_content,
                scored.normalized_title,
                scored.normalized_stable_key
              ),
              token.value
            ) > 0
          )::double precision
          / nullif(count(*)::double precision, 0)
        from query_tokens token
      ), 0::double precision) as token_overlap
    from scored
  ), ranked as (
    select
      with_token_overlap.*,
      (
        keyword_match * 8
        + normalized_phrase_match * 4
        + token_overlap * 2
        + title_match * 6
        + stable_key_match * 3
        + alias_match * 5
        + keyword_array_match * 4
      )::double precision as lexical_score
    from with_token_overlap
  )
  select
    page_chunk_id,
    wiki_page_id,
    page_type,
    title,
    content,
    source_link_ids,
    0::double precision as cosine_similarity,
    keyword_match,
    lexical_score as rrf_score
  from ranked
  where lexical_score > 0
  order by
    case when coalesce(p_is_product_question, false) then product_priority else 1 end,
    case when coalesce(p_is_offering_location_question, false) then location_priority else 0 end,
    lexical_score desc,
    keyword_match desc,
    stable_key,
    chunk_index,
    page_chunk_id::text
  limit greatest(1, least(coalesce(p_limit, 12), 12));
$$;

update wiki_versions
set build_stage = 'validating',
    updated_at = now()
where status = 'building'
  and build_stage = 'embedding';

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
    select 1
    from wiki_pages page
    where page.wiki_version_id = p_wiki_version_id
      and page.page_type = 'brand_overview'
  ) then
    failure_reason := 'wiki_brand_overview_missing';
  elsif not exists (
    select 1
    from wiki_pages page
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
          from jsonb_array_elements_text(
            section.value -> 'sourceUnitIds'
          ) listed_source(source_unit_id)
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
      )
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
        where chunk.wiki_version_id = p_wiki_version_id
          and chunk.enabled
      ),
      error_message = null,
      completed_at = now(),
      activated_at = now(),
      updated_at = now()
  where id = p_wiki_version_id;

  return true;
end;
$$;

commit;
