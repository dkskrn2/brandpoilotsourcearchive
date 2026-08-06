import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildContentProposalCodexChildEnv,
  createCodexContentProposalModel,
} from "./codexModel.js";

type TestChild = EventEmitter & {
  pid: number;
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};

function child(): TestChild {
  const value = new EventEmitter() as TestChild;
  value.pid = 1234;
  value.stdin = new PassThrough();
  value.stdout = new PassThrough();
  value.stderr = new PassThrough();
  value.kill = vi.fn();
  return value;
}

function completed(text: string): string {
  return `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } })}\n`;
}

function runtime() {
  return {
    createRuntimeDirectory: vi.fn(async () => "C:\\temp\\proposal"),
    removeRuntimeDirectory: vi.fn(async () => undefined),
  };
}

afterEach(() => vi.useRealTimers());

describe("Proposal V2 Codex model", () => {
  it("always invokes Terra with the canonical output schema and exposes hashes, not raw transcript", async () => {
    const process = child();
    const spawnProcess = vi.fn(() => process);
    const temp = runtime();
    let stdin = "";
    process.stdin.on("data", (chunk) => { stdin += String(chunk); });
    const model = createCodexContentProposalModel({
      command: "codex", timeoutMs: 10_000,
      outputSchemaPath: "C:\\contracts\\content-proposal-v2.schema.json",
      spawnProcess,
      ...temp,
      env: { PATH: "/usr/bin", OPENAI_API_KEY: "secret", DATABASE_URL: "secret" },
    });
    const rawOutput = JSON.stringify({ contractVersion: "content-proposal.v2", proposals: [] });
    const promise = model.generate("frozen prompt");
    await Promise.resolve();
    process.stdout.write(completed(rawOutput));
    process.emit("close", 0, null);
    await expect(promise).resolves.toEqual({
      output: JSON.parse(rawOutput), rawOutput, syntaxValid: true,
      transcriptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(stdin).toBe("frozen prompt");
    expect(spawnProcess.mock.calls[0]?.[1]).toEqual(expect.arrayContaining([
      "-m", "gpt-5.6-terra", "--output-schema", "C:\\contracts\\content-proposal-v2.schema.json",
    ]));
    expect(spawnProcess.mock.calls[0]?.[2]).toEqual(expect.objectContaining({
      env: { PATH: "/usr/bin" }, shell: false, windowsHide: true,
    }));
    expect(await promise).not.toHaveProperty("transcript");
  });

  it("returns invalid JSON as a completed parser-invalid output with stable hashes", async () => {
    const process = child();
    const temp = runtime();
    const model = createCodexContentProposalModel({
      command: "codex", timeoutMs: 10_000, spawnProcess: vi.fn(() => process), ...temp,
    });
    const promise = model.generate("prompt");
    await Promise.resolve();
    process.stdout.write(completed("not-json"));
    process.emit("close", 0, null);
    await expect(promise).resolves.toEqual({
      output: null, rawOutput: "not-json", syntaxValid: false,
      transcriptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("does not rewrite a completed invocation when temporary-directory cleanup fails", async () => {
    const process = child();
    const model = createCodexContentProposalModel({
      command: "codex",
      timeoutMs: 10_000,
      spawnProcess: vi.fn(() => process),
      createRuntimeDirectory: vi.fn(async () => "C:\\temp\\proposal"),
      removeRuntimeDirectory: vi.fn(async () => { throw new Error("cleanup_failed"); }),
    });
    const promise = model.generate("prompt");
    await Promise.resolve();
    process.stdout.write(completed("{}"));
    process.emit("close", 0, null);
    await expect(promise).resolves.toMatchObject({ output: {}, syntaxValid: true });
  });

  it("classifies a nonzero exit as definite failure and timeout/abort as indeterminate", async () => {
    const failed = child();
    const firstRuntime = runtime();
    const failedPromise = createCodexContentProposalModel({
      command: "codex", timeoutMs: 10_000, spawnProcess: vi.fn(() => failed), ...firstRuntime,
    }).generate("prompt");
    await Promise.resolve();
    failed.emit("close", 7, null);
    await expect(failedPromise).rejects.toMatchObject({ outcome: "definite_failure" });

    vi.useFakeTimers();
    const timedOut = child();
    const terminate = vi.fn(async () => undefined);
    const secondRuntime = runtime();
    const timeoutPromise = createCodexContentProposalModel({
      command: "codex", timeoutMs: 50, spawnProcess: vi.fn(() => timedOut),
      terminateProcessTree: terminate, ...secondRuntime,
    }).generate("prompt");
    const timeoutAssertion = expect(timeoutPromise).rejects.toMatchObject({ outcome: "indeterminate" });
    await vi.advanceTimersByTimeAsync(50);
    await timeoutAssertion;
    expect(terminate).toHaveBeenCalledWith(timedOut);
  });

  it("excludes credentials and proxy secrets from the child environment", () => {
    expect(buildContentProposalCodexChildEnv({
      PATH: "/bin", CODEX_HOME: "/codex", OPENAI_API_KEY: "secret",
      HTTP_PROXY: "proxy", HTTPS_PROXY: "proxy", DATABASE_URL: "secret",
    })).toEqual({ PATH: "/bin", CODEX_HOME: "/codex" });
  });
});
