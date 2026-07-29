do $$
declare
  duplicate_drafts record;
begin
  select workspace_id, brand_id, count(*)::integer as draft_count
    into duplicate_drafts
    from brand_core_versions
   where status = 'draft'
   group by workspace_id, brand_id
  having count(*) > 1
   order by workspace_id, brand_id
   limit 1;

  if found then
    raise exception 'brand_core_duplicate_drafts_require_manual_resolution'
      using detail = format(
        'workspace_id=%s brand_id=%s draft_count=%s',
        duplicate_drafts.workspace_id,
        duplicate_drafts.brand_id,
        duplicate_drafts.draft_count
      );
  end if;
end
$$;

create unique index if not exists brand_core_one_draft
  on brand_core_versions (workspace_id, brand_id)
  where status = 'draft';
