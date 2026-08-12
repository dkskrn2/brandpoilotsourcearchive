import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ContentWorkerApiError,
  isRetryableContentWorkerError,
  replayContentWorkerCompletion,
  runShellCommandWithAccountFailover,
  runShellCommandWithTimeout,
  startJobLeaseGuard,
  type CodexAccountPool,
} from "@brand-pilot/worker-runtime";
import { parseReelInput, parseReelStoryboardSubmissionForInput, type ReelClient, type ReelJob, type ReelStoryboardSubmission } from "./contracts.js";
import { buildReelPlanPrompt, reelPlanSkillVersion } from "./promptBuilder.js";

export interface ReelPlanner {
  run(job: ReelJob, prompt: string, signal?: AbortSignal): Promise<{ outputDir: string; cleanup(): Promise<void> }>;
}

export function createCommandRunner(
  commandTemplate: string,
  timeoutMs: number,
  { accountPool }: { accountPool?: CodexAccountPool } = {},
): ReelPlanner {
  return {
    async run(job, prompt, signal) {
      const workDir = await mkdtemp(path.join(os.tmpdir(), "brand-pilot-reel-"));
      const outputDir = path.join(workDir, "output");
      await mkdir(outputDir, { recursive: true });
      const jobFile = path.join(workDir, "job.json");
      await writeFile(jobFile, JSON.stringify({ job, prompt }, null, 2), "utf8");
      let selectedOutputDir = outputDir;
      if (accountPool) {
        const result = await runShellCommandWithAccountFailover({
          accountPool,
          async buildAttempt(profile) {
            const attemptOutput = path.join(workDir, `output-${profile.alias}`);
            await mkdir(attemptOutput, { recursive: true });
            return {
              command: commandTemplate.replaceAll("{{jobFile}}", jobFile).replaceAll("{{outputDir}}", attemptOutput),
              value: attemptOutput,
              acceptedOutput: () => access(path.join(attemptOutput, "reel-plan.json"))
                .then(() => true, () => false),
            };
          },
          signal,
          timeoutMs,
          timeoutErrorCode: "codex_reel_timeout",
          processErrorCode: "codex_reel_failed",
        });
        selectedOutputDir = result.value;
      } else {
        await runShellCommandWithTimeout({
          command: commandTemplate.replaceAll("{{jobFile}}", jobFile).replaceAll("{{outputDir}}", outputDir),
          signal,
          timeoutMs,
          timeoutErrorCode: "codex_reel_timeout",
          processErrorCode: "codex_reel_failed",
        });
      }
      return { outputDir: selectedOutputDir, cleanup: () => rm(workDir, { recursive: true, force: true }) };
    },
  };
}

export async function runOnce(input: { workerId: string; client: ReelClient; planner: ReelPlanner; shutdownSignal?: AbortSignal }) {
  const job = await input.client.claim(input.workerId);
  if (!job) return { status: "idle" as const };
  const runs: Array<Awaited<ReturnType<ReelPlanner["run"]>>> = [];
  const lease = startJobLeaseGuard({
    heartbeat: () => input.client.heartbeat(job.id, input.workerId, job.leaseToken),
    shutdownSignal: input.shutdownSignal,
  });
  const cancellation = (state: "lease_lost" | "cancelled") => ({ status: state, jobId: job.id } as const);
  try {
    const finalInput = parseReelInput(job.payload.contentGenerationInput, job);
    let repairError: string | undefined;
    let submission: ReelStoryboardSubmission | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const run = await input.planner.run(job, buildReelPlanPrompt(finalInput, repairError), lease.signal);
      runs.push(run);
      try {
        submission = parseReelStoryboardSubmissionForInput(
          JSON.parse(await readFile(path.join(run.outputDir, "reel-plan.json"), "utf8")),
          finalInput,
        );
        break;
      } catch (error) {
        if (attempt === 1) throw error;
        repairError = error instanceof Error ? error.message : String(error);
      }
    }
    if (!submission) throw new Error("reel_plan_draft_invalid");
    const completionBody = {
      workerId: input.workerId,
      leaseToken: job.leaseToken,
      skillVersion: reelPlanSkillVersion,
      jobType: "generate",
      planDraft: submission.planDraft,
      reelStoryboardContract: submission.reelStoryboardContract,
    };
    const completion = await replayContentWorkerCompletion({
      body: completionBody,
      complete: (body) => input.client.complete(job.id, body),
      leaseState: () => lease.state(),
    });
    if (completion === "conflict") return cancellation("lease_lost");
    if (completion !== "completed") return cancellation(completion);
    return { status: "completed" as const, jobId: job.id };
  } catch (error) {
    const state = await lease.state();
    if (state !== "active") return cancellation(state);
    await input.client.fail(job.id, {
      workerId: input.workerId, leaseToken: job.leaseToken,
      errorCode: error instanceof ContentWorkerApiError && error.errorCode ? error.errorCode : error instanceof Error ? error.message.split(":")[0] : "reel_worker_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      retryable: isRetryableContentWorkerError(error),
    });
    return { status: "failed" as const, jobId: job.id };
  } finally {
    await lease.finish();
    await Promise.all(runs.map((run) => run.cleanup()));
  }
}
