import "dotenv/config";
import { createClient } from "./client.js";
import { createCommandRunner, runOnce } from "./worker.js";

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`${name}_required`); return value; }
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const mode = process.argv[2] ?? "run-once";
  const workerId = process.env.CARD_NEWS_WORKER_ID ?? `card-news-${process.pid}`;
  const client = createClient(required("BRAND_PILOT_API_URL"), required("WORKER_API_TOKEN"));
  const planner = createCommandRunner(process.env.CARD_NEWS_CODEX_PLAN_COMMAND ?? "node scripts/run-codex-card-news-v2-plan.mjs --job \"{{jobFile}}\" --output \"{{outputDir}}\"", Math.max(1_000, Number(process.env.CARD_NEWS_CODEX_PLAN_TIMEOUT_MS ?? 300_000)));
  const shutdown = new AbortController();
  process.once("SIGINT", () => shutdown.abort());
  process.once("SIGTERM", () => shutdown.abort());
  const execute = () => runOnce({ workerId, client, planner, shutdownSignal: shutdown.signal });
  if (mode === "watch") {
    const pollMs = Math.max(1_000, Number(process.env.CARD_NEWS_WORKER_POLL_MS ?? 10_000));
    while (!shutdown.signal.aborted) { process.stdout.write(`${JSON.stringify(await execute().catch((error) => ({ status: "error", error: error instanceof Error ? error.message : String(error) })))}\n`); if (!shutdown.signal.aborted) await wait(pollMs); }
    return;
  }
  process.stdout.write(`${JSON.stringify(await execute())}\n`);
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
