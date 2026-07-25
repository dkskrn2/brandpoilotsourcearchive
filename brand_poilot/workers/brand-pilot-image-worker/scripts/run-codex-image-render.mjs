import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";
import { findGeneratedImages, outputImageName, parseCodexFinalMessage, parseCodexThreadId, resolveCodexGeneratedImagesDirectory } from "../src/codexImageOutput.mjs";
import { buildCodexExecArguments, resolveCodexInvocation } from "../src/codexCommand.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (!value) throw new Error(`${name}_required`);
  return value;
}

async function main() {
  const jobFile = argument("--job");
  const outputDir = argument("--output");
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const job = JSON.parse(await readFile(jobFile, "utf8"));
  const maxImages = Number(job.maxImages);
  if (!Number.isInteger(maxImages) || maxImages < 1 || maxImages > 5) throw new Error("image_render_max_images_invalid");
  const { parseWorkerManifest } = await tsImport("../src/manifest.ts", import.meta.url);
  const prompt = typeof job.prompt === "string" ? job.prompt.trim() : "";
  if (!prompt) throw new Error("image_job_prompt_required");
  const imagegenOutputDir = resolveCodexGeneratedImagesDirectory({ codexHome: process.env.CODEX_HOME, homeDir: os.homedir() });
  await mkdir(imagegenOutputDir, { recursive: true });
  const codex = resolveCodexInvocation();
  const codexResult = await new Promise((resolve, reject) => {
    let sessionId = null;
    let finalMessage = null;
    let pendingOutput = "";
    const child = spawn(codex.command, [
      ...codex.argsPrefix,
      ...buildCodexExecArguments({ rootDir })
    ], { stdio: ["pipe", "pipe", "inherit"], env: process.env });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      pendingOutput += chunk;
      const lines = pendingOutput.split(/\r?\n/);
      pendingOutput = lines.pop() ?? "";
      for (const line of lines) {
        sessionId ??= parseCodexThreadId(line);
        finalMessage = parseCodexFinalMessage(line) ?? finalMessage;
      }
    });
    child.stdin.end(prompt, "utf8");
    child.once("error", reject);
    child.once("exit", (code) => {
      sessionId ??= parseCodexThreadId(pendingOutput);
      finalMessage = parseCodexFinalMessage(pendingOutput) ?? finalMessage;
      if (code !== 0) return reject(new Error(`codex_image_render_failed:${code ?? "unknown"}`));
      if (!sessionId) return reject(new Error("codex_image_session_missing"));
      if (!finalMessage) return reject(new Error("codex_image_content_missing"));
      resolve({ sessionId, finalMessage });
    });
  });
  let modelManifest;
  try {
    modelManifest = JSON.parse(codexResult.finalMessage);
  } catch {
    throw new Error("image_manifest_invalid");
  }
  const manifest = parseWorkerManifest(modelManifest, { maxImages });
  const generatedImages = await findGeneratedImages({
    directory: imagegenOutputDir,
    threadId: codexResult.sessionId,
    maxImages,
    selectedAssetCount: manifest.selectedAssetCount
  });
  await mkdir(outputDir, { recursive: true });
  await Promise.all(generatedImages.map((generatedImage, index) =>
    copyFile(generatedImage, path.join(outputDir, outputImageName(manifest.deliveryFormat, index + 1)))
  ));
  await writeFile(path.join(outputDir, "content.json"), JSON.stringify(manifest, null, 2), "utf8");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
