import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { expect, it, vi } from "vitest";
import { encryptCredential } from "./credentialCrypto.js";
import type { InstagramPublishInput } from "./instagramPublisher.js";
import { MetaGraphRequestError } from "./metaGraph.js";
import { createRepository } from "./repository.js";

const applicationRole = "publish_due_application";
const applicationPassword = "publish-due-application-test";

function applicationConnectionString(connectionString: string): string {
  const value = new URL(connectionString);
  value.username = applicationRole;
  value.password = applicationPassword;
  return value.toString();
}

it("uses the production claim and recovery lifecycle as the PostgreSQL application role", async () => {
  let container: StartedPostgreSqlContainer | null = null;
  let administrator: Pool | null = null;
  let application: Pool | null = null;
  try {
    container = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("publish_due_run")
      .start();
    administrator = new Pool({ connectionString: container.getConnectionUri() });
    await administrator.query(`
      create role ${applicationRole} login noinherit nosuperuser nobypassrls
        nocreatedb nocreaterole noreplication password '${applicationPassword}';
      create table workspaces(id uuid primary key);
      create table brands(
        id uuid primary key,workspace_id uuid not null,status text not null default 'active',deleted_at timestamptz null
      );
      create table storage_artifacts(id uuid primary key,public_url text null);
      create table channel_outputs(
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,channel text not null,
        delivery_format text not null,output_json jsonb not null default '{}'::jsonb,
        rendered_artifact_id uuid null
      );
      create table brand_channels(
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,channel text not null,
        enabled boolean not null default true,status text not null,deleted_at timestamptz null,
        external_account_id text null,last_published_at timestamptz null,last_error text null
      );
      create table channel_credentials(
        id uuid primary key,brand_channel_id uuid not null,provider text not null,status text not null,
        expires_at timestamptz null,scopes text[] not null default '{}',encrypted_payload text not null,
        auth_mode text null,revoked_at timestamptz null,created_at timestamptz not null default now()
      );
      create table brand_content_formats(
        id uuid primary key,brand_id uuid not null,format text not null,
        capability_status text null,capability_metadata jsonb not null default '{}'::jsonb
      );
      create table billing_plan_catalog(
        code text primary key,active boolean not null default true,weekly_publish_limit integer not null
      );
      create table brand_subscriptions(
        brand_id uuid primary key,plan_code text not null,status text not null,started_at timestamptz not null,
        current_period_start timestamptz not null,current_period_end timestamptz not null
      );
      create table topic_publish_groups(
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,status text not null,
        scheduled_for timestamptz null,updated_at timestamptz not null default now()
      );
      create table publish_calendar_slots(
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,topic_publish_group_id uuid null,
        scheduled_for timestamptz not null,status text not null,channels text[] not null default '{}',
        content_format text not null,last_error text null,updated_at timestamptz not null default now()
      );
      create table publish_queue(
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,channel_output_id uuid not null,
        brand_channel_id uuid not null,channel text not null,topic_publish_group_id uuid not null,
        status text not null,scheduled_for timestamptz null,queued_at timestamptz not null default now(),
        deferred_until timestamptz null,publishing_started_at timestamptz null,published_at timestamptz null,
        failed_at timestamptz null,last_error text null,updated_at timestamptz not null default now()
      );
      create table publish_attempts(
        id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
        publish_queue_id uuid not null,attempt_number integer not null,status text not null,
        request_metadata jsonb not null default '{}'::jsonb,response_metadata jsonb not null default '{}'::jsonb,
        external_post_id text null,external_url text null,error_code text null,error_message text null,
        started_at timestamptz not null default now(),finished_at timestamptz null,
        unique(publish_queue_id,attempt_number)
      );
      revoke all on all tables in schema public from public,${applicationRole};
      revoke all on all sequences in schema public from public,${applicationRole};
      grant usage on schema public to ${applicationRole};
      grant select on workspaces,brands,storage_artifacts,channel_outputs,channel_credentials,
        brand_content_formats,billing_plan_catalog,brand_subscriptions to ${applicationRole};
      grant select,update on brand_channels,topic_publish_groups,publish_calendar_slots,publish_queue to ${applicationRole};
      grant select,insert,update on publish_attempts to ${applicationRole};
    `);
    application = new Pool({
      connectionString: applicationConnectionString(container.getConnectionUri()),
      application_name: "publish-due-application-role",
      max: 4,
    });

    const workspaceId = "10000000-0000-4000-8000-000000000001";
    const brandId = "20000000-0000-4000-8000-000000000001";
    const otherBrandId = "20000000-0000-4000-8000-000000000002";
    const brandChannelId = "30000000-0000-4000-8000-000000000001";
    const otherBrandChannelId = "30000000-0000-4000-8000-000000000002";
    await administrator.query("insert into workspaces(id) values($1)", [workspaceId]);
    await administrator.query(
      "insert into brands(id,workspace_id) values($1,$3),($2,$3)",
      [brandId, otherBrandId, workspaceId],
    );
    await administrator.query("insert into billing_plan_catalog(code,weekly_publish_limit) values('standard',20)");
    await administrator.query(
      `insert into brand_subscriptions(brand_id,plan_code,status,started_at,current_period_start,current_period_end)
       values($1,'standard','active','2026-08-01T00:00:00+09:00','2026-08-01T00:00:00+09:00','2026-09-01T00:00:00+09:00')`,
      [brandId],
    );
    await administrator.query(
      `insert into brand_channels(id,workspace_id,brand_id,channel,status,external_account_id)
       values($1,$3,$4,'instagram','connected','account-brand-a'),
             ($2,$3,$5,'instagram','connected','account-brand-b')`,
      [brandChannelId, otherBrandChannelId, workspaceId, brandId, otherBrandId],
    );
    await administrator.query(
      `insert into channel_credentials(
         id,brand_channel_id,provider,status,expires_at,scopes,encrypted_payload,auth_mode,created_at
       ) values
       ('31000000-0000-4000-8000-000000000001',$1,'meta','active','2099-01-01',
        array['instagram_business_basic','instagram_business_content_publish'],$3,'instagram_login','2026-08-01'),
       ('31000000-0000-4000-8000-000000000002',$2,'meta','active','2099-01-01',
        array['instagram_business_basic','instagram_business_content_publish'],$4,'instagram_login','2026-08-25')`,
      [brandChannelId, otherBrandChannelId, encryptCredential("brand-a-token"), encryptCredential("brand-b-token")],
    );

    const insertPublishTarget = async (input: {
      sequence: number;
      ownerBrandId?: string;
      outputBrandId?: string;
      status: string;
      scheduledFor: Date;
      slotStatus?: string;
      groupStatus?: string;
      publishingStartedAt?: Date | null;
      lastError?: string | null;
    }) => {
      const suffix = String(input.sequence).padStart(12, "0");
      const ownerBrandId = input.ownerBrandId ?? brandId;
      const outputBrandId = input.outputBrandId ?? ownerBrandId;
      const channelId = ownerBrandId === brandId ? brandChannelId : otherBrandChannelId;
      const artifactId = `40000000-0000-4000-8000-${suffix}`;
      const outputId = `50000000-0000-4000-8000-${suffix}`;
      const groupId = `60000000-0000-4000-8000-${suffix}`;
      const slotId = `70000000-0000-4000-8000-${suffix}`;
      const queueId = `80000000-0000-4000-8000-${suffix}`;
      await administrator!.query(
        "insert into storage_artifacts(id,public_url) values($1,$2)",
        [artifactId, `https://cdn.example.com/${suffix}/manifest.json`],
      );
      await administrator!.query(
        `insert into channel_outputs(id,workspace_id,brand_id,channel,delivery_format,output_json,rendered_artifact_id)
         values($1,$2,$3,'instagram','instagram_reel','{}'::jsonb,$4)`,
        [outputId, workspaceId, outputBrandId, artifactId],
      );
      await administrator!.query(
        `insert into topic_publish_groups(id,workspace_id,brand_id,status,scheduled_for)
         values($1,$2,$3,$4,$5)`,
        [
          groupId,
          workspaceId,
          ownerBrandId,
          input.groupStatus ?? (input.status === "publishing" ? "partially_published" : "scheduled"),
          input.scheduledFor,
        ],
      );
      await administrator!.query(
        `insert into publish_calendar_slots(
           id,workspace_id,brand_id,topic_publish_group_id,scheduled_for,status,channels,content_format
         ) values($1,$2,$3,$4,$5,$6,array['instagram'],'reel')`,
        [slotId, workspaceId, ownerBrandId, groupId, input.scheduledFor, input.slotStatus ?? "scheduled"],
      );
      await administrator!.query(
        `insert into publish_queue(
           id,workspace_id,brand_id,channel_output_id,brand_channel_id,channel,topic_publish_group_id,
           status,scheduled_for,publishing_started_at,last_error
         ) values($1,$2,$3,$4,$5,'instagram',$6,$7,$8,$9,$10)`,
        [
          queueId,
          workspaceId,
          ownerBrandId,
          outputId,
          channelId,
          groupId,
          input.status,
          input.scheduledFor,
          input.publishingStartedAt ?? null,
          input.lastError ?? null,
        ],
      );
      return { artifactId, outputId, groupId, slotId, queueId };
    };

    const dueTarget = await insertPublishTarget({
      sequence: 1,
      status: "scheduled",
      scheduledFor: new Date("2026-08-26T11:30:00+09:00"),
    });
    const providerInputs: Array<Record<string, unknown>> = [];
    const repository = createRepository(application, {
      instagramPublish: { enabled: true },
      fetchInstagramImageManifest: async () => ({ video: { url: "https://cdn.example.com/reel.mp4" } }),
      publishInstagramOutput: async (input: InstagramPublishInput) => {
        providerInputs.push(input as unknown as Record<string, unknown>);
        const openTransactions = await administrator!.query<{ count: number }>(
          `select count(*)::integer count from pg_stat_activity
            where application_name='publish-due-application-role' and state='idle in transaction'`,
        );
        expect(openTransactions.rows[0]?.count).toBe(0);
        const checkpoint = await application!.query(
          `select queue.status,attempt.status as attempt_status
             from publish_queue queue join publish_attempts attempt on attempt.publish_queue_id=queue.id
            where queue.id=$1`,
          [dueTarget.queueId],
        );
        expect(checkpoint.rows[0]).toMatchObject({ status: "publishing", attempt_status: "running" });
        return { externalPostId: "instagram-post-1", publishedUrl: "https://instagram.example/post-1" };
      },
    } as any);

    const role = await application.query("select current_user,session_user");
    expect(role.rows[0]).toEqual({ current_user: applicationRole, session_user: applicationRole });
    await expect(repository.runDuePublishing(new Date("2026-08-26T12:00:00+09:00"))).resolves.toMatchObject({
      acquired: true,
      dueQueued: 1,
      published: 1,
      failed: 0,
    });
    expect(providerInputs).toHaveLength(1);
    expect(providerInputs[0]).toMatchObject({
      accessToken: "brand-a-token",
      instagramBusinessAccountId: "account-brand-a",
    });
    const storedSuccess = await application.query(
      `select queue.status,queue.published_at,attempt.status as attempt_status,attempt.external_post_id
         from publish_queue queue join publish_attempts attempt on attempt.publish_queue_id=queue.id
        where queue.id=$1`,
      [dueTarget.queueId],
    );
    expect(storedSuccess.rows[0]).toMatchObject({
      status: "published",
      attempt_status: "succeeded",
      external_post_id: "instagram-post-1",
    });
    expect(storedSuccess.rows[0].published_at).toBeInstanceOf(Date);

    const crossScoped = await insertPublishTarget({
      sequence: 2,
      ownerBrandId: brandId,
      outputBrandId: otherBrandId,
      status: "scheduled",
      scheduledFor: new Date("2026-08-26T11:31:00+09:00"),
    });
    await expect(repository.runDuePublishing(new Date("2026-08-26T12:00:00+09:00"))).resolves.toMatchObject({
      acquired: true,
      dueQueued: 0,
    });
    const rejectedScope = await application.query(
      `select queue.status,count(attempt.id)::integer as attempts
         from publish_queue queue left join publish_attempts attempt on attempt.publish_queue_id=queue.id
        where queue.id=$1 group by queue.id,queue.status`,
      [crossScoped.queueId],
    );
    expect(rejectedScope.rows[0]).toEqual({ status: "scheduled", attempts: 0 });
    expect(providerInputs).toHaveLength(1);

    const cutoffFailure = await insertPublishTarget({
      sequence: 5,
      status: "scheduled",
      scheduledFor: new Date("2026-08-26T11:32:00+09:00"),
    });
    const retryFailureRepository = createRepository(application, {
      instagramPublish: { enabled: true },
      fetchInstagramImageManifest: async () => ({ video: { url: "https://cdn.example.com/reel.mp4" } }),
      publishInstagramOutput: async () => { throw new MetaGraphRequestError({ status: 429 }); },
    } as any);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T23:58:59.000+09:00"));
    try {
      await expect(retryFailureRepository.publishQueueItem(cutoffFailure.queueId))
        .rejects.toThrow("meta_graph_request_failed:429");
    } finally {
      vi.useRealTimers();
    }
    const cutoffState = await application.query(
      `select queue.status,queue.deferred_until,queue.last_error,attempt.status as attempt_status,
              slot.status as slot_status
         from publish_queue queue
         join publish_attempts attempt on attempt.publish_queue_id=queue.id
         join publish_calendar_slots slot on slot.topic_publish_group_id=queue.topic_publish_group_id
        where queue.id=$1`,
      [cutoffFailure.queueId],
    );
    expect(cutoffState.rows[0]).toEqual({
      status: "failed",
      deferred_until: null,
      last_error: "meta_rate_limited",
      attempt_status: "failed",
      slot_status: "publish_delayed",
    });
    await expect(retryFailureRepository.runDuePublishing(new Date("2026-08-27T00:04:00+09:00")))
      .resolves.toMatchObject({ acquired: true, dueQueued: 0 });

    const recovered = await insertPublishTarget({
      sequence: 3,
      status: "publishing",
      scheduledFor: new Date("2026-08-26T13:30:00+09:00"),
      publishingStartedAt: new Date("2026-08-26T13:31:00+09:00"),
    });
    await administrator.query(
      `insert into publish_attempts(
         workspace_id,brand_id,publish_queue_id,attempt_number,status,finished_at,external_post_id
       ) values($1,$2,$3,1,'succeeded',$4,'persisted-provider-post')`,
      [workspaceId, brandId, recovered.queueId, new Date("2026-08-26T13:32:00+09:00")],
    );
    await administrator.query(
      "update brand_channels set status='needs_attention',last_error='stale_error',last_published_at=null where id=$1",
      [brandChannelId],
    );
    const unknown = await insertPublishTarget({
      sequence: 4,
      status: "publishing",
      scheduledFor: new Date("2026-08-26T14:30:00+09:00"),
      publishingStartedAt: new Date("2026-08-26T19:00:00+09:00"),
    });
    await administrator.query(
      `insert into publish_attempts(workspace_id,brand_id,publish_queue_id,attempt_number,status)
       values($1,$2,$3,1,'running')`,
      [workspaceId, brandId, unknown.queueId],
    );

    const recoveryNow = new Date("2026-08-26T20:00:00+09:00");
    await expect(repository.runDuePublishing(recoveryNow)).resolves.toMatchObject({
      acquired: true,
      published: 1,
      resultUnknown: 1,
      dueQueued: 0,
    });
    const recoveredState = await application.query(
      `select queue.status,queue.published_at,publish_group.status as group_status,slot.status as slot_status,
              channel.status as channel_status,channel.last_error as channel_error,channel.last_published_at
         from publish_queue queue
         join topic_publish_groups publish_group on publish_group.id=queue.topic_publish_group_id
         join publish_calendar_slots slot on slot.topic_publish_group_id=publish_group.id
         join brand_channels channel on channel.id=queue.brand_channel_id
        where queue.id=$1`,
      [recovered.queueId],
    );
    expect(recoveredState.rows[0]).toMatchObject({
      status: "published",
      group_status: "published",
      slot_status: "published",
      channel_status: "connected",
      channel_error: null,
    });
    expect(new Date(recoveredState.rows[0].published_at).toISOString()).toBe("2026-08-26T04:32:00.000Z");
    expect(new Date(recoveredState.rows[0].last_published_at).toISOString()).toBe(recoveryNow.toISOString());
    const unknownState = await application.query(
      `select queue.status,queue.last_error,attempt.status as attempt_status,attempt.error_code,
              slot.status as slot_status,slot.last_error as slot_error
         from publish_queue queue
         join publish_attempts attempt on attempt.publish_queue_id=queue.id
         join publish_calendar_slots slot on slot.topic_publish_group_id=queue.topic_publish_group_id
        where queue.id=$1`,
      [unknown.queueId],
    );
    expect(unknownState.rows[0]).toEqual({
      status: "failed",
      last_error: "publish_delivery_unknown",
      attempt_status: "failed",
      error_code: "publish_delivery_unknown",
      slot_status: "publish_delayed",
      slot_error: "publish_delivery_unknown",
    });

    const heldLock = await administrator.connect();
    try {
      await heldLock.query("begin");
      await heldLock.query("select pg_advisory_xact_lock(hashtextextended($1,0))", ["publish-due-run:v1"]);
      await expect(repository.runDuePublishing()).resolves.toEqual({
        acquired: false,
        expiredTargets: 0,
        expiredSlots: 0,
        dueQueued: 0,
        published: 0,
        failed: 0,
        resultUnknown: 0,
      });
      await heldLock.query("rollback");
    } finally {
      heldLock.release();
    }
  } finally {
    await Promise.allSettled([application?.end(), administrator?.end()]);
    if (container) await container.stop();
  }
}, 180_000);
