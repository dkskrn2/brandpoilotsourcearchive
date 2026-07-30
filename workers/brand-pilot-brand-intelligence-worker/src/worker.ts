import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  terminateProcessTree,
  withFailClosedResourceLease,
} from "@brand-pilot/worker-runtime";
import type {
  BrandAnalysisJob,
  BrandIntelligenceResult,
  BrandIntelligenceWorkerClient,
} from "./contracts.js";
import { BrandIntelligenceApiError } from "./client.js";
import { buildEvidenceBatches } from "./documentPipeline.js";
import { BrandIntelligenceContractError, parseBrandIntelligenceResult } from "./result.js";

export interface BrandIntelligenceRunner {
  run(job: BrandAnalysisJob, signal?: AbortSignal): Promise<BrandIntelligenceResult>;
}

export const BRAND_INTELLIGENCE_ACTIVE_TIMEOUT_MS = 20 * 60 * 1_000;

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHILD_ENV_KEYS = [
  "APPDATA", "CODEX_HOME", "COMSPEC", "HOME", "LANG", "LC_ALL", "LOCALAPPDATA",
  "NODE_EXTRA_CA_CERTS", "NO_PROXY", "PATH", "PATHEXT",
  "SSL_CERT_FILE", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "WINDIR",
  "HTTP_PROXY", "HTTPS_PROXY", "BRAND_INTELLIGENCE_CODEX_COMMAND",
  "BRAND_INTELLIGENCE_CODEX_MODEL", "BRAND_INTELLIGENCE_CODEX_REASONING_EFFORT",
  "BRAND_INTELLIGENCE_CODEX_FAST_MODE",
] as const;

export function buildBrandIntelligenceChildEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = {};
  for (const key of CHILD_ENV_KEYS) if (source[key] !== undefined) output[key] = source[key];
  return output;
}

type SpawnFunction = (
  command: string,
  args: string[],
  timeoutMs: number,
  env?: NodeJS.ProcessEnv,
  signal?: AbortSignal,
) => Promise<void>;

export function createCodexRunner({
  timeoutMs = BRAND_INTELLIGENCE_ACTIVE_TIMEOUT_MS,
  scriptPath = path.join(packageRoot, "scripts", "run-codex-brand-intelligence.mjs"),
  skillPath = path.join(packageRoot, ".agents", "skills", "brand-intelligence", "SKILL.md"),
  runtimeRoot = path.resolve(process.cwd(), ".runtime-brand-intelligence"),
  spawnProcess = spawnWithoutShell,
}: {
  timeoutMs?: number;
  scriptPath?: string;
  skillPath?: string;
  runtimeRoot?: string;
  spawnProcess?: SpawnFunction;
} = {}): BrandIntelligenceRunner {
  return {
    async run(job, signal) {
      await mkdir(runtimeRoot, { recursive: true });
      const workDir = await mkdtemp(path.join(runtimeRoot, "job-"));
      const outputFile = path.join(workDir, "result.json");
      const jobFile = path.join(workDir, "job.txt");
      try {
        const runtimeSkillDirectory = path.join(workDir, ".agents", "skills", "brand-intelligence");
        await mkdir(runtimeSkillDirectory, { recursive: true });
        await copyFile(skillPath, path.join(runtimeSkillDirectory, "SKILL.md"));
        const evidence = buildEvidenceBatches(job.evidence);
        await writeFile(jobFile, `${JSON.stringify({
          analysisId: job.id,
          brandId: job.brandId,
          companyName: job.input.companyName ?? null,
          batches: evidence.batches,
          sourceRegistry: job.evidence.map((document) => ({
            sourceId: document.sourceId,
            sourceUrl: document.sourceUrl,
          })),
        })}\n`, "utf8");
        await spawnProcess(
          process.execPath,
          [scriptPath, `--job-file=${jobFile}`, `--output-file=${outputFile}`, `--runtime-dir=${workDir}`],
          timeoutMs,
          buildBrandIntelligenceChildEnv(process.env),
          signal,
        );
        return parseBrandIntelligenceResult(JSON.parse(await readFile(outputFile, "utf8")));
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
  };
}

const spawnWithoutShell: SpawnFunction = async (command, args, timeoutMs, env, signal) => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      windowsHide: true,
      shell: false,
      detached: process.platform !== "win32",
      env,
    });
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => {
      void terminateProcessTree(child).finally(() => (
        finish(() => reject(signal?.reason ?? new Error("brand_intelligence_cancelled")))
      ));
    };
    const timer = setTimeout(() => {
      void terminateProcessTree(child).finally(() => (
        finish(() => reject(new Error("brand_intelligence_codex_timeout")))
      ));
    }, timeoutMs);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => finish(() => (
      code === 0 ? resolve() : reject(new Error(`brand_intelligence_codex_process_failed:${code}`))
    )));
  });
};

export async function processBrandIntelligenceJob({
  client, runner, job, leaseSeconds, heartbeatMs = 3_000,
  activeTimeoutMs = BRAND_INTELLIGENCE_ACTIVE_TIMEOUT_MS,
  signal,
}: {
  client: BrandIntelligenceWorkerClient;
  runner: BrandIntelligenceRunner;
  job: BrandAnalysisJob;
  leaseSeconds: number;
  heartbeatMs?: number;
  activeTimeoutMs?: number;
  signal?: AbortSignal;
}): Promise<{ status: "completed" | "failed"; analysisId: string }> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener("abort", forwardAbort, { once: true });
  const persistedRemainingMs = job.deadlineAt
    ? new Date(job.deadlineAt).getTime() - Date.now()
    : activeTimeoutMs;
  const remainingMs = Math.min(activeTimeoutMs, persistedRemainingMs);
  const deadline = setTimeout(() => {
    controller.abort(new Error("analysis_deadline_exceeded"));
  }, Math.max(0, remainingMs));
  let heartbeatInFlight = false;
  const heartbeat = setInterval(() => {
    if (heartbeatInFlight) return;
    heartbeatInFlight = true;
    void client.heartbeat(job, leaseSeconds)
      .catch((error) => {
        controller.abort(error instanceof Error
          ? error
          : new Error("brand_analysis_lease_lost"));
      })
      .finally(() => { heartbeatInFlight = false; });
  }, heartbeatMs);
  try {
    const result = await runner.run(job, controller.signal);
    if (controller.signal.aborted) {
      throw controller.signal.reason ?? new Error("brand_analysis_cancelled");
    }
    await client.complete(job, result, leaseSeconds);
    return { status: "completed", analysisId: job.id };
  } catch (error) {
    const retryable = !(error instanceof BrandIntelligenceContractError)
      && (!(error instanceof BrandIntelligenceApiError) || error.retryable);
    const message = error instanceof Error ? error.message : String(error);
    try {
      await client.fail(job, {
        errorCode: message.split(":")[0].slice(0, 120),
        errorMessage: message.slice(0, 2_000),
        retryable,
        leaseSeconds,
      });
    } catch {
      // Cancellation may revoke the analysis lease before the worker acknowledges it.
    }
    return { status: "failed", analysisId: job.id };
  } finally {
    signal?.removeEventListener("abort", forwardAbort);
    clearTimeout(deadline);
    clearInterval(heartbeat);
  }
}

export async function runBrandIntelligenceOnce({
  client, runner, workerId, leaseSeconds, pollMs = 5_000,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: {
  client: BrandIntelligenceWorkerClient;
  runner: BrandIntelligenceRunner;
  workerId: string;
  leaseSeconds: number;
  pollMs?: number;
  wait?: (ms: number) => Promise<unknown>;
}) {
  await client.cleanup();
  const result = await withFailClosedResourceLease({
    client,
    workerId,
    workload: "onboarding",
  }, async (signal) => {
    const job = await client.claim(workerId, leaseSeconds);
    if (!job) return { status: "idle" as const };
    return processBrandIntelligenceJob({
      client,
      runner,
      job,
      leaseSeconds,
      signal,
    });
  });
  if (result.status === "idle") {
    await wait(pollMs);
  }
  return result;
}

export async function runBrandIntelligenceWatchIteration<T>({
  runOnce,
  pollMs,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onError = () => undefined,
}: {
  runOnce: () => Promise<T>;
  pollMs: number;
  wait?: (ms: number) => Promise<unknown>;
  onError?: (error: unknown) => void;
}): Promise<T | { status: "retrying" }> {
  try {
    return await runOnce();
  } catch (error) {
    onError(error);
    await wait(pollMs);
    return { status: "retrying" };
  }
}
