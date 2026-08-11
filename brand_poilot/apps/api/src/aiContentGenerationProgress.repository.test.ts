import { describe, expect, it, vi } from "vitest";
import { createAiContentRepository } from "./aiContentRepository.js";

const scope = { workspaceId: "00000000-0000-4000-8000-000000000001", brandId: "00000000-0000-4000-8000-000000000002", generationId: "00000000-0000-4000-8000-000000000003" };
const plan = {
  contractVersion: "card-news-plan.v2",
  imagePackage: { assets: [{ index: 1, role: "cover" }, { index: 2, role: "detail" }] },
};

function repositoryFixture(planJson: unknown = plan, failProgressQuery = false) {
  const generation = {
    id: scope.generationId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
    output_format: "card_news", purpose: "informational", title: "Title", status: "generating",
    current_stage: "generation", draft_json: {}, analysis_json: {}, generation_input_snapshot: {
      contractVersion: "content-generation-input.v3", generationId: scope.generationId,
      subject: { kind: "topic_text", title: "Topic" }, references: { selected: [] },
    }, orchestration_snapshot: {}, avatar_snapshot: {}, subject_analysis_snapshot: {},
    attachments_locked_at: null, terminal_at: null, retryable_until: null,
    error_code: null, error_message: null, created_at: "2026-08-11T00:00:00.000Z",
    updated_at: "2026-08-11T00:04:00.000Z", completed_at: null,
  };
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("BEGIN") || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
    if (sql.includes("from ai_content_generations") && sql.includes("workspace_id = $2")) return { rows: [generation], rowCount: 1 };
    if (sql.includes("from ai_content_generation_outputs") && sql.includes("generation_id = any")) return { rows: [{
      id: "00000000-0000-4000-8000-000000000004", generation_id: scope.generationId,
      output_index: 1, title: "Title", status: "generating", content_json: {}, artifact_manifest_json: {},
      manifest_url: null, failure_code: null, failure_message: null, downloaded_at: null,
      created_at: generation.created_at, updated_at: generation.updated_at, completed_at: null,
    }], rowCount: 1 };
    if (sql.includes("from ai_content_generation_attachments")) return { rows: [], rowCount: 0 };
    if (sql.includes("ai_content_generation_render_jobs")) {
      if (failProgressQuery) throw new Error("progress_query_failed");
      return { rows: [
      { output_id: "00000000-0000-4000-8000-000000000004", plan_json: planJson, asset_index: 1, job_kind: "image_asset", status: "succeeded", attempt_count: 1, job_created_at: "2026-08-11T00:01:00.000Z", job_updated_at: "2026-08-11T00:02:00.000Z" },
      { output_id: "00000000-0000-4000-8000-000000000004", plan_json: planJson, asset_index: 2, job_kind: "image_asset", status: "processing", attempt_count: 1, job_created_at: "2026-08-11T00:03:00.000Z", job_updated_at: "2026-08-11T00:04:00.000Z" },
      ], rowCount: 2 };
    }
    return { rows: [], rowCount: 0 };
  });
  const client = { query, release: vi.fn() };
  return { repository: createAiContentRepository({ query, connect: async () => client } as never), query };
}

describe("generation detail progress", () => {
  it("adds scoped render progress to the generation detail only", async () => {
    const fixture = repositoryFixture();
    const result = await fixture.repository.getAiContentGeneration(scope);

    expect(result?.progress).toMatchObject({ totalAssets: 2, completedAssets: 1, failedAssets: 0 });
    expect(fixture.query.mock.calls.some(([sql]) => String(sql).includes("ai_content_generation_render_jobs"))).toBe(true);
  });

  it("omits progress for a legacy detail without a canonical plan", async () => {
    const result = await repositoryFixture(null).repository.getAiContentGeneration(scope);
    expect(result).not.toHaveProperty("progress");
  });

  it("keeps the existing detail response when optional progress lookup fails", async () => {
    const result = await repositoryFixture(plan, true).repository.getAiContentGeneration(scope);

    expect(result?.id).toBe(scope.generationId);
    expect(result).not.toHaveProperty("progress");
  });
});
