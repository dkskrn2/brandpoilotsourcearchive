import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  failure as accountFailure,
  success as accountSuccess,
  type CodexAccountPool,
  type CodexAccountProfile,
} from "./codexAccountPool.js";

export {
  runControlledSearch,
  type ControlledSearchDependencies,
  type ControlledSearchInput,
} from "./controlledSearch.js";

export {
  startJobLeaseGuard,
  type JobLeaseGuard,
  type JobLeaseState,
} from "./jobLease.js";

export {
  CodexAccountsExhaustedError,
  createCodexAccountPool,
  createCodexAccountPoolFromEnv,
  failure as codexAccountFailure,
  success as codexAccountSuccess,
  type CodexAccountPool,
  type CodexAccountProfile,
  type CodexAttemptFailure,
  type CodexAttemptResult,
} from "./codexAccountPool.js";

type TreeTerminationDependencies = {
  platform?: NodeJS.Platform;
  execFileImpl?: typeof execFile;
  killImpl?: typeof process.kill;
};

export async function terminateProcessTree(
  child: Pick<ChildProcess, "pid" | "kill">,
  dependencies: TreeTerminationDependencies = {},
): Promise<void> {
  if (!child.pid) return;
  const platform = dependencies.platform ?? process.platform;
  if (platform === "win32") {
    const execFileImpl = dependencies.execFileImpl ?? execFile;
    await new Promise<void>((resolve) => {
      execFileImpl("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => resolve());
    });
    return;
  }
  try {
    (dependencies.killImpl ?? process.kill)(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

export async function runShellCommandWithTimeout(input: {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs: number;
  timeoutErrorCode: string;
  processErrorCode: string;
  captureDiagnostic?: boolean;
}, dependencies: {
  spawnImpl?: typeof spawn;
  terminateProcessTreeImpl?: typeof terminateProcessTree;
} = {}): Promise<void> {
  if (input.signal?.aborted) throw commandAbortError(input.signal);
  const [command, args] = input.args
    ? [input.command, input.args]
    : parseCommandLine(input.command);
  await new Promise<void>((resolve, reject) => {
    const child = (dependencies.spawnImpl ?? spawn)(command, args, {
      cwd: input.cwd ?? process.cwd(),
      env: input.env ?? buildWorkerCliChildEnv(process.env),
      shell: false,
      stdio: input.captureDiagnostic ? ["inherit", "inherit", "pipe"] : "inherit",
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    let diagnostic = "";
    let settled = false;
    let stopping = false;
    let abortListenerAttached = false;
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timer);
      if (abortListenerAttached) {
        input.signal?.removeEventListener("abort", abort);
        abortListenerAttached = false;
      }
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
        .then(() => (dependencies.terminateProcessTreeImpl ?? terminateProcessTree)(child))
        .catch(() => undefined)
        .finally(() => {
          settled = true;
          reject(error);
        });
    };
    const abort = () => stop(commandAbortError(input.signal!));
    timer = setTimeout(() => stop(new Error(input.timeoutErrorCode)), input.timeoutMs);
    if (input.captureDiagnostic) {
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk) => {
        if (diagnostic.length < 8_192) {
          diagnostic += String(chunk).slice(0, 8_192 - diagnostic.length);
        }
      });
    }
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => finish(() => code === 0
      ? resolve()
      : reject(input.captureDiagnostic
        ? new CapturedCommandProcessError(`${input.processErrorCode}:${code}`, diagnostic)
        : new Error(`${input.processErrorCode}:${code}`))));
    if (input.signal) {
      input.signal.addEventListener("abort", abort, { once: true });
      abortListenerAttached = true;
      if (input.signal.aborted) abort();
    }
  });
}

class CapturedCommandProcessError extends Error {
  readonly diagnostic!: string;

  constructor(message: string, diagnostic: string) {
    super(message);
    this.name = "CapturedCommandProcessError";
    Object.defineProperty(this, "diagnostic", {
      configurable: false,
      enumerable: false,
      value: diagnostic,
      writable: false,
    });
  }
}

export async function runShellCommandWithAccountFailover<T>(input: {
  accountPool: CodexAccountPool;
  buildAttempt(profile: CodexAccountProfile): Promise<{
    command: string;
    args?: string[];
    cwd?: string;
    value: T;
    acceptedOutput?: () => Promise<boolean>;
  }>;
  signal?: AbortSignal;
  timeoutMs: number;
  timeoutErrorCode: string;
  processErrorCode: string;
}, dependencies: {
  spawnImpl?: typeof spawn;
  terminateProcessTreeImpl?: typeof terminateProcessTree;
} = {}): Promise<{ profile: CodexAccountProfile; value: T }> {
  return input.accountPool.run(async (profile) => {
    const attempt = await input.buildAttempt(profile);
    try {
      await runShellCommandWithTimeout({
        command: attempt.command,
        args: attempt.args,
        cwd: attempt.cwd,
        env: buildWorkerCliChildEnv({ ...process.env, CODEX_HOME: profile.home }),
        signal: input.signal,
        timeoutMs: input.timeoutMs,
        timeoutErrorCode: input.timeoutErrorCode,
        processErrorCode: input.processErrorCode,
        captureDiagnostic: true,
      }, dependencies);
      return accountSuccess(attempt.value);
    } catch (error) {
      if (!(error instanceof CapturedCommandProcessError)) throw error;
      const acceptedOutput = attempt.acceptedOutput
        ? await attempt.acceptedOutput().catch(() => true)
        : false;
      return accountFailure(error, error.diagnostic, acceptedOutput);
    }
  });
}

function commandAbortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  if (typeof signal.reason === "string" && signal.reason.trim()) {
    return new Error(signal.reason);
  }
  return new Error("worker_command_aborted");
}

const WORKER_CLI_ENV_KEYS = [
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

export function buildWorkerCliChildEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = {};
  for (const key of WORKER_CLI_ENV_KEYS) {
    if (source[key] !== undefined) output[key] = source[key];
  }
  return output;
}

function parseCommandLine(value: string): [command: string, args: string[]] {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | null = null;
  let tokenStarted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quote !== "'" && character === "\\") {
      const next = value[index + 1];
      if (next !== undefined && (next === quote || next === "\\" || /\s/.test(next))) {
        token += next;
        tokenStarted = true;
        index += 1;
        continue;
      }
    }
    if (character === "'" || character === '"') {
      if (quote === character) {
        quote = null;
      } else if (quote === null) {
        quote = character;
        tokenStarted = true;
      } else {
        token += character;
      }
      continue;
    }
    if (quote === null && /\s/.test(character)) {
      if (tokenStarted) {
        tokens.push(token);
        token = "";
        tokenStarted = false;
      }
      continue;
    }
    token += character;
    tokenStarted = true;
  }
  if (quote !== null) throw new Error("worker_command_quote_invalid");
  if (tokenStarted) tokens.push(token);
  const [command, ...args] = tokens;
  if (!command) throw new Error("worker_command_required");
  return [command, args];
}

export type ContentWorkerErrorClassification = "terminal" | "conflict" | "retryable";

function classifyContentWorkerStatus(status: number): ContentWorkerErrorClassification {
  if (status === 409) return "conflict";
  if (status === 408 || status === 429 || status >= 500) return "retryable";
  return "terminal";
}

export class ContentWorkerApiError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly status: number,
    readonly errorCode: string | null,
  ) {
    super(`worker_api_failed:${status}${errorCode ? `:${errorCode}` : ""}`);
    this.name = "ContentWorkerApiError";
    this.retryable = classifyContentWorkerStatus(status) === "retryable";
  }
}

export function classifyContentWorkerError(error: unknown): ContentWorkerErrorClassification {
  if (error instanceof ContentWorkerApiError) return classifyContentWorkerStatus(error.status);
  return isRetryableContentWorkerError(error) ? "retryable" : "terminal";
}

export function isRetryableContentWorkerError(error: unknown): boolean {
  if (error instanceof ContentWorkerApiError) return error.retryable;
  if (error instanceof SyntaxError) return false;
  const code = error instanceof Error ? error.message.split(":")[0] : String(error);
  if (code === "ENOENT" || code.includes("output_id_required")) return false;
  return !/_(?:invalid|required|mismatch)$/.test(code);
}

export async function replayContentWorkerCompletion<T>(input: {
  body: T;
  complete(body: T): Promise<void>;
  leaseState(): Promise<"active" | "lease_lost" | "cancelled">;
}, dependencies: {
  wait?(delayMs: number): Promise<void>;
} = {}): Promise<"completed" | "conflict" | "lease_lost" | "cancelled"> {
  const retryDelaysMs = [250, 750, 1_500] as const;
  const wait = dependencies.wait ?? ((delayMs: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  }));

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    if (attempt > 0) await wait(retryDelaysMs[attempt - 1]!);
    const state = await input.leaseState();
    if (state !== "active") return state;
    try {
      await input.complete(input.body);
      return "completed";
    } catch (error) {
      const classification = classifyContentWorkerError(error);
      if (classification === "conflict") return "conflict";
      if (classification === "terminal" || attempt === retryDelaysMs.length) throw error;
    }
  }
  throw new Error("content_worker_completion_unreachable");
}

export type ContentWorkerPollObservation = Readonly<{
  event: "content_worker_poll_error";
  classification: "maintenance" | "transient_error";
  errorCode: "ai_content_maintenance" | "content_worker_poll_failed";
  nextAction: "poll_after_delay";
}>;

export function contentWorkerPollDelayMs(value: unknown, fallbackMs: number): number {
  const parsed = Number(value ?? fallbackMs);
  return Math.max(1_000, Number.isFinite(parsed) ? parsed : fallbackMs);
}

export async function contentWorkerApiError(response: Response): Promise<ContentWorkerApiError> {
  let errorCode: string | null = null;
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === "string" && /^[a-z][a-z0-9_]{0,119}$/.test(body.error)) {
      errorCode = body.error;
    }
  } catch {
    // Preserve a stable status-only error when the response has no JSON contract.
  }
  return new ContentWorkerApiError(response.status, errorCode);
}

export function contentWorkerPollObservation(error: unknown): ContentWorkerPollObservation {
  const message = error instanceof Error ? error.message : "";
  const maintenance = /(?:^|:)ai_content_maintenance$/.test(message);
  return Object.freeze({
    event: "content_worker_poll_error",
    classification: maintenance ? "maintenance" : "transient_error",
    errorCode: maintenance ? "ai_content_maintenance" : "content_worker_poll_failed",
    nextAction: "poll_after_delay",
  });
}
