import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCodexExecArguments, buildCodexTextExecArguments, resolveCodexInvocation } from "./codexCommand.mjs";

describe("resolveCodexInvocation", () => {
  it("uses the global npm Codex entrypoint on Windows instead of a later extension executable", () => {
    const appData = "C:\\Users\\worker\\AppData\\Roaming";
    const expectedEntrypoint = path.join(appData, "npm", "node_modules", "@openai", "codex", "bin", "codex.js");

    expect(resolveCodexInvocation({
      platform: "win32",
      appData,
      nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
      exists: (candidate) => String(candidate) === expectedEntrypoint
    })).toEqual({
      command: "C:\\Program Files\\nodejs\\node.exe",
      argsPrefix: [expectedEntrypoint]
    });
  });

  it("honors an explicit native command override", () => {
    expect(resolveCodexInvocation({
      commandOverride: "D:\\tools\\codex.exe",
      platform: "win32",
      appData: "C:\\Users\\worker\\AppData\\Roaming",
      nodeExecutable: "node",
      exists: () => false
    })).toEqual({ command: "D:\\tools\\codex.exe", argsPrefix: [] });
  });

  it("pins the image renderer to the strict read-only worker profile", () => {
    const hookCommand = '"C:\\Program Files\\nodejs\\node.exe" "C:\\worker\\scripts\\audit-codex-visual-session-image.mjs"';
    const args = buildCodexExecArguments({ rootDir: "C:\\worker", hookCommand });

    expect(args.slice(0, 6)).toEqual([
      "--model", "gpt-5.6-terra", "--enable", "hooks", "--dangerously-bypass-hook-trust", "exec",
    ]);
    expect(args).toContain(`hooks.PreToolUse=[{matcher=".*",hooks=[{type="command",command=${JSON.stringify(hookCommand)},timeout=10}]}]`);
    expect(args).toContain(`hooks.PostToolUse=[{matcher=".*",hooks=[{type="command",command=${JSON.stringify(hookCommand)},timeout=10}]}]`);
    expect(args).not.toContain("codex_hooks");
    expect(args).not.toContain("--sandbox");
    expect(args.indexOf("gpt-5.6-terra")).toBeLessThan(args.indexOf("exec"));
    expect(args.join(" ")).not.toContain("creative brief");
  });

  it("does not bypass hook trust for the markerless Blog renderer", () => {
    const args = buildCodexExecArguments({ rootDir: "C:\\worker" });
    expect(args).not.toContain("hooks");
    expect(args).not.toContain("--dangerously-bypass-hook-trust");
    expect(args.join("\n")).not.toContain("hooks.PreToolUse");
  });

  it("pins Threads text to the strict read-only worker profile with image tools disabled", () => {
    const args = buildCodexTextExecArguments({ rootDir: "C:\\worker" });

    expect(args).toEqual([
      "exec",
      "--ignore-user-config",
      "--strict-config",
      "-c",
      "default_permissions=\"worker\"",
      "-c",
      "permissions.worker.filesystem={\":minimal\"=\"read\",\"/codex\"=\"deny\",\"/codex-accounts\"=\"deny\",\":workspace_roots\"={\".\"=\"read\"}}",
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
      "C:\\worker",
      "-"
    ]);
    expect(args).not.toContain("--sandbox");
  });
});
