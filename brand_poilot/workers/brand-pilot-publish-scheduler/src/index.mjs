import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createScheduler, loadConfig } from "./scheduler.mjs";

const defaultLogger = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`);

export async function startProcess({
  processLike = process,
  readSecretFile = readFile,
  schedulerFactory = createScheduler,
  logger = defaultLogger,
} = {}) {
  const config = await loadConfig(processLike.env, readSecretFile);
  const scheduler = schedulerFactory({ config, logger });
  processLike.once("SIGTERM", () => {
    logger({ event: "publish_scheduler_stopping" });
    scheduler.stop();
  });
  await scheduler.start();
  return scheduler;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  startProcess().catch(() => {
    defaultLogger({ event: "publish_scheduler_start_failed" });
    process.exitCode = 1;
  });
}
