import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTextWorkerClient, createWorkerClient, createWorkerResourceClient } from "./client.js";
import { createCodexTextGenerator } from "./codexTextRunner.js";
import { createConfiguredRenderer } from "./renderer.js";
import { createReelRenderer } from "./reelRenderer.js";
import { createBlobStorage } from "./storage.js";
import { runTextOnce } from "./textWorker.js";
import { runOnce } from "./worker.js";
import { withWorkerResourceLease } from "./resourceLease.js";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_required`);
  return value;
}

async function main() {
  const mode = process.argv[2] ?? "run-once";
  const workerId = process.env.WORKER_ID ?? `image-worker-${process.pid}`;
  const apiConfig = { apiUrl: required("BRAND_PILOT_API_URL"), token: required("WORKER_API_TOKEN") };
  const client = createWorkerClient(apiConfig);
  const textClient = createTextWorkerClient(apiConfig);
  const resourceClient = createWorkerResourceClient(apiConfig);
  const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const textGenerator = createCodexTextGenerator({ rootDir: workerRoot });
  const renderer = createConfiguredRenderer({
    provider: process.env.IMAGE_PROVIDER ?? "command",
    commandTemplate: process.env.IMAGE_RENDER_COMMAND,
    commandTimeoutMs: Math.max(1000, Number(process.env.IMAGE_JOB_TIMEOUT_MS ?? "1200000")),
    nodeEnv: process.env.NODE_ENV
  });
  const reelRenderer = createReelRenderer();
  const storage = createBlobStorage({ token: required("BLOB_READ_WRITE_TOKEN"), model: process.env.IMAGE_MODEL ?? "external-image-cli" });
  const executeJob = async () => {
    const result = await runOnce({
      workerId,
      client,
      renderer,
      reelRenderer,
      storage,
      runTextJob: () => runTextOnce({
        workerId,
        client: textClient,
        generator: textGenerator,
        heartbeatIntervalMs: Math.max(1000, Number(process.env.HEARTBEAT_INTERVAL_MS ?? "300000")),
        retryDelayMs: Math.max(1000, Number(process.env.TEXT_RETRY_DELAY_MS ?? process.env.IMAGE_RETRY_DELAY_MS ?? "300000"))
      }),
      heartbeatIntervalMs: Math.max(1000, Number(process.env.HEARTBEAT_INTERVAL_MS ?? "300000")),
      retryDelayMs: Math.max(1000, Number(process.env.IMAGE_RETRY_DELAY_MS ?? "300000"))
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  };
  const execute = () => withWorkerResourceLease({
    client: resourceClient,
    workerId,
    workload: "content",
    pollIntervalMs: Math.max(100, Number(process.env.WORKER_RESOURCE_POLL_INTERVAL_MS ?? "1000")),
    heartbeatIntervalMs: Math.max(1000, Number(process.env.WORKER_RESOURCE_HEARTBEAT_INTERVAL_MS ?? "15000")),
  }, executeJob);
  if (mode === "watch") {
    const interval = Math.max(1000, Number(process.env.POLL_INTERVAL_MS ?? "10000"));
    for (;;) {
      await execute().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      });
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
  await execute();
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
