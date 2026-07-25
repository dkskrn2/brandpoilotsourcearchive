import type { Readable } from "node:stream";

export type WorkerMode = "watch" | "run-once";
export type WorkerState = "stopped" | "watching" | "running_once";

export interface WorkerRunResult {
  status: "idle" | "completed" | "failed";
  jobId?: string;
}

export interface WorkerChildProcess {
  pid?: number;
  stdout?: Readable | null;
  stderr?: Readable | null;
  on(event: "exit", listener: (code: number | null) => void): this;
}

export interface WorkerProcessStatus {
  state: WorkerState;
  mode: WorkerMode | null;
  pid: number | null;
  lastResult: WorkerRunResult | null;
  lastError: string | null;
}

function parseResult(line: string): WorkerRunResult | null {
  try {
    const value = JSON.parse(line) as Record<string, unknown>;
    if (value.status !== "idle" && value.status !== "completed" && value.status !== "failed") return null;
    return {
      status: value.status,
      ...(typeof value.jobId === "string" ? { jobId: value.jobId } : {})
    };
  } catch {
    return null;
  }
}

function diagnostic(value: string) {
  return value.trim().slice(-1000) || null;
}

export function createProcessController({
  launch,
  stopProcess
}: {
  launch(mode: WorkerMode): WorkerChildProcess;
  stopProcess(process: WorkerChildProcess): Promise<void>;
}) {
  let active: WorkerChildProcess | null = null;
  let mode: WorkerMode | null = null;
  let lastResult: WorkerRunResult | null = null;
  let lastError: string | null = null;

  function status(): WorkerProcessStatus {
    return {
      state: mode === "watch" ? "watching" : mode === "run-once" ? "running_once" : "stopped",
      mode,
      pid: active?.pid ?? null,
      lastResult,
      lastError
    };
  }

  function start(nextMode: WorkerMode) {
    if (active) throw new Error("worker_already_running");
    const child = launch(nextMode);
    active = child;
    mode = nextMode;
    lastError = null;

    let stdoutBuffer = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const result = parseResult(line);
        if (result) lastResult = result;
      }
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      lastError = diagnostic(chunk.toString());
    });
    child.on("exit", (code) => {
      if (active !== child) return;
      if (code !== 0 && !lastError) lastError = `worker_process_exited:${code ?? "unknown"}`;
      active = null;
      mode = null;
    });
    return status();
  }

  return {
    status,
    startWatch: () => start("watch"),
    runOnce: () => start("run-once"),
    async stop() {
      const child = active;
      if (!child) return status();
      active = null;
      mode = null;
      await stopProcess(child);
      return status();
    }
  };
}
