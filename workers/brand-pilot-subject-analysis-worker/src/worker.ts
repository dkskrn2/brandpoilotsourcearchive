import { spawn } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseSubjectAppealResultV2,
  SubjectAppealContractError,
  type SubjectWorkerClient,
  type SubjectWorkerJob,
  type SubjectWorkerResult,
} from "./contracts.js";
import { SubjectAnalysisApiError } from "./client.js";
import { buildSubjectPrompt } from "./promptBuilder.js";
import { parseSubjectAnalysisResult, parseSubjectAnalysisResultV2, SubjectAnalysisContractError } from "./result.js";
import { terminateProcessTree } from "@brand-pilot/worker-runtime";

export { terminateProcessTree } from "@brand-pilot/worker-runtime";

export interface SubjectAnalysisRunner { run(job: SubjectWorkerJob): Promise<SubjectWorkerResult>; }

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CHILD_ENV_KEYS = [
  "APPDATA", "CODEX_HOME", "COMSPEC", "HOME", "LANG", "LC_ALL", "LOCALAPPDATA",
  "NODE_EXTRA_CA_CERTS", "NO_PROXY", "OPENAI_API_KEY", "PATH", "PATHEXT",
  "SSL_CERT_FILE", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "WINDIR",
  "HTTP_PROXY", "HTTPS_PROXY", "SUBJECT_ANALYSIS_CODEX_COMMAND",
  "SUBJECT_ANALYSIS_CODEX_MODEL", "SUBJECT_ANALYSIS_CODEX_REASONING_EFFORT",
  "SUBJECT_ANALYSIS_CODEX_FAST_MODE",
] as const;

export function buildSubjectAnalysisChildEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = {};
  for (const key of CHILD_ENV_KEYS) if (source[key] !== undefined) output[key] = source[key];
  return output;
}

type SpawnFunction = (command: string, args: string[], timeoutMs: number, env?: NodeJS.ProcessEnv) => Promise<void>;

export function createCodexRunner({
  timeoutMs = 900_000,
  scriptPath = path.join(packageRoot, "scripts", "run-codex-subject-analysis.mjs"),
  skillPath = path.join(packageRoot, ".agents", "skills", "subject-analysis", "SKILL.md"),
  runtimeRoot = path.resolve(process.cwd(), ".runtime-subject-analysis"),
  spawnProcess = BunlessSpawn,
}: { timeoutMs?: number; scriptPath?: string; skillPath?: string; runtimeRoot?: string; spawnProcess?: SpawnFunction } = {}): SubjectAnalysisRunner {
  return { async run(job) {
    await mkdir(runtimeRoot, { recursive: true });
    const workDir = await mkdtemp(path.join(runtimeRoot, "job-"));
    const outputFile = path.join(workDir, "result.json");
    const jobFile = path.join(workDir, "job.json");
    try {
      const runtimeSkillDirectory = path.join(workDir, ".agents", "skills", "subject-analysis");
      await mkdir(runtimeSkillDirectory, { recursive: true });
      await copyFile(skillPath, path.join(runtimeSkillDirectory, "SKILL.md"));
      await writeFile(jobFile, `${buildSubjectPrompt(job)}\n`, "utf8");
      await spawnProcess(process.execPath, [scriptPath, `--job-file=${jobFile}`, `--output-file=${outputFile}`, `--runtime-dir=${workDir}`], timeoutMs, buildSubjectAnalysisChildEnv(process.env));
      const output: unknown = JSON.parse(await readFile(outputFile, "utf8"));
      if (job.contractVersion === "subject-analysis.v1") return parseSubjectAnalysisResult(output);
      if (job.phase === "analysis") {
        return parseSubjectAnalysisResultV2(output, {
          expectedSubjectType: job.subject.type,
          allowedAttachmentIds: job.subject.attachmentIds,
        });
      }
      return parseSubjectAppealResultV2(output);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  } };
}

const BunlessSpawn: SpawnFunction = async (command, args, timeoutMs, env) => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", windowsHide: true, shell: false, detached: process.platform !== "win32", env });
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      void terminateProcessTree(child).finally(() => finish(() => reject(new Error("subject_analysis_codex_timeout"))));
    }, timeoutMs);
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => finish(() => code === 0 ? resolve() : reject(new Error(`subject_analysis_codex_process_failed:${code}`))));
  });
};

export async function processSubjectAnalysisJob({ client, runner, job, leaseSeconds, heartbeatMs = 30_000 }: { client: SubjectWorkerClient; runner: SubjectAnalysisRunner; job: SubjectWorkerJob; leaseSeconds: number; heartbeatMs?: number }): Promise<{ status: "completed" | "failed"; analysisId: string }> {
  let heartbeatInFlight = false;
  const heartbeat = setInterval(() => {
    if (heartbeatInFlight) return;
    heartbeatInFlight = true;
    void client.heartbeat(job, leaseSeconds).catch(() => undefined).finally(() => { heartbeatInFlight = false; });
  }, heartbeatMs);
  try {
    const result = await runner.run(job);
    await client.complete(job, result, leaseSeconds);
    return { status: "completed", analysisId: job.analysisId };
  } catch (error) {
    const retryable = !(error instanceof SubjectAnalysisContractError)
      && !(error instanceof SubjectAppealContractError)
      && (!(error instanceof SubjectAnalysisApiError) || error.retryable);
    const message = error instanceof Error ? error.message : String(error);
    await client.fail(job, { errorCode: message.split(":")[0].slice(0, 120), errorMessage: message.slice(0, 2_000), retryable, leaseSeconds });
    return { status: "failed", analysisId: job.analysisId };
  } finally {
    clearInterval(heartbeat);
  }
}

export async function runSubjectAnalysisOnce({ client, runner, workerId, leaseSeconds, pollMs = 5_000, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }: { client: SubjectWorkerClient; runner: SubjectAnalysisRunner; workerId: string; leaseSeconds: number; pollMs?: number; wait?: (ms: number) => Promise<unknown> }) {
  const job = await client.claim(workerId, leaseSeconds);
  if (!job) { await wait(pollMs); return { status: "idle" as const }; }
  return processSubjectAnalysisJob({ client, runner, job, leaseSeconds });
}
