import type { PublishItem } from "../../types";
import type { CalendarEntry } from "./publishCalendar";

function sortTimestamp(item: PublishItem) {
  return Date.parse(item.calendarDate ?? item.createdAt);
}

export function sortPublishItems(left: PublishItem, right: PublishItem) {
  const byTime = sortTimestamp(right) - sortTimestamp(left);
  return byTime || left.itemKey.localeCompare(right.itemKey);
}

export function listItems(items: readonly PublishItem[]) {
  return [...items].sort(sortPublishItems);
}

export function datedItems(items: readonly PublishItem[]) {
  return items.filter((item) => item.calendarPlacement === "dated");
}

export function unreservedItems(items: readonly PublishItem[]) {
  return items.filter((item) => item.calendarPlacement === "unreserved");
}

export function entryFromPublishItem(item: PublishItem): CalendarEntry {
  if (!item.calendarDate || item.calendarPlacement !== "dated") {
    throw new Error("publish_item_not_dated");
  }
  return {
    id: item.itemKey,
    calendarDate: item.calendarDate,
    scheduledFor: item.scheduledFor,
    effectiveScheduledFor: item.effectiveScheduledFor,
    publishedAt: item.publishedAt,
    title: item.title,
    status: item.status,
    mode: item.assignmentMode === "automatic" ? "automatic" : "manual",
    channels: item.channels,
    contentFormat: item.contentFormat ?? undefined,
    lastError: item.lastError,
    cancellable: ["reserved", "publish_queued", "scheduled", "deferred"].includes(item.status)
  };
}
