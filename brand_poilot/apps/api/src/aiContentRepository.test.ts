import { describe, expect, it, vi } from "vitest";
import { createAiContentRepository } from "./aiContentRepository.js";
import type { ProposalBaseInputSnapshotV2 } from "./contentOrchestration.js";
import type { AiContentSnapshotRepository } from "./aiContentSnapshotRepository.js";
import { kstDateKey } from "./publishSchedule.js";

describe("maintenance write fence", () => {
  it("checks the database guard as the first statement inside create transaction", async () => {
    const pool = createPool();
    const repository = createAiContentRepository(pool as never);

    await repository.createAiContentAnalysis({
      workspaceId: "workspace-1",
      brandId: "brand-1",
      actorUserId: "actor-1",
      idempotencyKey: "maintenance-order",
      type: "card_news",
      title: "guard order",
      draft: {},
      orchestration: null,
    } as never);

    expect(pool.commands[0]).toBe("BEGIN");
    expect(pool.commands[1]).toBe("select assert_ai_content_writable()");
  });

  it("performs no execution mutation when the transaction guard rejects", async () => {
    const pool = createPool({ maintenanceEnabled: true });
    const repository = createAiContentRepository(pool as never);

    await expect(repository.createAiContentAnalysis({
      workspaceId: "workspace-1",
      brandId: "brand-1",
      actorUserId: "actor-1",
      idempotencyKey: "maintenance-reject",
      type: "card_news",
      title: "blocked",
      draft: {},
      orchestration: null,
    } as never)).rejects.toThrow("ai_content_maintenance");

    expect(pool.sql.some((sql) => /insert|update|delete/i.test(sql))).toBe(false);
  });

  it.each([
    ["proposal-create", (repository: any) => repository.createAiContentProposalBatchV2({ workspaceId: "w", brandId: "b", actorUserId: "u", purpose: "informational", outputFormat: "card_news", channelTarget: "instagram", requestFingerprint: "f".repeat(64), idempotencyKey: "proposal", inputSnapshot: {} })],
    ["proposal-select", (repository: any) => repository.selectAiContentProposal({ workspaceId: "w", brandId: "b", actorUserId: "u", proposalId: "p", idempotencyKey: "select" })],
    ["finalization", (repository: any) => repository.updateAiContentFinalizationDraft({ workspaceId: "w", brandId: "b", generationId: "g", actorUserId: "u", draft: { contractVersion: "content-finalization-draft.v2", avatarStyleImageId: null, userImageInstruction: null, attachmentIds: [] } })],
    ["retry", (repository: any) => repository.retryAiContentOutput({ workspaceId: "w", brandId: "b", outputId: "o" })],
    ["regenerate", (repository: any) => repository.reviseAiContentOutput({ workspaceId: "w", brandId: "b", outputId: "o", action: "regenerate_copy", idempotencyKey: "revision" })],
    ["attachment-confirm", (repository: any) => repository.confirmAiContentAttachment({ workspaceId: "00000000-0000-4000-8000-000000000001", brandId: "00000000-0000-4000-8000-000000000002", generationId: "00000000-0000-4000-8000-000000000003", role: "visual_reference", fileName: "asset.png", mimeType: "image/png", sizeBytes: 1, checksum: "a".repeat(64), storageUrl: "https://blob.example/asset.png", storagePath: "asset.png" })],
    ["attachment-remove", (repository: any) => repository.removeAiContentAttachment({ workspaceId: "00000000-0000-4000-8000-000000000001", brandId: "00000000-0000-4000-8000-000000000002", generationId: "00000000-0000-4000-8000-000000000003", attachmentId: "00000000-0000-4000-8000-000000000004" })],
    ["internal-claim", (repository: any) => repository.claimAiContentJob({ contentType: "card_news", workerId: "worker", leaseSeconds: 60 })],
    ["render-claim", (repository: any) => repository.claimAiContentRenderJob({ workerId: "worker", leaseSeconds: 60 })],
    ["internal-complete", (repository: any) => repository.completeAiContentJob({ jobId: "j", workerId: "worker", leaseToken: "token", jobType: "analyze", analysis: {} })],
  ] as const)("puts BEGIN then the common guard before any %s mutation", async (_label, invoke) => {
    const commands: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        commands.push(sql);
        if (sql === "select assert_ai_content_writable()") throw new Error("ai_content_maintenance");
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const repository = createAiContentRepository({ connect: async () => client, query: client.query } as never);

    await expect(invoke(repository)).rejects.toThrow("ai_content_maintenance");

    expect(commands.slice(0, 2)).toEqual(["BEGIN", "select assert_ai_content_writable()"]);
    expect(commands.slice(2).filter((sql) => /\b(?:insert|update|delete)\b/i.test(sql))).toEqual([]);
  });

  it.each([
    ["legacy-start", false],
    ["v3-start", true],
  ] as const)("guards the %s owning transaction after read-only preflight", async (_label, v3) => {
    const transactionCommands: string[] = [];
    const initial = { ...row("g", v3 ? "draft" : "analysis_ready"), draft_json: v3 ? { origin: "proposal-v2", proposalId: "p" } : {} };
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from workspace_members")) return { rows: [{ ok: 1 }], rowCount: 1 };
        if (sql.includes("from ai_content_generations")) return { rows: [initial], rowCount: 1 };
        if (sql.includes("from ai_content_proposals")) return { rows: [{ proposal_id: "p", batch_id: "batch" }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
      connect: vi.fn(async () => ({
        query: vi.fn(async (sql: string) => {
          transactionCommands.push(sql);
          if (sql === "select assert_ai_content_writable()") throw new Error("ai_content_maintenance");
          return { rows: [], rowCount: 0 };
        }),
        release: vi.fn(),
      })),
    };
    const repository = createAiContentRepository(pool as never);
    const scope = { workspaceId: "w", brandId: "b", generationId: "g", actorUserId: "u", idempotencyKey: "start", usageDate: "2026-08-05", dailyGenerationLimit: 10 };

    await expect(v3
      ? repository.startAiContentGenerationV3({ ...scope, requestFingerprint: "f".repeat(64) } as never, {} as never)
      : repository.startAiContentGeneration(scope as never)).rejects.toThrow("ai_content_maintenance");

    expect(transactionCommands.slice(0, 2)).toEqual(["BEGIN", "select assert_ai_content_writable()"]);
    expect(transactionCommands.slice(2).filter((sql) => /\b(?:insert|update|delete)\b/i.test(sql))).toEqual([]);
  });
});

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
    generation_input_snapshot: null,
    subject_analysis_snapshot: null,
    attachments_locked_at: null as string | null,
    terminal_at: null as string | null,
    retryable_until: null as string | null,
    error_code: null,
    error_message: null,
    created_at: "2026-07-18T00:00:00.000Z",
    updated_at: "2026-07-18T00:00:00.000Z",
    completed_at: null,
  };
}

function createPool(options: {
  missingReferences?: boolean;
  generationUsage?: number;
  wikiReady?: boolean;
  attachmentCount?: number;
  activeAttachmentPaths?: string[];
  lifecycleEvents?: string[];
  attachmentsLocked?: boolean;
  maintenanceEnabled?: boolean;
} = {}) {
  const commands: string[] = [];
  const sql: string[] = [];
  const referenceSnapshots: Array<Record<string, unknown>> = [];
  let generationInsertParams: unknown[] = [];
  let analyzeJobInsertCount = 0;
  let generation = row("generation-1");
  if (options.attachmentsLocked) {
    generation = { ...generation, attachments_locked_at: "2026-07-27T00:00:00.000Z" };
  }
  let analysisCreated = false;
  let activeAttachmentCount = options.attachmentCount ?? 0;

  const client = {
    query: async (query: string, params: unknown[] = []) => {
      commands.push(query);
      sql.push(query);
      if (query === "BEGIN" || query === "COMMIT" || query === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (query === "select assert_ai_content_writable()" && options.maintenanceEnabled) {
        throw new Error("ai_content_maintenance");
      }
      if (query.includes("from workspace_members member")) return { rows: [{ ok: 1 }], rowCount: 1 };
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
        generationInsertParams = [...params];
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
      if (
        query.includes("update ai_content_generation_attachments")
        && query.includes("physical_delete_status = 'pending'")
        && query.includes("returning *")
      ) {
        activeAttachmentCount = Math.max(0, activeAttachmentCount - 1);
        return {
          rows: [{
            id: params[0],
            generation_id: params[1],
            workspace_id: params[2],
            brand_id: params[3],
            upload_session_id: "50000000-0000-4000-8000-000000000001",
            role: "product",
            file_name: "product.png",
            mime_type: "image/png",
            size_bytes: 100,
            checksum: "a".repeat(64),
            storage_url: "https://example.public.blob.vercel-storage.com/product.png",
            storage_path: "reserved/product.png",
            created_at: "2026-07-18T00:00:00.000Z",
          }],
          rowCount: 1,
        };
      }
      if (
        query.includes("update ai_content_generation_attachments")
        && query.includes("deleted_at = now()")
        && query.includes("returning id")
      ) {
        activeAttachmentCount = Math.max(0, activeAttachmentCount - 1);
        return { rows: [{ id: params[3] }], rowCount: 1 };
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
      if (
        query.includes("select id")
        && query.includes("from ai_content_generation_attachments")
        && query.includes("storage_path = $4")
        && query.includes("deleted_at is null")
      ) {
        const active = options.activeAttachmentPaths?.includes(String(params[3])) ?? false;
        return { rows: active ? [{ id: "attachment-1" }] : [], rowCount: active ? 1 : 0 };
      }
      if (query.includes("count(*)::integer as attachment_count") && query.includes("from ai_content_generation_attachments")) {
        return { rows: [{ attachment_count: activeAttachmentCount }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release: () => { options.lifecycleEvents?.push("release"); },
  };

  return {
    connect: async () => client,
    query: client.query,
    commands,
    sql,
    get analyzeJobInsertCount() { return analyzeJobInsertCount; },
    get referenceSnapshots() { return referenceSnapshots; },
    get generationInsertParams() { return generationInsertParams; },
    setGenerationStatus(status: string) { generation = { ...generation, status }; },
    setGenerationDraft(draft: Record<string, unknown>) {
      generation = {
        ...generation,
        draft_json: {
          ...draft,
          productUrl: typeof draft.productUrl === "string" ? draft.productUrl : "",
        },
      };
    },
    setGenerationIdempotencyKey(idempotencyKey: string | null) {
      generation = { ...generation, generation_idempotency_key: idempotencyKey };
    },
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
  completedOutputs?: number;
  attachmentUrls?: string[];
  manifestAssetUrls?: string[];
  subjectAnalysisSnapshot?: Record<string, unknown>;
  qualityBrief?: Record<string, unknown>;
  priorGeneratePayload?: Record<string, unknown>;
  outputManifest?: Record<string, unknown>;
  outputContent?: Record<string, unknown>;
  existingRevisionIdempotencyKey?: string;
  revision?: Record<string, unknown>;
  retryable?: boolean;
  retryBoundary?: "before" | "equal" | "after";
  deletionStatus?: "deleting" | "deleted" | null;
  finalInputV3?: Record<string, unknown>;
  existingPlan?: Record<string, unknown> | null;
  generationId?: string;
  outputId?: string;
} = {}) {
  const sql: string[] = [];
  const generatedJobPayloads: unknown[] = [];
  const completedOutputManifests: Record<string, unknown>[] = [];
  const completedOutputContents: Record<string, unknown>[] = [];
  let leaseAtBoundary = false;
  let generation = row(options.generationId ?? "generation-1", options.jobType === "analyze" ? "analyzing" : "generating");
  let pendingCleanup = false;
  let outputStatus = options.outputStatus ?? "generating";
  let storedPlan = options.existingPlan ?? null;
  const job: Record<string, unknown> = {
    id: "job-1", generation_id: options.generationId ?? "generation-1", output_id: options.jobType === "analyze" ? null : options.outputId ?? "output-1",
    workspace_id: "workspace-1", brand_id: "brand-1", job_type: options.jobType ?? "generate", content_type: "card_news",
    status: options.exhaustedJob ? "processing" : "queued", payload_json: {
      ...(options.finalizeGeneration ? { finalizeGeneration: true } : {}),
      contentGenerationInput: structuredClone(options.subjectAnalysisSnapshot ?? contentGenerationInputV2Fixture),
      ...(options.revision ? { revision: structuredClone(options.revision) } : {}),
    }, attempt_count: options.exhaustedJob ? 3 : 0, max_attempts: 3, available_at: new Date("2026-07-18T00:00:00.000Z"),
    worker_id: options.exhaustedJob ? "expired-worker" : null,
    lease_token: options.exhaustedJob ? "expired-token" : null,
    lease_expires_at: options.exhaustedJob ? new Date("2026-07-17T00:00:00.000Z") : null,
  };
  const client = {
    query: async (query: string, params: unknown[] = []) => {
      sql.push(query);
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(query)) return { rows: [], rowCount: 0 };
      if (query.includes("select terminal_generation.id")) return pendingCleanup ? { rows: [{ id: "generation-1" }], rowCount: 1 } : { rows: [], rowCount: 0 };
      if (
        query.includes("select id")
        && query.includes("from ai_content_generation_jobs")
        && query.includes("attempt_count >= max_attempts")
      ) {
        return options.exhaustedJob
          ? { rows: [{ id: "job-1" }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (
        query.includes("update ai_content_generation_jobs")
        && query.includes("ai_content_job_lease_exhausted")
        && query.includes("where id = $1")
      ) {
        Object.assign(job, {
          status: "failed",
          worker_id: null,
          lease_token: null,
          lease_expires_at: null,
          error_code: "ai_content_job_lease_exhausted",
        });
        return { rows: [], rowCount: 1 };
      }
      if (
        query.includes("select id")
        && query.includes("from ai_content_generation_jobs")
        && query.includes("attempt_count < max_attempts")
        && query.includes("lease_expires_at <= clock_timestamp()")
      ) {
        return { rows: [], rowCount: 0 };
      }
      if (
        query.includes("select job.id")
        && query.includes("from ai_content_generation_jobs job")
        && query.includes("limit 25")
      ) {
        return job.status === "queued"
          ? { rows: [{ id: job.id }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (
        query.includes("update ai_content_generation_jobs")
        && query.includes("status = 'processing'")
        && query.includes("returning *")
      ) {
        if (job.status !== "queued") return { rows: [], rowCount: 0 };
        Object.assign(job, {
          status: "processing",
          worker_id: params[1],
          lease_token: params[2],
          lease_expires_at: new Date("2099-07-18T00:03:00.000Z"),
          attempt_count: Number(job.attempt_count) + 1,
        });
        return { rows: [{ ...job }], rowCount: 1 };
      }
      if (query.includes("from brands brand")) {
        return { rows: [{ name: "Growthline", forbidden_terms: [], owned_url: "https://example.com", source_status: "crawled", last_crawled_at: "2026-07-18T00:00:00.000Z" }], rowCount: 1 };
      }
      if (query.includes("from wiki_versions version")) {
        return { rows: [{ id: "wiki-1", wiki_updated_at: "2026-07-18T00:10:00.000Z", pages: [{ type: "brand_overview", title: "브랜드 개요", summary: "자사 분석", content: "브랜드 근거", structuredData: {} }] }], rowCount: 1 };
      }
      if (query.includes("from ai_content_generation_input_snapshots") && query.includes("contract_version")) {
        return options.finalInputV3 ? { rows: [{ contract_version: "content-generation-input.v3" }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (query.includes("from ai_content_generation_input_snapshots") && query.includes("input_json")) {
        return options.finalInputV3 ? { rows: [{ input_json: structuredClone(options.finalInputV3) }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (query.includes("select plan_json from ai_content_generation_outputs")) {
        return { rows: [{ plan_json: storedPlan }], rowCount: 1 };
      }
      if (query.includes("update ai_content_generation_outputs") && query.includes("plan_json=coalesce")) {
        storedPlan ??= JSON.parse(String(params[1]));
        outputStatus = "generating";
        return { rows: [], rowCount: 1 };
      }
      if (query.includes("select generation.draft_json")) return { rows: [{ draft_json: {}, analysis_json: options.qualityBrief ? { qualityBrief: options.qualityBrief } : {}, subject_analysis_snapshot: options.subjectAnalysisSnapshot ?? null, generation_title: "여름 추천", generation_type: "card_news", output_index: 1, reference_snapshots: [], attachments: [] }], rowCount: 1 };
      if (
        query.includes("select id")
        && query.includes("from ai_content_generation_jobs")
        && query.includes("worker_id = $2")
        && query.includes("for update")
      ) {
        const valid = job.status === "processing"
          && job.worker_id === params[1]
          && job.lease_token === params[2];
        return { rows: valid ? [{ id: job.id }] : [], rowCount: valid ? 1 : 0 };
      }
      if (query.includes("set (lease_expires_at, last_heartbeat_at)")) {
        const valid = job.status === "processing" && job.worker_id === params[1] && job.lease_token === params[2];
        return { rows: valid ? [{ id: job.id }] : [], rowCount: valid ? 1 : 0 };
      }
      if (
        query.includes("from ai_content_generation_jobs")
        && query.includes("output_id = $1")
        && query.includes("job_type = 'generate'")
        && query.includes("select payload_json")
      ) {
        return options.priorGeneratePayload
          ? { rows: [{ payload_json: structuredClone(options.priorGeneratePayload) }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (query.includes("from ai_content_generations") && query.includes("retryable_until > transaction_timestamp()")) {
        const retryable = options.retryBoundary
          ? options.retryBoundary === "before"
          : options.retryable ?? true;
        return {
          rows: [{
            ...generation,
            terminal_at: "2026-07-18T00:00:00.000Z",
            retryable_until: options.retryBoundary === "after"
              ? "2026-08-01T23:59:59.999Z"
              : "2026-08-02T00:00:00.000Z",
            retryable,
          }],
          rowCount: 1,
        };
      }
      if (query.includes("from ai_content_attachment_deletion_jobs") && query.includes("for update")) {
        return options.deletionStatus
          ? { rows: [{ status: options.deletionStatus }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (
        query.includes("select generation_id, output_id")
        && query.includes("from ai_content_generation_jobs")
        && query.includes("where id = $1")
      ) {
        return {
          rows: [{ generation_id: job.generation_id, output_id: job.output_id }],
          rowCount: 1,
        };
      }
      if (
        query.includes("select id")
        && query.includes("from ai_content_generations")
        && query.includes("for update")
      ) {
        return { rows: [{ id: "generation-1" }], rowCount: 1 };
      }
      if (
        query.includes("select id, generation_id")
        && query.includes("from ai_content_generation_outputs")
        && query.includes("for update")
      ) {
        return {
          rows: [{ id: job.output_id, generation_id: job.generation_id }],
          rowCount: 1,
        };
      }
      if (query.includes("select *") && query.includes("from ai_content_generation_jobs")) {
        return {
          rows: [{
            ...job,
            lease_expired: leaseAtBoundary
              || (options.exhaustedJob && job.status === "processing"),
            available: true,
          }],
          rowCount: 1,
        };
      }
      if (query.includes("as generation_input_snapshot") && query.includes("from ai_content_generations")) {
        return {
          rows: [{ generation_input_snapshot: options.subjectAnalysisSnapshot ?? contentGenerationInputV2Fixture }],
          rowCount: 1,
        };
      }
      if (query.includes("select generation_input_snapshot") && query.includes("from ai_content_generations")) {
        return {
          rows: [{
            generation_input_snapshot: options.subjectAnalysisSnapshot ?? contentGenerationInputV2Fixture,
            analysis_json: options.qualityBrief ? { qualityBrief: options.qualityBrief } : {},
          }],
          rowCount: 1,
        };
      }
      if (query.includes("set analysis_json")) {
        generation = { ...generation, status: String(params[2]), current_stage: String(params[3]), analysis_json: JSON.parse(String(params[1])) };
        return { rows: [], rowCount: 1 };
      }
      if (query.includes("update ai_content_generation_outputs") && query.includes("status = 'completed'")) {
        outputStatus = "completed";
        completedOutputContents.push(JSON.parse(String(params[2])));
        completedOutputManifests.push(JSON.parse(String(params[3])));
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
      if (query.includes("count(*)::integer as total")) return { rows: [{ total: options.totalOutputs ?? 1, completed: options.completedOutputs ?? (outputStatus === "completed" ? 1 : 0), failed: outputStatus === "failed" ? 1 : 0 }], rowCount: 1 };
      if (query.includes("update ai_content_generations") && query.includes("completed_at = case")) {
        const wasTerminal = ["completed", "partial_failed", "failed"].includes(
          String(generation.status),
        );
        const becomesTerminal = params[3] === true;
        generation = {
          ...generation,
          status: String(params[1]),
          ...(becomesTerminal && !wasTerminal
            ? {
                terminal_at: "2026-07-18T00:00:00.000Z",
                retryable_until: "2026-08-02T00:00:00.000Z",
              }
            : {}),
        };
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
      if (
        query.includes("select generation_id")
        && query.includes("from ai_content_generation_outputs")
        && !query.includes("for update")
      ) {
        return {
          rows: [{ generation_id: "generation-1" }],
          rowCount: 1,
        };
      }
      if (query.includes("from ai_content_generation_outputs output") && query.includes("for update of output")) {
        return { rows: [{
          id: "output-1",
          generation_id: "generation-1",
          workspace_id: "workspace-1",
          brand_id: "brand-1",
          status: outputStatus,
          type: "card_news",
          artifact_manifest_json: options.outputManifest ?? {},
          content_json: options.outputContent ?? {},
        }], rowCount: 1 };
      }
      if (
        query.includes("from ai_content_generation_jobs")
        && query.includes("payload_json #>> '{revision,idempotencyKey}'")
      ) {
        return options.existingRevisionIdempotencyKey === params[3]
          ? { rows: [{ id: "revision-job-1" }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (
        query.includes("from ai_content_generation_jobs")
        && query.includes("status in ('queued', 'processing')")
      ) {
        return { rows: [], rowCount: 0 };
      }
      if (query.includes("update ai_content_generation_outputs") && query.includes("set status = 'queued'")) {
        outputStatus = "queued";
        return { rows: [], rowCount: 1 };
      }
      if (query.includes("insert into ai_content_generation_jobs")) {
        if (query.includes("'generate'")) {
          const payload = params[5]
            ? JSON.parse(String(params[5]))
            : {
                generationId: params[0],
                outputId: params[1],
                contentGenerationInput: structuredClone(
                  options.subjectAnalysisSnapshot ?? contentGenerationInputV2Fixture,
                ),
              };
          generatedJobPayloads.push(payload);
          Object.assign(job, { payload_json: payload, status: "queued" });
        }
        return { rows: [], rowCount: 1 };
      }
      if (query.includes("update ai_content_generations") && query.includes("set status = 'queued'")) {
        generation = { ...generation, status: "queued" };
        return { rows: [], rowCount: 1 };
      }
      if (query.includes("from ai_content_generations where id = $1")) return { rows: [generation], rowCount: 1 };
      if (query.includes("select manifest_url, artifact_manifest_json") && query.includes("from ai_content_generation_outputs")) {
        const urls = options.manifestAssetUrls ?? [];
        return {
          rows: urls.length ? [{ manifest_url: "https://blob.example.com/manifest.json", artifact_manifest_json: { assets: urls.map((url) => ({ url })) } }] : [],
          rowCount: urls.length ? 1 : 0,
        };
      }
      if (query.includes("from ai_content_generation_attachments") && query.includes("deleted_at is null")) {
        const urls = options.attachmentUrls ?? ["https://blob.example.com/reference.png"];
        return { rows: urls.map((storage_url, index) => ({ id: `attachment-${index + 1}`, storage_url })), rowCount: urls.length };
      }
      if (query.includes("update ai_content_generation_attachments") && query.includes("deleted_at = now()")) {
        return { rows: [], rowCount: 1 };
      }
      if (query.includes("set status = 'generating'")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release: () => undefined,
  };
  return {
    connect: async () => client,
    query: client.query,
    sql,
    job,
    generatedJobPayloads,
    completedOutputManifests,
    completedOutputContents,
    expireLeaseAtBoundary() { leaseAtBoundary = true; },
    enablePendingCleanup() { pendingCleanup = true; },
  };
}

const scope = {
  workspaceId: "workspace-1",
  brandId: "brand-1",
  actorUserId: "10000000-0000-4000-8000-000000000001",
};
const input = {
  ...scope,
  type: "card_news" as const,
  title: "여름 추천",
  draft: { productUrl: "https://example.com/product" },
  idempotencyKey: "analysis-key-1",
};
const contentGenerationInputV2Fixture = {
  contractVersion: "content-generation-input.v2" as const,
  contentType: "card_news" as const,
  brandContext: {},
  subject: {
    analysisId: "analysis-1",
    analysisVersion: 1,
    analysisContractVersion: "subject-analysis.v1" as const,
    analysisResult: null,
    type: "product" as const,
    sourceUrl: "",
    facts: [],
    research: {},
    selectedImages: [],
  },
  message: {
    target: { id: "target-1", name: "타깃" },
    appeal: { id: "appeal-1", targetId: "target-1", title: "소구점" },
    qualityBrief: { hook: "사용자 입력" },
  },
  creativeDirection: {
    prompts: [],
    brandColor: "",
    selectedColor: "#0057B8",
    aspectRatio: "1:1" as const,
    outputCount: 1 as const,
  },
  references: [],
  attachments: [],
};

const v3GenerationId = "30000000-0000-4000-8000-000000000009";
const v3OutputId = "40000000-0000-4000-8000-000000000009";
const v3EvidenceId = "50000000-0000-4000-8000-000000000009";
const v3FinalInputFixture = {
  contractVersion: "content-generation-input.v3",
  generationId: v3GenerationId,
  brandCore: {
    versionId: "60000000-0000-4000-8000-000000000009",
    companyOverview: "Company", businessDescription: "Description", primaryCategory: "Food",
    detailedCategory: "Tea", primaryTarget: "Adults", differentiator: "Direct", coreAppeal: "Calm",
  },
  subject: { kind: "topic_text", title: "Tea" }, contentInstruction: null, product: null,
  researchEvidence: {
    contractVersion: "research-evidence.v1", decision: "searched", reason: "Needed", queries: ["tea"],
    capturedAt: "2026-07-31T00:00:00.000Z",
    items: [{
      id: v3EvidenceId, title: "Study", url: "https://source.example/study", publisher: "Source",
      publishedAt: "2026-07-31T00:00:00.000Z", capturedAt: "2026-07-31T00:00:00.000Z",
      claimSummary: "Claim", contentHash: "a".repeat(64),
    }],
  },
  references: { selected: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [] },
  selectedProposal: {
    id: "70000000-0000-4000-8000-000000000009", conceptKey: "tea-guide", title: "Tea guide",
    informationalType: "how_to", oneLineIntent: "Teach", differentiator: "Simple",
    differentiationAxes: ["target"], target: "Adults", customerContext: "Choosing tea",
    keyMessage: "Tea helps", hook: "Try tea", selectionReason: "Useful", evidenceIds: [v3EvidenceId],
    referenceIds: [], outputFormat: "card_news", channelTargets: ["instagram"], assetCount: 1,
    outline: [{ index: 1, role: "cover", headline: "Tea", purpose: "Introduce" }],
    purposeDetails: { kind: "informational", question: "Which tea?", value: "Clarity", whyNow: "Summer", learningPoints: ["Choose tea"] },
  },
  userImageInstruction: null,
  outputSettings: { outputFormat: "card_news", channelTargets: ["instagram"], aspectRatio: "1:1", outputCount: 1, purpose: "informational" },
  capturedAt: "2026-07-31T00:00:00.000Z",
};

const v3CardPlanFixture = {
  contractVersion: "card-news-plan.v2",
  content: { caption: "Tea", hashtags: ["#tea"], cta: "Read" },
  imagePackage: {
    contractVersion: "image-generation-package.v1", generationId: v3GenerationId,
    outputFormat: "card_news", purpose: "informational", assetCount: 1, aspectRatio: "1:1",
    channelTargets: ["instagram"],
    assets: [{ index: 1, role: "cover", copy: "Tea facts", visualDirection: "Editorial tea", evidenceIds: [], productImageAssetIds: [], attachmentIds: [] }],
    product: null, references: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [], userImageInstruction: null,
    logoPolicy: { allowGeneratedLogo: false, allowReservedLogoArea: false, allowExternalReferenceLogo: false, allowExistingProductPackagingLogo: true },
  },
};

describe("AI content repository", () => {
  it("rejects repository writes when the authenticated actor is missing", async () => {
    const pool = createPool();
    const repository = createAiContentRepository(pool as never);
    const { actorUserId: _actorUserId, ...missingActor } = input;

    await expect(repository.createAiContentAnalysis(missingActor as never))
      .rejects.toThrow("ai_content_actor_required");
  });

  it("validates the actor before returning an idempotent start replay", async () => {
    const pool = createPool();
    const repository = createAiContentRepository(pool as never);
    await repository.createAiContentAnalysis(input);
    pool.setGenerationIdempotencyKey("same-start");

    await expect(repository.startAiContentGeneration({
      workspaceId: scope.workspaceId,
      brandId: scope.brandId,
      generationId: "generation-1",
      idempotencyKey: "same-start",
      outputCount: 1,
      usageDate: "2026-07-28",
      dailyGenerationLimit: 10,
    } as never)).rejects.toThrow("ai_content_actor_required");
  });

  it("validates the actor before looking up a generation to start", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = createAiContentRepository({ query } as never);

    await expect(repository.startAiContentGeneration({
      workspaceId: scope.workspaceId,
      brandId: scope.brandId,
      generationId: "missing-generation",
      idempotencyKey: "missing-start",
      outputCount: 1,
      usageDate: "2026-07-28",
      dailyGenerationLimit: 10,
    } as never)).rejects.toThrow("ai_content_actor_required");
    expect(query).not.toHaveBeenCalled();
  });

  it("creates a proposal batch and job atomically from owned completed snapshots", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        statements.push({ sql, params });
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
        if (sql.includes("from workspace_members member")) return { rows: [{ ok: 1 }], rowCount: 1 };
        if (sql.includes("from source_urls source") && sql.includes("source_snapshots")) {
          return {
            rows: [{
              id: "90000000-0000-4000-8000-000000000009",
              source_url_id: "91000000-0000-4000-8000-000000000009",
              url: "https://example.com/article",
              fetched_at: "2026-07-28T00:00:00.000Z",
              content_hash: "a".repeat(64),
              summary: "stored summary",
            }],
            rowCount: 1,
          };
        }
        if (sql.includes("from content_performance_snapshots performance")) {
          return { rows: [{ id: "92000000-0000-4000-8000-000000000009", snapshot_date: "2026-07-27", raw_metrics: { likes: 10 }, collected_at: "2026-07-28T00:00:00.000Z" }], rowCount: 1 };
        }
        if (sql.includes("insert into source_crawl_runs")) return { rows: [], rowCount: 0 };
        if (sql.includes("insert into ai_content_proposal_batches")) {
          return {
            rows: [{
              id: "93000000-0000-4000-8000-000000000009",
              workspace_id: scope.workspaceId,
              brand_id: scope.brandId,
              origin: "manual",
              content_family: "informational",
              request_json: JSON.parse(String(params[4])),
              source_snapshot_json: JSON.parse(String(params[5])),
              status: "queued",
              error_code: null,
              error_message: null,
              created_at: "2026-07-28T00:00:00.000Z",
              updated_at: "2026-07-28T00:00:00.000Z",
            }],
            rowCount: 1,
          };
        }
        if (sql.includes("insert into ai_content_proposal_jobs")) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const repository = createAiContentRepository({ connect: async () => client, query: client.query } as never);

    const batch = await repository.createAiContentProposalBatch({
      ...scope,
      actorUserId: "10000000-0000-4000-8000-000000000001",
      origin: "manual",
      idempotencyKey: "proposal-batch-1",
      request: {
        contractVersion: "content-proposal-request.v1",
        contentFamily: "informational",
        subjectInput: { topic: "여름 관리" },
        channelTargets: ["blog_export"],
        outputFormats: ["blog"],
        sourceSnapshotIds: ["90000000-0000-4000-8000-000000000009"],
        performanceSnapshotIds: ["92000000-0000-4000-8000-000000000009"],
      },
    });

    expect(batch).toMatchObject({ status: "queued", sourceSnapshots: [{ sourceId: "90000000-0000-4000-8000-000000000009" }] });
    expect(statements.some(({ sql }) => sql.includes("insert into ai_content_proposal_jobs"))).toBe(true);
    expect(statements.map(({ sql }) => sql)).toEqual(expect.arrayContaining(["BEGIN", "COMMIT"]));
  });

  it("selects under the database batch lock and links one generation draft", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: vi.fn(async (query: string, params: unknown[] = []) => {
        statements.push({ sql: query, params });
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(query)) return { rows: [], rowCount: 0 };
        if (query.includes("from workspace_members member")) return { rows: [{ ok: 1 }], rowCount: 1 };
        if (query.includes("select select_ai_content_proposal")) return { rows: [{ selected: params[0] }], rowCount: 1 };
        if (query.includes("from ai_content_proposals proposal") && query.includes("join ai_content_proposal_batches")) {
          return { rows: [{
            id: params[0], batch_id: "71000000-0000-4000-8000-000000000007",
            proposal_json: {
              title: "선택 제안", outputFormat: "card_news",
              purposeDetails: { kind: "informational" },
            },
            purpose: "informational", input_snapshot_json: proposalBaseInputV2,
          }], rowCount: 1 };
        }
        if (query.includes("insert into ai_content_generations")) return { rows: [row("generation-1", "draft")], rowCount: 1 };
        if (query.includes("update ai_content_proposals")) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const repository = createAiContentRepository({ connect: async () => client, query: client.query } as never);

    const selected = await repository.selectAiContentProposal({
      ...scope,
      proposalId: "70000000-0000-4000-8000-000000000007",
      actorUserId: "10000000-0000-4000-8000-000000000001",
      idempotencyKey: "select-1",
    });

    expect(selected.status).toBe("draft");
    expect(statements.map(({ sql }) => sql).join("\n")).toContain("select_ai_content_proposal");
    expect(statements.map(({ sql }) => sql).join("\n")).not.toContain("ai_content_approved_proposal_versions");
    expect(statements.map(({ sql }) => sql).join("\n")).not.toContain("ai_content_generation_references");
    const generationInsert = statements.find(({ sql }) => sql.includes("insert into ai_content_generations"));
    expect(generationInsert?.sql).not.toMatch(/\btype\b|content_family/);
    expect(generationInsert?.params.slice(-3)).toEqual([null, null, "10000000-0000-4000-8000-000000000001"]);
  });

  it("returns an existing linked draft only for the same locked idempotent selection", async () => {
    const statements: string[] = [];
    const proposalId = "70000000-0000-4000-8000-000000000007";
    const batchId = "71000000-0000-4000-8000-000000000007";
    const existing = {
      ...row("generation-1", "draft"),
      output_format: "card_news",
      purpose: "informational",
      analysis_idempotency_key: `proposal-v2:${batchId}:${proposalId}:select-1`,
      draft_json: {
        origin: "proposal-v2", proposalBatchId: batchId, proposalId,
        finalization: {
          contractVersion: "content-finalization-draft.v2", avatarStyleImageId: null,
          userImageInstruction: null, attachmentIds: [],
        },
      },
    };
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        statements.push(sql);
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
        if (sql.includes("from workspace_members member")) return { rows: [{ ok: 1 }], rowCount: 1 };
        if (sql.includes("select select_ai_content_proposal")) return { rows: [{ selected: params[0] }], rowCount: 1 };
        if (sql.includes("from ai_content_proposals proposal") && sql.includes("join ai_content_proposal_batches")) {
          return {
            rows: [{
              id: proposalId,
              batch_id: batchId,
              proposal_json: { title: "선택 제안", outputFormat: "card_news", purposeDetails: { kind: "informational" } },
              generation_id: "generation-1",
              purpose: "informational",
              input_snapshot_json: proposalBaseInputV2,
            }],
            rowCount: 1,
          };
        }
        if (sql.includes("from ai_content_generations")) return { rows: [existing], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const repository = createAiContentRepository({ connect: async () => client, query: client.query } as never);

    await expect(repository.selectAiContentProposal({
      ...scope,
      proposalId,
      idempotencyKey: "select-1",
    })).resolves.toMatchObject({ id: "generation-1", status: "draft" });
    expect(statements.some((sql) => sql.includes("from ai_content_generations")
      && sql.includes("for update"))).toBe(true);
  });

  it.each([
    ["different selection key", "draft", "proposal-v2:71000000-0000-4000-8000-000000000007:70000000-0000-4000-8000-000000000007:other-key", "70000000-0000-4000-8000-000000000007"],
    ["different proposal", "draft", "proposal-v2:71000000-0000-4000-8000-000000000007:80000000-0000-4000-8000-000000000008:select-1", "80000000-0000-4000-8000-000000000008"],
    ["failed generation", "failed", "proposal-v2:71000000-0000-4000-8000-000000000007:70000000-0000-4000-8000-000000000007:select-1", "70000000-0000-4000-8000-000000000007"],
  ])("rejects an existing linked generation for a %s", async (_label, status, identity, draftProposalId) => {
    const proposalId = "70000000-0000-4000-8000-000000000007";
    const batchId = "71000000-0000-4000-8000-000000000007";
    const existing = {
      ...row("generation-1", status),
      output_format: "card_news",
      purpose: "informational",
      analysis_idempotency_key: identity,
      draft_json: {
        origin: "proposal-v2", proposalBatchId: batchId, proposalId: draftProposalId,
        finalization: {
          contractVersion: "content-finalization-draft.v2", avatarStyleImageId: null,
          userImageInstruction: null, attachmentIds: [],
        },
      },
    };
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
        if (sql.includes("from workspace_members member")) return { rows: [{ ok: 1 }], rowCount: 1 };
        if (sql.includes("select select_ai_content_proposal")) return { rows: [{ selected: params[0] }], rowCount: 1 };
        if (sql.includes("from ai_content_proposals proposal") && sql.includes("join ai_content_proposal_batches")) {
          return {
            rows: [{
              id: proposalId,
              batch_id: batchId,
              proposal_json: { title: "선택 제안", outputFormat: "card_news", purposeDetails: { kind: "informational" } },
              generation_id: "generation-1",
              purpose: "informational",
              input_snapshot_json: proposalBaseInputV2,
            }],
            rowCount: 1,
          };
        }
        if (sql.includes("from ai_content_generations")) return { rows: [existing], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const repository = createAiContentRepository({ connect: async () => client, query: client.query } as never);

    await expect(repository.selectAiContentProposal({
      ...scope,
      proposalId,
      idempotencyKey: "select-1",
    })).rejects.toThrow("ai_content_proposal_selection_conflict");
  });

  it.each([
    ["brand_topic", { mode: "brand_topic", topic: "여름 관리" }, null],
    ["product_service", { mode: "product_service", productServiceId: "60000000-0000-4000-8000-000000000006" }, "60000000-0000-4000-8000-000000000006"],
    ["new_subject", { mode: "new_subject", subjectAnalysisId: "70000000-0000-4000-8000-000000000007" }, null],
  ])("persists %s canonical subject columns while updating a locked draft", async (mode, subject, productServiceId) => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const generation = row("generation-1", "draft");
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        statements.push({ sql, params });
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
        if (sql.includes("from workspace_members member")) return { rows: [{ ok: 1 }], rowCount: 1 };
        if (sql.includes("from ai_content_generations") && sql.includes("for update")) return { rows: [generation], rowCount: 1 };
        if (sql.includes("update ai_content_generations")) return { rows: [generation], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const repository = createAiContentRepository({ connect: async () => client, query: client.query } as never);

    await repository.updateAiContentDraft({
      ...scope,
      generationId: "generation-1",
      actorUserId: "10000000-0000-4000-8000-000000000001",
      draft: {},
      referenceIds: [],
      orchestration: {
        contractVersion: "content-orchestration.v1",
        contentFamily: "informational",
        subject,
        target: { id: null, snapshot: {} },
        strategy: "how_to",
        outputFormat: "blog",
        channelTargets: ["blog_export"],
        brief: {},
        references: [],
        avatar: null,
      } as never,
    });

    const update = statements.find(({ sql }) => sql.includes("update ai_content_generations"));
    expect(update?.sql).toContain("subject_mode");
    expect(update?.sql).toContain("product_service_id");
    expect(update?.params.slice(-3)).toEqual([mode, productServiceId, "10000000-0000-4000-8000-000000000001"]);
  });

  it("rejects a canonical start when persisted subject columns do not match the draft", async () => {
    const orchestration = {
      contractVersion: "content-orchestration.v1",
      contentFamily: "informational",
      subject: { mode: "new_subject", subjectAnalysisId: "70000000-0000-4000-8000-000000000007" },
      target: { id: null, snapshot: {} },
      strategy: "how_to",
      outputFormat: "blog",
      channelTargets: ["blog_export"],
      brief: {},
      references: [],
      avatar: null,
    };
    const generation = {
      ...row("generation-1", "draft"),
      type: "blog",
      draft_json: { orchestration },
      content_family: "informational",
      output_format: "blog",
      subject_mode: "brand_topic",
      product_service_id: null,
    };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
        if (sql.includes("from workspace_members member")) return { rows: [{ ok: 1 }], rowCount: 1 };
        if (sql.includes("from ai_content_generations")) return { rows: [generation], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const repository = createAiContentRepository({ connect: async () => client, query: client.query } as never);

    await expect(repository.startAiContentGeneration({
      ...scope,
      generationId: "generation-1",
      actorUserId: "10000000-0000-4000-8000-000000000001",
      idempotencyKey: "mapping-mismatch",
      outputCount: 1,
      usageDate: "2026-07-28",
      dailyGenerationLimit: 10,
    })).rejects.toThrow("ai_content_subject_mapping_mismatch");
  });

  it("lists only incomplete real draft references for archive warnings", async () => {
    const query = vi.fn(async (sql: string) => ({
      rows: sql.includes("ai_content_generation_references")
        ? [{ asset_type: "reference", asset_id: "reference-1", generation_id: "generation-1", title: "초안" }]
        : [],
      rowCount: 1,
    }));
    const repository = createAiContentRepository({ query } as never);

    await expect(repository.listAiContentDraftReferences({
      ...scope,
      assetType: "reference",
      assetId: "reference-1",
    })).resolves.toEqual([
      { assetType: "reference", assetId: "reference-1", generationId: "generation-1", title: "초안" },
    ]);
    expect(query.mock.calls[0]?.[0]).toContain("generation.status in ('draft','analysis_ready')");
    expect(query.mock.calls[0]?.[0]).not.toContain("draft_json::text");
  });

  it.each([
    ["avatar", "draft_json->'orchestration'->'avatar'->>'id'"],
    ["product_service", "draft_json->'orchestration'->'subject'->>'productServiceId'"],
    ["wiki", "draft_json->'orchestration'->'subject'->'wikiItemIds'"],
  ])("resolves canonical %s draft references before start snapshots exist", async (assetType, expectedSql) => {
    const query = vi.fn(async (_sql: string) => ({ rows: [], rowCount: 0 }));
    const repository = createAiContentRepository({ query } as never);

    await repository.listAiContentDraftReferences({
      ...scope,
      assetType: assetType as "avatar" | "product_service" | "wiki",
      assetId: "60000000-0000-4000-8000-000000000006",
    });

    expect(query.mock.calls[0]?.[0]).toContain(expectedSql);
  });

  it("scopes draft reference warnings to the tenant and excludes every started or terminal generation", async () => {
    const query = vi.fn(async (_sql: string) => ({ rows: [], rowCount: 0 }));
    const repository = createAiContentRepository({ query } as never);

    await repository.listAiContentDraftReferences({
      ...scope,
      assetType: "reference",
      assetId: "60000000-0000-4000-8000-000000000006",
    });

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("generation.workspace_id=$1 and generation.brand_id=$2");
    expect(sql).toContain("generation.status in ('draft','analysis_ready')");
    expect(sql).toContain("generation.attachments_locked_at is null");
    expect(sql).toContain("generation.orchestration_snapshot is null");
  });

  it("starts canonical orchestration with one frozen brief, outputs, job, and ledger transaction", async () => {
    const oneTimeReceiptId = "a0000000-0000-4000-8000-00000000000a";
    const oneTimeSessionId = "b0000000-0000-4000-8000-00000000000b";
    const orchestration = {
      contractVersion: "content-orchestration.v1",
      contentFamily: "informational",
      subject: { mode: "brand_topic", topic: "여름 관리" },
      target: { id: null, snapshot: {} },
      strategy: "how_to",
      outputFormat: "blog",
      channelTargets: ["blog_export"],
      brief: {},
      references: [],
      avatar: {
        mode: "one_time",
        id: oneTimeReceiptId,
        snapshot: { fileName: "campaign-person.png" },
      },
    };
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const generation = {
      ...row("generation-1", "draft"),
      type: "blog",
      draft_json: {
        orchestration,
        proposalId: "70000000-0000-4000-8000-000000000007",
        approvedProposalVersionId: "80000000-0000-4000-8000-000000000008",
      },
      content_family: "informational",
      output_format: "blog",
      subject_mode: "brand_topic",
      product_service_id: null,
      orchestration_snapshot: null,
    };
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        statements.push({ sql, params });
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
        if (sql.includes("from workspace_members member")) return { rows: [{ ok: 1 }], rowCount: 1 };
        if (sql.includes("from ai_content_generations") && sql.includes("where id = $1")) return { rows: [generation], rowCount: 1 };
        if (sql.includes("from ai_content_usage_ledger")) return { rows: [{ generation_count: 0 }], rowCount: 1 };
        if (sql.includes("from brand_profiles profile")) {
          return { rows: [{
            brand_core_version_id: "40000000-0000-4000-8000-000000000004",
            rule_set_version_id: "50000000-0000-4000-8000-000000000005",
            approved_proposal_snapshot: {
              contractVersion: "approved-proposal.v1",
              sourceProposalId: "70000000-0000-4000-8000-000000000007",
            },
          }], rowCount: 1 };
        }
        if (sql.includes("from ai_content_generation_references")) return { rows: [], rowCount: 0 };
        if (sql.includes("from ai_content_one_time_avatar_receipts")) return { rows: [{
          id: oneTimeReceiptId,
          upload_session_id: oneTimeSessionId,
          object_hash: "a".repeat(64),
          mime_type: "image/png",
        }], rowCount: 1 };
        if (sql.includes("start_ai_content_orchestration")) return { rows: [{ id: "generation-1" }], rowCount: 1 };
        if (sql.includes("update ai_content_generations") && sql.includes("generation_idempotency_key")) {
          return { rows: [{ ...generation, status: "queued", current_stage: "generation" }], rowCount: 1 };
        }
        if (sql.includes("insert into ai_content_generation_outputs")) return { rows: [{ id: "output-1" }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    };
    const repository = createAiContentRepository({ connect: async () => client, query: client.query } as never);

    const started = await repository.startAiContentGeneration({
      ...scope,
      generationId: "generation-1",
      actorUserId: "10000000-0000-4000-8000-000000000001",
      idempotencyKey: "canonical-start-1",
      outputCount: 1,
      usageDate: "2026-07-28",
      dailyGenerationLimit: 10,
    });

    expect(started.status).toBe("queued");
    const freeze = statements.find(({ sql }) => sql.includes("start_ai_content_orchestration"));
    const receiptLookup = statements.find(({ sql }) => sql.includes("from ai_content_one_time_avatar_receipts"));
    expect(receiptLookup?.params).toEqual([
      oneTimeReceiptId,
      "generation-1",
      scope.workspaceId,
      scope.brandId,
      scope.actorUserId,
    ]);
    expect(JSON.parse(String(freeze?.params[3]))).toMatchObject({
      contractVersion: "generation-brief.v1",
      brandCoreVersionId: "40000000-0000-4000-8000-000000000004",
      ruleSetVersionId: "50000000-0000-4000-8000-000000000005",
      outputFormat: "blog",
      avatar: {
        id: oneTimeSessionId,
        assetVersionId: oneTimeReceiptId,
        objectHash: "a".repeat(64),
        mime: "image/png",
        provenance: "one_time",
      },
    });
    expect(statements.map(({ sql }) => sql)).toEqual(expect.arrayContaining([
      "BEGIN",
      "COMMIT",
    ]));
    expect(statements.some(({ sql }) => sql.includes("insert into ai_content_usage_ledger"))).toBe(true);
    expect(statements.some(({ sql }) => sql.includes("updated_by_user_id"))).toBe(true);
  });

  it("freezes the same-tenant ready analysis for canonical new_subject start", async () => {
    const analysisId = "60000000-0000-4000-8000-000000000006";
    const generation = {
      ...row("generation-1", "draft"),
      type: "blog",
      draft_json: {
        orchestration: {
          contractVersion: "content-orchestration.v1",
          contentFamily: "informational",
          subject: { mode: "new_subject", subjectAnalysisId: analysisId },
          target: { id: null, snapshot: {} },
          strategy: "how_to",
          outputFormat: "blog",
          channelTargets: ["blog_export"],
          brief: {},
          references: [],
          avatar: null,
        },
        proposalId: "70000000-0000-4000-8000-000000000007",
        approvedProposalVersionId: "80000000-0000-4000-8000-000000000008",
      },
      content_family: "informational",
      output_format: "blog",
      subject_mode: "new_subject",
      product_service_id: null,
    };
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        statements.push({ sql, params });
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
        if (sql.includes("from workspace_members member")) return { rows: [{ ok: 1 }], rowCount: 1 };
        if (sql.includes("from ai_content_generations") && sql.includes("where id = $1")) return { rows: [generation], rowCount: 1 };
        if (sql.includes("from ai_content_usage_ledger")) return { rows: [{ generation_count: 0 }], rowCount: 1 };
        if (sql.includes("from brand_profiles profile")) return { rows: [{
          brand_core_version_id: "40000000-0000-4000-8000-000000000004",
          rule_set_version_id: "50000000-0000-4000-8000-000000000005",
          approved_proposal_snapshot: { contractVersion: "approved-proposal.v1" },
        }], rowCount: 1 };
        if (sql.includes("from ai_content_subject_analyses analysis")) return { rows: [{
          id: analysisId,
          analysis_version: 2,
          contract_version: "subject-analysis.v2",
          subject_type: "service",
          source_url: "https://example.com/service",
          normalized_url: "https://example.com/service",
          input_json: { name: "서비스" },
          facts_json: [{ key: "name", value: "서비스" }],
          research_json: {},
          analysis_result_json: { summary: "분석" },
          selected_images: [],
          captured_at: "2026-07-28T00:00:00.000Z",
        }], rowCount: 1 };
        if (sql.includes("insert into ai_content_analyzed_subject_snapshots")) return { rows: [], rowCount: 1 };
        if (sql.includes("from ai_content_generation_references")) return { rows: [], rowCount: 0 };
        if (sql.includes("start_ai_content_orchestration")) return { rows: [{}], rowCount: 1 };
        if (sql.includes("update ai_content_generations") && sql.includes("generation_idempotency_key")) {
          return { rows: [{ ...generation, status: "queued", current_stage: "generation" }], rowCount: 1 };
        }
        if (sql.includes("insert into ai_content_generation_outputs")) return { rows: [{ id: "output-1" }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    };
    const repository = createAiContentRepository({ connect: async () => client, query: client.query } as never);

    await repository.startAiContentGeneration({
      ...scope,
      generationId: "generation-1",
      actorUserId: "10000000-0000-4000-8000-000000000001",
      idempotencyKey: "new-subject-start-1",
      outputCount: 1,
      usageDate: "2026-07-28",
      dailyGenerationLimit: 10,
    });

    const freeze = statements.find(({ sql }) => sql.includes("start_ai_content_orchestration"));
    expect(JSON.parse(String(freeze?.params[3])).subject).toMatchObject({
      kind: "analyzed_subject",
      analysisId,
      snapshot: {
        contractVersion: "analyzed-subject-snapshot.v1",
        analysisVersion: 2,
        analysisContractVersion: "subject-analysis.v2",
      },
    });
    expect(statements.some(({ sql }) => sql.includes("insert into ai_content_analyzed_subject_snapshots"))).toBe(true);
  });

  it("returns only public lifecycle fields and never exposes the immutable input snapshot", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("from ai_content_generation_outputs")) {
        return { rows: [], rowCount: 0 };
      }
      return {
        rows: [{
          ...row("generation-1", "failed"),
          attachments_locked_at: "2026-07-18T01:00:00.000Z",
          terminal_at: "2026-07-18T02:00:00.000Z",
          retryable_until: "2026-08-02T02:00:00.000Z",
          generation_input_snapshot: {
            brandContext: { secret: "internal" },
            attachments: [{
              storagePath: "private/path.png",
              storageUrl: "https://blob.example.com/private/path.png",
            }],
          },
          subject_analysis_snapshot: {
            brandContext: { secret: "internal" },
          },
        }],
        rowCount: 1,
      };
    });
    const repository = createAiContentRepository({ query } as never);

    const [generation] = await repository.listAiContentGenerations(scope);

    expect(generation).toMatchObject({
      attachmentsLockedAt: "2026-07-18T01:00:00.000Z",
      terminalAt: "2026-07-18T02:00:00.000Z",
      retryableUntil: "2026-08-02T02:00:00.000Z",
    });
    expect(generation).not.toHaveProperty("generationInputSnapshot");
    expect(generation).not.toHaveProperty("subjectAnalysisSnapshot");
    expect(JSON.stringify(generation)).not.toContain("private/path.png");
    expect(JSON.stringify(generation)).not.toContain("brandContext");
  });

  it("returns a tenant-scoped sanitized frozen evidence snapshot for generation detail", async () => {
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("from ai_content_generation_outputs")) {
        return {
          rows: [{
            id: "output-reel",
            generation_id: "generation-1",
            output_index: 1,
            title: "과거 릴스",
            status: "completed",
            content_json: { caption: "과거 결과" },
            artifact_manifest_json: { deliveryFormat: "instagram_reel", assets: [] },
            manifest_url: null,
            failure_code: null,
            failure_message: null,
            downloaded_at: null,
            created_at: "2026-07-18T00:00:00.000Z",
            updated_at: "2026-07-18T00:00:00.000Z",
            completed_at: "2026-07-18T00:00:00.000Z",
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("from ai_content_generation_references")) {
        expect(params).toEqual(["generation-1", "workspace-1", "brand-1"]);
        return {
          rows: [{
            reference_id: "reference-1",
            reference_snapshot_json: {
              title: "동결된 레퍼런스",
              url: "https://example.com/reference",
              previewUrl: "https://cdn.example.com/reference.png",
            },
            roles_json: ["planning"],
          }],
          rowCount: 1,
        };
      }
      expect(params).toEqual(["generation-1", "workspace-1", "brand-1"]);
      return {
        rows: [{
          ...row("generation-1", "completed"),
          orchestration_snapshot: {
            contractVersion: "generation-brief.v1",
            proposalId: "proposal-1",
            approvedProposalSnapshot: { title: "동결된 구현안", hook: "동결된 훅" },
            references: [{ itemId: "reference-1", roles: ["planning"] }],
            avatar: { id: "avatar-1", objectHash: "avatar-hash" },
          },
          generation_input_snapshot: {
            contractVersion: "content-generation-input.v2",
            contentType: "card_news",
            brandContext: { secret: "must-not-leak" },
            subject: { analysisId: "analysis-1", facts: [{ key: "benefit", value: "편안함" }] },
            message: { target: { id: "target-1", name: "고객" }, qualityBrief: { hook: "동결된 훅" } },
            creativeDirection: { outputCount: 1 },
            attachments: [{ storagePath: "private/path.png" }],
          },
          avatar_snapshot: { id: "avatar-1", objectHash: "avatar-hash" },
        }],
        rowCount: 1,
      };
    });
    const repository = createAiContentRepository({ query } as never);

    const generation = await repository.getAiContentGeneration({
      ...scope,
      generationId: "generation-1",
    });

    expect(generation).toMatchObject({
      evidenceSnapshot: {
        orchestration: {
          proposalId: "proposal-1",
          approvedProposalSnapshot: { title: "동결된 구현안", hook: "동결된 훅" },
        },
        generationInput: {
          contentType: "card_news",
          subject: { analysisId: "analysis-1" },
          message: { target: { id: "target-1" } },
          creativeDirection: { outputCount: 1 },
        },
        references: [{
          id: "reference-1",
          title: "동결된 레퍼런스",
          url: "https://example.com/reference",
          roles: ["planning"],
        }],
        avatar: { id: "avatar-1", objectHash: "avatar-hash" },
        proposal: { title: "동결된 구현안", hook: "동결된 훅" },
      },
      outputs: [{
        legacyReadOnly: true,
        revisionCapabilities: [],
      }],
    });
    expect(JSON.stringify(generation)).not.toContain("must-not-leak");
    expect(JSON.stringify(generation)).not.toContain("private/path.png");
  });

  it("returns sanitized v3 evidence from the immutable generation input table", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("from ai_content_generation_outputs")) return { rows: [], rowCount: 0 };
      if (sql.includes("from ai_content_generation_references")) return { rows: [], rowCount: 0 };
      if (sql.includes("from ai_content_generation_input_snapshots")) {
        return {
          rows: [{
            input_json: {
              contractVersion: "content-generation-input.v3",
              generationId: "generation-1",
              brandCore: { versionId: "core-version-1", companyOverview: "브랜드 소개" },
              subject: { kind: "topic_text", title: "동결된 주제" },
              contentInstruction: "간결하게",
              product: null,
              researchEvidence: { contractVersion: "research-evidence.v1", items: [] },
              references: {
                selected: [{ referenceItemId: "reference-1", title: "동결 레퍼런스", url: "https://example.com/reference", roles: ["planning"] }],
                brandStyleImages: [],
                avatarStyleImageId: null,
                attachments: [{ id: "attachment-1", storagePath: "private/path.png", storageUrl: "https://blob.example/private.png" }],
              },
              selectedProposal: { id: "proposal-1", title: "동결된 구성안" },
              userImageInstruction: "로고 금지",
              outputSettings: { purpose: "informational", outputFormat: "card_news", channelTargets: ["instagram"], aspectRatio: "1:1", outputCount: 1 },
              capturedAt: "2026-08-04T00:00:00.000Z",
            },
          }],
          rowCount: 1,
        };
      }
      return {
        rows: [{
          ...row("generation-1", "partial_failed"),
          orchestration_snapshot: null,
          generation_input_snapshot: null,
          avatar_snapshot: null,
        }],
        rowCount: 1,
      };
    });

    const generation = await createAiContentRepository({ query } as never).getAiContentGeneration({
      ...scope,
      generationId: "generation-1",
    });

    expect(generation).toMatchObject({
      evidenceSnapshot: {
        generationInput: {
          contractVersion: "content-generation-input.v3",
          subject: { kind: "topic_text", title: "동결된 주제" },
          outputSettings: { outputFormat: "card_news", aspectRatio: "1:1" },
        },
        references: [{ id: "reference-1", title: "동결 레퍼런스", roles: ["planning"] }],
        avatar: null,
        proposal: { id: "proposal-1", title: "동결된 구성안" },
      },
    });
    expect(JSON.stringify(generation)).not.toContain("private/path.png");
    expect(JSON.stringify(generation)).not.toContain("private.png");
  });

  it("reads legacy multi-output results beside v2 formats without marking a v2 reel as legacy", async () => {
    const outputRow = (
      id: string,
      outputIndex: number,
      manifest: Record<string, unknown>,
      title = id,
    ) => ({
      id,
      generation_id: "generation-1",
      output_index: outputIndex,
      title,
      status: "completed",
      content_json: manifest.content ?? {},
      artifact_manifest_json: manifest,
      manifest_url: `https://assets.public.blob.vercel-storage.com/${id}/manifest.json`,
      failure_code: null,
      failure_message: null,
      downloaded_at: null,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
      completed_at: "2026-08-01T00:00:00.000Z",
    });
    const image = (role: string, index: number) => ({
      role,
      index,
      url: `https://assets.public.blob.vercel-storage.com/${role}-${index}.png`,
      fileName: `${role}-${index}.png`,
      mimeType: "image/png",
      width: 1080,
      height: role === "scene" ? 1920 : 1080,
    });
    const v1Card = (index: number) => ({
      version: "ai-content.v1",
      type: "card_news",
      title: `legacy-card-${index}`,
      assets: [image("slide", 1)],
      content: { caption: "legacy", hashtags: [], cta: "save" },
    });
    const v2 = (outputFormat: "card_news" | "blog" | "reel" | "marketing_content", assets: unknown[]) => ({
      version: "ai-content.v2",
      type: outputFormat === "card_news" ? "card_news" : outputFormat === "blog" ? "blog" : "marketing",
      purpose: "marketing",
      outputFormat,
      title: outputFormat,
      assets,
      content: { caption: outputFormat },
    });
    const outputs = [
      outputRow("legacy-card-1", 1, v1Card(1)),
      outputRow("legacy-card-2", 2, v1Card(2)),
      outputRow("legacy-card-3", 3, v1Card(3)),
      outputRow("legacy-blog", 4, {
        version: "ai-content.v1",
        type: "blog",
        title: "legacy-blog",
        assets: [image("cover", 1), { role: "html", index: 2, url: "https://assets.public.blob.vercel-storage.com/article.html", fileName: "article.html", mimeType: "text/html" }],
        content: { title: "legacy", summary: "summary", html: "<article></article>", metaTitle: "legacy", metaDescription: "legacy" },
      }),
      outputRow("legacy-reel", 5, { version: "ai-content.v1", deliveryFormat: "instagram_reel", assets: [] }),
      outputRow("versionless-legacy-reel", 6, { deliveryFormat: "instagram_reel", assets: [] }),
      outputRow("unknown-reel", 7, { version: "ai-content.v999", type: "marketing", outputFormat: "reel", assets: [] }),
      outputRow("v2-card", 8, v2("card_news", [image("slide", 1)])),
      outputRow("v2-blog", 9, v2("blog", [{ role: "html", index: 1, url: "https://assets.public.blob.vercel-storage.com/content.html", fileName: "content.html", mimeType: "text/html" }])),
      outputRow("v2-reel", 10, v2("reel", [
        image("scene", 1),
        { role: "video", index: 1, url: "https://assets.public.blob.vercel-storage.com/reel.mp4", fileName: "reel.mp4", mimeType: "video/mp4", width: 1080, height: 1920, durationSeconds: 4, videoCodec: "h264", fps: 30, audioCodec: null },
      ])),
      outputRow("v2-marketing", 11, v2("marketing_content", [image("creative", 1)])),
    ];
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("from ai_content_generation_outputs")) return { rows: outputs, rowCount: outputs.length };
      if (sql.includes("from ai_content_generation_references")) return { rows: [], rowCount: 0 };
      return { rows: [{ ...row("generation-1", "completed") }], rowCount: 1 };
    });

    const generation = await createAiContentRepository({ query } as never).getAiContentGeneration({
      ...scope,
      generationId: "generation-1",
    });

    expect(generation?.outputs?.filter((output) => output.id.startsWith("legacy-card"))).toHaveLength(3);
    expect(generation?.outputs?.find((output) => output.id === "legacy-blog")?.manifest).toMatchObject({ version: "ai-content.v1" });
    expect(generation?.outputs?.find((output) => output.id === "legacy-reel")).toMatchObject({ manifestVersion: "ai-content.v1", legacyReadOnly: true, revisionCapabilities: [] });
    expect(generation?.outputs?.find((output) => output.id === "versionless-legacy-reel")).toMatchObject({ manifestVersion: "ai-content.v1", legacyReadOnly: true, revisionCapabilities: [] });
    expect(generation?.outputs?.find((output) => output.id === "unknown-reel")).toMatchObject({ manifestVersion: null, legacyReadOnly: false });
    expect(generation?.outputs?.find((output) => output.id === "v2-reel")).toMatchObject({
      manifestVersion: "ai-content.v2",
      legacyReadOnly: false,
      manifest: { version: "ai-content.v2", outputFormat: "reel" },
    });
    expect(generation?.outputs?.filter((output) => output.id.startsWith("v2-"))).toHaveLength(4);
  });

  it("returns canonical reference item ids for all three legacy reference source branches", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("'brand_output' as source")) {
        return {
          rows: [
            {
              id: "10000000-0000-4000-8000-000000000001",
              underlying_id: "20000000-0000-4000-8000-000000000001",
              source: "brand_output",
              title: "Owned result",
              url: null,
              preview_url: null,
              metrics: { exposureCount: 100 },
              checked_at: "2026-07-31T00:00:00.000Z",
            },
            {
              id: "10000000-0000-4000-8000-000000000002",
              underlying_id: "20000000-0000-4000-8000-000000000002",
              source: "saved_trend",
              title: "Saved trend",
              url: "https://instagram.example/p/1",
              preview_url: "https://cdn.example/trend.jpg",
              metrics: { likeCount: 90, commentsCount: 8 },
              checked_at: "2026-07-30T00:00:00.000Z",
            },
          ],
          rowCount: 2,
        };
      }
      return {
        rows: [{
          id: "10000000-0000-4000-8000-000000000003",
          underlying_id: "20000000-0000-4000-8000-000000000003",
          source: "saved_url",
          title: "Saved URL",
          url: "https://example.com/reference",
          preview_url: null,
          metrics: {},
          checked_at: "2026-07-29T00:00:00.000Z",
        }],
        rowCount: 1,
      };
    });
    const repository = createAiContentRepository({ query } as never);

    const visual = await repository.listAiContentReferences({ ...scope, type: "card_news" });
    const blog = await repository.listAiContentReferences({ ...scope, type: "blog" });

    expect([...visual, ...blog].map((item) => item.id)).toEqual([
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
      "10000000-0000-4000-8000-000000000003",
    ]);
    const visualSql = calls[0]?.sql ?? "";
    expect(visualSql.match(/select reference_filter\.id/g)).toHaveLength(2);
    expect(visualSql).not.toContain("select co.id, 'brand_output' as source");
    expect(visualSql).not.toContain("select saved.id, 'saved_trend' as source");
    const blogSql = calls[1]?.sql ?? "";
    expect(blogSql).toContain("select item.id, 'saved_url' as source");
    expect(blogSql).not.toContain("select source.id, 'saved_url' as source");
  });

  it("keeps blog content-purpose filtering while selecting the canonical item id", async () => {
    const pool = createPool();
    const repository = createAiContentRepository(pool as never);

    await repository.listAiContentReferences({ ...scope, type: "blog" });

    expect(pool.sql.join("\n")).toContain("select item.id, 'saved_url' as source");
    expect(pool.sql.join("\n")).toContain("item.content_purpose in ('informational', 'both')");
  });

  it("lists only tenant-scoped, available, same-category, format-compatible reference seeds with comparable metrics", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return {
        rows: [
          { id: "10000000-0000-4000-8000-000000000005", workspace_id: scope.workspaceId, brand_id: scope.brandId, archived_at: null, source_availability: "available", source: "saved_trend", title: "E", url: null, preview_url: null, format: "reel", primary_category: "MARKETING", exposure_count: "100", like_count: "20", comments_count: "2", checked_at: "2026-07-31T00:00:00.000Z" },
          { id: "10000000-0000-4000-8000-000000000004", workspace_id: scope.workspaceId, brand_id: scope.brandId, archived_at: null, source_availability: "available", source: "saved_trend", title: "D", url: null, preview_url: null, format: "reel", primary_category: " marketing ", exposure_count: "100", like_count: "20", comments_count: "2", checked_at: "2026-07-31T00:00:00.000Z" },
          { id: "10000000-0000-4000-8000-000000000003", workspace_id: scope.workspaceId, brand_id: scope.brandId, archived_at: null, source_availability: "available", source: "saved_trend", title: "C", url: null, preview_url: null, format: "reel", primary_category: "marketing", exposure_count: "100", like_count: "20", comments_count: "3", checked_at: "2026-07-29T00:00:00.000Z" },
          { id: "10000000-0000-4000-8000-000000000002", workspace_id: scope.workspaceId, brand_id: scope.brandId, archived_at: null, source_availability: "available", source: "saved_trend", title: "B", url: null, preview_url: null, format: "reel", primary_category: "marketing", exposure_count: "100", like_count: "21", comments_count: "1", checked_at: "2026-07-28T00:00:00.000Z" },
          { id: "10000000-0000-4000-8000-000000000001", workspace_id: scope.workspaceId, brand_id: scope.brandId, archived_at: null, source_availability: "available", source: "brand_output", title: "A", url: null, preview_url: null, format: "reel", primary_category: "marketing", exposure_count: "101", like_count: null, comments_count: null, checked_at: "2026-07-27T00:00:00.000Z" },
          { id: "90000000-0000-4000-8000-000000000001", workspace_id: scope.workspaceId, brand_id: "other-brand", archived_at: null, source_availability: "available", source: "saved_trend", title: "Other brand", format: "reel", primary_category: "marketing", exposure_count: "999", like_count: "999", comments_count: "999", checked_at: "2026-08-01T00:00:00.000Z" },
          { id: "90000000-0000-4000-8000-000000000002", workspace_id: scope.workspaceId, brand_id: scope.brandId, archived_at: "2026-07-01T00:00:00.000Z", source_availability: "available", source: "saved_trend", title: "Archived", format: "reel", primary_category: "marketing", exposure_count: "999", like_count: "999", comments_count: "999", checked_at: "2026-08-01T00:00:00.000Z" },
          { id: "90000000-0000-4000-8000-000000000003", workspace_id: scope.workspaceId, brand_id: scope.brandId, archived_at: null, source_availability: "unavailable", source: "saved_trend", title: "Unavailable", format: "reel", primary_category: "marketing", exposure_count: "999", like_count: "999", comments_count: "999", checked_at: "2026-08-01T00:00:00.000Z" },
          { id: "90000000-0000-4000-8000-000000000004", workspace_id: scope.workspaceId, brand_id: scope.brandId, archived_at: null, source_availability: "available", source: "saved_trend", title: "No category", format: "reel", primary_category: null, exposure_count: "999", like_count: "999", comments_count: "999", checked_at: "2026-08-01T00:00:00.000Z" },
          { id: "90000000-0000-4000-8000-000000000005", workspace_id: scope.workspaceId, brand_id: scope.brandId, archived_at: null, source_availability: "available", source: "saved_trend", title: "Wrong category", format: "reel", primary_category: "retail", exposure_count: "999", like_count: "999", comments_count: "999", checked_at: "2026-08-01T00:00:00.000Z" },
          { id: "90000000-0000-4000-8000-000000000006", workspace_id: scope.workspaceId, brand_id: scope.brandId, archived_at: null, source_availability: "available", source: "saved_trend", title: "Wrong format", format: "card_news", primary_category: "marketing", exposure_count: "999", like_count: "999", comments_count: "999", checked_at: "2026-08-01T00:00:00.000Z" },
          { id: "90000000-0000-4000-8000-000000000007", workspace_id: scope.workspaceId, brand_id: scope.brandId, archived_at: null, source_availability: "available", source: "saved_trend", title: "No metrics", format: "reel", primary_category: "marketing", exposure_count: null, like_count: null, comments_count: null, checked_at: "2026-08-01T00:00:00.000Z" },
          { id: "90000000-0000-4000-8000-000000000008", workspace_id: scope.workspaceId, brand_id: scope.brandId, archived_at: null, source_availability: "available", source: "saved_trend", title: "Unsafe metric", format: "reel", primary_category: "marketing", exposure_count: "1e9", like_count: null, comments_count: null, checked_at: "2026-08-01T00:00:00.000Z" },
        ],
        rowCount: 13,
      };
    });
    const repository = createAiContentRepository({ query } as never);

    const result = await repository.listAiContentReferenceSeeds({
      ...scope,
      primaryCategory: "  Marketing ",
      format: "reel",
      limit: 99,
    });

    expect(result.map((item) => item.id)).toEqual([
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
      "10000000-0000-4000-8000-000000000003",
      "10000000-0000-4000-8000-000000000004",
      "10000000-0000-4000-8000-000000000005",
    ]);
    expect(result[0]).toEqual({
      id: "10000000-0000-4000-8000-000000000001",
      source: "brand_output",
      title: "A",
      url: null,
      previewUrl: null,
      format: "reel",
      primaryCategory: "marketing",
      metrics: { exposureCount: 101, likeCount: null, commentsCount: null },
      checkedAt: "2026-07-27T00:00:00.000Z",
    });
    expect(calls[0]?.params).toEqual([scope.workspaceId, scope.brandId, "marketing", "reel", 50]);
    expect(calls[0]?.sql).toContain("from reference_items item");
    expect(calls[0]?.sql).toContain("reference_snapshots");
    expect(calls[0]?.sql).toContain("reference_pattern_versions");
    expect(calls[0]?.sql).toContain("item.workspace_id = $1");
    expect(calls[0]?.sql).toContain("item.brand_id = $2");
    expect(calls[0]?.sql).toContain("item.archived_at is null");
    expect(calls[0]?.sql).toContain("sourceAvailability");
    expect(calls[0]?.sql).toContain("item.metadata->>'primaryCategory'");
    expect(calls[0]?.sql).toContain("latest_pattern.pattern_json->>'primaryCategory'");
    expect(calls[0]?.sql).toContain("performance.content_features->>'format'");
    expect(calls[0]?.sql).toContain("media.raw_metadata->>'_trendKind'");
    expect(calls[0]?.sql).toContain("content_performance_snapshots");
    expect(calls[0]?.sql).toContain("instagram_trend_media");
    expect(calls[0]?.sql).toContain("limit $5");
  });

  it("returns no reference seeds without an approved primary category and rejects unsupported formats", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = createAiContentRepository({ query } as never);

    await expect(repository.listAiContentReferenceSeeds({
      ...scope,
      primaryCategory: "  ",
      format: "card_news",
      limit: 10,
    })).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();

    await expect(repository.listAiContentReferenceSeeds({
      ...scope,
      primaryCategory: "marketing",
      format: "story" as never,
      limit: 10,
    })).rejects.toThrow("ai_content_reference_seed_format_invalid");
  });

  it("applies recommended strategy, format, and tag filters inside the tenant-scoped reference query", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: [], rowCount: 0 };
    });
    const repository = createAiContentRepository({ query } as never);

    await repository.listAiContentReferences({
      ...scope,
      type: "blog",
      strategies: ["how_to"],
      formats: ["blog"],
      tags: ["여름"],
    });

    expect(calls[0]?.sql).toContain("item.workspace_id = $1");
    expect(calls[0]?.sql).toContain("item.brand_id = $2");
    expect(calls[0]?.sql).toContain("item.metadata");
    expect(calls[0]?.params).toEqual([
      scope.workspaceId,
      scope.brandId,
      ["how_to"],
      ["blog"],
      ["여름"],
    ]);
  });

  it("creates a generation and analyze job atomically", async () => {
    const pool = createPool();
    const repository = createAiContentRepository(pool as never);

    const result = await repository.createAiContentAnalysis(input);

    expect(result.status).toBe("analyzing");
    expect(result.draft).toMatchObject({ origin: "manual" });
    expect(pool.sql.join("\n")).toContain("insert into ai_content_generation_jobs");
    expect(pool.sql.join("\n")).toContain("created_by_user_id");
    expect(pool.sql.join("\n")).toContain("jsonb_build_object('generationId', $1::uuid)");
    expect(pool.commands).toEqual(expect.arrayContaining(["BEGIN", "COMMIT"]));
  });

  it.each([
    ["marketing", {}, ["marketing", "single_image", "brand_topic", null]],
    ["blog", { subjectAnalysisId: "analysis-1" }, ["informational", "blog", "new_subject", null]],
    ["card_news", { productServiceId: "60000000-0000-4000-8000-000000000006" }, [
      "informational",
      "card_news",
      "product_service",
      "60000000-0000-4000-8000-000000000006",
    ]],
  ] as const)("writes canonical orchestration mapping for %s", async (type, draft, expected) => {
    const pool = createPool();
    const repository = createAiContentRepository(pool as never);

    await repository.createAiContentAnalysis({ ...input, type, draft });

    expect(pool.sql.join("\n")).toContain("content_family, output_format, subject_mode, product_service_id");
    expect(pool.generationInsertParams.slice(9, 13)).toEqual(expected);
  });

  it("applies stored owned context without queueing a CLI analysis job", async () => {
    const pool = createPool();
    const repository = createAiContentRepository(pool as never);

    const context = await repository.getAiContentBrandContext(scope);
    const result = await repository.createAiContentAnalysis({ ...input, draft: { analysisSource: "owned" } });

    expect(context).toMatchObject({ ready: true, ownedUrl: "https://example.com", wikiVersionId: null, pageCount: 0 });
    expect(result).toMatchObject({ status: "analysis_ready", analysis: { source: "owned", contextReady: true } });
    expect(result.analysis).not.toHaveProperty("wikiVersionId");
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

  it("allows owned context selection without waiting for Wiki data", async () => {
    const pool = createPool({ wikiReady: false });
    const repository = createAiContentRepository(pool as never);

    const result = await repository.createAiContentAnalysis({ ...input, draft: { analysisSource: "owned" } });

    expect(result).toMatchObject({ status: "analysis_ready", analysis: { source: "owned", contextReady: true } });
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
    expect(pool.sql.join("\n")).toContain("updated_by_user_id");
    expect(pool.sql.join("\n")).toContain("media.media_url");
    expect(pool.sql.join("\n")).toContain("_previewUrl");
    const referenceSnapshotSql = pool.sql.find((sql) => sql.includes("'saved_trend'"));
    expect(referenceSnapshotSql).toContain("select reference_filter.id");
    expect(referenceSnapshotSql).toContain("saved.id = reference_filter.saved_trend_id");
    expect(pool.referenceSnapshots[0]).toMatchObject({
      source: "saved_trend",
      mediaType: "IMAGE",
      mediaUrl: "https://cdn.example.com/original.jpg",
      previewUrl: "https://cdn.example.com/preview.jpg",
      username: "reference_account",
    });
  });

  it("rejects a legacy draft update for a proposal-v2 generation", async () => {
    const pool = createPool();
    pool.setGenerationDraft({
      origin: "proposal-v2",
      proposalId: "74000000-0000-4000-8000-000000000007",
      approvedProposalVersionId: "77000000-0000-4000-8000-000000000007",
    });
    const repository = createAiContentRepository(pool as never);

    await expect(repository.updateAiContentDraft({
      ...scope,
      generationId: "generation-1",
      draft: {},
      referenceIds: [],
    })).rejects.toThrow(/^ai_content_v3_contract_required$/);
    expect(pool.sql.some((sql) => sql.includes("set draft_json"))).toBe(false);
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

  it("allows attachment-neutral draft updates after lock but rejects attachment identity changes", async () => {
    const pool = createPool({ attachmentsLocked: true });
    const repository = createAiContentRepository(pool as never);
    await repository.createAiContentAnalysis(input);
    pool.setGenerationStatus("analysis_ready");

    await expect(repository.updateAiContentDraft({
      ...scope,
      generationId: "generation-1",
      draft: { productUrl: "https://example.com/new" },
      referenceIds: [],
    })).resolves.toMatchObject({ id: "generation-1" });

    await expect(repository.updateAiContentDraft({
      ...scope,
      generationId: "generation-1",
      draft: { productUrl: "https://example.com/new", attachmentIds: ["attachment-new"] },
      referenceIds: [],
    })).rejects.toThrow("ai_content_attachments_locked");
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

  it("rejects a legacy generation start for a proposal-v2 generation", async () => {
    const pool = createPool();
    pool.setGenerationStatus("draft");
    pool.setGenerationDraft({
      origin: "proposal-v2",
      proposalId: "74000000-0000-4000-8000-000000000007",
      approvedProposalVersionId: "77000000-0000-4000-8000-000000000007",
    });
    const repository = createAiContentRepository(pool as never);

    await expect(repository.startAiContentGeneration({
      ...scope,
      generationId: "generation-1",
      idempotencyKey: "legacy-start",
      outputCount: 1,
      usageDate: "2026-08-01",
      dailyGenerationLimit: 10,
    })).rejects.toThrow(/^ai_content_v3_contract_required$/);
    expect(pool.sql.some((sql) => sql.includes("insert into ai_content_generation_outputs"))).toBe(false);
  });

  it("starts final generation without requesting or waiting for Wiki data", async () => {
    const pool = createPool({ wikiReady: false });
    const repository = createAiContentRepository(pool as never);
    await repository.createAiContentAnalysis({ ...input, draft: { analysisSource: "owned" } });

    const result = await repository.startAiContentGeneration({ ...scope, generationId: "generation-1", idempotencyKey: "generation-wiki", outputCount: 1, usageDate: "2026-07-18", dailyGenerationLimit: 10 });

    expect(pool.sql.join("\n")).not.toContain("insert into wiki_build_requests");
    expect(pool.sql.join("\n")).toContain("'waitForOwnedContext', $5::boolean");
    expect(result.currentStage).toBe("analysis");
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

  it("uses a new quota date exactly at the KST midnight boundary", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-18T14:59:59.999Z"));
      expect(kstDateKey(new Date())).toBe("2026-07-18");

      vi.setSystemTime(new Date("2026-07-18T15:00:00.000Z"));
      expect(kstDateKey(new Date())).toBe("2026-07-19");
    } finally {
      vi.useRealTimers();
    }
  });

  it("performs optional brand-intelligence provider I/O before opening the final-start transaction", async () => {
    const pool = createPool();
    let transactionWasOpen = false;
    const repository = createAiContentRepository(pool as never, {
      brandIntelligenceProvider: {
        getConfirmed: vi.fn(async () => {
          transactionWasOpen = pool.commands.includes("BEGIN");
          return null;
        }),
      },
    });
    await repository.createAiContentAnalysis(input);
    await repository.updateAiContentDraft({
      ...scope,
      generationId: "generation-1",
      draft: { analysisSource: "owned" },
      referenceIds: [],
    });
    pool.setGenerationStatus("analysis_ready");
    pool.commands.length = 0;

    await expect(repository.startAiContentGeneration({
      ...scope,
      generationId: "generation-1",
      idempotencyKey: "provider-before-transaction",
      outputCount: 1,
      usageDate: "2026-07-18",
      dailyGenerationLimit: 10,
    })).rejects.toThrow("brand_intelligence_required");

    expect(transactionWasOpen).toBe(false);
  });

  it("returns an idempotent owned replay without calling a throwing provider", async () => {
    const pool = createPool();
    const getConfirmed = vi.fn(async () => {
      throw new Error("provider_unavailable");
    });
    const repository = createAiContentRepository(pool as never, {
      brandIntelligenceProvider: { getConfirmed },
    });
    pool.setGenerationStatus("analyzing");
    pool.setGenerationDraft({ analysisSource: "owned" });
    pool.setGenerationIdempotencyKey("existing-generation");

    await expect(repository.startAiContentGeneration({
      ...scope,
      generationId: "generation-1",
      idempotencyKey: "existing-generation",
      outputCount: 1,
      usageDate: "2026-07-18",
      dailyGenerationLimit: 10,
    })).resolves.toMatchObject({ id: "generation-1", status: "analyzing" });

    expect(getConfirmed).not.toHaveBeenCalled();
  });

  it("starts a non-owned generation without calling the configured provider", async () => {
    const pool = createPool();
    const getConfirmed = vi.fn(async () => {
      throw new Error("provider_unavailable");
    });
    const repository = createAiContentRepository(pool as never, {
      brandIntelligenceProvider: { getConfirmed },
    });
    pool.setGenerationStatus("analysis_ready");
    pool.setGenerationDraft({ analysisSource: "manual" });

    await expect(repository.startAiContentGeneration({
      ...scope,
      generationId: "generation-1",
      idempotencyKey: "non-owned-generation",
      outputCount: 1,
      usageDate: "2026-07-18",
      dailyGenerationLimit: 10,
    })).resolves.toMatchObject({ id: "generation-1", status: "analyzing" });

    expect(getConfirmed).not.toHaveBeenCalled();
  });

  it("claims only the requested content type with a recoverable lease", async () => {
    const pool = createWorkerPool();
    const repository = createAiContentRepository(pool as never);
    const job = await repository.claimAiContentJob({ contentType: "card_news", workerId: "card-worker-1", leaseSeconds: 180 });
    expect(job).toMatchObject({ id: "job-1", contentType: "card_news", status: "processing", workerId: "card-worker-1" });
    expect(job?.payload.contentGenerationInput).toEqual(contentGenerationInputV2Fixture);
    const generationLock = pool.sql.findIndex((sql) =>
      sql.includes("from ai_content_generations") && sql.includes("for update"));
    const outputLock = pool.sql.findIndex((sql) =>
      sql.includes("from ai_content_generation_outputs") && sql.includes("for update"));
    const jobLock = pool.sql.findIndex((sql) =>
      sql.includes("from ai_content_generation_jobs") && sql.includes("for update"));
    expect(generationLock).toBeGreaterThanOrEqual(0);
    expect(outputLock).toBeGreaterThan(generationLock);
    expect(jobLock).toBeGreaterThan(outputLock);
    expect(pool.sql.join("\n")).toContain("content_type = $1");
    expect(pool.sql.join("\n")).not.toContain("select generation.draft_json");
    expect(pool.sql.join("\n")).not.toContain("from brands brand");
  });

  it("strips Wiki and FAQ data from already queued legacy worker payloads", async () => {
    const queued = structuredClone(contentGenerationInputV2Fixture) as Record<string, unknown>;
    queued.brandContext = {
      wikiVersionId: "wiki-legacy",
      context: {
        wiki: { pages: [{ content: "legacy wiki body" }] },
        nested: { faqData: [{ answer: "legacy faq body" }] },
      },
    };
    const pool = createWorkerPool({ subjectAnalysisSnapshot: queued });
    const repository = createAiContentRepository(pool as never);

    const job = await repository.claimAiContentJob({
      contentType: "card_news",
      workerId: "card-worker-legacy",
      leaseSeconds: 180,
    });

    expect(JSON.stringify(job?.payload.contentGenerationInput)).not.toMatch(/wiki|faq/i);
  });

  it("claims generation jobs without a Wiki readiness gate", async () => {
    const pool = createWorkerPool();
    const repository = createAiContentRepository(pool as never);

    await repository.claimAiContentJob({
      contentType: "card_news",
      workerId: "card-worker-v3",
      leaseSeconds: 180,
    });

    const candidateSql = pool.sql.find((sql) => sql.includes("limit 25"))!;
    expect(candidateSql).not.toContain("wiki_versions");
    expect(candidateSql).not.toContain("wiki_pages");
  });

  it("rejects a heartbeat from a different lease owner", async () => {
    const pool = createWorkerPool();
    const repository = createAiContentRepository(pool as never);
    await repository.claimAiContentJob({ contentType: "card_news", workerId: "card-worker-1", leaseSeconds: 180 });
    await expect(repository.heartbeatAiContentJob({ jobId: "job-1", workerId: "wrong-worker", leaseToken: "wrong-token", leaseSeconds: 180 })).resolves.toBe(false);
  });

  it("extends heartbeat timestamps from the actual current DB clock", async () => {
    const pool = createWorkerPool();
    const repository = createAiContentRepository(pool as never);
    const claimed = await repository.claimAiContentJob({
      contentType: "card_news",
      workerId: "card-worker-1",
      leaseSeconds: 180,
    });

    await expect(repository.heartbeatAiContentJob({
      jobId: "job-1",
      workerId: "card-worker-1",
      leaseToken: claimed!.leaseToken!,
      leaseSeconds: 180,
    })).resolves.toBe(true);
    const heartbeatSql = pool.sql.find((sql) =>
      sql.includes("set (lease_expires_at, last_heartbeat_at)"));
    expect(heartbeatSql).toContain(
      "heartbeat.at + ($4::text || ' seconds')::interval",
    );
    expect(heartbeatSql).toContain("select clock_timestamp() as at");
    expect(heartbeatSql).toContain("lease_expires_at > clock_timestamp()");
  });

  it.each(["complete", "fail"] as const)(
    "rejects %s when the lease equals the current DB clock after locks are acquired",
    async (operation) => {
    const pool = createWorkerPool();
    const repository = createAiContentRepository(pool as never);
    const claimed = await repository.claimAiContentJob({
      contentType: "card_news",
      workerId: "card-worker-1",
      leaseSeconds: 180,
    });
    pool.expireLeaseAtBoundary();

    const result = operation === "complete"
      ? repository.completeAiContentJob({
          jobId: "job-1",
          workerId: "card-worker-1",
          leaseToken: claimed!.leaseToken!,
          skillVersion: "card-news-skill.v1",
          jobType: "generate",
          manifestUrl: "https://blob.example.com/manifest.json",
          manifest: {
            version: "ai-content.v1",
            type: "card_news",
            title: "여름 추천",
            assets: [{
              role: "slide",
              url: "https://blob.example.com/slide.png",
              fileName: "slide.png",
              mimeType: "image/png",
              width: 1080,
              height: 1080,
              index: 1,
            }],
            content: { caption: "내용", hashtags: ["여름"], cta: "저장하세요" },
          },
        })
      : repository.failAiContentJob({
          jobId: "job-1",
          workerId: "card-worker-1",
          leaseToken: claimed!.leaseToken!,
          errorCode: "equal_boundary",
          errorMessage: "equal",
          retryable: false,
        });
    await expect(result).rejects.toThrow("ai_content_job_lease_invalid");
    expect(pool.sql.join("\n")).toContain(
      "lease_expires_at <= clock_timestamp() as lease_expired",
    );
    },
  );

  it("completes a generated manifest idempotently", async () => {
    const pool = createWorkerPool();
    const repository = createAiContentRepository(pool as never);
    const claimed = await repository.claimAiContentJob({ contentType: "card_news", workerId: "card-worker-1", leaseSeconds: 180 });
    const completionSqlStart = pool.sql.length;
    const completion = {
      jobId: "job-1", workerId: "card-worker-1", leaseToken: claimed!.leaseToken!, skillVersion: "card-news-skill.v1", jobType: "generate" as const,
      manifestUrl: "https://blob.example.com/manifest.json",
      manifest: { version: "ai-content.v1" as const, type: "card_news" as const, title: "여름 추천", assets: [{ role: "slide" as const, url: "https://blob.example.com/slide.png", fileName: "slide.png", mimeType: "image/png" as const, width: 1080, height: 1080, index: 1 }], content: { caption: "내용", hashtags: ["여름"], cta: "저장하세요" } },
    };
    const first = await repository.completeAiContentJob(completion);
    const second = await repository.completeAiContentJob(completion);
    expect(first.id).toBe(second.id);
    expect(first.status).toBe("completed");
    expect(first.terminalAt).not.toBeNull();
    expect(first.retryableUntil).not.toBeNull();
    expect(second.terminalAt).toBe(first.terminalAt);
    expect(second.retryableUntil).toBe(first.retryableUntil);
    const completionSql = pool.sql.slice(completionSqlStart);
    const generationLock = completionSql.findIndex((sql) =>
      sql.includes("from ai_content_generations") && sql.includes("for update"));
    const outputLock = completionSql.findIndex((sql) =>
      sql.includes("from ai_content_generation_outputs") && sql.includes("for update"));
    const jobLock = completionSql.findIndex((sql) =>
      sql.includes("from ai_content_generation_jobs") && sql.includes("for update"));
    const outputAggregate = completionSql.findIndex((sql) =>
      sql.includes("count(*)::integer as total"));
    expect(generationLock).toBeGreaterThanOrEqual(0);
    expect(outputLock).toBeGreaterThan(generationLock);
    expect(jobLock).toBeGreaterThan(outputLock);
    expect(outputAggregate).toBeGreaterThan(generationLock);
  });

  it("stores a V3 planner result once and queues only per-asset render work without completing the output", async () => {
    const pool = createWorkerPool({
      generationId: v3GenerationId,
      outputId: v3OutputId,
      finalInputV3: v3FinalInputFixture,
    });
    const repository = createAiContentRepository(pool as never);
    const claimed = await repository.claimAiContentJob({ contentType: "card_news", workerId: "planner-1", leaseSeconds: 180 });
    const completion = {
      jobId: "job-1", workerId: "planner-1", leaseToken: claimed!.leaseToken!,
      skillVersion: "card-news-plan.v2", jobType: "generate" as const,
      plan: v3CardPlanFixture as never,
    };

    await expect(repository.completeAiContentJob(completion)).resolves.toMatchObject({ id: v3GenerationId });
    await expect(repository.completeAiContentJob(completion)).resolves.toMatchObject({ id: v3GenerationId });
    expect(pool.sql.join("\n")).toContain("plan_json=coalesce");
    expect(pool.sql.join("\n")).toContain("insert into ai_content_generation_render_jobs");
    expect(pool.sql.join("\n")).not.toContain("artifact_manifest_json = $4::jsonb");

    await expect(repository.completeAiContentJob({
      ...completion,
      plan: { ...v3CardPlanFixture, content: { ...v3CardPlanFixture.content, caption: "Different" } } as never,
    })).rejects.toThrow("ai_content_plan_completion_conflict");
  });

  it("binds generate completion shape to the locked generation input contract version", async () => {
    const v3Pool = createWorkerPool({
      generationId: v3GenerationId,
      outputId: v3OutputId,
      finalInputV3: v3FinalInputFixture,
    });
    const v3Repository = createAiContentRepository(v3Pool as never);
    const v3Claim = await v3Repository.claimAiContentJob({ contentType: "card_news", workerId: "planner-1", leaseSeconds: 180 });

    await expect(v3Repository.completeAiContentJob({
      jobId: "job-1", workerId: "planner-1", leaseToken: v3Claim!.leaseToken!,
      skillVersion: "legacy-card.v1", jobType: "generate",
      manifestUrl: "https://blob.example.com/manifest.json",
      manifest: {
        version: "ai-content.v1", type: "card_news", title: "Legacy bypass",
        assets: [{ role: "slide", index: 1, url: "https://blob.example.com/slide.png", fileName: "slide.png", mimeType: "image/png", width: 1080, height: 1080 }],
        content: { caption: "Bypass", hashtags: [], cta: "Read" },
      },
    })).rejects.toThrow("ai_content_job_completion_contract_mismatch");
    expect(v3Pool.sql.join("\n")).not.toContain("artifact_manifest_json = $4::jsonb");

    const legacyPool = createWorkerPool();
    const legacyRepository = createAiContentRepository(legacyPool as never);
    const legacyClaim = await legacyRepository.claimAiContentJob({ contentType: "card_news", workerId: "legacy-worker", leaseSeconds: 180 });
    await expect(legacyRepository.completeAiContentJob({
      jobId: "job-1", workerId: "legacy-worker", leaseToken: legacyClaim!.leaseToken!,
      skillVersion: "card-news-plan.v2", jobType: "generate", plan: v3CardPlanFixture as never,
    })).rejects.toThrow("ai_content_job_completion_contract_mismatch");
    expect(legacyPool.sql.join("\n")).not.toContain("insert into ai_content_generation_render_jobs");
  });

  it("merges an individual-card revision without replacing successful sibling cards or copy", async () => {
    const previousManifest = {
      version: "ai-content.v1",
      type: "card_news",
      title: "기존 제목",
      assets: [
        { role: "slide", url: "https://blob.example.com/old-1.png", fileName: "slide-01.png", mimeType: "image/png", width: 1080, height: 1080, index: 1 },
        { role: "slide", url: "https://blob.example.com/old-2.png", fileName: "slide-02.png", mimeType: "image/png", width: 1080, height: 1080, index: 2 },
      ],
      content: { caption: "기존 카피", hashtags: ["기존"], cta: "기존 CTA" },
    };
    const pool = createWorkerPool({
      revision: {
        contractVersion: "ai-content-revision.v1",
        action: "regenerate_card",
        idempotencyKey: "revision-card-2",
        cardIndex: 2,
        previousManifest,
        previousContent: previousManifest.content,
      },
    });
    const repository = createAiContentRepository(pool as never);
    const claimed = await repository.claimAiContentJob({
      contentType: "card_news",
      workerId: "card-worker-1",
      leaseSeconds: 180,
    });

    await repository.completeAiContentJob({
      jobId: "job-1",
      workerId: "card-worker-1",
      leaseToken: claimed!.leaseToken!,
      skillVersion: "card-news-skill.v7",
      jobType: "generate",
      manifestUrl: "https://blob.example.com/manifest.json",
      manifest: {
        version: "ai-content.v1",
        type: "card_news",
        title: "새 제목",
        assets: [
          { role: "slide", url: "https://blob.example.com/new-1.png", fileName: "slide-01.png", mimeType: "image/png", width: 1080, height: 1080, index: 1 },
          { role: "slide", url: "https://blob.example.com/new-2.png", fileName: "slide-02.png", mimeType: "image/png", width: 1080, height: 1080, index: 2 },
        ],
        content: { caption: "새 카피", hashtags: ["새"], cta: "새 CTA" },
      },
    });

    expect(pool.completedOutputManifests.at(-1)).toMatchObject({
      title: "기존 제목",
      assets: [
        expect.objectContaining({ index: 1, url: "https://blob.example.com/old-1.png" }),
        expect.objectContaining({ index: 2, url: "https://blob.example.com/new-2.png" }),
      ],
      content: previousManifest.content,
    });
    expect(pool.completedOutputContents.at(-1)).toEqual(previousManifest.content);
  });

  it("retains temporary attachments after every output completes", async () => {
    const pool = createWorkerPool();
    const repository = createAiContentRepository(pool as never);
    const claimed = await repository.claimAiContentJob({ contentType: "card_news", workerId: "card-worker-1", leaseSeconds: 180 });

    await repository.completeAiContentJob({
      jobId: "job-1", workerId: "card-worker-1", leaseToken: claimed!.leaseToken!, skillVersion: "card-news-skill.v3", jobType: "generate",
      manifestUrl: "https://blob.example.com/manifest.json",
      manifest: { version: "ai-content.v1", type: "card_news", title: "여름 추천", assets: [{ role: "slide", url: "https://blob.example.com/slide.png", fileName: "slide.png", mimeType: "image/png", width: 1080, height: 1080, index: 1 }], content: { caption: "내용", hashtags: ["여름"], cta: "저장하세요" } },
    });

    expect(pool.sql.join("\n")).not.toContain("deleted_at = now()");
  });

  it("keeps temporary attachments while another output is pending", async () => {
    const pool = createWorkerPool({ totalOutputs: 2 });
    const repository = createAiContentRepository(pool as never);
    const claimed = await repository.claimAiContentJob({ contentType: "card_news", workerId: "card-worker-1", leaseSeconds: 180 });

    const generation = await repository.completeAiContentJob({
      jobId: "job-1", workerId: "card-worker-1", leaseToken: claimed!.leaseToken!, skillVersion: "card-news-skill.v3", jobType: "generate",
      manifestUrl: "https://blob.example.com/manifest.json",
      manifest: { version: "ai-content.v1", type: "card_news", title: "여름 추천", assets: [{ role: "slide", url: "https://blob.example.com/slide.png", fileName: "slide.png", mimeType: "image/png", width: 1080, height: 1080, index: 1 }], content: { caption: "내용", hashtags: ["여름"], cta: "저장하세요" } },
    });

    expect(generation.status).toBe("generating");
  });

  it.each([
    { name: "all outputs fail", poolOptions: { totalOutputs: 1 } },
    { name: "some outputs fail", poolOptions: { totalOutputs: 2, completedOutputs: 1 } },
  ])("retains temporary attachments when $name", async ({ poolOptions }) => {
    const pool = createWorkerPool(poolOptions);
    const repository = createAiContentRepository(pool as never);
    const claimed = await repository.claimAiContentJob({ contentType: "card_news", workerId: "card-worker-1", leaseSeconds: 180 });

    const generation = await repository.failAiContentJob({
      jobId: "job-1",
      workerId: "card-worker-1",
      leaseToken: claimed!.leaseToken!,
      errorCode: "render_failed",
      errorMessage: "render failed",
      retryable: false,
    });

    expect(["failed", "partial_failed"]).toContain(generation.status);
    if (poolOptions.totalOutputs === 1) {
      expect(generation.status).toBe("failed");
      expect(generation.terminalAt).not.toBeNull();
      expect(generation.retryableUntil).not.toBeNull();
      expect(
        Date.parse(generation.retryableUntil!) - Date.parse(generation.terminalAt!),
      ).toBe(15 * 24 * 60 * 60 * 1_000);
    }
  });

  it("does not run the legacy cleanup manifest scan while final assets are recorded", async () => {
    const finalUrl = "https://blob.example.com/final-slide.png";
    const pool = createWorkerPool({
      attachmentUrls: ["https://blob.example.com/reference.png", finalUrl],
      manifestAssetUrls: [finalUrl],
    });
    const repository = createAiContentRepository(pool as never);
    const claimed = await repository.claimAiContentJob({ contentType: "card_news", workerId: "card-worker-1", leaseSeconds: 180 });

    await repository.completeAiContentJob({
      jobId: "job-1", workerId: "card-worker-1", leaseToken: claimed!.leaseToken!, skillVersion: "card-news-skill.v3", jobType: "generate",
      manifestUrl: "https://blob.example.com/manifest.json",
      manifest: { version: "ai-content.v1", type: "card_news", title: "여름 추천", assets: [{ role: "slide", url: finalUrl, fileName: "slide.png", mimeType: "image/png", width: 1080, height: 1080, index: 1 }], content: { caption: "내용", hashtags: ["여름"], cta: "저장하세요" } },
    });

    expect(pool.sql.join("\n")).not.toContain("select manifest_url, artifact_manifest_json");
  });

  it("does not invoke the legacy terminal cleanup retry path", async () => {
    const pool = createWorkerPool();
    const repository = createAiContentRepository(pool as never);
    const claimed = await repository.claimAiContentJob({ contentType: "card_news", workerId: "card-worker-1", leaseSeconds: 180 });

    await repository.completeAiContentJob({
      jobId: "job-1", workerId: "card-worker-1", leaseToken: claimed!.leaseToken!, skillVersion: "card-news-skill.v3", jobType: "generate",
      manifestUrl: "https://blob.example.com/manifest.json",
      manifest: { version: "ai-content.v1", type: "card_news", title: "여름 추천", assets: [{ role: "slide", url: "https://blob.example.com/slide.png", fileName: "slide.png", mimeType: "image/png", width: 1080, height: 1080, index: 1 }], content: { caption: "내용", hashtags: ["여름"], cta: "저장하세요" } },
    });

    expect(pool.sql.join("\n")).not.toContain("deleted_at = now()");

    pool.enablePendingCleanup();
    await repository.claimAiContentJob({ contentType: "card_news", workerId: "card-worker-1", leaseSeconds: 180 });
    expect(pool.sql.join("\n")).not.toContain("select terminal_generation.id");
    expect(pool.sql.join("\n")).not.toContain("jsonb_array_elements");
    expect(pool.sql.join("\n")).not.toContain("deleted_at = now()");
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
    expect(pool.sql.join("\n")).toContain("values ($1, $2, $3, $4, 'generate', $5, 'queued', $6::jsonb)");
    expect(pool.sql.join("\n")).not.toContain("jsonb_set(subject_analysis_snapshot, '{message,qualityBrief}'");
    expect(pool.generatedJobPayloads).toHaveLength(2);
    expect((pool.generatedJobPayloads[0] as Record<string, unknown>).contentGenerationInput)
      .toEqual((pool.generatedJobPayloads[1] as Record<string, unknown>).contentGenerationInput);
    expect(pool.generatedJobPayloads[0]).toMatchObject({
      contentGenerationInput: {
        message: { qualityBrief: expect.objectContaining({ hook: "승인 지연의 원인" }) },
      },
    });
  });

  it("keeps the already-finalized generate payload immutable instead of overlaying live analysis", async () => {
    const snapshot = structuredClone(contentGenerationInputV2Fixture);
    const finalBrief = { version: "content-quality.v1", hook: "최종 편집안" };
    const pool = createWorkerPool({ subjectAnalysisSnapshot: snapshot, qualityBrief: finalBrief });
    const repository = createAiContentRepository(pool as never);

    const claimed = await repository.claimAiContentJob({ contentType: "card_news", workerId: "card-worker-1", leaseSeconds: 180 });

    expect(claimed?.payload.contentGenerationInput).toMatchObject({
      message: { qualityBrief: { hook: "사용자 입력" } },
    });
    expect(snapshot.message.qualityBrief).toEqual({ hook: "사용자 입력" });
    expect(pool.sql.join("\n")).not.toContain("select generation.draft_json");
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

  it("authenticates terminal generation failure replays with the original worker and lease", async () => {
    const pool = createWorkerPool();
    const repository = createAiContentRepository(pool as never);
    const claimed = await repository.claimAiContentJob({ contentType: "card_news", workerId: "card-worker-1", leaseSeconds: 180 });
    const failure = { jobId: "job-1", workerId: "card-worker-1", leaseToken: claimed!.leaseToken!, errorCode: "render_failed", errorMessage: "failed", retryable: false };
    await repository.failAiContentJob(failure);

    await expect(repository.failAiContentJob({ ...failure, workerId: "other-worker" })).rejects.toThrow("ai_content_job_lease_invalid");
    await expect(repository.failAiContentJob({ ...failure, leaseToken: "wrong-token" })).rejects.toThrow("ai_content_job_lease_invalid");
    await expect(repository.failAiContentJob(failure)).resolves.toMatchObject({ id: "generation-1" });
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
    const generationLock = pool.sql.findIndex((sql) =>
      sql.includes("from ai_content_generations") && sql.includes("for update"));
    const outputLock = pool.sql.findIndex((sql) =>
      sql.includes("from ai_content_generation_outputs") && sql.includes("for update"));
    const jobLock = pool.sql.findIndex((sql) =>
      sql.includes("from ai_content_generation_jobs") && sql.includes("for update"));
    expect(generationLock).toBeGreaterThanOrEqual(0);
    expect(outputLock).toBeGreaterThan(generationLock);
    expect(jobLock).toBeGreaterThan(outputLock);
  });

  it("records the exact 15-day retention window on every generation terminal transition", async () => {
    const completed = createWorkerPool({ totalOutputs: 1 });
    const completedRepository = createAiContentRepository(completed as never);
    const completedClaim = await completedRepository.claimAiContentJob({
      contentType: "card_news",
      workerId: "card-worker-1",
      leaseSeconds: 180,
    });
    await completedRepository.completeAiContentJob({
      jobId: "job-1",
      workerId: "card-worker-1",
      leaseToken: completedClaim!.leaseToken!,
      skillVersion: "card-news-skill.v5",
      jobType: "generate",
      manifestUrl: "https://blob.example.com/manifest.json",
      manifest: {
        version: "ai-content.v1",
        type: "card_news",
        title: "완료",
        assets: [{
          role: "slide",
          url: "https://blob.example.com/slide.png",
          fileName: "slide.png",
          mimeType: "image/png",
          width: 1080,
          height: 1080,
          index: 1,
        }],
        content: { caption: "내용", hashtags: ["완료"], cta: "저장하세요" },
      },
    });

    const failed = createWorkerPool({ totalOutputs: 2, completedOutputs: 1 });
    const failedRepository = createAiContentRepository(failed as never);
    const failedClaim = await failedRepository.claimAiContentJob({
      contentType: "card_news",
      workerId: "card-worker-1",
      leaseSeconds: 180,
    });
    await failedRepository.failAiContentJob({
      jobId: "job-1",
      workerId: "card-worker-1",
      leaseToken: failedClaim!.leaseToken!,
      errorCode: "generation_failed",
      errorMessage: "failed",
      retryable: false,
    });

    for (const statements of [completed.sql.join("\n"), failed.sql.join("\n")]) {
      expect(statements).toContain("terminal_at = case");
      expect(statements).toContain("retryable_until = case");
      expect(statements).toContain("interval '15 days'");
      expect(statements).toContain("status not in ('completed','partial_failed','failed')");
    }
  });

  it("records retention for non-retryable analysis failure and exhausted leases", async () => {
    const analysis = createWorkerPool({ jobType: "analyze" });
    const analysisRepository = createAiContentRepository(analysis as never);
    const claim = await analysisRepository.claimAiContentJob({
      contentType: "card_news",
      workerId: "card-worker-1",
      leaseSeconds: 180,
    });
    await analysisRepository.failAiContentJob({
      jobId: "job-1",
      workerId: "card-worker-1",
      leaseToken: claim!.leaseToken!,
      errorCode: "analysis_failed",
      errorMessage: "failed",
      retryable: false,
    });
    const exhausted = createWorkerPool({ exhaustedJob: true });
    await createAiContentRepository(exhausted as never).claimAiContentJob({
      contentType: "card_news",
      workerId: "card-worker-1",
      leaseSeconds: 180,
    });

    for (const statements of [analysis.sql.join("\n"), exhausted.sql.join("\n")]) {
      expect(statements).toContain("terminal_at");
      expect(statements).toContain("retryable_until");
      expect(statements).toContain("interval '15 days'");
    }
  });

  it("only retries failed outputs", async () => {
    const pool = createWorkerPool({ outputStatus: "completed" });
    const repository = createAiContentRepository(pool as never);
    await expect(repository.retryAiContentOutput({ ...scope, outputId: "output-1" })).rejects.toThrow("ai_content_output_not_failed");
  });

  it("uses the strict DB-time retention boundary before, at, and after expiry", async () => {
    const before = createWorkerPool({
      outputStatus: "failed",
      retryBoundary: "before",
      priorGeneratePayload: {
        generationId: "generation-1",
        outputId: "output-1",
        contentGenerationInput: contentGenerationInputV2Fixture,
      },
    });
    await expect(createAiContentRepository(before as never).retryAiContentOutput({
      ...scope,
      outputId: "output-1",
    })).resolves.toMatchObject({ status: "queued" });

    for (const retryBoundary of ["equal", "after"] as const) {
      const pool = createWorkerPool({ outputStatus: "failed", retryBoundary });
      const repository = createAiContentRepository(pool as never);
      await expect(repository.retryAiContentOutput({ ...scope, outputId: "output-1" }))
        .rejects.toThrow("ai_content_attachment_retention_expired");
    }
  });

  it("locks generation then output then deletion jobs and rejects a committed deletion", async () => {
    const pool = createWorkerPool({
      outputStatus: "failed",
      retryable: true,
      deletionStatus: "deleting",
      priorGeneratePayload: {
        generationId: "generation-1",
        outputId: "output-1",
        contentGenerationInput: {
          ...contentGenerationInputV2Fixture,
          attachments: [{
            id: "attachment-1",
            role: "product",
            fileName: "product.png",
            mimeType: "image/png",
            sizeBytes: 100,
            checksum: "a".repeat(64),
            storageUrl: "https://blob.example.com/product.png",
            storagePath: "retained/product.png",
          }],
        },
      },
    });
    const repository = createAiContentRepository(pool as never);

    await expect(repository.retryAiContentOutput({ ...scope, outputId: "output-1" }))
      .rejects.toThrow("ai_content_attachment_retention_expired");
    const statements = pool.sql;
    const generationLock = statements.findIndex((sql) =>
      sql.includes("from ai_content_generations") && sql.includes("for update"));
    const outputLock = statements.findIndex((sql) =>
      sql.includes("from ai_content_generation_outputs") && sql.includes("for update"));
    const deletionLock = statements.findIndex((sql) =>
      sql.includes("from ai_content_attachment_deletion_jobs") && sql.includes("for update"));
    expect(generationLock).toBeGreaterThanOrEqual(0);
    expect(outputLock).toBeGreaterThan(generationLock);
    expect(deletionLock).toBeGreaterThan(outputLock);
  });

  it("keeps retry job creation and its snapshot hold inside one transaction", async () => {
    const pool = createWorkerPool({
      outputStatus: "failed",
      retryable: true,
      priorGeneratePayload: {
        outputId: "output-1",
        generationId: "generation-1",
        contentGenerationInput: contentGenerationInputV2Fixture,
      },
    });
    await createAiContentRepository(pool as never).retryAiContentOutput({
      ...scope,
      outputId: "output-1",
    });

    const begin = pool.sql.indexOf("BEGIN");
    const insert = pool.sql.findIndex((sql) =>
      sql.includes("insert into ai_content_generation_jobs") && sql.includes("'generate'"));
    const commit = pool.sql.indexOf("COMMIT");
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThan(begin);
    expect(commit).toBeGreaterThan(insert);
    expect(pool.generatedJobPayloads.at(-1)).toEqual({
      outputId: "output-1",
      generationId: "generation-1",
      contentGenerationInput: contentGenerationInputV2Fixture,
    });
  });

  it("reuses the stored content-generation-input.v2 snapshot when retrying a failed output", async () => {
    const generationSnapshot = structuredClone(contentGenerationInputV2Fixture);
    const finalizedSnapshot = structuredClone(contentGenerationInputV2Fixture);
    finalizedSnapshot.message.qualityBrief = { hook: "최초 확정 quality brief" };
    const priorPayload = {
      generationId: "generation-1",
      outputId: "output-1",
      contentGenerationInput: finalizedSnapshot,
    };
    const pool = createWorkerPool({
      outputStatus: "failed",
      subjectAnalysisSnapshot: generationSnapshot,
      priorGeneratePayload: priorPayload,
    });
    const repository = createAiContentRepository(pool as never);

    await expect(repository.retryAiContentOutput({ ...scope, outputId: "output-1" }))
      .resolves.toMatchObject({ id: "generation-1", status: "queued" });
    const claimed = await repository.claimAiContentJob({
      contentType: "card_news",
      workerId: "card-worker-1",
      leaseSeconds: 180,
    });

    expect(claimed?.payload).toEqual(priorPayload);
    expect(pool.generatedJobPayloads.at(-1)).toEqual(priorPayload);
  });

  it("synthesizes the finalized worker input only for the explicit legacy retry fallback", async () => {
    const legacySnapshot = structuredClone(contentGenerationInputV2Fixture);
    const finalQualityBrief = { hook: "legacy finalized quality brief", sourceGaps: [] };
    const pool = createWorkerPool({
      outputStatus: "failed",
      subjectAnalysisSnapshot: legacySnapshot,
      qualityBrief: finalQualityBrief,
    });
    const repository = createAiContentRepository(pool as never);

    await repository.retryAiContentOutput({ ...scope, outputId: "output-1" });

    expect(pool.generatedJobPayloads.at(-1)).toEqual({
      generationId: "generation-1",
      outputId: "output-1",
      contentGenerationInput: {
        ...legacySnapshot,
        orchestration: null,
        message: {
          ...legacySnapshot.message,
          qualityBrief: finalQualityBrief,
        },
      },
    });
    expect(pool.sql.join("\n")).toContain("generation_input_snapshot, analysis_json");
  });

  it("queues an idempotent scoped hook revision without replacing unrelated completed outputs", async () => {
    const priorPayload = {
      generationId: "generation-1",
      outputId: "output-1",
      contentGenerationInput: contentGenerationInputV2Fixture,
    };
    const manifest = {
      version: "ai-content.v1",
      type: "card_news",
      assets: [{ index: 1, url: "https://cdn.example.com/slide-01.png" }],
      content: { caption: "기존 카피", hashtags: ["기존"], cta: "기존 CTA" },
    };
    const pool = createWorkerPool({
      outputStatus: "completed",
      priorGeneratePayload: priorPayload,
      outputManifest: manifest,
      outputContent: { caption: "기존 카피" },
      totalOutputs: 2,
      completedOutputs: 1,
    });
    const repository = createAiContentRepository(pool as never);

    await expect(repository.reviseAiContentOutput({
      ...scope,
      outputId: "output-1",
      action: "regenerate_hook",
      idempotencyKey: "revision-hook-1",
    })).resolves.toMatchObject({
      id: "generation-1",
      status: "queued",
      outputs: [{ id: "output-1", status: "queued" }],
    });

    expect(pool.generatedJobPayloads.at(-1)).toEqual({
      ...priorPayload,
      revision: {
        contractVersion: "ai-content-revision.v1",
        action: "regenerate_hook",
        idempotencyKey: "revision-hook-1",
        cardIndex: null,
        previousManifest: manifest,
        previousContent: { caption: "기존 카피" },
      },
    });
    expect(pool.sql.join("\n")).toContain("output.id = $1 and output.workspace_id = $2 and output.brand_id = $3");
    expect(pool.sql.join("\n")).not.toContain("update ai_content_generation_outputs\n              set artifact_manifest_json");
  });

  it("returns the current generation for the same revision idempotency key", async () => {
    const pool = createWorkerPool({
      outputStatus: "queued",
      existingRevisionIdempotencyKey: "revision-card-1",
      outputManifest: {
        type: "card_news",
        assets: [
          { index: 1, url: "https://cdn.example.com/slide-01.png" },
          { index: 2, url: "https://cdn.example.com/slide-02.png" },
        ],
      },
    });
    const repository = createAiContentRepository(pool as never);

    await repository.reviseAiContentOutput({
      ...scope,
      outputId: "output-1",
      action: "regenerate_card",
      cardIndex: 2,
      idempotencyKey: "revision-card-1",
    });

    expect(pool.generatedJobPayloads).toHaveLength(0);
  });

  it("saves format-aware copy fields idempotently inside the tenant-scoped output", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    let content = {
      hook: "기존 훅",
      keyMessage: "기존 핵심 메시지",
      body: "기존 본문",
      cta: "기존 CTA",
      caption: "기존 캡션",
      hashtags: ["기존"],
      untouched: "보존",
    };
    let manifest = {
      version: "ai-content.v1",
      type: "card_news",
      assets: [{ index: 1, url: "https://cdn.example.com/slide-01.png" }],
      content: structuredClone(content),
    };
    const outputRow = () => ({
      id: "output-1",
      generation_id: "generation-1",
      output_index: 1,
      title: "여름 카드뉴스",
      status: "completed",
      content_json: structuredClone(content),
      artifact_manifest_json: structuredClone(manifest),
      manifest_url: null,
      failure_code: null,
      failure_message: null,
      downloaded_at: null,
      created_at: "2026-07-18T00:00:00.000Z",
      updated_at: "2026-07-18T00:00:00.000Z",
      completed_at: "2026-07-18T00:00:00.000Z",
    });
    const generationRow = () => ({
      ...row("generation-1", "completed"),
      outputs: undefined,
    });
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
        if (sql.includes("from ai_content_generation_outputs output") && sql.includes("for update")) {
          expect(params.slice(0, 3)).toEqual(["output-1", "workspace-1", "brand-1"]);
          return { rows: [outputRow()], rowCount: 1 };
        }
        if (sql.includes("update ai_content_generation_outputs") && sql.includes("content_json")) {
          content = JSON.parse(String(params[1]));
          manifest = JSON.parse(String(params[2]));
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("from ai_content_generations")) {
          return { rows: [generationRow()], rowCount: 1 };
        }
        if (sql.includes("from ai_content_generation_outputs") && sql.includes("order by output_index")) {
          return { rows: [outputRow()], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn(async () => client),
      query: client.query,
    };
    const repository = createAiContentRepository(pool as never);
    const input = {
      ...scope,
      outputId: "output-1",
      fields: { hook: "수정 훅", cta: "지금 확인", hashtags: ["여름", "브랜드"] },
      idempotencyKey: "save-copy-1",
    };

    const first = await repository.saveAiContentOutputCopy(input);
    const second = await repository.saveAiContentOutputCopy(input);

    expect(first.outputs?.[0].content).toMatchObject({
      hook: "수정 훅",
      cta: "지금 확인",
      hashtags: ["여름", "브랜드"],
      untouched: "보존",
    });
    expect(manifest.content).toMatchObject({
      hook: "수정 훅",
      cta: "지금 확인",
      hashtags: ["여름", "브랜드"],
      untouched: "보존",
    });
    expect(second.outputs?.[0].content).toEqual(first.outputs?.[0].content);
    expect(queries.filter(({ sql }) => sql.includes("update ai_content_generation_outputs"))).toHaveLength(1);
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

const proposalV2Scope = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  brandId: "20000000-0000-4000-8000-000000000002",
  actorUserId: "30000000-0000-4000-8000-000000000003",
};

const proposalBaseInputV2: ProposalBaseInputSnapshotV2 = {
  contractVersion: "proposal-base-input.v2",
  brandCore: {
    versionId: "40000000-0000-4000-8000-000000000004",
    companyOverview: "브랜드 개요",
    businessDescription: "사업 설명",
    primaryCategory: "교육",
    detailedCategory: "온라인 교육",
    primaryTarget: "초기 창업자",
    differentiator: "실전형",
    coreAppeal: "바로 적용",
  },
  subject: { kind: "topic_text", title: "운영 체크리스트" },
  contentInstruction: "실무 중심으로",
  product: null,
  references: [],
  outputSettings: {
    outputFormat: "card_news",
    channelTargets: ["instagram"],
    aspectRatio: "4:5",
    outputCount: 1,
    purpose: "informational",
  },
  capturedAt: "2026-08-01T03:00:00.000Z",
};

function proposalV2BatchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "50000000-0000-4000-8000-000000000005",
    workspace_id: proposalV2Scope.workspaceId,
    brand_id: proposalV2Scope.brandId,
    origin: "manual",
    content_family: "informational",
    request_json: {
      contractVersion: "content-proposal-request.v2",
      purpose: "informational",
      outputFormat: "card_news",
      channelTargets: ["instagram"],
    },
    source_snapshot_json: [],
    input_snapshot_json: {
      replayFingerprint: "f".repeat(64),
      baseInput: proposalBaseInputV2,
      resumeInput: {
        contractVersion: "content-orchestration.v2",
        brandId: proposalV2Scope.brandId,
        purpose: "informational",
        seed: { kind: "topic_text", title: "운영 체크리스트" },
        contentInstruction: "실무 중심으로",
        productId: null,
        outputSettings: {
          outputFormat: "card_news",
          channelTargets: ["instagram"],
          aspectRatio: "4:5",
          outputCount: 1,
        },
      },
    },
    status: "queued",
    error_code: null,
    error_message: null,
    created_at: "2026-08-01T03:00:00.000Z",
    updated_at: "2026-08-01T03:00:00.000Z",
    ...overrides,
  };
}

function proposalV2Transaction(options: {
  existing?: boolean;
  existingActorMatches?: boolean;
  existingRequestMatches?: boolean;
  failAt?: "snapshot" | "job";
} = {}) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
      if (sql.includes("from workspace_members member")) {
        return { rows: [{ ok: 1 }], rowCount: 1 };
      }
      if (sql.includes("from ai_content_proposal_batches") && sql.includes("request_fingerprint_matches")) {
        return options.existing
          ? {
            rows: [proposalV2BatchRow({
              actor_matches: options.existingActorMatches ?? true,
              request_fingerprint_matches: options.existingRequestMatches ?? true,
            })],
            rowCount: 1,
          }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("insert into ai_content_proposal_batches")) {
        if (options.failAt === "snapshot") throw new Error("input_snapshot_json_write_failed");
        return {
          rows: [proposalV2BatchRow({
            request_json: JSON.parse(String(params[4])),
            input_snapshot_json: JSON.parse(String(params[5])),
          })],
          rowCount: 1,
        };
      }
      if (sql.includes("insert into ai_content_proposal_jobs")) {
        if (options.failAt === "job") throw new Error("proposal_job_insert_failed");
        return { rows: [{ id: "60000000-0000-4000-8000-000000000006" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  return {
    statements,
    client,
    repository: createAiContentRepository({ connect: async () => client, query: client.query } as never),
  };
}

function createProposalBatchV2Input() {
  return {
    ...proposalV2Scope,
    origin: "manual" as const,
    idempotencyKey: "proposal-v2-1",
    purpose: "informational" as const,
    outputFormat: "card_news" as const,
    channelTarget: "instagram" as const,
    requestFingerprint: "f".repeat(64),
    inputSnapshot: proposalBaseInputV2,
  };
}

describe("AI content V2 proposal batch persistence", () => {
  it("persists the trusted base snapshot and exactly one proposal job in one transaction", async () => {
    const fixture = proposalV2Transaction();

    const result = await fixture.repository.createAiContentProposalBatchV2(
      createProposalBatchV2Input(),
    );

    expect(result).toMatchObject({
      id: "50000000-0000-4000-8000-000000000005",
      status: "queued",
      contentFamily: "informational",
      sourceSnapshots: [],
    });
    const sqlOrder = fixture.statements.map(({ sql }) => sql);
    expect(sqlOrder[0]).toBe("BEGIN");
    expect(sqlOrder.at(-1)).toBe("COMMIT");
    const batchIndex = sqlOrder.findIndex((sql) => sql.includes("insert into ai_content_proposal_batches"));
    const jobIndexes = sqlOrder
      .map((sql, index) => sql.includes("insert into ai_content_proposal_jobs") ? index : -1)
      .filter((index) => index >= 0);
    expect(jobIndexes).toEqual([batchIndex + 1]);

    const insert = fixture.statements[batchIndex]!;
    expect(insert.sql).toContain("input_snapshot_json");
    expect(insert.sql).toContain("source_snapshot_json");
    expect(insert.params.slice(0, 5)).toEqual([
      proposalV2Scope.workspaceId,
      proposalV2Scope.brandId,
      "manual",
      "informational",
      JSON.stringify({
        contractVersion: "content-proposal-request.v2",
        purpose: "informational",
        outputFormat: "card_news",
        channelTargets: ["instagram"],
        requestFingerprint: "f".repeat(64),
      }),
    ]);
    expect(JSON.parse(String(insert.params[5])).baseInput).toEqual(proposalBaseInputV2);
    expect(fixture.statements[jobIndexes[0]!]!.params).toEqual([
      proposalV2Scope.workspaceId,
      proposalV2Scope.brandId,
      "50000000-0000-4000-8000-000000000005",
    ]);
    expect(fixture.client.release).toHaveBeenCalledOnce();
  });

  it("stores only the proposal base fields without research, Wiki, FAQ, or logo data", async () => {
    const fixture = proposalV2Transaction();

    await fixture.repository.createAiContentProposalBatchV2(createProposalBatchV2Input());

    const insert = fixture.statements.find(({ sql }) => sql.includes("insert into ai_content_proposal_batches"))!;
    const envelope = JSON.parse(String(insert.params[5]));
    const snapshot = envelope.baseInput;
    expect(envelope.resumeInput).toMatchObject({
      contractVersion: "content-orchestration.v2",
      seed: { kind: "topic_text", title: "운영 체크리스트" },
    });
    expect(Object.keys(snapshot).sort()).toEqual([
      "brandCore",
      "capturedAt",
      "contentInstruction",
      "contractVersion",
      "outputSettings",
      "product",
      "references",
      "subject",
    ]);
    expect(snapshot).not.toHaveProperty("researchEvidence");
    expect(JSON.stringify(snapshot)).not.toMatch(/wiki|faq|logo/i);
  });

  it("returns only UI-safe research and selected-reference summaries for a V2 batch", async () => {
    const referenceId = "70000000-0000-4000-8000-000000000007";
    const query = vi.fn(async (_sql: string, _params: unknown[] = []) => ({
      rows: [proposalV2BatchRow({
        input_snapshot_json: {
          replayFingerprint: "f".repeat(64),
          resumeInput: {
            contractVersion: "content-orchestration.v2",
            brandId: proposalV2Scope.brandId,
            purpose: "informational",
            seed: { kind: "topic_text", title: "성과 주제" },
            contentInstruction: "성과 가설",
            productId: null,
            outputSettings: {
              outputFormat: "card_news",
              channelTargets: ["instagram"],
              aspectRatio: "1:1",
              outputCount: 1,
            },
          },
          baseInput: {
            ...proposalBaseInputV2,
            references: [{
            referenceItemId: referenceId,
            snapshotId: "80000000-0000-4000-8000-000000000008",
            roles: ["planning"],
            title: "선택 레퍼런스",
            sourceUrl: "https://reference.example/private-source",
            capturedAt: "2026-08-01T03:00:00.000Z",
            contentHash: "b".repeat(64),
            text: "고객에게 다시 내려가면 안 되는 긴 레퍼런스 원문",
            image: {
              storageUrl: "https://blob.example/reference.webp",
              storagePath: "owned/reference.webp",
              mimeType: "image/webp",
              checksum: "c".repeat(64),
            },
            }],
          },
        },
        evidence_json: {
          contractVersion: "research-evidence.v1",
          decision: "searched",
          reason: "내부 판단 이유",
          queries: ["내부 검색어"],
          capturedAt: "2026-08-01T04:00:00.000Z",
          items: [{
            id: "90000000-0000-4000-8000-000000000009",
            title: "검색 자료", url: "https://source.example/article", publisher: "Source",
            publishedAt: null, capturedAt: "2026-08-01T04:00:00.000Z",
            claimSummary: "응답에 포함하지 않을 긴 내부 요약", contentHash: "d".repeat(64),
          }],
        },
        proposals: [],
        performance_experiment_id: "6f7772c4-7c03-4e2a-86f4-7c6bf3f65ef1",
        performance_evidence_version: "a".repeat(64),
        performance_snapshot_count: 3,
        performance_captured_from: "2026-08-01T01:00:00.000Z",
        performance_captured_to: "2026-08-01T03:00:00.000Z",
      })],
      rowCount: 1,
    }));
    const repository = createAiContentRepository({ query } as never);

    const result = await repository.getAiContentProposalBatch!({
      workspaceId: proposalV2Scope.workspaceId,
      brandId: proposalV2Scope.brandId,
      batchId: "50000000-0000-4000-8000-000000000005",
    });

    expect(result).toMatchObject({
      selectedReferences: [{
        id: referenceId,
        title: "선택 레퍼런스",
        preview: { url: "https://blob.example/reference.webp", mimeType: "image/webp" },
      }],
      provenance: {
        kind: "performance_experiment",
        experimentId: "6f7772c4-7c03-4e2a-86f4-7c6bf3f65ef1",
        evidenceVersion: "a".repeat(64),
        snapshotCount: 3,
        capturedFrom: "2026-08-01T01:00:00.000Z",
        capturedTo: "2026-08-01T03:00:00.000Z",
      },
    });
    const serialized = JSON.stringify(result);
    expect(result).not.toHaveProperty("researchEvidence");
    expect(serialized).not.toContain("90000000-0000-4000-8000-000000000009");
    expect(serialized).not.toContain("긴 레퍼런스 원문");
    expect(serialized).not.toContain("내부 검색어");
    expect(serialized).not.toContain("긴 내부 요약");
    expect(serialized).not.toContain("private-source");
    expect(serialized).not.toContain("raw_metrics");
    expect(query.mock.calls[0]![0]).toContain("ai_content_proposal_research_snapshots");
    expect(query.mock.calls[0]![0]).toContain("ai_content_proposal_performance_audits");
  });

  it.each([
    ["snapshot", "input_snapshot_json_write_failed"],
    ["job", "proposal_job_insert_failed"],
  ] as const)("rolls back a %s write failure and always releases the client", async (failAt, message) => {
    const fixture = proposalV2Transaction({ failAt });

    await expect(fixture.repository.createAiContentProposalBatchV2(createProposalBatchV2Input()))
      .rejects.toThrow(message);

    expect(fixture.statements.map(({ sql }) => sql)).toContain("ROLLBACK");
    expect(fixture.statements.map(({ sql }) => sql)).not.toContain("COMMIT");
    expect(fixture.client.release).toHaveBeenCalledOnce();
  });

  it("returns an idempotent existing batch without creating another batch or job", async () => {
    const fixture = proposalV2Transaction({ existing: true });

    const result = await fixture.repository.createAiContentProposalBatchV2(
      createProposalBatchV2Input(),
    );

    expect(result.id).toBe("50000000-0000-4000-8000-000000000005");
    expect(fixture.statements.filter(({ sql }) => sql.includes("insert into ai_content_proposal_batches")))
      .toHaveLength(0);
    expect(fixture.statements.filter(({ sql }) => sql.includes("insert into ai_content_proposal_jobs")))
      .toHaveLength(0);
    expect(fixture.statements.map(({ sql }) => sql).at(-1)).toBe("COMMIT");
    expect(fixture.client.release).toHaveBeenCalledOnce();
  });

  it("replays the same normalized request even when the newly captured snapshot time differs", async () => {
    const fixture = proposalV2Transaction({ existing: true });

    const result = await fixture.repository.createAiContentProposalBatchV2({
      ...createProposalBatchV2Input(),
      inputSnapshot: {
        ...proposalBaseInputV2,
        capturedAt: "2026-08-02T04:00:00.000Z",
      },
    });

    expect(result.id).toBe("50000000-0000-4000-8000-000000000005");
    expect(fixture.statements.some(({ sql }) => sql.includes("input_snapshot_matches"))).toBe(false);
    expect(fixture.statements.filter(({ sql }) => sql.includes("insert into ai_content_proposal_batches")))
      .toHaveLength(0);
  });

  it.each([
    ["changed request", { existingRequestMatches: false }],
    ["different actor", { existingActorMatches: false }],
  ])("rejects a %s without returning the existing batch", async (_label, options) => {
    const fixture = proposalV2Transaction({ existing: true, ...options });

    await expect(fixture.repository.createAiContentProposalBatchV2(createProposalBatchV2Input()))
      .rejects.toThrow("ai_content_proposal_batch_conflict");

    expect(fixture.statements.map(({ sql }) => sql)).toContain("ROLLBACK");
    expect(fixture.statements.filter(({ sql }) => sql.includes("insert into ai_content_proposal_jobs")))
      .toHaveLength(0);
  });

  it("looks up a same-actor same-request replay without creating or exposing another scope", async () => {
    const fixture = proposalV2Transaction({ existing: true });

    const replay = await fixture.repository.getAiContentProposalBatchV2Replay({
      ...proposalV2Scope,
      idempotencyKey: "proposal-v2-1",
      requestFingerprint: "f".repeat(64),
    });

    expect(replay?.id).toBe("50000000-0000-4000-8000-000000000005");
    const lookup = fixture.statements.find(({ sql }) => sql.includes("request_fingerprint_matches"))!;
    expect(lookup.sql).toContain("workspace_id=$1 and brand_id=$2 and idempotency_key=$3");
    expect(lookup.params).toEqual([
      proposalV2Scope.workspaceId,
      proposalV2Scope.brandId,
      "proposal-v2-1",
      proposalV2Scope.actorUserId,
      "f".repeat(64),
    ]);
    expect(fixture.statements.some(({ sql }) => sql.includes("insert into ai_content_proposal_batches")))
      .toBe(false);
  });
});

describe("AI content V2 proposal selection sealing", () => {
  it("creates only the exact V2 draft and defers all immutable input copies until start", async () => {
    const referenceA = "70000000-0000-4000-8000-000000000007";
    const referenceB = "70000000-0000-4000-8000-000000000008";
    const snapshotA = "71000000-0000-4000-8000-000000000007";
    const snapshotB = "71000000-0000-4000-8000-000000000008";
    const patternA = "72000000-0000-4000-8000-000000000007";
    const patternB = "72000000-0000-4000-8000-000000000008";
    const evidence = {
      contractVersion: "research-evidence.v1",
      decision: "searched",
      reason: "required",
      queries: ["operations"],
      capturedAt: "2026-08-01T04:00:00.000Z",
      items: [{
        id: "73000000-0000-4000-8000-000000000007",
        title: "Evidence",
        url: "https://evidence.example/article",
        publisher: null,
        publishedAt: null,
        capturedAt: "2026-08-01T04:00:00.000Z",
        claimSummary: "Useful claim",
        contentHash: "e".repeat(64),
      }],
    };
    const frozenReference = (referenceItemId: string, snapshotId: string, roles: string[]) => ({
      referenceItemId,
      snapshotId,
      roles,
      title: `Reference ${referenceItemId}`,
      sourceUrl: "https://reference.example/item",
      capturedAt: "2026-08-01T03:00:00.000Z",
      contentHash: "a".repeat(64),
      text: "frozen text",
      image: null,
    });
    const inputSnapshot = {
      ...proposalBaseInputV2,
      references: [
        frozenReference(referenceB, snapshotB, ["copy_pattern"]),
        frozenReference(referenceA, snapshotA, ["planning", "visual_composition"]),
      ],
    };
    const proposalJson = {
      conceptKey: "operations-guide",
      title: "Operations guide",
      informationalType: "how_to",
      oneLineIntent: "Teach operations",
      differentiator: "Practical",
      differentiationAxes: ["target"],
      target: "Operators",
      customerContext: "Daily work",
      keyMessage: "Use a checklist",
      hook: "Start today",
      selectionReason: "Useful",
      evidenceIds: [evidence.items[0].id],
      referenceIds: [referenceB, referenceA],
      outputFormat: "card_news",
      channelTargets: ["instagram"],
      assetCount: 1,
      outline: [{ index: 1, role: "cover", headline: "Checklist", purpose: "Introduce" }],
      purposeDetails: {
        kind: "informational",
        question: "How?",
        value: "Clarity",
        whyNow: "Today",
        learningPoints: ["Checklist"],
      },
    };
    const canonical = (itemId: string, snapshotId: string) => ({
      snapshotId,
      itemId,
      version: 1,
      sourceUrl: "https://reference.example/item",
      capturedAt: "2026-08-01T03:00:00.000Z",
      contentHash: "a".repeat(64),
      content: { text: "frozen text" },
      media: {},
      sourceAvailability: "available",
      provenance: {},
      permittedUse: { displayPreview: true, archiveBytes: true, modelInput: true, derivativeInspiration: true },
    });
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        statements.push({ sql, params });
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
        if (sql.includes("from workspace_members member")) return { rows: [{ ok: 1 }], rowCount: 1 };
        if (sql.includes("select select_ai_content_proposal")) return { rows: [{ selected: params[0] }], rowCount: 1 };
        if (sql.includes("from ai_content_proposals proposal") && sql.includes("join ai_content_proposal_batches")) {
          return { rows: [{
            id: params[0], batch_id: "75000000-0000-4000-8000-000000000007",
            proposal_json: proposalJson, generation_id: null,
            purpose: "informational", input_snapshot_json: inputSnapshot,
          }], rowCount: 1 };
        }
        if (sql.includes("insert into ai_content_generations")) return { rows: [row("generation-1", "draft")], rowCount: 1 };
        if (sql.includes("update ai_content_proposals")) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const repository = createAiContentRepository({ connect: async () => client, query: client.query } as never);

    await repository.selectAiContentProposal({
      ...proposalV2Scope,
      proposalId: "74000000-0000-4000-8000-000000000007",
      idempotencyKey: "select-v2",
    });

    const selectedRead = statements.find(({ sql }) => sql.includes("from ai_content_proposals proposal") && sql.includes("join ai_content_proposal_batches"))!;
    expect(selectedRead.sql).toContain("input_snapshot_json");
    expect(selectedRead.sql).not.toContain("ai_content_proposal_research_snapshots");
    const allSql = statements.map(({ sql }) => sql).join("\n");
    expect(allSql).not.toContain("ai_content_approved_proposal_versions");
    expect(allSql).not.toContain("ai_content_generation_references");
    const generationInsert = statements.find(({ sql }) => sql.includes("insert into ai_content_generations"))!;
    expect(JSON.parse(String(generationInsert.params[4]))).toEqual({
      origin: "proposal-v2",
      proposalBatchId: "75000000-0000-4000-8000-000000000007",
      proposalId: "74000000-0000-4000-8000-000000000007",
      finalization: {
        contractVersion: "content-finalization-draft.v2",
        avatarStyleImageId: null,
        userImageInstruction: null,
        attachmentIds: [],
      },
    });
  });
});

describe("AI content V2 finalization draft", () => {
  it("updates only avatar, common instruction, and current-generation V3 attachment IDs", async () => {
    const attachmentId = "75000000-0000-4000-8000-000000000007";
    const generation = {
      ...row("76000000-0000-4000-8000-000000000007", "draft"),
      draft_json: {
        origin: "proposal-v2",
        proposalId: "74000000-0000-4000-8000-000000000007",
        approvedProposalVersionId: "77000000-0000-4000-8000-000000000007",
        finalization: {
          contractVersion: "content-finalization-draft.v2",
          avatarStyleImageId: null,
          userImageInstruction: null,
          attachmentIds: [],
        },
      },
    };
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        statements.push({ sql, params });
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
        if (sql.includes("from workspace_members member")) return { rows: [{ ok: 1 }], rowCount: 1 };
        if (sql.includes("from ai_content_generations") && sql.includes("for update")) return { rows: [generation], rowCount: 1 };
        if (sql.includes("from ai_content_generation_attachments")) {
          return { rows: [{ id: attachmentId }], rowCount: 1 };
        }
        if (sql.includes("update ai_content_generations")) {
          return { rows: [{
            ...generation,
            draft_json: JSON.parse(String(params[3])),
          }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const repository = createAiContentRepository({ connect: async () => client, query: client.query } as never);
    const draft = {
      contractVersion: "content-finalization-draft.v2" as const,
      avatarStyleImageId: "78000000-0000-4000-8000-000000000007",
      userImageInstruction: "editorial light",
      attachmentIds: [attachmentId],
    };

    const result = await repository.updateAiContentFinalizationDraft({
      ...proposalV2Scope,
      generationId: generation.id,
      draft,
    });

    expect(result.draft.finalization).toEqual(draft);
    const attachmentRead = statements.find(({ sql }) => sql.includes("from ai_content_generation_attachments"))!;
    expect(attachmentRead.sql).toContain("generation_id=$1");
    expect(attachmentRead.sql).toContain("role in ('product_image','visual_reference','supporting_image')");
    expect(attachmentRead.sql).toContain("lower(mime_type) in ('image/png','image/jpeg','image/webp')");
    expect(statements.some(({ sql }) => sql.includes("ai_content_generation_references"))).toBe(false);
  });

  it("uses one public unavailable error for an attachment outside the generation", async () => {
    const generation = {
      ...row("76000000-0000-4000-8000-000000000007", "draft"),
      draft_json: { origin: "proposal-v2", proposalId: "74000000-0000-4000-8000-000000000007" },
    };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
        if (sql.includes("from workspace_members member")) return { rows: [{ ok: 1 }], rowCount: 1 };
        if (sql.includes("from ai_content_generations") && sql.includes("for update")) return { rows: [generation], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const repository = createAiContentRepository({ connect: async () => client, query: client.query } as never);
    await expect(repository.updateAiContentFinalizationDraft({
      ...proposalV2Scope,
      generationId: generation.id,
      draft: {
        contractVersion: "content-finalization-draft.v2",
        avatarStyleImageId: null,
        userImageInstruction: null,
        attachmentIds: ["75000000-0000-4000-8000-000000000099"],
      },
    })).rejects.toThrow(/^RESOURCE_NOT_AVAILABLE$/);
  });
});

function v3FinalizationHarness(options: {
  avatarStyleImageId?: string | null;
  styleImages?: unknown[];
  revalidateError?: Error;
  existingSnapshot?: { input_json: unknown; content_hash: string };
  inputSnapshot?: ProposalBaseInputSnapshotV2;
  proposalJson?: Record<string, unknown>;
} = {}) {
  const generationId = "76000000-0000-4000-8000-000000000007";
  const proposalId = "74000000-0000-4000-8000-000000000007";
  const batchId = "75000000-0000-4000-8000-000000000007";
  const approvedId = "77000000-0000-4000-8000-000000000007";
  const evidence = {
    contractVersion: "research-evidence.v1",
    decision: "searched",
    reason: "required",
    queries: ["operations"],
    capturedAt: "2026-08-01T04:00:00.000Z",
    items: [{
      id: "73000000-0000-4000-8000-000000000007",
      title: "Evidence",
      url: "https://evidence.example/article",
      publisher: null,
      publishedAt: null,
      capturedAt: "2026-08-01T04:00:00.000Z",
      claimSummary: "Useful claim",
      contentHash: "e".repeat(64),
    }],
  };
  const proposalJson = options.proposalJson ?? {
    conceptKey: "operations-guide",
    title: "Operations guide",
    informationalType: "how_to",
    oneLineIntent: "Teach operations",
    differentiator: "Practical",
    differentiationAxes: ["target"],
    target: "Operators",
    customerContext: "Daily work",
    keyMessage: "Use a checklist",
    hook: "Start today",
    selectionReason: "Useful",
    evidenceIds: [evidence.items[0].id],
    referenceIds: [],
    outputFormat: "card_news",
    channelTargets: ["instagram"],
    assetCount: 1,
    outline: [{ index: 1, role: "cover", headline: "Checklist", purpose: "Introduce" }],
    purposeDetails: {
      kind: "informational",
      question: "How?",
      value: "Clarity",
      whyNow: "Today",
      learningPoints: ["Checklist"],
    },
  };
  const generation = {
    ...row(generationId, "draft"),
    workspace_id: proposalV2Scope.workspaceId,
    brand_id: proposalV2Scope.brandId,
    draft_json: {
      origin: "proposal-v2",
      proposalId,
      approvedProposalVersionId: approvedId,
      finalization: {
        contractVersion: "content-finalization-draft.v2",
        avatarStyleImageId: options.avatarStyleImageId ?? null,
        userImageInstruction: null,
        attachmentIds: [],
      },
    },
  };
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
      if (sql.includes("from workspace_members member")) return { rows: [{ ok: 1 }], rowCount: 1 };
      if (sql.includes("from ai_content_generations")) return { rows: [generation], rowCount: 1 };
      if (sql.includes("from ai_content_proposals proposal") && !sql.includes("for update") && !sql.includes("approved_proposal_snapshot")) {
        return { rows: [{ proposal_id: proposalId, batch_id: batchId }], rowCount: 1 };
      }
      if (sql.includes("from ai_content_proposal_batches batch") && sql.includes("for update")) {
        return { rows: [{ id: batchId, status: "ready" }], rowCount: 1 };
      }
      if (sql.includes("from ai_content_proposals proposal") && sql.includes("proposal.batch_id") && sql.includes("for update") && !sql.includes("approved_proposal_snapshot")) {
        return { rows: [{ id: proposalId, batch_id: batchId, status: "selected", generation_id: generationId }], rowCount: 1 };
      }
      if (sql.includes("from ai_content_approved_proposal_versions approved") && sql.includes("for update")) {
        return { rows: [{ id: approvedId }], rowCount: 1 };
      }
      if (sql.includes("from ai_content_proposals proposal") && sql.includes("approved_proposal_snapshot")) {
        return { rows: [{
          proposal_json: proposalJson,
          approved_proposal_snapshot: { effectiveProposal: proposalJson },
          input_snapshot_json: options.inputSnapshot ?? proposalBaseInputV2,
          evidence_json: evidence,
        }], rowCount: 1 };
      }
      if (sql.includes("from ai_content_generation_input_snapshots") && sql.includes("for update")) {
        return options.existingSnapshot
          ? { rows: [options.existingSnapshot], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
      if (sql.includes("from ai_content_usage_ledger")) return { rows: [{ generation_count: 0 }], rowCount: 1 };
      if (sql.includes("insert into ai_content_generation_input_snapshots")) return { rows: [], rowCount: 1 };
      if (sql.includes("insert into ai_content_generation_outputs")) {
        return { rows: [{ id: "79000000-0000-4000-8000-000000000007" }], rowCount: 1 };
      }
      if (sql.includes("update ai_content_generations")) {
        return { rows: [{ ...generation, status: "queued", generation_idempotency_key: params[3] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    }),
    release: vi.fn(),
  };
  const revalidateFrozenResources = vi.fn(async () => {
    if (options.revalidateError) throw options.revalidateError;
  });
  const loadApprovedStyleImages = vi.fn(async () => options.styleImages ?? []);
  const snapshots = { revalidateFrozenResources, loadApprovedStyleImages } as unknown as AiContentSnapshotRepository;
  return {
    generationId,
    evidence,
    client,
    statements,
    snapshots,
    repository: createAiContentRepository({ connect: async () => client, query: client.query } as never),
  };
}

describe("AI content V3 final input sealing", () => {
  it("locks the selected batch, proposal, and generation in one global order before finalization side effects", async () => {
    const fixture = v3FinalizationHarness();

    await fixture.repository.startAiContentGenerationV3({
      ...proposalV2Scope,
      generationId: fixture.generationId,
      contractVersion: "content-generation-start.v2",
      idempotencyKey: "global-lock-order",
      usageDate: "2026-08-01",
      dailyGenerationLimit: 10,
    }, fixture.snapshots);

    const transactionStart = fixture.statements.findIndex(({ sql }) => sql === "BEGIN");
    const batchLock = fixture.statements.findIndex(({ sql }) => (
      sql.includes("from ai_content_proposal_batches batch") && sql.includes("for update")
    ));
    const proposalLock = fixture.statements.findIndex(({ sql }) => (
      sql.includes("from ai_content_proposals proposal")
        && sql.includes("proposal.batch_id")
        && sql.includes("for update")
    ));
    const generationLock = fixture.statements.findIndex(({ sql }) => (
      sql.includes("from ai_content_generations") && sql.includes("for update")
    ));
    const firstSideEffect = fixture.statements.findIndex(({ sql }) => (
      sql.includes("insert into ai_content_generation_input_snapshots")
    ));

    expect(transactionStart).toBeGreaterThanOrEqual(0);
    expect(batchLock).toBeGreaterThan(transactionStart);
    expect(proposalLock).toBeGreaterThan(batchLock);
    expect(generationLock).toBeGreaterThan(proposalLock);
    expect(firstSideEffect).toBeGreaterThan(generationLock);
  });

  it("builds one immutable input and one generate job from the selected proposal snapshot", async () => {
    const generationId = "76000000-0000-4000-8000-000000000007";
    const proposalId = "74000000-0000-4000-8000-000000000007";
    const batchId = "75000000-0000-4000-8000-000000000007";
    const approvedId = "77000000-0000-4000-8000-000000000007";
    const outputId = "79000000-0000-4000-8000-000000000007";
    const evidence = {
      contractVersion: "research-evidence.v1",
      decision: "searched",
      reason: "required",
      queries: ["operations"],
      capturedAt: "2026-08-01T04:00:00.000Z",
      items: [{
        id: "73000000-0000-4000-8000-000000000007",
        title: "Evidence",
        url: "https://evidence.example/article",
        publisher: null,
        publishedAt: null,
        capturedAt: "2026-08-01T04:00:00.000Z",
        claimSummary: "Useful claim",
        contentHash: "e".repeat(64),
      }],
    };
    const proposalJson = {
      conceptKey: "operations-guide",
      title: "Operations guide",
      informationalType: "how_to",
      oneLineIntent: "Teach operations",
      differentiator: "Practical",
      differentiationAxes: ["target"],
      target: "Operators",
      customerContext: "Daily work",
      keyMessage: "Use a checklist",
      hook: "Start today",
      selectionReason: "Useful",
      evidenceIds: [evidence.items[0].id],
      referenceIds: [],
      outputFormat: "card_news",
      channelTargets: ["instagram"],
      assetCount: 1,
      outline: [{ index: 1, role: "cover", headline: "Checklist", purpose: "Introduce" }],
      purposeDetails: {
        kind: "informational",
        question: "How?",
        value: "Clarity",
        whyNow: "Today",
        learningPoints: ["Checklist"],
      },
    };
    const generation = {
      ...row(generationId, "draft"),
      workspace_id: proposalV2Scope.workspaceId,
      brand_id: proposalV2Scope.brandId,
      draft_json: {
        origin: "proposal-v2",
        proposalId,
        approvedProposalVersionId: approvedId,
        finalization: {
          contractVersion: "content-finalization-draft.v2",
          avatarStyleImageId: null,
          userImageInstruction: null,
          attachmentIds: [],
        },
      },
      content_family: "informational",
      output_format: "card_news",
    };
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        statements.push({ sql, params });
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
        if (sql.includes("from workspace_members member")) return { rows: [{ ok: 1 }], rowCount: 1 };
        if (sql.includes("from ai_content_generations")) return { rows: [generation], rowCount: 1 };
        if (sql.includes("from ai_content_proposals proposal") && !sql.includes("for update") && !sql.includes("approved_proposal_snapshot")) {
          return { rows: [{ proposal_id: proposalId, batch_id: batchId }], rowCount: 1 };
        }
        if (sql.includes("from ai_content_proposal_batches batch") && sql.includes("for update")) {
          return { rows: [{ id: batchId, status: "ready" }], rowCount: 1 };
        }
        if (sql.includes("from ai_content_proposals proposal") && sql.includes("for update") && !sql.includes("approved_proposal_snapshot")) {
          return { rows: [{ id: proposalId, batch_id: batchId, status: "selected", generation_id: generationId }], rowCount: 1 };
        }
        if (sql.includes("from ai_content_approved_proposal_versions approved") && sql.includes("for update")) {
          return { rows: [{ id: approvedId }], rowCount: 1 };
        }
        if (sql.includes("from ai_content_proposals proposal") && sql.includes("approved_proposal_snapshot")) {
          return { rows: [{
            proposal_json: proposalJson,
            approved_proposal_snapshot: { effectiveProposal: proposalJson },
            input_snapshot_json: proposalBaseInputV2,
            evidence_json: evidence,
          }], rowCount: 1 };
        }
        if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
        if (sql.includes("from ai_content_usage_ledger")) return { rows: [{ generation_count: 0 }], rowCount: 1 };
        if (sql.includes("from ai_content_generation_input_snapshots") && sql.includes("for update")) return { rows: [], rowCount: 0 };
        if (sql.includes("insert into ai_content_generation_input_snapshots")) return { rows: [{ id: "80000000-0000-4000-8000-000000000008" }], rowCount: 1 };
        if (sql.includes("insert into ai_content_generation_outputs")) return { rows: [{ id: outputId }], rowCount: 1 };
        if (sql.includes("insert into ai_content_output_research_snapshots")) return { rows: [], rowCount: 1 };
        if (sql.includes("insert into ai_content_generation_jobs")) return { rows: [{ id: "81000000-0000-4000-8000-000000000008" }], rowCount: 1 };
        if (sql.includes("insert into ai_content_usage_ledger")) return { rows: [], rowCount: 1 };
        if (sql.includes("update ai_content_generations")) return { rows: [{
          ...generation,
          status: "queued",
          current_stage: "generation",
          generation_idempotency_key: params[3],
        }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const revalidateFrozenResources = vi.fn(async () => undefined);
    const loadApprovedStyleImages = vi.fn(async () => []);
    const snapshots = {
      revalidateFrozenResources,
      loadApprovedStyleImages,
    } as unknown as AiContentSnapshotRepository;
    const repository = createAiContentRepository({ connect: async () => client, query: client.query } as never);

    const result = await repository.startAiContentGenerationV3({
      ...proposalV2Scope,
      generationId,
      contractVersion: "content-generation-start.v2",
      idempotencyKey: "start-v3-1",
      usageDate: "2026-08-01",
      dailyGenerationLimit: 10,
    }, snapshots, () => new Date("2026-08-01T05:00:00.000Z"));

    expect(result).toMatchObject({ id: generationId, status: "queued" });
    expect(revalidateFrozenResources).toHaveBeenCalledWith(expect.objectContaining({
      coreVersionId: proposalBaseInputV2.brandCore.versionId,
      product: null,
      references: [],
      database: client,
    }));
    expect(loadApprovedStyleImages).toHaveBeenCalledWith({
      workspaceId: proposalV2Scope.workspaceId,
      brandId: proposalV2Scope.brandId,
    }, client);
    const inputInsert = statements.find(({ sql }) => sql.includes("insert into ai_content_generation_input_snapshots"))!;
    const finalInput = JSON.parse(String(inputInsert.params[4]));
    expect(finalInput.brandCore).toEqual(proposalBaseInputV2.brandCore);
    expect(finalInput.product).toEqual(proposalBaseInputV2.product);
    expect(finalInput.references.selected).toEqual(proposalBaseInputV2.references);
    expect(finalInput.researchEvidence).toEqual(evidence);
    expect(finalInput).toMatchObject({
      contractVersion: "content-generation-input.v3",
      generationId,
      brandCore: proposalBaseInputV2.brandCore,
      product: null,
      researchEvidence: evidence,
      references: { selected: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [] },
      selectedProposal: { id: proposalId, title: proposalJson.title },
      outputSettings: proposalBaseInputV2.outputSettings,
    });
    expect(JSON.stringify(finalInput)).not.toMatch(/wiki|faq|logo|avatarSnapshot/i);
    expect(String(inputInsert.params[5])).toMatch(/^[0-9a-f]{64}$/);
    expect(statements.filter(({ sql }) => sql.includes("insert into ai_content_generation_outputs"))).toHaveLength(1);
    const jobs = statements.filter(({ sql }) => sql.includes("insert into ai_content_generation_jobs"));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.sql).toContain("'generate'");
    expect(jobs[0]!.sql).not.toContain("'analyze'");
  });

  it("returns the existing V3 generation for the same key without revalidating, charging, or creating another output", async () => {
    const generationId = "76000000-0000-4000-8000-000000000007";
    const proposalId = "74000000-0000-4000-8000-000000000007";
    const batchId = "75000000-0000-4000-8000-000000000007";
    const generation = {
      ...row(generationId, "queued"),
      workspace_id: proposalV2Scope.workspaceId,
      brand_id: proposalV2Scope.brandId,
      generation_idempotency_key: "same-final-start",
      draft_json: {
        origin: "proposal-v2",
        proposalId,
        approvedProposalVersionId: "77000000-0000-4000-8000-000000000007",
      },
    };
    const statements: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql);
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
        if (sql.includes("from workspace_members member")) return { rows: [{ ok: 1 }], rowCount: 1 };
        if (sql.includes("from ai_content_generations")) {
          return { rows: [generation], rowCount: 1 };
        }
        if (sql.includes("from ai_content_proposals proposal") && !sql.includes("for update")) {
          return { rows: [{ proposal_id: proposalId, batch_id: batchId }], rowCount: 1 };
        }
        if (sql.includes("from ai_content_proposal_batches batch") && sql.includes("for update")) {
          return { rows: [{ id: batchId, status: "ready" }], rowCount: 1 };
        }
        if (sql.includes("from ai_content_proposals proposal") && sql.includes("for update")) {
          return { rows: [{ id: proposalId, batch_id: batchId, status: "selected", generation_id: generationId }], rowCount: 1 };
        }
        if (sql.includes("from ai_content_approved_proposal_versions approved") && sql.includes("for update")) {
          return { rows: [{ id: generation.draft_json.approvedProposalVersionId }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const snapshots = {
      revalidateFrozenResources: vi.fn(),
      loadApprovedStyleImages: vi.fn(),
    } as unknown as AiContentSnapshotRepository;
    const repository = createAiContentRepository({ connect: async () => client, query: client.query } as never);

    await expect(repository.startAiContentGenerationV3({
      ...proposalV2Scope,
      generationId,
      contractVersion: "content-generation-start.v2",
      idempotencyKey: "same-final-start",
      usageDate: "2026-08-01",
      dailyGenerationLimit: 0,
    }, snapshots)).resolves.toMatchObject({ id: generationId, status: "queued" });

    expect(snapshots.revalidateFrozenResources).not.toHaveBeenCalled();
    expect(snapshots.loadApprovedStyleImages).not.toHaveBeenCalled();
    expect(statements.some((sql) => sql.includes("ai_content_usage_ledger"))).toBe(false);
    expect(statements.some((sql) => sql.includes("insert into ai_content_generation_outputs"))).toBe(false);
    expect(statements.some((sql) => sql.includes("insert into ai_content_generation_jobs"))).toBe(false);
    const batchLock = statements.findIndex((sql) => sql.includes("from ai_content_proposal_batches batch") && sql.includes("for update"));
    const proposalLock = statements.findIndex((sql) => sql.includes("from ai_content_proposals proposal") && sql.includes("for update"));
    const generationLock = statements.findIndex((sql) => sql.includes("from ai_content_generations") && sql.includes("for update"));
    expect(batchLock).toBeGreaterThanOrEqual(0);
    expect(proposalLock).toBeGreaterThan(batchLock);
    expect(generationLock).toBeGreaterThan(proposalLock);
    expect(statements.some((sql) => (
      sql.includes("from ai_content_approved_proposal_versions approved") && sql.includes("for update")
    ))).toBe(true);
  });

  it("seals the non-empty proposal-time core, product, references, and research without substituting newer resources", async () => {
    const product = {
      id: "82000000-0000-4000-8000-000000000008",
      versionId: "83000000-0000-4000-8000-000000000008",
      kind: "service" as const,
      name: "Frozen service",
      description: "Proposal-time approved service",
      features: ["Frozen feature"],
      benefits: ["Frozen benefit"],
      cautions: [],
      evergreenPurchaseInfo: "Always available",
      images: [],
    };
    const references = [
      {
        referenceItemId: "84000000-0000-4000-8000-000000000008",
        snapshotId: "85000000-0000-4000-8000-000000000008",
        roles: ["copy_pattern" as const],
        title: "Frozen conversion copy",
        sourceUrl: "https://reference.example/frozen-copy",
        capturedAt: "2026-08-01T03:00:00.000Z",
        contentHash: "8".repeat(64),
        text: "Proposal-time copy pattern",
        image: null,
      },
      {
        referenceItemId: "84000000-0000-4000-8000-000000000009",
        snapshotId: "85000000-0000-4000-8000-000000000009",
        roles: ["planning" as const, "visual_composition" as const],
        title: "Frozen visual plan",
        sourceUrl: "https://reference.example/frozen-visual",
        capturedAt: "2026-08-01T03:01:00.000Z",
        contentHash: "9".repeat(64),
        text: "Proposal-time visual structure",
        image: {
          storageUrl: "https://blob.example/ai-content/snapshots/frozen-visual.webp",
          storagePath: "ai-content/snapshots/frozen-visual.webp",
          mimeType: "image/webp" as const,
          checksum: "a".repeat(64),
        },
      },
    ];
    const inputSnapshot: ProposalBaseInputSnapshotV2 = {
      ...proposalBaseInputV2,
      product,
      references,
      outputSettings: {
        outputFormat: "marketing_content",
        channelTargets: ["instagram"],
        aspectRatio: "4:5",
        outputCount: 1,
        purpose: "marketing",
      },
    };
    const proposalJson = {
      conceptKey: "frozen-service-campaign",
      title: "Frozen service campaign",
      informationalType: null,
      oneLineIntent: "Present the frozen service",
      differentiator: "Proposal-time positioning",
      differentiationAxes: ["appeal"],
      target: "Operators",
      customerContext: "Needs a reliable workflow",
      keyMessage: "Use the frozen service",
      hook: "Start now",
      selectionReason: "High conversion potential",
      evidenceIds: ["73000000-0000-4000-8000-000000000007"],
      referenceIds: references.map(({ referenceItemId }) => referenceItemId),
      outputFormat: "marketing_content",
      channelTargets: ["instagram"],
      assetCount: 1,
      outline: [{ index: 1, role: "hero", headline: "Frozen service", purpose: "Convert" }],
      purposeDetails: {
        kind: "marketing",
        campaignObjective: "Generate inquiries",
        situationAndNeed: "Operators need consistency",
        productId: product.id,
        targetSegment: "High-intent operators",
        strengths: ["Frozen strength"],
        limitations: [],
        appeal: "Reliable execution",
        buyingBarriers: [],
        cta: "Contact us",
      },
    };
    const fixture = v3FinalizationHarness({ inputSnapshot, proposalJson });

    await fixture.repository.startAiContentGenerationV3({
      ...proposalV2Scope,
      generationId: fixture.generationId,
      contractVersion: "content-generation-start.v2",
      idempotencyKey: "frozen-marketing",
      usageDate: "2026-08-01",
      dailyGenerationLimit: 10,
    }, fixture.snapshots, () => new Date("2026-08-01T05:00:00.000Z"));

    expect(fixture.snapshots.revalidateFrozenResources).toHaveBeenCalledWith(expect.objectContaining({
      coreVersionId: proposalBaseInputV2.brandCore.versionId,
      product,
      references,
      database: fixture.client,
    }));
    const insert = fixture.statements.find(({ sql }) => sql.includes("insert into ai_content_generation_input_snapshots"))!;
    const finalInput = JSON.parse(String(insert.params[4]));
    expect(finalInput.brandCore).toEqual(proposalBaseInputV2.brandCore);
    expect(finalInput.product).toEqual(product);
    expect(finalInput.references.selected).toEqual(references);
    expect(finalInput.references.selected.map((reference: { referenceItemId: string; roles: string[] }) => ({
      referenceItemId: reference.referenceItemId,
      roles: reference.roles,
    }))).toEqual([
      { referenceItemId: references[0]!.referenceItemId, roles: ["copy_pattern"] },
      { referenceItemId: references[1]!.referenceItemId, roles: ["planning", "visual_composition"] },
    ]);
    expect(finalInput.researchEvidence).toEqual(fixture.evidence);
  });

  it("seals the exact approved style image set and an avatar selected from that set without style metadata", async () => {
    const avatarStyleImageId = "78000000-0000-4000-8000-000000000007";
    const styleImages = [{
      referenceItemId: avatarStyleImageId,
      description: "Frozen editorial lighting",
      tags: ["editorial", "soft-light"],
      storageUrl: "https://blob.example/ai-content/snapshots/style-avatar.webp",
      storagePath: "ai-content/snapshots/style-avatar.webp",
      mimeType: "image/webp" as const,
      checksum: "7".repeat(64),
    }, {
      referenceItemId: "78000000-0000-4000-8000-000000000008",
      description: "Frozen composition reference",
      tags: ["balanced"],
      storageUrl: "https://blob.example/ai-content/snapshots/style-layout.png",
      storagePath: "ai-content/snapshots/style-layout.png",
      mimeType: "image/png" as const,
      checksum: "8".repeat(64),
    }];
    const fixture = v3FinalizationHarness({ avatarStyleImageId, styleImages });

    await fixture.repository.startAiContentGenerationV3({
      ...proposalV2Scope,
      generationId: fixture.generationId,
      contractVersion: "content-generation-start.v2",
      idempotencyKey: "approved-style-avatar",
      usageDate: "2026-08-01",
      dailyGenerationLimit: 10,
    }, fixture.snapshots, () => new Date("2026-08-01T05:00:00.000Z"));

    const insert = fixture.statements.find(({ sql }) => sql.includes("insert into ai_content_generation_input_snapshots"))!;
    const finalInput = JSON.parse(String(insert.params[4]));
    expect(finalInput.references.brandStyleImages).toEqual(styleImages);
    expect(finalInput.references.avatarStyleImageId).toBe(avatarStyleImageId);
    expect(finalInput.references.brandStyleImages.every((image: Record<string, unknown>) => (
      !("colors" in image) && !("fonts" in image) && !("notes" in image)
    ))).toBe(true);
  });

  it("blocks final start when frozen resource eligibility revalidation fails", async () => {
    const fixture = v3FinalizationHarness({ revalidateError: new Error("RESOURCE_NOT_AVAILABLE") });

    await expect(fixture.repository.startAiContentGenerationV3({
      ...proposalV2Scope,
      generationId: fixture.generationId,
      contractVersion: "content-generation-start.v2",
      idempotencyKey: "revoked-resource",
      usageDate: "2026-08-01",
      dailyGenerationLimit: 10,
    }, fixture.snapshots)).rejects.toThrow(/^RESOURCE_NOT_AVAILABLE$/);

    expect(fixture.statements.some(({ sql }) => sql.includes("insert into ai_content_generation_input_snapshots"))).toBe(false);
    expect(fixture.statements.some(({ sql }) => sql.includes("insert into ai_content_generation_outputs"))).toBe(false);
  });

  it("rejects an avatar from another brand or outside the current approved style set", async () => {
    const fixture = v3FinalizationHarness({
      avatarStyleImageId: "78000000-0000-4000-8000-000000000007",
      styleImages: [],
    });

    await expect(fixture.repository.startAiContentGenerationV3({
      ...proposalV2Scope,
      generationId: fixture.generationId,
      contractVersion: "content-generation-start.v2",
      idempotencyKey: "foreign-avatar",
      usageDate: "2026-08-01",
      dailyGenerationLimit: 10,
    }, fixture.snapshots)).rejects.toThrow(/^RESOURCE_NOT_AVAILABLE$/);
    expect(fixture.statements.some(({ sql }) => sql.includes("insert into ai_content_generation_input_snapshots"))).toBe(false);
  });

  it("rejects a second canonical final input with a different immutable snapshot hash", async () => {
    const fixture = v3FinalizationHarness({
      existingSnapshot: {
        input_json: { contractVersion: "content-generation-input.v3", generationId: "changed" },
        content_hash: "f".repeat(64),
      },
    });

    await expect(fixture.repository.startAiContentGenerationV3({
      ...proposalV2Scope,
      generationId: fixture.generationId,
      contractVersion: "content-generation-start.v2",
      idempotencyKey: "hash-conflict",
      usageDate: "2026-08-01",
      dailyGenerationLimit: 10,
    }, fixture.snapshots, () => new Date("2026-08-01T05:00:00.000Z")))
      .rejects.toThrow(/^ai_content_generation_input_conflict$/);
    expect(fixture.statements.some(({ sql }) => sql.includes("insert into ai_content_generation_outputs"))).toBe(false);
  });
});
