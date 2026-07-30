import { describe, expect, it, vi } from "vitest";
import { isRetryableContentWorkerError, terminateProcessTree } from "./index.js";

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
});
