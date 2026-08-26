import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { expect, it } from "vitest";
import { runPublishDue } from "./publishDueRun.js";

const applicationRole = "publish_due_application";
const applicationPassword = "publish-due-application-test";

function applicationConnectionString(connectionString: string): string {
  const value = new URL(connectionString);
  value.username = applicationRole;
  value.password = applicationPassword;
  return value.toString();
}

it("executes expiry, fair selection, and claims as the application role without an open provider transaction", async () => {
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
        id uuid primary key,workspace_id uuid not null references workspaces(id),
        status text not null default 'active',deleted_at timestamptz null
      );
      create table topic_publish_groups(
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,
        status text not null,scheduled_for timestamptz null,updated_at timestamptz not null default now()
      );
      create table publish_calendar_slots(
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,
        topic_publish_group_id uuid not null references topic_publish_groups(id),
        scheduled_for timestamptz not null,status text not null,last_error text null,
        updated_at timestamptz not null default now()
      );
      create table publish_queue(
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,
        topic_publish_group_id uuid not null references topic_publish_groups(id),
        status text not null,scheduled_for timestamptz null,queued_at timestamptz not null default now(),
        deferred_until timestamptz null,publishing_started_at timestamptz null,
        published_at timestamptz null,failed_at timestamptz null,last_error text null,
        updated_at timestamptz not null default now()
      );
      create table publish_attempts(
        id uuid primary key default gen_random_uuid(),publish_queue_id uuid not null references publish_queue(id),
        status text not null,finished_at timestamptz null,error_code text null,error_message text null
      );
      revoke all on all tables in schema public from public,${applicationRole};
      grant usage on schema public to ${applicationRole};
      grant select on workspaces,brands to ${applicationRole};
      grant select,update on topic_publish_groups,publish_calendar_slots,publish_queue to ${applicationRole};
      grant select,insert,update on publish_attempts to ${applicationRole};
    `);
    application = new Pool({
      connectionString: applicationConnectionString(container.getConnectionUri()),
      application_name: "publish-due-application-role",
      max: 4,
    });

    const workspaceId = "10000000-0000-4000-8000-000000000001";
    const delayedBrandId = "20000000-0000-4000-8000-000000000001";
    const delayedGroupId = "30000000-0000-4000-8000-000000000001";
    const delayedSlotId = "40000000-0000-4000-8000-000000000001";
    const delayedQueueId = "50000000-0000-4000-8000-000000000001";
    await administrator.query("insert into workspaces(id) values($1)", [workspaceId]);
    await administrator.query(
      "insert into brands(id,workspace_id,status) values($1,$2,'active')",
      [delayedBrandId, workspaceId],
    );
    await administrator.query(
      "insert into topic_publish_groups(id,workspace_id,brand_id,status) values($1,$2,$3,'waiting')",
      [delayedGroupId, workspaceId, delayedBrandId],
    );
    await administrator.query(
      `insert into publish_calendar_slots(
         id,workspace_id,brand_id,topic_publish_group_id,scheduled_for,status,last_error
       ) values($1,$2,$3,$4,$5,'publish_delayed','content_not_ready_at_reserved_time')`,
      [delayedSlotId, workspaceId, delayedBrandId, delayedGroupId, new Date("2026-08-26T11:30:00+09:00")],
    );
    await administrator.query(
      `insert into publish_queue(id,workspace_id,brand_id,topic_publish_group_id,status)
       values($1,$2,$3,$4,'queued')`,
      [delayedQueueId, workspaceId, delayedBrandId, delayedGroupId],
    );

    let providerCalls = 0;
    const delayedResult = await runPublishDue({
      pool: application,
      now: new Date("2026-08-26T23:58:59.999+09:00"),
      batchSize: 10,
      concurrency: 2,
      claimQueueItem: async (client, queueId) => {
        const claimed = await client.query(
          `with claimed as (
             update publish_queue set status='publishing',publishing_started_at=clock_timestamp(),updated_at=now()
              where id=$1 and status in ('scheduled','deferred') returning id
           ),attempt as (
             insert into publish_attempts(publish_queue_id,status)
             select id,'running' from claimed returning id
           ) select claimed.id from claimed cross join attempt`,
          [queueId],
        );
        return claimed.rowCount ? { queueId, context: { queueId } } : null;
      },
      dispatchClaim: async (claim) => {
        providerCalls += 1;
        const openTransactions = await administrator!.query<{ count: number }>(
          `select count(*)::integer count from pg_stat_activity
            where application_name='publish-due-application-role' and state='idle in transaction'`,
        );
        expect(openTransactions.rows[0]?.count).toBe(0);
        await application!.query(
          "update publish_queue set status='published',published_at=now() where id=$1 and status='publishing'",
          [claim.queueId],
        );
        return { status: "published" };
      },
    });

    expect(delayedResult).toMatchObject({ acquired: true, dueQueued: 1, published: 1, expiredTargets: 0 });
    expect(providerCalls).toBe(1);
    const delayedStored = await application.query(
      "select status,scheduled_for,deferred_until,publishing_started_at from publish_queue where id=$1",
      [delayedQueueId],
    );
    expect(delayedStored.rows[0]).toMatchObject({ status: "published" });
    expect(new Date(delayedStored.rows[0].scheduled_for).toISOString()).toBe("2026-08-26T02:30:00.000Z");
    expect(new Date(delayedStored.rows[0].deferred_until).toISOString()).toBe("2026-08-26T14:58:59.999Z");

    const scenarios = ["unstarted", "partial", "publishing", "failed", "unknown"] as const;
    for (let index = 0; index < scenarios.length; index += 1) {
      const suffix = String(index + 10).padStart(12, "0");
      const brandId = `20000000-0000-4000-8000-${suffix}`;
      const groupId = `30000000-0000-4000-8000-${suffix}`;
      const slotId = `40000000-0000-4000-8000-${suffix}`;
      const preservedQueueId = `50000000-0000-4000-8000-${suffix}`;
      const cancellableQueueId = `60000000-0000-4000-8000-${suffix}`;
      await administrator.query("insert into brands(id,workspace_id,status) values($1,$2,'active')", [brandId, workspaceId]);
      await administrator.query(
        "insert into topic_publish_groups(id,workspace_id,brand_id,status,scheduled_for) values($1,$2,$3,$4,$5)",
        [groupId, workspaceId, brandId, scenarios[index] === "unstarted" ? "scheduled" : "partially_published", new Date("2026-08-26T11:30:00+09:00")],
      );
      await administrator.query(
        "insert into publish_calendar_slots(id,workspace_id,brand_id,topic_publish_group_id,scheduled_for,status) values($1,$2,$3,$4,$5,'scheduled')",
        [slotId, workspaceId, brandId, groupId, new Date("2026-08-26T11:30:00+09:00")],
      );
      const state = scenarios[index];
      const preserved = state === "unstarted"
        ? { status: "scheduled", started: null, published: null, error: null }
        : state === "partial"
          ? { status: "published", started: new Date("2026-08-26T12:00:00+09:00"), published: new Date("2026-08-26T12:01:00+09:00"), error: null }
          : state === "publishing"
            ? { status: "publishing", started: new Date("2026-08-26T23:58:00+09:00"), published: null, error: null }
            : state === "failed"
              ? { status: "failed", started: new Date("2026-08-26T23:57:00+09:00"), published: null, error: "provider_rejected" }
              : { status: "failed", started: new Date("2026-08-26T23:57:00+09:00"), published: null, error: "publish_delivery_unknown" };
      await administrator.query(
        `insert into publish_queue(
           id,workspace_id,brand_id,topic_publish_group_id,status,scheduled_for,publishing_started_at,published_at,last_error
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [preservedQueueId, workspaceId, brandId, groupId, preserved.status, new Date("2026-08-26T11:30:00+09:00"), preserved.started, preserved.published, preserved.error],
      );
      await administrator.query(
        `insert into publish_queue(id,workspace_id,brand_id,topic_publish_group_id,status,scheduled_for)
         values($1,$2,$3,$4,'scheduled',$5)`,
        [cancellableQueueId, workspaceId, brandId, groupId, new Date("2026-08-26T11:30:00+09:00")],
      );
      if (state !== "unstarted") {
        await administrator.query(
          "insert into publish_attempts(publish_queue_id,status,finished_at) values($1,$2,$3)",
          [preservedQueueId, state === "publishing" ? "running" : "failed", state === "publishing" ? null : new Date("2026-08-26T23:58:00+09:00")],
        );
      }
    }

    const expiryResult = await runPublishDue({
      pool: application,
      now: new Date("2026-08-26T23:59:00.000+09:00"),
      batchSize: 10,
      concurrency: 2,
      claimQueueItem: async () => {
        throw new Error("expired_target_must_not_be_claimed");
      },
      dispatchClaim: async () => {
        throw new Error("expired_target_must_not_reach_provider");
      },
    });
    expect(expiryResult).toMatchObject({ acquired: true, expiredTargets: 6, expiredSlots: 1, dueQueued: 0 });
    expect(providerCalls).toBe(1);

    const statuses = await application.query(
      `select publish_group.status as group_status,slot.status as slot_status,slot.last_error,
              array_agg(queue.status order by queue.id) as target_statuses
         from topic_publish_groups publish_group
         join publish_calendar_slots slot on slot.topic_publish_group_id=publish_group.id
         join publish_queue queue on queue.topic_publish_group_id=publish_group.id
        where publish_group.id<>'${delayedGroupId}'
        group by publish_group.id,publish_group.status,slot.status,slot.last_error
        order by publish_group.id`,
    );
    expect(statuses.rows[0]).toMatchObject({
      group_status: "cancelled",
      slot_status: "cancelled",
      last_error: "reservation_expired_at_2359_kst",
      target_statuses: ["cancelled", "cancelled"],
    });
    expect(statuses.rows.slice(1).every((row) => row.slot_status === "scheduled")).toBe(true);
    expect(statuses.rows.slice(1).every((row) => row.target_statuses.includes("cancelled"))).toBe(true);

    const heldLock = await administrator.connect();
    try {
      await heldLock.query("begin");
      await heldLock.query(
        "select pg_advisory_xact_lock(hashtextextended($1,0))",
        ["publish-due-run:v1"],
      );
      await expect(runPublishDue({
        pool: application,
        claimQueueItem: async () => { throw new Error("lock_contention_claimed"); },
        dispatchClaim: async () => { throw new Error("lock_contention_dispatched"); },
      })).resolves.toEqual({
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
