import { describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer.js";
import type { ApiRepository } from "./types.js";

function setup() {
  const repository = {
    claimAiContentRenderJob: vi.fn(async () => ({ id: "render-1", jobKind: "image_asset", leaseToken: "lease-1" })),
    heartbeatAiContentRenderJob: vi.fn(async () => true),
    completeAiContentRenderAsset: vi.fn(async () => undefined),
    completeAiContentRenderPackage: vi.fn(async () => ({ id: "generation-1", status: "completed" })),
    failAiContentRenderJob: vi.fn(async () => undefined),
    saveAiContentOutputResearch: vi.fn(async () => undefined),
  } as unknown as ApiRepository;
  return { repository, app: createServer({ repository, workerApiToken: "worker-token", logger: false }) };
}

describe("AI content render worker routes", () => {
  it("authenticates a claim before returning the maintenance fence", async () => {
    const assertAiContentWritable = vi.fn(async () => { throw new Error("ai_content_maintenance"); });
    const claimAiContentRenderJob = vi.fn(async () => null);
    const repository = { assertAiContentWritable, claimAiContentRenderJob } as unknown as ApiRepository;
    const app = createServer({ repository, workerApiToken: "worker-token", logger: false });
    const payload = { workerId: "image-worker-1", leaseSeconds: 180 };

    const unauthorized = await app.inject({
      method: "POST", url: "/worker/ai-content-render-jobs/claim", payload,
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json()).toEqual({ error: "worker_api_unauthorized" });
    expect(assertAiContentWritable).not.toHaveBeenCalled();

    const fenced = await app.inject({
      method: "POST", url: "/worker/ai-content-render-jobs/claim",
      headers: { authorization: "Bearer worker-token" }, payload,
    });
    expect(fenced.statusCode).toBe(503);
    expect(fenced.json()).toEqual({ error: "ai_content_maintenance" });
    expect(assertAiContentWritable).toHaveBeenCalledTimes(1);
    expect(claimAiContentRenderJob).not.toHaveBeenCalled();
    await app.close();
  });

  it("fails deterministically when the optional render repository is not configured", async () => {
    const repository = {} as unknown as ApiRepository;
    const app = createServer({ repository, workerApiToken: "worker-token", logger: false });
    const headers = { authorization: "Bearer worker-token" };
    const requests = [
      { url: "/worker/ai-content-render-jobs/claim", payload: { workerId: "worker-1", leaseSeconds: 180 } },
      { url: "/worker/ai-content-render-jobs/render-1/heartbeat", payload: { workerId: "worker-1", leaseToken: "lease-1", leaseSeconds: 180 } },
      { url: "/worker/ai-content-render-jobs/render-1/complete", payload: { workerId: "worker-1", leaseToken: "lease-1", jobKind: "image_asset", asset: {} } },
      { url: "/worker/ai-content-render-jobs/render-1/fail", payload: { workerId: "worker-1", leaseToken: "lease-1", errorCode: "failed", errorMessage: "failed", retryable: false } },
      { url: "/worker/ai-content-jobs/job-1/research-complete", payload: { workerId: "worker-1", leaseToken: "lease-1", outputId: "output-1", evidence: {} } },
    ];
    for (const request of requests) {
      const response = await app.inject({ method: "POST", headers, ...request });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "ai_content_render_repository_not_configured" });
    }
    await app.close();
  });

  it("authenticates and forwards claim and heartbeat lease fields", async () => {
    const { app, repository } = setup();
    const unauthorized = await app.inject({ method: "POST", url: "/worker/ai-content-render-jobs/claim", payload: { workerId: "worker-1", leaseSeconds: 180 } });
    expect(unauthorized.statusCode).toBe(401);
    const headers = { authorization: "Bearer worker-token" };
    const claim = await app.inject({ method: "POST", url: "/worker/ai-content-render-jobs/claim", headers, payload: { workerId: "worker-1", leaseSeconds: 180 } });
    expect(claim.statusCode).toBe(200);
    expect(repository.claimAiContentRenderJob).toHaveBeenCalledWith({ workerId: "worker-1", leaseSeconds: 180 });
    const heartbeat = await app.inject({ method: "POST", url: "/worker/ai-content-render-jobs/render-1/heartbeat", headers, payload: { workerId: "worker-1", leaseToken: "lease-1", leaseSeconds: 180 } });
    expect(heartbeat.statusCode).toBe(200);
    expect(repository.heartbeatAiContentRenderJob).toHaveBeenCalledWith(expect.objectContaining({ jobId: "render-1", leaseToken: "lease-1" }));
    await app.close();
  });

  it("dispatches image and finalizer completions by the literal job kind", async () => {
    const { app, repository } = setup();
    const headers = { authorization: "Bearer worker-token" };
    const identity = { workerId: "worker-1", leaseToken: "lease-1" };
    const asset = { index: 1, url: "https://blob.example/1.png", storagePath: "ai-content/b/g/o/assets/01.png", mimeType: "image/png", width: 1080, height: 1080, checksum: "a".repeat(64) };
    const image = await app.inject({ method: "POST", url: "/worker/ai-content-render-jobs/render-1/complete", headers, payload: { ...identity, jobKind: "image_asset", asset } });
    expect(image.statusCode).toBe(200);
    expect(repository.completeAiContentRenderAsset).toHaveBeenCalledWith({ jobId: "render-1", ...identity, jobKind: "image_asset", asset });
    const finalizer = await app.inject({ method: "POST", url: "/worker/ai-content-render-jobs/render-2/complete", headers, payload: { ...identity, jobKind: "package_finalize", manifest: { version: "ai-content.v2" }, manifestUrl: "https://blob.example/manifest.json" } });
    expect(finalizer.statusCode).toBe(200);
    expect(repository.completeAiContentRenderPackage).toHaveBeenCalledWith(expect.objectContaining({ jobId: "render-2", jobKind: "package_finalize" }));
    await app.close();
  });

  it("forwards render failure and immutable blog supplemental research", async () => {
    const { app, repository } = setup();
    const headers = { authorization: "Bearer worker-token" };
    const failure = await app.inject({ method: "POST", url: "/worker/ai-content-render-jobs/render-1/fail", headers, payload: { workerId: "worker-1", leaseToken: "lease-1", errorCode: "render_failed", errorMessage: "failed", diagnosticCode: "ai_content_asset_final_message_invalid", retryable: true } });
    expect(failure.statusCode).toBe(200);
    expect(repository.failAiContentRenderJob).toHaveBeenCalledWith(expect.objectContaining({ diagnosticCode: "ai_content_asset_final_message_invalid", retryable: true }));
    const research = await app.inject({ method: "POST", url: "/worker/ai-content-jobs/job-1/research-complete", headers, payload: { workerId: "blog-worker", leaseToken: "lease-2", outputId: "output-1", evidence: { contractVersion: "research-evidence.v1", items: [] } } });
    expect(research.statusCode).toBe(200);
    expect(repository.saveAiContentOutputResearch).toHaveBeenCalledWith(expect.objectContaining({ jobId: "job-1", outputId: "output-1" }));
    await app.close();
  });
});
