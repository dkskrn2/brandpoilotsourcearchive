begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (
    select 1 from billing_plan_catalog where code = 'free'
  ) then
    if not exists (
      select 1
        from billing_plan_catalog
       where code = 'free'
         and name = 'FREE'
         and weekly_generation_limit = 30
         and weekly_publish_limit = 30
         and active = true
    ) then
      raise exception 'free_subscription_plan_conflict';
    end if;
  else
    insert into billing_plan_catalog(
      code,
      name,
      weekly_generation_limit,
      weekly_publish_limit,
      active
    ) values (
      'free',
      'FREE',
      30,
      30,
      true
    );
  end if;
end $$;

commit;
