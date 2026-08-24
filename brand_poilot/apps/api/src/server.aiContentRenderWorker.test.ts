import { describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer.js";
import type { ApiRepository } from "./types.js";

function setup() {
  const repository = {
    claimAiContentRenderJob: vi.fn(async () => ({ id: "render-1", jobKind: "image_asset", leaseToken: "lease-1" })),
    heartbeatAiContentVisualSession: vi.fn(async () => true),
    completeAiContentVisualSession: vi.fn(async () => undefined),
    failAiContentVisualSession: vi.fn(async () => undefined),
    heartbeatAiContentRenderJob: vi.fn(async () => true),
    completeAiContentRenderAsset: vi.fn(async () => undefined),
    appendAiContentEditorialRenderDiagnostic: vi.fn(async () => undefined),
    completeAiContentRenderPackage: vi.fn(async () => ({ id: "generation-1", status: "completed" })),
    failAiContentRenderJob: vi.fn(async () => undefined),
    saveAiContentOutputResearch: vi.fn(async () => undefined),
  } as unknown as ApiRepository;
  return { repository, app: createServer({ repository, workerApiToken: "worker-token", logger: false }) };
}

describe("AI content render worker routes", () => {
  it("authenticates and forwards product image import worker leases", async () => {
    const repository = {
      claimProductImageImportJob: vi.fn(async () => ({
        id: "import-1", workspaceId: "workspace-1", brandId: "brand-1",
        productServiceId: "product-1", versionId: "version-1", requestedByUserId: "user-1",
        sourceUrls: ["https://shop.example/item"], attemptCount: 1, remainingSlots: 5, leaseToken: "lease-1",
      })),
      heartbeatProductImageImportJob: vi.fn(async () => true),
      completeProductImageImportJob: vi.fn(async () => ({
        completed: true,
        retainedStoragePaths: ["brands/brand-1/asset-library/products/product-1/imports/import-1/image.jpg"],
      })),
      failProductImageImportJob: vi.fn(async () => "retry" as const),
    } as unknown as ApiRepository;
    const app = createServer({ repository, workerApiToken: "worker-token", logger: false });
    const headers = { authorization: "Bearer worker-token" };

    const unauthorized = await app.inject({
      method: "POST", url: "/worker/product-image-import-jobs/claim",
      payload: { workerId: "image-worker-1", leaseSeconds: 180 },
    });
    expect(unauthorized.statusCode).toBe(401);

    const claimed = await app.inject({
      method: "POST", url: "/worker/product-image-import-jobs/claim", headers,
      payload: { workerId: "image-worker-1", leaseSeconds: 180 },
    });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json().job.id).toBe("import-1");
    expect(repository.claimProductImageImportJob).toHaveBeenCalledWith({ workerId: "image-worker-1", leaseSeconds: 180 });

    const heartbeat = await app.inject({
      method: "POST", url: "/worker/product-image-import-jobs/import-1/heartbeat", headers,
      payload: { workerId: "image-worker-1", leaseToken: "lease-1", leaseSeconds: 180 },
    });
    expect(heartbeat.statusCode).toBe(200);
    expect(repository.heartbeatProductImageImportJob).toHaveBeenCalledWith({
      jobId: "import-1", workerId: "image-worker-1", leaseToken: "lease-1", leaseSeconds: 180,
    });

    const images = [{
      storageUrl: "https://blob.example/image.jpg",
      storagePath: "brands/brand-1/asset-library/products/product-1/imports/import-1/image.jpg",
      mimeType: "image/jpeg", sizeBytes: 2048, checksum: "a".repeat(64),
      sourceUrl: "https://shop.example/image.jpg",
    }];
    const completion = await app.inject({
      method: "POST", url: "/worker/product-image-import-jobs/import-1/complete", headers,
      payload: { workerId: "image-worker-1", leaseToken: "lease-1", selectionAudit: { selected: 1 }, images },
    });
    expect(completion.statusCode).toBe(200);
    expect(completion.json()).toEqual({
      id: "import-1",
      status: "succeeded",
      retainedStoragePaths: [images[0]!.storagePath],
    });
    expect(repository.completeProductImageImportJob).toHaveBeenCalledWith({
      jobId: "import-1", workerId: "image-worker-1", leaseToken: "lease-1", selectionAudit: { selected: 1 }, images,
    });

    const failure = await app.inject({
      method: "POST", url: "/worker/product-image-import-jobs/import-1/fail", headers,
      payload: { workerId: "image-worker-1", leaseToken: "lease-1", errorCode: "fetch_failed" },
    });
    expect(failure.statusCode).toBe(200);
    expect(failure.json()).toEqual({ id: "import-1", status: "retry" });
    await app.close();
  });

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
      { url: "/worker/ai-content-render-jobs/visual-session/heartbeat", payload: { outputId: "output-1", workerId: "worker-1", leaseSeconds: 180, jobs: [] } },
      { url: "/worker/ai-content-render-jobs/visual-session/complete", payload: { outputId: "output-1", workerId: "worker-1", jobs: [], assets: [], diagnostics: [], bodySha256: "a".repeat(64) } },
      { url: "/worker/ai-content-render-jobs/visual-session/fail", payload: { outputId: "output-1", workerId: "worker-1", jobs: [], errorCode: "failed", errorMessage: "failed" } },
      { url: "/worker/ai-content-render-jobs/render-1/heartbeat", payload: { workerId: "worker-1", leaseToken: "lease-1", leaseSeconds: 180 } },
      { url: "/worker/ai-content-render-jobs/render-1/complete", payload: { workerId: "worker-1", leaseToken: "lease-1", jobKind: "image_asset", asset: {} } },
      { url: "/worker/ai-content-render-jobs/render-1/diagnostic", payload: { workerId: "worker-1", leaseToken: "lease-1", diagnostic: {} } },
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

  it("forwards the exact shared visual-session capability and group lease operations", async () => {
    const { app, repository } = setup();
    const headers = { authorization: "Bearer worker-token" };
    const jobs = [{ jobId: "render-1", assetIndex: 1, leaseToken: "lease-1" }];
    const claim = await app.inject({
      method: "POST", url: "/worker/ai-content-render-jobs/claim", headers,
      payload: { workerId: "worker-1", leaseSeconds: 180, capabilities: ["ai-content-visual-session.v1"] },
    });
    expect(claim.statusCode).toBe(200);
    expect(repository.claimAiContentRenderJob).toHaveBeenLastCalledWith({
      workerId: "worker-1", leaseSeconds: 180, capabilities: ["ai-content-visual-session.v1"],
    });

    const heartbeat = await app.inject({
      method: "POST", url: "/worker/ai-content-render-jobs/visual-session/heartbeat", headers,
      payload: { outputId: "output-1", workerId: "worker-1", leaseSeconds: 180, jobs },
    });
    expect(heartbeat.statusCode).toBe(200);
    expect(repository.heartbeatAiContentVisualSession).toHaveBeenCalledWith({
      outputId: "output-1", workerId: "worker-1", leaseSeconds: 180, jobs,
    });

    const completion = {
      outputId: "output-1", workerId: "worker-1", jobs,
      assets: [{ index: 1 }], diagnostics: [{ sceneIndex: 1 }], bodySha256: "a".repeat(64),
    };
    expect((await app.inject({ method: "POST", url: "/worker/ai-content-render-jobs/visual-session/complete", headers, payload: completion })).statusCode).toBe(200);
    expect(repository.completeAiContentVisualSession).toHaveBeenCalledWith(completion);

    const failure = { outputId: "output-1", workerId: "worker-1", jobs, errorCode: "render_failed", errorMessage: "scene failed" };
    expect((await app.inject({ method: "POST", url: "/worker/ai-content-render-jobs/visual-session/fail", headers, payload: failure })).statusCode).toBe(200);
    expect(repository.failAiContentVisualSession).toHaveBeenCalledWith(failure);
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

  it("appends an exact private editorial diagnostic after asset completion", async () => {
    const { app, repository } = setup();
    const headers = { authorization: "Bearer worker-token" };
    const diagnostic = {
      contractVersion: "ai-content-editorial-render-diagnostic.v1",
      sourceContractVersion: "card-manuscript-plan.v1", sourceSha256: "a".repeat(64), sceneIndex: 1,
      compiledPromptVersion: "image-visual-session.v1", compiledPromptSha256: "b".repeat(64),
      actualToolArgumentsObservation: "not_emitted_by_runner", actualToolArgumentsSha256: null,
    };
    const response = await app.inject({
      method: "POST", url: "/worker/ai-content-render-jobs/render-1/diagnostic", headers,
      payload: { workerId: "worker-1", leaseToken: "lease-1", diagnostic },
    });

    expect(response.statusCode).toBe(200);
    expect(repository.appendAiContentEditorialRenderDiagnostic).toHaveBeenCalledWith({
      jobId: "render-1", workerId: "worker-1", leaseToken: "lease-1", diagnostic,
    });
    const extra = await app.inject({
      method: "POST", url: "/worker/ai-content-render-jobs/render-1/diagnostic", headers,
      payload: { workerId: "worker-1", leaseToken: "lease-1", diagnostic, extra: true },
    });
    expect(extra.statusCode).toBe(400);
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
