import { describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../../lib/apiClient";
import { createBrandCenterGateway } from "./brandCenterGateway";

describe("brand center gateway", () => {
  it("creates a new core draft instead of patching the active revision", async () => {
    const requestJson = vi.fn().mockResolvedValue({ id: "draft-2" });
    const gateway = createBrandCenterGateway({ requestJson } as never);
    const input = {
      core: {
        contractVersion: "brand-core.v1" as const,
        summary: { oneLine: "한 줄", description: "설명" },
        audiences: [],
        valueProposition: { primary: "", differentiators: [], proofPoints: [] },
        messaging: {
          appeals: [],
          tone: [],
          preferredPhrases: [],
          brandDirection: "",
          priorityMessages: [],
        },
      },
      evidence: [],
      reviewState: {},
      sourceAnalysisId: null,
    };

    await gateway.createCoreDraft("brand-1", input);

    expect(requestJson).toHaveBeenCalledWith(
      "/brands/brand-1/brand-core/drafts",
      { method: "POST", body: JSON.stringify(input) },
    );
  });

  it("loads summary and uses updatedAt for optimistic draft saves", async () => {
    const requestJson = vi.fn()
      .mockResolvedValueOnce({ brandCore: { state: "empty" } })
      .mockResolvedValueOnce({ id: "draft-1", updatedAt: "2026-07-26T00:00:00.000Z" });
    const gateway = createBrandCenterGateway({ requestJson } as never);

    await gateway.getSummary("brand-1");
    await gateway.updateCoreDraft("brand-1", "draft-1", {
      core: {
        contractVersion: "brand-core.v1",
        summary: { oneLine: "한 줄", description: "설명" },
        audiences: [],
        valueProposition: { primary: "", differentiators: [], proofPoints: [] },
        messaging: {
          appeals: [],
          tone: [],
          preferredPhrases: [],
          brandDirection: "",
          priorityMessages: [],
        },
      },
      evidence: [],
      reviewState: {},
      expectedUpdatedAt: "2026-07-26T00:00:00.000Z",
    });

    expect(requestJson).toHaveBeenNthCalledWith(
      2,
      "/brands/brand-1/brand-core/drafts/draft-1",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining("expectedUpdatedAt"),
      }),
    );
  });

  it("sends the displayed concurrency token when approving a core draft", async () => {
    const requestJson = vi.fn().mockResolvedValue({ id: "draft-1", status: "approved" });
    const gateway = createBrandCenterGateway({ requestJson } as never);

    await gateway.approveCoreDraft(
      "brand-1",
      "draft-1",
      "2026-07-26T00:00:00.000Z",
    );

    expect(requestJson).toHaveBeenCalledWith(
      "/brands/brand-1/brand-core/drafts/draft-1/approve",
      {
        method: "POST",
        body: JSON.stringify({ expectedUpdatedAt: "2026-07-26T00:00:00.000Z" }),
      },
    );
  });

  it("preserves conflict identity so the screen can keep stale edits and retry", async () => {
    const conflict = new ApiRequestError({
      status: 409,
      errorCode: "brand_core_version_conflict",
    });
    const requestJson = vi.fn().mockRejectedValue(conflict);
    const gateway = createBrandCenterGateway({ requestJson } as never);

    await expect(gateway.getCore("brand-1")).rejects.toBe(conflict);
    await expect(gateway.getCore("brand-1")).rejects.toBe(conflict);
    expect(requestJson).toHaveBeenCalledTimes(2);
  });
});
