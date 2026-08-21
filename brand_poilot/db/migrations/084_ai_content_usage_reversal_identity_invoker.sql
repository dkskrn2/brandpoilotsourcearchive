begin;

-- The usage ledger is immutable and permits the application role to SELECT and
-- INSERT only. A locking SELECT would additionally require UPDATE privilege even
-- though the referenced reservation cannot be changed. The partial unique index
-- on reversal_of_ledger_id continues to serialize duplicate reversals.
create or replace function public.enforce_ai_content_usage_reversal_identity() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
declare reservation public.ai_content_usage_ledger%rowtype;
begin
  if new.usage_type<>'reversal' or new.reversal_of_ledger_id is null then return new; end if;
  select * into strict reservation from public.ai_content_usage_ledger
   where id=new.reversal_of_ledger_id;
  if reservation.usage_type<>'generation'
     or reservation.workspace_id<>new.workspace_id or reservation.brand_id<>new.brand_id
     or reservation.generation_id<>new.generation_id
     or reservation.operation_id is distinct from new.operation_id
     or reservation.reservation_id is distinct from reservation.id
     or new.reservation_id is distinct from reservation.id
     or reservation.usage_date<>new.usage_date
     or reservation.quantity<>-new.quantity then
    raise exception 'ai_content_usage_reversal_mismatch';
  end if;
  return new;
end;
$$;

commit;
