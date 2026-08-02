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

function createTestChild(): TestChild {
  const child = new EventEmitter() as TestChild;
  child.pid = 1234;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  return child;
}

function completedMessage(text: string): string {
  return `${JSON.stringify({
    type: "item.completed",
    item: { type: "agent_message", text },
  })}\n`;
}

function runtime(directory = "C:\\temp\\content-proposal-1") {
  return {
    directory,
    createRuntimeDirectory: vi.fn(async () => directory),
    removeRuntimeDirectory: vi.fn(async () => undefined),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Codex content proposal model", () => {
  it("uses the locked read-only CLI invocation, safe child env, and prompt stdin", async () => {
    const child = createTestChild();
    let stdin = "";
    child.stdin.on("data", (chunk) => {
      stdin += String(chunk);
    });
    const spawnProcess = vi.fn(() => child);
    const runtimeDirectory = runtime();
    const model = createCodexContentProposalModel({
      command: "codex",
      model: "gpt-5.4",
      timeoutMs: 10_000,
      spawnProcess,
      createRuntimeDirectory: runtimeDirectory.createRuntimeDirectory,
      removeRuntimeDirectory: runtimeDirectory.removeRuntimeDirectory,
      env: {
        PATH: "/usr/bin",
        CODEX_HOME: "/codex",
        LANG: "ko_KR.UTF-8",
        ALL_PROXY: "http://proxy-secret",
        HTTP_PROXY: "http://proxy-secret",
        HTTPS_PROXY: "http://proxy-secret",
        OPENAI_API_KEY: "openai-secret",
        CONTENT_PROPOSAL_WORKER_API_TOKEN: "worker-secret",
        BRAND_PILOT_API_URL: "https://api.internal",
        DATABASE_URL: "postgres://secret",
      },
    });

    const generated = model.generate("frozen prompt");
    await Promise.resolve();
    child.stdout.write(`${JSON.stringify({ type: "thread.started", thread_id: "thread-1" })}\n`);
    child.stdout.write(completedMessage(JSON.stringify([{ title: "first" }])));
    child.stdout.write(completedMessage(JSON.stringify([{ title: "final" }])));
    child.emit("close", 0, null);

    await expect(generated).resolves.toEqual([{ title: "final" }]);
    expect(stdin).toBe("frozen prompt");
    expect(spawnProcess).toHaveBeenCalledWith(
      "codex",
      [
        "exec",
        "--ignore-user-config",
        "--strict-config",
        "-m",
        "gpt-5.4",
        "-c",
        "default_permissions=\"worker\"",
        "-c",
        "permissions.worker.filesystem={\":minimal\"=\"deny\",\"/codex\"=\"deny\",\":workspace_roots\"={\".\"=\"deny\"}}",
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
        runtimeDirectory.directory,
        "-",
      ],
      expect.objectContaining({
        cwd: runtimeDirectory.directory,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          PATH: "/usr/bin",
          CODEX_HOME: "/codex",
          LANG: "ko_KR.UTF-8",
        },
      }),
    );
    const childEnv = spawnProcess.mock.calls[0]?.[2]?.env;
    expect(childEnv).not.toHaveProperty("OPENAI_API_KEY");
    expect(childEnv).not.toHaveProperty("CONTENT_PROPOSAL_WORKER_API_TOKEN");
    expect(childEnv).not.toHaveProperty("BRAND_PILOT_API_URL");
    expect(childEnv).not.toHaveProperty("DATABASE_URL");
    expect(childEnv).not.toHaveProperty("ALL_PROXY");
    expect(childEnv).not.toHaveProperty("HTTP_PROXY");
    expect(childEnv).not.toHaveProperty("HTTPS_PROXY");
    expect(spawnProcess.mock.calls[0]?.[1]).not.toContain("--output-schema");
    expect(spawnProcess.mock.calls[0]?.[1]).not.toContain("--sandbox");
    expect(spawnProcess.mock.calls[0]?.[1]).not.toContain("--search");
    expect(spawnProcess.mock.calls[0]?.[1]).toContain("exec");
    expect(spawnProcess.mock.calls[0]?.[1]).toContain("--ephemeral");
    expect(spawnProcess.mock.calls[0]?.[1]?.join(" ")).toContain("network.enabled=false");
    const args = spawnProcess.mock.calls[0]?.[1] ?? [];
    for (const feature of ["shell_tool", "shell_snapshot", "image_generation"]) {
      const featureIndex = args.indexOf(feature);
      expect(featureIndex).toBeGreaterThan(0);
      expect(args[featureIndex - 1]).toBe("--disable");
    }
    expect(runtimeDirectory.removeRuntimeDirectory)
      .toHaveBeenCalledWith(runtimeDirectory.directory);
  });

  it("excludes proxy credentials from the child environment", () => {
    expect(buildContentProposalCodexChildEnv({
      PATH: "/usr/bin",
      ALL_PROXY: "http://all-proxy-secret",
      HTTP_PROXY: "http://http-proxy-secret",
      HTTPS_PROXY: "http://https-proxy-secret",
    })).toEqual({ PATH: "/usr/bin" });
  });

  it("rejects invalid final model JSON with SyntaxError", async () => {
    const child = createTestChild();
    const spawnProcess = vi.fn(() => child);
    const runtimeDirectory = runtime();
    const model = createCodexContentProposalModel({
      command: "codex",
      model: "gpt-5.4",
      timeoutMs: 10_000,
      spawnProcess,
      createRuntimeDirectory: runtimeDirectory.createRuntimeDirectory,
      removeRuntimeDirectory: runtimeDirectory.removeRuntimeDirectory,
    });

    const generated = model.generate("prompt");
    await Promise.resolve();
    child.stdout.write(completedMessage("not-json"));
    child.emit("close", 0, null);

    await expect(generated).rejects.toEqual(
      expect.objectContaining({
        name: "SyntaxError",
        message: "content_proposal_model_output_invalid",
        rawOutput: "not-json",
      }),
    );
    expect(runtimeDirectory.removeRuntimeDirectory)
      .toHaveBeenCalledWith(runtimeDirectory.directory);
  });

  it("preserves the complete bounded invalid final response for repair", async () => {
    const child = createTestChild();
    const runtimeDirectory = runtime();
    const model = createCodexContentProposalModel({
      command: "codex",
      timeoutMs: 10_000,
      spawnProcess: vi.fn(() => child),
      createRuntimeDirectory: runtimeDirectory.createRuntimeDirectory,
      removeRuntimeDirectory: runtimeDirectory.removeRuntimeDirectory,
    });
    const markerAfterTheOldBoundary = "MARKER_AFTER_100K_BOUNDARY";
    const rawOutput = `${"x".repeat(100_001)}${markerAfterTheOldBoundary}`;

    const generated = model.generate("prompt");
    await Promise.resolve();
    child.stdout.write(completedMessage(rawOutput));
    child.emit("close", 0, null);

    await expect(generated).rejects.toEqual(expect.objectContaining({
      name: "SyntaxError",
      message: "content_proposal_model_output_invalid",
      rawOutput,
    }));
  });

  it("stops the process tree when chunked unterminated stdout exceeds one MiB by bytes", async () => {
    const child = createTestChild();
    const runtimeDirectory = runtime();
    let finishTermination: (() => void) | undefined;
    const terminateProcessTree = vi.fn(() => new Promise<void>((resolve) => {
      finishTermination = resolve;
    }));
    const model = createCodexContentProposalModel({
      command: "codex",
      timeoutMs: 10_000,
      spawnProcess: vi.fn(() => child),
      terminateProcessTree,
      createRuntimeDirectory: runtimeDirectory.createRuntimeDirectory,
      removeRuntimeDirectory: runtimeDirectory.removeRuntimeDirectory,
    });

    const generated = model.generate("prompt");
    await Promise.resolve();
    const multibyteChunk = "가".repeat(90_000);
    for (let index = 0; index < 4; index += 1) child.stdout.write(multibyteChunk);
    child.stdout.write("ignored after stopping");

    expect(terminateProcessTree).toHaveBeenCalledTimes(1);
    finishTermination?.();
    await expect(generated).rejects.toThrow("content_proposal_model_output_limit_exceeded");
  });

  it("preserves UTF-8 model JSON split across stdout chunks", async () => {
    const child = createTestChild();
    const spawnProcess = vi.fn(() => child);
    const runtimeDirectory = runtime();
    const model = createCodexContentProposalModel({
      command: "codex",
      model: "gpt-5.4",
      timeoutMs: 10_000,
      spawnProcess,
      createRuntimeDirectory: runtimeDirectory.createRuntimeDirectory,
      removeRuntimeDirectory: runtimeDirectory.removeRuntimeDirectory,
    });
    const output = [{ title: "한글 제안" }];
    const jsonLine = Buffer.from(completedMessage(JSON.stringify(output)));
    const splitAt = jsonLine.indexOf(Buffer.from("한")) + 1;

    const generated = model.generate("prompt");
    await Promise.resolve();
    child.stdout.write(jsonLine.subarray(0, splitAt));
    child.stdout.write(jsonLine.subarray(splitAt));
    child.emit("close", 0, null);

    await expect(generated).resolves.toEqual(output);
  });

  it("returns a stable retryable process failure with bounded stderr", async () => {
    const child = createTestChild();
    const spawnProcess = vi.fn(() => child);
    const runtimeDirectory = runtime();
    const model = createCodexContentProposalModel({
      command: "codex",
      model: "gpt-5.4",
      timeoutMs: 10_000,
      spawnProcess,
      createRuntimeDirectory: runtimeDirectory.createRuntimeDirectory,
      removeRuntimeDirectory: runtimeDirectory.removeRuntimeDirectory,
    });

    const generated = model.generate("prompt");
    await Promise.resolve();
    child.stderr.write("x".repeat(10_000));
    child.emit("close", 7, null);

    const error = await generated.catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^content_proposal_model_process_failed:7:/);
    expect((error as Error).message.length).toBeLessThanOrEqual(2_050);
    expect(runtimeDirectory.removeRuntimeDirectory)
      .toHaveBeenCalledWith(runtimeDirectory.directory);
  });

  it("terminates the process tree and returns a stable timeout failure", async () => {
    vi.useFakeTimers();
    const child = createTestChild();
    const terminateProcessTree = vi.fn(async () => undefined);
    const runtimeDirectory = runtime();
    const model = createCodexContentProposalModel({
      command: "codex",
      model: "gpt-5.4",
      timeoutMs: 100,
      spawnProcess: vi.fn(() => child),
      terminateProcessTree,
      createRuntimeDirectory: runtimeDirectory.createRuntimeDirectory,
      removeRuntimeDirectory: runtimeDirectory.removeRuntimeDirectory,
    });

    const generated = model.generate("prompt");
    await Promise.resolve();
    const rejection = expect(generated).rejects.toThrow("content_proposal_model_timeout");
    await vi.advanceTimersByTimeAsync(100);

    await rejection;
    expect(terminateProcessTree).toHaveBeenCalledWith(child);
    expect(runtimeDirectory.removeRuntimeDirectory)
      .toHaveBeenCalledWith(runtimeDirectory.directory);
  });

  it("terminates the process tree when lease loss aborts generation", async () => {
    const child = createTestChild();
    const terminateProcessTree = vi.fn(async () => undefined);
    const controller = new AbortController();
    const runtimeDirectory = runtime();
    const model = createCodexContentProposalModel({
      command: "codex",
      model: "gpt-5.4",
      timeoutMs: 10_000,
      spawnProcess: vi.fn(() => child),
      terminateProcessTree,
      createRuntimeDirectory: runtimeDirectory.createRuntimeDirectory,
      removeRuntimeDirectory: runtimeDirectory.removeRuntimeDirectory,
    });

    const generated = model.generate("prompt", controller.signal);
    await Promise.resolve();
    controller.abort();

    await expect(generated).rejects.toThrow("content_proposal_model_aborted");
    expect(terminateProcessTree).toHaveBeenCalledWith(child);
    expect(runtimeDirectory.removeRuntimeDirectory)
      .toHaveBeenCalledWith(runtimeDirectory.directory);
  });

  it("closes the abort race before writing the prompt", async () => {
    const child = createTestChild();
    let stdin = "";
    child.stdin.on("data", (chunk) => {
      stdin += String(chunk);
    });
    const controller = new AbortController();
    const terminateProcessTree = vi.fn(async () => undefined);
    const runtimeDirectory = runtime();
    const spawnProcess = vi.fn(() => {
      controller.abort();
      return child;
    });
    const model = createCodexContentProposalModel({
      command: "codex",
      model: "gpt-5.4",
      timeoutMs: 10_000,
      spawnProcess,
      terminateProcessTree,
      createRuntimeDirectory: runtimeDirectory.createRuntimeDirectory,
      removeRuntimeDirectory: runtimeDirectory.removeRuntimeDirectory,
    });

    const generated = model.generate("must-not-be-written", controller.signal);
    await Promise.resolve();
    child.emit("close", 0, null);

    await expect(generated).rejects.toThrow("content_proposal_model_aborted");
    expect(terminateProcessTree).toHaveBeenCalledWith(child);
    expect(stdin).toBe("");
    expect(runtimeDirectory.removeRuntimeDirectory)
      .toHaveBeenCalledWith(runtimeDirectory.directory);
  });
});
