import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  contentWorkerPollDelayMs,
  contentWorkerPollObservation,
  createCodexAccountPoolFromEnv,
} from "@brand-pilot/worker-runtime";
import { createTextWorkerClient, createWorkerClient, createWorkerResourceClient } from "./client.js";
import { createCodexTextGenerator } from "./codexTextRunner.js";
import { createConfiguredRenderer } from "./renderer.js";
import { createReelRenderer } from "./reelRenderer.js";
import { createBlobStorage } from "./storage.js";
import { createAiContentBlobStorage } from "./storage.js";
import { createAiContentRenderClient } from "./aiContentRenderClient.js";
import { createAiContentAssetRenderer } from "./aiContentAssetRenderer.js";
import { createAiContentVisualSessionRenderer } from "./aiContentVisualSessionRenderer.js";
import { finalizeAiContentPackage } from "./aiContentFinalizer.js";
import { createAiContentShutdownCoordinator, type AiContentWorkerExitSignal } from "./aiContentShutdown.js";
import { runTextOnce } from "./textWorker.js";
import { resolveAiContentLeaseTiming, runOnce } from "./worker.js";
import { withWorkerResourceLease } from "./resourceLease.js";
import { createProductImageImportClient } from "./productImageImportClient.js";
import { createProductImageImportStorage } from "./productImageImportStorage.js";
import { runProductImageImportOnce } from "./productImageImportWorker.js";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_required`);
  return value;
}

function waitForShutdownOrTimeout(timeoutMs: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    signal.addEventListener("abort", finish, { once: true });
  });
}

async function main() {
  let sigtermHandler: () => void = () => undefined;
  let sigintHandler: () => void = () => undefined;
  let signalListenersInstalled = false;
  const removeSignalListeners = () => {
    if (!signalListenersInstalled) return;
    signalListenersInstalled = false;
    process.removeListener("SIGTERM", sigtermHandler);
    process.removeListener("SIGINT", sigintHandler);
  };
  const configuredGraceMs = Number(process.env.AI_CONTENT_SHUTDOWN_GRACE_MS ?? "15000");
  const graceMs = Number.isFinite(configuredGraceMs)
    ? Math.min(60_000, Math.max(1_000, Math.floor(configuredGraceMs)))
    : 15_000;
  const shutdown = createAiContentShutdownCoordinator({
    graceMs,
    relaySignal: (signal: AiContentWorkerExitSignal) => {
      removeSignalListeners();
      process.kill(process.pid, signal);
    },
    setGraceTimer: (callback, delayMs) => setTimeout(callback, delayMs),
    clearGraceTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  });
  sigtermHandler = () => shutdown.handleSignal("SIGTERM");
  sigintHandler = () => shutdown.handleSignal("SIGINT");
  process.once("SIGTERM", sigtermHandler);
  process.once("SIGINT", sigintHandler);
  signalListenersInstalled = true;
  try {
  const mode = process.argv[2] ?? "run-once";
  const workerId = process.env.WORKER_ID ?? `image-worker-${process.pid}`;
  const apiConfig = { apiUrl: required("BRAND_PILOT_API_URL"), token: required("WORKER_API_TOKEN") };
  const client = createWorkerClient(apiConfig);
  const aiContentClient = createAiContentRenderClient(apiConfig);
  const productImageImportClient = createProductImageImportClient(apiConfig);
  const textClient = createTextWorkerClient(apiConfig);
  const resourceClient = createWorkerResourceClient(apiConfig);
  const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const textGenerator = createCodexTextGenerator({ rootDir: workerRoot });
  const blobToken = required("BLOB_READ_WRITE_TOKEN");
  const aiContentStorage = createAiContentBlobStorage({ token: blobToken });
  const productImageImportStorage = createProductImageImportStorage({ token: blobToken });
  const accountPool = await createCodexAccountPoolFromEnv(process.env);
  const aiContentRenderer = createAiContentAssetRenderer({
    accountPool,
    workerRoot,
    readOwned: (storagePath, constraints) => aiContentStorage.readOwned(storagePath, constraints),
    timeoutMs: Math.max(1000, Number(process.env.AI_CONTENT_ASSET_TIMEOUT_MS ?? "1200000")),
  });
  const aiContentVisualRenderer = createAiContentVisualSessionRenderer({
    accountPool,
    workerRoot,
    readOwned: (storagePath, constraints) => aiContentStorage.readOwned(storagePath, constraints),
    timeoutMs: Math.max(1000, Number(process.env.AI_CONTENT_ASSET_TIMEOUT_MS ?? "1200000")),
  });
  const renderer = createConfiguredRenderer({
    provider: process.env.IMAGE_PROVIDER ?? "command",
    commandTemplate: process.env.IMAGE_RENDER_COMMAND,
    commandTimeoutMs: Math.max(1000, Number(process.env.IMAGE_JOB_TIMEOUT_MS ?? "1200000")),
    nodeEnv: process.env.NODE_ENV
  });
  const reelRenderer = createReelRenderer();
  const storage = createBlobStorage({ token: blobToken, model: process.env.IMAGE_MODEL ?? "gpt-image-2" });
  const aiContentLeaseTiming = resolveAiContentLeaseTiming({
    heartbeatIntervalMs: Number(process.env.AI_CONTENT_HEARTBEAT_INTERVAL_MS ?? "60000"),
    leaseSeconds: Number(process.env.AI_CONTENT_LEASE_SECONDS ?? "180"),
  });
  const executeJob = async () => {
    const result = await runOnce({
      workerId,
      client,
      renderer,
      reelRenderer,
      storage,
      aiContentClient,
      aiContentRenderer,
      aiContentVisualRenderer,
      aiContentStorage,
      aiContentFinalizer: (job, signal) => finalizeAiContentPackage(job, aiContentStorage, undefined, signal),
      aiContentHeartbeatIntervalMs: aiContentLeaseTiming.heartbeatIntervalMs,
      aiContentLeaseSeconds: aiContentLeaseTiming.leaseSeconds,
      signal: shutdown.signal,
      onAiContentActivityChange: shutdown.onAiContentActivityChange,
      onVisualSessionTiming: (timing) => process.stdout.write(`${JSON.stringify({ type: "ai_content_visual_session_timing", ...timing })}\n`),
      runTextJob: async () => {
        const imported = await runProductImageImportOnce({
          workerId,
          client: productImageImportClient,
          upload: productImageImportStorage.upload,
          remove: productImageImportStorage.remove,
          leaseSeconds: aiContentLeaseTiming.leaseSeconds,
          heartbeatIntervalMs: aiContentLeaseTiming.heartbeatIntervalMs,
        });
        if (imported.status !== "idle") return imported;
        return runTextOnce({
          workerId,
          client: textClient,
          generator: textGenerator,
          heartbeatIntervalMs: Math.max(1000, Number(process.env.HEARTBEAT_INTERVAL_MS ?? "300000")),
          retryDelayMs: Math.max(1000, Number(process.env.TEXT_RETRY_DELAY_MS ?? process.env.IMAGE_RETRY_DELAY_MS ?? "300000"))
        });
      },
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
    const interval = contentWorkerPollDelayMs(process.env.POLL_INTERVAL_MS, 10_000);
    while (!shutdown.signal.aborted) {
      await execute().catch((error) => {
        process.stderr.write(`${JSON.stringify(contentWorkerPollObservation(error))}\n`);
      });
      if (shutdown.signal.aborted) break;
      await waitForShutdownOrTimeout(interval, shutdown.signal);
    }
    return;
  }
  if (!shutdown.signal.aborted) await execute();
  } finally {
    shutdown.dispose();
    removeSignalListeners();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
