import { describe, expect, it, vi } from "vitest";
import {
  isRetryableContentWorkerError,
  preflightAttachmentSnapshots,
  terminateProcessTree,
} from "./index.js";

describe("worker runtime", () => {
  it("terminates a Windows process tree with taskkill", async () => {
    const execFileImpl = vi.fn((...args: unknown[]) => {
      (args[3] as (error: null, stdout: string, stderr: string) => void)(null, "", "");
      return {} as never;
    });

    await terminateProcessTree({ pid: 123, kill: vi.fn() }, { platform: "win32", execFileImpl: execFileImpl as never });

    expect(execFileImpl).toHaveBeenCalledWith("taskkill", ["/PID", "123", "/T", "/F"], { windowsHide: true }, expect.any(Function));
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
});
