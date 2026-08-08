import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { createHash, type Hash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import {
  CodexAccountsExhaustedError,
  codexAccountFailure,
  codexAccountSuccess,
  terminateProcessTree as terminateWorkerProcessTree,
  type CodexAccountPool,
  type CodexAccountProfile,
} from "@brand-pilot/worker-runtime";
import { CONTENT_PROPOSAL_OUTPUT_SCHEMA_PATH } from "./contracts.js";

export type ContentProposalModelResult = {
  output: unknown | null;
  rawOutput: string;
  syntaxValid: boolean;
  transcriptSha256: string;
  outputSha256: string;
};

export interface ContentProposalModelClient {
  generate(prompt: string, signal?: AbortSignal): Promise<ContentProposalModelResult>;
}

export class ContentProposalModelInvocationError extends Error {
  readonly outcome: "definite_failure" | "indeterminate";
  readonly transcriptSha256: string | null;
  readonly diagnostic!: string;
  readonly acceptedOutput: boolean;

  constructor(
    message: string,
    outcome: "definite_failure" | "indeterminate",
    transcriptSha256: string | null = null,
    diagnostic = "",
    acceptedOutput = false,
  ) {
    super(message);
    this.name = "ContentProposalModelInvocationError";
    this.outcome = outcome;
    this.transcriptSha256 = transcriptSha256;
    Object.defineProperty(this, "diagnostic", {
      configurable: false,
      enumerable: false,
      value: diagnostic,
      writable: false,
    });
    this.acceptedOutput = acceptedOutput;
  }
}

type CodexChildProcess = Pick<ChildProcess, "kill" | "once" | "pid"> & {
  stdin: Writable | null;
  stdout: Readable | null;
  stderr: Readable | null;
};
type SpawnProcess = (command: string, args: string[], options: SpawnOptions) => CodexChildProcess;

const CHILD_ENV_KEYS = [
  "APPDATA", "CODEX_HOME", "COMSPEC", "HOME", "LANG", "LC_ALL", "LOCALAPPDATA",
  "NODE_EXTRA_CA_CERTS", "NO_PROXY", "PATH", "PATHEXT", "SHELL", "SSL_CERT_FILE",
  "SYSTEMROOT", "TEMP", "TMP", "TZ", "USERPROFILE", "WINDIR", "XDG_CONFIG_HOME",
] as const;
const MAX_STDERR_LENGTH = 2_000;
const MAX_STDOUT_BYTES = 1024 * 1024;
const MODEL_ID = "gpt-5.6-terra";

export function buildContentProposalCodexChildEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = {};
  for (const key of CHILD_ENV_KEYS) if (source[key] !== undefined) output[key] = source[key];
  return output;
}

function finalMessageFromJsonLine(line: string): string | null {
  try {
    const event = JSON.parse(line) as Record<string, unknown>;
    if (event.type !== "item.completed" || !event.item || typeof event.item !== "object") return null;
    const item = event.item as Record<string, unknown>;
    return item.type === "agent_message" && typeof item.text === "string" && item.text.trim()
      ? item.text
      : null;
  } catch {
    return null;
  }
}

function transcriptDigest(hash: Hash, bytes: number): string | null {
  return bytes === 0 ? null : hash.copy().digest("hex");
}

const createTemporaryRuntimeDirectory = () => mkdtemp(path.join(tmpdir(), "brand-pilot-content-proposal-"));
const removeTemporaryRuntimeDirectory = (directory: string) => rm(directory, { recursive: true, force: true });

export function createCodexContentProposalModel({
  accountPool,
  command,
  timeoutMs,
  outputSchemaPath = CONTENT_PROPOSAL_OUTPUT_SCHEMA_PATH,
  spawnProcess = spawn as SpawnProcess,
  terminateProcessTree = terminateWorkerProcessTree,
  env = process.env,
  createRuntimeDirectory = createTemporaryRuntimeDirectory,
  removeRuntimeDirectory = removeTemporaryRuntimeDirectory,
}: {
  accountPool: CodexAccountPool;
  command: string;
  timeoutMs: number;
  outputSchemaPath?: string;
  spawnProcess?: SpawnProcess;
  terminateProcessTree?: (child: CodexChildProcess) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  createRuntimeDirectory?: () => Promise<string>;
  removeRuntimeDirectory?: (directory: string) => Promise<void>;
}): ContentProposalModelClient {
  const generateAttempt = async (
    prompt: string,
    signal: AbortSignal | undefined,
    runtimeDirectory: string,
    profile: CodexAccountProfile,
  ): Promise<ContentProposalModelResult> => new Promise<ContentProposalModelResult>((resolve, reject) => {
    let child: CodexChildProcess;
    try {
      child = spawnProcess(command, [
        "exec", "--ignore-user-config", "--strict-config", "-m", MODEL_ID,
        "--output-schema", outputSchemaPath,
        "-c", "default_permissions=\"worker\"",
        "-c", "permissions.worker.filesystem={\":minimal\"=\"deny\",\"/codex\"=\"deny\",\"/codex-accounts\"=\"deny\",\":workspace_roots\"={\".\"=\"deny\"}}",
        "-c", "permissions.worker.network.enabled=false",
        "--disable", "shell_tool", "--disable", "shell_snapshot", "--disable", "image_generation",
        "--skip-git-repo-check", "--ephemeral", "--json", "-C", runtimeDirectory, "-",
      ], {
        cwd: runtimeDirectory,
        detached: process.platform !== "win32",
        env: buildContentProposalCodexChildEnv({ ...env, CODEX_HOME: profile.home }),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      reject(new ContentProposalModelInvocationError(
        `content_proposal_model_process_failed:spawn:${error instanceof Error ? error.message : String(error)}`,
        "definite_failure",
      ));
      return;
    }

    let settled = false;
    let stopping = false;
    let stderr = "";
    let stdoutBytes = 0;
    let pendingStdout = "";
    let finalMessage: string | null = null;
    const stdoutDecoder = new StringDecoder("utf8");
    const transcriptHash = createHash("sha256");
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
    const stop = (message: string) => {
      if (settled || stopping) return;
      stopping = true;
      cleanup();
      const error = new ContentProposalModelInvocationError(
        message,
        "indeterminate",
        transcriptDigest(transcriptHash, stdoutBytes),
        stderr,
        finalMessage !== null,
      );
      let termination: Promise<void>;
      try { termination = Promise.resolve(terminateProcessTree(child)); }
      catch { termination = Promise.resolve(); }
      void termination.catch(() => undefined).finally(() => {
        settled = true;
        reject(error);
      });
    };
    const abort = () => stop("content_proposal_model_aborted");
    const consumeStdout = (chunk: string) => {
      if (settled || stopping) return;
      pendingStdout += chunk;
      const lines = pendingStdout.split(/\r?\n/);
      pendingStdout = lines.pop() ?? "";
      for (const line of lines) finalMessage = finalMessageFromJsonLine(line) ?? finalMessage;
    };

    timer = setTimeout(() => stop("content_proposal_model_timeout"), timeoutMs);
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      if (settled || stopping) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
      stdoutBytes += bytes.byteLength;
      transcriptHash.update(bytes);
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        stop("content_proposal_model_output_limit_exceeded");
        return;
      }
      consumeStdout(stdoutDecoder.write(bytes));
    });
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < MAX_STDERR_LENGTH) stderr += String(chunk).slice(0, MAX_STDERR_LENGTH - stderr.length);
    });
    child.once("error", (error) => {
      finish(() => reject(new ContentProposalModelInvocationError(
        `content_proposal_model_process_failed:spawn:${error instanceof Error ? error.message : String(error)}`,
        "definite_failure",
        transcriptDigest(transcriptHash, stdoutBytes),
        stderr,
        finalMessage !== null,
      )));
    });
    child.once("close", (code) => {
      if (settled || stopping) return;
      consumeStdout(stdoutDecoder.end());
      if (pendingStdout) finalMessage = finalMessageFromJsonLine(pendingStdout) ?? finalMessage;
      const transcriptSha256 = transcriptDigest(transcriptHash, stdoutBytes);
      if (code !== 0) {
        finish(() => reject(new ContentProposalModelInvocationError(
          `content_proposal_model_process_failed:${code ?? "unknown"}`,
          "definite_failure",
          transcriptSha256,
          stderr,
          finalMessage !== null,
        )));
        return;
      }
      if (!finalMessage || !transcriptSha256) {
        finish(() => reject(new ContentProposalModelInvocationError(
          "content_proposal_model_output_missing", "definite_failure", transcriptSha256,
        )));
        return;
      }
      let output: unknown | null = null;
      let syntaxValid = true;
      try { output = JSON.parse(finalMessage); }
      catch { syntaxValid = false; }
      const result: ContentProposalModelResult = {
        output,
        rawOutput: finalMessage,
        syntaxValid,
        transcriptSha256,
        outputSha256: createHash("sha256").update(finalMessage).digest("hex"),
      };
      finish(() => resolve(result));
    });
    if (!child.stdin) {
      stop("content_proposal_model_process_failed:stdin");
      return;
    }
    child.stdin.once("error", (error) => stop(
      `content_proposal_model_process_failed:stdin:${error instanceof Error ? error.message : String(error)}`,
    ));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    child.stdin.end(prompt, "utf8");
  });

  return {
    async generate(prompt, signal) {
      if (signal?.aborted) {
        throw new ContentProposalModelInvocationError("content_proposal_model_aborted", "indeterminate");
      }
      const runtimeDirectory = await createRuntimeDirectory();
      try {
        if (signal?.aborted) {
          throw new ContentProposalModelInvocationError("content_proposal_model_aborted", "indeterminate");
        }
        try {
          const result = await accountPool.run(async (profile) => {
            try {
              return codexAccountSuccess(await generateAttempt(prompt, signal, runtimeDirectory, profile));
            } catch (error) {
              if (!(error instanceof ContentProposalModelInvocationError)) throw error;
              return codexAccountFailure(error, error.diagnostic, error.acceptedOutput);
            }
          });
          return result.value;
        } catch (error) {
          if (error instanceof CodexAccountsExhaustedError) {
            throw new ContentProposalModelInvocationError(
              "codex_accounts_exhausted",
              "definite_failure",
            );
          }
          throw error;
        }
      } finally {
        // Cleanup must not rewrite a completed model outcome into a false invocation failure.
        await removeRuntimeDirectory(runtimeDirectory).catch(() => undefined);
      }
    },
  };
}
