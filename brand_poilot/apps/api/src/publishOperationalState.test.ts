import { describe, expect, it } from "vitest";

import { derivePublishOperationalState } from "./publishOperationalState.js";

const now = new Date("2026-08-25T06:00:00.000Z");

describe("derivePublishOperationalState", () => {
  it.each([
    [{ status: "scheduled", scheduledFor: "2026-08-26T02:30:00.000Z", targets: [{ status: "scheduled" }] },
      { status: "upcoming", reason: "future_reservation" }],
    [{ status: "publish_queued", scheduledFor: "2026-08-25T02:30:00.000Z", targets: [{ status: "queued" }] },
      { status: "delayed_today", reason: "reserved_time_passed" }],
    [{ status: "publish_queued", scheduledFor: "2026-08-24T02:30:00.000Z", targets: [{ status: "queued" }] },
      { status: "action_required", reason: "stale_reservation" }],
    [{
      status: "scheduled",
      scheduledFor: "2026-08-26T02:30:00.000Z",
      publicationProgress: "partial",
      targets: [{ status: "published" }, { status: "scheduled" }],
    }, { status: "partially_published", reason: "partially_published" }],
    [{ status: "failed", scheduledFor: "2026-08-25T02:30:00.000Z", targets: [{ status: "failed" }] },
      { status: "action_required", reason: "publish_failed" }],
    [{
      status: "result_unknown",
      scheduledFor: "2026-08-25T02:30:00.000Z",
      targets: [{ status: "publishing", lastError: "publish_delivery_unknown" }],
    }, { status: "action_required", reason: "result_unknown" }],
    [{
      status: "published",
      scheduledFor: "2026-08-25T02:30:00.000Z",
      publicationProgress: "complete",
      targets: [{ status: "published" }],
    }, { status: "published", reason: "published" }],
    [{ status: "cancelled", scheduledFor: "2026-08-25T02:30:00.000Z", targets: [{ status: "cancelled" }] },
      { status: "cancelled", reason: "cancelled" }],
  ] as const)("projects stored publish state %#", (input, expected) => {
    expect(derivePublishOperationalState(input, now)).toEqual(expected);
  });

  it("keeps the exact 23:59 KST expiry boundary truthful without mutating lifecycle state", () => {
    const input = {
      status: "publish_queued",
      scheduledFor: "2026-08-25T02:30:00.000Z",
      targets: [{ status: "queued" }],
    } as const;

    expect(derivePublishOperationalState(input, new Date("2026-08-25T14:58:59.999Z")))
      .toEqual({ status: "delayed_today", reason: "reserved_time_passed" });
    expect(derivePublishOperationalState(input, new Date("2026-08-25T14:59:00.000Z")))
      .toEqual({ status: "action_required", reason: "stale_reservation" });
  });

  it("distinguishes a persisted 23:59 expiry from a user cancellation", () => {
    expect(derivePublishOperationalState({
      status: "cancelled",
      scheduledFor: "2026-08-25T02:30:00.000Z",
      targets: [{ status: "cancelled" }],
      lastError: "reservation_expired_at_2359_kst",
    }, now)).toEqual({ status: "cancelled", reason: "reservation_expired" });
  });

  it("projects provider execution and review work explicitly", () => {
    expect(derivePublishOperationalState({
      status: "publishing",
      scheduledFor: "2026-08-25T02:30:00.000Z",
      targets: [{ status: "publishing" }],
    }, now)).toEqual({ status: "publishing", reason: "publishing" });
    expect(derivePublishOperationalState({
      status: "completed_unpublished",
      scheduledFor: null,
      targets: [],
    }, now)).toEqual({ status: "action_required", reason: "review_required" });
  });
});
