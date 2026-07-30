import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildAiContentRevisionInstruction,
  isRetryableContentWorkerError,
  preflightAttachmentSnapshots,
  runShellCommandWithTimeout,
  terminateProcessTree,
} from "./index.js";

describe("worker runtime", () => {
  it("builds a targeted card revision instruction that freezes all unrelated cards", () => {
    const instruction = buildAiContentRevisionInstruction({
      contractVersion: "ai-content-revision.v1",
      action: "regenerate_card",
      idempotencyKey: "revision-card-2",
      cardIndex: 2,
      previousManifest: {
        type: "card_news",
        assets: [{ index: 1, url: "https://cdn/1.png" }, { index: 2, url: "https://cdn/2.png" }],
      },
      previousContent: { caption: "기존 카피" },
    }, "card_news");

    expect(instruction).toContain("2번 카드만");
    expect(instruction).toContain("나머지 카드");
    expect(instruction).toContain('"idempotencyKey": "revision-card-2"');
  });

  it("rejects card revisions in non-card workers", () => {
    expect(() => buildAiContentRevisionInstruction({
      contractVersion: "ai-content-revision.v1",
      action: "regenerate_card",
      idempotencyKey: "revision-card-1",
      cardIndex: 1,
      previousManifest: { type: "card_news", assets: [{ index: 1 }] },
      previousContent: {},
    }, "blog")).toThrow("ai_content_revision_worker_mismatch");
  });

  it("terminates a Windows process tree with taskkill", async () => {
    const execFileImpl = vi.fn((...args: unknown[]) => {
      (args[3] as (error: null, stdout: string, stderr: string) => void)(null, "", "");
      return {} as never;
    });

    await terminateProcessTree({ pid: 123, kill: vi.fn() }, { platform: "win32", execFileImpl: execFileImpl as never });

    expect(execFileImpl).toHaveBeenCalledWith("taskkill", ["/PID", "123", "/T", "/F"], { windowsHide: true }, expect.any(Function));
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
    }, {
      spawnImpl: spawnImpl as never,
    })).rejects.toBe(reason);

    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it("awaits process-tree termination on abort and settles only once", async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 123,
      kill: vi.fn(),
    });
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
    }, {
      spawnImpl: spawnImpl as never,
      terminateProcessTreeImpl,
    }).then(
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
    const child = Object.assign(new EventEmitter(), {
      pid: 456,
      kill: vi.fn(),
    });
    const spawnImpl = vi.fn(() => child);
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, "removeEventListener");

    const pending = runShellCommandWithTimeout({
      command: "codex",
      signal: controller.signal,
      timeoutMs: 5_000,
      timeoutErrorCode: "probe_timeout",
      processErrorCode: "probe_failed",
    }, {
      spawnImpl: spawnImpl as never,
      terminateProcessTreeImpl: vi.fn(),
    });
    child.emit("close", 0);

    await expect(pending).resolves.toBeUndefined();
    expect(removeEventListener).toHaveBeenCalledTimes(1);
  });

  it("classifies contract errors as terminal and process failures as retryable", () => {
    expect(isRetryableContentWorkerError(new Error("card_news_content_invalid"))).toBe(false);
    expect(isRetryableContentWorkerError(new Error("card_news_output_id_required"))).toBe(false);
    expect(isRetryableContentWorkerError(new Error("codex_card_news_failed:1"))).toBe(true);
  });

  it("requires every structural attachment snapshot field before provider I/O", async () => {
    const head = vi.fn();
    await expect(preflightAttachmentSnapshots([{
      id: "attachment-1",
      generationId: "generation-1",
      role: "document",
      fileName: "brief.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
      checksum: "a".repeat(64),
      storageUrl: "https://blob.example/brief.pdf",
      createdAt: "2026-07-27T00:00:00.000Z",
    }], { head })).rejects.toThrow("ai_content_attachment_blob_unavailable");
    expect(head).not.toHaveBeenCalled();
  });

  it("lets terminal not-found outrank a faster transient failure", async () => {
    const snapshots = [1, 2].map((index) => ({
      id: `attachment-${index}`,
      generationId: "generation-1",
      role: "document",
      fileName: `${index}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 42,
      checksum: "a".repeat(64),
      storageUrl: `https://blob.example/${index}.pdf`,
      storagePath: `generation/${index}.pdf`,
      createdAt: `2026-07-27T00:00:0${index}.000Z`,
    }));
    const head = vi.fn(async (path: string) => {
      if (path.endsWith("1.pdf")) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw Object.assign(new Error("not found"), { status: 404 });
      }
      throw Object.assign(new Error("upstream unavailable"), { status: 503 });
    });
    await expect(preflightAttachmentSnapshots(snapshots, { head }))
      .rejects.toThrow("ai_content_attachment_blob_unavailable");
    expect(head).toHaveBeenCalledTimes(2);
  });

  it("classifies storage availability codes explicitly", () => {
    expect(isRetryableContentWorkerError(new Error("ai_content_attachment_blob_unavailable"))).toBe(false);
    expect(isRetryableContentWorkerError(new Error("ai_content_attachment_storage_unavailable"))).toBe(true);
  });

  it("enforces the default 15 second deadline with one AbortSignal and absorbs late provider rejection", async () => {
    vi.useFakeTimers();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const signals: AbortSignal[] = [];
      const snapshots = [1, 2].map((index) => ({
        id: `attachment-${index}`,
        generationId: "generation-1",
        role: "document",
        fileName: `${index}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 42,
        checksum: "a".repeat(64),
        storageUrl: `https://blob.example/${index}.pdf`,
        storagePath: `generation/${index}.pdf`,
        createdAt: `2026-07-27T00:00:0${index}.000Z`,
      }));
      const promise = preflightAttachmentSnapshots(snapshots, {
        head: async (_path, { abortSignal }) => {
          signals.push(abortSignal);
          return new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error("late provider failure")), 16_000);
          });
        },
      });
      const rejection = expect(promise).rejects.toThrow("ai_content_attachment_storage_unavailable");

      await vi.advanceTimersByTimeAsync(14_999);
      expect(signals).toHaveLength(2);
      expect(signals[0]?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await rejection;
      expect(signals[0]).toBe(signals[1]);
      expect(signals[0]?.aborted).toBe(true);

      await vi.advanceTimersByTimeAsync(1_000);
      await Promise.resolve();
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      vi.useRealTimers();
    }
  });

  it("clears the deadline timer and aborts the shared signal after successful preflight", async () => {
    vi.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      const snapshots = [1, 2].map((index) => ({
        id: `attachment-${index}`,
        generationId: "generation-1",
        role: "document",
        fileName: `${index}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 42,
        checksum: "a".repeat(64),
        storageUrl: `https://blob.example/${index}.pdf`,
        storagePath: `generation/${index}.pdf`,
        createdAt: `2026-07-27T00:00:0${index}.000Z`,
      }));

      await expect(preflightAttachmentSnapshots(snapshots, {
        head: async (_path, { abortSignal }) => {
          signals.push(abortSignal);
          return { size: 42, contentType: "application/pdf" };
        },
      })).resolves.toHaveLength(2);

      expect(signals[0]).toBe(signals[1]);
      expect(signals[0]?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets an earlier terminal 404 outrank the deadline when another provider request ignores abort", async () => {
    vi.useFakeTimers();
    try {
      const snapshots = [1, 2].map((index) => ({
        id: `attachment-${index}`,
        generationId: "generation-1",
        role: "document",
        fileName: `${index}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 42,
        checksum: "a".repeat(64),
        storageUrl: `https://blob.example/${index}.pdf`,
        storagePath: `generation/${index}.pdf`,
        createdAt: `2026-07-27T00:00:0${index}.000Z`,
      }));
      const pending = preflightAttachmentSnapshots(snapshots, {
        head: async (path) => {
          if (path.endsWith("1.pdf")) {
            throw Object.assign(new Error("not found"), { status: 404 });
          }
          return new Promise(() => {});
        },
      });
      const rejection = expect(pending).rejects.toThrow("ai_content_attachment_blob_unavailable");

      await vi.advanceTimersByTimeAsync(15_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});
