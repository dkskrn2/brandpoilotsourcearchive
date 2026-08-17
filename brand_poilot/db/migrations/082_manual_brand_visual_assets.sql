begin;

create table if not exists brand_style_presets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 120),
  description text not null default '' check (length(description) <= 1000),
  visual_tokens_json jsonb not null default '{"colors":[],"fonts":[],"notes":[]}'::jsonb
    check (jsonb_typeof(visual_tokens_json) = 'object'),
  status text not null default 'active' check (status in ('active', 'archived')),
  revision integer not null default 1 check (revision > 0),
  is_default boolean not null default false,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_style_presets_brand_ownership_fk
    foreign key (brand_id, workspace_id)
    references brands(id, workspace_id) on delete cascade,
  constraint brand_style_presets_creator_membership_fk
    foreign key (workspace_id, created_by_user_id)
    references workspace_members(workspace_id, user_id) on delete restrict,
  constraint brand_style_presets_tenant_identity_unique
    unique (id, workspace_id, brand_id)
);

create unique index if not exists brand_style_presets_one_active_default
  on brand_style_presets (workspace_id, brand_id)
  where is_default and status = 'active';

create index if not exists brand_style_presets_brand_active_idx
  on brand_style_presets (workspace_id, brand_id, is_default desc, created_at desc)
  where status = 'active';

create table if not exists brand_style_preset_references (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  preset_id uuid not null,
  reference_item_id uuid not null,
  position integer not null check (position between 1 and 5),
  created_at timestamptz not null default now(),
  constraint brand_style_preset_references_preset_ownership_fk
    foreign key (preset_id, workspace_id, brand_id)
    references brand_style_presets(id, workspace_id, brand_id) on delete cascade,
  constraint brand_style_preset_references_item_ownership_fk
    foreign key (reference_item_id, workspace_id, brand_id)
    references reference_items(id, workspace_id, brand_id) on delete restrict,
  constraint brand_style_preset_references_tenant_identity_unique
    unique (id, workspace_id, brand_id),
  constraint brand_style_preset_references_item_unique
    unique (preset_id, reference_item_id),
  constraint brand_style_preset_references_position_unique
    unique (preset_id, position)
);

alter table brand_avatars
  add column if not exists revision integer not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'brand_avatars_revision_check') then
    alter table brand_avatars
      add constraint brand_avatars_revision_check check (revision > 0);
  end if;
end;
$$;

alter table product_service_assets
  add column if not exists storage_artifact_id uuid null,
  add column if not exists checksum text null,
  add column if not exists created_by_user_id uuid null;

create index if not exists reference_upload_sessions_product_expiry_cleanup_idx
  on reference_upload_sessions (expires_at, id)
  where storage_path_prefix like '%/asset-library/products/%'
    and confirmed_at is null
    and cancelled_at is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'product_service_assets_storage_artifact_ownership_fk') then
    alter table product_service_assets
      add constraint product_service_assets_storage_artifact_ownership_fk
      foreign key (storage_artifact_id, workspace_id, brand_id)
      references storage_artifacts(id, workspace_id, brand_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_service_assets_creator_membership_fk') then
    alter table product_service_assets
      add constraint product_service_assets_creator_membership_fk
      foreign key (workspace_id, created_by_user_id)
      references workspace_members(workspace_id, user_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_service_assets_checksum_check') then
    alter table product_service_assets
      add constraint product_service_assets_checksum_check
      check (checksum is null or checksum ~ '^[0-9a-f]{64}$');
  end if;
end;
$$;

create table if not exists manual_ai_content_visual_selections (
  generation_id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  contract_version text not null check (contract_version = 'manual-visual-selection.v1'),
  product_service_id uuid null,
  product_service_version_id uuid null,
  style_preset_id uuid null,
  style_preset_revision integer null check (style_preset_revision is null or style_preset_revision > 0),
  avatar_id uuid null,
  avatar_revision integer null check (avatar_revision is null or avatar_revision > 0),
  selection_json jsonb not null check (jsonb_typeof(selection_json) = 'object'),
  selection_sha256 text not null check (selection_sha256 ~ '^[0-9a-f]{64}$'),
  frozen_json jsonb null check (frozen_json is null or jsonb_typeof(frozen_json) = 'object'),
  frozen_sha256 text null check (frozen_sha256 is null or frozen_sha256 ~ '^[0-9a-f]{64}$'),
  frozen_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint manual_visual_selection_generation_ownership_fk
    foreign key (generation_id, workspace_id, brand_id)
    references ai_content_generations(id, workspace_id, brand_id) on delete cascade,
  constraint manual_visual_selection_product_ownership_fk
    foreign key (product_service_id, workspace_id, brand_id)
    references product_services(id, workspace_id, brand_id) on delete restrict,
  constraint manual_visual_selection_product_version_ownership_fk
    foreign key (product_service_version_id, workspace_id, brand_id)
    references product_service_versions(id, workspace_id, brand_id) on delete restrict,
  constraint manual_visual_selection_style_ownership_fk
    foreign key (style_preset_id, workspace_id, brand_id)
    references brand_style_presets(id, workspace_id, brand_id) on delete restrict,
  constraint manual_visual_selection_avatar_ownership_fk
    foreign key (avatar_id, workspace_id, brand_id)
    references brand_avatars(id, workspace_id, brand_id) on delete restrict,
  constraint manual_visual_selection_product_pair_check check ((product_service_id is null) = (product_service_version_id is null)),
  constraint manual_visual_selection_style_pair_check check ((style_preset_id is null) = (style_preset_revision is null)),
  constraint manual_visual_selection_avatar_pair_check check ((avatar_id is null) = (avatar_revision is null)),
  constraint manual_visual_selection_frozen_pair_check check (
    (frozen_json is null and frozen_sha256 is null and frozen_at is null)
    or (frozen_json is not null and frozen_sha256 is not null and frozen_at is not null)
  ),
  constraint manual_visual_selection_tenant_identity_unique unique (generation_id, workspace_id, brand_id)
);

create or replace function enforce_manual_visual_selection_write_fence()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  perform public.assert_ai_content_writable();
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function enforce_manual_visual_selection_write_fence() from public;

drop trigger if exists manual_ai_content_visual_selections_write_fence on manual_ai_content_visual_selections;
create trigger manual_ai_content_visual_selections_write_fence
before insert or update or delete on manual_ai_content_visual_selections
for each row execute function enforce_manual_visual_selection_write_fence();
alter table manual_ai_content_visual_selections enable always trigger manual_ai_content_visual_selections_write_fence;

drop trigger if exists brand_style_presets_set_updated_at on brand_style_presets;
create trigger brand_style_presets_set_updated_at
before update on brand_style_presets
for each row execute function set_updated_at();

do $$
declare
  schema_owner_role_name name;
  application_role_name name;
begin
  select bootstrap.schema_owner_role_name, bootstrap.application_role_name
    into strict schema_owner_role_name, application_role_name
    from public.ai_content_bootstrap_state bootstrap
   where bootstrap.singleton;

  execute format('alter table public.brand_style_presets owner to %I', schema_owner_role_name);
  execute format('alter table public.brand_style_preset_references owner to %I', schema_owner_role_name);
  execute format('alter table public.manual_ai_content_visual_selections owner to %I', schema_owner_role_name);
  execute format('alter function public.enforce_manual_visual_selection_write_fence() owner to %I', schema_owner_role_name);

  execute 'revoke all on table public.brand_style_presets, public.brand_style_preset_references, public.manual_ai_content_visual_selections from public';
  execute format('grant select, insert, update, delete on table public.brand_style_presets, public.brand_style_preset_references to %I', application_role_name);
  execute format('grant select, insert, update on table public.manual_ai_content_visual_selections to %I', application_role_name);
  execute format('grant select, insert, delete on table public.product_service_assets to %I', application_role_name);
  execute format('grant update (role, position) on table public.product_service_assets to %I', application_role_name);
end
$$;

commit;
