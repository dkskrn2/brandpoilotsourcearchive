import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isRetryableContentWorkerError, runShellCommandWithTimeout } from "@brand-pilot/worker-runtime";
import { parseContentGenerationInput, type AiContentJob, type WorkerClient } from "./contracts.js";
import { loadAnalysis, loadCardNewsResult } from "./manifest.js";
import { buildPrompt, cardNewsSkillVersion } from "./promptBuilder.js";
import { buildEditorialEvidencePool, buildEditorialPrompt, loadEditorialPlan } from "./editorialPlan.js";
import { withResource } from "./resourceLease.js";
import type { CardNewsStorage } from "./storage.js";

export interface CodexRunner { run(job: AiContentJob, prompt: string): Promise<{ outputDir: string; cleanup(): Promise<void> }>; }

export function createCommandRunner(commandTemplate: string, timeoutMs: number): CodexRunner {
  return {
    async run(job, prompt) {
      const runtimeRoot = path.join(process.cwd(), ".runtime-card-news");
      await mkdir(runtimeRoot, { recursive: true });
      const workDir = await mkdtemp(path.join(runtimeRoot, "job-"));
      const outputDir = path.join(workDir, "output");
      await mkdir(outputDir);
      const jobFile = path.join(workDir, "job.json");
      await writeFile(jobFile, JSON.stringify({ job, prompt }, null, 2), "utf8");
      const command = commandTemplate.replaceAll("{{jobFile}}", jobFile).replaceAll("{{outputDir}}", outputDir);
      await runShellCommandWithTimeout({
        command,
        timeoutMs,
        timeoutErrorCode: "codex_card_news_timeout",
        processErrorCode: "codex_card_news_failed",
      });
      return { outputDir, cleanup: () => rm(workDir, { recursive: true, force: true }) };
    },
  };
}

export async function runOnce({ workerId, client, planner, runner, storage }: { workerId: string; client: WorkerClient; planner: CodexRunner; runner: CodexRunner; storage: CardNewsStorage }) {
  return withResource(client, workerId, async () => {
    const job = await client.claim(workerId);
    if (!job) return { status: "idle" as const };
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let planned: Awaited<ReturnType<CodexRunner["run"]>> | undefined;
    let output: Awaited<ReturnType<CodexRunner["run"]>> | undefined;
    try {
      heartbeat = setInterval(() => void client.heartbeat(job.id, workerId, job.leaseToken).catch(() => undefined), 30_000);
      if (job.jobType === "analyze") {
        output = await runner.run(job, buildPrompt(job));
        await client.complete(job.id, { workerId, leaseToken: job.leaseToken, skillVersion: cardNewsSkillVersion, jobType: "analyze", analysisJson: await loadAnalysis(output.outputDir) });
      } else {
        if (!job.outputId) throw new Error("card_news_output_id_required");
        const input = parseContentGenerationInput(job.payload.contentGenerationInput);
        const evidencePool = buildEditorialEvidencePool(job);
        planned = await planner.run(job, buildEditorialPrompt(job));
        const editorialPlan = await loadEditorialPlan(planned.outputDir, evidencePool);
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
      await planned?.cleanup();
      await output?.cleanup();
    }
  });
}
