import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDmWorkerClient } from "./client.js";
import { runCodexJson } from "./codexRunner.js";
import { createDmWorkerDb } from "./db.js";
import { createEmbedding } from "./embeddings.js";
import { runDmWorkerOnce } from "./worker.js";
import { refreshWiki } from "./wikiRefresh.js";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_required`);
  return value;
};

const workerId = process.env.WORKER_ID?.trim() || "dm-worker-pc-1";
const pollIntervalMs = Math.max(250, Number(process.env.POLL_INTERVAL_MS ?? 1000));
const timeoutMs = Math.max(1_000, Number(process.env.DM_CLI_TIMEOUT_MS ?? 10_000));
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
  runCodex: runCodexJson,
};

async function main() {
  if (process.argv[2] === "once") {
    const dm = await runDmWorkerOnce(common);
    const wiki = await refreshWiki({ workerId, db, embed: createEmbedding, apiKey: common.apiKey, model: common.embeddingModel });
    console.log({ dm, wiki });
    await db.close();
    return;
  }
  while (true) {
    await runDmWorkerOnce(common).catch((error) => console.error("dm_worker_cycle_failed", error));
    await refreshWiki({ workerId, db, embed: createEmbedding, apiKey: common.apiKey, model: common.embeddingModel }).catch((error) => console.error("wiki_refresh_cycle_failed", error));
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

void main();
