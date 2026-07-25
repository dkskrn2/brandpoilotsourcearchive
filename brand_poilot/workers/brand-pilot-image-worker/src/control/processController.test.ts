import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createProcessController } from "./processController.js";

class FakeChildProcess extends EventEmitter {
  pid = 4321;
  stdout = new PassThrough();
  stderr = new PassThrough();
}

describe("worker process controller", () => {
  it("tracks a one-time run until the worker reports its completed job", () => {
    const child = new FakeChildProcess();
    const launch = vi.fn(() => child);
    const controller = createProcessController({ launch, stopProcess: vi.fn(async () => undefined) });

    controller.runOnce();
    child.stdout.write('{"status":"completed","jobId":"job-123"}\n');
    child.emit("exit", 0);

    expect(launch).toHaveBeenCalledWith("run-once");
    expect(controller.status()).toMatchObject({
      state: "stopped",
      mode: null,
      lastResult: { status: "completed", jobId: "job-123" },
      lastError: null
    });
  });

  it("refuses to start a second worker while watch mode is active", () => {
    const child = new FakeChildProcess();
    const controller = createProcessController({ launch: () => child, stopProcess: vi.fn(async () => undefined) });

    controller.startWatch();

    expect(() => controller.runOnce()).toThrow("worker_already_running");
    expect(controller.status()).toMatchObject({ state: "watching", mode: "watch", pid: 4321 });
  });

  it("stops the managed process without accepting a browser-supplied command", async () => {
    const child = new FakeChildProcess();
    const stopProcess = vi.fn(async () => undefined);
    const controller = createProcessController({ launch: () => child, stopProcess });

    controller.startWatch();
    await controller.stop();

    expect(stopProcess).toHaveBeenCalledWith(child);
    expect(controller.status()).toMatchObject({ state: "stopped", mode: null, pid: null });
  });
});
