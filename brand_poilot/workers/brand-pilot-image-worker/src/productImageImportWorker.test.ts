import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runProductImageImportOnce } from "./productImageImportWorker.js";

describe("product image import worker", () => {
  it("extracts, uploads, audits, and completes a product-only import", async () => {
    const job = {
      id: "50000000-0000-4000-8000-000000000001", workspaceId: "10000000-0000-4000-8000-000000000001",
      brandId: "20000000-0000-4000-8000-000000000001", productServiceId: "30000000-0000-4000-8000-000000000001",
      versionId: "40000000-0000-4000-8000-000000000001", requestedByUserId: null,
      sourceUrls: ["https://shop.example/product?private=secret"], attemptCount: 1, remainingSlots: 5, leaseToken: "lease-1",
    };
    const client = {
      claim: vi.fn(async () => job), heartbeat: vi.fn(async () => true),
      complete: vi.fn(async () => ({ retainedStoragePaths: [
        `brands/${job.brandId}/asset-library/products/${job.productServiceId}/imports/${job.id}/${"b".repeat(64)}.jpg`,
      ] })), fail: vi.fn(async () => undefined),
    };
    const acquire = vi.fn(async ({ inputDir }: { inputDir: string }) => {
      const absolutePath = path.join(inputDir, "product-url-1.jpg");
      await writeFile(absolutePath, Buffer.from("image"));
      return {
        references: [{
          absolutePath, relativePath: "inputs/product-url-1.jpg",
          candidate: {
            candidateId: "a".repeat(64), sourcePageUrl: job.sourceUrls[0], imageUrl: "https://shop.example/product.jpg",
            discoveryMethod: "open_graph", mimeType: "image/jpeg", width: 800, height: 800,
            contentSha256: "b".repeat(64), decision: "selected", reason: "url_fill",
          },
        }],
        candidates: [], events: [{ sourcePageUrl: job.sourceUrls[0], imageUrl: "https://shop.example/product.jpg", status: "selected", reason: "url_fill" }],
      };
    });
    const upload = vi.fn(async () => ({
      storageUrl: "https://blob.example/product.jpg",
      storagePath: `brands/${job.brandId}/asset-library/products/${job.productServiceId}/imports/${job.id}/${"b".repeat(64)}.jpg`,
    }));

    await expect(runProductImageImportOnce({ workerId: "image-worker-1", client, acquire: acquire as never, upload }))
      .resolves.toEqual({ status: "completed", jobId: job.id });
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ bytes: Buffer.from("image"), mimeType: "image/jpeg" }));
    expect(client.complete).toHaveBeenCalledWith(job, "image-worker-1", expect.objectContaining({
      images: [expect.objectContaining({ checksum: "b".repeat(64), sourceUrl: "https://shop.example/product.jpg" })],
      selectionAudit: expect.objectContaining({ selected: 1, sourceUrls: ["https://shop.example/product"] }),
    }));
  });

  it("completes without acquisition or uploads when the product already has five images", async () => {
    const job = {
      id: "50000000-0000-4000-8000-000000000002", workspaceId: "10000000-0000-4000-8000-000000000001",
      brandId: "20000000-0000-4000-8000-000000000001", productServiceId: "30000000-0000-4000-8000-000000000001",
      versionId: "40000000-0000-4000-8000-000000000001", requestedByUserId: null,
      sourceUrls: ["https://shop.example/product"], attemptCount: 1, remainingSlots: 0, leaseToken: "lease-2",
    };
    const client = {
      claim: vi.fn(async () => job), heartbeat: vi.fn(async () => true),
      complete: vi.fn(async () => ({ retainedStoragePaths: [] })), fail: vi.fn(async () => undefined),
    };
    const acquire = vi.fn(async () => ({ references: [], candidates: [], events: [] }));
    const upload = vi.fn();

    await expect(runProductImageImportOnce({ workerId: "image-worker-1", client, acquire: acquire as never, upload }))
      .resolves.toEqual({ status: "completed", jobId: job.id });
    expect(acquire).toHaveBeenCalledWith(expect.objectContaining({ slots: 0 }));
    expect(upload).not.toHaveBeenCalled();
    expect(client.complete).toHaveBeenCalledWith(job, "image-worker-1", expect.objectContaining({ images: [] }));
  });
});
