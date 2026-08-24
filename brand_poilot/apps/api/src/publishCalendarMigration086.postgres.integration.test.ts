import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool, type PoolClient } from "pg";
import { expect, it } from "vitest";
import { manualSlotIdentity } from "./publishCalendarIdempotency.js";
import { createPublishCalendarRepository } from "./publishCalendarRepository.js";
import { createPublishItemsRepository } from "./publishItemsRepository.js";

const applicationPassword = "publish-calendar-086-application-test";
const schemaOwnerRole = "publish_calendar_086_schema_owner";
const applicationRole = "publish_calendar_086_application";

function connectionStringForRole(connectionString: string, roleName: string, password: string) {
  const value = new URL(connectionString);
  value.username = roleName;
  value.password = password;
  return value.toString();
}

async function bootstrapControlPlane(client: PoolClient) {
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

async function bootstrapSchema(client: PoolClient) {
  await client.query(`
    create function set_updated_at() returns trigger language plpgsql as $$
    begin new.updated_at=now(); return new; end; $$;

    create table workspaces(id uuid primary key default gen_random_uuid());
    create table brands(
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references workspaces(id) on delete cascade,
      name text not null default 'OTHER',
      status text not null default 'active',
      deleted_at timestamptz
    );
    create table app_users(id uuid primary key default gen_random_uuid());
    create table ai_content_proposals(
      id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null
    );
    create table content_suggestions(id uuid primary key default gen_random_uuid());
    create table ai_content_generations(
      id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
      title text not null,output_format text not null,status text not null,
      draft_json jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
    create table ai_content_generation_outputs(
      id uuid primary key default gen_random_uuid(),generation_id uuid not null,
      workspace_id uuid not null,brand_id uuid not null,title text,status text not null,
      output_index integer not null default 1,
      created_at timestamptz not null default now()
    );
    create table source_urls(
      id uuid primary key,workspace_id uuid not null,brand_id uuid not null,url text not null
    );
    create table source_content_items(
      id uuid primary key,workspace_id uuid not null,brand_id uuid not null,
      content_url text not null,deleted_at timestamptz
    );
    create table source_snapshots(
      id uuid primary key,workspace_id uuid not null,brand_id uuid not null,
      source_url_id uuid not null,source_content_item_id uuid
    );
    create table topic_rows(
      id uuid primary key,workspace_id uuid not null,brand_id uuid not null,
      topic_title text,topic_angle text,reference_url text
    );
    create table content_topics(
      id uuid primary key,workspace_id uuid not null,brand_id uuid not null,topic_row_id uuid,
      title text not null,angle text not null,status text not null,
      source_context jsonb not null default '{}'::jsonb,selected_instagram_format text,
      created_at timestamptz not null default now()
    );
    create table topic_publish_groups(
      id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
      content_topic_id uuid not null unique,status text not null,created_at timestamptz not null default now()
    );
    create table storage_artifacts(
      id uuid primary key,workspace_id uuid not null,brand_id uuid not null,public_url text
    );
    create table channel_outputs(
      id uuid primary key,workspace_id uuid not null,brand_id uuid not null,content_topic_id uuid,
      master_draft_id uuid,ai_content_generation_output_id uuid,channel text not null default 'instagram',
      delivery_format text,status text not null default 'approved',title text not null,preview_title text,
      preview_body text,output_json jsonb not null default '{}'::jsonb,source_summary text,
      block_reasons jsonb not null default '[]'::jsonb,rendered_artifact_id uuid,
      generated_at timestamptz not null default now(),created_at timestamptz not null default now()
    );
    create table publish_queue(
      id uuid primary key,workspace_id uuid not null,brand_id uuid not null,channel_output_id uuid,
      topic_publish_group_id uuid,channel text not null,status text not null,scheduled_for timestamptz,
      deferred_until timestamptz,published_at timestamptz,failed_at timestamptz,last_error text,
      queued_at timestamptz not null default now(),created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),slot_date date,slot_number integer
    );
    create table publish_attempts(
      id uuid primary key,workspace_id uuid not null,brand_id uuid not null,publish_queue_id uuid not null,
      external_post_id text,external_url text,finished_at timestamptz,created_at timestamptz not null default now()
    );
    create table brand_channels(
      id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
      channel text not null,enabled boolean not null,status text not null,deleted_at timestamptz
    );
    create table ai_content_usage_ledger(
      generation_id uuid not null,workspace_id uuid not null,brand_id uuid not null,
      usage_type text not null,quantity integer not null,usage_date date not null
    );
  `);
}

async function applyMigration(client: PoolClient, name: string) {
  await client.query(await readFile(resolve(process.cwd(), `../../db/migrations/${name}`), "utf8"));
}

it("enforces migration 086 writes through a PostgreSQL 16 application role", async () => {
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
    const workspaceId = "10000000-0000-4000-8000-000000000086";
    const brandId = "20000000-0000-4000-8000-000000000086";
    const growthlineBrandId = "20000000-0000-4000-8000-000000000089";
    const sharedGenerationId = "30000000-0000-4000-8000-000000000086";
    const firstGenerationId = "30000000-0000-4000-8000-000000000087";
    const secondGenerationId = "30000000-0000-4000-8000-000000000088";
    const repositorySingleGenerationId = "30000000-0000-4000-8000-000000000089";
    const repositoryBatchFirstGenerationId = "30000000-0000-4000-8000-000000000090";
    const repositoryBatchSecondGenerationId = "30000000-0000-4000-8000-000000000091";
    const firstOutputId = "40000000-0000-4000-8000-000000000086";
    const secondOutputId = "40000000-0000-4000-8000-000000000087";
    const sameTimeAKey = manualSlotIdentity("same-time-a", {
      kind: "existing_generation",
      generationId: firstGenerationId,
    }).key;
    const sameTimeBKey = manualSlotIdentity("same-time-b", {
      kind: "existing_generation",
      generationId: secondGenerationId,
    }).key;
    const outputAKey = manualSlotIdentity("output-a", {
      kind: "existing_output",
      generationOutputId: firstOutputId,
    }).key;
    const outputBKey = manualSlotIdentity("output-b", {
      kind: "existing_output",
      generationOutputId: secondOutputId,
    }).key;
    const duplicateOutputKey = manualSlotIdentity("duplicate-output", {
      kind: "existing_output",
      generationOutputId: firstOutputId,
    }).key;
    for (const key of [sameTimeAKey, sameTimeBKey, outputAKey, outputBKey, duplicateOutputKey]) {
      expect(key).toMatch(/^manual:v2:[0-9a-f]{64}:[0-9a-f]{64}$/);
      expect(key).toHaveLength(139);
    }
    try {
      await bootstrapControlPlane(owner);
      await owner.query(`set role ${schemaOwnerRole}`);
      await bootstrapSchema(owner);
      await owner.query("insert into workspaces(id) values($1)", [workspaceId]);
      await owner.query("insert into brands(id,workspace_id) values($1,$2)", [brandId, workspaceId]);
      await owner.query(
        "insert into brands(id,workspace_id,name) values($1,$2,'GROWTHLINE')",
        [growthlineBrandId, workspaceId],
      );
      await applyMigration(owner, "079_publish_calendar_runtime.sql");
      await applyMigration(owner, "085_publish_calendar_idempotency_expand.sql");
      await applyMigration(owner, "086_publish_calendar_same_time_contract.sql");
      await applyMigration(owner, "089_free_subscription_plan.sql");
      await owner.query(
        `insert into ai_content_generations(id,workspace_id,brand_id,title,output_format,status)
         values
           ($1,$4,$5,'동시 예약 1','card_news','draft'),
           ($2,$4,$5,'동시 예약 2','reel','draft'),
           ($3,$4,$5,'다중 결과 생성','card_news','completed'),
           ($6,$4,$5,'Repository 단건','card_news','draft'),
           ($7,$4,$5,'Repository 일괄 카드뉴스','card_news','draft'),
           ($8,$4,$5,'Repository 일괄 릴스','reel','draft')`,
        [firstGenerationId, secondGenerationId, sharedGenerationId, workspaceId, brandId,
          repositorySingleGenerationId, repositoryBatchFirstGenerationId,
          repositoryBatchSecondGenerationId],
      );
      await owner.query(
        `insert into ai_content_generation_outputs(
           id,generation_id,workspace_id,brand_id,title,status
         ) values
           ($1,$3,$4,$5,'완료 결과 1','completed'),
           ($2,$3,$4,$5,'완료 결과 2','completed')`,
        [firstOutputId, secondOutputId, sharedGenerationId, workspaceId, brandId],
      );
      await owner.query(
        `insert into brand_channels(workspace_id,brand_id,channel,enabled,status)
         values($1,$2,'instagram',true,'connected')`,
        [workspaceId, brandId],
      );
      await owner.query(
        `insert into billing_plan_catalog(
           code,name,weekly_generation_limit,weekly_publish_limit,active
         ) values('pro','Pro',20,20,true)`,
      );
      await owner.query(
        `insert into brand_subscriptions(
           brand_id,plan_code,status,started_at,current_period_start,current_period_end
         ) values($1,'pro','active','2026-08-01T00:00:00Z',
           '2026-08-01T00:00:00Z','2100-01-01T00:00:00Z')`,
        [brandId],
      );
      await owner.query("reset role");
      await owner.query(`grant usage on schema public to ${applicationRole}`);
      await owner.query(
        `grant select on
           brands,source_urls,source_content_items,source_snapshots,topic_rows,content_topics,topic_publish_groups,
           storage_artifacts,channel_outputs,publish_queue,publish_attempts,brand_channels,
           ai_content_usage_ledger
         to ${applicationRole}`,
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
        applicationRole,
        applicationPassword,
      ),
    });
    const client = await application.connect();
    try {
      const role = await client.query<{
        current_user: string;
        rolinherit: boolean;
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolreplication: boolean;
        rolcanlogin: boolean;
      }>(
        `select current_user,rolinherit,rolsuper,rolbypassrls,rolcreatedb,
                rolcreaterole,rolreplication,rolcanlogin
           from pg_roles where rolname=current_user`,
      );
      expect(role.rows[0]).toEqual({
        current_user: applicationRole,
        rolinherit: false,
        rolsuper: false,
        rolbypassrls: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolcanlogin: true,
      });

      const scheduledFor = "2099-08-23T02:30:00.000Z";
      const provisionGrowthlineSubscription = await readFile(
        resolve(process.cwd(), "../../scripts/provision-growthline-free-subscription.sql"),
        "utf8",
      );
      await client.query(provisionGrowthlineSubscription);
      const growthlineSubscription = await client.query<{
        plan_code: string;
        status: string;
        weekly_generation_limit: number;
        weekly_publish_limit: number;
        one_month_period: boolean;
      }>(
        `select subscription.plan_code,subscription.status,
                plan.weekly_generation_limit,plan.weekly_publish_limit,
                subscription.current_period_end = subscription.current_period_start + interval '1 month'
                  as one_month_period
           from brand_subscriptions subscription
           join billing_plan_catalog plan on plan.code=subscription.plan_code
          where subscription.brand_id=$1::uuid`,
        [growthlineBrandId],
      );
      expect(growthlineSubscription.rows).toEqual([{
        plan_code: "free",
        status: "active",
        weekly_generation_limit: 30,
        weekly_publish_limit: 30,
        one_month_period: true,
      }]);
      await expect(client.query(provisionGrowthlineSubscription)).rejects.toThrow(
        "growthline_subscription_already_exists",
      );
      await client.query("rollback");
      const growthlineCount = await client.query<{ count: number }>(
        "select count(*)::integer count from brand_subscriptions where brand_id=$1::uuid",
        [growthlineBrandId],
      );
      expect(growthlineCount.rows[0]?.count).toBe(1);

      await client.query("begin");
      try {
        const sameTime = await client.query<{ id: string; idempotency_key: string }>(
          `insert into publish_calendar_slots(
             id,workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,
             channels,generation_id,idempotency_key,title
           ) values
             ('50000000-0000-4000-8000-000000000086',$1,$2,$3,'manual','generation_pending',
               'card_news',array['instagram'],$4,$6,'동시 예약 1'),
             ('50000000-0000-4000-8000-000000000087',$1,$2,$3,'manual','generation_pending',
               'reel',array['instagram'],$5,$7,'동시 예약 2')
           returning id,idempotency_key`,
          [
            workspaceId,
            brandId,
            scheduledFor,
            firstGenerationId,
            secondGenerationId,
            sameTimeAKey,
            sameTimeBKey,
          ],
        );
        expect(sameTime.rows).toEqual([
          {
            id: "50000000-0000-4000-8000-000000000086",
            idempotency_key: sameTimeAKey,
          },
          {
            id: "50000000-0000-4000-8000-000000000087",
            idempotency_key: sameTimeBKey,
          },
        ]);

        const distinctOutputs = await client.query<{ generation_output_id: string }>(
          `insert into publish_calendar_slots(
             id,workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,
             channels,generation_id,generation_output_id,idempotency_key,title
           ) values
             ('50000000-0000-4000-8000-000000000088',$1,$2,$3,'manual','generation_pending',
               'card_news',array['instagram'],$4,$5,$7,'완료 결과 1'),
             ('50000000-0000-4000-8000-000000000089',$1,$2,$3,'manual','generation_pending',
               'card_news',array['instagram'],$4,$6,$8,'완료 결과 2')
           returning generation_output_id`,
          [
            workspaceId,
            brandId,
            scheduledFor,
            sharedGenerationId,
            firstOutputId,
            secondOutputId,
            outputAKey,
            outputBKey,
          ],
        );
        expect(distinctOutputs.rows.map(({ generation_output_id }) => generation_output_id)).toEqual([
          firstOutputId,
          secondOutputId,
        ]);

        const replay = await client.query<{ id: string }>(
          `select id from publish_calendar_slots
            where workspace_id=$1 and brand_id=$2 and idempotency_key=$3
            for update`,
          [workspaceId, brandId, sameTimeAKey],
        );
        expect(replay.rows).toEqual([{ id: "50000000-0000-4000-8000-000000000086" }]);

        await client.query(
          "update publish_calendar_slots set title='수정된 동시 예약' where id='50000000-0000-4000-8000-000000000086'",
        );
        await client.query(
          "update publish_calendar_slots set status='cancelled' where id='50000000-0000-4000-8000-000000000087'",
        );

        await client.query("savepoint duplicate_output");
        let duplicateError: { code?: string; constraint?: string } | null = null;
        try {
          await client.query(
            `insert into publish_calendar_slots(
               id,workspace_id,brand_id,scheduled_for,assignment_mode,status,content_format,
               channels,generation_id,generation_output_id,idempotency_key,title
             ) values(
               '50000000-0000-4000-8000-000000000090',$1,$2,$3,'manual','generation_pending',
               'card_news',array['instagram'],$4,$5,$6,'중복 결과'
             )`,
            [
              workspaceId,
              brandId,
              scheduledFor,
              sharedGenerationId,
              firstOutputId,
              duplicateOutputKey,
            ],
          );
        } catch (error) {
          duplicateError = error as { code?: string; constraint?: string };
        }
        expect(duplicateError).toMatchObject({
          code: "23505",
          constraint: "publish_calendar_slots_generation_output_unique",
        });
        await client.query("rollback to savepoint duplicate_output");
        await client.query("release savepoint duplicate_output");
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }

      const stored = await client.query<{
        count: number;
        updated_count: number;
        cancelled_count: number;
      }>(
        `select count(*)::integer count,
                count(*) filter(where title='수정된 동시 예약')::integer updated_count,
                count(*) filter(where status='cancelled')::integer cancelled_count
           from publish_calendar_slots where brand_id=$1`,
        [brandId],
      );
      expect(stored.rows[0]).toEqual({ count: 4, updated_count: 1, cancelled_count: 1 });

      const calendarRepository = createPublishCalendarRepository(application);
      const singleInput = {
        workspaceId,
        brandId,
        scheduledFor: new Date("2099-08-24T02:30:00.000Z"),
        channel: "instagram" as const,
        contentFormat: "card_news" as const,
        idempotencyKey: "repository-single",
        source: {
          kind: "existing_generation" as const,
          generationId: repositorySingleGenerationId,
        },
      };
      const repositorySingle = await calendarRepository.provisionManualSlot(singleInput);
      const repositorySingleReplay = await calendarRepository.provisionManualSlot(singleInput);
      expect(repositorySingleReplay).toEqual(repositorySingle);
      expect(repositorySingle.idempotencyKey).toBe(
        manualSlotIdentity(singleInput.idempotencyKey, singleInput.source).key,
      );

      const repositoryBatchInput = {
        workspaceId,
        brandId,
        idempotencyKey: "repository-batch",
        rows: [
          {
            clientRowId: "same-time-card-news",
            scheduledFor: new Date("2099-08-24T03:30:00.000Z"),
            channel: "instagram" as const,
            contentFormat: "card_news" as const,
            source: {
              kind: "existing_generation" as const,
              generationId: repositoryBatchFirstGenerationId,
            },
          },
          {
            clientRowId: "same-time-reel",
            scheduledFor: new Date("2099-08-24T03:30:00.000Z"),
            channel: "instagram" as const,
            contentFormat: "reel" as const,
            source: {
              kind: "existing_generation" as const,
              generationId: repositoryBatchSecondGenerationId,
            },
          },
        ],
      };
      const repositoryBatch = await calendarRepository.provisionManualSlotsBatch(repositoryBatchInput);
      const repositoryBatchReplay = await calendarRepository.provisionManualSlotsBatch(repositoryBatchInput);
      expect(repositoryBatchReplay).toEqual(repositoryBatch);
      expect(repositoryBatch).toHaveLength(2);
      expect(new Set(repositoryBatch.map(({ scheduledFor: value }) => value))).toEqual(
        new Set(["2099-08-24T03:30:00.000Z"]),
      );
      expect(new Set(repositoryBatch.map(({ idempotencyKey }) => idempotencyKey)).size).toBe(2);

      const rescheduleTarget = repositoryBatch[0];
      await client.query(
        `update publish_calendar_slots
            set assignment_mode='automatic',recommendation_kind='informational'
          where id=$1::uuid`,
        [rescheduleTarget.id],
      );
      const rescheduled = await calendarRepository.rescheduleSlot({
        workspaceId,
        brandId,
        slotId: rescheduleTarget.id,
        scheduledFor: new Date("2099-08-24T04:15:00.000Z"),
      });
      expect(rescheduled).toMatchObject({
        id: rescheduleTarget.id,
        assignmentMode: "manual",
        recommendationKind: null,
        scheduledFor: "2099-08-24T04:15:00.000Z",
      });

      const cancelled = await calendarRepository.cancelSlot({
        workspaceId,
        brandId,
        slotId: repositorySingle.id,
      });
      const cancelledReplay = await calendarRepository.cancelSlot({
        workspaceId,
        brandId,
        slotId: repositorySingle.id,
      });
      expect(cancelled).toMatchObject({ id: repositorySingle.id, status: "cancelled" });
      expect(cancelledReplay).toEqual(cancelled);

      const publishItemsRepository = createPublishItemsRepository(application);
      const canonicalItems = await publishItemsRepository.listPublishItems({ workspaceId, brandId });
      expect(canonicalItems.every((item) => (
        item.workspaceId === workspaceId && item.brandId === brandId
      ))).toBe(true);
      expect(canonicalItems.find(({ itemKey }) => (
        itemKey === `generation:${repositorySingleGenerationId}`
      ))).toMatchObject({
        status: "cancelled",
        calendarPlacement: "hidden",
        scheduledFor: "2099-08-24T02:30:00.000Z",
      });
      for (const generationId of [
        repositoryBatchFirstGenerationId,
        repositoryBatchSecondGenerationId,
      ]) {
        expect(canonicalItems.find(({ itemKey }) => itemKey === `generation:${generationId}`)).toMatchObject({
          status: "reserved",
          calendarPlacement: "dated",
          scheduledFor: generationId === repositoryBatchFirstGenerationId
            ? "2099-08-24T04:15:00.000Z"
            : "2099-08-24T03:30:00.000Z",
        });
      }

      const repositoryRows = await client.query<{ count: number }>(
        `select count(*)::integer count from publish_calendar_slots
          where generation_id=any($1::uuid[])`,
        [[repositorySingleGenerationId, repositoryBatchFirstGenerationId,
          repositoryBatchSecondGenerationId]],
      );
      expect(repositoryRows.rows[0]?.count).toBe(3);

      const privileges = await client.query<{
        can_select: boolean;
        can_insert: boolean;
        can_update: boolean;
        can_delete: boolean;
        can_create_schema_objects: boolean;
        can_read_generations: boolean;
        can_lock_generations: boolean;
        can_read_outputs: boolean;
        can_run_brand_scope: boolean;
        can_run_slot_scope: boolean;
      }>(
        `select
           has_table_privilege(current_user,'public.publish_calendar_slots','SELECT') can_select,
           has_table_privilege(current_user,'public.publish_calendar_slots','INSERT') can_insert,
           has_table_privilege(current_user,'public.publish_calendar_slots','UPDATE') can_update,
           has_table_privilege(current_user,'public.publish_calendar_slots','DELETE') can_delete,
           has_schema_privilege(current_user,'public','CREATE') can_create_schema_objects,
           has_table_privilege(current_user,'public.ai_content_generations','SELECT') can_read_generations,
           has_table_privilege(current_user,'public.ai_content_generations','UPDATE') can_lock_generations,
           has_table_privilege(current_user,'public.ai_content_generation_outputs','SELECT') can_read_outputs,
           has_function_privilege(
             current_user,'public.enforce_publish_calendar_brand_scope()','EXECUTE'
           ) can_run_brand_scope,
           has_function_privilege(
             current_user,'public.enforce_publish_calendar_slot_scope()','EXECUTE'
           ) can_run_slot_scope`,
      );
      expect(privileges.rows[0]).toEqual({
        can_select: true,
        can_insert: true,
        can_update: true,
        can_delete: false,
        can_create_schema_objects: false,
        can_read_generations: true,
        can_lock_generations: true,
        can_read_outputs: true,
        can_run_brand_scope: true,
        can_run_slot_scope: true,
      });

      await expect(client.query(
        "alter table publish_calendar_slots add column forbidden_column text",
      )).rejects.toMatchObject({ code: "42501" });
      await expect(client.query(
        "drop index publish_calendar_slots_brand_idempotency_unique",
      )).rejects.toMatchObject({ code: "42501" });
    } finally {
      client.release();
    }
  } finally {
    await Promise.allSettled([application?.end(), administrator?.end()]);
    if (container) await container.stop();
  }
}, 180_000);
