import { execFile, spawn, type ChildProcess } from "node:child_process";

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
      stdio: "inherit",
      windowsHide: true,
      detached: process.platform !== "win32",
    });
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
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => finish(() => code === 0
      ? resolve()
      : reject(new Error(`${input.processErrorCode}:${code}`))));
    if (input.signal) {
      input.signal.addEventListener("abort", abort, { once: true });
      abortListenerAttached = true;
      if (input.signal.aborted) abort();
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

export function isRetryableContentWorkerError(error: unknown): boolean {
  if (error instanceof SyntaxError) return false;
  const code = error instanceof Error ? error.message.split(":")[0] : String(error);
  if (code === "ENOENT" || code.includes("output_id_required")) return false;
  return !/_(?:invalid|required|mismatch)$/.test(code);
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

export async function contentWorkerApiError(response: Response): Promise<Error> {
  let maintenance = false;
  if (response.status === 503) {
    try {
      const body = await response.json() as { error?: unknown };
      maintenance = body.error === "ai_content_maintenance";
    } catch {
      // Preserve a stable status-only error when the response has no JSON contract.
    }
  }
  return new Error(
    `worker_api_failed:${response.status}${maintenance ? ":ai_content_maintenance" : ""}`,
  );
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
