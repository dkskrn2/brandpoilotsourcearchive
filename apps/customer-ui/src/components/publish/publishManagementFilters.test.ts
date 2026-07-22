import { describe, expect, it } from "vitest";
import {
  countPublishManagementFilters,
  matchesPublishManagementFilter,
  publishManagementFilters,
  type PublishManagementStatus
} from "./publishManagementFilters";

describe("publishManagementFilters", () => {
  const statuses: PublishManagementStatus[] = [
    "generating",
    "needs_review",
    "queued",
    "publish_queued",
    "scheduled",
    "publishing",
    "completed",
    "failed",
    "rejected"
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
      all: 9,
      preparing: 2,
      needs_review: 1,
      upcoming: 3,
      completed: 1,
      issues: 2
    });
  });
});
