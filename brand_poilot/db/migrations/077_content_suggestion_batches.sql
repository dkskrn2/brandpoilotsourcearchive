create table content_suggestion_batches (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references content_categories(id),
  generation_date date not null,
  timezone text not null default 'Asia/Seoul',
  run_key text not null unique,
  payload_hash text not null,
  item_count integer not null
    constraint content_suggestion_batches_item_count_check
    check (item_count between 1 and 28),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_suggestion_batches_category_date_unique
    unique (category_id, generation_date)
);

create table content_suggestions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references content_suggestion_batches(id) on delete cascade,
  category_id uuid not null references content_categories(id),
  subcategory_id uuid not null references content_subcategories(id),
  intent text not null
    constraint content_suggestions_intent_check
    check (intent in ('informational', 'trend')),
  position integer not null
    constraint content_suggestions_position_check
    check (position between 1 and 2),
  title text not null,
  why_now text not null,
  content_brief text not null,
  sources_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_suggestions_slot_unique
    unique (batch_id, subcategory_id, intent, position),
  constraint content_suggestions_sources_array_check
    check (jsonb_typeof(sources_json) = 'array' and jsonb_array_length(sources_json) between 1 and 3)
);

create index content_suggestion_batches_latest_category_idx
  on content_suggestion_batches (category_id, generation_date desc, published_at desc);

create index content_suggestions_batch_order_idx
  on content_suggestions (batch_id, subcategory_id, intent, position);

create trigger content_suggestion_batches_set_updated_at
before update on content_suggestion_batches
for each row execute function set_updated_at();

create trigger content_suggestions_set_updated_at
before update on content_suggestions
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

  execute format(
    'alter table public.content_suggestion_batches owner to %I',
    schema_owner_role_name
  );
  execute format(
    'alter table public.content_suggestions owner to %I',
    schema_owner_role_name
  );
  execute 'revoke all on table public.content_suggestion_batches, public.content_suggestions from public';
  execute format(
    'grant select, insert, update, delete on table public.content_suggestion_batches to %I',
    application_role_name
  );
  execute format(
    'grant select, insert, update, delete on table public.content_suggestions to %I',
    application_role_name
  );
end
$$;
