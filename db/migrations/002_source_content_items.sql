create table if not exists source_content_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  source_url_id uuid not null references source_urls(id) on delete cascade,
  url_hash text not null,
  content_url text not null,
  canonical_url text null,
  domain text null,
  title text null,
  status text not null default 'discovered',
  discovery_method text not null default 'seed_self',
  link_text text null,
  first_discovered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_crawled_at timestamptz null,
  latest_content_hash text null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint source_content_items_status_check check (status in ('discovered', 'crawled', 'unchanged', 'crawl_failed', 'disabled')),
  constraint source_content_items_discovery_method_check check (discovery_method in ('seed_self', 'canonical', 'og_url', 'anchor'))
);

create unique index if not exists source_content_items_brand_url_hash_active_unique
  on source_content_items(brand_id, url_hash)
  where deleted_at is null;

create index if not exists source_content_items_source_seen_idx on source_content_items(source_url_id, last_seen_at desc);
create index if not exists source_content_items_brand_status_idx on source_content_items(brand_id, status);

alter table source_snapshots
  add column if not exists source_content_item_id uuid null references source_content_items(id) on delete set null;

create index if not exists source_snapshots_content_item_hash_idx on source_snapshots(source_content_item_id, content_hash);

drop trigger if exists source_content_items_set_updated_at on source_content_items;
create trigger source_content_items_set_updated_at before update on source_content_items for each row execute function set_updated_at();
