alter table performance_sync_runs
  drop constraint if exists performance_sync_runs_brand_id_fkey;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'performance_sync_runs'::regclass
      and conname = 'performance_sync_runs_brand_owner_fkey'
  ) then
    alter table performance_sync_runs
      add constraint performance_sync_runs_brand_owner_fkey
      foreign key (brand_id, workspace_id)
      references brands(id, workspace_id)
      on delete cascade
      not valid;
  end if;
end;
$$;

alter table performance_sync_runs
  validate constraint performance_sync_runs_brand_owner_fkey;

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
