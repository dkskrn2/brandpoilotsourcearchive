import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildImageWorkerChildEnvironment, resolveGeneratedImagesDirectory } from "../dist/childEnvironment.mjs";
import { buildCodexExecArguments, resolveCodexInvocation } from "../dist/codexCommand.mjs";
import { findGeneratedImages, parseCodexFinalMessage, parseCodexThreadId, resolveCodexGeneratedImagesDirectory } from "../dist/codexImageOutput.mjs";
import { assertCompleteVisualSessionImageAudit } from "./visualSessionImageAudit.mjs";
import { forwardParentTermination } from "../dist/processTermination.mjs";
import { parseAiContentAssetRenderResult, parseAiContentAssetRunnerJob } from "../dist/aiContentAssetRunnerContract.js";
import { parseAiContentVisualSessionRunnerJob, parseAiContentVisualSessionRunnerResult } from "../dist/aiContentVisualSessionRunnerContract.js";
import { codexFailureDiagnostic } from "../dist/codexFailureDiagnostic.js";

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (!value) throw new Error(`${name}_required`);
  return value;
}

function commandArgument(value) {
  return `"${value.replaceAll('"', '\\"')}"`;
}

async function main() {
  const jobFile = argument("--job");
  const outputTarget = path.resolve(argument("--output"));
  const workspaceDir = path.resolve(argument("--workspace"));
  const diagnosticFile = path.resolve(argument("--diagnostic"));
  const rawJob = JSON.parse(await readFile(jobFile, "utf8"));
  const visualSession = rawJob?.contractVersion === "ai-content-visual-session-render.v1";
  const job = visualSession ? parseAiContentVisualSessionRunnerJob(rawJob) : parseAiContentAssetRunnerJob(rawJob);
  const expectedCount = visualSession ? job.expectedSceneIndices.length : 1;
  await Promise.all([
    readFile(path.join(workspaceDir, "AGENTS.md"), "utf8"),
    readFile(path.join(workspaceDir, ".codex", "skills", "image-render", "SKILL.md"), "utf8"),
  ]).catch(() => { throw new Error("ai_content_asset_workspace_invalid"); });

  const generatedImagesDirectory = resolveGeneratedImagesDirectory(process.env, os.homedir());
  const imagegenOutputDir = resolveCodexGeneratedImagesDirectory({ generatedImagesDirectory, codexHome: process.env.CODEX_HOME, homeDir: os.homedir() });
  await mkdir(imagegenOutputDir, { recursive: true });
  const codex = resolveCodexInvocation();
  const visualSessionHookCommand = `${commandArgument(process.execPath)} ${commandArgument(fileURLToPath(new URL("./audit-codex-visual-session-image.mjs", import.meta.url)))}`;
  const codexArgs = buildCodexExecArguments({ rootDir: workspaceDir, hookCommand: visualSession ? visualSessionHookCommand : undefined });
  if (!codexArgs.includes("image_generation") || !codexArgs.includes("permissions.worker.network.enabled=false")) throw new Error("ai_content_asset_codex_permissions_invalid");
  if (visualSession && (!codexArgs.includes("hooks")
    || !codexArgs.includes("--dangerously-bypass-hook-trust")
    || !codexArgs.some((value) => value.startsWith("hooks.PreToolUse="))
    || !codexArgs.some((value) => value.startsWith("hooks.PostToolUse=")))) throw new Error("ai_content_visual_session_hook_config_invalid");
  let ownedSessionId = null;
  try {
    const codexStartedAtMs = Date.now();
    const result = await new Promise((resolve, reject) => {
      let sessionId = null;
      let finalMessage = null;
      let pendingOutput = "";
      let diagnosticStdout = "";
      let diagnosticStderr = "";
      const child = spawn(codex.command, [...codex.argsPrefix, ...codexArgs], {
        shell: false, windowsHide: true, cwd: workspaceDir, stdio: ["pipe", "pipe", "pipe"],
        env: buildImageWorkerChildEnvironment({ ...process.env, CODEX_GENERATED_IMAGES_DIR: imagegenOutputDir }),
      });
      let termination = { signal: null, dispose() {} };
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        diagnosticStdout = `${diagnosticStdout}${chunk}`.slice(-65_536);
        pendingOutput += chunk;
        const lines = pendingOutput.split(/\r?\n/);
        pendingOutput = lines.pop() ?? "";
        for (const line of lines) {
          sessionId ??= parseCodexThreadId(line);
          ownedSessionId ??= sessionId;
          finalMessage = parseCodexFinalMessage(line) ?? finalMessage;
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        diagnosticStderr = `${diagnosticStderr}${chunk}`.slice(-32_768);
      });
      child.once("error", (error) => { termination.dispose(); reject(error); });
      // `close` fires after stdout/stderr are closed. Using `exit` here can
      // classify the process before the final structured provider error is read.
      child.once("close", (code) => {
        const terminationSignal = termination.signal;
        termination.dispose();
        sessionId ??= parseCodexThreadId(pendingOutput);
        ownedSessionId ??= sessionId;
        finalMessage = parseCodexFinalMessage(pendingOutput) ?? finalMessage;
        if (terminationSignal) return reject(new Error(`codex_ai_content_asset_aborted:${terminationSignal}`));
        if (code !== 0) return reject(new Error(codexFailureDiagnostic(diagnosticStderr, diagnosticStdout)));
        if (!sessionId) return reject(new Error("codex_image_session_missing"));
        if (!finalMessage) return reject(new Error("codex_image_content_missing"));
        resolve({ sessionId, finalMessage });
      });
      termination = forwardParentTermination({ child });
      child.stdin.end(job.prompt, "utf8");
    });
    try {
      if (visualSession) parseAiContentVisualSessionRunnerResult(JSON.parse(result.finalMessage), job);
      else parseAiContentAssetRenderResult(JSON.parse(result.finalMessage), job);
    } catch {
      throw new Error("ai_content_asset_final_message_invalid");
    }
    let generated;
    let visualCalls = null;
    if (visualSession) {
      const rawAuditSource = await readFile(path.join(workspaceDir, "visual-session-hook-audit.json"), "utf8")
        .catch((error) => {
          if (error && typeof error === "object" && error.code === "ENOENT") throw new Error("ai_content_visual_session_hook_audit_missing");
          throw error;
        });
      const rawAudit = JSON.parse(rawAuditSource);
      visualCalls = assertCompleteVisualSessionImageAudit(rawAudit);
      const sessionDirectory = path.join(imagegenOutputDir, result.sessionId);
      const entries = await readdir(sessionDirectory, { withFileTypes: true }).catch(() => { throw new Error("codex_image_output_missing"); });
      const pngNames = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png")).map(({ name }) => name).sort();
      const expectedNames = visualCalls.map(({ toolUseId }) => `${toolUseId}.png`).sort();
      if (JSON.stringify(pngNames) !== JSON.stringify(expectedNames)) throw new Error("codex_image_output_binding_invalid");
      generated = visualCalls.map(({ toolUseId }) => path.join(sessionDirectory, `${toolUseId}.png`));
      await mkdir(outputTarget, { recursive: true });
      for (const [offset, generatedFile] of generated.entries()) {
        await copyFile(generatedFile, path.join(outputTarget, `scene-${String(offset + 1).padStart(2, "0")}.png`));
      }
    } else {
      generated = await findGeneratedImages({ directory: imagegenOutputDir, threadId: result.sessionId, maxImages: expectedCount, selectedAssetCount: expectedCount });
      await mkdir(path.dirname(outputTarget), { recursive: true });
      await copyFile(generated[0], outputTarget);
    }
    await writeFile(diagnosticFile, JSON.stringify({
      contractVersion: "ai-content-editorial-tool-observation.v1",
      observation: visualSession ? "observed" : "not_emitted_by_runner",
      actualToolArguments: visualSession ? visualCalls.map(({ arguments: toolArguments }) => toolArguments) : null,
      firstToolStartedAtMs: visualSession ? visualCalls[0].startedAtMs : null,
      codexStartupMs: visualSession ? Math.max(0, visualCalls[0].startedAtMs - codexStartedAtMs) : null,
      sceneGenerationMs: visualSession ? visualCalls.map(({ durationMs }) => durationMs) : null,
    }), "utf8");
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
