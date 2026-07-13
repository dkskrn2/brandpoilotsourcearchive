const crawlIntervalMs = 72 * 60 * 60 * 1000;
const retryDelayMs = [15 * 60 * 1000, 60 * 60 * 1000, 6 * 60 * 60 * 1000] as const;

export function isSourceCrawlDue(lastSuccessfulAt: string | null, now = new Date()) {
  if (!lastSuccessfulAt) return false;
  const timestamp = Date.parse(lastSuccessfulAt);
  return Number.isFinite(timestamp) && now.getTime() - timestamp >= crawlIntervalMs;
}

export function nextRetryAt(attempt: number, now = new Date()) {
  const delay = retryDelayMs[attempt - 1];
  return delay === undefined ? null : new Date(now.getTime() + delay);
}

export function kstDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function scheduledRunKey(sourceId: string, now = new Date()) {
  return `scheduled:${sourceId}:${kstDate(now)}`;
}
