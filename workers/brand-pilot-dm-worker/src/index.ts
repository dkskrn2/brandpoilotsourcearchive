import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDmWorkerClient } from "./client.js";
import { runCodexJson } from "./codexRunner.js";
import { createDmWorkerDb } from "./db.js";
import { createEmbedding } from "./embeddings.js";
import { readDirectFaqThresholds, runDmWorkerOnce, runWorkerCycle } from "./worker.js";
import { runProfileRefreshOnce } from "./profileRefresh.js";
import { runWikiBuildItemOnce } from "./wikiRefresh.js";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_required`);
  return value;
};

const workerId = process.env.WORKER_ID?.trim() || "dm-worker-pc-1";
const pollIntervalMs = Math.max(250, Number(process.env.POLL_INTERVAL_MS ?? 1000));
const timeoutMs = Math.max(1_000, Number(process.env.DM_CLI_TIMEOUT_MS ?? 30_000));
const curatorTimeoutMs = Math.max(1_000, Number(process.env.KNOWLEDGE_CURATOR_TIMEOUT_MS ?? 30_000));
const runtimeDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../runtime");
const api = createDmWorkerClient({ apiUrl: required("BRAND_PILOT_API_URL"), token: required("WORKER_API_TOKEN") });
const db = createDmWorkerDb(required("DM_WORKER_DATABASE_URL"));
const directFaqThresholds = readDirectFaqThresholds(process.env);
const common = {
  workerId,
  api,
  db,
  apiKey: required("OPENAI_API_KEY"),
  embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
  directFaqSimilarityThreshold: directFaqThresholds.similarity,
  directFaqMarginThreshold: directFaqThresholds.margin,
  runtimeDirectory,
  timeoutMs,
  runCodex: runCodexJson,
};

const runCycle = () => runWorkerCycle({
  runDm: () => runDmWorkerOnce(common),
  runProfile: () => runProfileRefreshOnce({ workerId, api }),
  runWiki: () => runWikiBuildItemOnce({
    workerId,
    db,
    embed: createEmbedding,
    apiKey: common.apiKey,
    embeddingModel: common.embeddingModel,
    embeddingVersion: process.env.OPENAI_EMBEDDING_VERSION?.trim() || "v1",
    curatorPromptVersion: process.env.KNOWLEDGE_CURATOR_PROMPT_VERSION?.trim() || "v1",
    runtimeDirectory,
    curatorTimeoutMs,
    runCodex: runCodexJson,
  }),
});

async function main() {
  if (process.argv[2] === "once") {
    console.log(await runCycle());
    await db.close();
    return;
  }
  while (true) {
    await runCycle().catch((error) => console.error("dm_worker_cycle_failed", error));
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

void main();
