import { describe, expect, it, vi } from "vitest";
import { createProductImageImportClient } from "./productImageImportClient.js";

describe("product image import client", () => {
  it("claims and completes one frozen product URL import", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ job: {
        id: "50000000-0000-4000-8000-000000000001",
        workspaceId: "10000000-0000-4000-8000-000000000001",
        brandId: "20000000-0000-4000-8000-000000000001",
        productServiceId: "30000000-0000-4000-8000-000000000001",
        versionId: "40000000-0000-4000-8000-000000000001",
        requestedByUserId: null,
        sourceUrls: ["https://shop.example/product"], attemptCount: 1, remainingSlots: 5, leaseToken: "lease-1",
      } }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "succeeded", retainedStoragePaths: [],
      }), { status: 200 }));
    const client = createProductImageImportClient({ apiUrl: "https://api.example", token: "token", fetchImpl });
    const job = await client.claim("image-worker-1", 180);
    expect(job?.sourceUrls).toEqual(["https://shop.example/product"]);
    await expect(client.complete(job!, "image-worker-1", { images: [], selectionAudit: { selected: 0 } }))
      .resolves.toEqual({ retainedStoragePaths: [] });
    expect(fetchImpl).toHaveBeenNthCalledWith(2,
      "https://api.example/worker/product-image-import-jobs/50000000-0000-4000-8000-000000000001/complete",
      expect.objectContaining({ body: expect.stringContaining('"images":[]') }),
    );
  });
});
