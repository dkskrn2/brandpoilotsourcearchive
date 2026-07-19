import { describe, expect, it } from "vitest";
import { createAiContentRepository } from "./aiContentRepository.js";

const target = { id: "target-1", name: "실용 고객", traits: ["바쁨"], painPoints: ["시간 부족"], purchaseMotivations: ["간편함"], uspEvidence: [] };
const appeal = { id: "appeal-1", targetId: "target-1", title: "빠른 시작", description: "쉽게 시작", evidenceType: "product_fact", connectionReason: "상품 근거", sources: [] };
const analysis = {
  id: "analysis-1", workspace_id: "workspace-1", brand_id: "brand-1", subject_type: "product", source_url: "https://example.com/product", normalized_url: "https://example.com/product",
  input_json: { name: "상품", promotion: "", description: "설명" }, status: "ready", facts_json: [], structured_data_json: {}, research_json: {}, targets_json: [target, { ...target, id: "target-2" }, { ...target, id: "target-3" }], appeals_json: { "target-1": [appeal] }, selected_image_id: "image-1", analysis_version: 1, idempotency_key: "a", leased_by: null, lease_token: null, lease_expires_at: null, attempt_count: 1, available_at: "2026-07-20T00:00:00.000Z", error_code: null, error_message: null, superseded_at: null, created_at: "2026-07-20T00:00:00.000Z", updated_at: "2026-07-20T00:00:00.000Z", completed_at: "2026-07-20T00:00:00.000Z",
};
const image = { id: "image-1", analysis_id: "analysis-1", source_url: "https://example.com/product.png", storage_url: "https://blob.example/product.png", storage_path: "subjects/product.png", width: 1024, height: 1024, mime_type: "image/png", alt_text: "상품", role: "product", selection_score: 1, created_at: "2026-07-20T00:00:00.000Z" };

function poolFor(draft: Record<string, unknown>, snapshot: unknown = null) {
  const sql: string[] = [];
  const generation = { id: "generation-1", workspace_id: "workspace-1", brand_id: "brand-1", type: "card_news", title: "상품 콘텐츠", status: "analysis_ready", current_stage: "analysis_ready", draft_json: draft, analysis_json: {}, generation_idempotency_key: null, subject_analysis_snapshot: snapshot, error_code: null, error_message: null, created_at: "2026-07-20T00:00:00.000Z", updated_at: "2026-07-20T00:00:00.000Z", completed_at: null };
  const query = async (text: string, params: unknown[] = []) => {
    sql.push(text);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) return { rows: [], rowCount: 0 };
    if (text.includes("from ai_content_subject_analyses") && text.includes("where id = $1")) return { rows: [analysis], rowCount: 1 };
    if (text.includes("from ai_content_subject_images")) return { rows: [image], rowCount: 1 };
    if (text.includes("select brand.name")) return { rows: [{ name: "Growthline", industry: "마케팅", primary_customer: "운영자", description: "콘텐츠", tone: "명확하게", forbidden_terms: [], default_cta: "문의", main_link: "https://example.com", brand_color: "#0057B8", owned_url: "https://example.com", source_status: "crawled", last_crawled_at: null }], rowCount: 1 };
    if (text.includes("from wiki_versions")) return { rows: [{ id: "wiki-1", wiki_updated_at: null, pages: [{ type: "brand_overview", title: "개요", summary: "브랜드", content: "내용", structuredData: {} }] }], rowCount: 1 };
    if (text.includes("from ai_content_generation_attachments")) return { rows: [], rowCount: 0 };
    if (text.includes("from ai_content_generations") && text.includes("subject_analysis_snapshot")) return { rows: [generation], rowCount: 1 };
    if (text.includes("pg_advisory_xact_lock")) return { rows: [{}], rowCount: 1 };
    if (text.includes("from ai_content_usage_ledger")) return { rows: [{ generation_count: 0 }], rowCount: 1 };
    if (text.includes("update ai_content_generations") && text.includes("subject_analysis_snapshot")) return { rows: [{ ...generation, status: "analyzing", generation_idempotency_key: params[3], subject_analysis_snapshot: params[5] ? JSON.parse(String(params[5])) : snapshot }], rowCount: 1 };
    if (text.includes("insert into ai_content_generation_outputs") || text.includes("insert into ai_content_generation_jobs") || text.includes("insert into ai_content_usage_ledger")) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  const client = { query, release: () => undefined };
  return { pool: { connect: async () => client, query } as never, sql };
}

function subjectDraft(overrides: Record<string, unknown> = {}) {
  return { subjectType: "product", subjectAnalysisId: "analysis-1", selectedSubjectImageIds: ["image-1"], selectedTarget: target, selectedAppeal: appeal, referenceIds: [], brief: { selectedColor: "#0F766E", aspectRatio: "1:1", outputCount: 1 }, ...overrides };
}

describe("AI content subject snapshot integration", () => {
  it("stores the v2 snapshot before usage ledger insertion", async () => {
    const fake = poolFor(subjectDraft());
    await createAiContentRepository(fake.pool).startAiContentGeneration({ workspaceId: "workspace-1", brandId: "brand-1", generationId: "generation-1", idempotencyKey: "generate-1", outputCount: 1, usageDate: "2026-07-20", dailyGenerationLimit: 10 });
    const updateIndex = fake.sql.findIndex((item) => item.includes("subject_analysis_snapshot = coalesce"));
    const usageIndex = fake.sql.findIndex((item) => item.includes("from ai_content_usage_ledger"));
    expect(updateIndex).toBeGreaterThan(-1);
    expect(usageIndex).toBeGreaterThan(updateIndex);
  });

  it("does not rebuild an existing snapshot from a changed draft", async () => {
    const existing = { contractVersion: "content-generation-input.v2", contentType: "card_news", brandContext: { ready: true, brandName: "Growthline", ownedUrl: "https://example.com", sourceStatus: "crawled", lastCrawledAt: null, wikiVersionId: "wiki-1", wikiUpdatedAt: null, summary: "브랜드", pageCount: 1, context: { brand: { name: "Growthline", brandColor: "#0057B8" } } }, subject: { analysisId: "analysis-old", analysisVersion: 1, type: "product", sourceUrl: "https://example.com/product", facts: [], research: {}, selectedImages: [{ id: "image-1", url: "https://blob.example/product.png", role: "product", altText: "상품" }] }, message: { target, appeal, qualityBrief: {} }, creativeDirection: { prompts: [], brandColor: "#0057B8", selectedColor: "#0057B8", aspectRatio: "1:1", outputCount: 1 }, references: [], attachments: [] };
    const fake = poolFor(subjectDraft({ subjectAnalysisId: "analysis-new" }), existing);
    await createAiContentRepository(fake.pool).startAiContentGeneration({ workspaceId: "workspace-1", brandId: "brand-1", generationId: "generation-1", idempotencyKey: "generate-2", outputCount: 1, usageDate: "2026-07-20", dailyGenerationLimit: 10 });
    expect(fake.sql.some((item) => item.includes("from ai_content_subject_analyses where id = $1"))).toBe(false);
  });
});
