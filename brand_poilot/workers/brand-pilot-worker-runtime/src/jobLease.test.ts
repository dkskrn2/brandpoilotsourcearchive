import { afterEach, describe, expect, it, vi } from "vitest";
import { startJobLeaseGuard } from "./jobLease.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

afterEach(() => vi.useRealTimers());

describe("job lease guard", () => {
  it("does not overlap heartbeat pulses", async () => {
    vi.useFakeTimers();
    const first = deferred();
    const heartbeat = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const guard = startJobLeaseGuard({ heartbeat, intervalMs: 100 });

    await vi.advanceTimersByTimeAsync(300);
    expect(heartbeat).toHaveBeenCalledOnce();
    first.resolve();
    await first.promise;
    await vi.advanceTimersByTimeAsync(100);
    expect(heartbeat).toHaveBeenCalledTimes(2);
    await guard.finish();
  });

  it("aborts and reports lease_lost after heartbeat rejection", async () => {
    vi.useFakeTimers();
    const guard = startJobLeaseGuard({ heartbeat: vi.fn(async () => { throw new Error("409"); }), intervalMs: 100 });

    await vi.advanceTimersByTimeAsync(100);

    expect(guard.signal.aborted).toBe(true);
    expect((guard.signal.reason as Error).message).toBe("ai_content_job_lease_lost");
    await expect(guard.state()).resolves.toBe("lease_lost");
  });

  it("waits for an in-flight heartbeat before finish resolves", async () => {
    vi.useFakeTimers();
    const running = deferred();
    const guard = startJobLeaseGuard({ heartbeat: vi.fn(() => running.promise), intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    let finished = false;
    const finishing = guard.finish().then((state) => { finished = true; return state; });
    await Promise.resolve();
    expect(finished).toBe(false);
    running.resolve();
    await expect(finishing).resolves.toBe("active");
  });

  it("reports cancelled for both pre-aborted and late shutdown signals", async () => {
    const preAborted = new AbortController();
    preAborted.abort();
    const first = startJobLeaseGuard({ heartbeat: vi.fn(), shutdownSignal: preAborted.signal });
    expect(first.signal.aborted).toBe(true);
    await expect(first.finish()).resolves.toBe("cancelled");

    const late = new AbortController();
    const second = startJobLeaseGuard({ heartbeat: vi.fn(), shutdownSignal: late.signal });
    late.abort();
    expect(second.signal.aborted).toBe(true);
    await expect(second.finish()).resolves.toBe("cancelled");
  });

  it("finishes idempotently and permanently stops its timer", async () => {
    vi.useFakeTimers();
    const heartbeat = vi.fn(async () => undefined);
    const guard = startJobLeaseGuard({ heartbeat, intervalMs: 100 });

    await expect(guard.finish()).resolves.toBe("active");
    await expect(guard.finish()).resolves.toBe("active");
    await vi.advanceTimersByTimeAsync(500);

    expect(heartbeat).not.toHaveBeenCalled();
  });
});
