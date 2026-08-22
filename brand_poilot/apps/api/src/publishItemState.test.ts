import { describe, expect, it } from "vitest";

import { aggregatePublishState } from "./publishItemState.js";

describe("aggregatePublishState", () => {
  it.each([
    [["scheduled", "deferred"], { status: "deferred", progress: "none" }],
    [["cancelled", "cancelled"], { status: "cancelled", progress: "none" }],
    [["published", "cancelled"], { status: "failed", progress: "partial" }],
    [["published", "failed"], { status: "failed", progress: "partial" }],
    [["published", "scheduled"], { status: "scheduled", progress: "partial" }],
    [["published", "published"], { status: "published", progress: "complete" }],
  ] as const)("reduces mixed targets %j", (statuses, expected) => {
    expect(aggregatePublishState(statuses)).toMatchObject(expected);
  });

  it.each([
    [["publish_delivery_unknown", "publishing"], "result_unknown"],
    [["failed", "publishing"], "failed"],
    [["cancelled", "published"], "failed"],
    [["publishing", "deferred"], "publishing"],
    [["deferred", "scheduled"], "deferred"],
    [["scheduled", "queued"], "scheduled"],
    [["queued"], "publish_queued"],
  ] as const)("uses the approved priority for %j", (statuses, status) => {
    expect(aggregatePublishState(statuses).status).toBe(status);
  });

  it("uses the latest target publication time only when publication is complete", () => {
    const targets = [
      { status: "published", publishedAt: "2026-08-20T01:00:00.000Z" },
      { status: "published", publishedAt: "2026-08-20T03:00:00.000Z" },
    ] as const;

    const result = aggregatePublishState(targets);

    expect(result).toMatchObject({
      status: "published",
      publishedAt: "2026-08-20T03:00:00.000Z",
      calendarDate: "2026-08-20T03:00:00.000Z",
      calendarPlacement: "dated",
    });
    expect(result.targets).toBe(targets);
  });

  it("uses the earliest effective time among active targets for a partial publication", () => {
    expect(aggregatePublishState([
      { status: "published", publishedAt: "2026-08-20T00:30:00.000Z" },
      { status: "scheduled", scheduledFor: "2026-08-21T04:00:00.000Z", effectiveScheduledFor: "2026-08-21T05:00:00.000Z" },
      { status: "deferred", scheduledFor: "2026-08-21T02:00:00.000Z", effectiveScheduledFor: "2026-08-21T03:00:00.000Z" },
    ])).toMatchObject({
      status: "deferred",
      progress: "partial",
      scheduledFor: "2026-08-21T02:00:00.000Z",
      effectiveScheduledFor: "2026-08-21T03:00:00.000Z",
      publishedAt: null,
      calendarDate: "2026-08-21T03:00:00.000Z",
      calendarPlacement: "dated",
    });
  });

  it("places a published and failed partial item on the latest published target time", () => {
    expect(aggregatePublishState([
      { status: "published", publishedAt: "2026-08-19T23:00:00.000Z" },
      { status: "published", publishedAt: "2026-08-20T02:00:00.000Z" },
      { status: "failed", scheduledFor: "2026-08-18T01:00:00.000Z" },
    ])).toMatchObject({
      status: "failed",
      progress: "partial",
      publishedAt: null,
      calendarDate: "2026-08-20T02:00:00.000Z",
      calendarPlacement: "dated",
    });
  });

  it("uses an active reservation date before queues exist", () => {
    expect(aggregatePublishState([], {
      contentStatus: "generating",
      hasActiveReservation: true,
      scheduledFor: "2026-08-23T01:00:00.000Z",
      schedulable: false,
    })).toMatchObject({
      publishStatus: "reserved",
      status: "reserved",
      scheduledFor: "2026-08-23T01:00:00.000Z",
      calendarDate: "2026-08-23T01:00:00.000Z",
      calendarPlacement: "dated",
    });
  });

  it("places a date-less eligible item in the unreserved tray", () => {
    expect(aggregatePublishState([], {
      contentStatus: "completed",
      schedulable: true,
    })).toMatchObject({
      publishStatus: "unreserved",
      status: "completed_unpublished",
      calendarDate: null,
      calendarPlacement: "unreserved",
    });
  });

  it.each(["failed", "cancelled"] as const)("keeps a date-less %s item hidden from the calendar", (targetStatus) => {
    expect(aggregatePublishState([{ status: targetStatus }], {
      contentStatus: "completed",
      schedulable: false,
    })).toMatchObject({
      status: targetStatus,
      calendarDate: null,
      calendarPlacement: "hidden",
    });
  });

  it.each([
    ["completed", "completed_unpublished"],
    ["generating", "generating"],
    ["pre_generation", "pre_generation"],
    ["failed", "failed"],
  ] as const)("falls back from %s content lifecycle to %s", (contentStatus, status) => {
    expect(aggregatePublishState([], { contentStatus, schedulable: false }).status).toBe(status);
  });

  it("maps an active waiting group without target queues to publish queued", () => {
    expect(aggregatePublishState([], {
      contentStatus: "completed",
      groupStatus: "ready",
      schedulable: false,
    })).toMatchObject({ status: "publish_queued", publishStatus: "publish_queued" });
  });

  it("keeps a waiting pre-generation slot reserved until its group becomes ready", () => {
    expect(aggregatePublishState([], {
      contentStatus: "pre_generation",
      groupStatus: "waiting",
      hasActiveReservation: true,
      scheduledFor: "2026-08-25T02:00:00.000Z",
      schedulable: false,
    })).toMatchObject({
      status: "reserved",
      publishStatus: "reserved",
      calendarDate: "2026-08-25T02:00:00.000Z",
    });
  });
});
