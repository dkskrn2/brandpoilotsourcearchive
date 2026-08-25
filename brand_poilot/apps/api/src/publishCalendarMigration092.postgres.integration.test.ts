import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool, type PoolClient } from "pg";
import { expect, it } from "vitest";

const applicationPassword = "publish-calendar-weekly-application-test";
const schemaOwnerRole = "publish_calendar_weekly_schema_owner";
const applicationRole = "publish_calendar_weekly_application";
const leakyRole = "publish_calendar_weekly_acl_leak";
const workspaceId = "10000000-0000-4000-8000-000000000091";
const brandId = "20000000-0000-4000-8000-000000000091";

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
      workspace_id uuid not null references workspaces(id) on delete cascade
    );
    create table app_users(id uuid primary key default gen_random_uuid());
    create table ai_content_proposals(
      id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null
    );
    create table content_suggestions(id uuid primary key default gen_random_uuid());
    create table ai_content_generations(
      id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null
    );
    create table ai_content_generation_outputs(
      id uuid primary key default gen_random_uuid(),generation_id uuid not null,
      workspace_id uuid not null,brand_id uuid not null
    );
    create table topic_publish_groups(
      id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null
    );
  `);
}

it("runs the exact weekly schedule replacement transaction as the application role", async () => {
  let container: StartedPostgreSqlContainer | null = null;
  let administrator: Pool | null = null;
  let application: Pool | null = null;
  try {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    administrator = new Pool({ connectionString: container.getConnectionUri() });
    await administrator.query(`create role ${schemaOwnerRole} noinherit`);
    await administrator.query(`create role ${leakyRole} noinherit`);
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
      await owner.query("insert into brands(id,workspace_id) values($1,$2)", [brandId, workspaceId]);
      for (const migration of [
        "079_publish_calendar_runtime.sql",
        "085_publish_calendar_idempotency_expand.sql",
        "086_publish_calendar_same_time_contract.sql",
      ]) {
        await owner.query(await readFile(resolve(process.cwd(), `../../db/migrations/${migration}`), "utf8"));
      }
      await owner.query(
        `alter default privileges in schema public grant select,update on tables to ${leakyRole}`,
      );
      await owner.query(await readFile(
        resolve(process.cwd(), "../../db/migrations/092_publish_calendar_weekly_schedule.sql"),
        "utf8",
      ));
      await owner.query(
        `alter default privileges in schema public revoke select,update on tables from ${leakyRole}`,
      );
      await owner.query(
        `insert into publish_calendar_weekly_schedule_entries(
           workspace_id,brand_id,day_of_week,slot_time,sort_order
         ) values($1,$2,1,'09:00',0)`,
        [workspaceId, brandId],
      );
      await owner.query(`revoke create on schema public from ${schemaOwnerRole}`);
      await owner.query(`grant usage on schema public to ${applicationRole}`);
      await owner.query(`grant select on brands to ${applicationRole}`);
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
          group by acl.grantee,grantee.rolname
          order by grantee_role_name collate "C"`,
      );
      expect(directAcl.rows).toEqual([{
        grantee_role_name: applicationRole,
        privileges: ["DELETE", "INSERT", "SELECT", "UPDATE"],
        grantable: false,
      }]);
      expect(directAcl.rows.some(({ grantee_role_name }) => (
        ["PUBLIC", leakyRole].includes(grantee_role_name)
      ))).toBe(false);

      const ownedSequences = await client.query<{ sequence_name: string }>(
        `select sequence.relname::text sequence_name
           from pg_class table_relation
           join pg_depend dependency on dependency.refobjid=table_relation.oid
           join pg_class sequence on sequence.oid=dependency.objid and sequence.relkind='S'
          where table_relation.oid='public.publish_calendar_weekly_schedule_entries'::regclass`,
      );
      expect(ownedSequences.rows).toEqual([]);

      await client.query("begin");
      try {
        const deleted = await client.query(
          "delete from publish_calendar_weekly_schedule_entries where workspace_id=$1 and brand_id=$2",
          [workspaceId, brandId],
        );
        expect(deleted.rowCount).toBe(1);
        await client.query(
          `insert into publish_calendar_weekly_schedule_entries(
             workspace_id,brand_id,day_of_week,slot_time,sort_order
           ) values($1,$2,1,'11:30',0),($1,$2,1,'11:30',1)`,
          [workspaceId, brandId],
        );
        const selected = await client.query<{ day_of_week: number; slot_time: string; sort_order: number }>(
          `select day_of_week,slot_time::text,sort_order
             from publish_calendar_weekly_schedule_entries
            where workspace_id=$1 and brand_id=$2 order by day_of_week,sort_order`,
          [workspaceId, brandId],
        );
        expect(selected.rows).toEqual([
          { day_of_week: 1, slot_time: "11:30:00", sort_order: 0 },
          { day_of_week: 1, slot_time: "11:30:00", sort_order: 1 },
        ]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }

      await administrator.query("update ai_content_maintenance_state set enabled=true where singleton");
      await expect(client.query(
        "delete from publish_calendar_weekly_schedule_entries where workspace_id=$1 and brand_id=$2",
        [workspaceId, brandId],
      )).rejects.toThrow("ai_content_maintenance");
      const unchanged = await client.query<{ count: number }>(
        "select count(*)::integer count from publish_calendar_weekly_schedule_entries where brand_id=$1",
        [brandId],
      );
      expect(unchanged.rows[0]?.count).toBe(2);
    } finally {
      client.release();
    }
  } finally {
    await Promise.allSettled([application?.end(), administrator?.end()]);
    if (container) await container.stop();
  }
}, 180_000);
