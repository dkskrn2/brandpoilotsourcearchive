import { copyFile, mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isRetryableContentWorkerError, preflightAttachmentSnapshots, runShellCommandWithTimeout, type AttachmentHead } from "@brand-pilot/worker-runtime";
import { parseContentGenerationInput, type BlogClient, type BlogJob } from "./contracts.js";
import { loadAnalysis, loadBlogResult } from "./manifest.js";
import { blogSkillVersion, buildPrompt } from "./promptBuilder.js";
import { withResource } from "./resourceLease.js";
import type { BlogStorage } from "./storage.js";

export interface CodexRunner {
  run(job: BlogJob, prompt: string): Promise<{ outputDir: string; cleanup(): Promise<void> }>;
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
    generatedImagesDirectory = path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "generated_images"),
    skillFile = path.resolve(import.meta.dirname, "..", ".agents", "skills", "blog-writer", "SKILL.md"),
  }: {
    generatedImagesDirectory?: string;
    skillFile?: string;
  } = {},
): CodexRunner {
  return {
    async run(job, prompt) {
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
        const outputDir = path.join(workDir, "output");
        const stagedSkill = path.join(outputDir, ".agents", "skills", "blog-writer", "SKILL.md");
        await mkdir(path.dirname(stagedSkill), { recursive: true });
        await copyFile(skillFile, stagedSkill);
        const jobFile = path.join(workDir, "job.json");
        await writeFile(jobFile, JSON.stringify({ job, prompt }, null, 2));
        const command = template.replaceAll("{{jobFile}}", jobFile).replaceAll("{{outputDir}}", outputDir);
        await runShellCommandWithTimeout({ command, timeoutMs, timeoutErrorCode: "codex_blog_timeout", processErrorCode: "codex_blog_failed" });
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

export async function runOnce({ workerId, client, runner, storage, head }: {
  workerId: string;
  client: BlogClient;
  runner: CodexRunner;
  storage: BlogStorage;
  head?: AttachmentHead;
}) {
  return withResource(client, workerId, async () => {
    const job = await client.claim(workerId);
    if (!job) return { status: "idle" as const };
    let output: Awaited<ReturnType<CodexRunner["run"]>> | undefined;
    const heartbeat = setInterval(() => void client.heartbeat(job.id, workerId, job.leaseToken).catch(() => undefined), 30_000);
    try {
      const rawInput = job.payload.contentGenerationInput;
      const parsedInput = rawInput === undefined ? null : parseContentGenerationInput(rawInput);
      if (parsedInput?.attachments.length) {
        if (!head) throw new Error("ai_content_attachment_storage_unavailable");
        await preflightAttachmentSnapshots(parsedInput.attachments, { head });
      }
      output = await runner.run(job, buildPrompt(job));
      if (job.jobType === "analyze") {
        await client.complete(job.id, { workerId, leaseToken: job.leaseToken, skillVersion: blogSkillVersion, jobType: "analyze", analysisJson: await loadAnalysis(output.outputDir) });
      } else {
        if (!job.outputId) throw new Error("blog_output_id_required");
        await client.complete(job.id, {
          workerId,
          leaseToken: job.leaseToken,
          skillVersion: blogSkillVersion,
          jobType: "generate",
          ...await storage.upload({ brandId: job.brandId, generationId: job.generationId, outputId: job.outputId, result: await loadBlogResult(output.outputDir) }),
        });
      }
      return { status: "completed" as const, jobId: job.id };
    } catch (error) {
      await client.fail(job.id, {
        workerId,
        leaseToken: job.leaseToken,
        errorCode: error instanceof Error ? error.message.split(":")[0] : "blog_worker_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        retryable: isRetryableContentWorkerError(error),
      });
      return { status: "failed" as const, jobId: job.id };
    } finally {
      clearInterval(heartbeat);
      await output?.cleanup();
    }
  });
}
