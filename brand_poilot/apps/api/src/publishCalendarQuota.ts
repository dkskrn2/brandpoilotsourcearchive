const KST_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1_000;
const WEEK_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;

export interface SubscriptionWeekWindow {
  startsAt: Date;
  endsAt: Date;
}

export function subscriptionWeekWindow({
  subscriptionStartedAt,
  now,
}: {
  subscriptionStartedAt: Date;
  now: Date;
}): SubscriptionWeekWindow {
  const startedAtMilliseconds = subscriptionStartedAt.getTime();
  const nowMilliseconds = now.getTime();
  if (!Number.isFinite(startedAtMilliseconds) || !Number.isFinite(nowMilliseconds)) {
    throw new Error("subscription_week_date_invalid");
  }
  if (nowMilliseconds < startedAtMilliseconds) {
    throw new Error("subscription_week_before_start");
  }

  const shiftedStart = new Date(startedAtMilliseconds + KST_OFFSET_MILLISECONDS);
  const anchorMilliseconds = Date.UTC(
    shiftedStart.getUTCFullYear(),
    shiftedStart.getUTCMonth(),
    shiftedStart.getUTCDate(),
  ) - KST_OFFSET_MILLISECONDS;
  const elapsedWeeks = Math.floor((nowMilliseconds - anchorMilliseconds) / WEEK_MILLISECONDS);
  const startsAtMilliseconds = anchorMilliseconds + elapsedWeeks * WEEK_MILLISECONDS;
  return {
    startsAt: new Date(startsAtMilliseconds),
    endsAt: new Date(startsAtMilliseconds + WEEK_MILLISECONDS),
  };
}

export interface UsageAvailability {
  limit: number;
  succeeded: number;
  reserved: number;
  remaining: number;
  additionalAvailable: number;
}

export function usageAvailability({
  limit,
  succeeded,
  reserved,
}: {
  limit: number;
  succeeded: number;
  reserved: number;
}): UsageAvailability {
  if (![limit, succeeded, reserved].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error("usage_counter_invalid");
  }
  return {
    limit,
    succeeded,
    reserved,
    remaining: Math.max(0, limit - succeeded),
    additionalAvailable: Math.max(0, limit - succeeded - reserved),
  };
}

export function reservePublicationUnit(availability: UsageAvailability): UsageAvailability | null {
  if (availability.additionalAvailable < 1) return null;
  return usageAvailability({
    limit: availability.limit,
    succeeded: availability.succeeded,
    reserved: availability.reserved + 1,
  });
}
