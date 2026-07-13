import { spawn } from "node:child_process";
import { buildCodexTextExecArguments, resolveCodexInvocation } from "./codexCommand.mjs";
import { parseCodexFinalMessage } from "./codexImageOutput.mjs";
import type { SourceReadResult } from "./sourceReader.js";
import { parseThreadsTextResult, type ThreadsTextResult } from "./threadsResult.js";

type ExecuteCodexText = (input: { rootDir: string; prompt: string }) => Promise<string>;

export async function executeCodexText({ rootDir, prompt }: { rootDir: string; prompt: string }) {
  const codex = resolveCodexInvocation();
  return new Promise<string>((resolve, reject) => {
    let finalMessage: string | null = null;
    let pendingOutput = "";
    const child = spawn(codex.command, [
      ...codex.argsPrefix,
      ...buildCodexTextExecArguments({ rootDir })
    ], { stdio: ["pipe", "pipe", "inherit"], env: process.env });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      pendingOutput += chunk;
      const lines = pendingOutput.split(/\r?\n/);
      pendingOutput = lines.pop() ?? "";
      for (const line of lines) finalMessage = parseCodexFinalMessage(line) ?? finalMessage;
    });
    child.stdin.end(prompt, "utf8");
    child.once("error", reject);
    child.once("exit", (code) => {
      finalMessage = parseCodexFinalMessage(pendingOutput) ?? finalMessage;
      if (code !== 0) return reject(new Error(`codex_text_generation_failed:${code ?? "unknown"}`));
      if (!finalMessage) return reject(new Error("codex_text_output_missing"));
      resolve(finalMessage);
    });
  });
}

export interface CodexTextGenerator {
  model: string;
  generate(input: { prompt: string; source: SourceReadResult }): Promise<ThreadsTextResult>;
}

export function createCodexTextGenerator({
  rootDir,
  model = "codex-cli",
  execute = executeCodexText
}: {
  rootDir: string;
  model?: string;
  execute?: ExecuteCodexText;
}): CodexTextGenerator {
  return {
    model,
    async generate({ prompt, source }) {
      const finalMessage = await execute({ rootDir, prompt });
      return parseThreadsTextResult(finalMessage, {
        sourceMode: source.sourceMode,
        fetchStatus: source.fetchStatus,
        model
      });
    }
  };
}
