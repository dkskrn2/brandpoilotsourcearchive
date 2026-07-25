import { describe, expect, it } from "vitest";
import { isSourceCrawlDue, nextRetryAt, scheduledRunKey } from "./sourceCrawlSchedule.js";

describe("source crawl schedule", () => {
  const now = new Date("2026-07-12T00:00:00.000Z");

  it("includes a source after 72 hours", () => {
    expect(isSourceCrawlDue("2026-07-09T00:00:00.000Z", now)).toBe(true);
    expect(isSourceCrawlDue("2026-07-09T00:00:01.000Z", now)).toBe(false);
  });

  it("does not use null as a scheduled first crawl", () => {
    expect(isSourceCrawlDue(null, now)).toBe(false);
  });

  it("uses 15 minutes, 1 hour, and 6 hours for retries", () => {
    expect(nextRetryAt(1, now)?.toISOString()).toBe("2026-07-12T00:15:00.000Z");
    expect(nextRetryAt(2, now)?.toISOString()).toBe("2026-07-12T01:00:00.000Z");
    expect(nextRetryAt(3, now)?.toISOString()).toBe("2026-07-12T06:00:00.000Z");
    expect(nextRetryAt(4, now)).toBeNull();
  });

  it("creates a stable KST date key per source", () => {
    expect(scheduledRunKey("source-1", new Date("2026-07-11T23:05:00.000Z")))
      .toBe("scheduled:source-1:2026-07-12");
  });
});
