import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { runCodexJson } from "./codexRunner.js";

describe("runCodexJson", () => {
  it("uses the resolved Windows Codex invocation", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: { end(value: string): void };
      kill(): void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    child.stdin = {
      end() {
        child.stdout.emit("data", JSON.stringify({ decision: "ignore" }) + "\n");
        queueMicrotask(() => child.emit("close", 0));
      },
    };
    const spawnImpl = vi.fn(() => child) as any;

    await runCodexJson({
      prompt: "질문",
      runtimeDirectory: "C:\\worker",
      model: "gpt-5.4",
      reasoningEffort: "none",
      fastMode: true,
      spawnImpl,
      resolveInvocation: () => ({
        command: "C:\\Program Files\\nodejs\\node.exe",
        argsPrefix: ["C:\\Users\\worker\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js"],
      }),
    } as any);

    expect(spawnImpl).toHaveBeenCalledWith(
      "C:\\Program Files\\nodejs\\node.exe",
      expect.arrayContaining([
        "-m",
        "gpt-5.4",
        "-c",
        "model_reasoning_effort=\"none\"",
        "--enable",
        "fast_mode",
        "-c",
        "service_tier=\"fast\"",
      ]),
      expect.any(Object),
    );
  });
});
