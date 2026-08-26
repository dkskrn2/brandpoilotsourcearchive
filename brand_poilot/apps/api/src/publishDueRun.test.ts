import { describe, expect, it, vi } from "vitest";
import {
  canAutoRetryCalendarPublish,
  hasReachedKstReservationExpiry,
  runPublishDue,
  type PublishDueClaim,
} from "./publishDueRun.js";

type QueryResult = { rowCount: number; rows: any[] };

function dueHarness(input: {
  acquired?: boolean;
  expiry?: Record<string, number>;
  candidates?: Array<{ id: string; brand_id?: string }>;
  claim?: (id: string) => PublishDueClaim | null;
}) {
  const events: string[] = [];
  let transactionOpen = false;
  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]): Promise<QueryResult> => {
      const normalized = sql.replace(/\s+/g, " ").trim();
      events.push(normalized);
      if (normalized === "begin") {
        transactionOpen = true;
        return { rowCount: 0, rows: [] };
      }
      if (normalized === "commit" || normalized === "rollback") {
        transactionOpen = false;
        return { rowCount: 0, rows: [] };
      }
      if (normalized.includes("pg_try_advisory_xact_lock")) {
        return { rowCount: 1, rows: [{ acquired: input.acquired ?? true }] };
      }
      if (normalized.includes("publish_due_expire")) {
        return {
          rowCount: 1,
          rows: [{
            expired_targets: 0,
            expired_slots: 0,
            recovered_published: 0,
            result_unknown: 0,
            ...input.expiry,
          }],
        };
      }
      if (normalized.includes("publish_due_queue_delayed")) {
        return { rowCount: 1, rows: [{ queued: 0 }] };
      }
      if (normalized.includes("publish_due_candidates")) {
        return {
          rowCount: input.candidates?.length ?? 0,
          rows: input.candidates ?? [],
        };
      }
      throw new Error(`unexpected query: ${normalized}`);
    }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(async () => client) };
  const claimQueueItem = vi.fn(async (_client: unknown, queueId: string) => (
    input.claim ? input.claim(queueId) : { queueId, context: { id: queueId } }
  ));
  return { pool, client, events, claimQueueItem, get transactionOpen() { return transactionOpen; } };
}

describe("publish due run", () => {
  it("keeps 23:58:59.999 KST publishable and expires at exactly 23:59:00.000 KST", () => {
    const scheduledFor = new Date("2026-08-26T11:30:00+09:00");

    expect(hasReachedKstReservationExpiry(scheduledFor, new Date("2026-08-26T23:58:59.999+09:00"))).toBe(false);
    expect(hasReachedKstReservationExpiry(scheduledFor, new Date("2026-08-26T23:59:00.000+09:00"))).toBe(true);
  });

  it("never auto-retries a started calendar target at 23:59 or on a later KST day", () => {
    const scheduledFor = new Date("2026-08-26T11:30:00+09:00");

    expect(canAutoRetryCalendarPublish(scheduledFor, new Date("2026-08-26T23:58:59.999+09:00"))).toBe(true);
    expect(canAutoRetryCalendarPublish(scheduledFor, new Date("2026-08-26T23:59:00.000+09:00"))).toBe(false);
    expect(canAutoRetryCalendarPublish(scheduledFor, new Date("2026-08-27T00:00:00.000+09:00"))).toBe(false);
    expect(canAutoRetryCalendarPublish(null, new Date("2026-08-27T00:00:00.000+09:00"))).toBe(true);
  });

  it("returns zero counts without selecting or mutating when the singleton lock is unavailable", async () => {
    const fixture = dueHarness({ acquired: false });
    const dispatch = vi.fn();

    await expect(runPublishDue({
      pool: fixture.pool as any,
      now: new Date("2026-08-26T23:59:00+09:00"),
      claimQueueItem: fixture.claimQueueItem,
      dispatchClaim: dispatch,
    })).resolves.toEqual({
      acquired: false,
      expiredTargets: 0,
      expiredSlots: 0,
      dueQueued: 0,
      published: 0,
      failed: 0,
      resultUnknown: 0,
    });

    expect(fixture.events).toHaveLength(3);
    expect(fixture.events[0]).toBe("begin");
    expect(fixture.events[1]).toContain("pg_try_advisory_xact_lock");
    expect(fixture.events[2]).toBe("commit");
    expect(fixture.claimQueueItem).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("expires before fair due selection, claims atomically, and commits before provider dispatch", async () => {
    const fixture = dueHarness({
      expiry: { expired_targets: 3, expired_slots: 1 },
      candidates: [
        { id: "queue-brand-a", brand_id: "brand-a" },
        { id: "queue-brand-b", brand_id: "brand-b" },
      ],
    });
    const dispatch = vi.fn(async () => {
      expect(fixture.transactionOpen).toBe(false);
      return { status: "published" };
    });

    await expect(runPublishDue({
      pool: fixture.pool as any,
      now: new Date("2026-08-26T23:59:00+09:00"),
      batchSize: 2,
      concurrency: 1,
      claimQueueItem: fixture.claimQueueItem,
      dispatchClaim: dispatch,
    })).resolves.toEqual({
      acquired: true,
      expiredTargets: 3,
      expiredSlots: 1,
      dueQueued: 2,
      published: 2,
      failed: 0,
      resultUnknown: 0,
    });

    const expiryIndex = fixture.events.findIndex((sql) => sql.includes("publish_due_expire"));
    const dueIndex = fixture.events.findIndex((sql) => sql.includes("publish_due_candidates"));
    const commitIndex = fixture.events.indexOf("commit");
    expect(expiryIndex).toBeGreaterThan(0);
    expect(dueIndex).toBeGreaterThan(expiryIndex);
    expect(commitIndex).toBeGreaterThan(dueIndex);
    expect(fixture.claimQueueItem).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("preserves started, completed, failed-after-start, and result-unknown targets in the expiry SQL", async () => {
    const fixture = dueHarness({ expiry: { expired_targets: 1, expired_slots: 0 } });

    await runPublishDue({
      pool: fixture.pool as any,
      now: new Date("2026-08-26T23:59:00+09:00"),
      claimQueueItem: fixture.claimQueueItem,
      dispatchClaim: vi.fn(),
    });

    const expirySql = fixture.events.find((sql) => sql.includes("publish_due_expire")) ?? "";
    expect(expirySql).toContain("reservation_expired_at_2359_kst");
    expect(expirySql).toContain("publishing_started_at is null");
    expect(expirySql).toContain("published_at is null");
    expect(expirySql).toContain("publish_delivery_unknown");
    expect(expirySql).toContain("publish_attempts");
    expect(expirySql).toContain("not exists");
  });

  it("preserves original scheduled time and records delayed effective time separately", async () => {
    const fixture = dueHarness({ candidates: [] });
    const now = new Date("2026-08-26T23:58:59.999+09:00");

    await runPublishDue({
      pool: fixture.pool as any,
      now,
      claimQueueItem: fixture.claimQueueItem,
      dispatchClaim: vi.fn(),
    });

    const delayedSql = fixture.events.find((sql) => sql.includes("publish_due_queue_delayed")) ?? "";
    expect(delayedSql).toContain("scheduled_for=slot.scheduled_for");
    expect(delayedSql).toContain("deferred_until=case");
    expect(delayedSql).toContain("then $1::timestamptz else null end");
    expect(delayedSql).not.toContain("scheduled_for=$1::timestamptz");
  });

  it("bounds fair batches across ten brands and limits slow provider concurrency", async () => {
    const candidates = Array.from({ length: 10 }, (_, index) => ({
      id: `queue-${index + 1}`,
      brand_id: `brand-${index + 1}`,
    }));
    const fixture = dueHarness({ candidates });
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const dispatch = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return { status: "published" };
    });

    const running = runPublishDue({
      pool: fixture.pool as any,
      now: new Date("2026-08-26T20:00:00+09:00"),
      batchSize: 10,
      concurrency: 2,
      claimQueueItem: fixture.claimQueueItem,
      dispatchClaim: dispatch,
    });
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));
    for (let completed = 0; completed < 10; completed += 1) {
      await vi.waitFor(() => expect(releases.length).toBeGreaterThan(0));
      releases.shift()!();
    }

    const result = await running;
    expect(result.dueQueued).toBe(10);
    expect(result.published).toBe(10);
    expect(peak).toBe(2);
    const dueSql = fixture.events.find((sql) => sql.includes("publish_due_candidates")) ?? "";
    expect(dueSql).toContain("partition by queue.brand_id");
    expect(dueSql).toContain("order by brand_rank");
    expect(dueSql).toContain("limit $2::integer");
  });

  it("does not reclaim rows atomically claimed by a first tick whose provider is still slow", async () => {
    const claimed = new Set<string>();
    const first = dueHarness({
      candidates: [{ id: "queue-1" }],
      claim: (id) => {
        if (claimed.has(id)) return null;
        claimed.add(id);
        return { queueId: id, context: { id } };
      },
    });
    let release!: () => void;
    const providerPending = new Promise<void>((resolve) => { release = resolve; });
    const firstRun = runPublishDue({
      pool: first.pool as any,
      claimQueueItem: first.claimQueueItem,
      dispatchClaim: async () => {
        await providerPending;
        return { status: "published" };
      },
    });
    await vi.waitFor(() => expect(first.transactionOpen).toBe(false));

    const second = dueHarness({
      candidates: [{ id: "queue-1" }],
      claim: (id) => claimed.has(id) ? null : { queueId: id, context: { id } },
    });
    await expect(runPublishDue({
      pool: second.pool as any,
      claimQueueItem: second.claimQueueItem,
      dispatchClaim: vi.fn(),
    })).resolves.toMatchObject({ acquired: true, dueQueued: 0 });

    release();
    await firstRun;
  });

  it("separates provider failures from unknown results", async () => {
    const fixture = dueHarness({
      expiry: { result_unknown: 1 },
      candidates: [{ id: "failed" }, { id: "unknown" }],
    });
    const dispatch = vi.fn(async (claim: PublishDueClaim) => {
      if (claim.queueId === "unknown") throw new Error("publish_delivery_unknown");
      throw new Error("provider_rejected");
    });

    await expect(runPublishDue({
      pool: fixture.pool as any,
      claimQueueItem: fixture.claimQueueItem,
      dispatchClaim: dispatch,
      concurrency: 2,
    })).resolves.toMatchObject({
      published: 0,
      failed: 1,
      resultUnknown: 2,
    });
  });
});
