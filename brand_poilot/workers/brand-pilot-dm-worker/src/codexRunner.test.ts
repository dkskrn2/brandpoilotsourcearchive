import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCodexJson } from "./codexRunner.js";

function createChild(onEnd?: (child: ReturnType<typeof createChild>) => void) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { end(value: string): void };
    kill: ReturnType<typeof vi.fn>;
  };
  child.pid = 1234;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.stdin = {
    end() {
      onEnd?.(child);
    },
  };
  return child;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("runCodexJson", () => {
  it("uses the resolved Windows Codex invocation", async () => {
    const child = createChild((runningChild) => {
      runningChild.stdout.emit("data", JSON.stringify({ decision: "ignore" }) + "\n");
      queueMicrotask(() => runningChild.emit("close", 0));
    });
    const spawnImpl = vi.fn(() => child) as any;

    await runCodexJson({
      prompt: "질문",
      runtimeDirectory: "C:\\worker",
      model: "gpt-5.4",
      reasoningEffort: "none",
      fastMode: true,
      env: {
        PATH: "C:\\Windows\\System32",
        CODEX_HOME: "C:\\codex",
        LANG: "ko_KR.UTF-8",
        OPENAI_API_KEY: "openai-secret",
        WORKER_API_TOKEN: "worker-secret",
        DM_WORKER_DATABASE_URL: "postgres://secret",
      },
      spawnImpl,
      resolveInvocation: () => ({
        command: "C:\\Program Files\\nodejs\\node.exe",
        argsPrefix: ["C:\\Users\\worker\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js"],
      }),
    } as any);

    expect(spawnImpl).toHaveBeenCalledWith(
      "C:\\Program Files\\nodejs\\node.exe",
      [
        "C:\\Users\\worker\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js",
        "exec",
        "--ignore-user-config",
        "--strict-config",
        "-m",
        "gpt-5.4",
        "-c",
        "model_reasoning_effort=\"none\"",
        "--enable",
        "fast_mode",
        "-c",
        "service_tier=\"fast\"",
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
        "C:\\worker",
        "-",
      ],
      expect.objectContaining({
        cwd: "C:\\worker",
        shell: false,
        env: {
          PATH: "C:\\Windows\\System32",
          CODEX_HOME: "C:\\codex",
          LANG: "ko_KR.UTF-8",
        },
      }),
    );
    expect(spawnImpl.mock.calls[0]?.[1]).not.toContain("--sandbox");
  });

  it("times out the process tree and waits for termination before rejecting", async () => {
    vi.useFakeTimers();
    const child = createChild();
    let finishTermination!: () => void;
    const terminateProcessTree = vi.fn(() => new Promise<void>((resolve) => {
      finishTermination = resolve;
    }));
    let outcome: "resolved" | "rejected" | undefined;
    let failure: unknown;
    const running = runCodexJson({
      prompt: "질문",
      runtimeDirectory: "C:\\worker",
      timeoutMs: 100,
      spawnImpl: vi.fn(() => child) as any,
      terminateProcessTree,
    }).then(
      () => { outcome = "resolved"; },
      (error) => {
        outcome = "rejected";
        failure = error;
      },
    );

    await vi.advanceTimersByTimeAsync(100);
    child.emit("close", 0);
    await Promise.resolve();
    expect(terminateProcessTree).toHaveBeenCalledWith(child);
    expect(outcome).toBeUndefined();

    finishTermination();
    await running;
    expect(outcome).toBe("rejected");
    expect(failure).toEqual(expect.objectContaining({ message: "codex_timeout" }));
  });
});
