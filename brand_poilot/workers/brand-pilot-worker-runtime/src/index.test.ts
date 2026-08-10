import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  ContentWorkerApiError,
  classifyContentWorkerError,
  contentWorkerApiError,
  contentWorkerPollDelayMs,
  contentWorkerPollObservation,
  createCodexAccountPool,
  isRetryableContentWorkerError,
  replayContentWorkerCompletion,
  runShellCommandWithAccountFailover,
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

  it("runs the same bounded command under secondary after primary usage exhaustion", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "worker-runtime-accounts-"));
    for (const alias of ["primary", "secondary"]) {
      const home = path.join(root, alias);
      await mkdir(home);
      await writeFile(path.join(home, "auth.json"), "{}", "utf8");
    }
    const pool = await createCodexAccountPool({ root, aliases: ["primary", "secondary"] });
    const primary = Object.assign(new EventEmitter(), {
      pid: 1001, kill: vi.fn(), stderr: new PassThrough(),
    });
    const secondary = Object.assign(new EventEmitter(), {
      pid: 1002, kill: vi.fn(), stderr: new PassThrough(),
    });
    const spawnImpl = vi.fn()
      .mockReturnValueOnce(primary)
      .mockReturnValueOnce(secondary);
    try {
      const pending = runShellCommandWithAccountFailover({
        accountPool: pool,
        buildAttempt: async (profile) => ({
          command: "codex",
          args: ["exec"],
          value: profile.alias,
          acceptedOutput: async () => false,
        }),
        timeoutMs: 5_000,
        timeoutErrorCode: "probe_timeout",
        processErrorCode: "probe_failed",
      }, { spawnImpl: spawnImpl as never });

      await vi.waitFor(() => expect(spawnImpl).toHaveBeenCalledTimes(1));
      primary.stderr.write("You've hit your usage limit");
      primary.emit("close", 1);
      await vi.waitFor(() => expect(spawnImpl).toHaveBeenCalledTimes(2));
      secondary.emit("close", 0);

      await expect(pending).resolves.toMatchObject({
        profile: { alias: "secondary" }, value: "secondary",
      });
      expect(spawnImpl.mock.calls.map((call) => call[2]?.env?.CODEX_HOME)).toEqual([
        path.join(root, "primary"),
        path.join(root, "secondary"),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not fail over a usage error after an output file was accepted", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "worker-runtime-accounts-"));
    for (const alias of ["primary", "secondary"]) {
      const home = path.join(root, alias);
      await mkdir(home);
      await writeFile(path.join(home, "auth.json"), "{}", "utf8");
    }
    const pool = await createCodexAccountPool({ root, aliases: ["primary", "secondary"] });
    const primary = Object.assign(new EventEmitter(), {
      pid: 1001, kill: vi.fn(), stderr: new PassThrough(),
    });
    const spawnImpl = vi.fn(() => primary);
    try {
      const pending = runShellCommandWithAccountFailover({
        accountPool: pool,
        buildAttempt: async () => ({
          command: "codex",
          value: "primary",
          acceptedOutput: async () => true,
        }),
        timeoutMs: 5_000,
        timeoutErrorCode: "probe_timeout",
        processErrorCode: "probe_failed",
      }, { spawnImpl: spawnImpl as never });
      const assertion = expect(pending).rejects.toThrow("probe_failed:1");

      await vi.waitFor(() => expect(spawnImpl).toHaveBeenCalledTimes(1));
      primary.stderr.write("You've hit your usage limit with SECRET_DETAIL");
      primary.emit("close", 1);

      await assertion;
      expect(spawnImpl).toHaveBeenCalledTimes(1);
      await expect(pending).rejects.not.toThrow("SECRET_DETAIL");
      const error = await pending.catch((caught: unknown) => caught);
      expect(JSON.stringify(error)).not.toContain("SECRET_DETAIL");
      expect(Object.keys(error as object)).not.toContain("diagnostic");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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

  it("preserves HTTP status and a stable API error code without exposing arbitrary detail", async () => {
    const invalidPlan = await contentWorkerApiError(new Response(
      JSON.stringify({ error: "ai_content_plan_invalid" }),
      { status: 400, headers: { "content-type": "application/json" } },
    ));
    const unsafeDetail = await contentWorkerApiError(new Response(
      JSON.stringify({ error: "upstream included SECRET_DETAIL" }),
      { status: 503, headers: { "content-type": "application/json" } },
    ));

    expect(invalidPlan).toBeInstanceOf(ContentWorkerApiError);
    expect(invalidPlan).toMatchObject({
      status: 400,
      errorCode: "ai_content_plan_invalid",
      retryable: false,
    });
    expect(invalidPlan.message).toBe("worker_api_failed:400:ai_content_plan_invalid");
    expect(unsafeDetail).toMatchObject({ status: 503, errorCode: null, retryable: true });
    expect(unsafeDetail.message).not.toContain("SECRET_DETAIL");
  });

  it.each([
    [400, "terminal"],
    [401, "terminal"],
    [403, "terminal"],
    [404, "terminal"],
    [422, "terminal"],
    [409, "conflict"],
    [408, "retryable"],
    [429, "retryable"],
    [500, "retryable"],
    [503, "retryable"],
  ] as const)("classifies HTTP %i as %s before message suffix rules", (status, expected) => {
    const error = new ContentWorkerApiError(status, "ai_content_plan_invalid");

    expect(classifyContentWorkerError(error)).toBe(expected);
    expect(isRetryableContentWorkerError(error)).toBe(expected === "retryable");
  });

  it("replays one immutable completion body with bounded delays and a lease check per attempt", async () => {
    const body = Object.freeze({ workerId: "worker", leaseToken: "lease", planDraft: { title: "fixed" } });
    const errors = [
      new ContentWorkerApiError(503, "ai_content_maintenance"),
      new TypeError("fetch failed"),
      new ContentWorkerApiError(429, "rate_limited"),
    ];
    const complete = vi.fn(async (submitted: typeof body) => {
      const error = errors.shift();
      if (error) throw error;
      expect(submitted).toBe(body);
    });
    const leaseState = vi.fn(async () => "active" as const);
    const waits: number[] = [];

    const result = await replayContentWorkerCompletion({ body, complete, leaseState }, {
      wait: async (delayMs) => { waits.push(delayMs); },
    });

    expect(result).toBe("completed");
    expect(complete).toHaveBeenCalledTimes(4);
    expect(complete.mock.calls.every(([submitted]) => submitted === body)).toBe(true);
    expect(leaseState).toHaveBeenCalledTimes(4);
    expect(waits).toEqual([250, 750, 1_500]);
  });

  it("does not replay terminal or conflict completion responses", async () => {
    const terminalComplete = vi.fn(async () => {
      throw new ContentWorkerApiError(400, "ai_content_plan_invalid");
    });
    const conflictComplete = vi.fn(async () => {
      throw new ContentWorkerApiError(409, "ai_content_job_lease_invalid");
    });
    const active = async () => "active" as const;

    await expect(replayContentWorkerCompletion({
      body: { planDraft: {} }, complete: terminalComplete, leaseState: active,
    }, { wait: vi.fn() })).rejects.toMatchObject({ status: 400 });
    await expect(replayContentWorkerCompletion({
      body: { planDraft: {} }, complete: conflictComplete, leaseState: active,
    }, { wait: vi.fn() })).resolves.toBe("conflict");

    expect(terminalComplete).toHaveBeenCalledOnce();
    expect(conflictComplete).toHaveBeenCalledOnce();
  });

  it("stops completion replay when the lease is no longer active", async () => {
    const body = { planDraft: { title: "fixed" } };
    const complete = vi.fn(async () => {
      throw new ContentWorkerApiError(503, null);
    });
    const leaseState = vi.fn()
      .mockResolvedValueOnce("active")
      .mockResolvedValueOnce("lease_lost");

    await expect(replayContentWorkerCompletion({ body, complete, leaseState }, {
      wait: async () => undefined,
    })).resolves.toBe("lease_lost");

    expect(complete).toHaveBeenCalledOnce();
    expect(leaseState).toHaveBeenCalledTimes(2);
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
