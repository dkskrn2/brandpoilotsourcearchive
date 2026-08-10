import { describe, expect, it } from "vitest";
import {
  parseAiContentAssetRenderResult,
  parseAiContentAssetRunnerJob,
} from "./aiContentAssetRunnerContract.js";

describe("AI content asset runner contracts", () => {
  it("preserves the exact legacy v1 job and response contract", () => {
    const job = parseAiContentAssetRunnerJob({ prompt: "legacy prompt", selectedAssetCount: 1 });

    expect(job).toEqual({ prompt: "legacy prompt", selectedAssetCount: 1 });
    expect(parseAiContentAssetRenderResult(
      { contractVersion: "ai-content-asset-render.v1", selectedAssetCount: 1 },
      job,
    )).toEqual({ contractVersion: "ai-content-asset-render.v1", selectedAssetCount: 1 });
    expect(() => parseAiContentAssetRunnerJob({ prompt: "legacy prompt", selectedAssetCount: 1, assetIndex: 2 }))
      .toThrow("ai_content_asset_job_invalid");
  });

  it("requires the exact v2 asset index and completed response", () => {
    const job = parseAiContentAssetRunnerJob({
      prompt: "manual prompt",
      contractVersion: "ai-content-asset-render.v2",
      assetIndex: 2,
    });

    expect(job).toEqual({
      prompt: "manual prompt",
      contractVersion: "ai-content-asset-render.v2",
      assetIndex: 2,
    });
    expect(parseAiContentAssetRenderResult(
      { contractVersion: "ai-content-asset-render.v2", assetIndex: 2, status: "completed" },
      job,
    )).toEqual({ contractVersion: "ai-content-asset-render.v2", assetIndex: 2, status: "completed" });
  });

  it.each([
    { contractVersion: "ai-content-asset-render.v2", assetIndex: 1, status: "completed" },
    { contractVersion: "ai-content-asset-render.v2", assetIndex: 2, status: "failed" },
    { contractVersion: "ai-content-asset-render.v2", assetIndex: 2, status: "completed", extra: true },
    { contractVersion: "ai-content-asset-render.v1", selectedAssetCount: 1 },
  ])("rejects a v2 response that does not exactly bind the claimed asset: %j", (response) => {
    const job = parseAiContentAssetRunnerJob({
      prompt: "manual prompt",
      contractVersion: "ai-content-asset-render.v2",
      assetIndex: 2,
    });

    expect(() => parseAiContentAssetRenderResult(response, job))
      .toThrow("ai_content_asset_final_message_invalid");
  });
});
