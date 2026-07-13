import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { CentralApiHealth } from "./server.js";
import type { WorkerChildProcess, WorkerMode } from "./processController.js";

const execFileAsync = promisify(execFile);

export function buildWorkerCommand(workerRoot: string, mode: WorkerMode) {
  return {
    command: process.execPath,
    args: [path.join(workerRoot, "node_modules", "tsx", "dist", "cli.mjs"), "src/index.ts", mode]
  };
}

export function launchWorker(workerRoot: string, mode: WorkerMode): WorkerChildProcess {
  const { command, args } = buildWorkerCommand(workerRoot, mode);
  return spawn(command, args, {
    cwd: workerRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  }) as ChildProcess;
}

export async function stopWorkerProcess(child: WorkerChildProcess) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    await execFileAsync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    return;
  }
  (child as ChildProcess).kill("SIGTERM");
}

export async function probeCentralApi(
  apiUrl: string,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = fetch
): Promise<CentralApiHealth> {
  try {
    const baseUrl = apiUrl.replace(/\/+$/, "");
    const response = await fetchImpl(`${baseUrl}/health`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return { state: "error" };
    const value = await response.json() as { ok?: unknown; database?: unknown };
    if (value.ok !== true || typeof value.database !== "string") return { state: "error" };
    return { state: "ok", database: value.database };
  } catch {
    return { state: "error" };
  }
}
