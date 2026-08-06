import { copyFile, mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  isRetryableContentWorkerError,
  runShellCommandWithTimeout,
  startJobLeaseGuard,
} from "@brand-pilot/worker-runtime";
import { parseCardNewsInput, type AiContentJob, type WorkerClient } from "./contracts.js";
import { buildCardNewsPlanPrompt, cardNewsPlanSkillVersion } from "./promptBuilder.js";
import { loadCardNewsPlanV2 } from "./editorialPlan.js";
import { withResource } from "./resourceLease.js";

export interface CodexRunner {
  run(job: AiContentJob, prompt: string, signal?: AbortSignal): Promise<{
    outputDir: string;
    cleanup(): Promise<void>;
  }>;
}

async function sessionDirectories(directory: string): Promise<Set<string>> {
  try {
    return new Set((await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw error;
  }
}

export function createCommandRunner(
  commandTemplate: string,
  timeoutMs: number,
  {
    generatedImagesDirectory = path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "generated_images"),
    skillFile = path.resolve(import.meta.dirname, "..", ".agents", "skills", "card-news-creator", "SKILL.md"),
  }: {
    generatedImagesDirectory?: string;
    skillFile?: string;
  } = {},
): CodexRunner {
  return {
    async run(job, prompt, signal) {
      const workDir = await mkdtemp(path.join(os.tmpdir(), "brand-pilot-card-news-"));
      const sessionsBefore = await sessionDirectories(generatedImagesDirectory);
      let ownedSessions: string[] = [];
      const captureOwnedSessions = async () => {
        const sessionsAfter = await sessionDirectories(generatedImagesDirectory);
        ownedSessions = [...sessionsAfter].filter((name) => !sessionsBefore.has(name));
      };
      const cleanup = async () => {
        await Promise.all([
          rm(workDir, { recursive: true, force: true }),
          ...ownedSessions.map((name) =>
            rm(path.join(generatedImagesDirectory, name), { recursive: true, force: true })),
        ]);
      };
      let cleanupHandedOff = false;
      try {
        const outputDir = path.join(workDir, "output");
        const stagedSkill = path.join(outputDir, ".agents", "skills", "card-news-creator", "SKILL.md");
        await mkdir(path.dirname(stagedSkill), { recursive: true });
        await copyFile(skillFile, stagedSkill);
        const jobFile = path.join(workDir, "job.json");
        await writeFile(jobFile, JSON.stringify({ job, prompt }, null, 2), "utf8");
        const command = commandTemplate.replaceAll("{{jobFile}}", jobFile).replaceAll("{{outputDir}}", outputDir);
        await runShellCommandWithTimeout({
          command,
          signal,
          timeoutMs,
          timeoutErrorCode: "codex_card_news_timeout",
          processErrorCode: "codex_card_news_failed",
        });
        await captureOwnedSessions();
        cleanupHandedOff = true;
        return { outputDir, cleanup };
      } finally {
        if (!cleanupHandedOff) {
          await captureOwnedSessions();
          await cleanup();
        }
      }
    },
  };
}

export async function runOnce({ workerId, client, planner, shutdownSignal }: { workerId: string; client: WorkerClient; planner: CodexRunner; shutdownSignal?: AbortSignal }) {
  return withResource(client, workerId, async () => {
    const job = await client.claim(workerId);
    if (!job) return { status: "idle" as const };
    const planned: Array<Awaited<ReturnType<CodexRunner["run"]>>> = [];
    const lease = startJobLeaseGuard({
      heartbeat: () => client.heartbeat(job.id, workerId, job.leaseToken),
      shutdownSignal,
    });
    const cancellation = (state: "lease_lost" | "cancelled") => ({ status: state, jobId: job.id } as const);
    try {
      const parsedInput = parseCardNewsInput(job.payload.contentGenerationInput, job);
      let repairError: string | undefined;
      let plan: Awaited<ReturnType<typeof loadCardNewsPlanV2>> | undefined;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = await planner.run(job, buildCardNewsPlanPrompt(job, parsedInput, repairError), lease.signal);
        planned.push(current);
        try {
          plan = await loadCardNewsPlanV2(current.outputDir, parsedInput);
          break;
        } catch (error) {
          if (attempt === 1) throw error;
          repairError = error instanceof Error ? error.message : String(error);
        }
      }
      if (!plan) throw new Error("card_news_plan_invalid");
      const state = await lease.state();
      if (state !== "active") return cancellation(state);
      await client.complete(job.id, {
        workerId,
        leaseToken: job.leaseToken,
        skillVersion: cardNewsPlanSkillVersion,
        jobType: "generate",
        plan,
      });
      return { status: "completed" as const, jobId: job.id };
    } catch (error) {
      const state = await lease.state();
      if (state !== "active") return cancellation(state);
      await client.fail(job.id, { workerId, leaseToken: job.leaseToken, errorCode: error instanceof Error ? error.message.split(":")[0] : "card_news_worker_failed", errorMessage: error instanceof Error ? error.message : String(error), retryable: isRetryableContentWorkerError(error) });
      return { status: "failed" as const, jobId: job.id };
    } finally {
      await lease.finish();
      await Promise.all(planned.map((item) => item.cleanup()));
    }
  });
}
