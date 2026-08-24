begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  subscription_started_at timestamptz := clock_timestamp();
begin
  if not exists (
    select 1
      from billing_plan_catalog
     where code = 'free'
       and name = 'FREE'
       and weekly_generation_limit = 30
       and weekly_publish_limit = 30
       and active = true
  ) then
    raise exception 'canonical_free_subscription_plan_unavailable';
  end if;

  insert into brand_subscriptions(
    brand_id,
    plan_code,
    status,
    started_at,
    current_period_start,
    current_period_end
  )
  select
    brand.id,
    'free',
    'active',
    subscription_started_at,
    subscription_started_at,
    subscription_started_at + interval '1 month'
  from brands brand
  left join brand_subscriptions subscription on subscription.brand_id = brand.id
  where brand.deleted_at is null
    and subscription.brand_id is null;
end $$;

commit;
