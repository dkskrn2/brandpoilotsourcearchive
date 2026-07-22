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

  it("reads the creative brief from stdin instead of adding it to the command line", () => {
    const args = buildCodexExecArguments({ rootDir: "C:\\worker" });

    expect(args.at(-1)).toBe("-");
    expect(args).toContain("--json");
    expect(args).toContain("shell_tool");
    expect(args).toContain("shell_snapshot");
    expect(args.join(" ")).not.toContain("creative brief");
  });

  it("runs Threads text in a read-only sandbox without enabling image generation", () => {
    const args = buildCodexTextExecArguments({ rootDir: "C:\\worker" });

    expect(args).toContain("--json");
    expect(args).toContain("read-only");
    expect(args).toContain("shell_tool");
    expect(args).toContain("shell_snapshot");
    expect(args.at(-1)).toBe("-");
    expect(args).not.toContain("image_generation");
  });
});
