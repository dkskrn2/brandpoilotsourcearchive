import "dotenv/config";
import { createClient } from "./client.js";
import { createCommandRunner, runOnce } from "./worker.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_required`);
  return value;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const mode = process.argv[2] ?? "run-once";
  const workerId = process.env.BLOG_WORKER_ID ?? `blog-${process.pid}`;
  const shutdown = new AbortController();
  process.once("SIGINT", () => shutdown.abort());
  process.once("SIGTERM", () => shutdown.abort());
  const client = createClient(required("BRAND_PILOT_API_URL"), required("WORKER_API_TOKEN"));
  const runner = createCommandRunner(
    process.env.BLOG_CODEX_PLAN_COMMAND ?? "node scripts/run-codex-blog-v2-plan.mjs --job \"{{jobFile}}\" --output \"{{outputDir}}\"",
    Math.max(1_000, Number(process.env.BLOG_CODEX_PLAN_TIMEOUT_MS ?? 300_000)),
  );
  const execute = () => runOnce({ workerId, client, runner, shutdownSignal: shutdown.signal });
  if (mode === "watch") {
    while (!shutdown.signal.aborted) {
      process.stdout.write(`${JSON.stringify(await execute())}\n`);
      if (!shutdown.signal.aborted) await wait(Math.max(1_000, Number(process.env.BLOG_WORKER_POLL_MS ?? 10_000)));
    }
    return;
  }
  process.stdout.write(`${JSON.stringify(await execute())}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
