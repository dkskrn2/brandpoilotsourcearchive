import { describe, expect, it, vi } from "vitest";
import { automaticSlotKey, batchSlotIdentity, manualSlotIdentity } from "./publishCalendarIdempotency.js";
import { createPublishCalendarRepository } from "./publishCalendarRepository.js";

type QueryResult = { rows: Array<Record<string, unknown>>; rowCount?: number };

function harness(handler: (sql: string, values: unknown[]) => QueryResult | Promise<QueryResult>) {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const query = vi.fn(async (rawSql: unknown, values: unknown[] = []) => {
    const sql = String(rawSql).replace(/\s+/g, " ").trim();
    statements.push({ sql, values });
    if (/^(begin|commit|rollback)$/i.test(sql)
      || sql.includes("assert_ai_content_writable")
      || sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 0 };
    return handler(sql, values);
  });
  const client = { query, release: vi.fn() };
  const pool = { query, connect: vi.fn(async () => client) };
  return { pool: pool as never, statements };
}

const scope = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  brandId: "20000000-0000-4000-8000-000000000001",
};

const slotRow = (overrides: Record<string, unknown> = {}) => ({
  id: "30000000-0000-4000-8000-000000000001",
  workspace_id: scope.workspaceId,
  brand_id: scope.brandId,
  scheduled_for: "2099-08-15T02:30:00Z",
  assignment_mode: "automatic",
  status: "open",
  recommendation_kind: "informational",
  content_format: "card_news",
  channels: ["instagram"],
  content_suggestion_id: null,
  proposal_id: null,
  generation_id: null,
  generation_output_id: null,
  topic_publish_group_id: null,
  idempotency_key: null,
  title: null,
  last_error: null,
  updated_at: "2026-08-13T00:00:00Z",
  ...overrides,
});

function activeSubscription(sql: string): QueryResult | null {
  if (!sql.includes("from brand_subscriptions subscription")) return null;
  return {
    rows: [{
      started_at: "2026-08-02T00:37:00Z",
      weekly_generation_limit: 10,
      weekly_publish_limit: 3,
    }],
    rowCount: 1,
  };
}

describe("publish calendar repository settings and slot validation", () => {
  it("reads normalized weekly settings under the brand lock in deterministic order without slot_times", async () => {
    const run = harness((sql) => {
      if (sql.startsWith("select enabled,channels,informational_format,trend_format,updated_at")) {
        return {
          rows: [{
            enabled: true,
            channels: ["instagram"],
            informational_format: "card_news",
            trend_format: "reel",
            updated_at: "2026-08-26T00:00:00Z",
          }],
          rowCount: 1,
        };
      }
      if (sql.startsWith("select id,day_of_week,slot_time,sort_order")) {
        return {
          rows: [
            { id: "30000000-0000-4000-8000-000000000002", day_of_week: 1, slot_time: "11:30:00", sort_order: 0 },
            { id: "30000000-0000-4000-8000-000000000001", day_of_week: 1, slot_time: "11:30:00", sort_order: 1 },
            { id: "30000000-0000-4000-8000-000000000003", day_of_week: 7, slot_time: "09:05:00", sort_order: 0 },
          ],
          rowCount: 3,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(createPublishCalendarRepository(run.pool).getWeeklySettings(scope)).resolves.toEqual({
      brandId: scope.brandId,
      enabled: true,
      channels: ["instagram"],
      informationalFormat: "card_news",
      trendFormat: "reel",
      weeklySchedule: [
        { id: "30000000-0000-4000-8000-000000000002", dayOfWeek: 1, time: "11:30", sortOrder: 0 },
        { id: "30000000-0000-4000-8000-000000000001", dayOfWeek: 1, time: "11:30", sortOrder: 1 },
        { id: "30000000-0000-4000-8000-000000000003", dayOfWeek: 7, time: "09:05", sortOrder: 0 },
      ],
      updatedAt: "2026-08-26T00:00:00.000Z",
    });
    expect(run.statements.map(({ sql }) => sql)).toEqual(expect.arrayContaining([
      expect.stringContaining("pg_advisory_xact_lock"),
      expect.stringContaining("order by day_of_week,sort_order,id"),
    ]));
    expect(run.statements.some(({ sql }) => sql.includes("slot_times"))).toBe(false);
  });

  it("validates weekly rows, ON prerequisites, server caps, and the active plan limit", async () => {
    const base = {
      ...scope,
      enabled: false,
      channels: [] as "instagram"[],
      informationalFormat: "card_news" as const,
      trendFormat: "reel" as const,
    };
    const repository = createPublishCalendarRepository(harness(() => ({ rows: [], rowCount: 0 })).pool);
    await expect(repository.saveWeeklySettings({ ...base, weeklySchedule: [
      { id: null, dayOfWeek: 0 as 1, time: "11:30", sortOrder: 0 },
    ] })).rejects.toThrowError("publish_calendar_day_invalid");
    await expect(repository.saveWeeklySettings({ ...base, weeklySchedule: [
      { id: null, dayOfWeek: 1, time: "24:00", sortOrder: 0 },
    ] })).rejects.toThrowError("publish_calendar_time_invalid");
    await expect(repository.saveWeeklySettings({ ...base, weeklySchedule: [
      { id: null, dayOfWeek: 1, time: "11:30", sortOrder: -1 },
    ] })).rejects.toThrowError("publish_calendar_sort_order_invalid");
    const oversizedSort = harness(() => ({ rows: [], rowCount: 0 }));
    await expect(createPublishCalendarRepository(oversizedSort.pool).saveWeeklySettings({
      ...base,
      weeklySchedule: [{ id: null, dayOfWeek: 1, time: "11:30", sortOrder: 2_147_483_648 }],
    })).rejects.toThrowError("publish_calendar_sort_order_invalid");
    expect(oversizedSort.statements).toEqual([]);
    await expect(repository.saveWeeklySettings({ ...base, weeklySchedule: [
      { id: null, dayOfWeek: 1, time: "11:30", sortOrder: 0 },
      { id: null, dayOfWeek: 1, time: "12:30", sortOrder: 0 },
    ] })).rejects.toThrowError("publish_calendar_sort_order_invalid");
    await expect(repository.saveWeeklySettings({ ...base, weeklySchedule: Array.from({ length: 25 }, (_, sortOrder) => ({
      id: null, dayOfWeek: 1 as const, time: "11:30", sortOrder,
    })) })).rejects.toThrowError("publish_calendar_schedule_limit_exceeded");
    await expect(repository.saveWeeklySettings({ ...base, enabled: true, weeklySchedule: [] }))
      .rejects.toThrowError("publish_calendar_settings_incomplete");
    await expect(repository.saveWeeklySettings({
      ...base,
      enabled: true,
      channels: ["instagram"],
      weeklySchedule: [],
    })).rejects.toThrowError("publish_calendar_settings_incomplete");

    const limited = harness((sql) => {
      if (sql.startsWith("select enabled,channels,informational_format,trend_format,updated_at")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("from brand_subscriptions subscription")) {
        return { rows: [{ started_at: "2026-08-01T00:00:00Z", weekly_generation_limit: 30, weekly_publish_limit: 30 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    await expect(createPublishCalendarRepository(limited.pool).saveWeeklySettings({
      ...base,
      weeklySchedule: Array.from({ length: 31 }, (_, index) => ({
        id: null,
        dayOfWeek: (index % 7 + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7,
        time: "11:30",
        sortOrder: Math.floor(index / 7),
      })),
    })).rejects.toThrowError("publish_calendar_publish_limit_exceeded");
  });

  it("preserves a disconnected existing channel while OFF but rejects a newly disconnected selection", async () => {
    const weeklySchedule = [{ id: null, dayOfWeek: 1 as const, time: "11:30", sortOrder: 0 }];
    const existing = harness((sql) => {
      if (sql.startsWith("select enabled,channels,informational_format,trend_format,updated_at")) {
        return { rows: [{ enabled: false, channels: ["instagram"], informational_format: "card_news", trend_format: "reel", updated_at: "2026-08-26" }], rowCount: 1 };
      }
      if (sql.startsWith("select id,workspace_id,brand_id,day_of_week")) return { rows: [], rowCount: 0 };
      if (sql.includes("from brand_subscriptions subscription")) {
        return { rows: [{ started_at: "2026-08-01", weekly_generation_limit: 30, weekly_publish_limit: 30 }], rowCount: 1 };
      }
      if (sql.includes("from brand_channels")) return { rows: [], rowCount: 0 };
      if (sql.startsWith("insert into publish_calendar_settings")) {
        return { rows: [{ enabled: false, channels: ["instagram"], informational_format: "card_news", trend_format: "reel", updated_at: "2026-08-26" }], rowCount: 1 };
      }
      if (sql.startsWith("insert into publish_calendar_weekly_schedule_entries")) {
        return { rows: [{ id: "30000000-0000-4000-8000-000000000001", day_of_week: 1, slot_time: "11:30", sort_order: 0 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    await expect(createPublishCalendarRepository(existing.pool).saveWeeklySettings({
      ...scope,
      enabled: false,
      channels: ["instagram"],
      informationalFormat: "card_news",
      trendFormat: "reel",
      weeklySchedule,
    })).resolves.toMatchObject({ channels: ["instagram"] });

    const newlySelected = harness((sql) => {
      if (sql.startsWith("select enabled,channels,informational_format,trend_format,updated_at")) return { rows: [], rowCount: 0 };
      if (sql.startsWith("select id,workspace_id,brand_id,day_of_week")) return { rows: [], rowCount: 0 };
      if (sql.includes("from brand_subscriptions subscription")) {
        return { rows: [{ started_at: "2026-08-01", weekly_generation_limit: 30, weekly_publish_limit: 30 }], rowCount: 1 };
      }
      if (sql.includes("from brand_channels")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    await expect(createPublishCalendarRepository(newlySelected.pool).saveWeeklySettings({
      ...scope,
      enabled: false,
      channels: ["instagram"],
      informationalFormat: "card_news",
      trendFormat: "reel",
      weeklySchedule,
    })).rejects.toThrowError("publish_calendar_channel_not_connected");
  });

  it("saves weekly configuration with the enabled value read under the brand lock", async () => {
    const scheduleId = "30000000-0000-4000-8000-000000000001";
    const run = harness((sql, values) => {
      if (sql.startsWith("select enabled,channels,informational_format,trend_format,updated_at")) {
        return {
          rows: [{
            enabled: true,
            channels: ["instagram"],
            informational_format: "card_news",
            trend_format: "reel",
            updated_at: "2026-08-26T00:00:00Z",
          }],
          rowCount: 1,
        };
      }
      if (sql.startsWith("select id,workspace_id,brand_id,day_of_week")) {
        return {
          rows: [{ id: scheduleId, workspace_id: scope.workspaceId, brand_id: scope.brandId, day_of_week: 1, slot_time: "11:30", sort_order: 0 }],
          rowCount: 1,
        };
      }
      if (sql.includes("from brand_subscriptions subscription")) return activeSubscription(sql)!;
      if (sql.includes("from brand_channels")) return { rows: [{ channel: "instagram" }], rowCount: 1 };
      if (sql.startsWith("insert into publish_calendar_settings")) {
        expect(values[2]).toBe(true);
        return {
          rows: [{ enabled: true, channels: ["instagram"], informational_format: "reel", trend_format: "card_news", updated_at: "2026-08-27T00:00:00Z" }],
          rowCount: 1,
        };
      }
      if (sql.startsWith("update publish_calendar_weekly_schedule_entries")) return { rows: [], rowCount: 1 };
      if (sql.startsWith("delete from publish_calendar_weekly_schedule_entries")) return { rows: [], rowCount: 0 };
      if (sql.startsWith("select id,day_of_week,slot_time,sort_order")) {
        return { rows: [{ id: scheduleId, day_of_week: 2, slot_time: "12:30", sort_order: 0 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(createPublishCalendarRepository(run.pool).saveWeeklyConfiguration({
      ...scope,
      channels: ["instagram"],
      informationalFormat: "reel",
      trendFormat: "card_news",
      weeklySchedule: [{ id: scheduleId, dayOfWeek: 2, time: "12:30", sortOrder: 0 }],
    })).resolves.toMatchObject({ enabled: true, informationalFormat: "reel", trendFormat: "card_news" });

    const statements = run.statements.map(({ sql }) => sql);
    expect(statements.findIndex((sql) => sql.includes("pg_advisory_xact_lock")))
      .toBeLessThan(statements.findIndex((sql) => sql.startsWith("select enabled,")));
    expect(statements.find((sql) => sql.startsWith("select enabled,"))).toContain("for update");
  });

  it("turns weekly publishing OFF without plan or channel validation and without rewriting configuration", async () => {
    const scheduleId = "30000000-0000-4000-8000-000000000001";
    const run = harness((sql) => {
      if (sql.startsWith("select enabled,channels,informational_format,trend_format,updated_at")) {
        return {
          rows: [{ enabled: true, channels: ["instagram"], informational_format: "reel", trend_format: "card_news", updated_at: "2026-08-26T00:00:00Z" }],
          rowCount: 1,
        };
      }
      if (sql.startsWith("select id,day_of_week,slot_time,sort_order")) {
        return { rows: [{ id: scheduleId, day_of_week: 2, slot_time: "12:30", sort_order: 0 }], rowCount: 1 };
      }
      if (sql.startsWith("insert into publish_calendar_settings")) {
        return {
          rows: [{ enabled: false, channels: ["instagram"], informational_format: "reel", trend_format: "card_news", updated_at: "2026-08-27T00:00:00Z" }],
          rowCount: 1,
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    await expect(createPublishCalendarRepository(run.pool).setWeeklyEnabled({ ...scope, enabled: false }))
      .resolves.toEqual({
        brandId: scope.brandId,
        enabled: false,
        channels: ["instagram"],
        informationalFormat: "reel",
        trendFormat: "card_news",
        weeklySchedule: [{ id: scheduleId, dayOfWeek: 2, time: "12:30", sortOrder: 0 }],
        updatedAt: "2026-08-27T00:00:00.000Z",
      });

    const sql = run.statements.map((statement) => statement.sql).join("\n");
    expect(sql).not.toContain("from brand_subscriptions subscription");
    expect(sql).not.toContain("from brand_channels");
    expect(sql).not.toContain("update publish_calendar_weekly_schedule_entries");
    expect(sql).not.toContain("delete from publish_calendar_weekly_schedule_entries");
    const settingsWrite = run.statements.find(({ sql: statement }) => statement.startsWith("insert into publish_calendar_settings"))!.sql;
    expect(settingsWrite).not.toContain("channels=excluded.channels");
    expect(settingsWrite).not.toContain("informational_format=excluded.informational_format");
    expect(settingsWrite).not.toContain("trend_format=excluded.trend_format");
  });

  it("turns weekly publishing ON only with a saved row and a currently connected supported selected channel", async () => {
    const scheduleId = "30000000-0000-4000-8000-000000000001";
    const connected = harness((sql) => {
      if (sql.startsWith("select enabled,channels,informational_format,trend_format,updated_at")) {
        return { rows: [{ enabled: false, channels: ["instagram"], informational_format: "card_news", trend_format: "reel", updated_at: null }], rowCount: 1 };
      }
      if (sql.startsWith("select id,day_of_week,slot_time,sort_order")) {
        return { rows: [{ id: scheduleId, day_of_week: 1, slot_time: "11:30", sort_order: 0 }], rowCount: 1 };
      }
      if (sql.includes("from brand_channels")) return { rows: [{ channel: "instagram" }], rowCount: 1 };
      if (sql.startsWith("insert into publish_calendar_settings")) {
        return { rows: [{ enabled: true, channels: ["instagram"], informational_format: "card_news", trend_format: "reel", updated_at: "2026-08-27T00:00:00Z" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    await expect(createPublishCalendarRepository(connected.pool).setWeeklyEnabled({ ...scope, enabled: true }))
      .resolves.toMatchObject({ enabled: true, weeklySchedule: [{ id: scheduleId }] });
    expect(connected.statements.some(({ sql }) => sql.includes("from brand_subscriptions subscription"))).toBe(false);

    const incomplete = harness((sql) => {
      if (sql.startsWith("select enabled,channels,informational_format,trend_format,updated_at")) {
        return { rows: [{ enabled: false, channels: ["instagram"], informational_format: "card_news", trend_format: "reel", updated_at: null }], rowCount: 1 };
      }
      if (sql.startsWith("select id,day_of_week,slot_time,sort_order")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    await expect(createPublishCalendarRepository(incomplete.pool).setWeeklyEnabled({ ...scope, enabled: true }))
      .rejects.toThrowError("publish_calendar_settings_incomplete");
  });

  it("returns the effective queue time without replacing the original slot reservation", async () => {
    const run = harness((sql) => sql.includes("queue_schedule.effective_scheduled_for") ? { rows: [slotRow({ effective_scheduled_for: "2099-08-15T03:30:00Z" })], rowCount: 1 } : { rows: [], rowCount: 0 });
    await expect(createPublishCalendarRepository(run.pool).listSlots({ ...scope, startsAt: new Date("2099-08-01T00:00:00Z"), endsAt: new Date("2099-09-01T00:00:00Z") })).resolves.toEqual([
      expect.objectContaining({ scheduledFor: "2099-08-15T02:30:00.000Z", effectiveScheduledFor: "2099-08-15T03:30:00.000Z" }),
    ]);
    expect(run.statements[0]?.sql).toContain("queue.status in ('scheduled','publishing','deferred')");
  });

  it("returns default-off settings and persists up to 24 connected Instagram times", async () => {
    const times = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);
    const run = harness((sql) => {
      if (sql.startsWith("select * from publish_calendar_settings")) return { rows: [], rowCount: 0 };
      if (sql.includes("from brand_channels")) return { rows: [{ channel: "instagram" }], rowCount: 1 };
      if (sql.startsWith("insert into publish_calendar_settings")) return {
        rows: [{
          brand_id: scope.brandId,
          enabled: true,
          channels: ["instagram"],
          informational_format: "card_news",
          trend_format: "reel",
          slot_times: times.map((value) => `${value}:00`),
          updated_at: "2026-08-13T00:00:00Z",
        }],
        rowCount: 1,
      };
      return { rows: [], rowCount: 0 };
    });
    const repository = createPublishCalendarRepository(run.pool);

    await expect(repository.getSettings(scope)).resolves.toMatchObject({
      brandId: scope.brandId,
      enabled: false,
      channels: [],
    });
    await expect(repository.saveSettings({
      ...scope,
      enabled: true,
      channels: ["instagram"],
      informationalFormat: "card_news",
      trendFormat: "reel",
      slotTimes: times,
    })).resolves.toMatchObject({ enabled: true, channels: ["instagram"], slotTimes: times });
  });

  it("preserves duplicate and nearby automatic slot times", async () => {
    const values = ["09:00", "09:00", "09:29", "23:45", "00:00"];
    const run = harness((sql, parameters) => sql.startsWith("insert into publish_calendar_settings")
      ? {
          rows: [{
            brand_id: scope.brandId,
            enabled: false,
            channels: [],
            informational_format: "card_news",
            trend_format: "reel",
            slot_times: parameters[6],
            updated_at: "2026-08-13T00:00:00Z",
          }],
          rowCount: 1,
        }
      : { rows: [], rowCount: 0 });
    const repository = createPublishCalendarRepository(run.pool);
    const input = {
      ...scope,
      enabled: false,
      channels: [] as "instagram"[],
      informationalFormat: "card_news" as const,
      trendFormat: "reel" as const,
    };

    await expect(repository.saveSettings({ ...input, slotTimes: values }))
      .resolves.toMatchObject({ slotTimes: values });
  });

  it("still rejects malformed, empty, or more than 24 slot times", async () => {
    const repository = createPublishCalendarRepository(harness(() => ({ rows: [], rowCount: 0 })).pool);
    const input = {
      ...scope,
      enabled: false,
      channels: [] as "instagram"[],
      informationalFormat: "card_news" as const,
      trendFormat: "reel" as const,
    };
    await expect(repository.saveSettings({ ...input, slotTimes: [] }))
      .rejects.toThrowError("publish_calendar_time_invalid");
    await expect(repository.saveSettings({ ...input, slotTimes: ["24:00"] }))
      .rejects.toThrowError("publish_calendar_time_invalid");
    await expect(repository.saveSettings({
      ...input,
      slotTimes: Array.from({ length: 25 }, (_, index) => `${String(index % 24).padStart(2, "0")}:01`),
    })).rejects.toThrowError("publish_calendar_time_invalid");
  });

  it("rejects unsupported calendar channels even while automatic settings are disabled", async () => {
    const run = harness(() => ({ rows: [], rowCount: 0 }));
    await expect(createPublishCalendarRepository(run.pool).saveSettings({
      ...scope,
      enabled: false,
      channels: ["x"],
      informationalFormat: "card_news",
      trendFormat: "reel",
      slotTimes: ["11:30"],
    })).rejects.toThrowError("publish_calendar_channel_invalid");
    expect(run.statements).toEqual([]);
  });

  it("creates a future open slot under the brand lock without reserving exhausted quota", async () => {
    const run = harness((sql) => {
      if (sql.includes("clock_timestamp()")) return { rows: [{ future: true }], rowCount: 1 };
      if (sql.includes("from brand_channels")) return { rows: [{ channel: "instagram" }], rowCount: 1 };
      const subscription = activeSubscription(sql);
      if (subscription) return subscription;
      if (sql.includes("calendar_usage") && sql.includes("direct_publish_groups")) {
        return { rows: [{ published_count: 3, reserved_count: 0 }], rowCount: 1 };
      }
      if (sql.startsWith("insert into publish_calendar_slots")) return { rows: [slotRow()], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const repository = createPublishCalendarRepository(run.pool);

    await expect(repository.createSlot({
      ...scope,
      scheduledFor: new Date("2099-08-15T11:30:00+09:00"),
      assignmentMode: "automatic",
      recommendationKind: "informational",
      contentFormat: "card_news",
      channels: ["instagram"],
      idempotencyKey: automaticSlotKey({ kstDate: "2099-08-15", time: "11:30", occurrence: 0 }),
    })).resolves.toMatchObject({ status: "open", contentSuggestionId: null });

    const sql = run.statements.map(({ sql }) => sql);
    expect(sql.findIndex((value) => value.includes("pg_advisory_xact_lock")))
      .toBeLessThan(sql.findIndex((value) => value.includes("from brand_subscriptions subscription")));
  });

  it("stores an internal automatic key without applying customer spacing", async () => {
    const run = harness((sql, values) => {
      if (sql.includes("idempotency_key=$3::text")) return { rows: [], rowCount: 0 };
      if (sql.includes("clock_timestamp()")) return { rows: [{ future: true }], rowCount: 1 };
      if (sql.includes("from brand_channels")) return { rows: [{ channel: "instagram" }], rowCount: 1 };
      if (sql.includes("abs(extract(epoch")) throw new Error("automatic_spacing_must_be_bypassed");
      const subscription = activeSubscription(sql);
      if (subscription) return subscription;
      if (sql.includes("calendar_usage") && sql.includes("direct_publish_groups")) {
        return { rows: [{ published_count: 0, reserved_count: 0 }], rowCount: 1 };
      }
      if (sql.startsWith("insert into publish_calendar_slots")) return {
        rows: [slotRow({ idempotency_key: values[8] })],
        rowCount: 1,
      };
      throw new Error(`unexpected query: ${sql}`);
    });
    const idempotencyKey = automaticSlotKey({ kstDate: "2099-08-15", time: "11:30", occurrence: 1 });

    await expect(createPublishCalendarRepository(run.pool).createSlot({
      ...scope,
      scheduledFor: new Date("2099-08-15T11:30:00+09:00"),
      assignmentMode: "automatic",
      recommendationKind: "trend",
      contentFormat: "reel",
      channels: ["instagram"],
      idempotencyKey,
    })).resolves.toMatchObject({ idempotencyKey });

    const insert = run.statements.find(({ sql }) => sql.startsWith("insert into publish_calendar_slots"));
    expect(insert?.sql).toContain("idempotency_key");
    expect(insert?.sql).toContain("on conflict(brand_id,idempotency_key)");
  });

  it("returns an existing automatic key before time, channel, and quota checks", async () => {
    const idempotencyKey = automaticSlotKey({ kstDate: "2000-01-01", time: "11:30", occurrence: 0 });
    const run = harness((sql) => {
      if (sql.includes("idempotency_key=$3::text")) return {
        rows: [slotRow({
          scheduled_for: "2000-01-01T02:30:00.000Z",
          idempotency_key: idempotencyKey,
        })],
        rowCount: 1,
      };
      throw new Error(`mutable policy must not run during replay: ${sql}`);
    });

    await expect(createPublishCalendarRepository(run.pool).createSlot({
      ...scope,
      scheduledFor: new Date("2000-01-01T11:30:00+09:00"),
      assignmentMode: "automatic",
      recommendationKind: "trend",
      contentFormat: "reel",
      channels: ["instagram"],
      idempotencyKey,
    })).resolves.toMatchObject({ idempotencyKey, scheduledFor: "2000-01-01T02:30:00.000Z" });

    expect(run.statements.some(({ sql }) => sql.includes("clock_timestamp()"))).toBe(false);
    expect(run.statements.some(({ sql }) => sql.includes("from brand_channels"))).toBe(false);
  });

  it("rechecks future time with the database clock after waiting for the brand lock", async () => {
    const run = harness((sql) => {
      if (sql.includes("clock_timestamp()")) return { rows: [{ future: false }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const repository = createPublishCalendarRepository(run.pool);

    await expect(repository.createSlot({
      ...scope,
      scheduledFor: new Date("2099-08-15T11:30:00+09:00"),
      assignmentMode: "automatic",
      recommendationKind: "informational",
      contentFormat: "card_news",
      channels: ["instagram"],
      idempotencyKey: automaticSlotKey({ kstDate: "2099-08-15", time: "11:30", occurrence: 0 }),
    })).rejects.toThrowError("publish_calendar_time_past");

    const sql = run.statements.map(({ sql }) => sql);
    const lockIndex = sql.findIndex((value) => value.includes("pg_advisory_xact_lock"));
    const futureCheckIndex = sql.findIndex((value) => value.includes("clock_timestamp()"));
    expect(lockIndex).toBeGreaterThan(-1);
    expect(futureCheckIndex).toBeGreaterThan(lockIndex);
    expect(sql.some((value) => value.includes("from brand_channels"))).toBe(false);
    expect(sql.some((value) => value.startsWith("insert into publish_calendar_slots"))).toBe(false);
  });

  it("rejects a past automatic slot, a disconnected channel, and an inactive subscription", async () => {
    const disconnected = createPublishCalendarRepository(harness((sql, values) => sql.includes("clock_timestamp()")
      ? { rows: [{ future: new Date(values[0] as Date).getUTCFullYear() > 2020 }], rowCount: 1 }
      : { rows: [], rowCount: 0 }).pool);
    await expect(disconnected.createSlot({
      ...scope,
      scheduledFor: new Date("2020-01-01T00:00:00Z"),
      assignmentMode: "automatic",
      recommendationKind: "informational",
      contentFormat: "card_news",
      channels: ["instagram"],
      idempotencyKey: automaticSlotKey({ kstDate: "2020-01-01", time: "09:00", occurrence: 0 }),
    })).rejects.toThrowError("publish_calendar_time_past");
    await expect(disconnected.createSlot({
      ...scope,
      scheduledFor: new Date("2099-01-01T00:00:00Z"),
      assignmentMode: "automatic",
      recommendationKind: "informational",
      contentFormat: "card_news",
      channels: ["instagram"],
      idempotencyKey: automaticSlotKey({ kstDate: "2099-01-01", time: "09:00", occurrence: 0 }),
    })).rejects.toThrowError("publish_calendar_channel_not_connected");

    const inactiveRun = harness((sql) => {
      if (sql.includes("clock_timestamp()")) return { rows: [{ future: true }], rowCount: 1 };
      return sql.includes("from brand_channels")
        ? { rows: [{ channel: "instagram" }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    });
    await expect(createPublishCalendarRepository(inactiveRun.pool).createSlot({
      ...scope,
      scheduledFor: new Date("2099-01-01T00:00:00Z"),
      assignmentMode: "automatic",
      recommendationKind: "informational",
      contentFormat: "card_news",
      channels: ["instagram"],
      idempotencyKey: automaticSlotKey({ kstDate: "2099-01-01", time: "09:00", occurrence: 1 }),
    })).rejects.toThrowError("publish_calendar_subscription_inactive");
  });
});

describe("publish calendar manual provisioning catalogs", () => {
  it("returns only brand-scoped active database choices and server-supported formats", async () => {
    const run = harness((sql, values) => {
      if (sql.includes("from brand_channels")) return {
        rows: [{ channel: "instagram" }],
        rowCount: 1,
      };
      if (sql.includes("from product_services item")) return {
        rows: [{ id: "product-1", label: "사장님 SNS 컨설팅" }],
        rowCount: 1,
      };
      if (sql.includes("from content_suggestions suggestion")) return {
        rows: [{ id: "suggestion-1", label: "매출로 이어지는 SNS 콘텐츠", intent: "informational" }],
        rowCount: 1,
      };
      if (sql.includes("from reference_items item")) return {
        rows: [{ id: "reference-1", label: "SNS 마케팅 사례" }],
        rowCount: 1,
      };
      const subscription = activeSubscription(sql);
      if (subscription) return subscription;
      if (sql.includes("calendar_usage") && sql.includes("direct_publish_groups")) {
        return { rows: [{ published_count: 0, reserved_count: 1 }], rowCount: 1 };
      }
      if (sql.includes("from net join ai_content_generations generation")) {
        return { rows: [{ succeeded_count: 2, reserved_count: 0 }], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql} ${JSON.stringify(values)}`);
    });
    const repository = createPublishCalendarRepository(run.pool) as ReturnType<typeof createPublishCalendarRepository> & {
      getManualOptions(input: typeof scope): Promise<Record<string, unknown>>;
    };

    await expect(repository.getManualOptions(scope)).resolves.toMatchObject({
      purposes: [
        { value: "informational", label: "정보성" },
        { value: "marketing", label: "마케팅성" },
      ],
      channels: [{
        value: "instagram",
        label: "Instagram",
        formats: [
          { value: "card_news", label: "카드뉴스" },
          { value: "reel", label: "릴스" },
        ],
      }],
      products: [{ value: "product-1", label: "사장님 SNS 컨설팅" }],
      suggestions: [{ value: "suggestion-1", label: "매출로 이어지는 SNS 콘텐츠", intent: "informational" }],
      references: [{ value: "reference-1", label: "SNS 마케팅 사례" }],
      usage: { publishing: { reserved: 1 } },
    });

    for (const table of ["product_services item", "content_suggestions suggestion", "reference_items item"]) {
      const statement = run.statements.find(({ sql }) => sql.includes(`from ${table}`));
      expect(statement?.values).toEqual([scope.workspaceId, scope.brandId]);
    }
  });

  it("lists generating and completed-unpublished candidates without broadening blocked rows", async () => {
    const run = harness((sql, values) => {
      if (sql.includes("generation.status in ('draft'")) return {
        rows: [{
          generation_id: "generation-1",
          generation_output_id: null,
          topic_publish_group_id: null,
          title: "사장님 SNS 운영법",
          content_format: "card_news",
          status: "generating",
          created_at: "2026-08-16T00:00:00.000Z",
          blocked_reason: null,
        }],
        rowCount: 1,
      };
      if (sql.includes("output.status='completed'")) return {
        rows: [
          {
            generation_id: "generation-2",
            generation_output_id: "output-2",
            topic_publish_group_id: "group-2",
            title: "SNS 마케팅 체크리스트",
            content_format: "reel",
            status: "completed",
            created_at: "2026-08-16T01:00:00.000Z",
            blocked_reason: null,
          },
          {
            generation_id: "generation-3",
            generation_output_id: "output-3",
            topic_publish_group_id: null,
            title: "이미 예약된 콘텐츠",
            content_format: "card_news",
            status: "completed",
            created_at: "2026-08-16T02:00:00.000Z",
            blocked_reason: "already_scheduled",
          },
        ],
        rowCount: 2,
      };
      throw new Error(`unexpected query: ${sql} ${JSON.stringify(values)}`);
    });
    const repository = createPublishCalendarRepository(run.pool) as ReturnType<typeof createPublishCalendarRepository> & {
      listManualContentCandidates(input: typeof scope & { kind: "generating" | "completed_unpublished" }): Promise<unknown[]>;
    };

    await expect(repository.listManualContentCandidates({ ...scope, kind: "generating" })).resolves.toEqual([
      expect.objectContaining({ kind: "generating", generationId: "generation-1", assignable: true }),
    ]);
    await expect(repository.listManualContentCandidates({ ...scope, kind: "completed_unpublished" })).resolves.toEqual([
      expect.objectContaining({ kind: "completed_unpublished", generationOutputId: "output-2", topicPublishGroupId: "group-2", assignable: true }),
      expect.objectContaining({ generationOutputId: "output-3", assignable: false, blockedReason: "already_scheduled" }),
    ]);
    expect(run.statements.filter(({ sql }) => sql.includes("ai_content_generations generation"))
      .every(({ values }) => JSON.stringify(values) === JSON.stringify([scope.workspaceId, scope.brandId]))).toBe(true);
  });
});

describe("publish calendar content-backed manual provisioning", () => {
  it("checks a keyed replay immediately after the brand lock and before mutable policy", async () => {
    const run = harness((sql, values) => {
      if (sql.includes("idempotency_key=$3::text")) return { rows: [], rowCount: 0 };
      if (sql.includes("clock_timestamp()")) return { rows: [{ future: true }], rowCount: 1 };
      if (sql.includes("from brand_channels")) return { rows: [{ channel: "instagram" }], rowCount: 1 };
      if (sql.includes("slot.scheduled_for=$3::timestamptz") || sql.includes("abs(extract(epoch")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("from ai_content_generations generation") && sql.includes("for key share")) return {
        rows: [{
          generation_id: "40000000-0000-4000-8000-000000000001",
          generation_output_id: null,
          topic_publish_group_id: null,
          title: "사장님 SNS 콘텐츠",
          content_format: "card_news",
        }],
        rowCount: 1,
      };
      if (sql.includes("and (slot.generation_id=$3::uuid")) return { rows: [], rowCount: 0 };
      const subscription = activeSubscription(sql);
      if (subscription) return subscription;
      if (sql.includes("calendar_usage") && sql.includes("direct_publish_groups")) {
        return { rows: [{ published_count: 0, reserved_count: 0 }], rowCount: 1 };
      }
      if (sql.startsWith("insert into publish_calendar_slots")) return {
        rows: [slotRow({
          assignment_mode: "manual",
          status: "generation_pending",
          recommendation_kind: null,
          generation_id: values[5],
          idempotency_key: values[10],
          title: "사장님 SNS 콘텐츠",
        })],
        rowCount: 1,
      };
      throw new Error(`unexpected query: ${sql}`);
    });

    await createPublishCalendarRepository(run.pool).provisionManualSlot({
      ...scope,
      scheduledFor: new Date("2099-08-15T11:30:00+09:00"),
      channel: "instagram",
      contentFormat: "card_news",
      idempotencyKey: "manual-order",
      source: { kind: "existing_generation", generationId: "40000000-0000-4000-8000-000000000001" },
    });

    const sql = run.statements.map(({ sql }) => sql);
    const lockIndex = sql.findIndex((value) => value.includes("pg_advisory_xact_lock"));
    const replayIndex = sql.findIndex((value) => value.includes("idempotency_key=$3::text"));
    const futureIndex = sql.findIndex((value) => value.includes("clock_timestamp()"));
    const channelIndex = sql.findIndex((value) => value.includes("from brand_channels"));
    const quotaIndex = sql.findIndex((value) => value.includes("from brand_subscriptions subscription"));
    expect(lockIndex).toBeLessThan(replayIndex);
    expect(replayIndex).toBeLessThan(futureIndex);
    expect(replayIndex).toBeLessThan(channelIndex);
    expect(replayIndex).toBeLessThan(quotaIndex);
  });

  it("prepares a completed output only after its calendar slot commits", async () => {
    const outputId = "40000000-0000-4000-8000-000000000002";
    const generationId = "40000000-0000-4000-8000-000000000001";
    const run = harness((sql) => {
      if (sql.includes("idempotency_key=$3::text")) return { rows: [], rowCount: 0 };
      if (sql.includes("clock_timestamp()")) return { rows: [{ future: true }], rowCount: 1 };
      if (sql.includes("from brand_channels")) return { rows: [{ channel: "instagram" }], rowCount: 1 };
      if (sql.includes("slot.scheduled_for=$3::timestamptz") || sql.includes("abs(extract(epoch")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("from ai_content_generation_outputs output") && sql.includes("for key share")) {
        return {
          rows: [{
            generation_id: generationId,
            generation_output_id: outputId,
            topic_publish_group_id: null,
            title: "완료된 카드뉴스",
            content_format: "card_news",
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("and (slot.generation_id=$3::uuid")) return { rows: [], rowCount: 0 };
      const subscription = activeSubscription(sql);
      if (subscription) return subscription;
      if (sql.includes("calendar_usage") && sql.includes("direct_publish_groups")) {
        return { rows: [{ published_count: 0, reserved_count: 0 }], rowCount: 1 };
      }
      if (sql.startsWith("insert into publish_calendar_slots")) {
        return {
          rows: [slotRow({
            assignment_mode: "manual",
            status: "generation_pending",
            recommendation_kind: null,
            generation_id: generationId,
            generation_output_id: outputId,
            title: "완료된 카드뉴스",
          })],
          rowCount: 1,
        };
      }
      if (sql.includes("where slot.workspace_id=$1::uuid and slot.brand_id=$2::uuid and slot.id=$3::uuid")) {
        return {
          rows: [slotRow({
            assignment_mode: "manual",
            status: "content_assigned",
            recommendation_kind: null,
            generation_id: generationId,
            generation_output_id: outputId,
            topic_publish_group_id: "60000000-0000-4000-8000-000000000001",
            title: "완료된 카드뉴스",
          })],
          rowCount: 1,
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const afterManualSlotProvisioned = vi.fn(async () => {
      expect(run.statements.at(-1)?.sql).toBe("commit");
    });
    const repository = createPublishCalendarRepository(run.pool, { afterManualSlotProvisioned });

    const result = await repository.provisionManualSlot({
      ...scope,
      scheduledFor: new Date("2099-08-15T11:30:00+09:00"),
      channel: "instagram",
      contentFormat: "card_news",
      idempotencyKey: "completed-output",
      source: { kind: "existing_output", generationOutputId: outputId },
    });

    expect(result).toMatchObject({ status: "content_assigned", generationOutputId: outputId });
    expect(afterManualSlotProvisioned).toHaveBeenCalledWith({
      workspaceId: scope.workspaceId,
      brandId: scope.brandId,
      generationId,
      outputId,
    });
  });

  it("retries completed-output preparation when a durable manual slot is replayed", async () => {
    const generationId = "30000000-0000-4000-8000-000000000011";
    const outputId = "40000000-0000-4000-8000-000000000011";
    const existing = slotRow({
      assignment_mode: "manual",
      status: "generation_pending",
      recommendation_kind: null,
      generation_id: generationId,
      generation_output_id: outputId,
      content_format: "card_news",
      channels: ["instagram"],
      scheduled_for: "2099-08-15T02:30:00.000Z",
      idempotency_key: manualSlotIdentity("completed-output-retry", {
        kind: "existing_output",
        generationOutputId: outputId,
      }).key,
      title: "완료된 카드뉴스",
    });
    const run = harness((sql) => {
      if (sql.includes("idempotency_key=$3::text")) return { rows: [existing], rowCount: 1 };
      if (sql.includes("where slot.workspace_id=$1::uuid and slot.brand_id=$2::uuid and slot.id=$3::uuid")) {
        return { rows: [existing], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const afterManualSlotProvisioned = vi.fn(async () => undefined);
    const repository = createPublishCalendarRepository(run.pool, { afterManualSlotProvisioned });

    await repository.provisionManualSlot({
      ...scope,
      scheduledFor: new Date("2099-08-15T11:30:00+09:00"),
      channel: "instagram",
      contentFormat: "card_news",
      idempotencyKey: "completed-output-retry",
      source: { kind: "existing_output", generationOutputId: outputId },
    });

    expect(afterManualSlotProvisioned).toHaveBeenCalledOnce();
  });

  it("retries completed-output preparation for replayed rows in a durable batch", async () => {
    const generationId = "30000000-0000-4000-8000-000000000012";
    const outputId = "40000000-0000-4000-8000-000000000012";
    const existing = slotRow({
      assignment_mode: "manual",
      status: "generation_pending",
      recommendation_kind: null,
      generation_id: generationId,
      generation_output_id: outputId,
      content_format: "card_news",
      channels: ["instagram"],
      scheduled_for: "2099-08-15T03:00:00.000Z",
      idempotency_key: batchSlotIdentity("completed-output-batch-retry", "row-1", {
        kind: "existing_output",
        generationOutputId: outputId,
      }).key,
      title: "완료된 카드뉴스",
    });
    const run = harness((sql) => {
      if (sql.includes("idempotency_key=$3::text")) return { rows: [existing], rowCount: 1 };
      if (sql.includes("where slot.workspace_id=$1::uuid and slot.brand_id=$2::uuid and slot.id=$3::uuid")) {
        return { rows: [existing], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const afterManualSlotProvisioned = vi.fn(async () => undefined);
    const repository = createPublishCalendarRepository(run.pool, { afterManualSlotProvisioned });

    await repository.provisionManualSlotsBatch({
      ...scope,
      idempotencyKey: "completed-output-batch-retry",
      rows: [{
        clientRowId: "row-1",
        scheduledFor: new Date("2099-08-15T12:00:00+09:00"),
        channel: "instagram",
        contentFormat: "card_news",
        source: { kind: "existing_output", generationOutputId: outputId },
      }],
    });

    expect(afterManualSlotProvisioned).toHaveBeenCalledOnce();
  });

  it("fails closed when a completed output already has any publish queue", async () => {
    const run = harness((sql) => {
      if (sql.includes("idempotency_key=$3::text")) return { rows: [], rowCount: 0 };
      if (sql.includes("clock_timestamp()")) return { rows: [{ future: true }], rowCount: 1 };
      if (sql.includes("from brand_channels")) return { rows: [{ channel: "instagram" }], rowCount: 1 };
      if (sql.includes("slot.scheduled_for=$3::timestamptz") || sql.includes("abs(extract(epoch")) return { rows: [], rowCount: 0 };
      if (sql.includes("from ai_content_generation_outputs output") && sql.includes("for key share")) return { rows: [], rowCount: 0 };
      throw new Error(`unexpected query: ${sql}`);
    });

    await expect(createPublishCalendarRepository(run.pool).provisionManualSlot({
      ...scope,
      scheduledFor: new Date("2099-08-15T11:30:00+09:00"),
      channel: "instagram",
      contentFormat: "card_news",
      idempotencyKey: "completed-output-guard",
      source: { kind: "existing_output", generationOutputId: "40000000-0000-4000-8000-000000000001" },
    })).rejects.toThrowError("publish_calendar_content_not_assignable");

    const lineage = run.statements.find(({ sql }) => sql.includes("from ai_content_generation_outputs output") && sql.includes("for key share"));
    expect(lineage?.sql).not.toContain("queue.status in (");
  });

  it("locks and reserves a selected content topic through its waiting publish group", async () => {
    const topicId = "40000000-0000-4000-8000-000000000010";
    const groupId = "50000000-0000-4000-8000-000000000010";
    const run = harness((sql) => {
      if (sql.includes("idempotency_key=$3::text")) return { rows: [], rowCount: 0 };
      if (sql.includes("clock_timestamp()")) return { rows: [{ future: true }], rowCount: 1 };
      if (sql.includes("from brand_channels")) return { rows: [{ channel: "instagram" }], rowCount: 1 };
      if (sql.includes("slot.scheduled_for=$3::timestamptz")) return { rows: [], rowCount: 0 };
      if (sql.includes("abs(extract(epoch")) return { rows: [], rowCount: 0 };
      if (sql.includes("from content_topics topic") && sql.includes("for update")) return {
        rows: [{
          content_topic_id: topicId,
          generation_id: null,
          generation_output_id: null,
          title: "SNS 마케팅 사장님 콘텐츠",
          content_format: "card_news",
        }],
        rowCount: 1,
      };
      if (sql.startsWith("insert into topic_publish_groups")) return {
        rows: [{ id: groupId, status: "waiting" }],
        rowCount: 1,
      };
      if (sql.includes("slot.topic_publish_group_id=$3::uuid")) return { rows: [], rowCount: 0 };
      const subscription = activeSubscription(sql);
      if (subscription) return subscription;
      if (sql.includes("calendar_usage") && sql.includes("direct_publish_groups")) {
        return { rows: [{ published_count: 0, reserved_count: 0 }], rowCount: 1 };
      }
      if (sql.startsWith("insert into publish_calendar_slots")) return {
        rows: [slotRow({
          assignment_mode: "manual",
          status: "generation_pending",
          recommendation_kind: null,
          generation_id: null,
          generation_output_id: null,
          topic_publish_group_id: groupId,
          title: "SNS 마케팅 사장님 콘텐츠",
        })],
        rowCount: 1,
      };
      throw new Error(`unexpected query: ${sql}`);
    });
    const afterManualSlotProvisioned = vi.fn(async () => undefined);
    const repository = createPublishCalendarRepository(run.pool, { afterManualSlotProvisioned });

    await expect(repository.provisionManualSlot({
      ...scope,
      scheduledFor: new Date("2099-08-15T11:30:00+09:00"),
      channel: "instagram",
      contentFormat: "card_news",
      idempotencyKey: "manual-topic-1",
      createdByUserId: "50000000-0000-4000-8000-000000000001",
      source: { kind: "existing_content_topic", contentTopicId: topicId } as never,
    })).resolves.toMatchObject({
      status: "generation_pending",
      generationId: null,
      generationOutputId: null,
      topicPublishGroupId: groupId,
    });

    expect(afterManualSlotProvisioned).not.toHaveBeenCalled();
    const topicLineageSql = run.statements.find(({ sql }) => sql.includes("from content_topics topic"))?.sql ?? "";
    expect(topicLineageSql).toContain("topic.status='selected'");
    expect(topicLineageSql).toContain("topic.selected_instagram_format='instagram_feed_carousel'");
    expect(topicLineageSql).toContain("topic.selected_instagram_format='instagram_reel'");
    expect(topicLineageSql).not.toContain("instagram_feed_single");
    expect(run.statements.find(({ sql }) => sql.startsWith("insert into topic_publish_groups"))?.sql)
      .toContain("on conflict (content_topic_id)");
  });

  it("creates a generation-backed slot without ever inserting an open slot", async () => {
    const run = harness((sql) => {
      if (sql.includes("idempotency_key=$3::text")) return { rows: [], rowCount: 0 };
      if (sql.includes("clock_timestamp()")) return { rows: [{ future: true }], rowCount: 1 };
      if (sql.includes("from brand_channels")) return { rows: [{ channel: "instagram" }], rowCount: 1 };
      if (sql.includes("abs(extract(epoch")) return { rows: [], rowCount: 0 };
      if (sql.includes("slot.scheduled_for=$3::timestamptz")) return { rows: [], rowCount: 0 };
      if (sql.includes("and (slot.generation_id=$3::uuid")) return { rows: [], rowCount: 0 };
      if (sql.includes("from ai_content_generations generation") && sql.includes("for key share")) return {
        rows: [{
          generation_id: "40000000-0000-4000-8000-000000000001",
          generation_output_id: null,
          topic_publish_group_id: null,
          title: "사장님 SNS 콘텐츠",
          content_format: "card_news",
        }],
        rowCount: 1,
      };
      const subscription = activeSubscription(sql);
      if (subscription) return subscription;
      if (sql.includes("calendar_usage") && sql.includes("direct_publish_groups")) {
        return { rows: [{ published_count: 0, reserved_count: 1 }], rowCount: 1 };
      }
      if (sql.startsWith("insert into publish_calendar_slots")) return {
        rows: [slotRow({
          assignment_mode: "manual",
          status: "generation_pending",
          recommendation_kind: null,
          generation_id: "40000000-0000-4000-8000-000000000001",
          title: "사장님 SNS 콘텐츠",
        })],
        rowCount: 1,
      };
      throw new Error(`unexpected query: ${sql}`);
    });
    const repository = createPublishCalendarRepository(run.pool) as ReturnType<typeof createPublishCalendarRepository> & {
      provisionManualSlot(input: typeof scope & {
        scheduledFor: Date;
        channel: "instagram";
        contentFormat: "card_news";
        idempotencyKey: string;
        createdByUserId: string;
        source: { kind: "existing_generation"; generationId: string };
      }): Promise<unknown>;
    };

    await expect(repository.provisionManualSlot({
      ...scope,
      scheduledFor: new Date("2099-08-15T11:30:00+09:00"),
      channel: "instagram",
      contentFormat: "card_news",
      idempotencyKey: "manual-slot-1",
      createdByUserId: "50000000-0000-4000-8000-000000000001",
      source: { kind: "existing_generation", generationId: "40000000-0000-4000-8000-000000000001" },
    })).resolves.toMatchObject({ status: "generation_pending", generationId: "40000000-0000-4000-8000-000000000001" });

    const insert = run.statements.find(({ sql }) => sql.startsWith("insert into publish_calendar_slots"));
    expect(insert?.sql).toContain("'manual',$12,null");
    expect(insert?.values[9]).toMatch(/^manual:v2:[0-9a-f]{64}:[0-9a-f]{64}$/);
    expect(insert?.values[11]).toBe("generation_pending");
    expect(insert?.sql).not.toContain("'open'");
  });

  it("creates a 30-minute-spaced batch in one transaction and one brand lock", async () => {
    let inserts = 0;
    const run = harness((sql, values) => {
      if (sql.includes("idempotency_key=$3::text")) return { rows: [], rowCount: 0 };
      if (sql.includes("clock_timestamp()")) return { rows: [{ future: true }], rowCount: 1 };
      if (sql.includes("from brand_channels")) return { rows: [{ channel: "instagram" }], rowCount: 1 };
      if (sql.includes("slot.scheduled_for=$3::timestamptz")) return { rows: [], rowCount: 0 };
      if (sql.includes("abs(extract(epoch")) return { rows: [], rowCount: 0 };
      if (sql.includes("and (slot.generation_id=$3::uuid")) return { rows: [], rowCount: 0 };
      if (sql.includes("generation.id=any($3::uuid[])") && sql.includes("generation.status='draft'")) {
        return { rows: [{ count: 0 }], rowCount: 1 };
      }
      if (sql.includes("from ai_content_generations generation") && sql.includes("for key share")) return {
        rows: [{
          generation_id: values[2],
          generation_output_id: null,
          topic_publish_group_id: null,
          title: `콘텐츠 ${inserts + 1}`,
          content_format: values[3],
        }],
        rowCount: 1,
      };
      const subscription = activeSubscription(sql);
      if (subscription) return subscription;
      if (sql.includes("calendar_usage") && sql.includes("direct_publish_groups")) {
        return { rows: [{ published_count: 0, reserved_count: inserts }], rowCount: 1 };
      }
      if (sql.startsWith("insert into publish_calendar_slots")) {
        inserts += 1;
        return {
          rows: [slotRow({
            id: `30000000-0000-4000-8000-00000000000${inserts}`,
            scheduled_for: values[2],
            assignment_mode: "manual",
            status: "generation_pending",
            recommendation_kind: null,
            content_format: values[3],
            generation_id: values[5],
            title: values[8],
          })],
          rowCount: 1,
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const repository = createPublishCalendarRepository(run.pool) as ReturnType<typeof createPublishCalendarRepository> & {
      provisionManualSlotsBatch(input: typeof scope & {
        idempotencyKey: string;
        createdByUserId: string;
        rows: Array<{
          clientRowId: string;
          scheduledFor: Date;
          channel: "instagram";
          contentFormat: "card_news" | "reel";
          source: { kind: "existing_generation"; generationId: string };
        }>;
      }): Promise<unknown[]>;
    };

    await expect(repository.provisionManualSlotsBatch({
      ...scope,
      idempotencyKey: "manual-batch-1",
      createdByUserId: "50000000-0000-4000-8000-000000000001",
      rows: [
        {
          clientRowId: "row-1",
          scheduledFor: new Date("2099-08-15T11:30:00+09:00"),
          channel: "instagram",
          contentFormat: "card_news",
          source: { kind: "existing_generation", generationId: "40000000-0000-4000-8000-000000000001" },
        },
        {
          clientRowId: "row-2",
          scheduledFor: new Date("2099-08-15T12:00:00+09:00"),
          channel: "instagram",
          contentFormat: "reel",
          source: { kind: "existing_generation", generationId: "40000000-0000-4000-8000-000000000002" },
        },
      ],
    })).resolves.toHaveLength(2);

    expect(run.statements.filter(({ sql }) => sql === "begin")).toHaveLength(1);
    expect(run.statements.filter(({ sql }) => sql.includes("pg_advisory_xact_lock"))).toHaveLength(1);
    expect(run.statements.filter(({ sql }) => sql === "commit")).toHaveLength(1);
    expect(run.statements.filter(({ sql }) => sql.startsWith("insert into publish_calendar_slots"))).toHaveLength(2);
  });
});

describe("publish calendar repository assignment", () => {
  it("fails closed for a category mismatch or stale content suggestion batch", async () => {
    const run = harness((sql) => {
      if (sql.includes("select slot.*") && sql.includes("for update")) return { rows: [slotRow()], rowCount: 1 };
      if (sql.includes("from brand_channels")) return { rows: [{ channel: "instagram" }], rowCount: 1 };
      if (sql.includes("assignment_scope_valid")) return { rows: [{ assignment_scope_valid: false }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    await expect(createPublishCalendarRepository(run.pool).assignSlot({
      ...scope,
      slotId: String(slotRow().id),
      assignmentMode: "automatic",
      contentSuggestionId: "40000000-0000-4000-8000-000000000001",
    })).rejects.toThrowError("publish_calendar_assignment_scope_invalid");

    const ownershipSql = run.statements.find(({ sql }) => sql.includes("assignment_scope_valid"))?.sql ?? "";
    expect(ownershipSql).toContain("join content_suggestion_batches batch on batch.id=suggestion.batch_id");
    expect(ownershipSql).toContain("join content_categories category on category.id=profile.primary_category_id and category.active");
    expect(ownershipSql).toContain("batch.category_id=profile.primary_category_id");
    expect(ownershipSql).toContain("order by latest.generation_date desc,latest.published_at desc,latest.id desc");
  });

  it("rejects cross-tenant proposal, generation, output, or publish-group identifiers", async () => {
    const run = harness((sql) => {
      if (sql.includes("select slot.*") && sql.includes("for update")) return { rows: [slotRow()], rowCount: 1 };
      if (sql.includes("from brand_channels")) return { rows: [{ channel: "instagram" }], rowCount: 1 };
      if (sql.includes("assignment_scope_valid")) return { rows: [{ assignment_scope_valid: false }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    await expect(createPublishCalendarRepository(run.pool).assignSlot({
      ...scope,
      slotId: String(slotRow().id),
      assignmentMode: "manual",
      proposalId: "40000000-0000-4000-8000-000000000001",
      generationId: "50000000-0000-4000-8000-000000000001",
      generationOutputId: "60000000-0000-4000-8000-000000000001",
      topicPublishGroupId: "70000000-0000-4000-8000-000000000001",
    })).rejects.toThrowError("publish_calendar_assignment_scope_invalid");
  });

  it("requires the Instagram channel snapshot and a compatible output format when a publish group exists", async () => {
    const run = harness((sql) => {
      if (sql.includes("select slot.*") && sql.includes("for update")) {
        return { rows: [slotRow({ channels: ["instagram"], content_format: "reel" })], rowCount: 1 };
      }
      if (sql.includes("from brand_channels")) {
        return { rows: [{ channel: "instagram" }], rowCount: 1 };
      }
      if (sql.includes("assignment_scope_valid")) return { rows: [{ assignment_scope_valid: false }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    await expect(createPublishCalendarRepository(run.pool).assignSlot({
      ...scope,
      slotId: String(slotRow().id),
      assignmentMode: "manual",
      topicPublishGroupId: "70000000-0000-4000-8000-000000000001",
    })).rejects.toThrowError("publish_calendar_assignment_scope_invalid");

    const ownership = run.statements.find(({ sql }) => sql.includes("assignment_scope_valid"));
    expect(ownership?.sql).toContain("assignment_channels_and_format_valid");
    expect(ownership?.sql).toContain("except select distinct queue.channel");
    expect(ownership?.sql).toContain("output.delivery_format in ('instagram_reel','tiktok_video','youtube_video','youtube_short')");
    expect(ownership?.values.at(-1)).toBe("reel");
  });

  it("retains a raced assignment as quota_blocked under the same brand advisory lock", async () => {
    const suggestionId = "40000000-0000-4000-8000-000000000001";
    const run = harness((sql) => {
      if (sql.includes("select slot.*") && sql.includes("for update")) return { rows: [slotRow()], rowCount: 1 };
      if (sql.includes("from brand_channels")) return { rows: [{ channel: "instagram" }], rowCount: 1 };
      if (sql.includes("assignment_scope_valid")) return { rows: [{ assignment_scope_valid: true }], rowCount: 1 };
      const subscription = activeSubscription(sql);
      if (subscription) return { ...subscription, rows: [{ ...subscription.rows[0], weekly_publish_limit: 1 }] };
      if (sql.includes("calendar_usage") && sql.includes("direct_publish_groups")) {
        return { rows: [{ published_count: 1, reserved_count: 0 }], rowCount: 1 };
      }
      if (sql.startsWith("update publish_calendar_slots set")) return {
        rows: [slotRow({ status: "quota_blocked", content_suggestion_id: suggestionId })],
        rowCount: 1,
      };
      return { rows: [], rowCount: 0 };
    });
    const result = await createPublishCalendarRepository(run.pool).assignSlot({
      ...scope,
      slotId: String(slotRow().id),
      assignmentMode: "automatic",
      contentSuggestionId: suggestionId,
      title: "오늘의 추천",
    });

    expect(result).toMatchObject({ status: "quota_blocked", contentSuggestionId: suggestionId });
    const update = run.statements.find(({ sql }) => sql.startsWith("update publish_calendar_slots set"));
    expect(update?.values).toContain("quota_blocked");
    expect(run.statements.some(({ sql }) => sql.includes("pg_advisory_xact_lock"))).toBe(true);
  });

  it("rejects assigning content after the slot time passes", async () => {
    const run = harness((sql) => sql.includes("select slot.*") && sql.includes("for update")
      ? { rows: [slotRow({ scheduled_for: "2020-01-01T00:00:00Z" })], rowCount: 1 }
      : { rows: [], rowCount: 0 });
    await expect(createPublishCalendarRepository(run.pool).assignSlot({
      ...scope,
      slotId: String(slotRow().id),
      assignmentMode: "manual",
      proposalId: "40000000-0000-4000-8000-000000000001",
    })).rejects.toThrowError("publish_calendar_time_past");
  });

  it.each(["content_assigned", "ready", "scheduled", "publish_delayed"])(
    "rejects reassignment once a slot reaches %s",
    async (status) => {
      const run = harness((sql) => sql.includes("select slot.*") && sql.includes("for update")
        ? { rows: [slotRow({ status })], rowCount: 1 }
        : { rows: [], rowCount: 0 });

      await expect(createPublishCalendarRepository(run.pool).assignSlot({
        ...scope,
        slotId: String(slotRow().id),
        assignmentMode: "manual",
        topicPublishGroupId: "70000000-0000-4000-8000-000000000001",
      })).rejects.toThrowError("publish_calendar_slot_not_assignable");
      expect(run.statements.some(({ sql }) => sql.includes("assignment_scope_valid"))).toBe(false);
    },
  );

  it("rejects an incoming identifier that conflicts with the existing assignment lineage", async () => {
    const run = harness((sql) => sql.includes("select slot.*") && sql.includes("for update")
      ? {
          rows: [slotRow({
            status: "proposal_assigned",
            content_suggestion_id: "40000000-0000-4000-8000-000000000001",
          })],
          rowCount: 1,
        }
      : { rows: [], rowCount: 0 });

    await expect(createPublishCalendarRepository(run.pool).assignSlot({
      ...scope,
      slotId: String(slotRow().id),
      assignmentMode: "automatic",
      contentSuggestionId: "40000000-0000-4000-8000-000000000002",
    })).rejects.toThrowError("publish_calendar_assignment_lineage_conflict");
    expect(run.statements.some(({ sql }) => sql.includes("assignment_scope_valid"))).toBe(false);
  });

  it("enriches the same lineage with an output without regressing generation_pending", async () => {
    const suggestionId = "40000000-0000-4000-8000-000000000001";
    const proposalId = "50000000-0000-4000-8000-000000000001";
    const generationId = "60000000-0000-4000-8000-000000000001";
    const outputId = "70000000-0000-4000-8000-000000000001";
    const run = harness((sql, values) => {
      if (sql.includes("select slot.*") && sql.includes("for update")) return {
        rows: [slotRow({
          status: "generation_pending",
          content_suggestion_id: suggestionId,
          proposal_id: proposalId,
          generation_id: generationId,
        })],
        rowCount: 1,
      };
      if (sql.includes("from brand_channels")) return { rows: [{ channel: "instagram" }], rowCount: 1 };
      if (sql.includes("assignment_scope_valid")) return { rows: [{ assignment_scope_valid: true }], rowCount: 1 };
      const subscription = activeSubscription(sql);
      if (subscription) return subscription;
      if (sql.includes("calendar_usage") && sql.includes("direct_publish_groups")) {
        return { rows: [{ published_count: 0, reserved_count: 0 }], rowCount: 1 };
      }
      if (sql.startsWith("update publish_calendar_slots set")) return {
        rows: [slotRow({
          status: String(values[4]),
          content_suggestion_id: values[5],
          proposal_id: values[6],
          generation_id: values[7],
          generation_output_id: values[8],
        })],
        rowCount: 1,
      };
      return { rows: [], rowCount: 0 };
    });

    await expect(createPublishCalendarRepository(run.pool).assignSlot({
      ...scope,
      slotId: String(slotRow().id),
      assignmentMode: "automatic",
      generationOutputId: outputId,
    })).resolves.toMatchObject({
      status: "generation_pending",
      contentSuggestionId: suggestionId,
      proposalId,
      generationId,
      generationOutputId: outputId,
    });
    const ownership = run.statements.find(({ sql }) => sql.includes("assignment_scope_valid"));
    expect(ownership?.values.slice(2, 7)).toEqual([
      suggestionId,
      proposalId,
      generationId,
      outputId,
      null,
    ]);
    expect(ownership?.sql).toContain("($5::uuid is null or proposal.generation_id=$5::uuid)");
  });

  it("rejects a proposal and output from different generations when generationId is omitted", async () => {
    const proposalId = "50000000-0000-4000-8000-000000000011";
    const outputId = "70000000-0000-4000-8000-000000000012";
    const outputGenerationId = "60000000-0000-4000-8000-000000000012";
    const run = harness((sql) => {
      if (sql.includes("select slot.*") && sql.includes("for update")) {
        return { rows: [slotRow()], rowCount: 1 };
      }
      if (sql.includes("from brand_channels")) return { rows: [{ channel: "instagram" }], rowCount: 1 };
      if (sql.startsWith("select output.generation_id")) {
        return { rows: [{ generation_id: outputGenerationId }], rowCount: 1 };
      }
      if (sql.includes("assignment_scope_valid")) return { rows: [{ assignment_scope_valid: false }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    await expect(createPublishCalendarRepository(run.pool).assignSlot({
      ...scope,
      slotId: String(slotRow().id),
      assignmentMode: "manual",
      proposalId,
      generationOutputId: outputId,
    })).rejects.toThrowError("publish_calendar_assignment_scope_invalid");
    const ownership = run.statements.find(({ sql }) => sql.includes("assignment_scope_valid"));
    expect(ownership?.values.slice(2, 7)).toEqual([null, proposalId, outputGenerationId, outputId, null]);
    expect(ownership?.sql).toContain("output_proposal.generation_id=output.generation_id");
  });

  it("accepts a proposal and output from the same generation when generationId is omitted", async () => {
    const proposalId = "50000000-0000-4000-8000-000000000021";
    const outputId = "70000000-0000-4000-8000-000000000021";
    const parentGenerationId = "60000000-0000-4000-8000-000000000021";
    const run = harness((sql, values) => {
      if (sql.includes("select slot.*") && sql.includes("for update")) {
        return { rows: [slotRow()], rowCount: 1 };
      }
      if (sql.includes("from brand_channels")) return { rows: [{ channel: "instagram" }], rowCount: 1 };
      if (sql.startsWith("select output.generation_id")) {
        return { rows: [{ generation_id: parentGenerationId }], rowCount: 1 };
      }
      if (sql.includes("assignment_scope_valid")) return { rows: [{ assignment_scope_valid: true }], rowCount: 1 };
      const subscription = activeSubscription(sql);
      if (subscription) return subscription;
      if (sql.includes("calendar_usage") && sql.includes("direct_publish_groups")) {
        return { rows: [{ published_count: 0, reserved_count: 0 }], rowCount: 1 };
      }
      if (sql.startsWith("update publish_calendar_slots set")) return {
        rows: [slotRow({
          assignment_mode: values[3],
          status: values[4],
          proposal_id: values[6],
          generation_id: values[7],
          generation_output_id: values[8],
        })],
        rowCount: 1,
      };
      return { rows: [], rowCount: 0 };
    });

    await expect(createPublishCalendarRepository(run.pool).assignSlot({
      ...scope,
      slotId: String(slotRow().id),
      assignmentMode: "manual",
      proposalId,
      generationOutputId: outputId,
    })).resolves.toMatchObject({
      status: "generation_pending",
      proposalId,
      generationId: parentGenerationId,
      generationOutputId: outputId,
    });
    const update = run.statements.find(({ sql }) => sql.startsWith("update publish_calendar_slots set"));
    expect(update?.values[7]).toBe(parentGenerationId);
  });

  it("reschedules a future pre-generation slot in place and makes an automatic assignment manual", async () => {
    const target = new Date("2099-08-22T04:15:00.000Z");
    const existing = slotRow({
      assignment_mode: "automatic",
      recommendation_kind: "informational",
      status: "generation_pending",
      generation_id: "60000000-0000-4000-8000-000000000031",
    });
    const run = harness((sql, values) => {
      if (sql.includes("clock_timestamp() <")) return { rows: [{ future: true }], rowCount: 1 };
      if (sql.includes("select slot.*") && sql.includes("for update")) return { rows: [existing], rowCount: 1 };
      if (sql.includes("select queue.status") && sql.includes("for update")) return { rows: [], rowCount: 0 };
      const subscription = activeSubscription(sql);
      if (subscription) return subscription;
      if (sql.includes("calendar_usage") && sql.includes("direct_publish_groups")) {
        return { rows: [{ published_count: 0, reserved_count: 2 }], rowCount: 1 };
      }
      if (sql.startsWith("update publish_calendar_slots set")) return {
        rows: [{ ...existing, scheduled_for: values[3], assignment_mode: "manual", recommendation_kind: null }],
        rowCount: 1,
      };
      return { rows: [], rowCount: 0 };
    });

    await expect(createPublishCalendarRepository(run.pool).rescheduleSlot({
      ...scope,
      slotId: String(existing.id),
      scheduledFor: target,
    })).resolves.toMatchObject({
      id: existing.id,
      scheduledFor: target.toISOString(),
      assignmentMode: "manual",
      recommendationKind: null,
    });
    const slotUpdate = run.statements.find(({ sql }) => sql.startsWith("update publish_calendar_slots set"));
    expect(slotUpdate?.sql).toContain("recommendation_kind=null");
    const usage = run.statements.find(({ sql }) => sql.includes("calendar_usage") && sql.includes("direct_publish_groups"));
    expect(usage?.values[5]).toBe(existing.id);
    expect(run.statements.some(({ sql }) => sql.startsWith("update topic_publish_groups"))).toBe(false);
    expect(run.statements.some(({ sql }) => sql.startsWith("update publish_queue"))).toBe(false);
  });

  it("reschedules a scheduled slot, group, and queue to one Seoul calendar time", async () => {
    const target = new Date("2099-08-22T18:40:00.000Z");
    const linked = slotRow({
      assignment_mode: "automatic",
      status: "scheduled",
      topic_publish_group_id: "70000000-0000-4000-8000-000000000032",
    });
    const run = harness((sql, values) => {
      if (sql.includes("clock_timestamp() <")) return { rows: [{ future: true }], rowCount: 1 };
      if (sql.includes("select slot.*") && sql.includes("for update")) return { rows: [linked], rowCount: 1 };
      if (sql.includes("select publish_group.status")) return { rows: [{ status: "scheduled" }], rowCount: 1 };
      if (sql.includes("select queue.status") && sql.includes("for update")) {
        return { rows: [{ status: "scheduled" }], rowCount: 1 };
      }
      const subscription = activeSubscription(sql);
      if (subscription) return subscription;
      if (sql.includes("calendar_usage") && sql.includes("direct_publish_groups")) {
        return { rows: [{ published_count: 0, reserved_count: 1 }], rowCount: 1 };
      }
      if (sql.startsWith("update topic_publish_groups")) return { rows: [], rowCount: 1 };
      if (sql.startsWith("update publish_queue")) return { rows: [], rowCount: 1 };
      if (sql.startsWith("update publish_calendar_slots set")) return {
        rows: [{ ...linked, scheduled_for: values[3], assignment_mode: "manual" }],
        rowCount: 1,
      };
      return { rows: [], rowCount: 0 };
    });

    await createPublishCalendarRepository(run.pool).rescheduleSlot({
      ...scope,
      slotId: String(linked.id),
      scheduledFor: target,
    });

    const groupUpdate = run.statements.find(({ sql }) => sql.startsWith("update topic_publish_groups"));
    const queueUpdate = run.statements.find(({ sql }) => sql.startsWith("update publish_queue"));
    expect(groupUpdate?.sql).toContain("at time zone 'Asia/Seoul'");
    expect(queueUpdate?.sql).toContain("at time zone 'Asia/Seoul'");
    expect(groupUpdate?.values).toContain(target);
    expect(queueUpdate?.values).toContain(target);
  });

  it.each(["deferred", "publishing", "published", "failed", "cancelled"])(
    "rejects rescheduling when the linked queue is %s",
    async (queueStatus) => {
      const linked = slotRow({ status: "scheduled", topic_publish_group_id: "70000000-0000-4000-8000-000000000033" });
      const run = harness((sql) => {
        if (sql.includes("clock_timestamp() <")) return { rows: [{ future: true }], rowCount: 1 };
        if (sql.includes("select slot.*") && sql.includes("for update")) return { rows: [linked], rowCount: 1 };
        if (sql.includes("select publish_group.status")) return { rows: [{ status: "scheduled" }], rowCount: 1 };
        if (sql.includes("select queue.status") && sql.includes("for update")) {
          return { rows: [{ status: queueStatus }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      await expect(createPublishCalendarRepository(run.pool).rescheduleSlot({
        ...scope,
        slotId: String(linked.id),
        scheduledFor: new Date("2099-08-22T18:40:00.000Z"),
      })).rejects.toThrowError("publish_calendar_slot_not_reschedulable");
      expect(run.statements.some(({ sql }) => sql.startsWith("update publish_calendar_slots"))).toBe(false);
    },
  );

  it.each([
    ["foreign slot", "not_found"],
    ["cancelled slot", "cancelled"],
    ["past target", "past"],
    ["inactive subscription", "inactive"],
    ["full target week", "quota"],
  ])("rejects rescheduling a %s without updating the slot", async (_label, scenario) => {
    const existing = slotRow({ status: scenario === "cancelled" ? "cancelled" : "generation_pending" });
    const run = harness((sql) => {
      if (sql.includes("select slot.*") && sql.includes("for update")) {
        return scenario === "not_found" ? { rows: [], rowCount: 0 } : { rows: [existing], rowCount: 1 };
      }
      if (sql.includes("clock_timestamp() <")) {
        return { rows: [{ future: scenario !== "past" }], rowCount: 1 };
      }
      if (sql.includes("from brand_subscriptions subscription")) {
        return scenario === "inactive" ? { rows: [], rowCount: 0 } : activeSubscription(sql)!;
      }
      if (sql.includes("calendar_usage") && sql.includes("direct_publish_groups")) {
        return { rows: [{ published_count: scenario === "quota" ? 3 : 0, reserved_count: 0 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(createPublishCalendarRepository(run.pool).rescheduleSlot({
      ...scope,
      slotId: String(existing.id),
      scheduledFor: new Date("2099-08-22T18:40:00.000Z"),
    })).rejects.toThrowError(
      scenario === "not_found" ? "publish_calendar_slot_not_found"
        : scenario === "past" ? "publish_calendar_time_past"
          : scenario === "inactive" ? "publish_calendar_subscription_inactive"
            : scenario === "quota" ? "publish_weekly_quota_exceeded"
              : "publish_calendar_slot_not_reschedulable",
    );
    expect(run.statements.some(({ sql }) => sql.startsWith("update publish_calendar_slots"))).toBe(false);
  });

  it("cancels a linked queue and publish group in the slot transaction", async () => {
    const linked = slotRow({
      assignment_mode: "manual",
      status: "scheduled",
      recommendation_kind: null,
      topic_publish_group_id: "70000000-0000-4000-8000-000000000001",
    });
    const run = harness((sql) => {
      if (sql.includes("select slot.*") && sql.includes("for update")) return { rows: [linked], rowCount: 1 };
      if (sql.startsWith("update publish_queue")) return { rows: [], rowCount: 1 };
      if (sql.startsWith("select 1 from publish_queue")) return { rows: [], rowCount: 0 };
      if (sql.startsWith("update topic_publish_groups")) return { rows: [], rowCount: 1 };
      if (sql.startsWith("update publish_calendar_slots set status='cancelled'")) {
        return { rows: [{ ...linked, status: "cancelled" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(createPublishCalendarRepository(run.pool).cancelSlot({
      ...scope,
      slotId: String(linked.id),
    })).resolves.toMatchObject({ status: "cancelled" });
    const sql = run.statements.map((statement) => statement.sql).join("\n");
    expect(sql).toContain("update publish_queue set status='cancelled'");
    expect(sql).toContain("update topic_publish_groups set status='cancelled'");
  });
});

describe("publish calendar usage and subscription renewal", () => {
  it("counts direct asynchronous publish groups once and excludes non-cancelled calendar-linked groups", async () => {
    const run = harness((sql) => {
      const subscription = activeSubscription(sql);
      if (subscription) return subscription;
      if (sql.includes("calendar_usage") && sql.includes("direct_publish_groups")) {
        return { rows: [{ published_count: 2, reserved_count: 1 }], rowCount: 1 };
      }
      if (sql.includes("from ai_content_usage_ledger")) {
        return { rows: [{ succeeded_count: 1, reserved_count: 2 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const usage = await createPublishCalendarRepository(run.pool).getWeeklyUsage({
      ...scope,
      at: new Date("2026-08-13T10:00:00+09:00"),
    });

    expect(usage.publishing).toMatchObject({ succeeded: 2, reserved: 1, remaining: 1, additionalAvailable: 0 });
    const directSql = run.statements.find(({ sql }) => sql.includes("direct_publish_groups"))?.sql ?? "";
    expect(directSql).toContain("'ai-output:' || output.ai_content_generation_output_id::text");
    expect(directSql).toContain("'topic:' || output.content_topic_id::text");
    expect(directSql).toContain("'group:' || queue.topic_publish_group_id::text");
    expect(directSql).toContain("'channel-output:' || output.id::text");
    expect(directSql).toContain("'queue:' || queue.id::text");
    expect(directSql).toContain("group by publication_unit_key");
    expect(directSql).toContain("bool_or(queue.status='published')");
    expect(directSql).toContain("not exists ( select 1 from publish_calendar_slots linked_slot");
    expect(directSql).toContain("linked_slot.status<>'cancelled'");
    expect(directSql).toContain("calendar_publish_groups");
    expect(directSql).toContain("max(queue.published_at) filter (where queue.status='published') as published_at");
    expect(directSql).toContain("status='published' and published_at >= $3::timestamptz");
  });

  it("keeps a direct group eligible when its only linked calendar slot is cancelled", async () => {
    const run = harness((sql) => {
      const subscription = activeSubscription(sql);
      if (subscription) return subscription;
      if (sql.includes("calendar_usage") && sql.includes("direct_publish_groups")) {
        return { rows: [{ published_count: 1, reserved_count: 0 }], rowCount: 1 };
      }
      if (sql.includes("from ai_content_usage_ledger")) {
        return { rows: [{ succeeded_count: 0, reserved_count: 0 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(createPublishCalendarRepository(run.pool).getWeeklyUsage({
      ...scope,
      at: new Date("2026-08-13T10:00:00+09:00"),
    })).resolves.toMatchObject({ publishing: { succeeded: 1 } });
    const directSql = run.statements.find(({ sql }) => sql.includes("direct_publish_groups"))?.sql ?? "";
    expect(directSql).toContain("linked_slot.status<>'cancelled'");
  });

  it("rejects usage for an inactive subscription or inactive catalog plan", async () => {
    const repository = createPublishCalendarRepository(harness(() => ({ rows: [], rowCount: 0 })).pool);
    await expect(repository.getWeeklyUsage({ ...scope, at: new Date("2026-08-13T00:00:00Z") }))
      .rejects.toThrowError("publish_calendar_subscription_inactive");
  });

  it("applies a pending plan only at renewal and catches up elapsed calendar months", async () => {
    const run = harness((sql) => {
      if (sql.startsWith("select subscription.brand_id")) return {
        rows: [{
          brand_id: scope.brandId,
          plan_code: "starter",
          pending_plan_code: "growth",
          status: "active",
          cancel_at_period_end: false,
          started_at: "2025-12-31T00:00:00.000Z",
          current_period_start: "2025-12-31T00:00:00.000Z",
          current_period_end: "2026-01-31T00:00:00.000Z",
        }],
        rowCount: 1,
      };
      if (sql.startsWith("update brand_subscriptions")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const renewals = await createPublishCalendarRepository(run.pool)
      .applyDueSubscriptionRenewals(new Date("2026-04-20T00:00:00.000Z"));

    expect(renewals).toEqual([{
      status: "applied",
      brandId: scope.brandId,
      previousPlanCode: "starter",
      planCode: "growth",
      currentPeriodStart: new Date("2026-03-31T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-04-30T00:00:00.000Z"),
      cancelled: false,
    }]);
    const update = run.statements.find(({ sql }) => sql.startsWith("update brand_subscriptions"));
    expect(update?.values).toEqual([
      scope.brandId,
      "growth",
      "2026-03-31T00:00:00.000Z",
      "2026-04-30T00:00:00.000Z",
      "active",
    ]);
  });

  it("cancels at period end without advancing dates or inventing a plan", async () => {
    const run = harness((sql) => {
      if (sql.startsWith("select subscription.brand_id")) return {
        rows: [{
          brand_id: scope.brandId,
          plan_code: "starter",
          pending_plan_code: "growth",
          status: "cancel_scheduled",
          cancel_at_period_end: true,
          current_plan_active: false,
          pending_plan_active: false,
          started_at: "2026-03-01T00:00:00.000Z",
          current_period_start: "2026-03-01T00:00:00.000Z",
          current_period_end: "2026-04-01T00:00:00.000Z",
        }],
        rowCount: 1,
      };
      if (sql.startsWith("update brand_subscriptions")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const [renewal] = await createPublishCalendarRepository(run.pool)
      .applyDueSubscriptionRenewals(new Date("2026-04-20T00:00:00.000Z"));

    expect(renewal).toMatchObject({ planCode: "starter", cancelled: true });
    const update = run.statements.find(({ sql }) => sql.startsWith("update brand_subscriptions"));
    expect(update?.values).toEqual([
      scope.brandId,
      "starter",
      "2026-03-01T00:00:00.000Z",
      "2026-04-01T00:00:00.000Z",
      "cancelled",
    ]);
    const selection = run.statements.find(({ sql }) => sql.startsWith("select subscription.brand_id"));
    expect(selection?.sql).toContain("join billing_plan_catalog current_plan on current_plan.code=subscription.plan_code");
    expect(selection?.sql).not.toContain("current_plan.code=subscription.plan_code and current_plan.active");
  });

  it("uses the original subscription day for a later month-end catch-up", async () => {
    const run = harness((sql) => {
      if (sql.startsWith("select subscription.brand_id")) return {
        rows: [{
          brand_id: scope.brandId,
          plan_code: "starter",
          pending_plan_code: null,
          status: "active",
          cancel_at_period_end: false,
          started_at: "2026-01-31T00:00:00.000Z",
          current_period_start: "2026-03-31T00:00:00.000Z",
          current_period_end: "2026-04-30T00:00:00.000Z",
        }],
        rowCount: 1,
      };
      if (sql.startsWith("update brand_subscriptions")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const [renewal] = await createPublishCalendarRepository(run.pool)
      .applyDueSubscriptionRenewals(new Date("2026-05-05T00:00:00.000Z"));

    expect(renewal.status).toBe("applied");
    if (renewal.status !== "applied") throw new Error("expected_applied_renewal");
    expect(renewal.currentPeriodStart).toEqual(new Date("2026-04-30T00:00:00.000Z"));
    expect(renewal.currentPeriodEnd).toEqual(new Date("2026-05-31T00:00:00.000Z"));
  });

  it("isolates an invalid plan renewal and still renews the next due brand", async () => {
    const invalidBrandId = "20000000-0000-4000-8000-000000000011";
    const validBrandId = "20000000-0000-4000-8000-000000000012";
    const updatedBrands: string[] = [];
    const run = harness((sql, values) => {
      if (sql.startsWith("select subscription.brand_id")) return {
        rows: [
          {
            brand_id: invalidBrandId,
            plan_code: "starter",
            pending_plan_code: "inactive_growth",
            status: "active",
            cancel_at_period_end: false,
            current_plan_active: true,
            pending_plan_active: false,
            started_at: "2026-01-01T00:00:00.000Z",
            current_period_start: "2026-03-01T00:00:00.000Z",
            current_period_end: "2026-04-01T00:00:00.000Z",
          },
          {
            brand_id: validBrandId,
            plan_code: "starter",
            pending_plan_code: "growth",
            status: "active",
            cancel_at_period_end: false,
            current_plan_active: true,
            pending_plan_active: true,
            started_at: "2026-01-01T00:00:00.000Z",
            current_period_start: "2026-03-01T00:00:00.000Z",
            current_period_end: "2026-04-01T00:00:00.000Z",
          },
        ],
        rowCount: 2,
      };
      if (sql.startsWith("update brand_subscriptions")) {
        updatedBrands.push(String(values[0]));
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const results = await createPublishCalendarRepository(run.pool)
      .applyDueSubscriptionRenewals(new Date("2026-04-20T00:00:00.000Z"));

    expect(results).toEqual([
      {
        status: "failed",
        brandId: invalidBrandId,
        previousPlanCode: "starter",
        errorCode: "subscription_renewal_plan_inactive",
      },
      expect.objectContaining({
        status: "applied",
        brandId: validBrandId,
        previousPlanCode: "starter",
        planCode: "growth",
      }),
    ]);
    expect(updatedBrands).toEqual([validBrandId]);
    const sql = run.statements.map(({ sql }) => sql);
    expect(sql.filter((value) => value.startsWith("savepoint publish_calendar_renewal_brand"))).toHaveLength(2);
    expect(sql).toContain("rollback to savepoint publish_calendar_renewal_brand");
    expect(sql.at(-1)).toBe("commit");
  });
});
