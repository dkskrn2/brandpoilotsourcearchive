import { existsSync } from "node:fs";
import path from "node:path";

export function resolveCodexInvocation({
  commandOverride = process.env.CODEX_COMMAND,
  platform = process.platform,
  appData = process.env.APPDATA,
  nodeExecutable = process.execPath,
  exists = existsSync
} = {}) {
  if (commandOverride) return { command: commandOverride, argsPrefix: [] };
  if (platform === "win32" && appData) {
    const globalEntrypoint = path.join(appData, "npm", "node_modules", "@openai", "codex", "bin", "codex.js");
    if (exists(globalEntrypoint)) return { command: nodeExecutable, argsPrefix: [globalEntrypoint] };
  }
  return { command: "codex", argsPrefix: [] };
}

export function buildCodexExecArguments({ rootDir }) {
  return [
    "--model", "gpt-5.6-terra",
    "exec",
    "--ignore-user-config",
    "--strict-config",
    "-c", "default_permissions=\"worker\"",
    "-c", "permissions.worker.filesystem={\":minimal\"=\"read\",\"/codex\"=\"deny\",\"/codex-accounts\"=\"deny\",\":workspace_roots\"={\".\"=\"read\"}}",
    "-c", "permissions.worker.network.enabled=false",
    "--enable", "image_generation",
    "--disable", "shell_tool",
    "--disable", "shell_snapshot",
    "--skip-git-repo-check",
    "--ephemeral",
    "--json",
    "-C", rootDir,
    "-"
  ];
}

export function buildCodexTextExecArguments({ rootDir }) {
  return [
    "exec",
    "--ignore-user-config",
    "--strict-config",
    "-c", "default_permissions=\"worker\"",
    "-c", "permissions.worker.filesystem={\":minimal\"=\"read\",\"/codex\"=\"deny\",\"/codex-accounts\"=\"deny\",\":workspace_roots\"={\".\"=\"read\"}}",
    "-c", "permissions.worker.network.enabled=false",
    "--disable", "shell_tool",
    "--disable", "shell_snapshot",
    "--disable", "image_generation",
    "--skip-git-repo-check",
    "--ephemeral",
    "--json",
    "-C", rootDir,
    "-"
  ];
}
