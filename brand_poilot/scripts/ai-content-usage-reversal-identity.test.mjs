import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";

const migrationPath = "db/migrations/084_ai_content_usage_reversal_identity_invoker.sql";

test("084 keeps reversal identity validation but performs an ordinary immutable reservation lookup", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.enforce_ai_content_usage_reversal_identity\(\)\s+returns\s+trigger/iu);
  assert.match(sql, /language\s+plpgsql\s+security\s+invoker\s+set\s+search_path\s*=\s*pg_catalog\s*,\s*public\s*,\s*pg_temp/iu);
  assert.match(sql, /from\s+public\.ai_content_usage_ledger\s+where\s+id\s*=\s*new\.reversal_of_ledger_id/iu);
  assert.doesNotMatch(sql, /\bfor\s+(?:update|no\s+key\s+update|share|key\s+share)\b/iu);

  for (const identityCheck of [
    "reservation.usage_type<>'generation'",
    "reservation.workspace_id<>new.workspace_id",
    "reservation.brand_id<>new.brand_id",
    "reservation.generation_id<>new.generation_id",
    "reservation.operation_idisdistinctfromnew.operation_id",
    "reservation.reservation_idisdistinctfromreservation.id",
    "new.reservation_idisdistinctfromreservation.id",
    "reservation.usage_date<>new.usage_date",
    "reservation.quantity<>-new.quantity",
  ]) {
    assert.ok(
      sql.replace(/\s+/gu, "").includes(identityCheck),
      `missing reversal identity check: ${identityCheck}`,
    );
  }
  assert.match(sql, /raise\s+exception\s+'ai_content_usage_reversal_mismatch'/iu);
});

async function waitForUniqueIndexBlock(pool, blockerPid, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query(
      `select count(*)::integer count
         from pg_stat_activity
        where datname=current_database() and pid<>$1
          and $1=any(pg_blocking_pids(pid))`,
      [blockerPid],
    );
    if (Number(result.rows[0]?.count ?? 0) > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

test("084 lets the SELECT+INSERT application role reverse once while the unique index serializes duplicates", {
  skip: process.env.RUN_AI_CONTENT_REVERSAL_POSTGRES !== "true",
  timeout: 180_000,
}, async () => {
  const container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("ai_content_reversal_identity")
    .withUsername("brand_pilot")
    .withPassword("brand_pilot")
    .start();
  const providerPool = new Pool({ connectionString: container.getConnectionUri(), max: 4 });
  let applicationPool;
  try {
    await providerPool.query(`
      create role content_schema_owner nologin;
      create role content_application login password 'content-application-test';
      grant usage,create on schema public to content_schema_owner;
      grant usage on schema public to content_application;
      set role content_schema_owner;
      create table public.ai_content_usage_ledger(
        id uuid primary key,
        workspace_id uuid not null,
        brand_id uuid not null,
        generation_id uuid not null,
        output_id uuid null,
        usage_type text not null check(usage_type in ('generation','new_download','reversal')),
        quantity integer not null check(quantity<>0 and ((usage_type='reversal' and quantity<0) or (usage_type<>'reversal' and quantity>0))),
        usage_date date not null,
        idempotency_key text not null,
        created_at timestamptz not null default now(),
        operation_id uuid null,
        reservation_id uuid null,
        reversal_of_ledger_id uuid null references public.ai_content_usage_ledger(id) on delete restrict,
        constraint ai_content_usage_ledger_reservation_identity_check check(
          (operation_id is null and reservation_id is null and reversal_of_ledger_id is null)
          or (usage_type='generation' and operation_id is not null and reservation_id=id and reversal_of_ledger_id is null)
          or (usage_type='reversal' and operation_id is not null and reservation_id is not null and reversal_of_ledger_id is not null)
        )
      );
      create unique index ai_content_usage_ledger_idempotency_unique
        on public.ai_content_usage_ledger(brand_id,idempotency_key);
      create unique index ai_content_usage_one_reversal_per_reservation_uq
        on public.ai_content_usage_ledger(reversal_of_ledger_id)
        where usage_type='reversal' and reversal_of_ledger_id is not null;
      create function public.enforce_ai_content_usage_reversal_identity() returns trigger
      language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
      declare reservation public.ai_content_usage_ledger%rowtype;
      begin
        if new.usage_type<>'reversal' or new.reversal_of_ledger_id is null then return new; end if;
        select * into strict reservation from public.ai_content_usage_ledger
         where id=new.reversal_of_ledger_id for update;
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
      create trigger ai_content_usage_reversal_identity before insert on public.ai_content_usage_ledger
        for each row execute function public.enforce_ai_content_usage_reversal_identity();
      create function public.reject_ai_content_usage_ledger_mutation() returns trigger
      language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
      begin
        raise exception using errcode='55000',message='ai_content_usage_ledger_immutable';
      end;
      $$;
      create trigger ai_content_usage_ledger_immutable before update or delete on public.ai_content_usage_ledger
        for each row execute function public.reject_ai_content_usage_ledger_mutation();
      reset role;
      grant select,insert on public.ai_content_usage_ledger to content_application;
    `);
    const appUrl = new URL(container.getConnectionUri());
    appUrl.username = "content_application";
    appUrl.password = "content-application-test";
    applicationPool = new Pool({ connectionString: appUrl.toString(), max: 4 });

    const scope = {
      workspaceId: randomUUID(),
      brandId: randomUUID(),
      generationId: randomUUID(),
      operationId: randomUUID(),
      reservationId: randomUUID(),
    };
    await applicationPool.query(
      `insert into public.ai_content_usage_ledger(
         id,workspace_id,brand_id,generation_id,output_id,usage_type,quantity,usage_date,
         idempotency_key,operation_id,reservation_id,reversal_of_ledger_id
       ) values($1,$2,$3,$4,null,'generation',1,date '2026-08-21',$5,$6,$1,null)`,
      [scope.reservationId, scope.workspaceId, scope.brandId, scope.generationId,
        `reservation:${scope.operationId}`, scope.operationId],
    );
    await assert.rejects(
      applicationPool.query(
        `insert into public.ai_content_usage_ledger(
           id,workspace_id,brand_id,generation_id,output_id,usage_type,quantity,usage_date,
           idempotency_key,operation_id,reservation_id,reversal_of_ledger_id
         ) values($1,$2,$3,$4,null,'reversal',-1,date '2026-08-21',$5,$6,$7,$7)`,
        [randomUUID(), scope.workspaceId, scope.brandId, scope.generationId,
          `broken-reversal:${scope.operationId}`, scope.operationId, scope.reservationId],
      ),
      (error) => error?.code === "42501",
    );

    const migration = await readFile(migrationPath, "utf8");
    await providerPool.query(migration);
    const catalog = await providerPool.query(
      `select owner.rolname owner_role_name,routine.prosecdef,
              pg_get_functiondef(routine.oid) function_definition,
              has_table_privilege('content_application','public.ai_content_usage_ledger','SELECT') app_select,
              has_table_privilege('content_application','public.ai_content_usage_ledger','INSERT') app_insert,
              has_table_privilege('content_application','public.ai_content_usage_ledger','UPDATE') app_update,
              has_table_privilege('content_application','public.ai_content_usage_ledger','DELETE') app_delete
         from pg_proc routine join pg_roles owner on owner.oid=routine.proowner
        where routine.oid='public.enforce_ai_content_usage_reversal_identity()'::regprocedure`,
    );
    assert.equal(catalog.rows[0]?.owner_role_name, "content_schema_owner");
    assert.equal(catalog.rows[0]?.prosecdef, false);
    assert.doesNotMatch(String(catalog.rows[0]?.function_definition), /\bfor\s+(?:update|no\s+key\s+update|share|key\s+share)\b/iu);
    assert.deepEqual({
      select: catalog.rows[0]?.app_select,
      insert: catalog.rows[0]?.app_insert,
      update: catalog.rows[0]?.app_update,
      delete: catalog.rows[0]?.app_delete,
    }, { select: true, insert: true, update: false, delete: false });

    await applicationPool.query(
      `insert into public.ai_content_usage_ledger(
         id,workspace_id,brand_id,generation_id,output_id,usage_type,quantity,usage_date,
         idempotency_key,operation_id,reservation_id,reversal_of_ledger_id
       ) values($1,$2,$3,$4,null,'reversal',-1,date '2026-08-21',$5,$6,$7,$7)`,
      [randomUUID(), scope.workspaceId, scope.brandId, scope.generationId,
        `reversal:${scope.operationId}`, scope.operationId, scope.reservationId],
    );
    await assert.rejects(
      applicationPool.query("update public.ai_content_usage_ledger set quantity=quantity where id=$1", [scope.reservationId]),
      (error) => error?.code === "42501",
    );

    const race = {
      ...scope,
      operationId: randomUUID(),
      reservationId: randomUUID(),
    };
    await applicationPool.query(
      `insert into public.ai_content_usage_ledger(
         id,workspace_id,brand_id,generation_id,output_id,usage_type,quantity,usage_date,
         idempotency_key,operation_id,reservation_id,reversal_of_ledger_id
       ) values($1,$2,$3,$4,null,'generation',1,date '2026-08-21',$5,$6,$1,null)`,
      [race.reservationId, race.workspaceId, race.brandId, race.generationId,
        `reservation:${race.operationId}`, race.operationId],
    );
    const first = await applicationPool.connect();
    const second = await applicationPool.connect();
    try {
      await first.query("begin");
      await second.query("begin");
      const blockerPid = Number((await first.query("select pg_backend_pid() pid")).rows[0]?.pid);
      await first.query(
        `insert into public.ai_content_usage_ledger(
           id,workspace_id,brand_id,generation_id,output_id,usage_type,quantity,usage_date,
           idempotency_key,operation_id,reservation_id,reversal_of_ledger_id
         ) values($1,$2,$3,$4,null,'reversal',-1,date '2026-08-21',$5,$6,$7,$7)`,
        [randomUUID(), race.workspaceId, race.brandId, race.generationId,
          `race-a:${race.operationId}`, race.operationId, race.reservationId],
      );
      const competingInsert = second.query(
        `insert into public.ai_content_usage_ledger(
           id,workspace_id,brand_id,generation_id,output_id,usage_type,quantity,usage_date,
           idempotency_key,operation_id,reservation_id,reversal_of_ledger_id
         ) values($1,$2,$3,$4,null,'reversal',-1,date '2026-08-21',$5,$6,$7,$7)`,
        [randomUUID(), race.workspaceId, race.brandId, race.generationId,
          `race-b:${race.operationId}`, race.operationId, race.reservationId],
      );
      assert.equal(await waitForUniqueIndexBlock(providerPool, blockerPid), true);
      await first.query("commit");
      await assert.rejects(competingInsert, (error) => error?.code === "23505");
      await second.query("rollback");
    } finally {
      first.release();
      second.release();
    }
    const reversals = await applicationPool.query(
      "select count(*)::integer count from public.ai_content_usage_ledger where reversal_of_ledger_id=$1",
      [race.reservationId],
    );
    assert.equal(reversals.rows[0]?.count, 1);
  } finally {
    await applicationPool?.end();
    await providerPool.end();
    await container.stop();
  }
});
