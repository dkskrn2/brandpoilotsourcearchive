begin;

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
    and source.source_type = 'owned';
$$;

commit;
