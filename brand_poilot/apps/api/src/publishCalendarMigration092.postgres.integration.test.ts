import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool, type PoolClient } from "pg";
import { expect, it } from "vitest";
import {
  createDatabasePublishCalendarAllocator,
  listEnabledAutomaticCalendarBrands,
} from "./publishCalendarAllocator.js";
import { createPublishCalendarRepository } from "./publishCalendarRepository.js";

const applicationPassword = "publish-calendar-weekly-application-test";
const schemaOwnerRole = "publish_calendar_weekly_schema_owner";
const applicationRole = "publish_calendar_weekly_application";
const leakyRole = "publish_calendar_weekly_acl_leak";
const quotedPublicRole = "PUBLIC";
const workspaceId = "10000000-0000-4000-8000-000000000091";
const brandId = "20000000-0000-4000-8000-000000000091";
const foreignBrandId = "20000000-0000-4000-8000-000000000092";
const categoryId = "30000000-0000-4000-8000-000000000091";
const informationalSubcategoryId = "40000000-0000-4000-8000-000000000091";
const trendSubcategoryId = "40000000-0000-4000-8000-000000000092";
const profileId = "50000000-0000-4000-8000-000000000091";
const suggestionBatchId = "60000000-0000-4000-8000-000000000091";
const informationalSuggestionId = "70000000-0000-4000-8000-000000000091";
const trendSuggestionId = "70000000-0000-4000-8000-000000000092";

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
      if exists(select 1 from public.ai_content_maintenance_state where singleton and enabled) then
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
       where catalog.relation_class='customer_execution' and catalog.relation_name=tg_table_name;
      if classifier<>'whole_relation' then raise exception 'publish_calendar_write_fence_fixture_invalid'; end if;
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
  `);
}

async function bootstrapCalendarDependencies(client: PoolClient) {
  await client.query(`
    create function set_updated_at() returns trigger language plpgsql as $$
    begin new.updated_at=now(); return new; end; $$;
    create table workspaces(id uuid primary key default gen_random_uuid());
    create table brands(
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references workspaces(id) on delete cascade,
      deleted_at timestamptz
    );
    create table brand_channels(
      id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
      channel text not null,enabled boolean not null,status text not null,deleted_at timestamptz
    );
    create table app_users(id uuid primary key default gen_random_uuid());
    create table ai_content_proposals(
      id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
      generation_id uuid,proposal_json jsonb not null default '{}'::jsonb
    );
    create table content_categories(id uuid primary key,active boolean not null);
    create table content_subcategories(
      id uuid primary key,category_id uuid not null,sort_order integer not null,active boolean not null
    );
    create table brand_profiles(
      id uuid primary key,workspace_id uuid not null,brand_id uuid not null,primary_category_id uuid not null
    );
    create table brand_profile_subcategories(
      brand_profile_id uuid not null,subcategory_id uuid not null
    );
    create table content_suggestion_batches(
      id uuid primary key,category_id uuid not null,generation_date date not null,published_at timestamptz not null
    );
    create table content_suggestions(
      id uuid primary key,batch_id uuid not null,category_id uuid not null,subcategory_id uuid not null,
      title text not null,intent text not null,position integer not null,created_at timestamptz not null
    );
    create table ai_content_generations(
      id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
      title text,output_format text,status text
    );
    create table ai_content_generation_outputs(
      id uuid primary key default gen_random_uuid(),generation_id uuid not null,
      workspace_id uuid not null,brand_id uuid not null,title text,status text
    );
    create table topic_publish_groups(
      id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null
    );
    create table channel_outputs(
      id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
      ai_content_generation_output_id uuid,content_topic_id uuid,delivery_format text
    );
    create table publish_queue(
      id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
      topic_publish_group_id uuid,channel_output_id uuid,channel text,status text not null,
      published_at timestamptz,scheduled_for timestamptz,queued_at timestamptz not null default now()
    );
  `);
}

it("runs the actual weekly settings repository transaction as the application role", async () => {
  let container: StartedPostgreSqlContainer | null = null;
  let administrator: Pool | null = null;
  let application: Pool | null = null;
  try {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    administrator = new Pool({ connectionString: container.getConnectionUri() });
    await administrator.query(`create role ${schemaOwnerRole} noinherit`);
    await administrator.query(`create role ${leakyRole} noinherit`);
    await administrator.query(`create role "${quotedPublicRole}" noinherit`);
    await administrator.query(
      `create role ${applicationRole} login noinherit nosuperuser nobypassrls
         nocreatedb nocreaterole noreplication password '${applicationPassword}'`,
    );
    await administrator.query(`grant usage,create on schema public to ${schemaOwnerRole}`);

    const owner = await administrator.connect();
    try {
      const providerIdentity = await owner.query<{ current_user: string; database_owner: string }>(
        `select current_user,database_owner.rolname::text database_owner
           from pg_database database
           join pg_roles database_owner on database_owner.oid=database.datdba
          where database.datname=current_database()`,
      );
      expect(providerIdentity.rows[0]?.current_user).toBeTruthy();
      expect(providerIdentity.rows[0]?.database_owner).toBe(providerIdentity.rows[0]?.current_user);
      await bootstrapControlPlane(owner);
      await bootstrapCalendarDependencies(owner);
      await owner.query("insert into workspaces(id) values($1)", [workspaceId]);
      await owner.query(
        "insert into brands(id,workspace_id) values($1,$2),($3,$2)",
        [brandId, workspaceId, foreignBrandId],
      );
      await owner.query(
        `insert into brand_channels(workspace_id,brand_id,channel,enabled,status)
         values($1,$2,'instagram',true,'connected')`,
        [workspaceId, brandId],
      );
      for (const migration of [
        "079_publish_calendar_runtime.sql",
        "085_publish_calendar_idempotency_expand.sql",
        "086_publish_calendar_same_time_contract.sql",
        "089_free_subscription_plan.sql",
        "090_existing_brand_free_subscriptions.sql",
      ]) {
        await owner.query(await readFile(resolve(process.cwd(), `../../db/migrations/${migration}`), "utf8"));
      }
      await owner.query(
        `alter default privileges in schema public grant select,update on tables to ${leakyRole}`,
      );
      await owner.query(
        `alter default privileges in schema public grant insert on tables to public`,
      );
      await owner.query(
        `alter default privileges in schema public grant delete on tables to "${quotedPublicRole}"`,
      );
      const defaultAclGrantees = await owner.query<{
        grantee_oid: string;
        grantee_role_name: string | null;
        privilege_type: string;
      }>(
        `select acl.grantee::text grantee_oid,grantee.rolname::text grantee_role_name,
                acl.privilege_type::text privilege_type
           from pg_default_acl defaults
           cross join lateral aclexplode(defaults.defaclacl) acl
           left join pg_roles grantee on grantee.oid=acl.grantee
          where defaults.defaclrole=(select oid from pg_roles where rolname=current_user)
            and defaults.defaclnamespace='public'::regnamespace
            and defaults.defaclobjtype='r'
            and (acl.grantee=0 or grantee.rolname=$1)
          order by acl.grantee,acl.privilege_type`,
        [quotedPublicRole],
      );
      expect(defaultAclGrantees.rows).toEqual([
        { grantee_oid: "0", grantee_role_name: null, privilege_type: "INSERT" },
        expect.objectContaining({
          grantee_role_name: quotedPublicRole,
          privilege_type: "DELETE",
        }),
      ]);
      expect(defaultAclGrantees.rows[1]?.grantee_oid).not.toBe("0");
      await owner.query(await readFile(
        resolve(process.cwd(), "../../db/migrations/092_publish_calendar_weekly_schedule.sql"),
        "utf8",
      ));
      await owner.query(
        `alter default privileges in schema public revoke select,update on tables from ${leakyRole}`,
      );
      await owner.query(
        `alter default privileges in schema public revoke insert on tables from public`,
      );
      await owner.query(
        `alter default privileges in schema public revoke delete on tables from "${quotedPublicRole}"`,
      );
      await owner.query(
        `insert into publish_calendar_weekly_schedule_entries(
           workspace_id,brand_id,day_of_week,slot_time,sort_order
         ) values($1,$2,1,'09:00',0)`,
        [workspaceId, brandId],
      );
      await owner.query(
        `insert into publish_calendar_weekly_schedule_entries(
           workspace_id,brand_id,day_of_week,slot_time,sort_order
         ) values($1,$2,3,'20:00',0)`,
        [workspaceId, foreignBrandId],
      );
      await owner.query(`revoke create on schema public from ${schemaOwnerRole}`);
      await owner.query(`grant usage on schema public to ${applicationRole}`);
      await owner.query(`grant select on
        brands,brand_channels,content_categories,content_subcategories,
        brand_profiles,brand_profile_subcategories,content_suggestion_batches,content_suggestions,
        ai_content_proposals,ai_content_generations,ai_content_generation_outputs,
        topic_publish_groups,channel_outputs,publish_queue
        to ${applicationRole}`);
      await owner.query(`grant execute on function assert_ai_content_writable() to ${applicationRole}`);
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
      const repository = createPublishCalendarRepository(application);
      const identity = await client.query<{
        current_user: string;
        table_owner: string;
        rolinherit: boolean;
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolreplication: boolean;
        can_select: boolean;
        can_insert: boolean;
        can_update: boolean;
        can_delete: boolean;
      }>(
        `select current_user,owner.rolname::text table_owner,
                role.rolinherit,role.rolsuper,role.rolbypassrls,role.rolcreatedb,
                role.rolcreaterole,role.rolreplication,
                has_table_privilege(current_user,relation.oid,'SELECT') can_select,
                has_table_privilege(current_user,relation.oid,'INSERT') can_insert,
                has_table_privilege(current_user,relation.oid,'UPDATE') can_update,
                has_table_privilege(current_user,relation.oid,'DELETE') can_delete
           from pg_roles role
           join pg_class relation on relation.oid='public.publish_calendar_weekly_schedule_entries'::regclass
           join pg_roles owner on owner.oid=relation.relowner
          where role.rolname=current_user`,
      );
      expect(identity.rows[0]).toEqual({
        current_user: applicationRole,
        table_owner: schemaOwnerRole,
        rolinherit: false,
        rolsuper: false,
        rolbypassrls: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        can_select: true,
        can_insert: true,
        can_update: true,
        can_delete: true,
      });
      const memberships = await client.query<{ granted_role: string }>(
        `select granted.rolname::text granted_role
           from pg_auth_members membership
           join pg_roles member on member.oid=membership.member
           join pg_roles granted on granted.oid=membership.roleid
          where member.rolname=current_user
          order by granted.rolname`,
      );
      expect(memberships.rows).toEqual([]);

      const directAcl = await client.query<{
        grantee_role_name: string;
        privileges: string[];
        grantable: boolean;
      }>(
        `select case acl.grantee when 0 then 'PUBLIC' else grantee.rolname::text end grantee_role_name,
                array_agg(acl.privilege_type::text order by acl.privilege_type)::text[] privileges,
                bool_or(acl.is_grantable) grantable
           from pg_class relation
           cross join lateral aclexplode(relation.relacl) acl
           left join pg_roles grantee on grantee.oid=acl.grantee
          where relation.oid='public.publish_calendar_weekly_schedule_entries'::regclass
            and acl.grantee<>relation.relowner
          group by acl.grantee,grantee.rolname
          order by (
            case acl.grantee when 0 then 'PUBLIC' else grantee.rolname::text end
          ) collate "C"`,
      );
      expect(directAcl.rows).toEqual([{
        grantee_role_name: applicationRole,
        privileges: ["DELETE", "INSERT", "SELECT", "UPDATE"],
        grantable: false,
      }]);
      expect(directAcl.rows.some(({ grantee_role_name }) => (
        [quotedPublicRole, leakyRole].includes(grantee_role_name)
      ))).toBe(false);

      const ownedSequences = await client.query<{ sequence_name: string }>(
        `select sequence.relname::text sequence_name
           from pg_class table_relation
           join pg_depend dependency on dependency.refobjid=table_relation.oid
           join pg_class sequence on sequence.oid=dependency.objid and sequence.relkind='S'
          where table_relation.oid='public.publish_calendar_weekly_schedule_entries'::regclass`,
      );
      expect(ownedSequences.rows).toEqual([]);

      const created = await repository.saveWeeklySettings({
        workspaceId,
        brandId,
        enabled: true,
        channels: ["instagram"],
        informationalFormat: "card_news",
        trendFormat: "reel",
        weeklySchedule: [
          { id: null, dayOfWeek: 1, time: "11:30", sortOrder: 0 },
          { id: null, dayOfWeek: 1, time: "11:30", sortOrder: 1 },
          { id: null, dayOfWeek: 7, time: "09:05", sortOrder: 0 },
        ],
      });
      expect(created.weeklySchedule).toHaveLength(3);
      expect(new Set(created.weeklySchedule.map(({ id }) => id)).size).toBe(3);
      const retainedId = created.weeklySchedule[1]!.id;

      await expect(listEnabledAutomaticCalendarBrands(application, new Date()))
        .resolves.toEqual([{
          workspaceId,
          brandId,
          settings: created,
        }]);

      const updated = await repository.saveWeeklyConfiguration({
        workspaceId,
        brandId,
        channels: ["instagram"],
        informationalFormat: "reel",
        trendFormat: "card_news",
        weeklySchedule: [
          { id: null, dayOfWeek: 1, time: "11:30", sortOrder: 1 },
          { id: retainedId, dayOfWeek: 1, time: "11:30", sortOrder: 0 },
        ],
      });
      const newId = updated.weeklySchedule.find(({ id }) => id !== retainedId)!.id;
      const expectedSchedule = [
        { id: retainedId, dayOfWeek: 1 as const, time: "11:30", sortOrder: 0 },
        { id: newId, dayOfWeek: 1 as const, time: "11:30", sortOrder: 1 },
      ];
      expect(updated.weeklySchedule).toEqual(expectedSchedule);

      const rawConfigurationBeforeToggle = await client.query<{
        channels: string[];
        informational_format: string;
        trend_format: string;
      }>(
        `select channels,informational_format,trend_format
           from publish_calendar_settings where workspace_id=$1 and brand_id=$2`,
        [workspaceId, brandId],
      );
      const rawScheduleBeforeToggle = await client.query<{
        id: string;
        created_at: string;
        updated_at: string;
      }>(
        `select id,created_at::text,updated_at::text
           from publish_calendar_weekly_schedule_entries
          where workspace_id=$1 and brand_id=$2 order by id`,
        [workspaceId, brandId],
      );
      await expect(repository.setWeeklyEnabled({ workspaceId, brandId, enabled: false }))
        .resolves.toMatchObject({ enabled: false, weeklySchedule: expectedSchedule });
      const rawConfigurationAfterToggle = await client.query<{
        channels: string[];
        informational_format: string;
        trend_format: string;
      }>(
        `select channels,informational_format,trend_format
           from publish_calendar_settings where workspace_id=$1 and brand_id=$2`,
        [workspaceId, brandId],
      );
      const rawScheduleAfterToggle = await client.query<{
        id: string;
        created_at: string;
        updated_at: string;
      }>(
        `select id,created_at::text,updated_at::text
           from publish_calendar_weekly_schedule_entries
          where workspace_id=$1 and brand_id=$2 order by id`,
        [workspaceId, brandId],
      );
      expect(rawConfigurationAfterToggle.rows).toEqual(rawConfigurationBeforeToggle.rows);
      expect(rawScheduleAfterToggle.rows).toEqual(rawScheduleBeforeToggle.rows);

      await repository.setWeeklyEnabled({ workspaceId, brandId, enabled: true });
      await Promise.all([
        repository.setWeeklyEnabled({ workspaceId, brandId, enabled: false }),
        repository.saveWeeklyConfiguration({
          workspaceId,
          brandId,
          channels: ["instagram"],
          informationalFormat: "reel",
          trendFormat: "card_news",
          weeklySchedule: expectedSchedule,
        }),
      ]);

      const read = await repository.getWeeklySettings({ workspaceId, brandId });
      expect(read).toEqual({
        brandId,
        enabled: false,
        channels: ["instagram"],
        informationalFormat: "reel",
        trendFormat: "card_news",
        weeklySchedule: expectedSchedule,
        updatedAt: expect.any(String),
      });

      const foreign = await administrator.query<{ id: string }>(
        `select id from publish_calendar_weekly_schedule_entries
          where workspace_id=$1 and brand_id=$2`,
        [workspaceId, foreignBrandId],
      );
      await expect(repository.saveWeeklySettings({
        workspaceId,
        brandId,
        enabled: false,
        channels: ["instagram"],
        informationalFormat: "card_news",
        trendFormat: "reel",
        weeklySchedule: [
          { id: retainedId, dayOfWeek: 2, time: "12:30", sortOrder: 0 },
          { id: foreign.rows[0]!.id, dayOfWeek: 2, time: "12:30", sortOrder: 1 },
        ],
      })).rejects.toThrow("publish_calendar_weekly_schedule_id_invalid");
      await expect(repository.getWeeklySettings({ workspaceId, brandId })).resolves.toEqual(read);

      const allocationNow = new Date();
      const occurrence = new Date(allocationNow.getTime() + 2 * 60 * 60 * 1_000);
      const occurrenceKst = new Date(occurrence.getTime() + 9 * 60 * 60 * 1_000);
      const occurrenceDayOfWeek = (occurrenceKst.getUTCDay() || 7) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
      const occurrenceTime = `${String(occurrenceKst.getUTCHours()).padStart(2, "0")}:${String(
        occurrenceKst.getUTCMinutes(),
      ).padStart(2, "0")}`;
      const allocatorSettings = await repository.saveWeeklySettings({
        workspaceId,
        brandId,
        enabled: true,
        channels: ["instagram"],
        informationalFormat: "card_news",
        trendFormat: "reel",
        weeklySchedule: [
          { id: null, dayOfWeek: occurrenceDayOfWeek, time: occurrenceTime, sortOrder: 0 },
          { id: null, dayOfWeek: occurrenceDayOfWeek, time: occurrenceTime, sortOrder: 1 },
          { id: null, dayOfWeek: occurrenceDayOfWeek, time: occurrenceTime, sortOrder: 2 },
        ],
      });
      expect(new Set(allocatorSettings.weeklySchedule.map(({ id }) => id)).size).toBe(3);

      await administrator.query(
        `insert into content_categories(id,active) values($1,true)`,
        [categoryId],
      );
      await administrator.query(
        `insert into content_subcategories(id,category_id,sort_order,active)
         values($1,$3,0,true),($2,$3,1,true)`,
        [informationalSubcategoryId, trendSubcategoryId, categoryId],
      );
      await administrator.query(
        `insert into brand_profiles(id,workspace_id,brand_id,primary_category_id)
         values($1,$2,$3,$4)`,
        [profileId, workspaceId, brandId, categoryId],
      );
      await administrator.query(
        `insert into brand_profile_subcategories(brand_profile_id,subcategory_id)
         values($1,$2),($1,$3)`,
        [profileId, informationalSubcategoryId, trendSubcategoryId],
      );
      await administrator.query(
        `insert into content_suggestion_batches(id,category_id,generation_date,published_at)
         values($1,$2,$3::timestamptz at time zone 'Asia/Seoul',$3)`,
        [suggestionBatchId, categoryId, occurrence],
      );
      await administrator.query(
        `insert into content_suggestions(
           id,batch_id,category_id,subcategory_id,title,intent,position,created_at
         ) values
           ($1,$3,$4,$5,'automatic informational','informational',0,$7),
           ($2,$3,$4,$6,'automatic trend','trend',1,$7)`,
        [informationalSuggestionId, trendSuggestionId, suggestionBatchId, categoryId,
          informationalSubcategoryId, trendSubcategoryId, occurrence],
      );
      await administrator.query(
        `update billing_plan_catalog set weekly_publish_limit=3 where code='free'`,
      );
      await administrator.query(
        `insert into publish_calendar_slots(
           workspace_id,brand_id,scheduled_for,assignment_mode,status,
           recommendation_kind,content_format,channels
         ) values($1,$2,$3,'manual','generation_pending',null,'card_news',array['instagram'])`,
        [workspaceId, brandId, occurrence],
      );

      const allocator = createDatabasePublishCalendarAllocator(application, repository);
      await expect(allocator.allocateAll(allocationNow)).resolves.toEqual({
        brandsSelected: 1,
        openSlotsCreated: 2,
        proposalsAssigned: 2,
        quotaBlocked: 1,
        brandsFailed: 0,
      });
      const allocatedSlots = await client.query<{
        assignment_mode: string;
        status: string;
        channels: string[];
        content_suggestion_id: string | null;
        scheduled_for: string;
        idempotency_key: string | null;
      }>(
        `select assignment_mode,status,channels,content_suggestion_id,
                scheduled_for::text,idempotency_key
           from publish_calendar_slots
          where workspace_id=$1 and brand_id=$2
          order by assignment_mode,idempotency_key nulls first`,
        [workspaceId, brandId],
      );
      const automaticSlots = allocatedSlots.rows.filter(({ assignment_mode }) => assignment_mode === "automatic");
      expect(automaticSlots).toHaveLength(2);
      expect(automaticSlots.every(({ status }) => status === "proposal_assigned")).toBe(true);
      expect(automaticSlots.map(({ channels }) => channels)).toEqual([["instagram"], ["instagram"]]);
      expect(new Set(automaticSlots.map(({ scheduled_for }) => scheduled_for)).size).toBe(1);
      expect(new Set(automaticSlots.map(({ idempotency_key }) => idempotency_key)).size).toBe(2);
      expect(new Set(automaticSlots.map(({ content_suggestion_id }) => content_suggestion_id))).toEqual(
        new Set([informationalSuggestionId, trendSuggestionId]),
      );
      expect(allocatedSlots.rows.filter(({ assignment_mode }) => assignment_mode === "manual")).toHaveLength(1);

      await expect(allocator.allocateAll(allocationNow)).resolves.toEqual({
        brandsSelected: 1,
        openSlotsCreated: 0,
        proposalsAssigned: 0,
        quotaBlocked: 1,
        brandsFailed: 0,
      });
      await expect(client.query<{ count: number }>(
        `select count(*)::integer count from publish_calendar_slots
          where workspace_id=$1 and brand_id=$2`,
        [workspaceId, brandId],
      )).resolves.toMatchObject({ rows: [{ count: 3 }] });

      await administrator.query("update ai_content_maintenance_state set enabled=true where singleton");
      await expect(repository.saveWeeklySettings({
        workspaceId,
        brandId,
        enabled: false,
        channels: ["instagram"],
        informationalFormat: "card_news",
        trendFormat: "reel",
        weeklySchedule: expectedSchedule,
      })).rejects.toThrow("ai_content_maintenance");
      await expect(repository.getWeeklySettings({ workspaceId, brandId })).resolves.toEqual(allocatorSettings);
    } finally {
      client.release();
    }
  } finally {
    await Promise.allSettled([application?.end(), administrator?.end()]);
    if (container) await container.stop();
  }
}, 180_000);
