import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShutdown, logShutdownFailure } from "./shutdown";

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createShutdown", () => {
  it("closes the app and pool only once for concurrent signals", async () => {
    const info = vi.mocked(console.info);
    const app = { close: vi.fn(async () => undefined) };
    const pool = { end: vi.fn(async () => undefined) };
    const shutdown = createShutdown(app, pool);

    await Promise.all([shutdown("SIGTERM"), shutdown("SIGTERM")]);

    expect(app.close).toHaveBeenCalledTimes(1);
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(info.mock.calls).toEqual([
      ["api_shutdown_started", { signal: "SIGTERM" }],
      ["api_shutdown_completed", { signal: "SIGTERM" }],
    ]);
  });

  it("closes the pool and preserves the app error when app shutdown fails", async () => {
    const appError = new Error("app_close_failed");
    const app = { close: vi.fn(async () => { throw appError; }) };
    const pool = { end: vi.fn(async () => undefined) };
    const shutdown = createShutdown(app, pool);

    const first = shutdown("SIGINT");
    const second = shutdown("SIGTERM");

    await expect(first).rejects.toBe(appError);
    await expect(second).rejects.toBe(appError);
    expect(app.close).toHaveBeenCalledTimes(1);
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it("aggregates app and pool errors when both shutdown operations fail", async () => {
    const appError = new Error("app_close_failed");
    const poolError = new Error("pool_end_failed");
    const app = { close: vi.fn(async () => { throw appError; }) };
    const pool = { end: vi.fn(async () => { throw poolError; }) };
    const shutdown = createShutdown(app, pool);

    await expect(shutdown("SIGTERM")).rejects.toEqual(
      expect.objectContaining({
        errors: [appError, poolError],
      }),
    );
    expect(app.close).toHaveBeenCalledTimes(1);
    expect(pool.end).toHaveBeenCalledTimes(1);
  });
});

describe("logShutdownFailure", () => {
  it("logs only a fixed event, code, and signal for malicious shutdown errors", async () => {
    const logger = { error: vi.fn() };
    const maliciousError = new Error(
      "pool_failed postgresql://admin:secret-password@db.internal/brandpilot\nstack-secret",
    );

    await Promise.reject(maliciousError).catch(() => {
      logShutdownFailure(logger, "SIGTERM");
    });

    expect(logger.error).toHaveBeenCalledWith(
      {
        event: "api_shutdown_failed",
        errorCode: "shutdown_failed",
        signal: "SIGTERM",
      },
      "api_shutdown_failed",
    );
    const serializedArguments = JSON.stringify(logger.error.mock.calls);
    expect(serializedArguments).not.toContain("postgresql://");
    expect(serializedArguments).not.toContain("secret-password");
    expect(serializedArguments).not.toContain("stack-secret");
  });
});
