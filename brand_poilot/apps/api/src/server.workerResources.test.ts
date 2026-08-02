import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer.js";

describe("worker resource lease API", () => {
  const apps: Array<ReturnType<typeof createServer>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("authenticates and acquires a Codex lease for a DM worker", async () => {
    const repository = {
      acquireWorkerResourceLease: vi.fn(async () => ({ id: "lease-1", leaseToken: "token-1", expiresAt: "2026-07-16T00:01:00.000Z" })),
    } as any;
    const app = createServer({ repository, workerApiToken: "worker-secret" });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/worker/resources/codex-cli/acquire",
      headers: { authorization: "Bearer worker-secret" },
      payload: { workerId: "dm-1", workload: "dm" },
    });

    expect(response.statusCode).toBe(200);
    expect(repository.acquireWorkerResourceLease).toHaveBeenCalledWith("codex_cli", "dm-1", "dm");
  });

  it("returns no content when the reserved slot policy denies a lease", async () => {
    const repository = { acquireWorkerResourceLease: vi.fn(async () => null) } as any;
    const app = createServer({ repository, workerApiToken: "worker-secret" });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/worker/resources/codex-cli/acquire",
      headers: { authorization: "Bearer worker-secret" },
      payload: { workerId: "wiki-1", workload: "wiki" },
    });

    expect(response.statusCode).toBe(204);
  });

  it("accepts the onboarding worker as the single non-DM Codex workload", async () => {
    const repository = {
      acquireWorkerResourceLease: vi.fn(async () => ({ id: "lease-onboarding", leaseToken: "token-onboarding" })),
    } as any;
    const app = createServer({ repository, workerApiToken: "worker-secret" });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/worker/resources/codex-cli/acquire",
      headers: { authorization: "Bearer worker-secret" },
      payload: { workerId: "onboarding-1", workload: "onboarding" },
    });

    expect(response.statusCode).toBe(200);
    expect(repository.acquireWorkerResourceLease).toHaveBeenCalledWith(
      "codex_cli",
      "onboarding-1",
      "onboarding",
    );
  });

  it("accepts FAQ as a non-DM Codex workload", async () => {
    const repository = {
      acquireWorkerResourceLease: vi.fn(async () => ({ id: "lease-faq", leaseToken: "token-faq" })),
    } as any;
    const app = createServer({ repository, workerApiToken: "worker-secret" });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/worker/resources/codex-cli/acquire",
      headers: { authorization: "Bearer worker-secret" },
      payload: { workerId: "faq-worker-1", workload: "faq" },
    });

    expect(response.statusCode).toBe(200);
    expect(repository.acquireWorkerResourceLease).toHaveBeenCalledWith(
      "codex_cli",
      "faq-worker-1",
      "faq",
    );
  });

  it("reports a lost resource lease as a non-retryable conflict", async () => {
    const repository = {
      heartbeatWorkerResourceLease: vi.fn(async () => {
        throw new Error("worker_resource_lease_invalid");
      }),
    } as any;
    const app = createServer({ repository, workerApiToken: "worker-secret" });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/worker/resources/codex-cli/00000000-0000-4000-8000-000000000001/heartbeat",
      headers: { authorization: "Bearer worker-secret" },
      payload: {
        workerId: "onboarding-1",
        leaseToken: "00000000-0000-4000-8000-000000000002",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "worker_resource_lease_invalid" });
  });
});
