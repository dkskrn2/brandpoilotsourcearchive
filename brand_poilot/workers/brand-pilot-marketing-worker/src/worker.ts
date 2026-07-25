import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isRetryableContentWorkerError, runShellCommandWithTimeout } from "@brand-pilot/worker-runtime";
import type { MarketingClient, MarketingJob } from "./contracts.js";
import { loadAnalysis, loadMarketingResult, requestedDimensions } from "./manifest.js";
import { buildPrompt, marketingSkillVersion } from "./promptBuilder.js";
import { withResource } from "./resourceLease.js";
import type { MarketingStorage } from "./storage.js";

export interface CodexRunner {
  run(job: MarketingJob, prompt: string): Promise<{ outputDir: string; cleanup(): Promise<void> }>;
}

export function createCommandRunner(template: string, timeoutMs: number): CodexRunner {
  return {
    async run(job, prompt) {
      const runtimeRoot = path.join(process.cwd(), ".runtime-marketing");
      await mkdir(runtimeRoot, { recursive: true });
      const workDir = await mkdtemp(path.join(runtimeRoot, "job-"));
      const outputDir = path.join(workDir, "output");
      await mkdir(outputDir);
      const jobFile = path.join(workDir, "job.json");
      await writeFile(jobFile, JSON.stringify({ job, prompt }, null, 2));
      const command = template.replaceAll("{{jobFile}}", jobFile).replaceAll("{{outputDir}}", outputDir);
      await runShellCommandWithTimeout({ command, timeoutMs, timeoutErrorCode: "codex_marketing_timeout", processErrorCode: "codex_marketing_failed" });
      return { outputDir, cleanup: () => rm(workDir, { recursive: true, force: true }) };
    },
  };
}

export async function runOnce({ workerId, client, runner, storage }: {
  workerId: string;
  client: MarketingClient;
  runner: CodexRunner;
  storage: MarketingStorage;
}) {
  return withResource(client, workerId, async () => {
    const job = await client.claim(workerId);
    if (!job) return { status: "idle" as const };
    let output: Awaited<ReturnType<CodexRunner["run"]>> | undefined;
    const heartbeat = setInterval(() => void client.heartbeat(job.id, workerId, job.leaseToken).catch(() => undefined), 30_000);
    try {
      output = await runner.run(job, buildPrompt(job));
      if (job.jobType === "analyze") {
        await client.complete(job.id, { workerId, leaseToken: job.leaseToken, skillVersion: marketingSkillVersion, jobType: "analyze", analysisJson: await loadAnalysis(output.outputDir) });
      } else {
        if (!job.outputId) throw new Error("marketing_output_id_required");
        await client.complete(job.id, {
          workerId,
          leaseToken: job.leaseToken,
          skillVersion: marketingSkillVersion,
          jobType: "generate",
          ...await storage.upload({
            brandId: job.brandId,
            generationId: job.generationId,
            outputId: job.outputId,
            result: await loadMarketingResult(output.outputDir, requestedDimensions(job.payload.contentGenerationInput as Record<string, unknown>)),
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
      await output?.cleanup();
    }
  });
}
