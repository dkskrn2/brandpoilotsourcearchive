export type PublishManagementStatus =
  | "action_required"
  | "preparing"
  | "upcoming"
  | "delayed_today"
  | "publishing"
  | "partially_published"
  | "published"
  | "cancelled";

export type PublishManagementFilterId =
  | "action_required"
  | "preparing"
  | "upcoming"
  | "completed"
  | "cancelled"
  | "all";

export const publishManagementFilters: ReadonlyArray<{
  id: PublishManagementFilterId;
  label: string;
}> = [
  { id: "action_required", label: "처리 필요" },
  { id: "preparing", label: "준비 중" },
  { id: "upcoming", label: "게시 예정" },
  { id: "completed", label: "완료" },
  { id: "cancelled", label: "취소" },
  { id: "all", label: "전체" }
];

const groupedStatuses: Record<
  Exclude<PublishManagementFilterId, "all">,
  ReadonlySet<PublishManagementStatus>
> = {
  action_required: new Set(["action_required"]),
  preparing: new Set(["preparing"]),
  upcoming: new Set(["upcoming", "delayed_today", "publishing", "partially_published"]),
  completed: new Set(["published"]),
  cancelled: new Set(["cancelled"])
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
