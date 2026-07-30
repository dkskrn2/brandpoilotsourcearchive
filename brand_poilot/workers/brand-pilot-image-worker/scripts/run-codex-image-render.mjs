import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildImageWorkerChildEnvironment, resolveGeneratedImagesDirectory } from "../dist/childEnvironment.mjs";
import { buildCodexExecArguments, resolveCodexInvocation } from "../dist/codexCommand.mjs";
import { findGeneratedImages, outputImageName, parseCodexFinalMessage, parseCodexThreadId, resolveCodexGeneratedImagesDirectory } from "../dist/codexImageOutput.mjs";
import { parseWorkerManifest } from "../dist/manifest.js";
import { forwardParentTermination } from "../dist/processTermination.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (!value) throw new Error(`${name}_required`);
  return value;
}

async function main() {
  const jobFile = argument("--job");
  const outputDir = argument("--output");
  const workspaceDir = path.resolve(argument("--workspace"));
  const job = JSON.parse(await readFile(jobFile, "utf8"));
  const maxImages = Number(job.maxImages);
  if (!Number.isInteger(maxImages) || maxImages < 1 || maxImages > 5) throw new Error("image_render_max_images_invalid");
  const prompt = typeof job.prompt === "string" ? job.prompt.trim() : "";
  if (!prompt) throw new Error("image_job_prompt_required");
  await Promise.all([
    readFile(path.join(workspaceDir, "AGENTS.md"), "utf8"),
    readFile(path.join(workspaceDir, ".codex", "skills", "image-render", "SKILL.md"), "utf8")
  ]).catch(() => {
    throw new Error("image_render_workspace_invalid");
  });
  const generatedImagesDirectory = resolveGeneratedImagesDirectory(process.env, os.homedir());
  const imagegenOutputDir = resolveCodexGeneratedImagesDirectory({
    generatedImagesDirectory,
    codexHome: process.env.CODEX_HOME,
    homeDir: os.homedir()
  });
  await mkdir(imagegenOutputDir, { recursive: true });
  const codex = resolveCodexInvocation();
  let ownedSessionId = null;
  try {
    const codexResult = await new Promise((resolve, reject) => {
      let sessionId = null;
      let finalMessage = null;
      let pendingOutput = "";
      const child = spawn(codex.command, [
        ...codex.argsPrefix,
        ...buildCodexExecArguments({ rootDir: workspaceDir })
      ], {
        shell: false,
        windowsHide: true,
        cwd: workspaceDir,
        stdio: ["pipe", "pipe", "inherit"],
        env: buildImageWorkerChildEnvironment({
          ...process.env,
          CODEX_GENERATED_IMAGES_DIR: imagegenOutputDir
        })
      });
      let termination = { signal: null, dispose() {} };
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        pendingOutput += chunk;
        const lines = pendingOutput.split(/\r?\n/);
        pendingOutput = lines.pop() ?? "";
        for (const line of lines) {
          sessionId ??= parseCodexThreadId(line);
          ownedSessionId ??= sessionId;
          finalMessage = parseCodexFinalMessage(line) ?? finalMessage;
        }
      });
      child.once("error", (error) => {
        termination.dispose();
        reject(error);
      });
      child.once("exit", (code) => {
        const terminationSignal = termination.signal;
        termination.dispose();
        sessionId ??= parseCodexThreadId(pendingOutput);
        ownedSessionId ??= sessionId;
        finalMessage = parseCodexFinalMessage(pendingOutput) ?? finalMessage;
        if (terminationSignal) {
          return reject(new Error(`codex_image_render_aborted:${terminationSignal}`));
        }
        if (code !== 0) return reject(new Error(`codex_image_render_failed:${code ?? "unknown"}`));
        if (!sessionId) return reject(new Error("codex_image_session_missing"));
        if (!finalMessage) return reject(new Error("codex_image_content_missing"));
        resolve({ sessionId, finalMessage });
      });
      termination = forwardParentTermination({ child });
      child.stdin.end(prompt, "utf8");
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
  } finally {
    if (ownedSessionId && /^[a-zA-Z0-9_-]+$/.test(ownedSessionId)) {
      await rm(path.join(imagegenOutputDir, ownedSessionId), { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
