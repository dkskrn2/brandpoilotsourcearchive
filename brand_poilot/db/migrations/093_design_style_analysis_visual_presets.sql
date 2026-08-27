begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  invalid_active_preset_count bigint;
  unfrozen_v1_draft_count bigint;
begin
  select count(*)
    into invalid_active_preset_count
    from brand_style_presets preset
   where preset.status='active'
     and not exists (
       select 1
         from brand_style_preset_references reference
        where reference.preset_id=preset.id
          and reference.workspace_id=preset.workspace_id
          and reference.brand_id=preset.brand_id
     );
  if invalid_active_preset_count > 0 then
    raise exception 'active_legacy_style_preset_without_reference:%', invalid_active_preset_count;
  end if;

  select count(*)
    into unfrozen_v1_draft_count
    from manual_ai_content_visual_selections selection
   where selection.contract_version='manual-visual-selection.v1'
     and selection.frozen_json is null;
  if unfrozen_v1_draft_count > 0 then
    raise exception 'unfrozen_manual_visual_selection_v1_drafts:%', unfrozen_v1_draft_count;
  end if;
end;
$$;

create table brand_design_styles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 120),
  revision integer not null default 1 check (revision > 0),
  analysis_status text not null default 'queued'
    check (analysis_status in ('queued','processing','ready','failed')),
  analysis_contract_version text null,
  analysis_json jsonb null check (analysis_json is null or jsonb_typeof(analysis_json)='object'),
  analysis_sha256 text null check (analysis_sha256 is null or analysis_sha256 ~ '^[0-9a-f]{64}$'),
  analysis_error_code text null,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_design_styles_brand_ownership_fk
    foreign key (brand_id,workspace_id)
    references brands(id,workspace_id) on delete cascade,
  constraint brand_design_styles_creator_membership_fk
    foreign key (workspace_id,created_by_user_id)
    references workspace_members(workspace_id,user_id) on delete restrict,
  constraint brand_design_styles_tenant_identity_unique
    unique (id,workspace_id,brand_id),
  constraint brand_design_styles_analysis_state_check check (
    (
      analysis_status='ready'
      and analysis_contract_version='design-style-analysis.v1'
      and analysis_json is not null
      and analysis_sha256 is not null
    )
    or (
      analysis_status<>'ready'
      and analysis_contract_version is null
      and analysis_json is null
      and analysis_sha256 is null
    )
  )
);

create index brand_design_styles_brand_status_idx
  on brand_design_styles(workspace_id,brand_id,analysis_status,created_at desc);

create table brand_design_style_references (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  design_style_id uuid not null,
  reference_item_id uuid not null,
  position integer not null check (position between 1 and 5),
  created_at timestamptz not null default now(),
  constraint brand_design_style_references_style_ownership_fk
    foreign key (design_style_id,workspace_id,brand_id)
    references brand_design_styles(id,workspace_id,brand_id) on delete cascade,
  constraint brand_design_style_references_item_ownership_fk
    foreign key (reference_item_id,workspace_id,brand_id)
    references reference_items(id,workspace_id,brand_id) on delete restrict,
  constraint brand_design_style_references_tenant_identity_unique
    unique (id,workspace_id,brand_id),
  constraint brand_design_style_references_item_unique
    unique (design_style_id,reference_item_id),
  constraint brand_design_style_references_position_unique
    unique (design_style_id,position)
);

create table brand_design_style_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  design_style_id uuid not null,
  style_revision integer not null check (style_revision > 0),
  status text not null default 'queued'
    check (status in ('queued','processing','succeeded','failed')),
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  available_at timestamptz not null default now(),
  leased_by text null,
  lease_token uuid null,
  lease_expires_at timestamptz null,
  error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_design_style_analysis_jobs_style_ownership_fk
    foreign key (design_style_id,workspace_id,brand_id)
    references brand_design_styles(id,workspace_id,brand_id) on delete cascade,
  constraint brand_design_style_analysis_jobs_tenant_identity_unique
    unique (id,workspace_id,brand_id),
  constraint brand_design_style_analysis_jobs_style_revision_unique
    unique (design_style_id,style_revision),
  constraint brand_design_style_analysis_jobs_attempts_check
    check (max_attempts between 1 and 5 and attempt_count between 0 and max_attempts),
  constraint brand_design_style_analysis_jobs_lease_check check (
    (leased_by is null and lease_token is null and lease_expires_at is null)
    or (leased_by is not null and lease_token is not null and lease_expires_at is not null)
  )
);

create index brand_design_style_analysis_jobs_claim_idx
  on brand_design_style_analysis_jobs(available_at,created_at)
  where status='queued';

alter table worker_resource_leases
  drop constraint if exists worker_resource_leases_workload_check;
alter table worker_resource_leases
  add constraint worker_resource_leases_workload_check
  check (workload_type in ('dm','wiki','content','onboarding','faq','design_style_analysis'));

create trigger brand_design_styles_set_updated_at
before update on brand_design_styles
for each row execute function set_updated_at();

create trigger brand_design_style_analysis_jobs_set_updated_at
before update on brand_design_style_analysis_jobs
for each row execute function set_updated_at();

alter table brand_style_presets
  add column design_style_id uuid null,
  add column avatar_id uuid null;

insert into brand_design_styles(
  id,workspace_id,brand_id,name,revision,analysis_status,analysis_error_code,
  created_by_user_id,created_at,updated_at
)
select preset.id,preset.workspace_id,preset.brand_id,preset.name,preset.revision,
       case when preset.status='active' then 'queued' else 'failed' end,
       case when preset.status='active' then null else 'legacy_preset_archived' end,
       preset.created_by_user_id,preset.created_at,preset.updated_at
  from brand_style_presets preset;

update brand_style_presets preset
   set design_style_id=preset.id;

insert into brand_design_style_references(
  id,workspace_id,brand_id,design_style_id,reference_item_id,position,created_at
)
select reference.id,reference.workspace_id,reference.brand_id,reference.preset_id,
       reference.reference_item_id,reference.position,reference.created_at
  from brand_style_preset_references reference;

do $$
declare
  legacy_reference_count bigint;
  migrated_reference_count bigint;
begin
  select count(*) into legacy_reference_count from brand_style_preset_references;
  select count(*) into migrated_reference_count from brand_design_style_references;
  if migrated_reference_count <> legacy_reference_count then
    raise exception 'design_style_reference_copy_count_mismatch:%:%',
      legacy_reference_count,migrated_reference_count;
  end if;
end;
$$;

insert into brand_design_style_analysis_jobs(
  workspace_id,brand_id,design_style_id,style_revision,status
)
select preset.workspace_id,preset.brand_id,preset.design_style_id,preset.revision,'queued'
  from brand_style_presets preset
 where preset.status='active';

alter table brand_style_presets
  alter column design_style_id set not null,
  add constraint brand_style_presets_design_style_ownership_fk
    foreign key (design_style_id,workspace_id,brand_id)
    references brand_design_styles(id,workspace_id,brand_id) on delete restrict,
  add constraint brand_style_presets_avatar_ownership_fk
    foreign key (avatar_id,workspace_id,brand_id)
    references brand_avatars(id,workspace_id,brand_id) on delete restrict;

alter table manual_ai_content_visual_selections
  drop constraint manual_ai_content_visual_selections_contract_version_check,
  add constraint manual_ai_content_visual_selections_contract_version_check
    check (contract_version in ('manual-visual-selection.v1','manual-visual-selection.v2'));

create function enforce_design_style_analysis_write_fence()
returns trigger
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
begin
  perform public.assert_ai_content_writable();
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function enforce_design_style_analysis_write_fence() from public;

do $$
declare
  trigger_name text;
begin
  trigger_name:=public.ai_content_fence_trigger_name('brand_design_style_analysis_jobs');
  execute format(
    'create trigger %I before insert or update or delete on brand_design_style_analysis_jobs for each row execute function enforce_design_style_analysis_write_fence()',
    trigger_name
  );
  execute format(
    'alter table brand_design_style_analysis_jobs enable always trigger %I',
    trigger_name
  );
end;
$$;

do $$
declare
  schema_owner_role_name name;
  application_role_name name;
  target_relation text;
  acl_grantee record;
begin
  if to_regclass('public.ai_content_bootstrap_state') is null
     or not exists (select 1 from public.ai_content_bootstrap_state bootstrap where bootstrap.singleton)
  then
    return;
  end if;
  select bootstrap.schema_owner_role_name,bootstrap.application_role_name
    into schema_owner_role_name,application_role_name
    from public.ai_content_bootstrap_state bootstrap
   where bootstrap.singleton;
  if schema_owner_role_name is null or application_role_name is null then
    return;
  end if;

  foreach target_relation in array array[
    'brand_style_preset_references',
    'brand_design_styles',
    'brand_design_style_references',
    'brand_design_style_analysis_jobs'
  ]
  loop
    execute format('alter table public.%I owner to %I',target_relation,schema_owner_role_name);
    for acl_grantee in
      select scrub.grantee,scrub.grantee_role_name
        from (
          select distinct acl.grantee,
                 case acl.grantee when 0 then 'PUBLIC' else grantee.rolname::text end grantee_role_name
            from pg_class relation
            cross join lateral aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) acl
            left join pg_roles grantee on grantee.oid=acl.grantee
           where relation.oid=format('public.%I',target_relation)::regclass
             and acl.grantee<>relation.relowner
        ) scrub
       order by scrub.grantee_role_name collate "C"
    loop
      if acl_grantee.grantee=0 then
        execute format('revoke all on table public.%I from public',target_relation);
      elsif acl_grantee.grantee_role_name is null then
        raise exception 'design_style_acl_grantee_invalid:%',target_relation;
      else
        execute format(
          'revoke all on table public.%I from %I',
          target_relation,acl_grantee.grantee_role_name
        );
      end if;
    end loop;
  end loop;

  execute format(
    'alter function public.enforce_design_style_analysis_write_fence() owner to %I',
    schema_owner_role_name
  );

  execute format(
    'grant select,insert,update on table public.brand_design_styles to %I',
    application_role_name
  );
  execute format(
    'grant select,insert,update,delete on table public.brand_design_style_references to %I',
    application_role_name
  );
  execute format(
    'grant select,insert,update on table public.brand_design_style_analysis_jobs to %I',
    application_role_name
  );
  execute format(
    'grant select on table public.brand_style_preset_references to %I',
    application_role_name
  );
end;
$$;

commit;
