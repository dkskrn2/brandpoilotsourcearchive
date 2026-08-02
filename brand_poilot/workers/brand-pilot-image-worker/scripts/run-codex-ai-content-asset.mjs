import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildImageWorkerChildEnvironment, resolveGeneratedImagesDirectory } from "../dist/childEnvironment.mjs";
import { buildCodexExecArguments, resolveCodexInvocation } from "../dist/codexCommand.mjs";
import { findGeneratedImages, parseCodexFinalMessage, parseCodexThreadId, resolveCodexGeneratedImagesDirectory } from "../dist/codexImageOutput.mjs";
import { forwardParentTermination } from "../dist/processTermination.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (!value) throw new Error(`${name}_required`);
  return value;
}

async function main() {
  const jobFile = argument("--job");
  const outputFile = path.resolve(argument("--output"));
  const workspaceDir = path.resolve(argument("--workspace"));
  const job = JSON.parse(await readFile(jobFile, "utf8"));
  if (job.selectedAssetCount !== 1 || typeof job.prompt !== "string" || !job.prompt.trim()) throw new Error("ai_content_asset_job_invalid");
  await Promise.all([
    readFile(path.join(workspaceDir, "AGENTS.md"), "utf8"),
    readFile(path.join(workspaceDir, ".codex", "skills", "image-render", "SKILL.md"),
  ]).catch(() => { throw new Error("ai_content_asset_workspace_invalid"); });

  const generatedImagesDirectory = resolveGeneratedImagesDirectory(process.env, os.homedir());
  const imagegenOutputDir = resolveCodexGeneratedImagesDirectory({ generatedImagesDirectory, codexHome: process.env.CODEX_HOME, homeDir: os.homedir() });
  await mkdir(imagegenOutputDir, { recursive: true });
  const codex = resolveCodexInvocation();
  const codexArgs = buildCodexExecArguments({ rootDir: workspaceDir });
  if (!codexArgs.includes("image_generation") || !codexArgs.includes("permissions.worker.network.enabled=false")) throw new Error("ai_content_asset_codex_permissions_invalid");
  let ownedSessionId = null;
  try {
    const result = await new Promise((resolve, reject) => {
      let sessionId = null;
      let finalMessage = null;
      let pendingOutput = "";
      const child = spawn(codex.command, [...codex.argsPrefix, ...codexArgs], {
        shell: false, windowsHide: true, cwd: workspaceDir, stdio: ["pipe", "pipe", "inherit"],
        env: buildImageWorkerChildEnvironment({ ...process.env, CODEX_GENERATED_IMAGES_DIR: imagegenOutputDir }),
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
      child.once("error", (error) => { termination.dispose(); reject(error); });
      child.once("exit", (code) => {
        const terminationSignal = termination.signal;
        termination.dispose();
        sessionId ??= parseCodexThreadId(pendingOutput);
        ownedSessionId ??= sessionId;
        finalMessage = parseCodexFinalMessage(pendingOutput) ?? finalMessage;
        if (terminationSignal) return reject(new Error(`codex_ai_content_asset_aborted:${terminationSignal}`));
        if (code !== 0) return reject(new Error(`codex_ai_content_asset_failed:${code ?? "unknown"}`));
        if (!sessionId) return reject(new Error("codex_image_session_missing"));
        if (!finalMessage) return reject(new Error("codex_image_content_missing"));
        resolve({ sessionId, finalMessage });
      });
      termination = forwardParentTermination({ child });
      child.stdin.end(job.prompt, "utf8");
    });
    let final;
    try { final = JSON.parse(result.finalMessage); } catch { throw new Error("ai_content_asset_final_message_invalid"); }
    if (final?.contractVersion !== "ai-content-asset-render.v1" || final?.selectedAssetCount !== 1 || Object.keys(final).length !== 2) {
      throw new Error("ai_content_asset_final_message_invalid");
    }
    const generated = await findGeneratedImages({ directory: imagegenOutputDir, threadId: result.sessionId, maxImages: 1, selectedAssetCount: 1 });
    if (generated.length !== 1) throw new Error("codex_image_output_count_mismatch");
    await mkdir(path.dirname(outputFile), { recursive: true });
    await copyFile(generated[0], outputFile);
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
