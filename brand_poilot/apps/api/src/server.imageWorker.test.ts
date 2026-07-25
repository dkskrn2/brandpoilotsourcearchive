import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer";

describe("image worker API", () => {
  const apps: Array<ReturnType<typeof createServer>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("requires a worker token before claiming a job", async () => {
    const repository = {
      claimImageRenderJob: vi.fn(async () => null)
    } as any;
    const app = createServer({ repository, workerApiToken: "worker-secret" });
    apps.push(app);

    const response = await app.inject({ method: "POST", url: "/worker/image-jobs/claim", payload: { workerId: "worker-1" } });

    expect(response.statusCode).toBe(401);
    expect(repository.claimImageRenderJob).not.toHaveBeenCalled();
  });

  it("leases a render job only to an authenticated worker", async () => {
    const repository = {
      claimImageRenderJob: vi.fn(async (workerId: string) => ({ id: "job-1", leaseToken: "lease-1", workerId }))
    } as any;
    const app = createServer({ repository, workerApiToken: "worker-secret" });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/worker/image-jobs/claim",
      headers: { authorization: "Bearer worker-secret" },
      payload: { workerId: "worker-1" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: "job-1", workerId: "worker-1" });
    expect(repository.claimImageRenderJob).toHaveBeenCalledWith("worker-1");
  });
});
