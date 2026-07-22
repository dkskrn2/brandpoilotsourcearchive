import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { terminateProcessTree } from "@brand-pilot/worker-runtime";
import type {
  BrandAnalysisJob,
  BrandIntelligenceResult,
  BrandIntelligenceWorkerClient,
} from "./contracts.js";
import { BrandIntelligenceApiError } from "./client.js";
import { buildBrandIntelligencePrompt } from "./promptBuilder.js";
import { BrandIntelligenceContractError, parseBrandIntelligenceResult } from "./result.js";

export interface BrandIntelligenceRunner {
  run(job: BrandAnalysisJob): Promise<BrandIntelligenceResult>;
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHILD_ENV_KEYS = [
  "APPDATA", "CODEX_HOME", "COMSPEC", "HOME", "LANG", "LC_ALL", "LOCALAPPDATA",
  "NODE_EXTRA_CA_CERTS", "NO_PROXY", "OPENAI_API_KEY", "PATH", "PATHEXT",
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
) => Promise<void>;

export function createCodexRunner({
  timeoutMs = 900_000,
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
    async run(job) {
      await mkdir(runtimeRoot, { recursive: true });
      const workDir = await mkdtemp(path.join(runtimeRoot, "job-"));
      const outputFile = path.join(workDir, "result.json");
      const jobFile = path.join(workDir, "job.txt");
      try {
        const runtimeSkillDirectory = path.join(workDir, ".agents", "skills", "brand-intelligence");
        await mkdir(runtimeSkillDirectory, { recursive: true });
        await copyFile(skillPath, path.join(runtimeSkillDirectory, "SKILL.md"));
        await writeFile(jobFile, `${buildBrandIntelligencePrompt(job)}\n`, "utf8");
        await spawnProcess(
          process.execPath,
          [scriptPath, `--job-file=${jobFile}`, `--output-file=${outputFile}`, `--runtime-dir=${workDir}`],
          timeoutMs,
          buildBrandIntelligenceChildEnv(process.env),
        );
        return parseBrandIntelligenceResult(JSON.parse(await readFile(outputFile, "utf8")));
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
  };
}

const spawnWithoutShell: SpawnFunction = async (command, args, timeoutMs, env) => {
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
      callback();
    };
    const timer = setTimeout(() => {
      void terminateProcessTree(child).finally(() => (
        finish(() => reject(new Error("brand_intelligence_codex_timeout")))
      ));
    }, timeoutMs);
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => finish(() => (
      code === 0 ? resolve() : reject(new Error(`brand_intelligence_codex_process_failed:${code}`))
    )));
  });
};

export async function processBrandIntelligenceJob({
  client, runner, job, leaseSeconds, heartbeatMs = 30_000,
}: {
  client: BrandIntelligenceWorkerClient;
  runner: BrandIntelligenceRunner;
  job: BrandAnalysisJob;
  leaseSeconds: number;
  heartbeatMs?: number;
}): Promise<{ status: "completed" | "failed"; analysisId: string }> {
  let heartbeatInFlight = false;
  const heartbeat = setInterval(() => {
    if (heartbeatInFlight) return;
    heartbeatInFlight = true;
    void client.heartbeat(job, leaseSeconds)
      .catch(() => undefined)
      .finally(() => { heartbeatInFlight = false; });
  }, heartbeatMs);
  try {
    const result = await runner.run(job);
    await client.complete(job, result, leaseSeconds);
    return { status: "completed", analysisId: job.id };
  } catch (error) {
    const retryable = !(error instanceof BrandIntelligenceContractError)
      && (!(error instanceof BrandIntelligenceApiError) || error.retryable);
    const message = error instanceof Error ? error.message : String(error);
    await client.fail(job, {
      errorCode: message.split(":")[0].slice(0, 120),
      errorMessage: message.slice(0, 2_000),
      retryable,
      leaseSeconds,
    });
    return { status: "failed", analysisId: job.id };
  } finally {
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
  const job = await client.claim(workerId, leaseSeconds);
  if (!job) {
    await wait(pollMs);
    return { status: "idle" as const };
  }
  return processBrandIntelligenceJob({ client, runner, job, leaseSeconds });
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
