import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer";

describe("Threads text worker API", () => {
  const apps: Array<ReturnType<typeof createServer>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("leases a text job only to an authenticated worker", async () => {
    const repository = {
      claimTextRenderJob: vi.fn(async (workerId: string) => ({ id: "job-1", leaseToken: "lease-1", workerId }))
    } as any;
    const app = createServer({ repository, workerApiToken: "worker-secret" });
    apps.push(app);

    const unauthorized = await app.inject({
      method: "POST",
      url: "/worker/text-jobs/claim",
      payload: { workerId: "worker-1" }
    });
    expect(unauthorized.statusCode).toBe(401);

    const response = await app.inject({
      method: "POST",
      url: "/worker/text-jobs/claim",
      headers: { authorization: "Bearer worker-secret" },
      payload: { workerId: "worker-1" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: "job-1", workerId: "worker-1" });
    expect(repository.claimTextRenderJob).toHaveBeenCalledWith("worker-1");
  });

  it("forwards a structured result when completing a text job", async () => {
    const repository = {
      completeTextRenderJob: vi.fn(async () => ({ id: "job-1", status: "succeeded" }))
    } as any;
    const app = createServer({ repository, workerApiToken: "worker-secret" });
    apps.push(app);
    const result = {
      deliveryFormat: "threads_text",
      promptVersion: "worker-threads.v1",
      title: "제목",
      text: "본문",
      sourceMode: "direct_url",
      fetchStatus: "fetched",
      model: "codex-cli"
    };

    const response = await app.inject({
      method: "POST",
      url: "/worker/text-jobs/job-1/complete",
      headers: { authorization: "Bearer worker-secret" },
      payload: { workerId: "worker-1", leaseToken: "lease-1", result }
    });

    expect(response.statusCode).toBe(200);
    expect(repository.completeTextRenderJob).toHaveBeenCalledWith("job-1", {
      workerId: "worker-1",
      leaseToken: "lease-1",
      result
    });
  });
});
