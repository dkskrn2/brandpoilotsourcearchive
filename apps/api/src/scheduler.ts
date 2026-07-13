import type { ApiRepository } from "./types.js";
import { isDailyGenerationMinute } from "./publishSchedule.js";

export async function runSchedulerTick(repository: ApiRepository, now = new Date()) {
  const minute = now.getUTCMinutes();
  const result: Record<string, unknown> = {};
  if (minute % 15 === 0) result.sourceCrawl = await repository.crawlDueSources(now);
  if (isDailyGenerationMinute(now)) result.dailyGeneration = await repository.runDailyGeneration(now);
  result.publishing = await repository.runDuePublishing(now);
  return result;
}

export function startLocalScheduler(repository: ApiRepository, intervalMs = 60_000) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runSchedulerTick(repository);
    } catch (error) {
      console.error("brand_pilot_scheduler_tick_failed", error instanceof Error ? error.message : "unknown_error");
    } finally {
      running = false;
    }
  };
  void tick();
  return setInterval(() => void tick(), intervalMs);
}
