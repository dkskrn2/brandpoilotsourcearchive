import type { ApiRepository } from "./types.js";
import { isDailyGenerationMinute } from "./publishSchedule.js";

async function captureTaskResult(
  result: Record<string, unknown>,
  key: string,
  task: () => Promise<unknown>,
  timeoutMs?: number,
  timeoutError = `${key}_timeout`,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const taskPromise = task();
    result[key] = timeoutMs === undefined
      ? await taskPromise
      : await Promise.race([
        taskPromise,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error(timeoutError)), timeoutMs);
        }),
      ]);
  } catch (error) {
    result[key] = { error: error instanceof Error ? error.message : "unknown_error" };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function runSchedulerTick(
  repository: ApiRepository,
  now = new Date(),
  { performanceTimeoutMs = 30_000 }: { performanceTimeoutMs?: number } = {},
) {
  const minute = now.getUTCMinutes();
  const result: Record<string, unknown> = {};
  const performanceTask = captureTaskResult(
    result,
    "performance",
    () => repository.runDailyPerformanceSync(now),
    performanceTimeoutMs,
    "performance_sync_timeout",
  );
  if (minute % 15 === 0) result.sourceCrawl = await repository.crawlDueSources(now);
  if (isDailyGenerationMinute(now)) result.dailyGeneration = await repository.runDailyGeneration(now);
  result.publishing = await repository.runDuePublishing(now);
  await performanceTask;
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
