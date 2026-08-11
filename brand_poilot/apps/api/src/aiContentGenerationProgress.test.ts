import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { buildAiContentGenerationProgress, loadAiContentGenerationProgress } from "./aiContentGenerationProgress.js";

const plan = {
  contractVersion: "card-news-plan.v2",
  imagePackage: {
    assets: [
      { index: 1, role: "cover" },
      { index: 2, role: "detail" },
      { index: 3, role: "cta" },
    ],
  },
};

describe("buildAiContentGenerationProgress", () => {
  it("collapses retries to one current state per asset index", () => {
    const result = buildAiContentGenerationProgress({
      generationStatus: "generating",
      generationCreatedAt: "2026-08-11T00:00:00.000Z",
      generationUpdatedAt: "2026-08-11T00:10:00.000Z",
      plan,
      jobs: [
        { assetIndex: 1, jobKind: "image_asset", status: "failed", attemptCount: 1, createdAt: "2026-08-11T00:01:00.000Z", updatedAt: "2026-08-11T00:02:00.000Z" },
        { assetIndex: 1, jobKind: "image_asset", status: "succeeded", attemptCount: 2, createdAt: "2026-08-11T00:01:00.000Z", updatedAt: "2026-08-11T00:03:00.000Z" },
        { assetIndex: 2, jobKind: "image_asset", status: "processing", attemptCount: 1, createdAt: "2026-08-11T00:04:00.000Z", updatedAt: "2026-08-11T00:05:00.000Z" },
        { assetIndex: 3, jobKind: "image_asset", status: "queued", attemptCount: 0, createdAt: "2026-08-11T00:04:00.000Z", updatedAt: "2026-08-11T00:04:00.000Z" },
      ],
    });

    expect(result).toMatchObject({
      phase: "rendering",
      totalAssets: 3,
      completedAssets: 1,
      failedAssets: 0,
      items: [
        { index: 1, role: "cover", status: "completed" },
        { index: 2, role: "detail", status: "processing" },
        { index: 3, role: "cta", status: "queued" },
      ],
    });
  });

  it("never counts duplicate succeeded rows above the planned asset count", () => {
    const result = buildAiContentGenerationProgress({
      generationStatus: "generating",
      generationCreatedAt: "2026-08-11T00:00:00.000Z",
      generationUpdatedAt: "2026-08-11T00:10:00.000Z",
      plan,
      jobs: [
        { assetIndex: 1, jobKind: "image_asset", status: "succeeded", attemptCount: 1, createdAt: "2026-08-11T00:01:00.000Z", updatedAt: "2026-08-11T00:02:00.000Z" },
        { assetIndex: 1, jobKind: "image_asset", status: "succeeded", attemptCount: 2, createdAt: "2026-08-11T00:01:00.000Z", updatedAt: "2026-08-11T00:03:00.000Z" },
      ],
    });

    expect(result?.items).toHaveLength(3);
    expect(result?.completedAssets).toBe(1);
  });

  it("omits progress for legacy records without a canonical image plan", () => {
    expect(buildAiContentGenerationProgress({
      generationStatus: "completed",
      generationCreatedAt: "2026-08-11T00:00:00.000Z",
      generationUpdatedAt: "2026-08-11T00:10:00.000Z",
      plan: null,
      jobs: [],
    })).toBeNull();
  });

  it("represents a canonical blog plan without images as finalizing zero assets", () => {
    expect(buildAiContentGenerationProgress({
      generationStatus: "generating",
      generationCreatedAt: "2026-08-11T00:00:00.000Z",
      generationUpdatedAt: "2026-08-11T00:10:00.000Z",
      plan: { contractVersion: "blog-plan.v2", imagePackage: null },
      jobs: [
        { assetIndex: null, jobKind: "package_finalize", status: "processing", attemptCount: 0, createdAt: "2026-08-11T00:09:00.000Z", updatedAt: "2026-08-11T00:10:00.000Z" },
      ],
    })).toMatchObject({ phase: "finalizing", totalAssets: 0, completedAssets: 0, failedAssets: 0, items: [] });
  });

  it("fails closed when planned indexes are discontinuous", () => {
    expect(buildAiContentGenerationProgress({
      generationStatus: "generating",
      generationCreatedAt: "2026-08-11T00:00:00.000Z",
      generationUpdatedAt: "2026-08-11T00:10:00.000Z",
      plan: { ...plan, imagePackage: { assets: [{ index: 1, role: "cover" }, { index: 3, role: "detail" }] } },
      jobs: [],
    })).toBeNull();
  });

  it("loads only the scoped generation plan and render jobs", async () => {
    const query = vi.fn(async () => ({ rows: [
      { output_id: "output-1", plan_json: plan, asset_index: 1, job_kind: "image_asset", status: "succeeded", attempt_count: 1, job_created_at: "2026-08-11T00:01:00.000Z", job_updated_at: "2026-08-11T00:02:00.000Z" },
      { output_id: "output-1", plan_json: plan, asset_index: 2, job_kind: "image_asset", status: "processing", attempt_count: 1, job_created_at: "2026-08-11T00:03:00.000Z", job_updated_at: "2026-08-11T00:04:00.000Z" },
    ] }));

    const result = await loadAiContentGenerationProgress(query, {
      generationId: "generation-1",
      workspaceId: "workspace-1",
      brandId: "brand-1",
      status: "generating",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:04:00.000Z",
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining("ai_content_generation_render_jobs"), ["generation-1", "workspace-1", "brand-1"]);
    expect(result).toMatchObject({ totalAssets: 3, completedAssets: 1 });
  });

  it("omits progress when more than one output plan is present", async () => {
    const query = vi.fn(async () => ({ rows: [
      { output_id: "output-1", plan_json: plan, asset_index: null, job_kind: null, status: null, attempt_count: null, job_created_at: null, job_updated_at: null },
      { output_id: "output-2", plan_json: plan, asset_index: null, job_kind: null, status: null, attempt_count: null, job_created_at: null, job_updated_at: null },
    ] }));

    await expect(loadAiContentGenerationProgress(query, {
      generationId: "generation-1", workspaceId: "workspace-1", brandId: "brand-1",
      status: "generating", createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:04:00.000Z",
    })).resolves.toBeNull();
  });
});
