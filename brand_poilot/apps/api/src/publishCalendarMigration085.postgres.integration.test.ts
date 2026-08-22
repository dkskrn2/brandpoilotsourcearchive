import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool, type PoolClient } from "pg";
import { expect, it } from "vitest";
import { createPublishCalendarRepository } from "./publishCalendarRepository.js";

const applicationPassword = "publish-calendar-application-test";
const schemaOwnerRole = "publish_calendar_schema_owner";
const applicationRole = "publish_calendar_application";

function connectionStringForRole(connectionString: string, roleName: string, password: string) {
  const value = new URL(connectionString);
  value.username = roleName;
  value.password = password;
  return value.toString();
}

async function bootstrapPublishCalendarControlPlane(client: PoolClient) {
  await client.query(`
    create table ai_content_maintenance_state(
      singleton boolean primary key default true check(singleton),
      enabled boolean not null default false
    );
    insert into ai_content_maintenance_state(singleton,enabled) values(true,false);

    create table ai_content_bootstrap_state(
      singleton boolean primary key default true check(singleton),
      schema_owner_role_name name not null,
      application_role_name name not null
    );
    insert into ai_content_bootstrap_state(
      singleton,schema_owner_role_name,application_role_name
    ) values(true,'${schemaOwnerRole}','${applicationRole}');

    create table ai_content_write_fence_catalog(
      relation_name text primary key,
      relation_class text not null,
      row_classifier text not null,
      reviewed_at timestamptz not null default now()
    );

    create function assert_ai_content_writable() returns void
    language plpgsql security definer set search_path=pg_catalog,public as $$
    begin
      if exists (
        select 1 from public.ai_content_maintenance_state where singleton and enabled
      ) then
        raise exception 'ai_content_maintenance' using errcode='P0001';
      end if;
    end;
    $$;

    create function enforce_ai_content_write_fence() returns trigger
    language plpgsql security definer set search_path=pg_catalog,public as $$
    declare classifier text;
    begin
      select catalog.row_classifier into strict classifier
        from public.ai_content_write_fence_catalog catalog
       where catalog.relation_class='customer_execution'
         and catalog.relation_name=tg_table_name;
      if classifier<>'whole_relation' then
        raise exception 'publish_calendar_write_fence_fixture_invalid';
      end if;
      perform public.assert_ai_content_writable();
      return case when tg_op='DELETE' then old else new end;
    end;
    $$;

    revoke all on table ai_content_maintenance_state,ai_content_bootstrap_state,
      ai_content_write_fence_catalog from public;
    revoke all on function assert_ai_content_writable(),enforce_ai_content_write_fence() from public;
    grant select on ai_content_bootstrap_state to ${schemaOwnerRole};
    grant select,insert,update on ai_content_write_fence_catalog to ${schemaOwnerRole};
    grant execute on function enforce_ai_content_write_fence() to ${schemaOwnerRole};
    grant execute on function assert_ai_content_writable() to ${applicationRole};
  `);
}

async function bootstrapPublishCalendarSchema(client: PoolClient) {
  await client.query(`
    create function set_updated_at() returns trigger language plpgsql as $$
    begin new.updated_at=now(); return new; end; $$;

    create table workspaces(id uuid primary key default gen_random_uuid());
    create table brands(
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references workspaces(id) on delete cascade
    );
    create table app_users(id uuid primary key default gen_random_uuid());
    create table ai_content_proposals(
      id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null
    );
    create table content_suggestions(id uuid primary key default gen_random_uuid());
    create table ai_content_generations(
      id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
      title text not null,output_format text not null,status text not null,
      created_at timestamptz not null default now()
    );
    create table ai_content_generation_outputs(
      id uuid primary key default gen_random_uuid(), generation_id uuid not null,
      workspace_id uuid not null, brand_id uuid not null,title text,status text not null,
      created_at timestamptz not null default now()
    );
    create table topic_publish_groups(
      id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null
    );
    create table brand_channels(
      id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
      channel text not null,enabled boolean not null,status text not null,deleted_at timestamptz null
    );
    create table ai_content_usage_ledger(
      generation_id uuid not null,workspace_id uuid not null,brand_id uuid not null,
      usage_type text not null,quantity integer not null,usage_date date not null
    );
    create table channel_outputs(
      id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
      ai_content_generation_output_id uuid null,content_topic_id uuid null
    );
    create table publish_queue(
      id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
      channel_output_id uuid null,topic_publish_group_id uuid null,status text not null,
      scheduled_for timestamptz null,queued_at timestamptz not null default now(),published_at timestamptz null
    );
  `);
}

it("runs new, replay, and batch calendar transactions with the production application role", async () => {
  let container: StartedPostgreSqlContainer | null = null;
  let administrator: Pool | null = null;
  let application: Pool | null = null;
  try {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    administrator = new Pool({ connectionString: container.getConnectionUri() });
    await administrator.query(`create role ${schemaOwnerRole} noinherit`);
    await administrator.query(
      `create role ${applicationRole} login noinherit nosuperuser nobypassrls
         nocreatedb nocreaterole noreplication password '${applicationPassword}'`,
    );
    await administrator.query(`grant usage,create on schema public to ${schemaOwnerRole}`);

    const owner = await administrator.connect();
    try {
      await bootstrapPublishCalendarControlPlane(owner);
      await owner.query(`set role ${schemaOwnerRole}`);
      await bootstrapPublishCalendarSchema(owner);
      const workspaceId = "10000000-0000-4000-8000-000000000084";
      const brandId = "20000000-0000-4000-8000-000000000084";
      await owner.query("insert into workspaces(id) values($1)", [workspaceId]);
      await owner.query("insert into brands(id,workspace_id) values($1,$2)", [brandId, workspaceId]);
      await owner.query(await readFile(
        resolve(process.cwd(), "../../db/migrations/079_publish_calendar_runtime.sql"),
        "utf8",
      ));
      await owner.query(await readFile(
        resolve(process.cwd(), "../../db/migrations/085_publish_calendar_idempotency_expand.sql"),
        "utf8",
      ));
      await owner.query(
        `insert into brand_channels(workspace_id,brand_id,channel,enabled,status)
         values($1,$2,'instagram',true,'connected')`,
        [workspaceId, brandId],
      );
      await owner.query(
        `insert into billing_plan_catalog(
           code,name,weekly_generation_limit,weekly_publish_limit,active
         ) values('pro','Pro',10,10,true)`,
      );
      await owner.query(
        `insert into brand_subscriptions(
           brand_id,plan_code,status,started_at,current_period_start,current_period_end
         ) values($1,'pro','active','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z','2100-01-01T00:00:00Z')`,
        [brandId],
      );
      await owner.query(
        `insert into ai_content_generations(
           id,workspace_id,brand_id,title,output_format,status
         ) values
           ('30000000-0000-4000-8000-000000000084',$1,$2,'단건 카드뉴스','card_news','draft'),
           ('30000000-0000-4000-8000-000000000085',$1,$2,'배치 카드뉴스','card_news','draft'),
           ('30000000-0000-4000-8000-000000000086',$1,$2,'배치 릴스','reel','draft'),
           ('30000000-0000-4000-8000-000000000087',$1,$2,'차단 검증','card_news','draft')`,
        [workspaceId, brandId],
      );
      await owner.query("reset role");
      await owner.query(
        `revoke all on table ai_content_write_fence_catalog from ${schemaOwnerRole}`,
      );
      await owner.query(
        `revoke all on function enforce_ai_content_write_fence() from ${schemaOwnerRole}`,
      );
      await owner.query(`grant usage on schema public to ${applicationRole}`);
      await owner.query(
        `grant select on brands,brand_channels,ai_content_usage_ledger,channel_outputs,
           publish_queue,topic_publish_groups to ${applicationRole}`,
      );
      await owner.query(
        `grant select,update on ai_content_generations,ai_content_generation_outputs
           to ${applicationRole}`,
      );
    } finally {
      await owner.query("reset role").catch(() => undefined);
      owner.release();
    }

    application = new Pool({
      connectionString: connectionStringForRole(
        container.getConnectionUri(),
        "publish_calendar_application",
        applicationPassword,
      ),
    });
    const workspaceId = "10000000-0000-4000-8000-000000000084";
    const brandId = "20000000-0000-4000-8000-000000000084";
    const repository = createPublishCalendarRepository(application);
    const singleInput = {
      workspaceId,
      brandId,
      scheduledFor: new Date("2099-08-21T02:30:00Z"),
      channel: "instagram" as const,
      contentFormat: "card_news" as const,
      idempotencyKey: "postgres-single",
      source: {
        kind: "existing_generation" as const,
        generationId: "30000000-0000-4000-8000-000000000084",
      },
    };

    const inserted = await repository.provisionManualSlot(singleInput);
    const replay = await repository.provisionManualSlot(singleInput);
    const batch = await repository.provisionManualSlotsBatch({
      workspaceId,
      brandId,
      idempotencyKey: "postgres-batch",
      rows: [
        {
          clientRowId: "row-1",
          scheduledFor: new Date("2099-08-21T03:00:00Z"),
          channel: "instagram",
          contentFormat: "card_news",
          source: {
            kind: "existing_generation",
            generationId: "30000000-0000-4000-8000-000000000085",
          },
        },
        {
          clientRowId: "row-2",
          scheduledFor: new Date("2099-08-21T03:30:00Z"),
          channel: "instagram",
          contentFormat: "reel",
          source: {
            kind: "existing_generation",
            generationId: "30000000-0000-4000-8000-000000000086",
          },
        },
      ],
    });

    expect(replay.id).toBe(inserted.id);
    expect(batch).toHaveLength(2);
    const stored = await application.query<{ count: number }>(
      "select count(*)::integer count from publish_calendar_slots where brand_id=$1",
      [brandId],
    );
    expect(stored.rows[0]?.count).toBe(3);
    const privileges = await application.query<{
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
      can_assert_writable: boolean;
      can_execute_trigger: boolean;
      can_read_maintenance: boolean;
      can_read_fence_catalog: boolean;
    }>(
      `select
         has_table_privilege(current_user,'public.publish_calendar_slots','SELECT') as can_select,
         has_table_privilege(current_user,'public.publish_calendar_slots','INSERT') as can_insert,
         has_table_privilege(current_user,'public.publish_calendar_slots','UPDATE') as can_update,
         has_table_privilege(current_user,'public.publish_calendar_slots','DELETE') as can_delete,
         has_function_privilege(current_user,'public.assert_ai_content_writable()','EXECUTE') as can_assert_writable,
         has_function_privilege(current_user,'public.enforce_ai_content_write_fence()','EXECUTE') as can_execute_trigger,
         has_table_privilege(current_user,'public.ai_content_maintenance_state','SELECT') as can_read_maintenance,
         has_table_privilege(current_user,'public.ai_content_write_fence_catalog','SELECT') as can_read_fence_catalog`,
    );
    expect(privileges.rows[0]).toEqual({
      can_select: true,
      can_insert: true,
      can_update: true,
      can_delete: false,
      can_assert_writable: true,
      can_execute_trigger: false,
      can_read_maintenance: false,
      can_read_fence_catalog: false,
    });
    await expect(application.query(
      "alter table publish_calendar_slots add column forbidden_column text",
    )).rejects.toThrow();
    await expect(application.query(
      "drop index publish_calendar_slots_brand_idempotency_unique",
    )).rejects.toThrow();

    await administrator.query("update ai_content_maintenance_state set enabled=true where singleton");
    await expect(repository.provisionManualSlot({
      ...singleInput,
      scheduledFor: new Date("2099-08-21T04:00:00Z"),
      idempotencyKey: "postgres-maintenance-block",
      source: {
        kind: "existing_generation",
        generationId: "30000000-0000-4000-8000-000000000087",
      },
    })).rejects.toThrow("ai_content_maintenance");
    await administrator.query("update ai_content_maintenance_state set enabled=false where singleton");
    const unchanged = await application.query<{ count: number }>(
      "select count(*)::integer count from publish_calendar_slots where brand_id=$1",
      [brandId],
    );
    expect(unchanged.rows[0]?.count).toBe(3);
  } finally {
    await Promise.allSettled([
      application?.end(),
      administrator?.end(),
    ]);
    if (container) await container.stop();
  }
}, 180_000);
