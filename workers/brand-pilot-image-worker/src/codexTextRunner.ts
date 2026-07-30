import { spawn } from "node:child_process";
import { terminateProcessTree } from "@brand-pilot/worker-runtime";
import { buildCodexTextExecArguments, resolveCodexInvocation } from "./codexCommand.mjs";
import { parseCodexFinalMessage } from "./codexImageOutput.mjs";
import type { SourceReadResult } from "./sourceReader.js";
import { parseThreadsTextResult, type ThreadsTextResult } from "./threadsResult.js";

type ExecuteCodexText = (input: {
  rootDir: string;
  prompt: string;
  signal?: AbortSignal;
}) => Promise<string>;

export async function executeCodexText({
  rootDir,
  prompt,
  signal,
}: {
  rootDir: string;
  prompt: string;
  signal?: AbortSignal;
}) {
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
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => {
      void terminateProcessTree(child).finally(() => finish(() => reject(
        signal?.reason ?? new Error("worker_resource_lease_lost"),
      )));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    child.stdin.end(prompt, "utf8");
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code) => {
      finalMessage = parseCodexFinalMessage(pendingOutput) ?? finalMessage;
      if (code !== 0) return finish(() => reject(new Error(`codex_text_generation_failed:${code ?? "unknown"}`)));
      if (!finalMessage) return finish(() => reject(new Error("codex_text_output_missing")));
      finish(() => resolve(finalMessage!));
    });
  });
}

export interface CodexTextGenerator {
  model: string;
  generate(input: {
    prompt: string;
    source: SourceReadResult;
    signal?: AbortSignal;
  }): Promise<ThreadsTextResult>;
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
    async generate({ prompt, source, signal }) {
      const finalMessage = await execute({ rootDir, prompt, signal });
      return parseThreadsTextResult(finalMessage, {
        sourceMode: source.sourceMode,
        fetchStatus: source.fetchStatus,
        model
      });
    }
  };
}
