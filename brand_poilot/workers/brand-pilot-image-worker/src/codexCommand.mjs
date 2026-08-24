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

export function buildCodexExecArguments({ rootDir, hookCommand, outputSchemaPath }) {
  const hookArguments = hookCommand
    ? ["--enable", "hooks", "--dangerously-bypass-hook-trust"]
    : [];
  const hookConfigArguments = hookCommand
    ? [
        "-c", `hooks.PreToolUse=[{matcher=".*",hooks=[{type="command",command=${JSON.stringify(hookCommand)},timeout=10}]}]`,
        "-c", `hooks.PostToolUse=[{matcher=".*",hooks=[{type="command",command=${JSON.stringify(hookCommand)},timeout=10}]}]`,
      ]
    : [];
  return [
    "--model", "gpt-5.6-terra",
    ...hookArguments,
    "exec",
    "--ignore-user-config",
    "--strict-config",
    "-c", "default_permissions=\"worker\"",
    "-c", "permissions.worker.filesystem={\":minimal\"=\"read\",\"/codex\"=\"deny\",\"/codex-accounts\"=\"deny\",\":workspace_roots\"={\".\"=\"read\"}}",
    "-c", "permissions.worker.network.enabled=false",
    ...hookConfigArguments,
    "--enable", "image_generation",
    "--disable", "shell_tool",
    "--disable", "shell_snapshot",
    "--skip-git-repo-check",
    "--ephemeral",
    "--json",
    ...(outputSchemaPath ? ["--output-schema", outputSchemaPath] : []),
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
