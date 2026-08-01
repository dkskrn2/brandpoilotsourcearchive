import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  terminateProcessTree,
} from "@brand-pilot/worker-runtime";
import { withFailClosedResourceLease } from "./resourceLease.js";
import type {
  BrandAnalysisJob,
  BrandAnalysisProgress,
  BrandIntelligenceResult,
  BrandIntelligenceValidationRegistry,
  BrandIntelligenceWorkerClient,
} from "./contracts.js";
import { BrandIntelligenceApiError } from "./client.js";
import { buildEvidenceBatches } from "./documentPipeline.js";
import { prepareBrandEvidence } from "./evidencePreparer.js";
import { ACTIVE_PIPELINE_MS } from "./limits.js";
import { BrandIntelligenceContractError, parseBrandIntelligenceResult } from "./result.js";

export interface BrandIntelligenceRunner {
  run(
    job: BrandAnalysisJob,
    signal?: AbortSignal,
    onProgress?: (progress: BrandAnalysisProgress) => Promise<void>,
  ): Promise<BrandIntelligenceResult | {
    result: BrandIntelligenceResult;
    registry: BrandIntelligenceValidationRegistry;
  }>;
}

export const BRAND_INTELLIGENCE_ACTIVE_TIMEOUT_MS = ACTIVE_PIPELINE_MS;
const LEASE_BOUND_API_RETRY_MS = 1_000;

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function retryDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function retryLeaseBoundApiCall<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
  safeUntil: () => number,
): Promise<T> {
  while (true) {
    if (signal.aborted) throw signal.reason;
    try {
      const result = await operation();
      if (signal.aborted) throw signal.reason;
      return result;
    } catch (error) {
      if (!(error instanceof BrandIntelligenceApiError) || !error.retryable) throw error;
      const remaining = safeUntil() - Date.now();
      if (remaining <= 0) throw new Error("brand_analysis_lease_expired");
      await retryDelay(Math.min(LEASE_BOUND_API_RETRY_MS, remaining), signal);
    }
  }
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHILD_ENV_KEYS = [
  "APPDATA", "CODEX_HOME", "COMSPEC", "HOME", "LANG", "LC_ALL", "LOCALAPPDATA",
  "NODE_EXTRA_CA_CERTS", "PATH", "PATHEXT",
  "SSL_CERT_FILE", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "WINDIR",
  "BRAND_INTELLIGENCE_CODEX_COMMAND",
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
  runtimeRoot = path.join(tmpdir(), "brand-pilot-brand-intelligence"),
  spawnProcess = spawnWithoutShell,
}: {
  timeoutMs?: number;
  scriptPath?: string;
  skillPath?: string;
  runtimeRoot?: string;
  spawnProcess?: SpawnFunction;
} = {}): BrandIntelligenceRunner {
  return {
    async run(job, signal, onProgress) {
      await mkdir(runtimeRoot, { recursive: true });
      const workDir = await mkdtemp(path.join(runtimeRoot, "job-"));
      const outputFile = path.join(workDir, "result.json");
      const jobFile = path.join(workDir, "job.txt");
      const progressFile = path.join(workDir, "progress.jsonl");
      const errorFile = path.join(workDir, "terminal-error.json");
      const progressController = new AbortController();
      const combinedSignal = signal
        ? AbortSignal.any([signal, progressController.signal])
        : progressController.signal;
      let deliveredProgressLines = 0;
      let progressError: unknown;
      let progressDrain = Promise.resolve();
      const drainProgress = () => {
        if (!onProgress) return progressDrain;
        progressDrain = progressDrain.then(async () => {
          try {
            const content = await readFile(progressFile, "utf8").catch(() => "");
            const lines = content.split(/\r?\n/).filter(Boolean);
            for (const line of lines.slice(deliveredProgressLines)) {
              await onProgress(JSON.parse(line) as BrandAnalysisProgress);
              deliveredProgressLines += 1;
            }
          } catch (error) {
            progressError = error;
            progressController.abort(error);
          }
        });
        return progressDrain;
      };
      let progressTimer: ReturnType<typeof setInterval> | undefined;
      try {
        const runtimeSkillDirectory = path.join(workDir, ".agents", "skills", "brand-intelligence");
        await mkdir(runtimeSkillDirectory, { recursive: true });
        await copyFile(skillPath, path.join(runtimeSkillDirectory, "SKILL.md"));
        await writeFile(progressFile, "", "utf8");
        const evidence = buildEvidenceBatches(job.evidence);
        await writeFile(jobFile, `${JSON.stringify({
          analysisId: job.id,
          brandId: job.brandId,
          companyName: job.input.companyName ?? null,
          batches: evidence.batches,
          sourceRegistry: job.evidence.map((document) => ({
            sourceId: document.sourceId,
            sourceUrl: document.sourceUrl,
            sourceKind: document.sourceType === "owned_url" ? "owned" : "upload",
          })),
        })}\n`, "utf8");
        progressTimer = setInterval(() => { void drainProgress(); }, 250);
        try {
          await spawnProcess(
            process.execPath,
            [
              scriptPath,
              `--job-file=${jobFile}`,
              `--output-file=${outputFile}`,
              `--runtime-dir=${workDir}`,
              `--progress-file=${progressFile}`,
              `--error-file=${errorFile}`,
            ],
            timeoutMs,
            buildBrandIntelligenceChildEnv(process.env),
            combinedSignal,
          );
        } catch (error) {
          clearInterval(progressTimer);
          progressTimer = undefined;
          await drainProgress();
          if (progressError) throw progressError;
          const terminalError = await readFile(errorFile, "utf8")
            .then((content) => JSON.parse(content) as { kind?: unknown; errorCode?: unknown })
            .catch(() => null);
          if (terminalError?.kind === "contract"
            && typeof terminalError.errorCode === "string"
            && /^(?:brand_intelligence|owned_fact)_[a-z0-9_]{1,100}$/.test(terminalError.errorCode)) {
            throw new BrandIntelligenceContractError(terminalError.errorCode);
          }
          throw error;
        }
        clearInterval(progressTimer);
        progressTimer = undefined;
        await drainProgress();
        if (progressError) throw progressError;
        const output = JSON.parse(await readFile(outputFile, "utf8")) as {
          result?: unknown;
          registry?: BrandIntelligenceValidationRegistry;
        };
        if (output.result && output.registry) {
          return {
            result: parseBrandIntelligenceResult(output.result),
            registry: output.registry,
          };
        }
        return parseBrandIntelligenceResult(output);
      } finally {
        if (progressTimer) clearInterval(progressTimer);
        await drainProgress();
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
  const startedAt = Date.now();
  const persistedDeadlineAt = timestamp(job.deadlineAt) ?? startedAt + activeTimeoutMs;
  const absoluteDeadlineAt = Math.min(startedAt + activeTimeoutMs, persistedDeadlineAt);
  const remainingMs = absoluteDeadlineAt - startedAt;
  const deadline = setTimeout(() => {
    controller.abort(new Error("analysis_deadline_exceeded"));
  }, Math.max(0, remainingMs));
  let knownLeaseExpiresAt = Math.min(
    timestamp(job.leaseExpiresAt) ?? startedAt + leaseSeconds * 1_000,
    absoluteDeadlineAt,
  );
  let leaseDeadline: ReturnType<typeof setTimeout> | undefined;
  const armLeaseDeadline = (nextExpiresAt: number) => {
    knownLeaseExpiresAt = Math.min(nextExpiresAt, absoluteDeadlineAt);
    if (leaseDeadline) clearTimeout(leaseDeadline);
    const remaining = knownLeaseExpiresAt - Date.now();
    if (remaining <= 0) {
      controller.abort(new Error("brand_analysis_lease_expired"));
      return;
    }
    leaseDeadline = setTimeout(() => {
      controller.abort(new Error("brand_analysis_lease_expired"));
    }, remaining);
  };
  armLeaseDeadline(knownLeaseExpiresAt);
  let heartbeatInFlight = false;
  const heartbeat = setInterval(() => {
    if (heartbeatInFlight) return;
    heartbeatInFlight = true;
    void retryLeaseBoundApiCall(
      () => client.heartbeat(job, leaseSeconds),
      controller.signal,
      () => knownLeaseExpiresAt,
    )
      .then((renewed) => {
        const exactLeaseExpiresAt = renewed && timestamp(renewed.leaseExpiresAt);
        armLeaseDeadline(exactLeaseExpiresAt ?? Date.now() + leaseSeconds * 1_000);
      })
      .catch((error) => {
        controller.abort(error instanceof Error
          ? error
          : new Error("brand_analysis_lease_lost"));
      })
      .finally(() => { heartbeatInFlight = false; });
  }, heartbeatMs);
  try {
    if (controller.signal.aborted) {
      throw controller.signal.reason ?? new Error("brand_analysis_lease_expired");
    }
    const evidence = job.evidence.length
      ? job.evidence
      : await prepareBrandEvidence(job, {
          signal: controller.signal,
          progress: (progress) => retryLeaseBoundApiCall(
            () => client.progress(job, progress, leaseSeconds),
            controller.signal,
            () => knownLeaseExpiresAt,
          ),
        });
    const preparedJob = { ...job, evidence };
    const runOutput = await runner.run(
      preparedJob,
      controller.signal,
      (progress) => retryLeaseBoundApiCall(
        () => client.progress(job, progress, leaseSeconds),
        controller.signal,
        () => knownLeaseExpiresAt,
      ),
    );
    if (controller.signal.aborted) {
      throw controller.signal.reason ?? new Error("brand_analysis_cancelled");
    }
    const result = "result" in runOutput ? runOutput.result : runOutput;
    const registry = "result" in runOutput ? runOutput.registry : undefined;
    await client.complete(job, result, evidence, leaseSeconds, registry);
    return { status: "completed", analysisId: job.id };
  } catch (error) {
    const retryable = !(error instanceof BrandIntelligenceContractError)
      && (!(error instanceof BrandIntelligenceApiError) || error.retryable);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("brand_analysis_cancel")) {
      await client.cancelled?.(job, leaseSeconds).catch(() => undefined);
      return { status: "failed", analysisId: job.id };
    }
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
    if (leaseDeadline) clearTimeout(leaseDeadline);
    clearInterval(heartbeat);
    if (!controller.signal.aborted) controller.abort(new Error("brand_analysis_job_finished"));
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
