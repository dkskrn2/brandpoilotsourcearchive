import { spawn as nodeSpawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

type CodexInvocation = { command: string; argsPrefix: string[] };

export function resolveCodexInvocation({
  commandOverride = process.env.CODEX_COMMAND,
  platform = process.platform,
  appData = process.env.APPDATA,
  nodeExecutable = process.execPath,
  exists = existsSync,
}: {
  commandOverride?: string;
  platform?: NodeJS.Platform;
  appData?: string;
  nodeExecutable?: string;
  exists?: typeof existsSync;
} = {}): CodexInvocation {
  if (commandOverride) return { command: commandOverride, argsPrefix: [] };
  if (platform === "win32" && appData) {
    const entrypoint = path.join(appData, "npm", "node_modules", "@openai", "codex", "bin", "codex.js");
    if (exists(entrypoint)) return { command: nodeExecutable, argsPrefix: [entrypoint] };
  }
  return { command: "codex", argsPrefix: [] };
}

function extractJson(stdout: string) {
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      for (const candidate of [parsed.text, parsed.output, (parsed.item as Record<string, unknown> | undefined)?.text]) {
        if (typeof candidate !== "string") continue;
        try { return JSON.parse(candidate); } catch { /* continue */ }
      }
      if (parsed.decision) return parsed;
    } catch { /* output may include progress lines */ }
  }
  try { return JSON.parse(stdout); } catch { throw new Error("codex_response_invalid"); }
}

export async function runCodexJson({
  prompt,
  runtimeDirectory,
  timeoutMs = 10_000,
  model = process.env.DM_CODEX_MODEL?.trim() || "gpt-5.4",
  reasoningEffort = process.env.DM_CODEX_REASONING_EFFORT?.trim() || "none",
  fastMode = process.env.DM_CODEX_FAST_MODE?.trim().toLowerCase() !== "false",
  spawnImpl = nodeSpawn,
  resolveInvocation = resolveCodexInvocation,
}: {
  prompt: string;
  runtimeDirectory: string;
  timeoutMs?: number;
  model?: string;
  reasoningEffort?: string;
  fastMode?: boolean;
  spawnImpl?: typeof nodeSpawn;
  resolveInvocation?: () => CodexInvocation;
}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const codex = resolveInvocation();
    const child = spawnImpl(codex.command, [
      ...codex.argsPrefix,
      "exec",
      "--ignore-user-config",
      "-m",
      model,
      "-c",
      `model_reasoning_effort="${reasoningEffort}"`,
      ...(fastMode ? ["--enable", "fast_mode", "-c", "service_tier=\"fast\""] : []),
      "--skip-git-repo-check",
      "--ephemeral",
      "--json",
      "--sandbox",
      "read-only",
      "-C",
      runtimeDirectory,
      "-",
    ], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("codex_timeout"));
    }, timeoutMs);
    child.stdout?.on("data", (data) => { stdout += String(data); });
    child.stderr?.on("data", (data) => { stderr += String(data); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`codex_failed:${code}:${stderr.slice(0, 300)}`));
      try { resolve(extractJson(stdout)); } catch (error) { reject(error); }
    });
    child.stdin?.end(prompt);
  });
}
