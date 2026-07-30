import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  forwardParentTermination,
  signalProcessTree
} from "./processTermination.mjs";

describe("image renderer process termination", () => {
  it("signals the detached Linux process group", async () => {
    const killProcess = vi.fn();
    const childKill = vi.fn();

    await signalProcessTree(
      { pid: 321, kill: childKill },
      "SIGTERM",
      { platform: "linux", killProcess }
    );

    expect(killProcess).toHaveBeenCalledWith(-321, "SIGTERM");
    expect(childKill).not.toHaveBeenCalled();
  });

  it("terminates a Windows process tree with direct bounded taskkill argv", async () => {
    const taskkillProcess = { kill: vi.fn() };
    const execFileImpl = vi.fn((
      _command: string,
      _args: string[],
      _options: Record<string, unknown>,
      callback: (error: Error | null) => void
    ) => {
      callback(null);
      return taskkillProcess;
    });
    const childKill = vi.fn();

    await signalProcessTree(
      { pid: 654, kill: childKill },
      "SIGTERM",
      {
        platform: "win32",
        execFileImpl,
        taskkillTimeoutMs: 250
      }
    );

    expect(execFileImpl).toHaveBeenCalledWith(
      "taskkill",
      ["/PID", "654", "/T", "/F"],
      { windowsHide: true },
      expect.any(Function)
    );
    expect(childKill).not.toHaveBeenCalled();
    expect(taskkillProcess.kill).not.toHaveBeenCalled();
  });

  it("bounds a hung taskkill and falls back without throwing", async () => {
    vi.useFakeTimers();
    try {
      const taskkillProcess = { kill: vi.fn() };
      const execFileImpl = vi.fn(() => taskkillProcess);
      const childKill = vi.fn();
      const termination = signalProcessTree(
        { pid: 777, kill: childKill },
        "SIGTERM",
        {
          platform: "win32",
          execFileImpl,
          taskkillTimeoutMs: 50
        }
      );

      await vi.advanceTimersByTimeAsync(50);
      await expect(termination).resolves.toBeUndefined();
      expect(taskkillProcess.kill).toHaveBeenCalledWith("SIGKILL");
      expect(childKill).toHaveBeenCalledWith("SIGKILL");
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats a missing child PID as already exited", async () => {
    const execFileImpl = vi.fn();
    const childKill = vi.fn();

    await expect(signalProcessTree(
      { pid: undefined, kill: childKill },
      "SIGTERM",
      { platform: "win32", execFileImpl }
    )).resolves.toBeUndefined();

    expect(execFileImpl).not.toHaveBeenCalled();
    expect(childKill).not.toHaveBeenCalled();
  });

  it("forwards wrapper termination to Codex and removes handlers after disposal", () => {
    const parentProcess = new EventEmitter();
    const child = { kill: vi.fn() };
    const forwarding = forwardParentTermination({ parentProcess, child });

    parentProcess.emit("SIGTERM");

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(forwarding.signal).toBe("SIGTERM");
    expect(parentProcess.listenerCount("SIGTERM")).toBe(0);
    expect(parentProcess.listenerCount("SIGINT")).toBe(0);

    forwarding.dispose();
    parentProcess.emit("SIGINT");
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});
