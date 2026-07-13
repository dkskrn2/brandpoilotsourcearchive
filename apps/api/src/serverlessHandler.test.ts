import { describe, expect, it, vi } from "vitest";
import { createServerlessHandler } from "./serverlessHandler";

describe("serverless handler", () => {
  it("waits for Fastify readiness before dispatching the Vercel request", async () => {
    const ready = vi.fn(async () => undefined);
    const emit = vi.fn();
    const app = { ready, server: { emit } };
    const request = {};
    const response = {};

    const handler = createServerlessHandler(app);
    await handler(request as never, response as never);

    expect(ready).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith("request", request, response);
  });
});
