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
    "--enable", "image_generation",
    "--ask-for-approval", "never",
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--json",
    "--sandbox", "workspace-write",
    "-C", rootDir,
    "-"
  ];
}
