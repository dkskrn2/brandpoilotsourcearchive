import { describe, expect, it, vi } from "vitest";
import {
  DAILY_TOPIC_LIMIT,
  brandPolicyDateKey,
  dailyTopicCapacity,
  determineGenerationReadiness,
  runDailyTopicGeneration
} from "./topicPublishGroups.js";

describe("topic publish group generation policy", () => {
  it("limits a brand policy day to four topics", () => {
    expect(DAILY_TOPIC_LIMIT).toBe(4);
    expect(dailyTopicCapacity(3)).toBe(1);
    expect(dailyTopicCapacity(4)).toBe(0);
    expect(dailyTopicCapacity(8)).toBe(0);
  });

  it("uses the brand timezone for the policy date", () => {
    const now = new Date("2026-07-13T15:30:00.000Z");

    expect(brandPolicyDateKey(now, "Asia/Seoul")).toBe("2026-07-14");
    expect(brandPolicyDateKey(now, "America/Los_Angeles")).toBe("2026-07-13");
  });

  it("selects Instagram rotation only when Instagram and a format are enabled", () => {
    expect(determineGenerationReadiness(
      ["instagram", "threads"],
      ["instagram_feed_carousel", "instagram_story", "instagram_reel"],
      "instagram_feed_carousel"
    )).toEqual({ threads: true, instagramFormat: "instagram_story", canProduce: true });

    expect(determineGenerationReadiness(["instagram"], [], null)).toEqual({
      threads: false,
      instagramFormat: null,
      canProduce: false
    });
  });

  it("keeps Threads producible without advancing an unavailable Instagram format", () => {
    expect(determineGenerationReadiness(["instagram", "threads"], [], "instagram_reel")).toEqual({
      threads: true,
      instagramFormat: null,
      canProduce: true
    });
  });

  it("runs at most four generation calls and reports topics actually processed", async () => {
    const generate = vi.fn(async () => ({ processed: 1, created: 2, updated: 1, failed: 0 }));

    const result = await runDailyTopicGeneration(generate);

    expect(generate).toHaveBeenCalledTimes(4);
    expect(result).toEqual({ processed: 4, created: 8, updated: 4, failed: 0 });
  });

  it("stops generation after the first zero-topic result", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ processed: 1, created: 1, updated: 1, failed: 0 })
      .mockResolvedValueOnce({ processed: 0, created: 0, updated: 0, failed: 0, reason: "no_usable_topic" })
      .mockResolvedValue({ processed: 1, created: 1, updated: 1, failed: 0 });

    const result = await runDailyTopicGeneration(generate);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ processed: 1, created: 1, updated: 1, failed: 0 });
  });
});
