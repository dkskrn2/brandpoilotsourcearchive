import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  contentWorkerApiError,
  contentWorkerPollDelayMs,
  contentWorkerPollObservation,
  isRetryableContentWorkerError,
  runShellCommandWithTimeout,
  terminateProcessTree,
} from "./index.js";

describe("worker runtime process helpers", () => {
  it("terminates a Windows process tree with taskkill", async () => {
    const execFileImpl = vi.fn((...args: unknown[]) => {
      (args[3] as (error: null, stdout: string, stderr: string) => void)(null, "", "");
      return {} as never;
    });

    await terminateProcessTree(
      { pid: 123, kill: vi.fn() },
      { platform: "win32", execFileImpl: execFileImpl as never },
    );

    expect(execFileImpl).toHaveBeenCalledWith(
      "taskkill",
      ["/PID", "123", "/T", "/F"],
      { windowsHide: true },
      expect.any(Function),
    );
  });

  it("runs an argv command in the explicit workspace with only the explicit environment", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "worker-runtime-command-"));
    const probePath = path.join(runtimeDirectory, "probe.mjs");
    const outputPath = path.join(runtimeDirectory, "child.json");
    await writeFile(probePath, [
      'import { writeFile } from "node:fs/promises";',
      `await writeFile(${JSON.stringify(outputPath)}, JSON.stringify({`,
      "  cwd: process.cwd(),",
      "  allowed: process.env.RUNTIME_ALLOWED ?? null,",
      "  secret: process.env.WORKER_API_TOKEN ?? null,",
      "}));",
    ].join("\n"), "utf8");
    const previousSecret = process.env.WORKER_API_TOKEN;
    process.env.WORKER_API_TOKEN = "must-not-be-inherited";
    try {
      await runShellCommandWithTimeout({
        command: process.execPath,
        args: [probePath],
        cwd: runtimeDirectory,
        env: { RUNTIME_ALLOWED: "yes" },
        timeoutMs: 5_000,
        timeoutErrorCode: "probe_timeout",
        processErrorCode: "probe_failed",
      });

      expect(JSON.parse(await readFile(outputPath, "utf8"))).toEqual({
        cwd: runtimeDirectory,
        allowed: "yes",
        secret: null,
      });
    } finally {
      if (previousSecret === undefined) delete process.env.WORKER_API_TOKEN;
      else process.env.WORKER_API_TOKEN = previousSecret;
      await rm(runtimeDirectory, { recursive: true, force: true });
    }
  });

  it("rejects a pre-aborted command without spawning", async () => {
    const controller = new AbortController();
    const reason = new Error("worker_resource_lease_invalid");
    controller.abort(reason);
    const spawnImpl = vi.fn();

    await expect(runShellCommandWithTimeout({
      command: "must-not-spawn",
      signal: controller.signal,
      timeoutMs: 5_000,
      timeoutErrorCode: "probe_timeout",
      processErrorCode: "probe_failed",
    }, { spawnImpl: spawnImpl as never })).rejects.toBe(reason);

    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it("awaits process-tree termination on abort and settles only once", async () => {
    const child = Object.assign(new EventEmitter(), { pid: 123, kill: vi.fn() });
    const spawnImpl = vi.fn(() => child);
    let releaseTermination!: () => void;
    const terminateProcessTreeImpl = vi.fn(() => new Promise<void>((resolve) => {
      releaseTermination = resolve;
    }));
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, "removeEventListener");
    const reason = new Error("brand_analysis_lease_invalid");
    let outcome: { status: "resolved" } | { status: "rejected"; error: unknown } | undefined;

    const pending = runShellCommandWithTimeout({
      command: "codex",
      signal: controller.signal,
      timeoutMs: 5_000,
      timeoutErrorCode: "probe_timeout",
      processErrorCode: "probe_failed",
    }, { spawnImpl: spawnImpl as never, terminateProcessTreeImpl }).then(
      () => { outcome = { status: "resolved" }; },
      (error) => { outcome = { status: "rejected", error }; },
    );

    controller.abort(reason);
    await vi.waitFor(() => expect(terminateProcessTreeImpl).toHaveBeenCalledWith(child));
    child.emit("close", 0);
    await Promise.resolve();
    expect(outcome).toBeUndefined();

    releaseTermination();
    await pending;
    expect(outcome).toEqual({ status: "rejected", error: reason });
    expect(terminateProcessTreeImpl).toHaveBeenCalledTimes(1);
    expect(removeEventListener).toHaveBeenCalledTimes(1);
  });

  it("removes the abort listener after normal completion", async () => {
    const child = Object.assign(new EventEmitter(), { pid: 456, kill: vi.fn() });
    const spawnImpl = vi.fn(() => child);
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, "removeEventListener");

    const pending = runShellCommandWithTimeout({
      command: "codex",
      signal: controller.signal,
      timeoutMs: 5_000,
      timeoutErrorCode: "probe_timeout",
      processErrorCode: "probe_failed",
    }, { spawnImpl: spawnImpl as never, terminateProcessTreeImpl: vi.fn() });
    child.emit("close", 0);

    await expect(pending).resolves.toBeUndefined();
    expect(removeEventListener).toHaveBeenCalledTimes(1);
  });

  it("classifies contract errors as terminal and process failures as retryable", () => {
    expect(isRetryableContentWorkerError(new Error("card_news_content_invalid"))).toBe(false);
    expect(isRetryableContentWorkerError(new Error("card_news_output_id_required"))).toBe(false);
    expect(isRetryableContentWorkerError(new Error("codex_card_news_failed:1"))).toBe(true);
  });

  it("preserves only the exact maintenance code from a 503 response", async () => {
    const maintenance = await contentWorkerApiError(new Response(
      JSON.stringify({ error: "ai_content_maintenance" }),
      { status: 503, headers: { "content-type": "application/json" } },
    ));
    const ordinary503 = await contentWorkerApiError(new Response(
      JSON.stringify({ error: "upstream included SECRET_DETAIL" }),
      { status: 503, headers: { "content-type": "application/json" } },
    ));

    expect(maintenance.message).toBe("worker_api_failed:503:ai_content_maintenance");
    expect(ordinary503.message).toBe("worker_api_failed:503");
  });

  it("emits non-secret poll observations that distinguish maintenance from other errors", () => {
    expect(contentWorkerPollObservation(
      new Error("worker_api_failed:503:ai_content_maintenance"),
    )).toEqual({
      event: "content_worker_poll_error",
      classification: "maintenance",
      errorCode: "ai_content_maintenance",
      nextAction: "poll_after_delay",
    });
    const ordinary = contentWorkerPollObservation(
      new Error("fetch failed for https://api.example/?token=SECRET_TOKEN"),
    );
    expect(ordinary).toEqual({
      event: "content_worker_poll_error",
      classification: "transient_error",
      errorCode: "content_worker_poll_failed",
      nextAction: "poll_after_delay",
    });
    expect(JSON.stringify(ordinary)).not.toContain("SECRET_TOKEN");
  });

  it("keeps poll delays bounded away from a tight loop when configuration is invalid", () => {
    expect(contentWorkerPollDelayMs(undefined, 10_000)).toBe(10_000);
    expect(contentWorkerPollDelayMs("not-a-number", 10_000)).toBe(10_000);
    expect(contentWorkerPollDelayMs(0, 10_000)).toBe(1_000);
    expect(contentWorkerPollDelayMs(-50, 10_000)).toBe(1_000);
    expect(contentWorkerPollDelayMs("2500", 10_000)).toBe(2_500);
  });
});
