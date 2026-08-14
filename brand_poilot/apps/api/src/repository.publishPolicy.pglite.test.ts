import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRepository } from "./repository.js";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000101",
  brand: "20000000-0000-4000-8000-000000000102",
  channel: "30000000-0000-4000-8000-000000000103",
  topic: "40000000-0000-4000-8000-000000000104",
  draft: "50000000-0000-4000-8000-000000000105",
  output: "60000000-0000-4000-8000-000000000106",
  group: "70000000-0000-4000-8000-000000000107",
  queue: "80000000-0000-4000-8000-000000000108",
  slot: "90000000-0000-4000-8000-000000000109",
};

describe("publish queue execution policy with PostgreSQL semantics", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = await PGlite.create();
    await database.exec(`
      create table workspaces(id uuid primary key,name text not null,slug text not null);
      create table brands(
        id uuid primary key,workspace_id uuid not null,name text not null,status text not null default 'active',deleted_at timestamptz
      );
      create table brand_channels(
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,channel text not null,
        status text not null,enabled boolean not null,deleted_at timestamptz,last_error text,
        external_account_id text,last_published_at timestamptz
      );
      create table billing_plan_catalog(
        code text primary key,name text not null,weekly_generation_limit integer not null,
        weekly_publish_limit integer not null,active boolean not null default true
      );
      create table brand_subscriptions(
        brand_id uuid primary key,plan_code text not null,status text not null,started_at timestamptz not null,
        current_period_start timestamptz not null,current_period_end timestamptz not null
      );
      create table content_topics(
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,title text,angle text,status text
      );
      create table master_drafts(
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,content_topic_id uuid not null,
        status text,prompt_version text
      );
      create table storage_artifacts(id uuid primary key,public_url text);
      create table channel_outputs(
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,content_topic_id uuid not null,
        master_draft_id uuid not null,channel text not null,delivery_format text not null,status text not null,
        title text not null,output_json jsonb not null default '{}',rendered_artifact_id uuid,
        ai_content_generation_output_id uuid
      );
      create table topic_publish_groups(
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,content_topic_id uuid not null,
        status text not null,scheduled_for timestamptz,updated_at timestamptz not null default now()
      );
      create table publish_queue(
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,channel_output_id uuid not null,
        topic_publish_group_id uuid not null,brand_channel_id uuid not null,channel text not null,status text not null,
        approval_type text not null,scheduled_for timestamptz,queued_at timestamptz not null default now(),
        publishing_started_at timestamptz,published_at timestamptz,failed_at timestamptz,last_error text,
        updated_at timestamptz not null default now(),idempotency_key text not null
      );
      create table publish_calendar_slots(
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,topic_publish_group_id uuid,
        status text not null,scheduled_for timestamptz not null,channels text[] not null,content_format text not null,
        last_error text,updated_at timestamptz not null default now()
      );
      create table channel_credentials(
        id uuid primary key,brand_channel_id uuid not null,provider text,status text,expires_at timestamptz,
        scopes text[] not null default '{}',encrypted_payload text,auth_mode text,revoked_at timestamptz,
        created_at timestamptz not null default now()
      );
      create table brand_content_formats(
        brand_id uuid not null,format text not null,capability_status text,capability_metadata jsonb not null default '{}'
      );
      create table publish_attempts(
        id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
        publish_queue_id uuid not null,attempt_number integer not null,status text not null,
        request_metadata jsonb not null default '{}',response_metadata jsonb not null default '{}',
        external_post_id text,external_url text,error_code text,error_message text,
        started_at timestamptz not null default now(),finished_at timestamptz
      );
      insert into workspaces(id,name,slug)
      values ('${ids.workspace}','Publish Policy','publish-policy');
      insert into brands(id,workspace_id,name)
      values ('${ids.brand}','${ids.workspace}','Publish Policy Brand');
      insert into brand_channels(id,workspace_id,brand_id,channel,status,enabled)
      values ('${ids.channel}','${ids.workspace}','${ids.brand}','instagram','connected',true);
      insert into billing_plan_catalog(code,name,weekly_generation_limit,weekly_publish_limit)
      values ('policy_test','Policy Test',10,1);
      insert into brand_subscriptions(
        brand_id,plan_code,status,started_at,current_period_start,current_period_end
      ) values (
        '${ids.brand}','policy_test','active',now()-interval '1 day',now()-interval '1 day',now()+interval '29 days'
      );
      insert into content_topics(id,workspace_id,brand_id,title,angle,status)
      values ('${ids.topic}','${ids.workspace}','${ids.brand}','Policy topic','Policy angle','generated');
      insert into master_drafts(id,workspace_id,brand_id,content_topic_id,status,prompt_version)
      values ('${ids.draft}','${ids.workspace}','${ids.brand}','${ids.topic}','generated','test.v1');
      insert into channel_outputs(
        id,workspace_id,brand_id,content_topic_id,master_draft_id,channel,delivery_format,status,title,output_json
      ) values (
        '${ids.output}','${ids.workspace}','${ids.brand}','${ids.topic}','${ids.draft}',
        'instagram','instagram_feed_carousel','approved','Policy output','{}'
      );
      insert into topic_publish_groups(id,workspace_id,brand_id,content_topic_id,status,scheduled_for)
      values ('${ids.group}','${ids.workspace}','${ids.brand}','${ids.topic}','scheduled',now()+interval '1 hour');
      insert into publish_queue(
        id,workspace_id,brand_id,channel_output_id,topic_publish_group_id,brand_channel_id,
        channel,status,approval_type,scheduled_for,idempotency_key
      ) values (
        '${ids.queue}','${ids.workspace}','${ids.brand}','${ids.output}','${ids.group}','${ids.channel}',
        'instagram','scheduled','manual',now()+interval '1 hour','publish-policy-future'
      );
    `);
  }, 60_000);

  afterAll(async () => database?.close(), 30_000);

  it("compiles the full policy query and refuses a future scheduled queue without mutation", async () => {
    const query = async (sql: string, values: unknown[] = []) => {
      const result = await database.query(sql, values as never[]);
      return { rows: result.rows, rowCount: result.rows.length || Number(result.affectedRows ?? 0) };
    };
    const repository = createRepository({ query } as never, { instagramPublish: { enabled: true } });

    await expect(repository.publishQueueItem(ids.queue)).rejects.toThrow("publish_queue_not_publishable");
    await expect(database.query<{ status: string }>("select status from publish_queue where id=$1", [ids.queue]))
      .resolves.toMatchObject({ rows: [{ status: "scheduled" }] });
    await expect(database.query<{ count: number }>(
      "select count(*)::integer as count from publish_attempts where publish_queue_id=$1",
      [ids.queue],
    )).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  it("keeps a due legacy direct queue claimable when no calendar subscription exists", async () => {
    await database.query("delete from brand_subscriptions where brand_id=$1", [ids.brand]);
    await database.query(
      "update publish_queue set status='scheduled',scheduled_for=now()-interval '1 minute',last_error=null where id=$1",
      [ids.queue],
    );
    const query = async (sql: string, values: unknown[] = []) => {
      const result = await database.query(sql, values as never[]);
      return { rows: result.rows, rowCount: result.rows.length || Number(result.affectedRows ?? 0) };
    };
    const repository = createRepository({ query } as never, { instagramPublish: { enabled: true } });

    await expect(repository.publishQueueItem(ids.queue)).rejects.toThrow("channel_not_connected");
    await expect(database.query<{ status: string; last_error: string }>(
      "select status,last_error from publish_queue where id=$1",
      [ids.queue],
    )).resolves.toMatchObject({
      rows: [{ status: "failed", last_error: "channel_not_connected" }],
    });

    await database.query(
      `insert into brand_subscriptions(
         brand_id,plan_code,status,started_at,current_period_start,current_period_end
       ) values($1,'policy_test','active',now()-interval '1 day',now()-interval '1 day',now()+interval '29 days')`,
      [ids.brand],
    );
    await database.query(
      "update publish_queue set status='scheduled',scheduled_for=now()+interval '1 hour',last_error=null where id=$1",
      [ids.queue],
    );
  });

  it("reconciles a persisted AI publish success into its calendar group and slot", async () => {
    await database.query(
      "update channel_outputs set ai_content_generation_output_id=$2 where id=$1",
      [ids.output, "a0000000-0000-4000-8000-000000000110"],
    );
    await database.query(
      "update topic_publish_groups set status='scheduled',scheduled_for=now()-interval '1 minute' where id=$1",
      [ids.group],
    );
    await database.query(
      `insert into publish_calendar_slots(
         id,workspace_id,brand_id,topic_publish_group_id,status,scheduled_for,channels,content_format
       ) values($1,$2,$3,$4,'scheduled',now()-interval '1 minute',array['instagram'],'card_news')`,
      [ids.slot, ids.workspace, ids.brand, ids.group],
    );
    await database.query(
      "update publish_queue set status='publishing',scheduled_for=now()-interval '1 minute' where id=$1",
      [ids.queue],
    );
    await database.query(
      `insert into publish_attempts(
         workspace_id,brand_id,publish_queue_id,attempt_number,status,finished_at
       ) values($1,$2,$3,1,'succeeded',now())`,
      [ids.workspace, ids.brand, ids.queue],
    );
    const query = async (sql: string, values: unknown[] = []) => {
      const result = await database.query(sql, values as never[]);
      return { rows: result.rows, rowCount: result.rows.length || Number(result.affectedRows ?? 0) };
    };
    const repository = createRepository({ query } as never, { instagramPublish: { enabled: true } });

    await expect(repository.runDueAiContentPublishing!()).resolves.toEqual({
      processed: 0,
      created: 0,
      updated: 0,
      failed: 0,
    });
    await expect(database.query<{ status: string }>(
      `select queue.status as queue_status,publish_group.status as group_status,slot.status as slot_status
         from publish_queue queue
         join topic_publish_groups publish_group on publish_group.id=queue.topic_publish_group_id
         join publish_calendar_slots slot on slot.topic_publish_group_id=publish_group.id
        where queue.id=$1`,
      [ids.queue],
    )).resolves.toMatchObject({
      rows: [{ queue_status: "published", group_status: "published", slot_status: "published" }],
    });
  });
});
