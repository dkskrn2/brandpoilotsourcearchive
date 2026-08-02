import { copyFile, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  isRetryableContentWorkerError,
  preflightAttachmentSnapshots,
  runShellCommandWithTimeout,
  type AttachmentHead,
} from "@brand-pilot/worker-runtime";
import { parseCardNewsInput, parseContentGenerationInput, type AiContentJob, type WorkerClient } from "./contracts.js";
import { loadAnalysis, loadCardNewsResult } from "./manifest.js";
import { buildCardNewsPlanPrompt, buildPrompt, cardNewsPlanSkillVersion, cardNewsSkillVersion } from "./promptBuilder.js";
import { buildEditorialEvidencePool, buildEditorialPrompt, loadCardNewsPlanV2, loadEditorialPlan } from "./editorialPlan.js";
import { withResource } from "./resourceLease.js";
import type { CardNewsStorage } from "./storage.js";

export interface CodexRunner {
  run(job: AiContentJob, prompt: string): Promise<{
    outputDir: string;
    cleanup(): Promise<void>;
  }>;
}

function commandTemplateForJob(commandTemplate: string, job: AiContentJob): string {
  const rawInput = job.payload?.contentGenerationInput;
  const isV3 = rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
    && (rawInput as Record<string, unknown>).contractVersion === "content-generation-input.v3";
  if (!isV3) return commandTemplate;
  if (commandTemplate.includes("run-codex-card-news-v2-plan.mjs")) return commandTemplate;
  if (commandTemplate.includes("run-codex-card-news-plan.mjs")) {
    return commandTemplate.replaceAll("run-codex-card-news-plan.mjs", "run-codex-card-news-v2-plan.mjs");
  }
  throw new Error("card_news_v3_plan_command_invalid");
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
    async run(job, prompt) {
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
        const selectedTemplate = commandTemplateForJob(commandTemplate, job);
        const command = selectedTemplate.replaceAll("{{jobFile}}", jobFile).replaceAll("{{outputDir}}", outputDir);
        await runShellCommandWithTimeout({
          command,
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

export async function runOnce({ workerId, client, planner, runner, storage, head }: { workerId: string; client: WorkerClient; planner: CodexRunner; runner: CodexRunner; storage: CardNewsStorage; head?: AttachmentHead }) {
  return withResource(client, workerId, async () => {
    const job = await client.claim(workerId);
    if (!job) return { status: "idle" as const };
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const planned: Array<Awaited<ReturnType<CodexRunner["run"]>>> = [];
    let output: Awaited<ReturnType<CodexRunner["run"]>> | undefined;
    try {
      heartbeat = setInterval(() => void client.heartbeat(job.id, workerId, job.leaseToken).catch(() => undefined), 30_000);
      const rawInput = job.payload.contentGenerationInput;
      const parsedInput = rawInput === undefined ? null : parseCardNewsInput(rawInput, job.contentType);
      if (parsedInput?.contractVersion === "content-generation-input.v2" && parsedInput.attachments.length) {
        if (!head) throw new Error("ai_content_attachment_storage_unavailable");
        await preflightAttachmentSnapshots(parsedInput.attachments, { head });
      }
      if (job.jobType === "analyze") {
        output = await runner.run(job, buildPrompt(job));
        await client.complete(job.id, { workerId, leaseToken: job.leaseToken, skillVersion: cardNewsSkillVersion, jobType: "analyze", analysisJson: await loadAnalysis(output.outputDir) });
      } else {
        if (!job.outputId) throw new Error("card_news_output_id_required");
        if (parsedInput?.contractVersion === "content-generation-input.v3") {
          let repairError: string | undefined;
          let plan: Awaited<ReturnType<typeof loadCardNewsPlanV2>> | undefined;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const current = await planner.run(job, buildCardNewsPlanPrompt(job, parsedInput, repairError));
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
          await client.complete(job.id, {
            workerId,
            leaseToken: job.leaseToken,
            skillVersion: cardNewsPlanSkillVersion,
            jobType: "generate",
            plan,
          });
          return { status: "completed" as const, jobId: job.id };
        }
        const input = parsedInput ?? parseContentGenerationInput(job.payload.contentGenerationInput);
        if (input.contractVersion !== "content-generation-input.v2") throw new Error("content_generation_input_version_invalid");
        const evidencePool = buildEditorialEvidencePool(job);
        const legacyPlan = await planner.run(job, buildEditorialPrompt(job));
        planned.push(legacyPlan);
        const editorialPlan = await loadEditorialPlan(legacyPlan.outputDir, evidencePool);
        output = await runner.run(job, buildPrompt(job, editorialPlan));
        const stored = await storage.upload({ brandId: job.brandId, generationId: job.generationId, outputId: job.outputId, result: await loadCardNewsResult(output.outputDir, input.creativeDirection.aspectRatio) });
        await client.complete(job.id, { workerId, leaseToken: job.leaseToken, skillVersion: cardNewsSkillVersion, jobType: "generate", ...stored });
      }
      return { status: "completed" as const, jobId: job.id };
    } catch (error) {
      await client.fail(job.id, { workerId, leaseToken: job.leaseToken, errorCode: error instanceof Error ? error.message.split(":")[0] : "card_news_worker_failed", errorMessage: error instanceof Error ? error.message : String(error), retryable: isRetryableContentWorkerError(error) });
      return { status: "failed" as const, jobId: job.id };
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      await Promise.all(planned.map((item) => item.cleanup()));
      await output?.cleanup();
    }
  });
}
