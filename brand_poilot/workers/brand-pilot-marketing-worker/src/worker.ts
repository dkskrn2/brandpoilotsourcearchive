import { copyFile, mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isRetryableContentWorkerError, preflightAttachmentSnapshots, runShellCommandWithTimeout, type AttachmentHead } from "@brand-pilot/worker-runtime";
import { loadMarketingPlanV2, parseContentGenerationInput, parseMarketingInput, type MarketingClient, type MarketingJob } from "./contracts.js";
import { loadAnalysis, loadMarketingResult, requestedDimensions } from "./manifest.js";
import { buildMarketingPlanPrompt, buildPrompt, marketingPlanSkillVersion, marketingSkillVersion } from "./promptBuilder.js";
import { withResource } from "./resourceLease.js";
import type { MarketingStorage } from "./storage.js";

export interface CodexRunner {
  run(job: MarketingJob, prompt: string): Promise<{ outputDir: string; cleanup(): Promise<void> }>;
}

function commandTemplateForJob(template: string, job: MarketingJob): string {
  const rawInput = job.payload?.contentGenerationInput;
  const isV3 = rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
    && (rawInput as Record<string, unknown>).contractVersion === "content-generation-input.v3";
  if (!isV3) return template;
  if (template.includes("run-codex-marketing-v2-plan.mjs")) return template;
  if (template.includes("run-codex-marketing.mjs")) {
    return template.replaceAll("run-codex-marketing.mjs", "run-codex-marketing-v2-plan.mjs");
  }
  throw new Error("marketing_v3_plan_command_invalid");
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
    skillFile = path.resolve(import.meta.dirname, "..", ".agents", "skills", "marketing-creative", "SKILL.md"),
  }: {
    generatedImagesDirectory?: string;
    skillFile?: string;
  } = {},
): CodexRunner {
  return {
    async run(job, prompt) {
      const workDir = await mkdtemp(path.join(os.tmpdir(), "brand-pilot-marketing-"));
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
        const stagedSkill = path.join(outputDir, ".agents", "skills", "marketing-creative", "SKILL.md");
        await mkdir(path.dirname(stagedSkill), { recursive: true });
        await copyFile(skillFile, stagedSkill);
        const jobFile = path.join(workDir, "job.json");
        await writeFile(jobFile, JSON.stringify({ job, prompt }, null, 2));
        const command = commandTemplateForJob(template, job).replaceAll("{{jobFile}}", jobFile).replaceAll("{{outputDir}}", outputDir);
        await runShellCommandWithTimeout({ command, timeoutMs, timeoutErrorCode: "codex_marketing_timeout", processErrorCode: "codex_marketing_failed" });
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
  client: MarketingClient;
  runner: CodexRunner;
  storage: MarketingStorage;
  head?: AttachmentHead;
}) {
  return withResource(client, workerId, async () => {
    const job = await client.claim(workerId);
    if (!job) return { status: "idle" as const };
    const planned: Array<Awaited<ReturnType<CodexRunner["run"]>>> = [];
    let output: Awaited<ReturnType<CodexRunner["run"]>> | undefined;
    const heartbeat = setInterval(() => void client.heartbeat(job.id, workerId, job.leaseToken).catch(() => undefined), 30_000);
    try {
      const rawInput = job.payload.contentGenerationInput;
      const parsedInput = rawInput === undefined ? null : parseMarketingInput(rawInput, job.contentType);
      if (parsedInput?.contractVersion === "content-generation-input.v2" && parsedInput.attachments.length) {
        if (!head) throw new Error("ai_content_attachment_storage_unavailable");
        await preflightAttachmentSnapshots(parsedInput.attachments, { head });
      }
      if (job.jobType === "analyze") {
        output = await runner.run(job, buildPrompt(job));
        await client.complete(job.id, { workerId, leaseToken: job.leaseToken, skillVersion: marketingSkillVersion, jobType: "analyze", analysisJson: await loadAnalysis(output.outputDir) });
      } else {
        if (!job.outputId) throw new Error("marketing_output_id_required");
        if (parsedInput?.contractVersion === "content-generation-input.v3") {
          let repairError: string | undefined;
          let plan: Awaited<ReturnType<typeof loadMarketingPlanV2>> | undefined;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const current = await runner.run(job, buildMarketingPlanPrompt(job, parsedInput, repairError));
            planned.push(current);
            try {
              plan = await loadMarketingPlanV2(current.outputDir, parsedInput);
              break;
            } catch (error) {
              if (attempt === 1) throw error;
              repairError = error instanceof Error ? error.message : String(error);
            }
          }
          if (!plan) throw new Error("marketing_plan_invalid");
          await client.complete(job.id, {
            workerId,
            leaseToken: job.leaseToken,
            skillVersion: marketingPlanSkillVersion,
            jobType: "generate",
            plan,
          });
          return { status: "completed" as const, jobId: job.id };
        }
        const legacyInput = parsedInput ?? parseContentGenerationInput(rawInput);
        if (legacyInput.contractVersion !== "content-generation-input.v2") throw new Error("content_generation_input_version_invalid");
        output = await runner.run(job, buildPrompt(job));
        const outputFormat = parsedInput?.orchestration?.outputFormat === "channel_text"
          ? "channel_text"
          : "single_image";
        const result = await loadMarketingResult(
          output.outputDir,
          requestedDimensions(job.payload.contentGenerationInput as Record<string, unknown>),
          outputFormat,
        );
        await client.complete(job.id, {
          workerId,
          leaseToken: job.leaseToken,
          skillVersion: marketingSkillVersion,
          jobType: "generate",
          ...await storage.upload({
            brandId: job.brandId,
            generationId: job.generationId,
            outputId: job.outputId,
            result: {
              ...result,
              ...(parsedInput?.orchestration
                ? {
                  family: "marketing" as const,
                  strategy: parsedInput.orchestration.strategy,
                }
                : {}),
            },
          }),
        });
      }
      return { status: "completed" as const, jobId: job.id };
    } catch (error) {
      await client.fail(job.id, {
        workerId,
        leaseToken: job.leaseToken,
        errorCode: error instanceof Error ? error.message.split(":")[0] : "marketing_worker_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        retryable: isRetryableContentWorkerError(error),
      });
      return { status: "failed" as const, jobId: job.id };
    } finally {
      clearInterval(heartbeat);
      await Promise.all(planned.map((item) => item.cleanup()));
      await output?.cleanup();
    }
  });
}
