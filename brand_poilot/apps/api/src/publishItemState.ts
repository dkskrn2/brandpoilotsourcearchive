import type { PublishItemStatus, PublishStatus } from "./types.js";

type TargetStatus = "queued" | "scheduled" | "publishing" | "published" | "failed" | "deferred"
  | "cancelled" | "publish_delivery_unknown" | "result_unknown";

export interface PublishStateTarget {
  status: TargetStatus;
  scheduledFor?: string | null;
  effectiveScheduledFor?: string | null;
  publishedAt?: string | null;
  lastError?: string | null;
}

export interface PublishStateContext {
  contentStatus?: "pre_generation" | "generating" | "completed" | "failed";
  groupStatus?: string | null;
  hasActiveReservation?: boolean;
  scheduledFor?: string | null;
  effectiveScheduledFor?: string | null;
  schedulable?: boolean;
}

export interface PublishStateResult<TTarget> {
  targets: readonly TTarget[];
  publishStatus: PublishStatus;
  status: PublishItemStatus;
  progress: "none" | "partial" | "complete";
  publicationProgress: "none" | "partial" | "complete";
  scheduledFor: string | null;
  effectiveScheduledFor: string | null;
  publishedAt: string | null;
  calendarDate: string | null;
  calendarPlacement: "dated" | "unreserved" | "hidden";
}

const minDate = (dates: Array<string | null | undefined>): string | null => {
  const available = dates.filter((value): value is string => Boolean(value));
  return available.length > 0 ? available.reduce((earliest, value) => value < earliest ? value : earliest) : null;
};

const maxDate = (dates: Array<string | null | undefined>): string | null => {
  const available = dates.filter((value): value is string => Boolean(value));
  return available.length > 0 ? available.reduce((latest, value) => value > latest ? value : latest) : null;
};

const activeTargetStatuses = new Set<TargetStatus>(["queued", "scheduled", "publishing", "deferred"]);
const activeGroupStatuses = new Set(["ready"]);

const normalizedTarget = (target: TargetStatus | PublishStateTarget): PublishStateTarget =>
  typeof target === "string" ? { status: target } : target;

export function aggregatePublishState<TTarget extends TargetStatus | PublishStateTarget>(
  targets: readonly TTarget[],
  context: PublishStateContext = {},
): PublishStateResult<TTarget> {
  const normalized = targets.map(normalizedTarget);
  const statuses = normalized.map((target) => target.status);
  const publishedCount = statuses.filter((status) => status === "published").length;
  const hasPublished = publishedCount > 0;
  const allPublished = targets.length > 0 && publishedCount === targets.length;
  const progress = allPublished ? "complete" : hasPublished ? "partial" : "none";
  const hasUnknown = normalized.some((target) =>
    target.status === "publish_delivery_unknown"
    || target.status === "result_unknown"
    || target.lastError === "publish_delivery_unknown"
  );
  const hasFailed = statuses.includes("failed");
  const hasCancelled = statuses.includes("cancelled");
  const allCancelled = targets.length > 0 && statuses.every((status) => status === "cancelled");
  const hasActiveTarget = statuses.some((status) => activeTargetStatuses.has(status));
  const hasActiveGroup = context.groupStatus ? activeGroupStatuses.has(context.groupStatus) : false;
  const hasActiveReservation = context.hasActiveReservation === true || hasActiveGroup;

  let publishStatus: PublishStatus;
  let status: PublishItemStatus;

  if (hasUnknown) publishStatus = status = "result_unknown";
  else if (hasFailed) publishStatus = status = "failed";
  else if (allCancelled && !hasActiveReservation) publishStatus = status = "cancelled";
  else if (hasCancelled && (hasPublished || hasActiveTarget)) publishStatus = status = "failed";
  else if (statuses.includes("publishing")) publishStatus = status = "publishing";
  else if (statuses.includes("deferred")) publishStatus = status = "deferred";
  else if (statuses.includes("scheduled")) publishStatus = status = "scheduled";
  else if (statuses.includes("queued") || hasActiveGroup) publishStatus = status = "publish_queued";
  else if (hasPublished && !allPublished) publishStatus = status = "partially_published";
  else if (allPublished) publishStatus = status = "published";
  else if (hasActiveReservation) publishStatus = status = "reserved";
  else {
    publishStatus = "unreserved";
    if (context.contentStatus === "completed") status = "completed_unpublished";
    else if (context.contentStatus === "generating") status = "generating";
    else if (context.contentStatus === "failed") status = "failed";
    else status = "pre_generation";
  }

  const activeTargets = normalized.filter((target) => activeTargetStatuses.has(target.status));
  const scheduledFor = minDate(activeTargets.map((target) => target.scheduledFor)) ?? context.scheduledFor ?? null;
  const effectiveScheduledFor = minDate(activeTargets.map((target) => target.effectiveScheduledFor ?? target.scheduledFor))
    ?? context.effectiveScheduledFor
    ?? scheduledFor;
  const latestPublishedTargetTime = maxDate(normalized
    .filter((target) => target.status === "published")
    .map((target) => target.publishedAt));
  const publishedAt = allPublished ? latestPublishedTargetTime : null;

  let calendarDate: string | null = null;
  if (status === "published") calendarDate = publishedAt;
  else if (["scheduled", "deferred", "publishing", "publish_queued"].includes(status) && effectiveScheduledFor) {
    calendarDate = effectiveScheduledFor;
  } else if (progress === "partial" && effectiveScheduledFor && hasActiveTarget) {
    calendarDate = effectiveScheduledFor;
  } else if (progress === "partial") {
    calendarDate = latestPublishedTargetTime;
  } else if (status === "reserved") {
    calendarDate = context.scheduledFor ?? null;
  }

  const calendarPlacement = calendarDate
    ? "dated"
    : context.schedulable === true
      ? "unreserved"
      : "hidden";

  return {
    targets,
    publishStatus,
    status,
    progress,
    publicationProgress: progress,
    scheduledFor,
    effectiveScheduledFor,
    publishedAt,
    calendarDate,
    calendarPlacement,
  };
}
