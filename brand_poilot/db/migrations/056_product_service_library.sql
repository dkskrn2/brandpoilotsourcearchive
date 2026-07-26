begin;

alter table knowledge_entries
  alter column last_import_id drop not null,
  add column if not exists origin text not null default 'import',
  add column if not exists provenance_json jsonb not null default '{}'::jsonb,
  add column if not exists status text not null default 'active',
  add column if not exists created_by_user_id uuid null references app_users(id) on delete set null,
  add column if not exists approved_by_user_id uuid null references app_users(id) on delete set null,
  add column if not exists approved_at timestamptz null;

alter table knowledge_entries
  drop constraint if exists knowledge_entries_entry_type_check,
  drop constraint if exists knowledge_entries_item_fields_check,
  drop constraint if exists knowledge_entries_origin_check,
  drop constraint if exists knowledge_entries_status_check,
  drop constraint if exists knowledge_entries_provenance_object_check,
  add constraint knowledge_entries_entry_type_check
    check (entry_type in ('faq', 'product', 'service', 'policy', 'guide')),
  add constraint knowledge_entries_item_fields_check
    check (
      entry_type not in ('product', 'service', 'policy', 'guide')
      or (
        title is not null and length(trim(title)) > 0
        and content is not null and length(trim(content)) > 0
      )
    ),
  add constraint knowledge_entries_origin_check
    check (origin in ('import', 'manual', 'product_service', 'migration')),
  add constraint knowledge_entries_status_check
    check (status in ('draft', 'approved', 'active', 'archived', 'legacy_projection')),
  add constraint knowledge_entries_provenance_object_check
    check (jsonb_typeof(provenance_json) = 'object');

create table if not exists product_services (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  kind text not null check (kind in ('product', 'service')),
  display_name text not null check (length(trim(display_name)) > 0),
  status text not null default 'active' check (status in ('active', 'archived')),
  active_version_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_services_brand_ownership_fk
    foreign key (brand_id, workspace_id)
    references brands(id, workspace_id) on delete cascade,
  constraint product_services_tenant_identity_unique unique (id, workspace_id, brand_id)
);

create table if not exists product_service_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  product_service_id uuid not null,
  source_analysis_id uuid null,
  version integer not null check (version > 0),
  status text not null check (status in ('draft', 'approved', 'superseded')),
  profile_json jsonb not null check (jsonb_typeof(profile_json) = 'object'),
  evidence_json jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_json) = 'array'),
  created_by_user_id uuid null references app_users(id) on delete set null,
  approved_by_user_id uuid null references app_users(id) on delete set null,
  approved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_service_versions_brand_ownership_fk
    foreign key (brand_id, workspace_id)
    references brands(id, workspace_id) on delete cascade,
  constraint product_service_versions_product_ownership_fk
    foreign key (product_service_id, workspace_id, brand_id)
    references product_services(id, workspace_id, brand_id) on delete cascade,
  constraint product_service_versions_source_analysis_ownership_fk
    foreign key (source_analysis_id, workspace_id, brand_id)
    references ai_content_subject_analyses(id, workspace_id, brand_id) on delete restrict,
  constraint product_service_versions_tenant_identity_unique unique (id, workspace_id, brand_id),
  constraint product_service_versions_item_version_unique unique (workspace_id, brand_id, product_service_id, version),
  constraint product_service_versions_approval_check check (
    (status = 'approved' and approved_at is not null)
    or status <> 'approved'
  )
);

create unique index if not exists product_service_versions_one_approved
  on product_service_versions (workspace_id, brand_id, product_service_id)
  where status = 'approved';

create unique index if not exists product_service_versions_source_analysis_unique
  on product_service_versions (workspace_id, brand_id, source_analysis_id)
  where source_analysis_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'product_services_active_version_fk'
  ) then
    alter table product_services
      add constraint product_services_active_version_fk
      foreign key (active_version_id, workspace_id, brand_id)
      references product_service_versions(id, workspace_id, brand_id)
      deferrable initially deferred;
  end if;
end;
$$;

create table if not exists product_service_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  product_service_id uuid not null,
  product_service_version_id uuid not null,
  source_image_id uuid null,
  storage_url text not null,
  storage_path text null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  role text not null check (role in ('hero', 'detail', 'logo', 'document')),
  position integer not null default 1 check (position > 0),
  created_at timestamptz not null default now(),
  constraint product_service_assets_product_ownership_fk
    foreign key (product_service_id, workspace_id, brand_id)
    references product_services(id, workspace_id, brand_id) on delete cascade,
  constraint product_service_assets_version_ownership_fk
    foreign key (product_service_version_id, workspace_id, brand_id)
    references product_service_versions(id, workspace_id, brand_id) on delete cascade,
  constraint product_service_assets_source_image_ownership_fk
    foreign key (source_image_id, workspace_id, brand_id)
    references ai_content_subject_images(id, workspace_id, brand_id) on delete restrict,
  constraint product_service_assets_tenant_identity_unique unique (id, workspace_id, brand_id),
  constraint product_service_assets_position_unique unique (product_service_version_id, position)
);

create table if not exists product_service_legacy_mappings (
  knowledge_entry_id uuid primary key references knowledge_entries(id) on delete restrict,
  workspace_id uuid not null,
  brand_id uuid not null,
  product_service_id uuid not null,
  product_service_version_id uuid not null,
  created_at timestamptz not null default now(),
  constraint product_service_legacy_mapping_item_fk
    foreign key (product_service_id, workspace_id, brand_id)
    references product_services(id, workspace_id, brand_id) on delete cascade,
  constraint product_service_legacy_mapping_version_fk
    foreign key (product_service_version_id, workspace_id, brand_id)
    references product_service_versions(id, workspace_id, brand_id) on delete cascade
);

with legacy as (
  select
    entry.id as knowledge_entry_id,
    entry.workspace_id,
    entry.brand_id,
    gen_random_uuid() as product_service_id,
    gen_random_uuid() as version_id,
    coalesce(nullif(trim(entry.title), ''), nullif(trim(entry.question), ''), '제품') as display_name,
    coalesce(nullif(trim(entry.content), ''), nullif(trim(entry.answer), ''), '') as description,
    entry.structured_data
  from knowledge_entries entry
  where entry.entry_type = 'product'
    and not exists (
      select 1 from product_service_legacy_mappings mapping
      where mapping.knowledge_entry_id = entry.id
    )
),
inserted_items as (
  insert into product_services (id, workspace_id, brand_id, kind, display_name, status)
  select product_service_id, workspace_id, brand_id, 'product', display_name, 'active'
  from legacy
  returning id
),
inserted_versions as (
  insert into product_service_versions (
    id, workspace_id, brand_id, product_service_id, version, status,
    profile_json, evidence_json, approved_at, created_at, updated_at
  )
  select
    version_id, workspace_id, brand_id, product_service_id, 1, 'approved',
    jsonb_build_object(
      'contractVersion', 'product-service.v1',
      'name', display_name,
      'kind', 'product',
      'description', description,
      'features', coalesce(structured_data->'features', '[]'::jsonb),
      'benefits', coalesce(structured_data->'benefits', '[]'::jsonb),
      'cautions', '[]'::jsonb,
      'audiences', '[]'::jsonb,
      'appealsByTarget', '{}'::jsonb,
      'evergreenPurchaseInfo', '',
      'sourceUrls', '[]'::jsonb
    ),
    jsonb_build_array(jsonb_build_object(
      'sourceType', 'legacy_knowledge',
      'sourceId', knowledge_entry_id
    )),
    now(), now(), now()
  from legacy
  returning id
)
insert into product_service_legacy_mappings (
  knowledge_entry_id, workspace_id, brand_id, product_service_id, product_service_version_id
)
select knowledge_entry_id, workspace_id, brand_id, product_service_id, version_id
from legacy
on conflict (knowledge_entry_id) do nothing;

update product_services item
set active_version_id = mapping.product_service_version_id
from product_service_legacy_mappings mapping
where item.id = mapping.product_service_id
  and item.active_version_id is null;

update knowledge_entries entry
set status = 'legacy_projection',
    provenance_json = entry.provenance_json || jsonb_build_object(
      'productServiceId', mapping.product_service_id,
      'productServiceVersionId', mapping.product_service_version_id
    ),
    updated_at = now()
from product_service_legacy_mappings mapping
where entry.id = mapping.knowledge_entry_id;

drop trigger if exists product_services_set_updated_at on product_services;
create trigger product_services_set_updated_at
before update on product_services
for each row execute function set_updated_at();

drop trigger if exists product_service_versions_set_updated_at on product_service_versions;
create trigger product_service_versions_set_updated_at
before update on product_service_versions
for each row execute function set_updated_at();

commit;
