import { access, copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  isRetryableContentWorkerError,
  runShellCommandWithAccountFailover,
  runShellCommandWithTimeout,
  startJobLeaseGuard,
  type CodexAccountPool,
} from "@brand-pilot/worker-runtime";
import { parseBlogInput, parseBlogPlanV2, parseBlogResearchEvidence, type BlogClient, type BlogJob } from "./contracts.js";
import { blogPlanSkillVersion, buildBlogPlanPrompt } from "./promptBuilder.js";
import { createBlogResearch, type BlogResearch } from "./research.js";
import { withResource } from "./resourceLease.js";

export interface CodexRunner {
  run(job: BlogJob, prompt: string, signal?: AbortSignal): Promise<{ outputDir: string; cleanup(): Promise<void> }>;
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
  template: string,
  timeoutMs: number,
  {
    accountPool,
    generatedImagesDirectory = path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "generated_images"),
    skillFile = path.resolve(import.meta.dirname, "..", ".agents", "skills", "blog-writer", "SKILL.md"),
  }: {
    accountPool?: CodexAccountPool;
    generatedImagesDirectory?: string;
    skillFile?: string;
  } = {},
): CodexRunner {
  return {
    async run(job, prompt, signal) {
      const workDir = await mkdtemp(path.join(os.tmpdir(), "brand-pilot-blog-"));
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
        const jobFile = path.join(workDir, "job.json");
        await writeFile(jobFile, JSON.stringify({ job, prompt }, null, 2));
        const prepareAttempt = async (outputDir: string) => {
          const stagedSkill = path.join(outputDir, ".agents", "skills", "blog-writer", "SKILL.md");
          await mkdir(path.dirname(stagedSkill), { recursive: true });
          await copyFile(skillFile, stagedSkill);
          return template.replaceAll("{{jobFile}}", jobFile).replaceAll("{{outputDir}}", outputDir);
        };
        let outputDir: string;
        if (accountPool) {
          const result = await runShellCommandWithAccountFailover({
            accountPool,
            async buildAttempt(profile) {
              const attemptOutput = path.join(workDir, `output-${profile.alias}`);
              return {
                command: await prepareAttempt(attemptOutput),
                value: attemptOutput,
                acceptedOutput: () => access(path.join(attemptOutput, "blog-plan.json"))
                  .then(() => true, () => false),
              };
            },
            signal,
            timeoutMs,
            timeoutErrorCode: "codex_blog_timeout",
            processErrorCode: "codex_blog_failed",
          });
          outputDir = result.value;
        } else {
          outputDir = path.join(workDir, "output");
          await runShellCommandWithTimeout({
            command: await prepareAttempt(outputDir), signal, timeoutMs,
            timeoutErrorCode: "codex_blog_timeout", processErrorCode: "codex_blog_failed",
          });
        }
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

export async function runOnce({ workerId, client, runner, research, shutdownSignal }: {
  workerId: string;
  client: BlogClient;
  runner: CodexRunner;
  research?: BlogResearch;
  shutdownSignal?: AbortSignal;
}) {
  return withResource(client, workerId, async () => {
    const job = await client.claim(workerId);
    if (!job) return { status: "idle" as const };
    const planned: Array<Awaited<ReturnType<CodexRunner["run"]>>> = [];
    const lease = startJobLeaseGuard({ heartbeat: () => client.heartbeat(job.id, workerId, job.leaseToken), shutdownSignal });
    const cancellation = (state: "lease_lost" | "cancelled") => ({ status: state, jobId: job.id } as const);
    try {
      const parsedInput = parseBlogInput(job.payload.contentGenerationInput, job);
      const activeResearch = research ?? createBlogResearch();
      let supplementalResearch = job.payload.supplementalResearch === undefined
        ? null
        : parseBlogResearchEvidence(job.payload.supplementalResearch);
      if (!supplementalResearch) {
        const decision = await activeResearch.assess(parsedInput, lease.signal);
        if (decision.decision === "needed") {
          supplementalResearch = parseBlogResearchEvidence(await activeResearch.search(parsedInput, lease.signal));
          const state = await lease.state();
          if (state !== "active") return cancellation(state);
          await client.completeResearch(job, supplementalResearch);
        }
      }
      let repairErrors: string[] | undefined;
      let plan: ReturnType<typeof parseBlogPlanV2> | undefined;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = await runner.run(job, buildBlogPlanPrompt(job, parsedInput, supplementalResearch, repairErrors), lease.signal);
        planned.push(current);
        try {
          const rawPlan = JSON.parse(await readFile(path.join(current.outputDir, "blog-plan.json"), "utf8"));
          plan = parseBlogPlanV2(rawPlan, parsedInput, supplementalResearch);
          break;
        } catch (error) {
          if (attempt === 1) throw error;
          repairErrors = [error instanceof Error ? error.message : String(error)];
        }
      }
      if (!plan) throw new Error("blog_plan_invalid");
      const state = await lease.state();
      if (state !== "active") return cancellation(state);
      await client.complete(job.id, { workerId, leaseToken: job.leaseToken, skillVersion: blogPlanSkillVersion, jobType: "generate", plan });
      return { status: "completed" as const, jobId: job.id };
    } catch (error) {
      const state = await lease.state();
      if (state !== "active") return cancellation(state);
      await client.fail(job.id, {
        workerId,
        leaseToken: job.leaseToken,
        errorCode: error instanceof Error ? error.message.split(":")[0] : "blog_worker_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        retryable: isRetryableContentWorkerError(error),
      });
      return { status: "failed" as const, jobId: job.id };
    } finally {
      await lease.finish();
      await Promise.all(planned.map((item) => item.cleanup()));
    }
  });
}
