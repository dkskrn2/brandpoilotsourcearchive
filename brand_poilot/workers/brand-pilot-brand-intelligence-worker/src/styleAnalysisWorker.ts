import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { terminateProcessTree } from "@brand-pilot/worker-runtime";
import { buildStyleAnalysisPrompt } from "./styleAnalysisPrompt.js";
import {
  parseStyleAnalysisResult,
  type StyleAnalysisClient,
  type StyleAnalysisJob,
} from "./styleAnalysisContracts.js";

export interface StyleAnalysisRunner {
  run(job: StyleAnalysisJob, signal?: AbortSignal): Promise<ReturnType<typeof parseStyleAnalysisResult>>;
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mimeExtension = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" } as const;

async function spawnRunner(command: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: "inherit" });
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      action();
    };
    const abort = () => void terminateProcessTree(child).finally(() => finish(() => reject(new Error("design_style_analysis_cancelled"))));
    const timer = setTimeout(() => void terminateProcessTree(child).finally(() => finish(() => reject(new Error("design_style_analysis_timeout")))), timeoutMs);
    if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => finish(() => code === 0 ? resolve() : reject(new Error("design_style_analysis_model_failed"))));
  });
}

export function createCodexStyleAnalysisRunner({
  timeoutMs = 300_000,
  runtimeRoot = path.join(tmpdir(), "brand-pilot-design-style-analysis"),
  scriptPath = path.join(packageRoot, "scripts", "run-codex-style-analysis.mjs"),
  schemaPath = path.resolve(packageRoot, "../../packages/brand-pilot-content-contracts/generated/design-style-analysis-v1.schema.json"),
  fetchImpl = fetch,
}: {
  timeoutMs?: number;
  runtimeRoot?: string;
  scriptPath?: string;
  schemaPath?: string;
  fetchImpl?: typeof fetch;
} = {}): StyleAnalysisRunner {
  return {
    async run(job, signal) {
      await mkdir(runtimeRoot, { recursive: true });
      const workDir = await mkdtemp(path.join(runtimeRoot, "job-"));
      try {
        const imagePaths: string[] = [];
        for (const [index, image] of job.images.entries()) {
          const response = await fetchImpl(image.storageUrl, { signal });
          if (!response.ok) throw new Error("design_style_image_download_failed");
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length !== image.sizeBytes || bytes.length > 5 * 1024 * 1024) {
            throw new Error("design_style_image_size_mismatch");
          }
          if (createHash("sha256").update(bytes).digest("hex") !== image.checksum) {
            throw new Error("design_style_image_checksum_mismatch");
          }
          const imagePath = path.join(workDir, `image-${index + 1}${mimeExtension[image.mimeType]}`);
          await writeFile(imagePath, bytes);
          imagePaths.push(imagePath);
        }
        const promptFile = path.join(workDir, "prompt.txt");
        const outputFile = path.join(workDir, "result.json");
        await writeFile(promptFile, buildStyleAnalysisPrompt(), "utf8");
        await spawnRunner(process.execPath, [
          scriptPath, `--prompt-file=${promptFile}`, `--output-file=${outputFile}`,
          `--schema-file=${schemaPath}`, ...imagePaths.map((value) => `--image=${value}`),
        ], timeoutMs, signal);
        return parseStyleAnalysisResult(JSON.parse(await readFile(outputFile, "utf8")));
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
  };
}

export async function processStyleAnalysisJob(input: {
  client: StyleAnalysisClient;
  runner: StyleAnalysisRunner;
  job: StyleAnalysisJob;
  workerId: string;
  leaseSeconds: number;
  heartbeatMs?: number;
  signal?: AbortSignal;
}): Promise<{ status: "completed" | "failed"; designStyleId: string }> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(input.signal?.reason);
  if (input.signal?.aborted) forwardAbort(); else input.signal?.addEventListener("abort", forwardAbort, { once: true });
  const heartbeat = setInterval(() => {
    void input.client.heartbeatStyleAnalysis(input.job, input.workerId, input.leaseSeconds)
      .catch((error) => controller.abort(error));
  }, input.heartbeatMs ?? 3_000);
  try {
    const analysis = await input.runner.run(input.job, controller.signal);
    if (controller.signal.aborted) throw controller.signal.reason;
    const analysisSha256 = createHash("sha256").update(JSON.stringify(analysis)).digest("hex");
    await input.client.completeStyleAnalysis(input.job, input.workerId, analysis, analysisSha256);
    return { status: "completed", designStyleId: input.job.designStyleId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "design_style_analysis_failed";
    const contractFailure = message === "design_style_analysis_v1_invalid";
    await input.client.failStyleAnalysis(
      input.job,
      input.workerId,
      /^[a-z0-9_]+$/.test(message) ? message.slice(0, 120) : "design_style_analysis_failed",
      !contractFailure,
    ).catch(() => undefined);
    return { status: "failed", designStyleId: input.job.designStyleId };
  } finally {
    clearInterval(heartbeat);
    input.signal?.removeEventListener("abort", forwardAbort);
    if (!controller.signal.aborted) controller.abort(new Error("design_style_analysis_finished"));
  }
}
