begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table publish_calendar_weekly_schedule_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  day_of_week smallint not null,
  slot_time time not null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publish_calendar_weekly_schedule_day_check
    check (day_of_week between 1 and 7),
  constraint publish_calendar_weekly_schedule_sort_check
    check (sort_order >= 0),
  constraint publish_calendar_weekly_schedule_brand_day_sort_unique
    unique (brand_id,day_of_week,sort_order)
);

create trigger publish_calendar_weekly_schedule_entries_set_updated_at
before update on publish_calendar_weekly_schedule_entries
for each row execute function set_updated_at();

create trigger publish_calendar_weekly_schedule_entries_brand_scope
before insert or update of workspace_id,brand_id
on publish_calendar_weekly_schedule_entries
for each row execute function enforce_publish_calendar_brand_scope();

insert into ai_content_write_fence_catalog(relation_name,relation_class,row_classifier)
values ('publish_calendar_weekly_schedule_entries','customer_execution','whole_relation')
on conflict (relation_name) do update
set relation_class=excluded.relation_class,
    row_classifier=excluded.row_classifier,
    reviewed_at=now();

create trigger publish_calendar_weekly_schedule_entries_write_fence
before insert or update or delete on publish_calendar_weekly_schedule_entries
for each row execute function enforce_ai_content_write_fence();

do $$
declare
  schema_owner_role_name name;
  application_role_name name;
  acl_grantee record;
begin
  if to_regclass('public.ai_content_bootstrap_state') is null then return; end if;
  select bootstrap.schema_owner_role_name, bootstrap.application_role_name
    into strict schema_owner_role_name, application_role_name
    from public.ai_content_bootstrap_state bootstrap
   where bootstrap.singleton;
  execute format(
    'alter table public.publish_calendar_weekly_schedule_entries owner to %I',
    schema_owner_role_name
  );
  for acl_grantee in
    select scrub.grantee,scrub.grantee_role_name
      from (
        select distinct acl.grantee,
               case acl.grantee when 0 then 'PUBLIC' else grantee.rolname::text end grantee_role_name
          from pg_class relation
          cross join lateral aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) acl
          left join pg_roles grantee on grantee.oid=acl.grantee
         where relation.oid='public.publish_calendar_weekly_schedule_entries'::regclass
           and acl.grantee<>relation.relowner
      ) scrub
     order by scrub.grantee_role_name collate "C"
  loop
    if acl_grantee.grantee=0 then
      execute 'revoke all on table public.publish_calendar_weekly_schedule_entries from public';
    elsif acl_grantee.grantee_role_name is null then
      raise exception 'publish_calendar_weekly_schedule_acl_grantee_invalid';
    else
      execute format(
        'revoke all on table public.publish_calendar_weekly_schedule_entries from %I',
        acl_grantee.grantee_role_name
      );
    end if;
  end loop;
  execute format(
    'grant select,insert,update,delete on public.publish_calendar_weekly_schedule_entries to %I',
    application_role_name
  );
end;
$$;

commit;
