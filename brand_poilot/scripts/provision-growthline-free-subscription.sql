begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

select pg_advisory_xact_lock(hashtextextended('brand-pilot:growthline-free-subscription', 0));

do $$
declare
  target_brand_id uuid;
  target_count integer;
  existing_subscription_count integer;
  provisioned_at timestamptz := clock_timestamp();
begin
  select count(*)::integer
    into target_count
    from brands brand
   where lower(trim(brand.name)) = 'growthline'
     and brand.status = 'active'
     and brand.deleted_at is null;

  if target_count <> 1 then
    raise exception 'growthline_target_count_invalid:%', target_count;
  end if;

  select brand.id
    into strict target_brand_id
    from brands brand
   where lower(trim(brand.name)) = 'growthline'
     and brand.status = 'active'
     and brand.deleted_at is null;

  if not exists (
    select 1
      from billing_plan_catalog plan
     where plan.code = 'free'
       and plan.name = 'FREE'
       and plan.weekly_generation_limit = 30
       and plan.weekly_publish_limit = 30
       and plan.active = true
  ) then
    raise exception 'free_subscription_plan_invalid';
  end if;

  select count(*)::integer
    into existing_subscription_count
    from brand_subscriptions subscription
   where subscription.brand_id = target_brand_id;

  if existing_subscription_count <> 0 then
    raise exception 'growthline_subscription_already_exists';
  end if;

  insert into brand_subscriptions(
    brand_id,
    plan_code,
    status,
    started_at,
    current_period_start,
    current_period_end,
    pending_plan_code,
    cancel_at_period_end
  ) values (
    target_brand_id,
    'free',
    'active',
    provisioned_at,
    provisioned_at,
    provisioned_at + interval '1 month',
    null,
    false
  );

  if not found then
    raise exception 'growthline_subscription_insert_failed';
  end if;
end $$;

commit;
