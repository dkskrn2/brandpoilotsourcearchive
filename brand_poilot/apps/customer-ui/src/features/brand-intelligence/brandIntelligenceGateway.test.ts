import { describe, expect, it, vi } from "vitest";
import { createBrandIntelligenceGateway } from "./brandIntelligenceGateway";

describe("brand intelligence gateway", () => {
  it("loads the current open workflow from the dedicated endpoint", async () => {
    const workflow = { id: "analysis-1", status: "review_ready" };
    const requestJson = vi.fn().mockResolvedValue({ workflow });
    const gateway = createBrandIntelligenceGateway({ requestJson } as never);

    await expect(gateway.getWorkflow("brand-1")).resolves.toEqual(workflow);
    expect(requestJson).toHaveBeenCalledWith(
      "/brands/brand-1/brand-intelligence/workflow",
      { method: "GET" },
    );
  });

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
