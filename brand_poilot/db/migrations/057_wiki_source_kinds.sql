begin;

alter table wiki_build_items
  drop constraint if exists wiki_build_items_source_kind_check;

alter table wiki_build_items
  add constraint wiki_build_items_source_kind_check
    check (source_kind in (
      'faq', 'product', 'product_service', 'service', 'policy', 'guide', 'owned_snapshot'
    ));

alter table wiki_source_units
  drop constraint if exists wiki_source_units_source_kind_check;

alter table wiki_source_units
  add constraint wiki_source_units_source_kind_check
    check (source_kind in (
      'faq', 'product', 'product_service', 'service', 'policy', 'guide', 'owned_snapshot'
    ));

alter table wiki_documents
  add column if not exists product_service_id uuid null;

alter table wiki_documents
  drop constraint if exists wiki_documents_source_kind_check,
  drop constraint if exists wiki_documents_source_reference_check,
  drop constraint if exists wiki_documents_product_service_ownership_fk;

alter table wiki_documents
  add constraint wiki_documents_source_kind_check
    check (source_kind in (
      'faq', 'product', 'product_service', 'service', 'policy', 'guide', 'owned_snapshot'
    ));

alter table wiki_documents
  add constraint wiki_documents_source_reference_check check (
    (
      source_kind in ('faq', 'product', 'service', 'policy', 'guide')
      and knowledge_entry_id is not null
      and product_service_id is null
      and source_snapshot_id is null
    )
    or (
      source_kind = 'product_service'
      and knowledge_entry_id is null
      and product_service_id is not null
      and source_snapshot_id is null
    )
    or (
      source_kind = 'owned_snapshot'
      and knowledge_entry_id is null
      and product_service_id is null
      and source_snapshot_id is not null
    )
  );

alter table wiki_documents
  add constraint wiki_documents_product_service_ownership_fk
    foreign key (product_service_id, workspace_id, brand_id)
    references product_services(id, workspace_id, brand_id) on delete cascade;

create unique index if not exists wiki_documents_version_product_service_unique
  on wiki_documents(wiki_version_id, product_service_id)
  where product_service_id is not null;

commit;
