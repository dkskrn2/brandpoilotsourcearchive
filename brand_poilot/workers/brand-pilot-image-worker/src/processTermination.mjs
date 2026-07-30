import { execFile } from "node:child_process";

/**
 * @param {{ pid?: number, kill(signal?: NodeJS.Signals): unknown }} child
 * @param {NodeJS.Signals} signal
 * @param {{
 *   platform?: NodeJS.Platform,
 *   killProcess?: typeof process.kill,
 *   execFileImpl?: typeof execFile,
 *   taskkillTimeoutMs?: number
 * }} [dependencies]
 */
export async function signalProcessTree(child, signal, dependencies = {}) {
  const platform = dependencies.platform ?? process.platform;
  if (!child.pid) return;

  if (platform !== "win32") {
    try {
      (dependencies.killProcess ?? process.kill)(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct child if it exited before group signaling.
    }

    try {
      child.kill(signal);
    } catch {
      // The child may already have exited.
    }
    return;
  }

  await new Promise((resolve) => {
    let settled = false;
    /** @type {{ kill(signal?: NodeJS.Signals): unknown } | undefined} */
    let taskkillProcess;

    const fallback = () => {
      try {
        child.kill("SIGKILL");
      } catch {
        // The child may already have exited.
      }
    };
    const finish = (useFallback = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (useFallback) fallback();
      resolve(undefined);
    };
    const timeout = setTimeout(() => {
      try {
        taskkillProcess?.kill("SIGKILL");
      } catch {
        // The taskkill helper may already have exited.
      }
      finish(true);
    }, dependencies.taskkillTimeoutMs ?? 5_000);

    try {
      taskkillProcess = (dependencies.execFileImpl ?? execFile)(
        "taskkill",
        ["/PID", String(child.pid), "/T", "/F"],
        { windowsHide: true },
        (error) => finish(Boolean(error))
      );
    } catch {
      finish(true);
    }
  });
}

/**
 * @param {{
 *   parentProcess?: Pick<NodeJS.Process, "once" | "removeListener">,
 *   child: { kill(signal?: NodeJS.Signals): unknown }
 * }} input
 */
export function forwardParentTermination({ parentProcess = process, child }) {
  /** @type {NodeJS.Signals | null} */
  let signal = null;
  const dispose = () => {
    parentProcess.removeListener("SIGTERM", onSigterm);
    parentProcess.removeListener("SIGINT", onSigint);
  };
  /** @param {NodeJS.Signals} nextSignal */
  const forward = (nextSignal) => {
    if (signal) return;
    signal = nextSignal;
    dispose();
    try {
      child.kill(nextSignal);
    } catch {
      // The child may already have exited; normal exit handling will settle.
    }
  };
  const onSigterm = () => forward("SIGTERM");
  const onSigint = () => forward("SIGINT");
  parentProcess.once("SIGTERM", onSigterm);
  parentProcess.once("SIGINT", onSigint);
  return {
    get signal() {
      return signal;
    },
    dispose
  };
}
