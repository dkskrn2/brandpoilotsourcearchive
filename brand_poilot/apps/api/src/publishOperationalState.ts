import type {
  PublishItemStatus,
  PublishItemTargetDto,
  PublishOperationalState,
} from "./types.js";

export interface PublishOperationalStateInput {
  status: PublishItemStatus;
  scheduledFor: string | null;
  publicationProgress?: "none" | "partial" | "complete";
  targets: ReadonlyArray<Pick<PublishItemTargetDto, "status"> & { lastError?: string | null }>;
  lastError?: string | null;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const RESERVATION_EXPIRED_REASON = "reservation_expired_at_2359_kst";

function kstValue(value: Date): Date {
  return new Date(value.getTime() + KST_OFFSET_MS);
}

function kstDateKey(value: Date): string {
  return kstValue(value).toISOString().slice(0, 10);
}

function reachedKstExpiry(value: Date): boolean {
  const local = kstValue(value);
  return local.getUTCHours() === 23 && local.getUTCMinutes() >= 59;
}

export function derivePublishOperationalState(
  input: PublishOperationalStateInput,
  now: Date,
): PublishOperationalState {
  if (input.status === "result_unknown") {
    return { status: "action_required", reason: "result_unknown" };
  }
  if (input.status === "failed") {
    return { status: "action_required", reason: "publish_failed" };
  }
  if (input.status === "published") {
    return { status: "published", reason: "published" };
  }
  if (input.status === "cancelled") {
    const expired = input.lastError === RESERVATION_EXPIRED_REASON
      || input.targets.some((target) => target.lastError === RESERVATION_EXPIRED_REASON);
    return { status: "cancelled", reason: expired ? "reservation_expired" : "cancelled" };
  }

  const publishedCount = input.targets.filter((target) => target.status === "published").length;
  if (input.status === "partially_published"
    || input.publicationProgress === "partial"
    || (publishedCount > 0 && publishedCount < input.targets.length)) {
    return { status: "partially_published", reason: "partially_published" };
  }
  if (input.status === "publishing") {
    return { status: "publishing", reason: "publishing" };
  }

  const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;
  if (scheduledFor && Number.isFinite(scheduledFor.getTime())) {
    const scheduledDate = kstDateKey(scheduledFor);
    const currentDate = kstDateKey(now);
    if (scheduledDate === currentDate && reachedKstExpiry(now)) {
      return { status: "action_required", reason: "stale_reservation" };
    }
    if (scheduledFor.getTime() > now.getTime()) {
      return { status: "upcoming", reason: "future_reservation" };
    }
    if (scheduledDate === currentDate) {
      return { status: "delayed_today", reason: "reserved_time_passed" };
    }
    if (scheduledDate < currentDate) {
      return { status: "action_required", reason: "stale_reservation" };
    }
    return { status: "upcoming", reason: "future_reservation" };
  }

  return { status: "action_required", reason: "review_required" };
}
