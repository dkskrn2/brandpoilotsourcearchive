import { execFile, spawn, type ChildProcess } from "node:child_process";

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
  timeoutMs: number;
  timeoutErrorCode: string;
  processErrorCode: string;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(input.command, {
      shell: true,
      stdio: "inherit",
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      void terminateProcessTree(child).finally(() => finish(() => reject(new Error(input.timeoutErrorCode))));
    }, input.timeoutMs);
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => finish(() => code === 0
      ? resolve()
      : reject(new Error(`${input.processErrorCode}:${code}`))));
  });
}

export function isRetryableContentWorkerError(error: unknown): boolean {
  if (error instanceof SyntaxError) return false;
  const code = error instanceof Error ? error.message.split(":")[0] : String(error);
  if (code === "ENOENT" || code.includes("output_id_required")) return false;
  return !/_(?:invalid|required|mismatch)$/.test(code);
}
