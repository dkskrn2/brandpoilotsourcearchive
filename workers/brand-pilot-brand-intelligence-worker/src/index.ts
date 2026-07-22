import "dotenv/config";
import { createClient } from "./client.js";
import {
  createCodexRunner,
  runBrandIntelligenceOnce,
  runBrandIntelligenceWatchIteration,
} from "./worker.js";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_required`);
  return value;
};

async function main() {
  const mode = process.argv[2] ?? "watch";
  if (mode !== "watch" && mode !== "once") throw new Error("brand_intelligence_worker_command_invalid");
  const workerId = process.env.BRAND_INTELLIGENCE_WORKER_ID?.trim() || `brand-intelligence-${process.pid}`;
  const leaseSeconds = Math.max(30, Math.min(900, Number(process.env.BRAND_INTELLIGENCE_LEASE_SECONDS ?? 900)));
  const apiTimeoutMs = Math.max(15_000, Number(process.env.BRAND_INTELLIGENCE_API_TIMEOUT_MS ?? 300_000));
  const pollMs = Math.max(250, Number(process.env.BRAND_INTELLIGENCE_POLL_MS ?? 5_000));
  const client = createClient(required("BRAND_PILOT_API_URL"), required("WORKER_API_TOKEN"), fetch, apiTimeoutMs);
  const runner = createCodexRunner({
    timeoutMs: Math.max(1_000, Number(process.env.BRAND_INTELLIGENCE_CODEX_TIMEOUT_MS ?? 900_000)),
  });
  do {
    const runOnce = () => runBrandIntelligenceOnce({ client, runner, workerId, leaseSeconds, pollMs });
    const result = mode === "once"
      ? await runOnce()
      : await runBrandIntelligenceWatchIteration({
          runOnce,
          pollMs,
          onError: (error) => {
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(`${message}\n`);
          },
        });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (mode === "once") return;
  } while (true);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
