import { describe, expect, it, vi } from "vitest";
import { createProductImageImportStorage } from "./productImageImportStorage.js";
import { createHash } from "node:crypto";

describe("product image import storage", () => {
  it("uploads to the immutable product import namespace without a random suffix", async () => {
    const bytes = Buffer.from("image");
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const putBlob = vi.fn(async (pathname: string) => ({ url: `https://blob.example/${pathname}` }));
    const storage = createProductImageImportStorage({ token: "token", putBlob: putBlob as never });
    const uploaded = await storage.upload({
      job: {
        id: "50000000-0000-4000-8000-000000000001", workspaceId: "10000000-0000-4000-8000-000000000001",
        brandId: "20000000-0000-4000-8000-000000000001", productServiceId: "30000000-0000-4000-8000-000000000001",
        versionId: "40000000-0000-4000-8000-000000000001", requestedByUserId: null,
        sourceUrls: ["https://shop.example/product"], attemptCount: 1, remainingSlots: 5, leaseToken: "lease-1",
      },
      bytes, mimeType: "image/jpeg", checksum,
    });
    expect(uploaded.storagePath).toBe(`brands/20000000-0000-4000-8000-000000000001/asset-library/products/30000000-0000-4000-8000-000000000001/imports/50000000-0000-4000-8000-000000000001/${checksum}.jpg`);
    expect(putBlob).toHaveBeenCalledWith(uploaded.storagePath, bytes, expect.objectContaining({
      addRandomSuffix: false, allowOverwrite: true, contentType: "image/jpeg",
    }));
  });
});
