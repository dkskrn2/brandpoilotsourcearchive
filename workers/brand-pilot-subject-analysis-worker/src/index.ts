import "dotenv/config";
import { createClient } from "./client.js";
import { createCodexRunner, runSubjectAnalysisOnce } from "./worker.js";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_required`);
  return value;
};

async function main() {
  const mode = process.argv[2] ?? "watch";
  if (mode !== "watch" && mode !== "once") throw new Error("subject_analysis_worker_command_invalid");
  const workerId = process.env.SUBJECT_ANALYSIS_WORKER_ID?.trim() || `subject-analysis-${process.pid}`;
  const leaseSeconds = Math.max(30, Math.min(900, Number(process.env.SUBJECT_ANALYSIS_LEASE_SECONDS ?? 900)));
  const client = createClient(required("BRAND_PILOT_API_URL"), required("WORKER_API_TOKEN"));
  const runner = createCodexRunner({ timeoutMs: Math.max(1_000, Number(process.env.SUBJECT_ANALYSIS_CODEX_TIMEOUT_MS ?? 900_000)) });
  do {
    const result = await runSubjectAnalysisOnce({
      client,
      runner,
      workerId,
      leaseSeconds,
      pollMs: Math.max(250, Number(process.env.SUBJECT_ANALYSIS_POLL_MS ?? 5_000)),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (mode === "once") return;
  } while (true);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
