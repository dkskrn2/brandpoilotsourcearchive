import { afterEach, describe, expect, it, vi } from "vitest";
import { startWorkerInstanceHeartbeat } from "./instanceHeartbeat.js";

describe("startWorkerInstanceHeartbeat", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps an idle Wiki worker fresh until stopped", async () => {
    vi.useFakeTimers();
    const heartbeat = vi.fn(async () => ({}));

    const stop = startWorkerInstanceHeartbeat({
      heartbeat,
      workerId: "wiki-worker-1",
      intervalMs: 5_000,
    });
    await vi.advanceTimersByTimeAsync(15_000);

    expect(heartbeat).toHaveBeenCalledTimes(4);
    expect(heartbeat).toHaveBeenNthCalledWith(1, "wiki-worker-1");
    stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(heartbeat).toHaveBeenCalledTimes(4);
  });

  it("contains heartbeat failures so the worker lane stays alive", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const heartbeat = vi.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValue({});

    const stop = startWorkerInstanceHeartbeat({
      heartbeat,
      workerId: "dm-worker-1",
      intervalMs: 1_000,
      onError,
    });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(heartbeat).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "temporary" }));
    stop();
  });
});
