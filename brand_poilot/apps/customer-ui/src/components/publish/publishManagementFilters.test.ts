import { describe, expect, it } from "vitest";
import {
  countPublishManagementFilters,
  matchesPublishManagementFilter,
  publishManagementFilters,
  type PublishManagementStatus
} from "./publishManagementFilters";

describe("publishManagementFilters", () => {
  const statuses: PublishManagementStatus[] = [
    "action_required",
    "preparing",
    "upcoming",
    "delayed_today",
    "publishing",
    "partially_published",
    "published",
    "cancelled"
  ];

  it("maps each internal status to exactly one visible group", () => {
    const visibleGroups = publishManagementFilters.filter((filter) => filter.id !== "all");

    for (const status of statuses) {
      expect(
        visibleGroups.filter((filter) => matchesPublishManagementFilter(status, filter.id))
      ).toHaveLength(1);
    }
  });

  it("counts grouped filters without losing rows", () => {
    expect(countPublishManagementFilters(statuses)).toEqual({
      action_required: 1,
      preparing: 1,
      upcoming: 4,
      completed: 1,
      cancelled: 1,
      all: 8
    });
  });

  it("keeps a previous-day active reservation in required work and out of upcoming", () => {
    const projectedPreviousDayReservation: PublishManagementStatus = "action_required";

    expect(matchesPublishManagementFilter(projectedPreviousDayReservation, "action_required")).toBe(true);
    expect(matchesPublishManagementFilter(projectedPreviousDayReservation, "upcoming")).toBe(false);
  });
});
