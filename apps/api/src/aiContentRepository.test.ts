import { describe, expect, it, vi } from "vitest";
import { createAiContentRepository } from "./aiContentRepository.js";

function row(id: string, status = "analyzing") {
  return {
    id,
    workspace_id: "workspace-1",
    brand_id: "brand-1",
    type: "card_news",
    title: "여름 추천",
    status,
    current_stage: null as string | null,
    draft_json: { productUrl: "https://example.com/product" },
    analysis_json: {},
    generation_idempotency_key: null as string | null,
    error_code: null,
    error_message: null,
    created_at: "2026-07-18T00:00:00.000Z",
    updated_at: "2026-07-18T00:00:00.000Z",
    completed_at: null,
  };
}

function createPool(options: { missingReferences?: boolean; generationUsage?: number; wikiReady?: boolean } = {}) {
  const commands: string[] = [];
  const sql: string[] = [];
  const referenceSnapshots: Array<Record<string, unknown>> = [];
  let analyzeJobInsertCount = 0;
  let generation = row("generation-1");
  let analysisCreated = false;

  const client = {
    query: async (query: string, params: unknown[] = []) => {
      commands.push(query);
      sql.push(query);
      if (query === "BEGIN" || query === "COMMIT" || query === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (query.includes("pg_advisory_xact_lock")) return { rows: [{}], rowCount: 1 };
      if (query.includes("from ai_content_usage_ledger")) {
        return { rows: [{ generation_count: options.generationUsage ?? 0 }], rowCount: 1 };
      }
      if (query.includes("from brands brand")) {
        return { rows: [{ name: "Growthline", industry: "마케팅", primary_customer: "브랜드 운영자", description: "콘텐츠 운영", tone: "명확하게", forbidden_terms: [], default_cta: "문의", main_link: "https://example.com", brand_color: "파란색", owned_url: "https://example.com", source_status: "crawled", last_crawled_at: "2026-07-18T00:00:00.000Z" }], rowCount: 1 };
      }
      if (query.includes("from wiki_versions version")) {
        if (options.wikiReady === false) return { rows: [], rowCount: 0 };
        return { rows: [{ id: "wiki-1", wiki_updated_at: "2026-07-18T00:10:00.000Z", pages: [{ type: "brand_overview", title: "브랜드 개요", summary: "자사 분석", content: "브랜드 근거", structuredData: {} }] }], rowCount: 1 };
      }
      if (query.includes("insert into ai_content_usage_ledger")) return { rows: [], rowCount: 1 };
      if (query.includes("insert into ai_content_generations")) {
        analysisCreated = true;
        generation = { ...generation, title: String(params[3] ?? generation.title), status: String(params[4]), current_stage: String(params[5]), draft_json: JSON.parse(String(params[6])), analysis_json: JSON.parse(String(params[7])) };
        return { rows: [generation], rowCount: 1 };
      }
      if (query.includes("insert into ai_content_generation_jobs")) {
        analyzeJobInsertCount += 1;
        return { rows: [], rowCount: 1 };
      }
      if (query.includes("from ai_content_generations") && query.includes("analysis_idempotency_key")) {
        return analysisCreated ? { rows: [generation], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (query.includes("select") && query.includes("from ai_content_generations")) {
        return { rows: [generation], rowCount: 1 };
      }
      if (query.includes(") reference_rows where id = any")) {
        const ids = options.missingReferences ? [] : params[2] as string[];
        return { rows: ids.map((id) => ({ id, snapshot: { source: "saved_trend", permalink: "https://instagram.com/p/reference", caption: "참고 캡션", username: "reference_account", mediaType: "IMAGE", mediaUrl: "https://cdn.example.com/original.jpg", previewUrl: "https://cdn.example.com/preview.jpg", postedAt: "2026-07-18T00:00:00.000Z", likeCount: 120, commentsCount: 8 } })), rowCount: ids.length };
      }
      if (query.includes("insert into ai_content_generation_references")) {
        referenceSnapshots.push(JSON.parse(String(params[5])));
        return { rows: [], rowCount: 1 };
      }
      if (query.includes("update ai_content_generations") && query.includes("set draft_json")) {
        generation = { ...generation, draft_json: JSON.parse(String(params[3])) };
        return { rows: [generation], rowCount: 1 };
      }
      if (query.includes("update ai_content_generations") && query.includes("generation_idempotency_key")) {
        generation = { ...generation, status: "analyzing", current_stage: String(params[4]), generation_idempotency_key: String(params[3]) };
        return { rows: [generation], rowCount: 1 };
      }
      if (query.includes("insert into ai_content_generation_outputs")) {
        return { rows: [{ id: `output-${params.at(-1)}` }], rowCount: 1 };
      }
      if (query.includes("insert into ai_content_generation_attachments")) {
        return {
          rows: [{
            id: "attachment-1",
            generation_id: params[0],
            role: params[3],
            file_name: params[4],
            mime_type: params[5],
            size_bytes: params[6],
            checksum: params[7],
            storage_url: params[8],
            storage_path: params[9],
            created_at: "2026-07-18T00:00:00.000Z",
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
    release: () => undefined,
  };

  return {
    connect: async () => client,
    query: client.query,
    commands,
    sql,
    get analyzeJobInsertCount() { return analyzeJobInsertCount; },
    get referenceSnapshots() { return referenceSnapshots; },
    setGenerationStatus(status: string) { generation = { ...generation, status }; },
  };
}

function createWorkerPool(options: {
  jobType?: "analyze" | "generate";
  outputStatus?: string;
  totalOutputs?: number;
  finalizeGeneration?: boolean;
  linkedChannelOutput?: boolean;
  autoApprovalEnabled?: boolean;
  exhaustedJob?: boolean;
} = {}) {
  const sql: string[] = [];
  let generation = row("generation-1", options.jobType === "analyze" ? "analyzing" : "generating");
  let outputStatus = options.outputStatus ?? "generating";
  const job: Record<string, unknown> = {
    id: "job-1", generation_id: "generation-1", output_id: options.jobType === "analyze" ? null : "output-1",
    workspace_id: "workspace-1", brand_id: "brand-1", job_type: options.jobType ?? "generate", content_type: "card_news",
    status: "queued", payload_json: options.finalizeGeneration ? { finalizeGeneration: true } : {}, attempt_count: 0, max_attempts: 3, available_at: new Date("2026-07-18T00:00:00.000Z"),
    worker_id: null, lease_token: null, lease_expires_at: null,
  };
  const client = {
    query: async (query: string, params: unknown[] = []) => {
      sql.push(query);
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(query)) return { rows: [], rowCount: 0 };
      if (query.includes("update ai_content_generation_jobs") && query.includes("lease_exhausted")) {
        return options.exhaustedJob
          ? { rows: [{ generation_id: "generation-1", output_id: "output-1", job_type: "generate" }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (query.includes("update ai_content_generation_jobs") && query.includes("lease_expired")) return { rows: [], rowCount: 0 };
      if (query.includes("with candidate as")) {
        if (job.status !== "queued") return { rows: [], rowCount: 0 };
        Object.assign(job, { status: "processing", worker_id: params[1], lease_token: params[2], lease_expires_at: new Date("2099-07-18T00:03:00.000Z"), attempt_count: Number(job.attempt_count) + 1 });
        return { rows: [{ ...job }], rowCount: 1 };
      }
      if (query.includes("from brands brand")) {
        return { rows: [{ name: "Growthline", forbidden_terms: [], owned_url: "https://example.com", source_status: "crawled", last_crawled_at: "2026-07-18T00:00:00.000Z" }], rowCount: 1 };
      }
      if (query.includes("from wiki_versions version")) {
        return { rows: [{ id: "wiki-1", wiki_updated_at: "2026-07-18T00:10:00.000Z", pages: [{ type: "brand_overview", title: "브랜드 개요", summary: "자사 분석", content: "브랜드 근거", structuredData: {} }] }], rowCount: 1 };
      }
      if (query.includes("select generation.draft_json")) return { rows: [{ draft_json: {}, analysis_json: {}, generation_title: "여름 추천", generation_type: "card_news", output_index: 1, reference_snapshots: [], attachments: [] }], rowCount: 1 };
      if (query.includes("set lease_expires_at") && query.includes("last_heartbeat_at")) {
        const valid = job.status === "processing" && job.worker_id === params[1] && job.lease_token === params[2];
        return { rows: valid ? [{ id: job.id }] : [], rowCount: valid ? 1 : 0 };
      }
      if (query.includes("select * from ai_content_generation_jobs")) return { rows: [{ ...job }], rowCount: 1 };
      if (query.includes("set analysis_json")) {
        generation = { ...generation, status: String(params[2]), current_stage: String(params[3]), analysis_json: JSON.parse(String(params[1])) };
        return { rows: [], rowCount: 1 };
      }
      if (query.includes("update ai_content_generation_outputs") && query.includes("status = 'completed'")) {
        outputStatus = "completed";
        return { rows: [], rowCount: 1 };
      }
      if (query.includes("from channel_outputs channel_output") && query.includes("ai_content_generation_output_id")) {
        if (!options.linkedChannelOutput) return { rows: [], rowCount: 0 };
        return {
          rows: [{
            id: "channel-output-1",
            workspace_id: "workspace-1",
            brand_id: "brand-1",
            content_topic_id: "content-topic-1",
            channel: "instagram",
            delivery_format: "instagram_feed_carousel",
            status: "generating",
            title: "여름 추천",
            output_json: { deliveryFormat: "instagram_feed_carousel" },
            source_summary: "대표 URL: https://example.com",
            topic_publish_group_id: "publish-group-1",
            brand_channel_id: "brand-channel-1",
            auto_approval_enabled: options.autoApprovalEnabled ?? false,
          }],
          rowCount: 1,
        };
      }
      if (query.includes("insert into storage_artifacts")) return { rows: [{ id: "artifact-1" }], rowCount: 1 };
      if (query.includes("update channel_outputs") && query.includes("rendered_artifact_id")) return { rows: [{ id: "channel-output-1" }], rowCount: 1 };
      if (query.includes("insert into publish_queue")) return { rows: [{ id: "queue-1" }], rowCount: 1 };
      if (query.includes("select id") && query.includes("from ai_content_generation_outputs") && query.includes("order by output_index")) {
        const count = options.totalOutputs ?? 1;
        return { rows: Array.from({ length: count }, (_, index) => ({ id: `output-${index + 1}` })), rowCount: count };
      }
      if (query.includes("update ai_content_generation_jobs") && query.includes("status = 'succeeded'")) {
        job.status = "succeeded";
        return { rows: [], rowCount: 1 };
      }
      if (query.includes("count(*)::integer as total")) return { rows: [{ total: options.totalOutputs ?? 1, completed: outputStatus === "completed" ? 1 : 0, failed: outputStatus === "failed" ? 1 : 0 }], rowCount: 1 };
      if (query.includes("update ai_content_generations") && query.includes("completed_at = case")) {
        generation = { ...generation, status: String(params[1]) };
        return { rows: [], rowCount: 1 };
      }
      if (query.includes("update ai_content_generation_jobs") && query.includes("available_at = case")) {
        job.status = params[1];
        job.error_code = params[2];
        return { rows: [], rowCount: 1 };
      }
      if (query.includes("update ai_content_generation_outputs") && query.includes("failure_code")) {
        outputStatus = String(params[1]);
        return { rows: [], rowCount: 1 };
      }
      if (query.includes("from ai_content_generation_outputs output") && query.includes("for update of output")) {
        return { rows: [{ id: "output-1", generation_id: "generation-1", workspace_id: "workspace-1", brand_id: "brand-1", status: outputStatus, type: "card_news" }], rowCount: 1 };
      }
      if (query.includes("update ai_content_generation_outputs") && query.includes("set status = 'queued'")) {
        outputStatus = "queued";
        return { rows: [], rowCount: 1 };
      }
      if (query.includes("insert into ai_content_generation_jobs")) return { rows: [], rowCount: 1 };
      if (query.includes("update ai_content_generations") && query.includes("set status = 'queued'")) {
        generation = { ...generation, status: "queued" };
        return { rows: [], rowCount: 1 };
      }
      if (query.includes("from ai_content_generations where id = $1")) return { rows: [generation], rowCount: 1 };
      if (query.includes("from ai_content_generation_attachments") && query.includes("deleted_at is null")) {
        return { rows: [{ id: "attachment-1", storage_url: "https://blob.example.com/reference.png" }], rowCount: 1 };
      }
      if (query.includes("update ai_content_generation_attachments") && query.includes("deleted_at = now()")) {
        return { rows: [], rowCount: 1 };
      }
      if (query.includes("set status = 'generating'")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release: () => undefined,
  };
  return { connect: async () => client, query: client.query, sql, job };
}

const scope = { workspaceId: "workspace-1", brandId: "brand-1" };
const input = {
  ...scope,
  type: "card_news" as const,
  title: "여름 추천",
  draft: { productUrl: "https://example.com/product" },
  idempotencyKey: "analysis-key-1",
};

describe("AI content repository", () => {
  it("returns source URL ids for blog references so they can be snapshotted later", async () => {
    const pool = createPool();
    const repository = createAiContentRepository(pool as never);

    await repository.listAiContentReferences({ ...scope, type: "blog" });

    expect(pool.sql.join("\n")).toContain("select source.id, 'saved_url' as source");
  });

  it("creates a generation and analyze job atomically", async () => {
    const pool = createPool();
    const repository = createAiContentRepository(pool as never);

    const result = await repository.createAiContentAnalysis(input);

    expect(result.status).toBe("analyzing");
    expect(result.draft).toMatchObject({ origin: "manual" });
    expect(pool.sql.join("\n")).toContain("insert into ai_content_generation_jobs");
    expect(pool.sql.join("\n")).toContain("jsonb_build_object('generationId', $1::uuid)");
    expect(pool.commands).toEqual(expect.arrayContaining(["BEGIN", "COMMIT"]));
  });

  it("applies stored owned context without queueing a CLI analysis job", async () => {
    const pool = createPool();
    const repository = createAiContentRepository(pool as never);

    const context = await repository.getAiContentBrandContext(scope);
    const result = await repository.createAiContentAnalysis({ ...input, draft: { analysisSource: "owned" } });

    expect(context).toMatchObject({ ready: true, ownedUrl: "https://example.com", wikiVersionId: "wiki-1", pageCount: 1 });
    expect(result).toMatchObject({ status: "analysis_ready", analysis: { source: "owned", contextReady: true, wikiVersionId: "wiki-1" } });
    expect(pool.analyzeJobInsertCount).toBe(0);
  });

  it("uses the confirmed brand intelligence snapshot as the owned context", async () => {
    const pool = createPool({ wikiReady: false });
    const confirmedProfile = {
      contractVersion: "brand-intelligence-result.v1" as const,
      companyOverview: "그로스라인 개요",
      businessDescription: "확정된 콘텐츠 운영 서비스",
      primaryCategory: { code: "marketing", name: "마케팅" },
      subcategories: [{ code: "content", name: "콘텐츠 마케팅" }],
      primaryTarget: "확정된 브랜드 담당자",
      differentiators: "확정 자사 정보 재사용",
      coreAppeal: "반복 입력 감소",
      competitors: [],
      evidence: [],
      sourceGaps: [],
    };
    const repository = createAiContentRepository(pool as never, {
      brandIntelligenceProvider: {
        getConfirmed: async () => ({
          versionId: "analysis-1",
          confirmedAt: "2026-07-21T00:00:00.000Z",
          profile: confirmedProfile,
        }),
      },
    });

    const context = await repository.getAiContentBrandContext(scope);
    const result = await repository.createAiContentAnalysis({ ...input, draft: { analysisSource: "owned" } });

    expect(context).toMatchObject({
      ready: true,
      brandIntelligenceVersionId: "analysis-1",
      context: {
        brand: {
          industry: "마케팅",
          primaryCustomer: "확정된 브랜드 담당자",
          description: "확정된 콘텐츠 운영 서비스",
        },
        brandIntelligence: { versionId: "analysis-1", profile: confirmedProfile },
      },
    });
    expect(result).toMatchObject({
      status: "analysis_ready",
      analysis: { source: "owned", contextReady: true, brandIntelligenceVersionId: "analysis-1" },
    });
    expect(pool.analyzeJobInsertCount).toBe(0);
  });

  it("builds the confirmed brand context required by a v2 subject analysis", async () => {
    const pool = createPool({ wikiReady: false });
    const confirmedProfile = {
      contractVersion: "brand-intelligence-result.v1" as const,
      companyOverview: "그로스라인 개요",
      businessDescription: "확정된 콘텐츠 운영 서비스",
      primaryCategory: { code: "marketing", name: "마케팅" },
      subcategories: [{ code: "content", name: "콘텐츠 마케팅" }],
      primaryTarget: "확정된 브랜드 담당자",
      differentiators: "확정 자사 정보 재사용",
      coreAppeal: "반복 입력 감소",
      competitors: [],
      evidence: [],
      sourceGaps: [],
    };
    const repository = createAiContentRepository(pool as never, {
      brandIntelligenceProvider: {
        getConfirmed: async () => ({
          versionId: "analysis-1",
          confirmedAt: "2026-07-21T00:00:00.000Z",
          profile: confirmedProfile,
        }),
      },
    });

    await expect(repository.getConfirmedSubjectAnalysisBrandContext(scope)).resolves.toEqual({
      brandName: "Growthline",
      companyOverview: "그로스라인 개요",
      businessDescription: "확정된 콘텐츠 운영 서비스",
      primaryCategory: { code: "marketing", name: "마케팅" },
      subcategories: [{ code: "content", name: "콘텐츠 마케팅" }],
      primaryTarget: "확정된 브랜드 담당자",
      differentiators: "확정 자사 정보 재사용",
      coreAppeal: "반복 입력 감소",
      brandColor: "파란색",
      brandIntelligenceVersionId: "analysis-1",
      confirmedAt: "2026-07-21T00:00:00.000Z",
    });
  });

  it("requires confirmed brand intelligence for a v2 subject analysis", async () => {
    const pool = createPool({ wikiReady: false });
    const repository = createAiContentRepository(pool as never, {
      brandIntelligenceProvider: { getConfirmed: async () => null },
    });

    await expect(repository.getConfirmedSubjectAnalysisBrandContext(scope))
      .rejects.toThrow("subject_analysis_brand_context_required");
  });

  it("uses a completed subject analysis without queueing the legacy analysis job", async () => {
    const pool = createPool();
    const repository = createAiContentRepository(pool as never);

    const result = await repository.createAiContentAnalysis({
      ...input,
      draft: { subjectType: "product", subjectAnalysisId: "subject-analysis-1" },
    });

    expect(result).toMatchObject({ status: "analysis_ready", currentStage: "analysis_ready" });
    expect(pool.analyzeJobInsertCount).toBe(0);
  });

  it("allows owned context selection before the first wiki is built", async () => {
    const pool = createPool({ wikiReady: false });
    const repository = createAiContentRepository(pool as never);

    const result = await repository.createAiContentAnalysis({ ...input, draft: { analysisSource: "owned" } });

    expect(result).toMatchObject({ status: "analysis_ready", analysis: { source: "owned", contextReady: false } });
    expect(pool.analyzeJobInsertCount).toBe(0);
  });

  it("returns the existing generation for a repeated analysis idempotency key", async () => {
    const pool = createPool();
    const repository = createAiContentRepository(pool as never);

    const first = await repository.createAiContentAnalysis(input);
    const second = await repository.createAiContentAnalysis(input);

    expect(second.id).toBe(first.id);
    expect(pool.analyzeJobInsertCount).toBe(1);
  });

  it("updates the scoped draft and selected references", async () => {
    const pool = createPool();
    const repository = createAiContentRepository(pool as never);
    await repository.createAiContentAnalysis(input);

    const result = await repository.updateAiContentDraft({
      ...scope,
      generationId: "generation-1",
      draft: { productUrl: "https://example.com/new" },
      referenceIds: ["reference-1"],
    });

    expect(result.id).toBe("generation-1");
    expect(result.draft).toMatchObject({ origin: "manual" });
    expect(pool.sql.join("\n")).toContain("ai_content_generation_references");
    expect(pool.sql.join("\n")).toContain("media.media_url");
    expect(pool.sql.join("\n")).toContain("_previewUrl");
    expect(pool.referenceSnapshots[0]).toMatchObject({
      source: "saved_trend",
      mediaType: "IMAGE",
      mediaUrl: "https://cdn.example.com/original.jpg",
      previewUrl: "https://cdn.example.com/preview.jpg",
      username: "reference_account",
    });
  });

  it("rejects references that do not belong to the scoped brand", async () => {
    const pool = createPool({ missingReferences: true });
    const repository = createAiContentRepository(pool as never);
    await repository.createAiContentAnalysis(input);

    await expect(repository.updateAiContentDraft({
      ...scope,
      generationId: "generation-1",
      draft: { productUrl: "https://example.com/new" },
      referenceIds: ["reference-from-another-brand"],
    })).rejects.toThrow("ai_content_reference_not_found");
    expect(pool.commands).toContain("ROLLBACK");
  });

  it("queues final analysis before one through three output jobs", async () => {
    const pool = createPool();
    const repository = createAiContentRepository(pool as never);
    await repository.createAiContentAnalysis(input);
    await expect(repository.startAiContentGeneration({ ...scope, generationId: "generation-1", idempotencyKey: "generation-1", outputCount: 1, usageDate: "2026-07-18", dailyGenerationLimit: 10 }))
      .rejects.toThrow("ai_content_generation_not_analysis_ready");

    pool.setGenerationStatus("analysis_ready");
    await repository.startAiContentGeneration({ ...scope, generationId: "generation-1", idempotencyKey: "generation-1", outputCount: 3, usageDate: "2026-07-18", dailyGenerationLimit: 10 });

    await expect(repository.startAiContentGeneration({
      ...scope,
      generationId: "generation-1",
      idempotencyKey: "generation-1",
      outputCount: 3,
      usageDate: "2026-07-18",
      dailyGenerationLimit: 10,
    })).resolves.toMatchObject({ id: "generation-1", status: "analyzing" });

    expect(pool.sql.filter((query) => query.includes("insert into ai_content_generation_outputs")).length).toBe(3);
    expect(pool.sql.filter((query) => query.includes("insert into ai_content_generation_jobs")).length).toBe(2);
    expect(pool.sql.join("\n")).toContain("'finalizeGeneration', true");
    expect(pool.sql.join("\n")).not.toContain("jsonb_build_object('generationId', $1::uuid, 'outputId', $2::uuid)");
    expect(pool.sql.join("\n")).toContain("insert into ai_content_usage_ledger");
  });

  it("requests the first wiki build at final confirmation when owned context is missing", async () => {
    const pool = createPool({ wikiReady: false });
    const repository = createAiContentRepository(pool as never);
    await repository.createAiContentAnalysis({ ...input, draft: { analysisSource: "owned" } });

    const result = await repository.startAiContentGeneration({ ...scope, generationId: "generation-1", idempotencyKey: "generation-wiki", outputCount: 1, usageDate: "2026-07-18", dailyGenerationLimit: 10 });

    expect(pool.sql.join("\n")).toContain("insert into wiki_build_requests");
    expect(pool.sql.join("\n")).toContain("'waitForOwnedContext', $5::boolean");
    expect(result.currentStage).toBe("owned_context");
  });

  it("serializes and rejects a generation that would exceed the daily limit", async () => {
    const pool = createPool({ generationUsage: 9 });
    const repository = createAiContentRepository(pool as never);
    await repository.createAiContentAnalysis(input);
    pool.setGenerationStatus("analysis_ready");

    await expect(repository.startAiContentGeneration({
      ...scope,
      generationId: "generation-1",
      idempotencyKey: "generation-limit",
      outputCount: 2,
      usageDate: "2026-07-18",
      dailyGenerationLimit: 10,
    })).rejects.toThrow("ai_content_limit_reached");
    expect(pool.sql.join("\n")).toContain("pg_advisory_xact_lock");
    expect(pool.commands).toContain("ROLLBACK");
  });

  it("confirms an attachment only for the scoped generation and keeps confirmation idempotent", async () => {
    const pool = createPool();
    const repository = createAiContentRepository(pool as never);
    await repository.createAiContentAnalysis(input);

    const result = await repository.confirmAiContentAttachment({
      ...scope,
      generationId: "generation-1",
      role: "product",
      fileName: "product.png",
      mimeType: "image/png",
      sizeBytes: 100,
      checksum: "a".repeat(64),
      storageUrl: "https://example.public.blob.vercel-storage.com/path",
      storagePath: "brands/brand-1/ai-content/generation-1/attachments/product.png",
    });

    expect(result).toMatchObject({ id: "attachment-1", generationId: "generation-1" });
    expect(pool.sql.join("\n")).toContain("on conflict (generation_id, storage_path) do update");
  });

  it("claims only the requested content type with a recoverable lease", async () => {
    const pool = createWorkerPool();
    const repository = createAiContentRepository(pool as never);
    const job = await repository.claimAiContentJob({ contentType: "card_news", workerId: "card-worker-1", leaseSeconds: 180 });
    expect(job).toMatchObject({ id: "job-1", contentType: "card_news", status: "processing", workerId: "card-worker-1" });
    expect(job?.payload).toMatchObject({ brandContext: { brand: { name: "Growthline" }, wiki: { versionId: "wiki-1" } } });
    expect(pool.sql.join("\n")).toContain("for update skip locked");
    expect(pool.sql.join("\n")).toContain("content_type = $1");
  });

  it("rejects a heartbeat from a different lease owner", async () => {
    const pool = createWorkerPool();
    const repository = createAiContentRepository(pool as never);
    await repository.claimAiContentJob({ contentType: "card_news", workerId: "card-worker-1", leaseSeconds: 180 });
    await expect(repository.heartbeatAiContentJob({ jobId: "job-1", workerId: "wrong-worker", leaseToken: "wrong-token", leaseSeconds: 180 })).resolves.toBe(false);
  });

  it("completes a generated manifest idempotently", async () => {
    const pool = createWorkerPool();
    const repository = createAiContentRepository(pool as never);
    const claimed = await repository.claimAiContentJob({ contentType: "card_news", workerId: "card-worker-1", leaseSeconds: 180 });
    const completion = {
      jobId: "job-1", workerId: "card-worker-1", leaseToken: claimed!.leaseToken!, skillVersion: "card-news-skill.v1", jobType: "generate" as const,
      manifestUrl: "https://blob.example.com/manifest.json",
      manifest: { version: "ai-content.v1" as const, type: "card_news" as const, title: "여름 추천", assets: [{ role: "slide" as const, url: "https://blob.example.com/slide.png", fileName: "slide.png", mimeType: "image/png" as const, width: 1080, height: 1080, index: 1 }], content: { caption: "내용", hashtags: ["여름"], cta: "저장하세요" } },
    };
    const first = await repository.completeAiContentJob(completion);
    const second = await repository.completeAiContentJob(completion);
    expect(first.id).toBe(second.id);
    expect(first.status).toBe("completed");
  });

  it("deletes temporary attachments after every output completes", async () => {
    const pool = createWorkerPool();
    const deleteAttachments = vi.fn(async () => undefined);
    const repository = createAiContentRepository(pool as never, { deleteAttachments });
    const claimed = await repository.claimAiContentJob({ contentType: "card_news", workerId: "card-worker-1", leaseSeconds: 180 });

    await repository.completeAiContentJob({
      jobId: "job-1", workerId: "card-worker-1", leaseToken: claimed!.leaseToken!, skillVersion: "card-news-skill.v3", jobType: "generate",
      manifestUrl: "https://blob.example.com/manifest.json",
      manifest: { version: "ai-content.v1", type: "card_news", title: "여름 추천", assets: [{ role: "slide", url: "https://blob.example.com/slide.png", fileName: "slide.png", mimeType: "image/png", width: 1080, height: 1080, index: 1 }], content: { caption: "내용", hashtags: ["여름"], cta: "저장하세요" } },
    });

    expect(deleteAttachments).toHaveBeenCalledWith(["https://blob.example.com/reference.png"]);
    expect(pool.sql.join("\n")).toContain("update ai_content_generation_attachments");
    expect(pool.sql.join("\n")).toContain("deleted_at = now()");
  });

  it("keeps temporary attachments while another output is pending", async () => {
    const pool = createWorkerPool({ totalOutputs: 2 });
    const deleteAttachments = vi.fn(async () => undefined);
    const repository = createAiContentRepository(pool as never, { deleteAttachments });
    const claimed = await repository.claimAiContentJob({ contentType: "card_news", workerId: "card-worker-1", leaseSeconds: 180 });

    const generation = await repository.completeAiContentJob({
      jobId: "job-1", workerId: "card-worker-1", leaseToken: claimed!.leaseToken!, skillVersion: "card-news-skill.v3", jobType: "generate",
      manifestUrl: "https://blob.example.com/manifest.json",
      manifest: { version: "ai-content.v1", type: "card_news", title: "여름 추천", assets: [{ role: "slide", url: "https://blob.example.com/slide.png", fileName: "slide.png", mimeType: "image/png", width: 1080, height: 1080, index: 1 }], content: { caption: "내용", hashtags: ["여름"], cta: "저장하세요" } },
    });

    expect(generation.status).toBe("generating");
    expect(deleteAttachments).not.toHaveBeenCalled();
  });

  it("rejects an analysis result with fewer than two concrete evidence items", async () => {
    const pool = createWorkerPool({ jobType: "analyze" });
    const repository = createAiContentRepository(pool as never);
    const claimed = await repository.claimAiContentJob({ contentType: "card_news", workerId: "card-worker-1", leaseSeconds: 180 });

    await expect(repository.completeAiContentJob({
      jobId: "job-1",
      workerId: "card-worker-1",
      leaseToken: claimed!.leaseToken!,
      skillVersion: "card-news-skill.v3",
      jobType: "analyze",
      analysisJson: {
        qualityBrief: {
          version: "content-quality.v1",
          hook: "승인 지연의 원인",
          readerPayoff: "승인 병목을 찾습니다",
          whyNow: "발행량이 늘고 있습니다",
          specificClaims: ["담당자 지정", "승인 기한"],
          evidence: [{ claim: "담당자 지정", support: "서비스 페이지의 승인 담당자 설명입니다" }],
          sourceGaps: [],
        },
      },
    })).rejects.toThrow("content_quality_evidence_insufficient");
  });

  it("queues output generation jobs only after the final analysis succeeds", async () => {
    const pool = createWorkerPool({ jobType: "analyze", finalizeGeneration: true, totalOutputs: 2 });
    const repository = createAiContentRepository(pool as never);
    const claimed = await repository.claimAiContentJob({ contentType: "card_news", workerId: "card-worker-1", leaseSeconds: 180 });

    const generation = await repository.completeAiContentJob({
      jobId: "job-1",
      workerId: "card-worker-1",
      leaseToken: claimed!.leaseToken!,
      skillVersion: "card-news-skill.v4",
      jobType: "analyze",
      analysisJson: {
        qualityBrief: {
          version: "content-quality.v1",
          hook: "승인 지연의 원인",
          readerPayoff: "승인 병목을 찾습니다",
          whyNow: "발행량이 늘고 있습니다",
          specificClaims: ["담당자 지정", "승인 기한"],
          evidence: [
            { claim: "담당자 지정", support: "서비스 페이지의 승인 담당자 설명입니다" },
            { claim: "승인 기한", support: "서비스 페이지의 승인 절차 설명입니다" },
          ],
          sourceGaps: [],
        },
      },
    });

    expect(generation.status).toBe("queued");
    expect(pool.sql.filter((query) => query.includes("insert into ai_content_generation_jobs")).length).toBe(2);
    expect(pool.sql.join("\n")).toContain("jsonb_build_object('generationId', $1::uuid, 'outputId', $2::uuid)");
    expect(pool.sql.join("\n")).toContain("jsonb_set(subject_analysis_snapshot, '{message,qualityBrief}'");
  });

  it("bridges a completed scheduled card-news output into the automatic publish queue", async () => {
    const pool = createWorkerPool({ linkedChannelOutput: true, autoApprovalEnabled: true });
    const repository = createAiContentRepository(pool as never);
    const claimed = await repository.claimAiContentJob({ contentType: "card_news", workerId: "card-worker-1", leaseSeconds: 180 });

    await repository.completeAiContentJob({
      jobId: "job-1",
      workerId: "card-worker-1",
      leaseToken: claimed!.leaseToken!,
      skillVersion: "card-news-skill.v6",
      jobType: "generate",
      manifestUrl: "https://blob.example.com/manifest.json",
      manifest: {
        version: "ai-content.v1",
        type: "card_news",
        title: "여름 추천",
        assets: [
          { role: "slide", url: "https://blob.example.com/slide-1.png", fileName: "slide-1.png", mimeType: "image/png", width: 1254, height: 1254, index: 1 },
          { role: "slide", url: "https://blob.example.com/slide-2.png", fileName: "slide-2.png", mimeType: "image/png", width: 1254, height: 1254, index: 2 },
        ],
        content: { caption: "실무 체크리스트", hashtags: ["콘텐츠운영"], cta: "저장해 두세요" },
      },
    });

    const statements = pool.sql.join("\n");
    expect(statements).toContain("insert into storage_artifacts");
    expect(statements).toContain("update channel_outputs");
    expect(statements).toContain("rendered_artifact_id");
    expect(statements).toContain("insert into publish_queue");
    expect(statements).toContain("'auto_approved'");
  });

  it("accepts a top-level quality brief returned by a CLI worker", async () => {
    const pool = createWorkerPool({ jobType: "analyze", finalizeGeneration: true });
    const repository = createAiContentRepository(pool as never);
    const claimed = await repository.claimAiContentJob({ contentType: "card_news", workerId: "card-worker-1", leaseSeconds: 180 });

    await expect(repository.completeAiContentJob({
      jobId: "job-1",
      workerId: "card-worker-1",
      leaseToken: claimed!.leaseToken!,
      skillVersion: "card-news-skill.v5",
      jobType: "analyze",
      analysisJson: {
        version: "content-quality.v1",
        hook: "이동 업무의 불편",
        readerPayoff: "휴대용 마우스 선택 기준을 확인합니다",
        whyNow: "여러 장소와 기기를 오가는 업무가 늘었습니다",
        specificClaims: ["99g 휴대형 크기", "저소음 클릭"],
        evidence: [
          { claimIndex: 1, support: "제품 페이지에서 무게와 규격을 확인했습니다" },
          { claimIndex: 2, support: "제품 페이지에서 저소음 클릭을 확인했습니다" },
        ],
        sourceGaps: [],
      },
    })).resolves.toMatchObject({ status: "queued" });
  });

  it("queues a retryable failure after sixty seconds", async () => {
    const pool = createWorkerPool();
    const repository = createAiContentRepository(pool as never);
    const claimed = await repository.claimAiContentJob({ contentType: "card_news", workerId: "card-worker-1", leaseSeconds: 180 });
    await repository.failAiContentJob({ jobId: "job-1", workerId: "card-worker-1", leaseToken: claimed!.leaseToken!, errorCode: "codex_timeout", errorMessage: "timeout", retryable: true });
    expect(pool.job.status).toBe("queued");
    expect(pool.sql.join("\n")).toContain("interval '60 seconds'");
  });

  it("marks the linked automatic output failed after the final card-news attempt", async () => {
    const pool = createWorkerPool({ linkedChannelOutput: true });
    const repository = createAiContentRepository(pool as never);
    const claimed = await repository.claimAiContentJob({ contentType: "card_news", workerId: "card-worker-1", leaseSeconds: 180 });

    await repository.failAiContentJob({
      jobId: "job-1",
      workerId: "card-worker-1",
      leaseToken: claimed!.leaseToken!,
      errorCode: "image_generation_failed",
      errorMessage: "generation failed",
      retryable: false,
    });

    const statements = pool.sql.join("\n");
    expect(statements).toContain("update channel_outputs");
    expect(statements).toContain("status = 'generation_failed'");
    expect(statements).toContain("ai_content_generation_output_id");
  });

  it("marks the linked automatic output failed when a worker lease is exhausted", async () => {
    const pool = createWorkerPool({ exhaustedJob: true });
    const repository = createAiContentRepository(pool as never);

    await repository.claimAiContentJob({ contentType: "card_news", workerId: "card-worker-1", leaseSeconds: 180 });

    expect(pool.sql.join("\n")).toContain("status = 'generation_failed'");
  });

  it("only retries failed outputs", async () => {
    const pool = createWorkerPool({ outputStatus: "completed" });
    const repository = createAiContentRepository(pool as never);
    await expect(repository.retryAiContentOutput({ ...scope, outputId: "output-1" })).rejects.toThrow("ai_content_output_not_failed");
  });

  it("lists only live generation-scoped subject evidence with loader metadata", async () => {
    const query = vi.fn(async (_sql: string, params: unknown[]) => ({
      rows: [{
        id: "33333333-3333-4333-8333-333333333333",
        workspace_id: params[1],
        brand_id: params[2],
        generation_id: params[0],
        role: "document",
        file_name: "brief.txt",
        mime_type: "text/plain",
        size_bytes: 12,
        checksum: "a".repeat(64),
        storage_url: "https://blob.example/brief.txt",
        storage_path: "brands/brand-1/brief.txt",
        deleted_at: null,
      }],
      rowCount: 1,
    }));
    const repository = createAiContentRepository({ query } as never);

    await expect(repository.listSubjectEvidenceAttachments({
      workspaceId: "workspace-1",
      brandId: "brand-1",
      generationId: "generation-1",
      attachmentIds: ["33333333-3333-4333-8333-333333333333"],
    })).resolves.toEqual([expect.objectContaining({
      id: "33333333-3333-4333-8333-333333333333",
      workspaceId: "workspace-1",
      brandId: "brand-1",
      generationId: "generation-1",
      deletedAt: null,
      checksum: "a".repeat(64),
      storageUrl: "https://blob.example/brief.txt",
      storagePath: "brands/brand-1/brief.txt",
    })]);

    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain("workspace_id = $2");
    expect(sql).toContain("brand_id = $3");
    expect(sql).toContain("generation_id = $1");
    expect(sql).toContain("id = any($4::uuid[])");
    expect(sql).toContain("deleted_at is null");
    expect(params).toEqual([
      "generation-1",
      "workspace-1",
      "brand-1",
      ["33333333-3333-4333-8333-333333333333"],
    ]);
  });

  it.each([
    ["subject-analysis.v1", "researching", "analysis"],
    ["subject-analysis.v2", "analyzing", "analysis"],
    ["subject-analysis.v2", "generating_appeals", "appeal"],
  ] as const)("loads the active %s %s worker lease as %s", async (contractVersion, status, phase) => {
    const query = vi.fn(async (_sql: string, _params: unknown[]) => ({
      rows: [{
        id: "analysis-1",
        contract_version: contractVersion,
        status,
        subject_type: "product",
        attachment_ids_json: ["33333333-3333-4333-8333-333333333333"],
      }],
      rowCount: 1,
    }));
    const repository = createAiContentRepository({ query } as never);

    await expect(repository.getSubjectAnalysisWorkerLease({
      analysisId: "analysis-1",
      workerId: "subject-worker-1",
      leaseToken: "subject-lease-1",
    })).resolves.toEqual({
      analysisId: "analysis-1",
      contractVersion,
      phase,
      subjectType: "product",
      attachmentIds: ["33333333-3333-4333-8333-333333333333"],
    });

    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain("leased_by = $2");
    expect(sql).toContain("lease_token = $3");
    expect(sql).toContain("lease_expires_at > now()");
    expect(sql).toContain("superseded_at is null");
    expect(params).toEqual(["analysis-1", "subject-worker-1", "subject-lease-1"]);
  });
});
