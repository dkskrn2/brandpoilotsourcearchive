import { afterEach, describe, expect, it, vi } from "vitest";
import { startWorkerInstanceHeartbeat } from "./instanceHeartbeat.js";

describe("startWorkerInstanceHeartbeat", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps an idle proposal worker fresh until shutdown", async () => {
    vi.useFakeTimers();
    const heartbeat = vi.fn(async () => undefined);
    const stop = startWorkerInstanceHeartbeat({
      heartbeat,
      workerId: "content-proposal-worker-1",
      intervalMs: 5_000,
    });

    await vi.advanceTimersByTimeAsync(15_000);
    expect(heartbeat).toHaveBeenCalledTimes(4);
    expect(heartbeat).toHaveBeenCalledWith("content-proposal-worker-1");
    stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(heartbeat).toHaveBeenCalledTimes(4);
  });

  it("contains transient heartbeat failures", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const stop = startWorkerInstanceHeartbeat({
      heartbeat: vi.fn()
        .mockRejectedValueOnce(new Error("temporary"))
        .mockResolvedValue(undefined),
      workerId: "content-proposal-worker-1",
      intervalMs: 1_000,
      onError,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "temporary" }));
    stop();
  });
});
