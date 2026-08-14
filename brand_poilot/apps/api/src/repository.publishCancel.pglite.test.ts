import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepository } from "./repository.js";

const ids = {
  group: "11111111-1111-4111-8111-111111111111",
  queue: "22222222-2222-4222-8222-222222222222",
  queue2: "33333333-3333-4333-8333-333333333333",
  slot: "44444444-4444-4444-8444-444444444444",
};

describe("publish queue cancellation with calendar linkage", () => {
  let db: PGlite;
  let repository: ReturnType<typeof createRepository>;

  beforeEach(async () => {
    db = await PGlite.create();
    await db.exec(`
      create table topic_publish_groups (
        id uuid primary key,
        status text not null,
        slot_date date,
        slot_number integer,
        scheduled_for timestamptz,
        updated_at timestamptz not null default now()
      );
      create table publish_queue (
        id uuid primary key,
        topic_publish_group_id uuid not null,
        status text not null,
        deferred_until timestamptz,
        publishing_started_at timestamptz,
        updated_at timestamptz not null default now()
      );
      create table publish_calendar_slots (
        id uuid primary key,
        topic_publish_group_id uuid,
        status text not null,
        updated_at timestamptz not null default now()
      );
    `);
    const query = async (sql: string, values: unknown[] = []) => {
      const result = await db.query(sql, values as never[]);
      return { rows: result.rows, rowCount: result.rows.length || Number(result.affectedRows ?? 0) };
    };
    repository = createRepository({ query } as never);
  }, 30_000);

  afterEach(async () => db.close(), 30_000);

  it("keeps direct queue cancellation behavior unchanged when no calendar slot is linked", async () => {
    await db.query("insert into topic_publish_groups(id,status) values($1,'scheduled')", [ids.group]);
    await db.query(
      "insert into publish_queue(id,topic_publish_group_id,status) values($1,$2,'scheduled')",
      [ids.queue, ids.group],
    );

    await expect(repository.cancelPublishQueueItem(ids.queue)).resolves.toEqual({
      id: ids.queue,
      status: "cancelled",
    });

    expect((await db.query<{ status: string }>("select status from publish_queue where id=$1", [ids.queue])).rows)
      .toEqual([{ status: "cancelled" }]);
    expect((await db.query<{ status: string }>("select status from topic_publish_groups where id=$1", [ids.group])).rows)
      .toEqual([{ status: "cancelled" }]);
    expect((await db.query<{ count: number }>("select count(*)::integer as count from publish_calendar_slots")).rows[0]?.count)
      .toBe(0);
  });

  it("cancels the linked calendar slot when the last active queue cancels the group", async () => {
    await db.query("insert into topic_publish_groups(id,status) values($1,'waiting')", [ids.group]);
    await db.query(
      "insert into publish_queue(id,topic_publish_group_id,status) values($1,$2,'queued')",
      [ids.queue, ids.group],
    );
    await db.query(
      "insert into publish_calendar_slots(id,topic_publish_group_id,status) values($1,$2,'content_assigned')",
      [ids.slot, ids.group],
    );

    await repository.cancelPublishQueueItem(ids.queue);

    expect((await db.query<{ status: string }>("select status from topic_publish_groups where id=$1", [ids.group])).rows)
      .toEqual([{ status: "cancelled" }]);
    expect((await db.query<{ status: string }>("select status from publish_calendar_slots where id=$1", [ids.slot])).rows)
      .toEqual([{ status: "cancelled" }]);
  });

  it("does not cancel the calendar slot while another group queue remains active", async () => {
    await db.query("insert into topic_publish_groups(id,status) values($1,'waiting')", [ids.group]);
    await db.query(
      "insert into publish_queue(id,topic_publish_group_id,status) values($1,$3,'queued'),($2,$3,'queued')",
      [ids.queue, ids.queue2, ids.group],
    );
    await db.query(
      "insert into publish_calendar_slots(id,topic_publish_group_id,status) values($1,$2,'content_assigned')",
      [ids.slot, ids.group],
    );

    await repository.cancelPublishQueueItem(ids.queue);

    expect((await db.query<{ id: string; status: string }>("select id,status from publish_queue order by id")).rows)
      .toEqual([{ id: ids.queue, status: "cancelled" }, { id: ids.queue2, status: "queued" }]);
    expect((await db.query<{ status: string }>("select status from topic_publish_groups where id=$1", [ids.group])).rows)
      .toEqual([{ status: "waiting" }]);
    expect((await db.query<{ status: string }>("select status from publish_calendar_slots where id=$1", [ids.slot])).rows)
      .toEqual([{ status: "content_assigned" }]);
  });
});
