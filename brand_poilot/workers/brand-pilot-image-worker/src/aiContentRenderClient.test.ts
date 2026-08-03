import { describe, expect, it, vi } from "vitest";
import { createAiContentRenderClient } from "./aiContentRenderClient.js";

const uid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("AI content render API client", () => {
  it("uses the Task 9 endpoints and unwraps an image job without confusing a 204", async () => {
    const job = {
      id: uid(1), generationId: uid(2), outputId: uid(3), workspaceId: uid(4), brandId: uid(5),
      jobKind: "image_asset", assetIndex: 1, leaseToken: "lease", attemptCount: 1,
      payload: {
        contractVersion: "ai-content-render-job.v1", jobKind: "image_asset", generationId: uid(2), outputId: uid(3),
        assetIndex: 1, assetKey: `${uid(2)}:1`, storagePath: `ai-content/${uid(5)}/${uid(2)}/${uid(3)}/assets/01.png`,
        imagePackage: {
          contractVersion: "image-generation-package.v1", generationId: uid(2), outputFormat: "card_news",
          purpose: "informational", assetCount: 1, aspectRatio: "4:5", channelTargets: ["instagram"],
          assets: [{ index: 1, role: "hook", copy: "copy", visualDirection: "visual", evidenceIds: [], productImageAssetIds: [], attachmentIds: [] }],
          product: null, references: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [],
          userImageInstruction: null,
          logoPolicy: { allowGeneratedLogo: false, allowReservedLogoArea: false, allowExternalReferenceLogo: false, allowExistingProductPackagingLogo: true },
        },
      },
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ job }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createAiContentRenderClient({ apiUrl: "https://api.example/", token: "token", fetchImpl });

    await expect(client.claim("worker", 180)).resolves.toMatchObject({ jobKind: "image_asset", assetIndex: 1 });
    await expect(client.claim("worker", 180)).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenNthCalledWith(1, "https://api.example/worker/ai-content-render-jobs/claim", expect.objectContaining({
      method: "POST", body: JSON.stringify({ workerId: "worker", leaseSeconds: 180 }),
    }));
  });

  it("sends exact heartbeat, completion, and failure bodies and reports lease loss", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "processing" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "lost" }), { status: 409 }))
      .mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    const client = createAiContentRenderClient({ apiUrl: "https://api.example", token: "token", fetchImpl });
    const lease = { id: uid(1), leaseToken: "lease" };

    await expect(client.heartbeat(lease, "worker", 180)).resolves.toBe(true);
    await expect(client.heartbeat(lease, "worker", 180)).resolves.toBe(false);
    await client.completeAsset(lease, "worker", { index: 1, url: "https://blob.example/1.png", storagePath: "path", mimeType: "image/png", width: 1080, height: 1350, checksum: "a".repeat(64) });
    await client.fail(lease, "worker", { errorCode: "render_failed", errorMessage: "failed", retryable: true });

    expect(JSON.parse(String(fetchImpl.mock.calls[2]![1]!.body))).toEqual(expect.objectContaining({ jobKind: "image_asset", workerId: "worker", leaseToken: "lease" }));
    expect(JSON.parse(String(fetchImpl.mock.calls[3]![1]!.body))).toEqual({ workerId: "worker", leaseToken: "lease", errorCode: "render_failed", errorMessage: "failed", retryable: true });
  });

  it("preserves a stable API error code when a render completion is rejected", async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ error: "ai_content_render_asset_invalid" }),
      { status: 400, headers: { "content-type": "application/json" } },
    ));
    const client = createAiContentRenderClient({ apiUrl: "https://api.example", token: "token", fetchImpl });

    await expect(client.completeAsset(
      { id: uid(1), leaseToken: "lease" },
      "worker",
      { index: 1, url: "https://blob.example/1.png", storagePath: "path", mimeType: "image/png", width: 1024, height: 1024, checksum: "a".repeat(64) },
    )).rejects.toThrow("ai_content_render_api_failed:400:ai_content_render_asset_invalid");
  });
});
