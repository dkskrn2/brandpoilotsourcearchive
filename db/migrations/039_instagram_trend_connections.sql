create table instagram_trend_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  brand_id uuid not null,
  brand_channel_id uuid not null,
  provider text not null default 'meta',
  encrypted_payload text not null,
  masked_display text null,
  scopes text[] not null default '{}',
  instagram_business_account_id text not null,
  facebook_page_id text not null,
  account_label text null,
  expires_at timestamptz null,
  status text not null default 'connected'
    check (status in ('connected', 'needs_attention', 'expired')),
  last_error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id),
  constraint instagram_trend_connections_brand_owner_fkey
    foreign key (brand_id, workspace_id)
    references brands(id, workspace_id)
    on delete cascade,
  constraint instagram_trend_connections_channel_owner_fkey
    foreign key (brand_channel_id, workspace_id, brand_id)
    references brand_channels(id, workspace_id, brand_id)
    on delete cascade
);

create index instagram_trend_connections_status_idx
  on instagram_trend_connections (brand_id, status, updated_at desc);
