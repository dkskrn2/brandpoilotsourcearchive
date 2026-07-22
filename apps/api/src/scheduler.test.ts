import { describe, expect, it, vi } from "vitest";
import { runSchedulerTick } from "./scheduler.js";
import { runDailyTopicGeneration } from "./topicPublishGroups.js";
import type { ApiRepository } from "./types.js";

function repositoryForScheduler() {
  return {
    crawlDueSources: vi.fn(async () => ({ brandsSelected: 0, runsStarted: 0, processed: 0, created: 0, updated: 0, failed: 0, status: "succeeded" as const })),
    runDailyGeneration: vi.fn(async () => ({ brandsSelected: 0, runsStarted: 0, processed: 0, created: 0, updated: 0, failed: 0, status: "succeeded" as const })),
    runDailyPerformanceSync: vi.fn(async () => ({ status: "not_due" as const, runDate: "2026-07-13", channelsSelected: 0, runsStarted: 0, targetCount: 0, successCount: 0, failureCount: 0 })),
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

  it("keeps crawl, generation, and publishing sequential while performance sync runs independently", async () => {
    const repository = repositoryForScheduler();
    const order: string[] = [];
    let finishPerformance!: () => void;
    const performancePending = new Promise<void>((resolve) => {
      finishPerformance = resolve;
    });
    vi.mocked(repository.crawlDueSources).mockImplementation(async () => {
      order.push("crawl:start");
      await Promise.resolve();
      order.push("crawl:end");
      return { brandsSelected: 0, runsStarted: 0, processed: 0, created: 0, updated: 0, failed: 0, status: "succeeded" };
    });
    vi.mocked(repository.runDailyGeneration).mockImplementation(async () => {
      order.push("generation:start");
      await Promise.resolve();
      order.push("generation:end");
      return { brandsSelected: 0, runsStarted: 0, processed: 0, created: 0, updated: 0, failed: 0, status: "succeeded" };
    });
    vi.mocked(repository.runDailyPerformanceSync).mockImplementation(async () => {
      await performancePending;
      return { status: "not_due", runDate: "2026-07-13", channelsSelected: 0, runsStarted: 0, targetCount: 0, successCount: 0, failureCount: 0 };
    });
    vi.mocked(repository.runDuePublishing).mockImplementation(async () => {
      order.push("publishing:start");
      return { processed: 0, created: 0, updated: 0, failed: 0 };
    });

    const tick = runSchedulerTick(repository, new Date("2026-07-13T01:00:00.000Z"));
    await vi.waitFor(() => expect(repository.runDuePublishing).toHaveBeenCalledTimes(1));

    expect(order).toEqual([
      "crawl:start",
      "crawl:end",
      "generation:start",
      "generation:end",
      "publishing:start"
    ]);

    finishPerformance();
    await tick;
  });

  it("checks due publishing every minute without rerunning generation", async () => {
    const repository = repositoryForScheduler();
    const now = new Date("2026-07-13T01:01:00.000Z");
    await runSchedulerTick(repository, now);

    expect(repository.crawlDueSources).not.toHaveBeenCalled();
    expect(repository.runDailyGeneration).not.toHaveBeenCalled();
    expect(repository.runDailyPerformanceSync).toHaveBeenCalledTimes(1);
    expect(repository.runDailyPerformanceSync).toHaveBeenCalledWith(now);
    expect(repository.runDuePublishing).toHaveBeenCalledTimes(1);
  });

  it("publishes due work and exposes the error when performance sync rejects", async () => {
    const repository = repositoryForScheduler();
    const now = new Date("2026-07-13T01:01:00.000Z");
    const publishing = { processed: 1, created: 1, updated: 0, failed: 0 };
    vi.mocked(repository.runDailyPerformanceSync).mockRejectedValue(new Error("performance sync failed"));
    vi.mocked(repository.runDuePublishing).mockResolvedValue(publishing);

    const result = await runSchedulerTick(repository, now);

    expect(repository.runDuePublishing).toHaveBeenCalledWith(now);
    expect(result).toMatchObject({
      performance: { error: "performance sync failed" },
      publishing
    });
  });

  it("does not let a stalled performance sync block publishing or the scheduler tick", async () => {
    const repository = repositoryForScheduler();
    vi.mocked(repository.runDailyPerformanceSync).mockImplementation(() => new Promise(() => {}));

    const result = await runSchedulerTick(repository, new Date("2026-07-13T01:01:00.000Z"), {
      performanceTimeoutMs: 10,
    });

    expect(repository.runDuePublishing).toHaveBeenCalledTimes(1);
    expect(result.performance).toEqual({ error: "performance_sync_timeout" });
  });
});
