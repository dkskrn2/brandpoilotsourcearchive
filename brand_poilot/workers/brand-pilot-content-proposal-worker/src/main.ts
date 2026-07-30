import "dotenv/config";
import { createCodexContentProposalModel } from "./codexModel.js";
import { createContentProposalApiClient } from "./client.js";
import {
  createContentProposalRunner,
  runContentProposalOnce,
  runContentProposalWatchIteration,
} from "./worker.js";
import { startWorkerInstanceHeartbeat } from "./instanceHeartbeat.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_required`);
  return value;
}

function boundedNumber(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed)) throw new Error(`${name}_invalid`);
  return Math.max(minimum, Math.min(maximum, parsed));
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "watch";
  if (mode !== "watch" && mode !== "once") {
    throw new Error("content_proposal_worker_command_invalid");
  }
  const controller = new AbortController();
  const shutdown = () => controller.abort();
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  const workerId = process.env.CONTENT_PROPOSAL_WORKER_ID?.trim()
    || `content-proposal-${process.pid}`;
  const leaseSeconds = boundedNumber("CONTENT_PROPOSAL_LEASE_SECONDS", 180, 30, 900);
  const pollMs = boundedNumber("CONTENT_PROPOSAL_POLL_MS", 5_000, 250, 60_000);
  const heartbeatMs = boundedNumber(
    "CONTENT_PROPOSAL_HEARTBEAT_MS",
    Math.min(30_000, leaseSeconds * 500),
    1_000,
    Math.max(1_000, leaseSeconds * 750),
  );
  const instanceHeartbeatMs = boundedNumber(
    "CONTENT_PROPOSAL_INSTANCE_HEARTBEAT_MS",
    5_000,
    1_000,
    60_000,
  );
  const client = createContentProposalApiClient(
    required("BRAND_PILOT_API_URL"),
    required("CONTENT_PROPOSAL_WORKER_API_TOKEN"),
    fetch,
    boundedNumber("CONTENT_PROPOSAL_API_TIMEOUT_MS", 300_000, 1_000, 900_000),
  );
  const runner = createContentProposalRunner(createCodexContentProposalModel({
    command: process.env.CONTENT_PROPOSAL_CODEX_COMMAND?.trim() || "codex",
    model: process.env.CONTENT_PROPOSAL_CODEX_MODEL?.trim() || "gpt-5.4",
    timeoutMs: boundedNumber(
      "CONTENT_PROPOSAL_CODEX_TIMEOUT_MS",
      300_000,
      1_000,
      900_000,
    ),
  }));
  const runOnce = () => runContentProposalOnce({
    client,
    runner,
    workerId,
    leaseSeconds,
    heartbeatMs,
    pollMs,
    signal: controller.signal,
  });

  let stopInstanceHeartbeat: (() => void) | undefined;
  try {
    if (mode === "once") {
      await client.heartbeatWorker(workerId);
    } else {
      stopInstanceHeartbeat = startWorkerInstanceHeartbeat({
        heartbeat: client.heartbeatWorker,
        workerId,
        intervalMs: instanceHeartbeatMs,
      });
    }
    do {
      const result = mode === "once"
        ? await runOnce()
        : await runContentProposalWatchIteration({
            runOnce,
            pollMs,
            signal: controller.signal,
            onError: (error) => {
              process.stderr.write(`${error.message}\n`);
            },
          });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (mode === "once" || result.status === "stopped") return;
      if ("jobId" in result && result.status === "completed") {
        // The next iteration may claim either manual or scheduled proposal jobs.
        continue;
      }
      if ("jobId" in result && result.status === "failed") continue;
      if ("jobId" in result && result.status === "lease_lost") continue;
    } while (!controller.signal.aborted);
  } finally {
    stopInstanceHeartbeat?.();
    process.removeListener("SIGTERM", shutdown);
    process.removeListener("SIGINT", shutdown);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
