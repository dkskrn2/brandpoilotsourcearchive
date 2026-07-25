export type PublishManagementStatus =
  | "generating"
  | "needs_review"
  | "queued"
  | "publish_queued"
  | "scheduled"
  | "publishing"
  | "completed"
  | "failed"
  | "rejected";

export type PublishManagementFilterId =
  | "all"
  | "preparing"
  | "needs_review"
  | "upcoming"
  | "completed"
  | "issues";

export const publishManagementFilters: ReadonlyArray<{
  id: PublishManagementFilterId;
  label: string;
}> = [
  { id: "all", label: "전체" },
  { id: "preparing", label: "준비 중" },
  { id: "needs_review", label: "검토 필요" },
  { id: "upcoming", label: "게시 예정" },
  { id: "completed", label: "완료" },
  { id: "issues", label: "문제" }
];

const groupedStatuses: Record<
  Exclude<PublishManagementFilterId, "all">,
  ReadonlySet<PublishManagementStatus>
> = {
  preparing: new Set(["generating", "queued"]),
  needs_review: new Set(["needs_review"]),
  upcoming: new Set(["publish_queued", "scheduled", "publishing"]),
  completed: new Set(["completed"]),
  issues: new Set(["failed", "rejected"])
};

export function matchesPublishManagementFilter(
  status: PublishManagementStatus,
  filter: PublishManagementFilterId
) {
  return filter === "all" || groupedStatuses[filter].has(status);
}

export function countPublishManagementFilters(statuses: PublishManagementStatus[]) {
  return Object.fromEntries(
    publishManagementFilters.map((filter) => [
      filter.id,
      statuses.filter((status) => matchesPublishManagementFilter(status, filter.id)).length
    ])
  ) as Record<PublishManagementFilterId, number>;
}
