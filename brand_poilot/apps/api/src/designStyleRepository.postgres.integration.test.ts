import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDesignStyleRepository } from "./designStyleRepository.js";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  brand: "20000000-0000-4000-8000-000000000002",
  reference: "30000000-0000-4000-8000-000000000003",
  artifact: "40000000-0000-4000-8000-000000000004",
  reclaimStyle: "50000000-0000-4000-8000-000000000005",
  exhaustedStyle: "60000000-0000-4000-8000-000000000006",
  reclaimJob: "70000000-0000-4000-8000-000000000007",
  exhaustedJob: "80000000-0000-4000-8000-000000000008",
  defaultStyle: "90000000-0000-4000-8000-000000000009",
  firstPreset: "a0000000-0000-4000-8000-00000000000a",
  secondPreset: "b0000000-0000-4000-8000-00000000000b",
};
const applicationPassword = "design-style-application";

function applicationConnectionString(connectionString: string) {
  const value = new URL(connectionString);
  value.username = "content_application";
  value.password = applicationPassword;
  return value.toString();
}

describe.skipIf(process.env.RUN_POSTGRES_INTEGRATION !== "true")(
  "design style analysis lease recovery under the production application ACL",
  () => {
    let container: StartedPostgreSqlContainer | null = null;
    let admin: Pool;
    let application: Pool;

    beforeAll(async () => {
      container = await new PostgreSqlContainer("postgres:16-alpine")
        .withDatabase("design_style_acl")
        .withUsername("brand_pilot")
        .withPassword("brand_pilot")
        .start();
      admin = new Pool({ connectionString: container.getConnectionUri(), max: 2 });
      await admin.query(`
        create role content_schema_owner nologin nosuperuser;
        create role content_application login nosuperuser password '${applicationPassword}';
        create table app_users(id uuid primary key);
        create table workspaces(id uuid primary key);
        create table workspace_members(
          workspace_id uuid not null references workspaces(id),
          user_id uuid not null references app_users(id),
          role text not null default 'owner', status text not null default 'active',
          primary key(workspace_id,user_id)
        );
        create table brands(
          id uuid not null, workspace_id uuid not null references workspaces(id),
          deleted_at timestamptz null,
          primary key(id), unique(id,workspace_id)
        );
        create table storage_artifacts(
          id uuid primary key, workspace_id uuid not null, brand_id uuid not null,
          public_url text not null, path text not null, mime_type text not null,
          byte_size bigint not null, checksum text not null
        );
        create table reference_items(
          id uuid not null, workspace_id uuid not null, brand_id uuid not null,
          storage_artifact_id uuid not null references storage_artifacts(id),
          primary key(id), unique(id,workspace_id,brand_id)
        );
        create table brand_avatars(
          id uuid not null, workspace_id uuid not null, brand_id uuid not null,
          status text not null default 'active',
          primary key(id), unique(id,workspace_id,brand_id)
        );
        create table brand_avatar_images(
          id uuid primary key default gen_random_uuid(),
          workspace_id uuid not null, brand_id uuid not null, avatar_id uuid not null
        );
        create table brand_style_presets(
          id uuid not null, workspace_id uuid not null, brand_id uuid not null,
          name text not null, description text not null default '',
          visual_tokens_json jsonb not null default '{}'::jsonb,
          status text not null, revision integer not null, is_default boolean not null,
          created_by_user_id uuid not null, created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          primary key(id), unique(id,workspace_id,brand_id)
        );
        create table brand_style_preset_references(
          id uuid primary key default gen_random_uuid(),
          workspace_id uuid not null, brand_id uuid not null,
          preset_id uuid not null, reference_item_id uuid not null,
          position integer not null, created_at timestamptz not null default now()
        );
        create table manual_ai_content_visual_selections(
          contract_version text not null,
          frozen_json jsonb null,
          constraint manual_ai_content_visual_selections_contract_version_check
            check(contract_version='manual-visual-selection.v1')
        );
        create table brand_rule_sets(rules_json jsonb not null);
        create table worker_resource_leases(
          workload_type text not null,
          constraint worker_resource_leases_workload_check check(workload_type in ('content'))
        );
        create table ai_content_write_fence_catalog(
          relation_name text primary key, relation_class text not null,
          row_classifier text not null, reviewed_at timestamptz not null default now()
        );
        create table ai_content_bootstrap_state(
          singleton boolean primary key,
          schema_owner_role_name name,
          application_role_name name
        );
        insert into ai_content_bootstrap_state values(
          true,'content_schema_owner','content_application'
        );
        create function set_updated_at() returns trigger language plpgsql as $$
        begin new.updated_at=now(); return new; end
        $$;
        create function enforce_ai_content_write_fence() returns trigger language plpgsql as $$
        begin return case when tg_op='DELETE' then old else new end; end
        $$;
        create function assert_ai_content_writable() returns void language plpgsql as $$
        begin return; end
        $$;
        revoke all on function assert_ai_content_writable() from public;
        grant execute on function assert_ai_content_writable() to content_application;
        create function ai_content_fence_trigger_name(p_relation_name text) returns text
        language sql immutable strict as $$
          select 'ai_content_fence_' || left(p_relation_name,30) || '_' || left(md5(p_relation_name),12)
        $$;
        grant usage on schema public to content_application;
        grant select on reference_items,storage_artifacts,workspace_members,brands,
          brand_style_presets,brand_avatars to content_application;
        grant select on brand_avatar_images to content_application;
        grant update on brand_style_presets to content_application;
      `);
      await admin.query(await readFile(
        resolve(process.cwd(), "../../db/migrations/093_design_style_analysis_visual_presets.sql"),
        "utf8",
      ));
      await admin.query(`
        insert into app_users values ('${ids.workspace}');
        insert into workspaces values ('${ids.workspace}');
        insert into workspace_members values ('${ids.workspace}','${ids.workspace}');
        insert into brands(id,workspace_id) values ('${ids.brand}','${ids.workspace}');

        insert into brand_design_styles values
          ('${ids.reclaimStyle}','${ids.workspace}','${ids.brand}','Reclaim',1,
           'processing',null,null,null,null,'${ids.workspace}',now(),now()),
          ('${ids.exhaustedStyle}','${ids.workspace}','${ids.brand}','Exhausted',1,
           'processing',null,null,null,null,'${ids.workspace}',now(),now()),
          ('${ids.defaultStyle}','${ids.workspace}','${ids.brand}','Default',1,
           'ready','design-style-analysis.v1','{}'::jsonb,'${"a".repeat(64)}',null,
           '${ids.workspace}',now(),now());
        insert into storage_artifacts values (
          '${ids.artifact}','${ids.workspace}','${ids.brand}',
          'https://assets.example/style.png','style.png','image/png',68,'${"a".repeat(64)}'
        );
        insert into reference_items values
          ('${ids.reference}','${ids.workspace}','${ids.brand}','${ids.artifact}');
        insert into brand_design_style_references(
          workspace_id,brand_id,design_style_id,reference_item_id,position
        ) values
          ('${ids.workspace}','${ids.brand}','${ids.reclaimStyle}','${ids.reference}',1),
          ('${ids.workspace}','${ids.brand}','${ids.exhaustedStyle}','${ids.reference}',1);
        insert into brand_design_style_analysis_jobs(
          id,workspace_id,brand_id,design_style_id,style_revision,status,
          attempt_count,max_attempts,available_at,leased_by,lease_token,lease_expires_at,
          error_code,created_at
        ) values
          ('${ids.reclaimJob}','${ids.workspace}','${ids.brand}','${ids.reclaimStyle}',1,
           'processing',1,3,now()-interval '2 minutes','worker-1',gen_random_uuid(),
           now()-interval '1 minute',null,now()-interval '2 minutes'),
          ('${ids.exhaustedJob}','${ids.workspace}','${ids.brand}','${ids.exhaustedStyle}',1,
           'processing',3,3,now()-interval '1 minute','worker-1',gen_random_uuid(),
           now()-interval '1 minute',null,now()-interval '1 minute');
        create unique index brand_style_presets_one_active_default
          on brand_style_presets(workspace_id,brand_id)
          where is_default and status='active';
        insert into brand_style_presets(
          id,workspace_id,brand_id,name,design_style_id,revision,is_default,status,created_by_user_id
        ) values
          ('${ids.firstPreset}','${ids.workspace}','${ids.brand}','First','${ids.defaultStyle}',1,false,'active','${ids.workspace}'),
          ('${ids.secondPreset}','${ids.workspace}','${ids.brand}','Second','${ids.defaultStyle}',1,false,'active','${ids.workspace}');
      `);
      application = new Pool({
        connectionString: applicationConnectionString(container.getConnectionUri()),
        max: 2,
        application_name: "design-style-analysis-acl",
      });
    }, 120_000);

    afterAll(async () => {
      await application?.end();
      await admin?.end();
      await container?.stop();
    }, 120_000);

    it("reclaims retryable leases and terminalizes exhausted leases without owner privileges", async () => {
      const privileges = await application.query(`
        select
          pg_get_userbyid(job.relowner) job_owner,
          has_table_privilege(current_user,'brand_design_style_analysis_jobs','SELECT') can_select_jobs,
          has_table_privilege(current_user,'brand_design_style_analysis_jobs','UPDATE') can_update_jobs,
          has_table_privilege(current_user,'brand_design_style_analysis_jobs','DELETE') can_delete_jobs,
          has_table_privilege(current_user,'brand_design_styles','UPDATE') can_update_styles
        from pg_class job
        join pg_namespace namespace on namespace.oid=job.relnamespace
       where namespace.nspname='public' and job.relname='brand_design_style_analysis_jobs'
      `);
      expect(privileges.rows[0]).toEqual({
        job_owner: "content_schema_owner",
        can_select_jobs: true,
        can_update_jobs: true,
        can_delete_jobs: false,
        can_update_styles: true,
      });

      const repository = createDesignStyleRepository(application);
      await expect(repository.claimDesignStyleAnalysis("worker-2", 60)).resolves.toMatchObject({
        jobId: ids.reclaimJob,
        designStyleId: ids.reclaimStyle,
        images: [{ referenceItemId: ids.reference }],
      });

      const jobs = await admin.query(
        "select id,status,attempt_count,leased_by,error_code from brand_design_style_analysis_jobs order by id",
      );
      expect(jobs.rows).toEqual([
        {
          id: ids.reclaimJob,
          status: "processing",
          attempt_count: 2,
          leased_by: "worker-2",
          error_code: null,
        },
        {
          id: ids.exhaustedJob,
          status: "failed",
          attempt_count: 3,
          leased_by: null,
          error_code: "design_style_analysis_lease_expired",
        },
      ]);
      await expect(admin.query(
        "select analysis_status,analysis_error_code from brand_design_styles where id=$1",
        [ids.exhaustedStyle],
      )).resolves.toMatchObject({
        rows: [{
          analysis_status: "failed",
          analysis_error_code: "design_style_analysis_lease_expired",
        }],
      });
    });

    it("serializes concurrent default changes under the application role", async () => {
      const repository = createDesignStyleRepository(application);
      const scope = {
        workspaceId: ids.workspace, brandId: ids.brand, actorUserId: ids.workspace,
      };

      await expect(Promise.all([
        repository.setDefaultVisualPreset({ ...scope, presetId: ids.firstPreset }),
        repository.setDefaultVisualPreset({ ...scope, presetId: ids.secondPreset }),
      ])).resolves.toHaveLength(2);

      const defaults = await admin.query(
        `select id from brand_style_presets
          where workspace_id=$1 and brand_id=$2 and is_default and status='active'`,
        [ids.workspace, ids.brand],
      );
      expect(defaults.rows).toHaveLength(1);
    });
  },
);
