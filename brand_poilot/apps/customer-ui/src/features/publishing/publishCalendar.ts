import type { ChannelType, PublishCalendarSlot } from "../../types";

export const PUBLISH_CALENDAR_USAGE_CHANGED_EVENT = "brand-pilot:publish-calendar-usage-changed";

export type CalendarEntry = {
  id: string;
  calendarDate: string;
  scheduledFor: string | null;
  effectiveScheduledFor: string | null;
  publishedAt: string | null;
  title: string;
  status: string;
  mode: "automatic" | "manual";
  channels: ChannelType[];
  recommendationKind?: "informational" | "trend" | null;
  contentFormat?: "card_news" | "reel";
  lastError?: string | null;
  cancellable?: boolean;
  reschedulable?: boolean;
};

const kst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });
const kstTime = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const kstDateTime = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function formatPublishDateTime(value: string | Date) {
  return kstDateTime.format(value instanceof Date ? value : new Date(value));
}

export function defaultScheduleTime(date: string, now = new Date(), preferredTimes: readonly string[] = []) {
  if (date === dateKey(now)) {
    const fiveMinutes = 5 * 60 * 1000;
    const earliest = new Date(Math.ceil((now.getTime() + 15 * 60 * 1000) / fiveMinutes) * fiveMinutes);
    return kstTime.format(earliest);
  }
  if (date > dateKey(now)) {
    const preferred = preferredTimes
      .filter((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time))
      .sort((left, right) => left.localeCompare(right))[0];
    if (preferred) return preferred;
  }
  return "11:30";
}

export function dateKey(value: string | Date) {
  const parts = kst.formatToParts(value instanceof Date ? value : new Date(value));
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
}

export function monthCells(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1, index - offset + 1));
    return { key: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`, day: date.getUTCDate(), current: date.getUTCMonth() === month - 1 };
  });
}

export function entryFromSlot(slot: PublishCalendarSlot): CalendarEntry {
  return {
    id: slot.id,
    calendarDate: slot.effectiveScheduledFor ?? slot.scheduledFor,
    scheduledFor: slot.scheduledFor,
    effectiveScheduledFor: slot.effectiveScheduledFor ?? slot.scheduledFor,
    publishedAt: slot.status === "published" ? slot.effectiveScheduledFor ?? slot.scheduledFor : null,
    title: slot.title ?? (slot.recommendationKind === "trend" ? "트렌드 추천 대기" : slot.recommendationKind === "informational" ? "정보성 추천 대기" : "수동 배정 대기"),
    status: slot.status,
    mode: slot.assignmentMode,
    channels: slot.channels,
    recommendationKind: slot.recommendationKind,
    contentFormat: slot.contentFormat,
    lastError: slot.lastError,
    cancellable: !["published", "cancelled", "publishing"].includes(slot.status),
    reschedulable: new Date(slot.scheduledFor).getTime() > Date.now()
      && !["published", "cancelled", "publishing", "publish_delayed"].includes(slot.status),
  };
}

export function timeLabel(entry: CalendarEntry) {
  return kstTime.format(new Date(entry.calendarDate));
}

export function monthPeriod(monthKey: string) {
  const cells = monthCells(monthKey);
  const from = new Date(`${cells[0].key}T00:00:00+09:00`);
  const to = new Date(`${cells.at(-1)!.key}T00:00:00+09:00`);
  to.setUTCDate(to.getUTCDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}
