import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isRetryableContentWorkerError, runShellCommandWithTimeout } from "@brand-pilot/worker-runtime";
import { parseReelInput, parseReelPlanForInput, type ReelClient, type ReelJob } from "./contracts.js";
import { buildReelPlanPrompt, reelPlanSkillVersion } from "./promptBuilder.js";

export interface ReelPlanner {
  run(job: ReelJob, prompt: string): Promise<{ outputDir: string; cleanup(): Promise<void> }>;
}

export function createCommandRunner(commandTemplate: string, timeoutMs: number): ReelPlanner {
  return {
    async run(job, prompt) {
      const workDir = await mkdtemp(path.join(os.tmpdir(), "brand-pilot-reel-"));
      const outputDir = path.join(workDir, "output");
      await mkdir(outputDir, { recursive: true });
      const jobFile = path.join(workDir, "job.json");
      await writeFile(jobFile, JSON.stringify({ job, prompt }, null, 2), "utf8");
      await runShellCommandWithTimeout({
        command: commandTemplate.replaceAll("{{jobFile}}", jobFile).replaceAll("{{outputDir}}", outputDir),
        timeoutMs,
        timeoutErrorCode: "codex_reel_timeout",
        processErrorCode: "codex_reel_failed",
      });
      return { outputDir, cleanup: () => rm(workDir, { recursive: true, force: true }) };
    },
  };
}

export async function runOnce(input: { workerId: string; client: ReelClient; planner: ReelPlanner }) {
  const job = await input.client.claim(input.workerId);
  if (!job) return { status: "idle" as const };
  const runs: Array<Awaited<ReturnType<ReelPlanner["run"]>>> = [];
  const heartbeat = setInterval(() => void input.client.heartbeat(job.id, input.workerId, job.leaseToken).catch(() => undefined), 30_000);
  try {
    const finalInput = parseReelInput(job.payload.contentGenerationInput, job);
    let repairError: string | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const run = await input.planner.run(job, buildReelPlanPrompt(finalInput, repairError));
      runs.push(run);
      try {
        const plan = parseReelPlanForInput(JSON.parse(await readFile(path.join(run.outputDir, "reel-plan.json"), "utf8")), finalInput);
        await input.client.complete(job.id, { workerId: input.workerId, leaseToken: job.leaseToken, skillVersion: reelPlanSkillVersion, jobType: "generate", plan });
        return { status: "completed" as const, jobId: job.id };
      } catch (error) {
        if (attempt === 1) throw error;
        repairError = error instanceof Error ? error.message : String(error);
      }
    }
    throw new Error("reel_plan_invalid");
  } catch (error) {
    await input.client.fail(job.id, {
      workerId: input.workerId, leaseToken: job.leaseToken,
      errorCode: error instanceof Error ? error.message.split(":")[0] : "reel_worker_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      retryable: isRetryableContentWorkerError(error),
    });
    return { status: "failed" as const, jobId: job.id };
  } finally {
    clearInterval(heartbeat);
    await Promise.all(runs.map((run) => run.cleanup()));
  }
}
