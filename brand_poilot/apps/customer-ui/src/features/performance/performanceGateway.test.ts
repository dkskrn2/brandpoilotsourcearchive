import { describe, expect, it, vi } from "vitest";
import type { apiClient } from "../../lib/apiClient";
import { createPerformanceGateway } from "./performanceGateway";

function clientWith(requestJson: ReturnType<typeof vi.fn>) {
  return { requestJson } as unknown as ReturnType<typeof apiClient>;
}

describe("createPerformanceGateway", () => {
  it("loads insights and artifacts lazily and creates only a proposal batch", async () => {
    const requestJson = vi.fn()
      .mockResolvedValueOnce({ period: "30d" })
      .mockResolvedValueOnce({ kind: "image_gallery" })
      .mockResolvedValueOnce({ batchId: "batch-1", status: "queued" });
    const gateway = createPerformanceGateway(clientWith(requestJson));

    await gateway.getInsights("brand-1");
    expect(requestJson).toHaveBeenCalledTimes(1);
    await gateway.getArtifact("queue-1");
    await gateway.createProposalBatch("brand-1", {
      id: "experiment-1",
      title: "다음 실험",
      hypothesis: "가설",
      contentFamily: "informational",
      channelTargets: ["instagram"],
      outputFormats: ["card_news"],
      performanceSnapshotIds: ["snapshot-1"],
    });

    expect(requestJson.mock.calls).toEqual([
      ["/brands/brand-1/performance/insights?period=30d", { method: "GET" }],
      ["/publish-queue/queue-1/artifacts", { method: "GET" }],
      ["/brands/brand-1/ai-content/proposal-batches", expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("\"performanceSnapshotIds\":[\"snapshot-1\"]"),
      })],
    ]);
    expect(requestJson.mock.calls.some(([path]) => String(path).includes("/generations"))).toBe(false);
    expect(requestJson.mock.calls.some(([path, init]) => (
      String(path).endsWith("/publish") && (init as RequestInit).method === "POST"
    ))).toBe(false);
  });
});
