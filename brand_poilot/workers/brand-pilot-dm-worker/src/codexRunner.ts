import { spawn as nodeSpawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { terminateProcessTree as terminateWorkerProcessTree } from "@brand-pilot/worker-runtime";

type CodexInvocation = { command: string; argsPrefix: string[] };

const DM_CODEX_ENV_KEYS = [
  "APPDATA",
  "CODEX_HOME",
  "COMSPEC",
  "HOME",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "NODE_EXTRA_CA_CERTS",
  "NO_PROXY",
  "PATH",
  "PATHEXT",
  "SSL_CERT_FILE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "WINDIR",
] as const;

export function buildDmCodexChildEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = {};
  for (const key of DM_CODEX_ENV_KEYS) {
    if (source[key] !== undefined) output[key] = source[key];
  }
  return output;
}

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
  env = process.env,
  spawnImpl = nodeSpawn,
  resolveInvocation = resolveCodexInvocation,
  terminateProcessTree = terminateWorkerProcessTree,
}: {
  prompt: string;
  runtimeDirectory: string;
  timeoutMs?: number;
  model?: string;
  reasoningEffort?: string;
  fastMode?: boolean;
  env?: NodeJS.ProcessEnv;
  spawnImpl?: typeof nodeSpawn;
  resolveInvocation?: () => CodexInvocation;
  terminateProcessTree?: typeof terminateWorkerProcessTree;
}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const codex = resolveInvocation();
    const child = spawnImpl(codex.command, [
      ...codex.argsPrefix,
      "exec",
      "--ignore-user-config",
      "--strict-config",
      "-m",
      model,
      "-c",
      `model_reasoning_effort="${reasoningEffort}"`,
      ...(fastMode ? ["--enable", "fast_mode", "-c", "service_tier=\"fast\""] : []),
      "-c",
      "default_permissions=\"worker\"",
      "-c",
      "permissions.worker.filesystem={\":minimal\"=\"read\",\"/codex\"=\"deny\",\":workspace_roots\"={\".\"=\"read\"}}",
      "-c",
      "permissions.worker.network.enabled=false",
      "--disable",
      "shell_tool",
      "--disable",
      "shell_snapshot",
      "--disable",
      "image_generation",
      "--skip-git-repo-check",
      "--ephemeral",
      "--json",
      "-C",
      runtimeDirectory,
      "-",
    ], {
      cwd: runtimeDirectory,
      env: buildDmCodexChildEnv(env),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let stopping = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (callback: () => void) => {
      if (settled || stopping) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const stop = (error: Error) => {
      if (settled || stopping) return;
      stopping = true;
      clearTimeout(timer);
      void Promise.resolve()
        .then(() => terminateProcessTree(child))
        .catch(() => undefined)
        .finally(() => {
          settled = true;
          reject(error);
        });
    };
    timer = setTimeout(() => stop(new Error("codex_timeout")), timeoutMs);
    child.stdout?.on("data", (data) => { stdout += String(data); });
    child.stderr?.on("data", (data) => { stderr += String(data); });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => {
      if (code !== 0) {
        finish(() => reject(new Error(`codex_failed:${code}:${stderr.slice(0, 300)}`)));
        return;
      }
      try {
        const output = extractJson(stdout);
        finish(() => resolve(output));
      } catch (error) {
        finish(() => reject(error));
      }
    });
    child.stdin?.end(prompt);
  });
}
