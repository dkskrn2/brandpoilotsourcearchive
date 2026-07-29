import { describe, expect, it, vi } from "vitest";
import { createBrandIntelligenceGateway } from "./brandIntelligenceGateway";

describe("brand intelligence gateway", () => {
  it("forwards the exact abort signal when loading an analysis", async () => {
    const requestJson = vi.fn().mockResolvedValue({ id: "analysis-1" });
    const gateway = createBrandIntelligenceGateway({ requestJson } as never);
    const controller = new AbortController();

    await gateway.getAnalysis("brand-1", "analysis-1", controller.signal);

    expect(requestJson).toHaveBeenCalledWith(
      "/brands/brand-1/brand-intelligence/analyses/analysis-1",
      { method: "GET", signal: controller.signal },
    );
  });
});
