begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table billing_plan_catalog (
  code text primary key,
  name text not null,
  weekly_generation_limit integer not null,
  weekly_publish_limit integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_plan_catalog_code_check check (code ~ '^[a-z][a-z0-9_]{1,31}$'),
  constraint billing_plan_catalog_name_check check (length(trim(name)) between 1 and 100),
  constraint billing_plan_catalog_generation_limit_check check (weekly_generation_limit >= 0),
  constraint billing_plan_catalog_publish_limit_check check (weekly_publish_limit >= 0)
);

create trigger billing_plan_catalog_set_updated_at
before update on billing_plan_catalog
for each row execute function set_updated_at();

create table brand_subscriptions (
  brand_id uuid primary key references brands(id) on delete cascade,
  plan_code text not null references billing_plan_catalog(code) on delete restrict,
  status text not null,
  started_at timestamptz not null,
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  pending_plan_code text null references billing_plan_catalog(code) on delete restrict,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_subscriptions_status_check check (
    status in ('pending_payment','active','cancel_scheduled','suspended','cancelled')
  ),
  constraint brand_subscriptions_period_check check (
    started_at <= current_period_start and current_period_start < current_period_end
  ),
  constraint brand_subscriptions_pending_plan_check check (pending_plan_code is distinct from plan_code)
);

create index brand_subscriptions_due_renewal_idx
  on brand_subscriptions(current_period_end)
  where status in ('active','cancel_scheduled');

create trigger brand_subscriptions_set_updated_at
before update on brand_subscriptions
for each row execute function set_updated_at();

create table publish_calendar_settings (
  brand_id uuid primary key references brands(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  enabled boolean not null default false,
  channels text[] not null default '{}'::text[],
  informational_format text not null default 'card_news',
  trend_format text not null default 'reel',
  slot_times time[] not null default array['11:30'::time,'14:30'::time,'17:30'::time,'20:30'::time],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publish_calendar_settings_channels_check check (
    channels <@ array['instagram','threads','tiktok','youtube','x','linkedin']::text[]
  ),
  constraint publish_calendar_settings_informational_format_check check (
    informational_format in ('card_news','reel')
  ),
  constraint publish_calendar_settings_trend_format_check check (
    trend_format in ('card_news','reel')
  ),
  constraint publish_calendar_settings_slot_times_check check (
    cardinality(slot_times) between 1 and 24
  )
);

create trigger publish_calendar_settings_set_updated_at
before update on publish_calendar_settings
for each row execute function set_updated_at();

alter table topic_publish_groups
  add constraint topic_publish_groups_tenant_identity_unique
  unique (id, workspace_id, brand_id);

create table publish_calendar_slots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  scheduled_for timestamptz not null,
  assignment_mode text not null,
  status text not null default 'open',
  recommendation_kind text null,
  content_format text not null,
  channels text[] not null default '{}'::text[],
  content_suggestion_id uuid null references content_suggestions(id) on delete restrict,
  proposal_id uuid null references ai_content_proposals(id) on delete restrict,
  generation_id uuid null references ai_content_generations(id) on delete restrict,
  generation_output_id uuid null references ai_content_generation_outputs(id) on delete restrict,
  topic_publish_group_id uuid null,
  title text null,
  last_error text null,
  created_by_user_id uuid null references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publish_calendar_slots_assignment_mode_check check (
    assignment_mode in ('automatic','manual')
  ),
  constraint publish_calendar_slots_status_check check (
    status in (
      'open','proposal_assigned','generation_pending','content_assigned','ready',
      'scheduled','publish_delayed','quota_blocked','published','cancelled'
    )
  ),
  constraint publish_calendar_slots_recommendation_kind_check check (
    recommendation_kind is null or recommendation_kind in ('informational','trend')
  ),
  constraint publish_calendar_slots_content_format_check check (
    content_format in ('card_news','reel')
  ),
  constraint publish_calendar_slots_channels_check check (
    channels <@ array['instagram','threads','tiktok','youtube','x','linkedin']::text[]
  ),
  constraint publish_calendar_slots_title_check check (
    title is null or length(trim(title)) between 1 and 500
  ),
  constraint publish_calendar_slots_open_assignment_check check (
    status <> 'open' or (
      content_suggestion_id is null and proposal_id is null and generation_id is null and generation_output_id is null
      and topic_publish_group_id is null
    )
  ),
  constraint publish_calendar_slots_proposal_assignment_check check (
    status <> 'proposal_assigned' or (content_suggestion_id is not null or proposal_id is not null)
  ),
  constraint publish_calendar_slots_manual_recommendation_check check (
    assignment_mode <> 'manual' or recommendation_kind is null
  ),
  constraint publish_calendar_slots_topic_publish_group_scope_fk
    foreign key (topic_publish_group_id, workspace_id, brand_id)
    references topic_publish_groups(id, workspace_id, brand_id) on delete restrict
);

create index publish_calendar_slots_brand_period_idx
  on publish_calendar_slots(brand_id, scheduled_for, id);

create unique index publish_calendar_slots_active_brand_time_unique
  on publish_calendar_slots(brand_id, scheduled_for)
  where status <> 'cancelled';

create index publish_calendar_slots_auto_open_idx
  on publish_calendar_slots(brand_id, recommendation_kind, scheduled_for, id)
  where assignment_mode='automatic' and status='open';

create unique index publish_calendar_slots_proposal_unique
  on publish_calendar_slots(proposal_id)
  where proposal_id is not null and status <> 'cancelled';

create unique index publish_calendar_slots_content_suggestion_unique
  on publish_calendar_slots(brand_id,content_suggestion_id)
  where content_suggestion_id is not null and status <> 'cancelled';

create unique index publish_calendar_slots_generation_unique
  on publish_calendar_slots(brand_id,generation_id)
  where generation_id is not null and status <> 'cancelled';

create unique index publish_calendar_slots_publish_group_unique
  on publish_calendar_slots(brand_id,topic_publish_group_id)
  where topic_publish_group_id is not null and status <> 'cancelled';

create index publish_calendar_slots_active_reservation_idx
  on publish_calendar_slots(brand_id, scheduled_for)
  where status in (
    'proposal_assigned','generation_pending','content_assigned','ready',
    'scheduled','publish_delayed','quota_blocked'
  );

create trigger publish_calendar_slots_set_updated_at
before update on publish_calendar_slots
for each row execute function set_updated_at();

create function enforce_publish_calendar_brand_scope() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin
  if not exists (
    select 1 from public.brands brand
     where brand.id=new.brand_id and brand.workspace_id=new.workspace_id
  ) then
    raise exception 'publish_calendar_brand_scope_invalid';
  end if;
  return new;
end;
$$;

create function enforce_publish_calendar_slot_scope() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin
  if new.proposal_id is not null and not exists (
    select 1 from public.ai_content_proposals proposal
     where proposal.id=new.proposal_id
       and proposal.workspace_id=new.workspace_id and proposal.brand_id=new.brand_id
     for key share
  ) then
    raise exception 'publish_calendar_slot_scope_invalid';
  end if;
  if new.generation_id is not null and not exists (
    select 1 from public.ai_content_generations generation
     where generation.id=new.generation_id
       and generation.workspace_id=new.workspace_id and generation.brand_id=new.brand_id
     for key share
  ) then
    raise exception 'publish_calendar_slot_scope_invalid';
  end if;
  if new.generation_output_id is not null and (
    new.generation_id is null or not exists (
      select 1 from public.ai_content_generation_outputs output
       where output.id=new.generation_output_id and output.generation_id=new.generation_id
         and output.workspace_id=new.workspace_id and output.brand_id=new.brand_id
       for key share
    )
  ) then
    raise exception 'publish_calendar_slot_scope_invalid';
  end if;
  -- content_suggestions and its batch/category ancestry have no workspace or brand
  -- ownership columns in migration 077, so tenant ownership cannot be inferred here.
  return new;
end;
$$;

create trigger publish_calendar_settings_brand_scope
before insert or update of workspace_id,brand_id on publish_calendar_settings
for each row execute function enforce_publish_calendar_brand_scope();

create trigger publish_calendar_slots_brand_scope
before insert or update of workspace_id,brand_id on publish_calendar_slots
for each row execute function enforce_publish_calendar_brand_scope();

create trigger publish_calendar_slots_link_scope
before insert or update of workspace_id,brand_id,proposal_id,generation_id,generation_output_id
on publish_calendar_slots
for each row execute function enforce_publish_calendar_slot_scope();

insert into ai_content_write_fence_catalog(relation_name,relation_class,row_classifier)
values
  ('billing_plan_catalog','customer_execution','whole_relation'),
  ('brand_subscriptions','customer_execution','whole_relation'),
  ('publish_calendar_settings','customer_execution','whole_relation'),
  ('publish_calendar_slots','customer_execution','whole_relation')
on conflict (relation_name) do update
set relation_class=excluded.relation_class,
    row_classifier=excluded.row_classifier,
    reviewed_at=now();

create trigger publish_calendar_brand_subscriptions_write_fence
before insert or update or delete on brand_subscriptions
for each row execute function enforce_ai_content_write_fence();

create trigger publish_calendar_billing_plan_catalog_write_fence
before insert or update or delete on billing_plan_catalog
for each row execute function enforce_ai_content_write_fence();

create trigger publish_calendar_settings_write_fence
before insert or update or delete on publish_calendar_settings
for each row execute function enforce_ai_content_write_fence();

create trigger publish_calendar_slots_write_fence
before insert or update or delete on publish_calendar_slots
for each row execute function enforce_ai_content_write_fence();

do $$
declare
  schema_owner_role_name name;
  application_role_name name;
begin
  if to_regclass('public.ai_content_bootstrap_state') is null then return; end if;
  select bootstrap.schema_owner_role_name, bootstrap.application_role_name
    into strict schema_owner_role_name, application_role_name
    from public.ai_content_bootstrap_state bootstrap
   where bootstrap.singleton;
  execute format('alter table public.billing_plan_catalog owner to %I',schema_owner_role_name);
  execute format('alter table public.brand_subscriptions owner to %I',schema_owner_role_name);
  execute format('alter table public.publish_calendar_settings owner to %I',schema_owner_role_name);
  execute format('alter table public.publish_calendar_slots owner to %I',schema_owner_role_name);
  execute format('alter function public.enforce_publish_calendar_brand_scope() owner to %I',schema_owner_role_name);
  execute format('alter function public.enforce_publish_calendar_slot_scope() owner to %I',schema_owner_role_name);
  execute 'revoke all on table public.billing_plan_catalog, public.brand_subscriptions, public.publish_calendar_settings, public.publish_calendar_slots from public';
  execute 'revoke all on function public.enforce_publish_calendar_brand_scope() from public';
  execute 'revoke all on function public.enforce_publish_calendar_slot_scope() from public';
  execute format('grant select,insert,update on public.billing_plan_catalog to %I',application_role_name);
  execute format('grant select,insert,update on public.brand_subscriptions to %I',application_role_name);
  execute format('grant select,insert,update on public.publish_calendar_settings to %I',application_role_name);
  execute format('grant select,insert,update on public.publish_calendar_slots to %I',application_role_name);
  execute format('grant execute on function public.enforce_publish_calendar_brand_scope() to %I',application_role_name);
  execute format('grant execute on function public.enforce_publish_calendar_slot_scope() to %I',application_role_name);
end;
$$;

commit;
