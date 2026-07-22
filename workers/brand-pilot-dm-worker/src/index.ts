import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDmWorkerClient } from "./client.js";
import { runCodexJson } from "./codexRunner.js";
import { runWikiFinalizeOnce } from "./compiledWikiFinalize.js";
import { runCompiledWikiSourceItemOnce } from "./compiledWikiSource.js";
import { runWikiCompilationItemOnce } from "./compiledWikiWorker.js";
import { createDmWorkerDb } from "./db.js";
import { createEmbedding } from "./embeddings.js";
import { runDmWorkerOnce } from "./worker.js";
import { runProfileRefreshOnce } from "./profileRefresh.js";
import { runWikiMaintenanceOnce } from "./wikiMaintenance.js";
import { withWorkerResourceLease } from "./resourceLease.js";
import { resolveWorkerMode } from "./workerMode.js";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_required`);
  return value;
};

const command = process.argv[2] ?? "watch";
if (command !== "watch" && command !== "once") throw new Error("worker_command_invalid");
const workerMode = resolveWorkerMode(process.argv[3], process.env.WORKER_MODE);
const workerId = process.argv[4]?.trim() || process.env.WORKER_ID?.trim() || `${workerMode}-worker-${process.pid}`;
const pollIntervalMs = Math.max(250, Number(process.env.POLL_INTERVAL_MS ?? 1000));
const resourcePollIntervalMs = Math.max(100, Number(process.env.WORKER_RESOURCE_POLL_INTERVAL_MS ?? 1000));
const resourceHeartbeatIntervalMs = Math.max(1_000, Number(process.env.WORKER_RESOURCE_HEARTBEAT_INTERVAL_MS ?? 15_000));
const timeoutMs = Math.max(1_000, Number(process.env.DM_CLI_TIMEOUT_MS ?? 30_000));
const curatorTimeoutMs = Math.max(1_000, Number(process.env.KNOWLEDGE_CURATOR_TIMEOUT_MS ?? 30_000));
const wikiTimeoutMs = Math.max(1_000, Number(process.env.WIKI_CODEX_TIMEOUT_MS ?? 120_000));
const runtimeDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../runtime");
const api = createDmWorkerClient({ apiUrl: required("BRAND_PILOT_API_URL"), token: required("WORKER_API_TOKEN") });
const db = createDmWorkerDb(required("DM_WORKER_DATABASE_URL"));
const common = {
  workerId,
  api,
  db,
  apiKey: required("OPENAI_API_KEY"),
  embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
  runtimeDirectory,
  timeoutMs,
  heartbeatIntervalMs: Math.max(1_000, Number(process.env.HEARTBEAT_INTERVAL_MS ?? 5_000)),
  runCodex: runCodexJson,
  withCodexLease: <T>(task: () => Promise<T>, onWait: () => Promise<unknown>) => withWorkerResourceLease({
    client: api,
    workerId,
    workload: "dm",
    pollIntervalMs: resourcePollIntervalMs,
    heartbeatIntervalMs: resourceHeartbeatIntervalMs,
    onWait,
  }, task),
};
const wikiVersions = {
  embeddingModel: common.embeddingModel,
  embeddingVersion: process.env.OPENAI_EMBEDDING_VERSION?.trim() || "v1",
  curatorPromptVersion: process.env.KNOWLEDGE_CURATOR_PROMPT_VERSION?.trim() || "v1",
};
const runWikiCodex = (input: { prompt: string; runtimeDirectory: string; timeoutMs: number }) => runCodexJson({
  ...input,
  model: process.env.WIKI_CODEX_MODEL?.trim() || "gpt-5.4",
  reasoningEffort: process.env.WIKI_CODEX_REASONING_EFFORT?.trim() || "low",
  fastMode: process.env.WIKI_CODEX_FAST_MODE?.trim().toLowerCase() !== "false",
});

async function runDmLaneOnce() {
  const dm = await runDmWorkerOnce(common);
  if (dm.status !== "idle") return dm;
  return runProfileRefreshOnce({ workerId, api });
}

async function runWikiLaneWithoutResource() {
  const source = await runCompiledWikiSourceItemOnce({
    workerId,
    db,
    ...wikiVersions,
    runtimeDirectory,
    curatorTimeoutMs,
    runCodex: runWikiCodex,
  });
  if (source.status !== "idle") return source;
  const compilation = await runWikiCompilationItemOnce({
    workerId,
    db,
    runtimeDirectory,
    timeoutMs: wikiTimeoutMs,
    runCodex: runWikiCodex,
  });
  if (compilation.status !== "idle") return compilation;
  const finalization = await runWikiFinalizeOnce({
    workerId,
    db,
    apiKey: common.apiKey,
    embeddingModel: wikiVersions.embeddingModel,
    embeddingVersion: wikiVersions.embeddingVersion,
    embed: createEmbedding,
  });
  if (finalization.status !== "idle") return finalization;
  return runWikiMaintenanceOnce({
    db,
    runtimeDirectory,
    timeoutMs: wikiTimeoutMs,
    runCodex: runWikiCodex,
  });
}

function runWikiLaneOnce() {
  return withWorkerResourceLease({
    client: api,
    workerId,
    workload: "wiki",
    pollIntervalMs: resourcePollIntervalMs,
    heartbeatIntervalMs: resourceHeartbeatIntervalMs,
  }, runWikiLaneWithoutResource);
}

async function runLane(run: () => Promise<{ status: string }>, label: string) {
  while (true) {
    await run().catch((error) => console.error(`${label}_cycle_failed`, error));
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

async function main() {
  const runSelectedLane = workerMode === "dm" ? runDmLaneOnce : runWikiLaneOnce;
  if (command === "once") {
    console.log(await runSelectedLane());
    await db.close();
    return;
  }
  await runLane(runSelectedLane, `${workerMode}_worker`);
}

void main();
