import { describe, expect, it, vi } from "vitest";
import { runSchedulerTick } from "./scheduler.js";
import { runDailyTopicGeneration } from "./topicPublishGroups.js";
import type { ApiRepository } from "./types.js";

function repositoryForScheduler() {
  return {
    crawlDueSources: vi.fn(async () => ({ brandsSelected: 0, runsStarted: 0, processed: 0, created: 0, updated: 0, failed: 0, status: "succeeded" as const })),
    runDailyGeneration: vi.fn(async () => ({ brandsSelected: 0, runsStarted: 0, processed: 0, created: 0, updated: 0, failed: 0, status: "succeeded" as const })),
    runDuePublishing: vi.fn(async () => ({ processed: 0, created: 0, updated: 0, failed: 0 }))
  } as unknown as ApiRepository;
}

describe("local scheduler", () => {
  it("runs exactly four topic generations for a brand when each produces a topic", async () => {
    const generate = vi.fn(async () => ({ processed: 1, created: 2, updated: 1, failed: 0 }));

    const result = await runDailyTopicGeneration(generate);

    expect(generate).toHaveBeenCalledTimes(4);
    expect(result.processed).toBe(4);
  });

  it("stops brand topic generation after a zero-topic result", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ processed: 1, created: 1, updated: 1, failed: 0 })
      .mockResolvedValueOnce({ processed: 0, created: 0, updated: 0, failed: 0 });

    const result = await runDailyTopicGeneration(generate);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.processed).toBe(1);
  });

  it("runs due crawl, generation, and publishing at 10:00 KST", async () => {
    const repository = repositoryForScheduler();
    await runSchedulerTick(repository, new Date("2026-07-13T01:00:00.000Z"));

    expect(repository.crawlDueSources).toHaveBeenCalledTimes(1);
    expect(repository.runDailyGeneration).toHaveBeenCalledTimes(1);
    expect(repository.runDuePublishing).toHaveBeenCalledTimes(1);
  });

  it("checks due publishing every minute without rerunning generation", async () => {
    const repository = repositoryForScheduler();
    await runSchedulerTick(repository, new Date("2026-07-13T01:01:00.000Z"));

    expect(repository.crawlDueSources).not.toHaveBeenCalled();
    expect(repository.runDailyGeneration).not.toHaveBeenCalled();
    expect(repository.runDuePublishing).toHaveBeenCalledTimes(1);
  });
});
