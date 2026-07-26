begin;

alter table source_urls
  add column if not exists content_purpose text;

update source_urls
set content_purpose = 'both'
where content_purpose is null
  and source_type in ('owned', 'reference');

alter table source_urls
  alter column content_purpose set default 'both',
  alter column content_purpose set not null,
  drop constraint if exists source_urls_content_purpose_check;

alter table source_urls
  add constraint source_urls_content_purpose_check
    check (
      content_purpose in ('informational', 'marketing', 'both')
      and (source_type <> 'owned' or content_purpose = 'both')
    );

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'brand_trend_saved_media_tenant_identity_unique'
  ) then
    alter table brand_trend_saved_media
      add constraint brand_trend_saved_media_tenant_identity_unique
      unique (id, workspace_id, brand_id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'channel_outputs_reference_identity_unique'
  ) then
    alter table channel_outputs
      add constraint channel_outputs_reference_identity_unique
      unique (id, workspace_id, brand_id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'storage_artifacts_reference_identity_unique'
  ) then
    alter table storage_artifacts
      add constraint storage_artifacts_reference_identity_unique
      unique (id, workspace_id, brand_id);
  end if;
end;
$$;

create table if not exists brand_avatars (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  description text not null default '',
  is_default boolean not null default false,
  status text not null default 'active'
    check (status in ('active', 'archived')),
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_avatars_brand_ownership_fk
    foreign key (brand_id, workspace_id)
    references brands(id, workspace_id) on delete cascade,
  constraint brand_avatars_creator_membership_fk
    foreign key (workspace_id, created_by_user_id)
    references workspace_members(workspace_id, user_id) on delete restrict,
  constraint brand_avatars_tenant_identity_unique
    unique (id, workspace_id, brand_id)
);

create unique index if not exists brand_avatars_one_active_default
  on brand_avatars (workspace_id, brand_id)
  where is_default and status = 'active';

create index if not exists brand_avatars_brand_status_idx
  on brand_avatars (workspace_id, brand_id, status, created_at desc);

create table if not exists brand_avatar_images (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  avatar_id uuid not null,
  position integer not null,
  is_representative boolean not null default false,
  storage_url text not null check (length(trim(storage_url)) > 0),
  storage_path text not null check (length(trim(storage_path)) > 0),
  mime_type text not null,
  size_bytes bigint not null,
  checksum text not null,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  constraint brand_avatar_images_position_check
    check (position between 1 and 5),
  constraint brand_avatar_images_mime_type_check
    check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  constraint brand_avatar_images_size_check
    check (size_bytes > 0 and size_bytes <= 5242880),
  constraint brand_avatar_images_checksum_check
    check (checksum ~ '^[0-9a-f]{64}$'),
  constraint brand_avatar_images_avatar_ownership_fk
    foreign key (avatar_id, workspace_id, brand_id)
    references brand_avatars(id, workspace_id, brand_id) on delete cascade,
  constraint brand_avatar_images_creator_membership_fk
    foreign key (workspace_id, created_by_user_id)
    references workspace_members(workspace_id, user_id) on delete restrict,
  constraint brand_avatar_images_tenant_identity_unique
    unique (id, workspace_id, brand_id),
  constraint brand_avatar_images_position_unique
    unique (avatar_id, position),
  constraint brand_avatar_images_storage_path_unique
    unique (workspace_id, brand_id, storage_path)
);

create unique index if not exists brand_avatar_images_one_representative
  on brand_avatar_images (avatar_id)
  where is_representative;

create or replace function assert_brand_avatar_image_commit_state(
  target_avatar_id uuid
)
returns void
language plpgsql
as $$
declare
  image_count integer;
  representative_count integer;
begin
  if target_avatar_id is null or not exists (
    select 1 from brand_avatars avatar where avatar.id = target_avatar_id
  ) then
    return;
  end if;

  select
    count(*)::integer,
    count(*) filter (where image.is_representative)::integer
  into image_count, representative_count
  from brand_avatar_images image
  where image.avatar_id = target_avatar_id;

  if image_count not between 1 and 5 or representative_count <> 1 then
    raise exception using
      errcode = '23514',
      message = 'brand_avatar_image_commit_state_invalid',
      constraint = 'brand_avatar_images_commit_state_check';
  end if;
end;
$$;

create or replace function check_brand_avatar_image_commit_state_from_avatar()
returns trigger
language plpgsql
as $$
begin
  perform assert_brand_avatar_image_commit_state(new.id);
  return null;
end;
$$;

create or replace function check_brand_avatar_image_commit_state_from_image()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform assert_brand_avatar_image_commit_state(new.avatar_id);
  end if;
  if tg_op = 'DELETE'
     or (tg_op = 'UPDATE' and old.avatar_id <> new.avatar_id) then
    perform assert_brand_avatar_image_commit_state(old.avatar_id);
  end if;
  return null;
end;
$$;

drop trigger if exists brand_avatars_image_commit_state on brand_avatars;
create constraint trigger brand_avatars_image_commit_state
after insert or update on brand_avatars
deferrable initially deferred
for each row
execute function check_brand_avatar_image_commit_state_from_avatar();

drop trigger if exists brand_avatar_images_commit_state on brand_avatar_images;
create constraint trigger brand_avatar_images_commit_state
after insert or update or delete on brand_avatar_images
deferrable initially deferred
for each row
execute function check_brand_avatar_image_commit_state_from_image();

create table if not exists reference_brands (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  platform text not null check (length(trim(platform)) > 0),
  handle text not null check (length(trim(handle)) > 0),
  display_name text not null check (length(trim(display_name)) > 0),
  public_source_url text not null check (length(trim(public_source_url)) > 0),
  profile_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(profile_snapshot) = 'object'),
  saved_at timestamptz not null default now(),
  refreshed_at timestamptz null,
  created_by_user_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reference_brands_brand_ownership_fk
    foreign key (brand_id, workspace_id)
    references brands(id, workspace_id) on delete cascade,
  constraint reference_brands_creator_membership_fk
    foreign key (workspace_id, created_by_user_id)
    references workspace_members(workspace_id, user_id) on delete restrict,
  constraint reference_brands_tenant_identity_unique
    unique (id, workspace_id, brand_id)
);

create unique index if not exists reference_brands_platform_handle_unique
  on reference_brands (workspace_id, brand_id, lower(platform), lower(handle));

create table if not exists reference_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  kind text not null,
  content_purpose text not null default 'both',
  origin text not null default '',
  title text not null default '',
  preview_url text null,
  source_url text null,
  format text null,
  metadata jsonb not null default '{}'::jsonb,
  is_favorite boolean not null default false,
  last_used_at timestamptz null,
  archived_at timestamptz null,
  reference_brand_id uuid null,
  source_url_id uuid null,
  saved_trend_id uuid null,
  channel_output_id uuid null,
  storage_artifact_id uuid null,
  created_by_user_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reference_items_kind_check check (
    kind in (
      'saved_brand', 'saved_content', 'trend', 'external_url', 'upload',
      'owned_performance'
    )
  ),
  constraint reference_items_content_purpose_check
    check (content_purpose in ('informational', 'marketing', 'both')),
  constraint reference_items_metadata_object_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint reference_items_exactly_one_origin_check check (
    num_nonnulls(
      reference_brand_id,
      source_url_id,
      saved_trend_id,
      channel_output_id,
      storage_artifact_id
    ) = 1
  ),
  constraint reference_items_kind_origin_check check (
    (kind = 'saved_brand' and reference_brand_id is not null)
    or (kind in ('saved_content', 'external_url') and source_url_id is not null)
    or (kind = 'trend' and saved_trend_id is not null)
    or (kind = 'upload' and storage_artifact_id is not null)
    or (kind = 'owned_performance' and channel_output_id is not null)
  ),
  constraint reference_items_brand_ownership_fk
    foreign key (brand_id, workspace_id)
    references brands(id, workspace_id) on delete cascade,
  constraint reference_items_reference_brand_ownership_fk
    foreign key (reference_brand_id, workspace_id, brand_id)
    references reference_brands(id, workspace_id, brand_id) on delete restrict,
  constraint reference_items_source_url_ownership_fk
    foreign key (source_url_id, workspace_id, brand_id)
    references source_urls(id, workspace_id, brand_id) on delete restrict,
  constraint reference_items_saved_trend_ownership_fk
    foreign key (saved_trend_id, workspace_id, brand_id)
    references brand_trend_saved_media(id, workspace_id, brand_id) on delete restrict,
  constraint reference_items_channel_output_ownership_fk
    foreign key (channel_output_id, workspace_id, brand_id)
    references channel_outputs(id, workspace_id, brand_id) on delete restrict,
  constraint reference_items_storage_artifact_ownership_fk
    foreign key (storage_artifact_id, workspace_id, brand_id)
    references storage_artifacts(id, workspace_id, brand_id) on delete restrict,
  constraint reference_items_creator_membership_fk
    foreign key (workspace_id, created_by_user_id)
    references workspace_members(workspace_id, user_id) on delete restrict,
  constraint reference_items_tenant_identity_unique
    unique (id, workspace_id, brand_id)
);

create unique index if not exists reference_items_reference_brand_origin_unique
  on reference_items (workspace_id, brand_id, reference_brand_id)
  where reference_brand_id is not null;

create unique index if not exists reference_items_source_url_origin_unique
  on reference_items (workspace_id, brand_id, source_url_id)
  where source_url_id is not null;

create unique index if not exists reference_items_saved_trend_origin_unique
  on reference_items (workspace_id, brand_id, saved_trend_id)
  where saved_trend_id is not null;

create unique index if not exists reference_items_channel_output_origin_unique
  on reference_items (workspace_id, brand_id, channel_output_id)
  where channel_output_id is not null;

create unique index if not exists reference_items_storage_artifact_origin_unique
  on reference_items (workspace_id, brand_id, storage_artifact_id)
  where storage_artifact_id is not null;

create index if not exists reference_items_brand_active_idx
  on reference_items (workspace_id, brand_id, kind, created_at desc)
  where archived_at is null;

create table if not exists reference_item_source_url_provenance (
  reference_item_id uuid not null,
  source_url_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  relationship text not null default 'legacy_link'
    check (relationship in ('legacy_link', 'canonical_page', 'discovered_from')),
  created_at timestamptz not null default now(),
  primary key (reference_item_id, source_url_id),
  constraint reference_item_source_url_provenance_item_fk
    foreign key (reference_item_id, workspace_id, brand_id)
    references reference_items(id, workspace_id, brand_id) on delete cascade,
  constraint reference_item_source_url_provenance_source_fk
    foreign key (source_url_id, workspace_id, brand_id)
    references source_urls(id, workspace_id, brand_id) on delete restrict
);

create table if not exists reference_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  nonce text not null check (length(trim(nonce)) >= 16),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  storage_path_prefix text not null check (length(trim(storage_path_prefix)) > 0),
  expected_mime_type text not null check (length(trim(expected_mime_type)) > 0),
  expected_size_bytes bigint not null check (expected_size_bytes > 0),
  expected_checksum text not null
    check (expected_checksum ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  confirmed_at timestamptz null,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  constraint reference_upload_sessions_expiry_check
    check (expires_at > created_at),
  constraint reference_upload_sessions_brand_ownership_fk
    foreign key (brand_id, workspace_id)
    references brands(id, workspace_id) on delete cascade,
  constraint reference_upload_sessions_creator_membership_fk
    foreign key (workspace_id, created_by_user_id)
    references workspace_members(workspace_id, user_id) on delete restrict,
  constraint reference_upload_sessions_nonce_unique unique (nonce),
  constraint reference_upload_sessions_tenant_identity_unique
    unique (id, workspace_id, brand_id)
);

create index if not exists reference_upload_sessions_expiry_idx
  on reference_upload_sessions (workspace_id, brand_id, expires_at)
  where confirmed_at is null;

create table if not exists reference_patterns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null,
  reference_item_id uuid not null,
  observations jsonb not null default '[]'::jsonb
    check (jsonb_typeof(observations) = 'array'),
  interpretation text not null default '',
  application_ideas jsonb not null default '[]'::jsonb
    check (jsonb_typeof(application_ideas) = 'array'),
  do_not_copy jsonb not null default '[]'::jsonb
    check (jsonb_typeof(do_not_copy) = 'array'),
  confidence numeric(5,4) not null
    check (confidence between 0 and 1),
  analysis_version text not null check (length(trim(analysis_version)) > 0),
  created_by_user_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reference_patterns_item_ownership_fk
    foreign key (reference_item_id, workspace_id, brand_id)
    references reference_items(id, workspace_id, brand_id) on delete cascade,
  constraint reference_patterns_creator_membership_fk
    foreign key (workspace_id, created_by_user_id)
    references workspace_members(workspace_id, user_id) on delete restrict,
  constraint reference_patterns_tenant_identity_unique
    unique (id, workspace_id, brand_id),
  constraint reference_patterns_item_version_unique
    unique (reference_item_id, analysis_version)
);

insert into reference_items (
  workspace_id,
  brand_id,
  kind,
  content_purpose,
  origin,
  title,
  preview_url,
  source_url,
  format,
  metadata,
  saved_trend_id,
  created_at,
  updated_at
)
select
  saved.workspace_id,
  saved.brand_id,
  'trend',
  source.content_purpose,
  coalesce(nullif(trim(media.username), ''), 'Instagram'),
  coalesce(nullif(trim(media.caption), ''), nullif(trim(media.username), ''), media.permalink),
  media.media_url,
  coalesce(source.url, media.permalink),
  lower(media.media_type),
  jsonb_build_object(
    'instagramMediaId', media.instagram_media_id,
    'username', media.username,
    'permalink', media.permalink
  ),
  saved.id,
  saved.created_at,
  now()
from brand_trend_saved_media saved
join instagram_trend_media media
  on media.id = saved.trend_media_id
join source_urls source
  on source.id = saved.source_url_id
 and source.workspace_id = saved.workspace_id
 and source.brand_id = saved.brand_id
where not exists (
  select 1
  from reference_items existing
  where existing.workspace_id = saved.workspace_id
    and existing.brand_id = saved.brand_id
    and existing.saved_trend_id = saved.id
)
on conflict do nothing;

insert into reference_item_source_url_provenance (
  reference_item_id,
  source_url_id,
  workspace_id,
  brand_id,
  relationship
)
select
  item.id,
  saved.source_url_id,
  saved.workspace_id,
  saved.brand_id,
  'legacy_link'
from brand_trend_saved_media saved
join reference_items item
  on item.workspace_id = saved.workspace_id
 and item.brand_id = saved.brand_id
 and item.saved_trend_id = saved.id
on conflict (reference_item_id, source_url_id) do nothing;

insert into reference_items (
  workspace_id,
  brand_id,
  kind,
  content_purpose,
  origin,
  title,
  source_url,
  format,
  metadata,
  source_url_id,
  created_at,
  updated_at
)
select
  source.workspace_id,
  source.brand_id,
  'external_url',
  source.content_purpose,
  coalesce(nullif(trim(source.domain), ''), source.url),
  coalesce(nullif(trim(source.title), ''), source.url),
  source.url,
  'url',
  jsonb_build_object(
    'domain', source.domain,
    'description', source.meta_description,
    'legacyStatus', source.status
  ),
  source.id,
  source.created_at,
  source.updated_at
from source_urls source
where source.source_type = 'reference'
  and source.enabled
  and source.deleted_at is null
  and source.status <> 'disabled'
  and not exists (
    select 1
    from brand_trend_saved_media saved
    where saved.workspace_id = source.workspace_id
      and saved.brand_id = source.brand_id
      and saved.source_url_id = source.id
  )
  and not exists (
    select 1
    from reference_items existing
    where existing.workspace_id = source.workspace_id
      and existing.brand_id = source.brand_id
      and existing.source_url_id = source.id
  )
on conflict do nothing;

create or replace function upsert_brand_trend_saved_reference(
  target_saved_id uuid,
  target_actor_user_id uuid default null
)
returns uuid
language plpgsql
as $$
declare
  saved_record record;
  target_reference_item_id uuid;
begin
  select
    saved.id,
    saved.workspace_id,
    saved.brand_id,
    saved.created_at,
    source.id as source_url_id,
    source.url,
    source.domain,
    source.title as source_title,
    source.content_purpose,
    media.instagram_media_id,
    media.username,
    media.caption,
    media.media_type,
    media.media_url,
    media.permalink
  into saved_record
  from brand_trend_saved_media saved
  join source_urls source
    on source.id = saved.source_url_id
   and source.workspace_id = saved.workspace_id
   and source.brand_id = saved.brand_id
  join instagram_trend_media media
    on media.id = saved.trend_media_id
  where saved.id = target_saved_id
  for update of saved, source;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'brand_trend_saved_media_not_found';
  end if;

  if target_actor_user_id is not null and not exists (
    select 1
    from workspace_members member
    where member.workspace_id = saved_record.workspace_id
      and member.user_id = target_actor_user_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'reference_item_actor_not_in_workspace';
  end if;

  select item.id
  into target_reference_item_id
  from reference_items item
  where item.workspace_id = saved_record.workspace_id
    and item.brand_id = saved_record.brand_id
    and (
      item.saved_trend_id = saved_record.id
      or item.source_url_id = saved_record.source_url_id
    )
  order by (item.saved_trend_id = saved_record.id) desc, item.created_at
  limit 1
  for update;

  if target_reference_item_id is null then
    insert into reference_items (
      workspace_id,
      brand_id,
      kind,
      content_purpose,
      origin,
      title,
      preview_url,
      source_url,
      format,
      metadata,
      saved_trend_id,
      created_by_user_id,
      created_at,
      updated_at
    ) values (
      saved_record.workspace_id,
      saved_record.brand_id,
      'trend',
      saved_record.content_purpose,
      coalesce(nullif(trim(saved_record.username), ''), 'Instagram'),
      coalesce(
        nullif(trim(saved_record.caption), ''),
        nullif(trim(saved_record.username), ''),
        saved_record.permalink
      ),
      saved_record.media_url,
      coalesce(saved_record.url, saved_record.permalink),
      lower(saved_record.media_type),
      jsonb_build_object(
        'instagramMediaId', saved_record.instagram_media_id,
        'username', saved_record.username,
        'permalink', saved_record.permalink
      ),
      saved_record.id,
      target_actor_user_id,
      saved_record.created_at,
      now()
    )
    returning id into target_reference_item_id;
  else
    update reference_items item
    set kind = 'trend',
        content_purpose = saved_record.content_purpose,
        origin = coalesce(nullif(trim(saved_record.username), ''), 'Instagram'),
        title = coalesce(
          nullif(trim(saved_record.caption), ''),
          nullif(trim(saved_record.username), ''),
          saved_record.permalink
        ),
        preview_url = saved_record.media_url,
        source_url = coalesce(saved_record.url, saved_record.permalink),
        format = lower(saved_record.media_type),
        metadata = item.metadata || jsonb_build_object(
          'instagramMediaId', saved_record.instagram_media_id,
          'username', saved_record.username,
          'permalink', saved_record.permalink
        ),
        archived_at = null,
        reference_brand_id = null,
        source_url_id = null,
        saved_trend_id = saved_record.id,
        channel_output_id = null,
        storage_artifact_id = null,
        created_by_user_id = coalesce(item.created_by_user_id, target_actor_user_id),
        updated_at = now()
    where item.id = target_reference_item_id;
  end if;

  insert into reference_item_source_url_provenance (
    reference_item_id,
    source_url_id,
    workspace_id,
    brand_id,
    relationship
  ) values (
    target_reference_item_id,
    saved_record.source_url_id,
    saved_record.workspace_id,
    saved_record.brand_id,
    'legacy_link'
  )
  on conflict (reference_item_id, source_url_id) do nothing;

  return target_reference_item_id;
end;
$$;

create or replace function archive_brand_trend_saved_reference(
  target_saved_id uuid,
  target_actor_user_id uuid default null
)
returns uuid
language plpgsql
as $$
declare
  saved_record record;
  target_reference_item_id uuid;
begin
  select saved.id, saved.workspace_id, saved.brand_id, saved.source_url_id
  into saved_record
  from brand_trend_saved_media saved
  where saved.id = target_saved_id
  for update;

  if not found then
    return null;
  end if;

  if target_actor_user_id is not null and not exists (
    select 1
    from workspace_members member
    where member.workspace_id = saved_record.workspace_id
      and member.user_id = target_actor_user_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'reference_item_actor_not_in_workspace';
  end if;

  select item.id
  into target_reference_item_id
  from reference_items item
  where item.workspace_id = saved_record.workspace_id
    and item.brand_id = saved_record.brand_id
    and (
      item.saved_trend_id = saved_record.id
      or item.source_url_id = saved_record.source_url_id
    )
  order by (item.saved_trend_id = saved_record.id) desc, item.created_at
  limit 1
  for update;

  if target_reference_item_id is not null then
    update reference_items item
    set kind = 'external_url',
        archived_at = coalesce(item.archived_at, now()),
        source_url_id = saved_record.source_url_id,
        saved_trend_id = null,
        metadata = item.metadata || case
          when target_actor_user_id is null then '{}'::jsonb
          else jsonb_build_object('archivedByUserId', target_actor_user_id)
        end,
        updated_at = now()
    where item.id = target_reference_item_id;
  end if;

  update source_urls source
  set enabled = false,
      status = 'disabled',
      disabled_at = coalesce(source.disabled_at, now()),
      updated_at = now()
  where source.id = saved_record.source_url_id
    and source.workspace_id = saved_record.workspace_id
    and source.brand_id = saved_record.brand_id;

  return target_reference_item_id;
end;
$$;

create or replace function sync_brand_trend_saved_reference_after_insert()
returns trigger
language plpgsql
as $$
begin
  perform upsert_brand_trend_saved_reference(new.id, null);
  return new;
end;
$$;

create or replace function sync_brand_trend_saved_reference_before_delete()
returns trigger
language plpgsql
as $$
begin
  perform archive_brand_trend_saved_reference(old.id, null);
  return old;
end;
$$;

drop trigger if exists brand_trend_saved_media_reference_after_insert
  on brand_trend_saved_media;
create trigger brand_trend_saved_media_reference_after_insert
after insert on brand_trend_saved_media
for each row
execute function sync_brand_trend_saved_reference_after_insert();

drop trigger if exists brand_trend_saved_media_reference_before_delete
  on brand_trend_saved_media;
create trigger brand_trend_saved_media_reference_before_delete
before delete on brand_trend_saved_media
for each row
execute function sync_brand_trend_saved_reference_before_delete();

-- The triggers are installed before this second sweep. Saves committed before
-- trigger installation are reconciled here; saves committed afterward fire the
-- trigger, so a rolling deploy cannot leave an unprojected saved trend.
do $$
declare
  saved_record record;
begin
  for saved_record in
    select saved.id from brand_trend_saved_media saved
  loop
    perform upsert_brand_trend_saved_reference(saved_record.id, null);
  end loop;
end;
$$;

drop trigger if exists brand_avatars_set_updated_at on brand_avatars;
create trigger brand_avatars_set_updated_at
before update on brand_avatars
for each row execute function set_updated_at();

drop trigger if exists reference_brands_set_updated_at on reference_brands;
create trigger reference_brands_set_updated_at
before update on reference_brands
for each row execute function set_updated_at();

drop trigger if exists reference_items_set_updated_at on reference_items;
create trigger reference_items_set_updated_at
before update on reference_items
for each row execute function set_updated_at();

drop trigger if exists reference_patterns_set_updated_at on reference_patterns;
create trigger reference_patterns_set_updated_at
before update on reference_patterns
for each row execute function set_updated_at();

commit;
