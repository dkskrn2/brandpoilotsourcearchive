import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { terminateProcessTree as terminateWorkerProcessTree } from "@brand-pilot/worker-runtime";

export interface ContentProposalModelClient {
  generate(prompt: string, signal?: AbortSignal): Promise<unknown>;
}

type CodexChildProcess = Pick<ChildProcess, "kill" | "once" | "pid"> & {
  stdin: Writable | null;
  stdout: Readable | null;
  stderr: Readable | null;
};

type SpawnProcess = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => CodexChildProcess;

const CHILD_ENV_KEYS = [
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
  "SHELL",
  "SSL_CERT_FILE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TZ",
  "USERPROFILE",
  "WINDIR",
  "XDG_CONFIG_HOME",
] as const;

const MAX_STDERR_LENGTH = 2_000;

export function buildContentProposalCodexChildEnv(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = {};
  for (const key of CHILD_ENV_KEYS) {
    if (source[key] !== undefined) output[key] = source[key];
  }
  return output;
}

function finalMessageFromJsonLine(line: string): string | null {
  try {
    const event = JSON.parse(line) as Record<string, unknown>;
    if (event.type !== "item.completed" || !event.item || typeof event.item !== "object") {
      return null;
    }
    const item = event.item as Record<string, unknown>;
    return item.type === "agent_message" && typeof item.text === "string" && item.text.trim()
      ? item.text.trim()
      : null;
  } catch {
    return null;
  }
}

function invalidModelOutput(): SyntaxError {
  return new SyntaxError("content_proposal_model_output_invalid");
}

function processFailure(code: string | number | null, stderr: string): Error {
  const detail = stderr.trim();
  return new Error(
    `content_proposal_model_process_failed:${code ?? "unknown"}${detail ? `:${detail}` : ""}`,
  );
}

const createTemporaryRuntimeDirectory = () => (
  mkdtemp(path.join(tmpdir(), "brand-pilot-content-proposal-"))
);

const removeTemporaryRuntimeDirectory = (directory: string) => (
  rm(directory, { recursive: true, force: true })
);

export function createCodexContentProposalModel({
  command,
  model = "gpt-5.4",
  timeoutMs,
  spawnProcess = spawn as SpawnProcess,
  terminateProcessTree = terminateWorkerProcessTree,
  env = process.env,
  createRuntimeDirectory = createTemporaryRuntimeDirectory,
  removeRuntimeDirectory = removeTemporaryRuntimeDirectory,
}: {
  command: string;
  model?: string;
  timeoutMs: number;
  spawnProcess?: SpawnProcess;
  terminateProcessTree?: (child: CodexChildProcess) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  createRuntimeDirectory?: () => Promise<string>;
  removeRuntimeDirectory?: (directory: string) => Promise<void>;
}): ContentProposalModelClient {
  return {
    async generate(prompt, signal) {
      if (signal?.aborted) throw new Error("content_proposal_model_aborted");
      const runtimeDirectory = await createRuntimeDirectory();

      try {
        if (signal?.aborted) throw new Error("content_proposal_model_aborted");
        return await new Promise<unknown>((resolve, reject) => {
          let child: CodexChildProcess;
          try {
            child = spawnProcess(command, [
              "exec",
              "--ignore-user-config",
              "--strict-config",
              "-m",
              model,
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
              detached: process.platform !== "win32",
              env: buildContentProposalCodexChildEnv(env),
              shell: false,
              stdio: ["pipe", "pipe", "pipe"],
              windowsHide: true,
            });
          } catch (error) {
            reject(processFailure("spawn", error instanceof Error ? error.message : String(error)));
            return;
          }

          let settled = false;
          let stopping = false;
          let stderr = "";
          let pendingStdout = "";
          let finalMessage: string | null = null;
          let timer: ReturnType<typeof setTimeout>;

          const cleanup = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
          };
          const finish = (callback: () => void) => {
            if (settled || stopping) return;
            settled = true;
            cleanup();
            callback();
          };
          const stop = (error: Error) => {
            if (settled || stopping) return;
            stopping = true;
            cleanup();
            void Promise.resolve()
              .then(() => terminateProcessTree(child))
              .catch(() => undefined)
              .finally(() => {
                settled = true;
                reject(error);
              });
          };
          const abort = () => stop(new Error("content_proposal_model_aborted"));
          const consumeStdout = (chunk: string) => {
            pendingStdout += chunk;
            const lines = pendingStdout.split(/\r?\n/);
            pendingStdout = lines.pop() ?? "";
            for (const line of lines) {
              finalMessage = finalMessageFromJsonLine(line) ?? finalMessage;
            }
          };

          timer = setTimeout(
            () => stop(new Error("content_proposal_model_timeout")),
            timeoutMs,
          );
          child.stdout?.setEncoding("utf8");
          child.stderr?.setEncoding("utf8");
          child.stdout?.on("data", (chunk) => consumeStdout(String(chunk)));
          child.stderr?.on("data", (chunk) => {
            if (stderr.length < MAX_STDERR_LENGTH) {
              stderr += String(chunk).slice(0, MAX_STDERR_LENGTH - stderr.length);
            }
          });
          child.once("error", (error) => {
            finish(() => reject(processFailure(
              "spawn",
              error instanceof Error ? error.message : String(error),
            )));
          });
          child.once("close", (code) => {
            if (pendingStdout) {
              finalMessage = finalMessageFromJsonLine(pendingStdout) ?? finalMessage;
            }
            if (code !== 0) {
              finish(() => reject(processFailure(code, stderr)));
              return;
            }
            if (!finalMessage) {
              finish(() => reject(invalidModelOutput()));
              return;
            }
            try {
              const output: unknown = JSON.parse(finalMessage);
              finish(() => resolve(output));
            } catch {
              finish(() => reject(invalidModelOutput()));
            }
          });
          if (!child.stdin) {
            stop(processFailure("stdin", ""));
            return;
          }
          child.stdin.once("error", (error) => {
            stop(processFailure("stdin", error instanceof Error ? error.message : String(error)));
          });
          signal?.addEventListener("abort", abort, { once: true });
          if (signal?.aborted) {
            abort();
            return;
          }
          child.stdin.end(prompt, "utf8");
        });
      } finally {
        await removeRuntimeDirectory(runtimeDirectory);
      }
    },
  };
}
